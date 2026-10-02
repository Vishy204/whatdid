import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.WHATDID_PANE = '0'; // never open real side panes from tests

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'whatdid-'));
process.env.WHATDID_HOME = TMP;

const lib = await import('../scripts/lib.mjs');
const { summarizeTool, redact, relPath, readEvents, sessionFile } = lib;
const { render, compressPaths } = await import('../scripts/render.mjs');

const CWD = process.platform === 'win32' ? 'C:\\proj' : '/proj';
const P = (rel) => path.join(CWD, rel);
const SID = 'test-session';

function hook(payload, extraEnv = {}) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/record.mjs')], {
    input: JSON.stringify({ session_id: SID, cwd: CWD, transcript_path: path.join(TMP, 'transcript.jsonl'), ...payload }),
    env: { ...process.env, WHATDID_HOME: TMP, ...extraEnv },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test('relPath makes paths repo-relative with forward slashes', () => {
  assert.equal(relPath(P('src/auth/session.ts'), CWD), 'src/auth/session.ts');
  assert.equal(relPath(CWD, CWD), '.');
});

test('redact hides common secrets', () => {
  const s = redact('curl -H "Authorization: Bearer abcdefghijklmnop123" API_KEY=hunter2 sk-abcdefghijklmnopqrstuv');
  assert.ok(!s.includes('hunter2'));
  assert.ok(!s.includes('abcdefghijklmnop123'));
  assert.ok(!s.includes('sk-abcdefghijklmnopqrstuv'));
});

test('summarizeTool counts edit lines and never stores contents', () => {
  const e = summarizeTool('Edit', { file_path: P('a.ts'), old_string: 'x\ny', new_string: 'x\ny\nz' }, {}, CWD);
  assert.deepEqual(e, { tool: 'Edit', kind: 'edit', target: 'a.ts', add: 3, del: 2 });
  const w = summarizeTool('Write', { file_path: P('b.ts'), content: 'secret\ncontent' }, { type: 'create' }, CWD);
  assert.equal(w.created, true);
  assert.ok(!JSON.stringify(w).includes('secret'));
});

test('tidyCommand drops cd-into-project and shortens project paths', () => {
  const { tidyCommand } = lib;
  assert.equal(tidyCommand(`cd "${CWD}" && node test.mjs`, CWD), 'node test.mjs');
  assert.equal(tidyCommand(`node "${P('src/x.js')}"`, CWD).replace(/\\/g, '/'), 'node "./src/x.js"');
  assert.equal(tidyCommand('npm test', CWD), 'npm test');
});

test('compressPaths collapses 3+ files in one directory', () => {
  assert.equal(compressPaths(['src/a.ts', 'src/b.ts', 'src/c.ts', 'x.md']), 'src/ (3 files), x.md');
});

test('end to end: hooks record a turn and ?? renders it without calling the model', () => {
  fs.writeFileSync(path.join(TMP, 'transcript.jsonl'), '');
  hook({ hook_event_name: 'SessionStart', source: 'startup' });
  hook({ hook_event_name: 'UserPromptSubmit', prompt: 'fix the login redirect' });
  hook({ hook_event_name: 'PostToolUse', tool_name: 'Grep', tool_input: { pattern: 'redirect', path: P('src') } });
  hook({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: P('src/routes.ts') } });
  hook({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: P('src/auth/guard.ts') } });
  hook({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: P('src/auth/session.ts') } });
  hook({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: P('src/auth/session.ts'), old_string: 'a', new_string: 'a\nb\nc' } });
  hook({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'npm test', description: 'Run test suite' } });
  hook({ hook_event_name: 'Stop' });

  const events = readEvents(sessionFile(SID));
  assert.equal(events.filter((e) => e.ev === 'tool').length, 6);

  const out = hook({ hook_event_name: 'UserPromptSubmit', prompt: '??' });
  const res = JSON.parse(out);
  assert.equal(res.decision, 'block');
  const text = res.reason;
  assert.match(text, /You asked: {2}"fix the login redirect"/);
  assert.match(text, /Looked at\s+searched "redirect"|Looked at .*src\/routes\.ts/);
  assert.match(text, /Changed\s+src\/auth\/session\.ts \(\+3 −1\)/);
  assert.match(text, /Ran\s+✘ Run test suite: npm test/);
  assert.match(text, /session\.ts\s+R E\s+\+3 −1/);
  assert.match(text, /Heads up: 1 step failed/);
  // The magic prompt itself must not be recorded as a turn.
  assert.equal(readEvents(sessionFile(SID)).filter((e) => e.ev === 'prompt').length, 1);
});

