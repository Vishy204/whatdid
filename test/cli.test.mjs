import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.WHATDID_PANE = '0'; // never open real side panes from tests

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'scripts/cli.mjs');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cli(args, { home, cwd, settings } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: cwd || ROOT,
    encoding: 'utf8',
    env: { ...process.env, WHATDID_HOME: home || tmp('gb-cli-'), WHATDID_CLAUDE_SETTINGS: settings || path.join(tmp('gb-set-'), 'settings.json') },
  });
}

test('help lists every command', () => {
  for (const args of [['--help'], ['help']]) {
    const r = cli(args);
    assert.equal(r.status, 0);
    for (const c of ['install', 'uninstall', 'explain', 'map', 'doctor']) assert.match(r.stdout, new RegExp(`\\b${c}\\b`));
  }
});

test('unknown command exits non-zero and shows help', () => {
  const r = cli(['frobnicate']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown command "frobnicate"/);
});

test('install adds the marketplace and the plugin (with a fake claude, never the real one)', () => {
  const dir = tmp('wd-fake-');
  const log = path.join(dir, 'calls.log');
  const fake = path.join(dir, 'claude.mjs');
  fs.writeFileSync(fake, `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n');`);
  const r = spawnSync(process.execPath, [CLI, 'install'], {
    encoding: 'utf8',
    env: { ...process.env, WHATDID_HOME: dir, WHATDID_CLAUDE_BIN: fake },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), [
    'plugin marketplace add Vishy204/whatdid',
    'plugin install whatdid@whatdid',
  ]);
});

test('doctor on a fresh home: logs writable, no sessions, statusline and plugin not installed', () => {
  const home = tmp('gb-doc-');
  const r = cli(['doctor'], { home });
  const out = r.stdout;
  assert.match(out, /✔ Node \d+/);
  assert.match(out, /✔ Session logs writable/);
  assert.match(out, /! No sessions recorded yet/);
  assert.match(out, /! Plugin not installed/);
  assert.match(out, /! Statusline not installed/);
});

test('doctor sees an enabled plugin, the statusline and recent activity', () => {
  const home = tmp('gb-doc2-');
  const setDir = tmp('gb-set2-');
  const settings = path.join(setDir, 'settings.json');
  fs.writeFileSync(settings, JSON.stringify({
    enabledPlugins: { 'whatdid@whatdid': true },
    statusLine: { type: 'command', command: `node "${home.replace(/\\/g, '/')}/.whatdid/bin/statusline.mjs"` },
  }));
  fs.mkdirSync(path.join(home, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, 'sessions', 's1.jsonl'), JSON.stringify({ t: Date.now(), ev: 'start', cwd: ROOT }) + '\n');
  const out = cli(['doctor'], { home, settings }).stdout;
  assert.match(out, /✔ Plugin enabled \(whatdid@whatdid\)/);
  assert.match(out, /✔ Statusline installed/);
  assert.match(out, /✔ Latest recorded activity just now/);
});

