#!/usr/bin/env node
// Measure what did on YOUR codebase, read-only: Claude may only Read/Grep/Glob, so nothing in the repo can change.
//
//   node bench/local.mjs <repo> <questions.json> [--reps 2] [--model haiku] [--dry-run]
//                        [--conditions baseline,whatdid-automap] [--out results.json]
//   node bench/local.mjs bench/large/hugo.json     (a suite: clones the pinned public repo itself)
//
// questions.json: [{ "id": "auth", "prompt": "How are tokens verified?", "expect": ["auth.py", "decode"], "min": 2 }]
// "expect" is optional: an answer passes when it mentions at least "min" of those words (default: all).
// See bench/local-questions.example.json. Conditions: baseline (no plugin), whatdid (map as a skill),
// whatdid-automap (map preloaded at session start).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findClaude, runClaude, metricsOf, summarize, whatdidActivity, ensureRepo, resetRepo } from './run.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EST_USD = { haiku: 0.08, sonnet: 0.3, opus: 1.0 };

export function parseArgs(argv) {
  const o = { reps: 2, model: 'haiku', conditions: ['baseline', 'whatdid-automap'], budget: 1, dryRun: false };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--reps') o.reps = Math.max(1, parseInt(argv[++i], 10) || 1);
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--conditions') o.conditions = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--budget') o.budget = Number(argv[++i]) || 1;
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--dry-run') o.dryRun = true;
    else pos.push(a);
  }
  [o.repo, o.questions] = pos.length === 1 ? [null, pos[0]] : pos;
  return o;
}

// A suite file pins a public repo: { "repo": { "name", "url", "sha" }, "questions": [...] }.
export function loadQuestions(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(data) ? { questions: data } : data;
}

export function readOnlyArgs(q, condition, o) {
  const args = ['-p', q.prompt, '--output-format', 'json', '--model', o.model,
    '--setting-sources', 'project,local', '--strict-mcp-config', '--no-session-persistence', '--max-budget-usd', String(o.budget),
    '--allowedTools', 'Read', 'Grep', 'Glob', 'Skill',
    '--disallowedTools', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell'];
  if (condition !== 'baseline') args.push('--plugin-dir', ROOT);
  return args;
}

export function grade(q, answer) {
  if (!q.expect || !q.expect.length) return { pass: null, hits: '' };
  const hits = q.expect.filter((k) => answer.toLowerCase().includes(String(k).toLowerCase()));
  return { pass: hits.length >= (q.min || q.expect.length), hits: `${hits.length}/${q.expect.length}` };
}

const gitState = (dir) => {
  const s = spawnSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
  const h = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' });
  return s.status === 0 ? `${h.stdout.trim()}\n${s.stdout}` : null;
};

function main() {
  const o = parseArgs(process.argv.slice(2));
  const suite = o.questions && loadQuestions(o.questions);
  if (!suite || (!o.repo && !suite.repo)) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 11).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return 1;
  }
  const { questions } = suite;
  if (!o.repo && !o.dryRun) {
    o.repo = ensureRepo(`${suite.repo.name}-${suite.repo.sha.slice(0, 7)}`, suite.repo);
    resetRepo(o.repo, suite.repo.sha);
  }
  const total = questions.length * o.conditions.length * o.reps;
  console.log(`${total} runs (${questions.length} questions × ${o.conditions.length} conditions × ${o.reps} reps) on ${o.repo || suite.repo.url}, model ${o.model}. ` +
    `Estimated ~$${(total * (EST_USD[o.model] ?? 0.3)).toFixed(2)}; hard cap $${(total * o.budget).toFixed(2)}.`);
  if (o.dryRun) return 0;

  const before = gitState(o.repo);
  const bin = findClaude();
  const results = [];
  for (let rep = 1; rep <= o.reps; rep++) {
    for (const q of questions) {
      for (const condition of o.conditions) {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'whatdid-local-'));
        const env = { ...process.env, WHATDID_HOME: home, WHATDID_AUTOMAP: condition === 'whatdid-automap' ? '1' : '0', WHATDID_AUTO: '0', WHATDID_WELCOME: '0' };
        const { json } = runClaude(bin, readOnlyArgs(q, condition, o), o.repo, env);
        const m = metricsOf(json);
        const g = grade(q, String(json?.result || ''));
        const act = whatdidActivity(home);
        results.push({ task: q.id, condition, rep, ...m, pass: g.pass ?? !m.is_error, hits: g.hits, whatdid_tool_calls: act.tools });
        console.log(`[${results.length}/${total}] ${q.id} · ${condition} · rep ${rep}: ${g.pass === false ? 'FAIL' : 'ok'} ${g.hits} · ` +
          `${Math.round(m.total_input_tokens / 1000)}k in · $${m.cost_usd?.toFixed(3)} · ${m.num_turns} turns`);
      }
    }
  }
  const after = gitState(o.repo);
  const md = summarize(results, o.conditions);
  const out = o.out || path.join(ROOT, 'bench', 'results', `${suite.repo ? suite.repo.name : 'local'}-${new Date().toISOString().slice(0, 10)}-${o.model}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ date: new Date().toISOString(), repo: suite.repo, model: o.model, reps: o.reps, conditions: o.conditions, results }, null, 2));
  console.log(`\n${md}\n\nWrote ${out}`);
  if (before !== null) console.log(before === after ? 'Repo unchanged (same HEAD and git status).' : 'WARNING: git status changed during the run.');
  return 0;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '')) process.exitCode = main();