test('render --ascii uses plain characters only', () => {
  const text = render(readEvents(sessionFile(SID)), { ascii: true, transcript: null });
  assert.ok(/^[\x00-\x7F…]*$/.test(text), text);
});

test('recorder survives garbage input', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/record.mjs')], { input: '{not json', encoding: 'utf8', env: { ...process.env, WHATDID_HOME: TMP } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('statusline reports progress and wraps an existing statusline', () => {
  fs.writeFileSync(path.join(TMP, 'config.json'), JSON.stringify({ wrap: `"${process.execPath}" -e "process.stdout.write('GSD')"` }));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/statusline.mjs')], {
    input: JSON.stringify({ session_id: SID }), encoding: 'utf8', env: { ...process.env, WHATDID_HOME: TMP },
  });
  const plain = r.stdout.replace(/\x1b\[[0-9;]*m/g, '');
  assert.equal(plain, 'GSD\n◆ · done · 6 steps · 1 file changed · 1 failed · wd explains', 'the old statusline keeps its own row');
});

test('statusline shows Claude\'s whole note, wrapped to the terminal width instead of cut off', () => {
  fs.rmSync(path.join(TMP, 'config.json'), { force: true });
  const note = 'expiresAt is stored in seconds but compared against Date.now() in milliseconds, so every session looks expired';
  const transcript = path.join(TMP, 'note-transcript.jsonl');
  fs.writeFileSync(transcript, JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { content: [{ type: 'text', text: `◇ found: ${note}` }] } }) + '\n');
  const run = (cols) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/statusline.mjs')], {
    input: JSON.stringify({ session_id: SID, transcript_path: transcript }), encoding: 'utf8', env: { ...process.env, WHATDID_HOME: TMP, COLUMNS: String(cols) },
  }).stdout.replace(/\x1b\[[0-9;]*m/g, '');
  const wide = run(300);
  assert.equal(wide.split('\n').length, 1);
  assert.ok(wide.includes(note), wide);
  const narrow = run(80).split('\n');
  assert.ok(narrow.length >= 3, narrow.join('\n'));
  for (const row of narrow) assert.ok(row.length <= 78, `fits 80 columns: ${row}`);
  assert.equal(narrow.slice(0, -1).map((l) => l.replace(/^(◇ found )?\s*/, '')).join(' '), note, 'nothing is cut');
  assert.match(narrow.at(-1), /^done · 6 steps/);
});

test('setup installs statusline, keeps the old one, and uninstall restores it', () => {
  const settings = path.join(TMP, 'settings.json');
  fs.writeFileSync(settings, JSON.stringify({ statusLine: { type: 'command', command: 'old-cmd' }, other: 1 }));
  fs.writeFileSync(path.join(TMP, 'config.json'), '{}');
  const env = { ...process.env, WHATDID_HOME: TMP, WHATDID_CLAUDE_SETTINGS: settings };
  spawnSync(process.execPath, [path.join(ROOT, 'scripts/setup.mjs'), 'statusline'], { env });
  let s = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.match(s.statusLine.command, /statusline\.mjs"$/);
  assert.equal(s.other, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(TMP, 'config.json'), 'utf8')).wrap, 'old-cmd');
  spawnSync(process.execPath, [path.join(ROOT, 'scripts/setup.mjs'), 'uninstall-statusline'], { env });
  s = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.equal(s.statusLine.command, 'old-cmd');
});
