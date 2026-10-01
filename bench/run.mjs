#!/usr/bin/env node
// Token benchmark: the same tasks on pinned public repos, with and without whatdid.
//
//   node bench/run.mjs --dry-run                       # print the plan and a cost estimate, spend nothing
//   node bench/run.mjs --tasks ky-retry-explain --conditions baseline,whatdid
//   node bench/run.mjs --model haiku --reps 3          # the full suite
//
// Every run: repo reset to its pinned SHA, bug injected (fix tasks), fresh WHATDID_HOME,
// user-level settings/plugins/MCP excluded so both conditions start from the same place.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BENCH = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(BENCH, '..');
const CACHE = process.env.WHATDID_BENCH_CACHE || path.join(os.homedir(), '.whatdid', 'bench-cache');
const CONDITIONS = ['baseline', 'whatdid', 'whatdid-style', 'whatdid-automap'];
// Rough per-run cost, measured on small repos; only used for --dry-run estimates.
const EST_USD_PER_RUN = { haiku: 0.12, sonnet: 0.45, opus: 1.4, fable: 2.0 };
const ALLOWED_TOOLS = ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Skill', 'Bash(node *)', 'Bash(python *)', 'Bash(python3 *)', 'Bash(git diff*)', 'Bash(git status*)', 'Bash(ls*)'];

export function parseArgs(argv) {
  const o = { model: 'haiku', reps: 1, conditions: CONDITIONS, tasks: null, dryRun: false, budget: 1.5, style: null, keep: false, out: path.join(BENCH, 'results') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--model') o.model = next();
    else if (a === '--reps') o.reps = Math.max(1, parseInt(next(), 10) || 1);
    else if (a === '--tasks') o.tasks = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--conditions') o.conditions = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--budget') o.budget = parseFloat(next());
    else if (a === '--style') o.style = next();
    else if (a === '--out') o.out = path.resolve(next());
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--keep') o.keep = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown flag: ${a}`);
  }
  for (const c of o.conditions) if (!CONDITIONS.includes(c)) throw new Error(`unknown condition: ${c} (use ${CONDITIONS.join(', ')})`);
  return o;
}

export function loadTasks(ids) {
  const spec = JSON.parse(fs.readFileSync(path.join(BENCH, 'tasks.json'), 'utf8'));
  let tasks = spec.tasks;
  if (ids) {
    const unknown = ids.filter((id) => !tasks.some((t) => t.id === id));
    if (unknown.length) throw new Error(`unknown task(s): ${unknown.join(', ')}`);
    tasks = tasks.filter((t) => ids.includes(t.id));
  }
  return { repos: spec.repos, tasks };
}