test('explain renders the newest session recorded in the current folder', () => {
  const home = tmp('gb-exp-');
  const proj = tmp('gb-proj-');
  const t = Date.now();
  const events = [
    { t, ev: 'start', cwd: proj },
    { t: t + 1, ev: 'prompt', cwd: proj, text: 'rename the helper' },
    { t: t + 2, ev: 'tool', tool: 'Read', kind: 'read', target: 'src/util.js' },
    { t: t + 3, ev: 'tool', tool: 'Edit', kind: 'edit', target: 'src/util.js', add: 2, del: 2 },
    { t: t + 4, ev: 'stop' },
  ];
  fs.mkdirSync(path.join(home, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, 'sessions', 'abc.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  const r = cli(['explain', '--no-transcript'], { home, cwd: proj });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /You asked: {2}"rename the helper"/);
  assert.match(r.stdout, /src\/util\.js/);
});

test('explain with no sessions says so instead of crashing', () => {
  const r = cli(['explain'], { home: tmp('gb-empty-'), cwd: tmp('gb-proj2-') });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /no sessions recorded yet/);
});

test('demo player is deterministic and needs no API', () => {
  const run = () => spawnSync(process.execPath, [path.join(ROOT, 'demo/play.mjs'), '2', '--ascii'], { encoding: 'utf8' }).stdout;
  const a = run();
  assert.equal(a, run());
  assert.match(a, /Logged-in users keep getting bounced/);
  assert.match(a, /FAIL/);
});

test('bench: flags, command lines, checks and summary table', async () => {
  const bench = await import('../bench/run.mjs');
  const o = bench.parseArgs(['--model', 'sonnet', '--tasks', 'ky-retry-explain', '--conditions', 'baseline,whatdid', '--reps', '2', '--dry-run']);
  assert.deepEqual([o.model, o.reps, o.conditions, o.tasks, o.dryRun], ['sonnet', 2, ['baseline', 'whatdid'], ['ky-retry-explain'], true]);
  assert.throws(() => bench.parseArgs(['--conditions', 'nope']), /unknown condition/);
  assert.throws(() => bench.loadTasks(['nope']), /unknown task/);

  const { tasks, repos } = bench.loadTasks();
  assert.ok(tasks.length >= 10);
  for (const t of tasks) {
    assert.ok(repos[t.repo]?.sha?.match(/^[0-9a-f]{40}$/), `${t.id} has a pinned sha`);
    if (t.check.type === 'script') assert.ok(fs.existsSync(path.join(ROOT, 'bench', t.check.file)), t.check.file);
  }

  const task = tasks[0];
  const base = bench.claudeArgs(task, 'baseline', { model: 'haiku', budget: 1 });
  const wd = bench.claudeArgs(task, 'whatdid', { model: 'haiku', budget: 1 });
  const styled = bench.claudeArgs(task, 'whatdid-style', { model: 'haiku', budget: 1, style: 'whatdid:whatdid' });
  assert.ok(!base.includes('--plugin-dir'));
  assert.ok(wd.includes('--plugin-dir') && !wd.includes('--settings'));
  assert.ok(styled.includes('{"outputStyle":"whatdid:whatdid"}'));
  for (const a of [base, wd]) assert.ok(a.includes('--setting-sources') && a.includes('--strict-mcp-config'));

  assert.equal(bench.runCheck({ type: 'rubric', all: ['TimeoutError'], any: ['AbortSignal', 'setTimeout'] }, { resultText: 'throws a TimeoutError via setTimeout' }).pass, true);
  assert.equal(bench.runCheck({ type: 'rubric', all: ['TimeoutError'] }, { resultText: 'no idea' }).pass, false);

  const m = bench.metricsOf({ usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50 }, total_cost_usd: 0.01, duration_ms: 2000, num_turns: 3, is_error: false });
  assert.equal(m.total_input_tokens, 1110);
  assert.equal(bench.median([3, 1, 2]), 2);
  assert.equal(bench.median([1, 2, 3, 4]), 2.5);

  const gbHome = tmp('gb-act-');
  fs.mkdirSync(path.join(gbHome, 'sessions'));
  fs.writeFileSync(path.join(gbHome, 'sessions', 'r.jsonl'), [
    { ev: 'tool', kind: 'skill', target: 'whatdid:map' },
    { ev: 'tool', kind: 'read', target: 'a.ts' },
  ].map((e) => JSON.stringify(e)).join('\n'));
  assert.deepEqual(bench.whatdidActivity(gbHome), { tools: 2, mapUsed: true });
  assert.deepEqual(bench.whatdidActivity(tmp('gb-none-')), { tools: null, mapUsed: null });

  const rows = [
    { task: 'x', condition: 'baseline', total_input_tokens: 10000, output_tokens: 1000, cost_usd: 0.1, duration_ms: 1000, num_turns: 5, pass: true },
    { task: 'x', condition: 'whatdid', total_input_tokens: 5000, output_tokens: 1000, cost_usd: 0.05, duration_ms: 1000, num_turns: 3, pass: true },
  ];
  const md = bench.summarize(rows, ['baseline', 'whatdid']);
  assert.match(md, /\| x \| whatdid \| 1 \| 1\/1 \| 5\.0k \(-50%\)/);
  assert.match(md, /\| whatdid \| 1\/1 \| 5\.0k \(-50%\) \| 1\.0k \(\+0%\) \| 0\.050 \(-50%\) \|/);
});

test('bench/local.mjs is read-only and grades answers by expected words', async () => {
  const local = await import('../bench/local.mjs');
  const o = local.parseArgs(['repo', 'q.json', '--reps', '3', '--conditions', 'baseline,whatdid-automap']);
  assert.deepEqual([o.repo, o.questions, o.reps, o.conditions], ['repo', 'q.json', 3, ['baseline', 'whatdid-automap']]);
  const args = local.readOnlyArgs({ prompt: 'q' }, 'whatdid-automap', o);
  const allowed = args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--disallowedTools'));
  assert.deepEqual(allowed, ['Read', 'Grep', 'Glob', 'Skill']);
  for (const t of ['Edit', 'Write', 'Bash']) assert.ok(args.slice(args.indexOf('--disallowedTools')).includes(t));
  assert.ok(args.includes('--plugin-dir'));
  assert.ok(!local.readOnlyArgs({ prompt: 'q' }, 'baseline', o).includes('--plugin-dir'));
  assert.deepEqual(local.grade({ expect: ['auth.py', 'decode'], min: 1 }, 'see Auth.py'), { pass: true, hits: '1/2' });
  assert.deepEqual(local.grade({ expect: ['a', 'b'] }, 'only a'), { pass: false, hits: '1/2' });
});

test('bench/large suites pin a public repo and grade every question', async () => {
  const local = await import('../bench/local.mjs');
  const o = local.parseArgs(['bench/large/hugo.json']);
  assert.deepEqual([o.repo, o.questions], [null, 'bench/large/hugo.json']);
  const dir = path.join(ROOT, 'bench', 'large');
  for (const f of fs.readdirSync(dir)) {
    const { repo, questions } = local.loadQuestions(path.join(dir, f));
    assert.match(repo.url, /^https:\/\/github\.com\//, f);
    assert.match(repo.sha, /^[0-9a-f]{40}$/, f);
    for (const q of questions) assert.ok(q.expect.length >= (q.min || 1) && /Do not modify/.test(q.prompt), q.id);
  }
  assert.deepEqual(local.loadQuestions(path.join(ROOT, 'bench', 'local-questions.example.json')).repo, undefined);
});