// The output style name as Claude Code sees it: "<plugin>:<name>", name from frontmatter or file name.
export function detectStyle(root = ROOT) {
  const dir = path.join(root, 'output-styles');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { return null; }
  if (!files.length) return null;
  const file = files.includes('whatdid.md') ? 'whatdid.md' : files[0];
  const fm = fs.readFileSync(path.join(dir, file), 'utf8').match(/^---\s*\n([\s\S]*?)\n---/);
  const name = fm?.[1].match(/^name:\s*["']?(.+?)["']?\s*$/m)?.[1] || file.replace(/\.md$/, '');
  return `whatdid:${name}`;
}

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${r.stderr}`);
  return r.stdout.trim();
};

export function ensureRepo(key, repo) {
  const dir = path.join(CACHE, key);
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(dir, { recursive: true });
    git(dir, 'init', '-q');
    git(dir, 'remote', 'add', 'origin', repo.url);
  }
  const has = spawnSync('git', ['cat-file', '-e', `${repo.sha}^{commit}`], { cwd: dir }).status === 0;
  if (!has) git(dir, 'fetch', '-q', '--depth', '1', 'origin', repo.sha);
  return dir;
}

export function resetRepo(dir, sha, setup = []) {
  git(dir, 'checkout', '-q', '--force', '--detach', sha);
  git(dir, 'reset', '-q', '--hard', sha);
  git(dir, 'clean', '-q', '-fdx');
  for (const s of setup) {
    const f = path.join(dir, s.file);
    const src = fs.readFileSync(f, 'utf8');
    if (!src.includes(s.find)) throw new Error(`setup anchor not found in ${s.file}: ${s.find}`);
    fs.writeFileSync(f, src.replace(s.find, s.replace));
  }
}

function pythonCmd() {
  for (const c of ['python3', 'python']) if (spawnSync(c, ['--version']).status === 0) return c;
  return 'python';
}

export function runCheck(check, { cwd, resultText }) {
  if (check.type === 'rubric') {
    const text = String(resultText || '').toLowerCase();
    const all = (check.all || []).every((s) => text.includes(s.toLowerCase()));
    const any = !check.any || check.any.some((s) => text.includes(s.toLowerCase()));
    return { pass: all && any, how: 'rubric' };
  }
  const cmd = check.cmd === 'python' ? pythonCmd() : check.cmd === 'node' ? process.execPath : check.cmd;
  const r = spawnSync(cmd, [path.join(BENCH, check.file)], { cwd, encoding: 'utf8', timeout: 60000 });
  return { pass: r.status === 0, how: 'script', stderr: (r.stderr || '').slice(0, 300) };
}

export function findClaude() {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8' });
  const hits = (probe.stdout || '').split(/\r?\n/).filter(Boolean);
  return hits.find((h) => /\.exe$/i.test(h)) || hits[0] || 'claude';
}

export function claudeArgs(task, condition, o) {
  const args = ['-p', task.prompt, '--output-format', 'json', '--model', o.model,
    '--permission-mode', 'acceptEdits', '--setting-sources', 'project,local', '--strict-mcp-config',
    '--no-session-persistence', '--max-budget-usd', String(o.budget), '--allowedTools', ...ALLOWED_TOOLS];
  if (condition !== 'baseline') args.push('--plugin-dir', ROOT);
  if (condition === 'whatdid-style') args.push('--settings', JSON.stringify({ outputStyle: o.style }));
  return args;
}

const quoteForCmd = (a) => (/[\s"&|<>^()%!]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

export function runClaude(bin, args, cwd, env) {
  const viaShell = /\.(cmd|bat)$/i.test(bin);
  const r = viaShell
    ? spawnSync([bin, ...args].map(quoteForCmd).join(' '), { cwd, env, encoding: 'utf8', shell: true, timeout: 20 * 60000, maxBuffer: 64 << 20 })
    : spawnSync(bin, args, { cwd, env, encoding: 'utf8', timeout: 20 * 60000, maxBuffer: 64 << 20 });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch {
    const last = (r.stdout || '').trim().split('\n').reverse().find((l) => l.startsWith('{'));
    try { json = JSON.parse(last); } catch {}
  }
  return { json, status: r.status, stderr: (r.stderr || '').slice(0, 500) };
}

export function metricsOf(json) {
  const u = json?.usage || {};
  const input = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  return {
    input_tokens: u.input_tokens || 0,
    cache_creation_tokens: u.cache_creation_input_tokens || 0,
    cache_read_tokens: u.cache_read_input_tokens || 0,
    total_input_tokens: input,
    output_tokens: u.output_tokens || 0,
    cost_usd: json?.total_cost_usd ?? null,
    duration_ms: json?.duration_ms ?? null,
    num_turns: json?.num_turns ?? null,
    is_error: json?.is_error ?? true,
  };
}

export const median = (xs) => {
  const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

const fmtN = (n) => (n == null ? '–' : n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const pct = (v, base) => (v == null || !base ? '' : ` (${v >= base ? '+' : ''}${Math.round(((v - base) / base) * 100)}%)`);

// Markdown table: one row per task x condition with medians, deltas vs baseline, then totals.
export function summarize(results, conditions) {
  const byKey = new Map();
  for (const r of results) {
    const k = `${r.task}|${r.condition}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  const tasks = [...new Set(results.map((r) => r.task))];
  const rows = ['| task | condition | runs | pass | median input tok | median output tok | median cost $ | median time s | median turns |', '|---|---|---|---|---|---|---|---|---|'];
  const totals = Object.fromEntries(conditions.map((c) => [c, { input: 0, output: 0, cost: 0, pass: 0, runs: 0 }]));
  for (const t of tasks) {
    const base = byKey.get(`${t}|baseline`) || [];
    const bIn = median(base.map((r) => r.total_input_tokens));
    const bOut = median(base.map((r) => r.output_tokens));
    const bCost = median(base.map((r) => r.cost_usd));
    for (const c of conditions) {
      const rs = byKey.get(`${t}|${c}`) || [];
      if (!rs.length) continue;
      const mIn = median(rs.map((r) => r.total_input_tokens));
      const mOut = median(rs.map((r) => r.output_tokens));
      const mCost = median(rs.map((r) => r.cost_usd));
      const pass = rs.filter((r) => r.pass).length;
      const isBase = c === 'baseline';
      rows.push(`| ${t} | ${c} | ${rs.length} | ${pass}/${rs.length} | ${fmtN(mIn)}${isBase ? '' : pct(mIn, bIn)} | ${fmtN(mOut)}${isBase ? '' : pct(mOut, bOut)} | ${mCost == null ? '–' : mCost.toFixed(3)}${isBase ? '' : pct(mCost, bCost)} | ${median(rs.map((r) => r.duration_ms)) == null ? '–' : (median(rs.map((r) => r.duration_ms)) / 1000).toFixed(0)} | ${median(rs.map((r) => r.num_turns)) ?? '–'} |`);
      const T = totals[c];
      T.input += mIn || 0; T.output += mOut || 0; T.cost += mCost || 0; T.pass += pass; T.runs += rs.length;
    }
  }
  const b = totals.baseline;
  rows.push('', '**Totals (sum of per-task medians)**', '', '| condition | pass | input tok | output tok | cost $ |', '|---|---|---|---|---|');
  for (const c of conditions) {
    const T = totals[c];
    const isBase = c === 'baseline' || !b;
    rows.push(`| ${c} | ${T.pass}/${T.runs} | ${fmtN(T.input)}${isBase ? '' : pct(T.input, b.input)} | ${fmtN(T.output)}${isBase ? '' : pct(T.output, b.output)} | ${T.cost.toFixed(3)}${isBase ? '' : pct(T.cost, b.cost)} |`);
  }
  return rows.join('\n');
}

// What the whatdid recorder saw in this run: tool calls, and whether Claude used the repo map.
export function whatdidActivity(home) {
  let tools = 0, mapUsed = false;
  let files = [];
  try { files = fs.readdirSync(path.join(home, 'sessions')).filter((f) => f.endsWith('.jsonl')); } catch {}
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(home, 'sessions', f), 'utf8').split('\n')) {
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      if (e.ev !== 'tool') continue;
      tools++;
      if ((e.kind === 'skill' && /map/.test(e.target || '')) || /map\.mjs|repo-map|\.whatdid[\\/]maps?/.test(`${e.detail || ''} ${e.target || ''}`)) mapUsed = true;
    }
  }
  return { tools: files.length ? tools : null, mapUsed: files.length ? mapUsed : null };
}

function plan(o, tasks) {
  const runs = [];
  for (let rep = 1; rep <= o.reps; rep++) for (const t of tasks) for (const c of o.conditions) runs.push({ task: t, condition: c, rep });
  return runs;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 9).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return;
  }
  const { repos, tasks } = loadTasks(o.tasks);
  if (o.conditions.includes('whatdid-style')) {
    o.style ||= detectStyle();
    if (!o.style) {
      console.warn('warning: no output-styles/*.md in the plugin yet; dropping the whatdid-style condition.');
      o.conditions = o.conditions.filter((c) => c !== 'whatdid-style');
    }
  }
  const runs = plan(o, tasks);
  const perRun = EST_USD_PER_RUN[o.model] ?? EST_USD_PER_RUN.sonnet;

  if (o.dryRun) {
    console.log(`whatdid bench — dry run\nmodel=${o.model} reps=${o.reps} conditions=${o.conditions.join(',')} tasks=${tasks.length} runs=${runs.length}${o.style ? ` style=${o.style}` : ''}\n`);
    for (const r of runs) {
      const args = claudeArgs(r.task, r.condition, o).map((a) => (/\s/.test(a) ? JSON.stringify(a.length > 70 ? a.slice(0, 67) + '...' : a) : a));
      console.log(`[${r.task.id} · ${r.condition} · rep ${r.rep}] cwd=${path.join(CACHE, r.task.repo)}\n  claude ${args.join(' ')}`);
    }
    console.log(`\nEstimated cost: ~$${(runs.length * perRun).toFixed(2)} (≈$${perRun}/run for ${o.model}; hard cap $${(runs.length * o.budget).toFixed(2)} via --max-budget-usd ${o.budget}/run)`);
    return;
  }

  const bin = findClaude();
  fs.mkdirSync(o.out, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const base = path.join(o.out, `${stamp}-${o.model}`);
  const results = [];
  const version = spawnSync(bin, ['--version'], { encoding: 'utf8', shell: /\.(cmd|bat)$/i.test(bin) }).stdout?.trim();
  const save = () => {
    fs.writeFileSync(`${base}.json`, JSON.stringify({ date: new Date().toISOString(), model: o.model, claude: version, reps: o.reps, conditions: o.conditions, style: o.style, results }, null, 2));
    fs.writeFileSync(`${base}.md`, `# whatdid bench · ${o.model} · ${stamp}\n\nClaude Code ${version}. ${o.reps} rep(s). Input tokens = input + cache creation + cache read.\n\n${summarize(results, o.conditions)}\n`);
  };

  for (const [i, r] of runs.entries()) {
    const { task, condition, rep } = r;
    const dir = ensureRepo(task.repo, repos[task.repo]);
    resetRepo(dir, repos[task.repo].sha, task.setup);
    const pre = task.check.type === 'script' ? runCheck(task.check, { cwd: dir }).pass : null;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'whatdid-bench-'));
    process.stdout.write(`[${i + 1}/${runs.length}] ${task.id} · ${condition} · rep ${rep} … `);
    const t0 = Date.now();
    const { json, status, stderr } = runClaude(bin, claudeArgs(task, condition, o), dir, { ...process.env, WHATDID_HOME: home, WHATDID_AUTOMAP: condition === 'whatdid-automap' ? '1' : '0' });
    const m = metricsOf(json);
    const check = runCheck(task.check, { cwd: dir, resultText: json?.result });
    const wd = whatdidActivity(home);
    results.push({
      task: task.id, repo: task.repo, kind: task.kind, condition, rep, ...m,
      wall_ms: Date.now() - t0, pass: check.pass, check: check.how, pre_check_pass: pre,
      whatdid_tool_calls: wd.tools, map_used: wd.mapUsed, exit_status: status, stderr: json ? undefined : stderr,
      result_excerpt: String(json?.result || '').slice(0, 400),
    });
    console.log(`${check.pass ? 'PASS' : 'FAIL'} · ${fmtN(m.total_input_tokens)} in · ${fmtN(m.output_tokens)} out · $${m.cost_usd?.toFixed(3) ?? '?'}`);
    if (!o.keep) fs.rmSync(home, { recursive: true, force: true });
    save();
  }
  // Leave the cached repos clean.
  for (const key of new Set(runs.map((r) => r.task.repo))) resetRepo(path.join(CACHE, key), repos[key].sha);
  console.log(`\n${summarize(results, o.conditions)}\n\nWrote ${base}.json and ${base}.md`);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '')) {
  main().catch((e) => { console.error(`bench: ${e.message}`); process.exit(1); });
}
