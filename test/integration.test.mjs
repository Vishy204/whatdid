import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.WHATDID_PANE = '0'; // never open real side panes from tests

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'whatdid-int-'));
process.env.WHATDID_HOME = path.join(TMP, 'home');

const { importChains, render } = await import('../scripts/render.mjs');

// A tiny app: routes -> guard -> session, plus an unrelated util.
const REPO = path.join(TMP, 'repo');
const files = {
  'src/routes.js': "import { guard } from './auth/guard.js';\nexport const routes = { '/': guard };\n",
  'src/auth/guard.js': "import { isExpired } from './session.js';\nexport function guard(req) { return !isExpired(req.session); }\n",
  'src/auth/session.js': 'export function isExpired(s) { return s.expiresAt < Date.now(); }\n',
  'src/util.js': 'export const noop = () => {};\n',
};
for (const [f, body] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(REPO, f)), { recursive: true });
  fs.writeFileSync(path.join(REPO, f), body);
}

const tool = (kind, target, extra = {}) => ({ ev: 'tool', t: Date.now(), tool: kind === 'read' ? 'Read' : 'Edit', kind, target, ...extra });

test('importChains draws the path through the edited file', () => {
  const tools = [tool('read', 'src/routes.js'), tool('read', 'src/auth/guard.js'), tool('read', 'src/auth/session.js'), tool('edit', 'src/auth/session.js', { add: 1, del: 1 }), tool('read', 'src/util.js')];
  const chains = importChains(REPO, tools);
  assert.deepEqual(chains, ['routes.js ──▶ guard.js ──▶ session.js [edited]']);
});

test('importChains is empty when touched files do not import each other', () => {
  assert.deepEqual(importChains(REPO, [tool('read', 'src/util.js'), tool('read', 'src/routes.js')]), []);
});

test('?? output includes "How it connects" using the recorded cwd', () => {
  const t0 = Date.now();
  const events = [
    { t: t0, ev: 'prompt', cwd: REPO, text: 'fix login' },
    { ...tool('read', 'src/routes.js'), t: t0 + 1 },
    { ...tool('read', 'src/auth/guard.js'), t: t0 + 2 },
    { ...tool('edit', 'src/auth/session.js', { add: 2, del: 1 }), t: t0 + 3 },
    { t: t0 + 4, ev: 'stop' },
  ];
  const text = render(events, { transcript: null });
  assert.match(text, /How it connects/);
  assert.match(text, /routes\.js ──▶ guard\.js ──▶ session\.js \[edited\]/);
});

test('?? map answers from the hook without calling the model', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/record.mjs')], {
    input: JSON.stringify({ session_id: 's1', cwd: REPO, hook_event_name: 'UserPromptSubmit', prompt: '?? map' }),
    env: { ...process.env, WHATDID_HOME: path.join(TMP, 'home') },
    encoding: 'utf8',
  });
  const res = JSON.parse(r.stdout);
  assert.equal(res.decision, 'block');
  assert.match(res.reason, /session\.js/);
  assert.match(res.reason, /isExpired/);
});

test('"?? why did you do that" is passed through to Claude, not intercepted', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/record.mjs')], {
    input: JSON.stringify({ session_id: 's1', cwd: REPO, hook_event_name: 'UserPromptSubmit', prompt: '?? why did you do that' }),
    env: { ...process.env, WHATDID_HOME: path.join(TMP, 'home') },
    encoding: 'utf8',
  });
  assert.equal(r.stdout, '');
});

test('auto-map: SessionStart injects the repo map only when enabled', () => {
  const run = (automap) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/record.mjs')], {
    input: JSON.stringify({ session_id: 's2', cwd: REPO, hook_event_name: 'SessionStart', source: 'startup' }),
    env: { ...process.env, WHATDID_HOME: path.join(TMP, 'home'), WHATDID_AUTOMAP: automap, WHATDID_WELCOME: '0' },
    encoding: 'utf8',
  }).stdout;
  assert.equal(run('0'), '');
  const out = JSON.parse(run('1'));
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(out.hookSpecificOutput.additionalContext, /isExpired/);
});

test('"wd" triggers work (easy to type: Claude Code opens its shortcuts panel on "?")', () => {
  const ask = (prompt) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/record.mjs')], {
    input: JSON.stringify({ session_id: 's1', cwd: REPO, hook_event_name: 'UserPromptSubmit', prompt }),
    env: { ...process.env, WHATDID_HOME: path.join(TMP, 'home') },
    encoding: 'utf8',
  }).stdout;
  for (const p of ['wd', 'WD', ' wd ', 'wd help', 'wd map', ' ?? help']) {
    assert.equal(JSON.parse(ask(p)).decision, 'block', p);
  }
  // Real prompts that merely start with "wd" still go to Claude.
  for (const p of ['gbx', 'wd please fix the build', 'wd.js is broken']) assert.equal(ask(p), '', p);
});

test('auto card: Stop prints a one-line summary only when enabled', () => {
  const home = path.join(TMP, 'home-card');
  const hook = (payload, auto) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/record.mjs')], {
    input: JSON.stringify({ session_id: 'card', cwd: REPO, ...payload }),
    env: { ...process.env, WHATDID_HOME: home, WHATDID_AUTO: auto },
    encoding: 'utf8',
  }).stdout;
  hook({ hook_event_name: 'UserPromptSubmit', prompt: 'fix it' }, '0');
  hook({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(REPO, 'src/auth/session.js'), old_string: 'a', new_string: 'a\nb' } }, '0');
  hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'node test.mjs' } }, '0');
  assert.equal(hook({ hook_event_name: 'Stop' }, '0'), '');
  const card = JSON.parse(hook({ hook_event_name: 'Stop' }, '1')).systemMessage;
  // The duration only appears once a turn takes a second or more, which a slow CI box can hit.
  assert.equal(card.replace(/ · \d+s(?= ·)/, ''), '◆ what did · 2 steps · changed session.js +2 −1 · ✔ node test.mjs · type wd');
});

test('welcome: the first 3 new sessions show a zero-token hint, then it stays quiet', () => {
  const home = path.join(TMP, 'home-welcome');
  const start = (source = 'startup') => spawnSync(process.execPath, [path.join(ROOT, 'scripts/record.mjs')], {
    input: JSON.stringify({ session_id: 'w', cwd: REPO, hook_event_name: 'SessionStart', source }),
    env: { ...process.env, WHATDID_HOME: home, WHATDID_AUTOMAP: '0', WHATDID_WELCOME: '' },
    encoding: 'utf8',
  }).stdout;
  assert.equal(start('resume'), '', 'resumed sessions never show it');
  for (let i = 0; i < 3; i++) assert.match(JSON.parse(start()).systemMessage, /type wd/);
  assert.equal(start(), '');
});

test('auto card is on by default and can be turned off in config', () => {
  const home = path.join(TMP, 'home-default-card');
  const run = (payload) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/record.mjs')], {
    input: JSON.stringify({ session_id: 'd', cwd: REPO, ...payload }),
    env: { ...process.env, WHATDID_HOME: home, WHATDID_AUTO: '' },
    encoding: 'utf8',
  }).stdout;
  run({ hook_event_name: 'UserPromptSubmit', prompt: 'go' });
  run({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: path.join(REPO, 'src/util.js') } });
  assert.match(JSON.parse(run({ hook_event_name: 'Stop' })).systemMessage, /^◆ what did · 1 step/);
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ autoCard: false }));
  assert.equal(run({ hook_event_name: 'Stop' }), '');
});

test('auto-map is off by default; "auto" preloads the map only when the codebase is large enough', () => {
  const home = path.join(TMP, 'home-am');
  const start = (min, automap = '') => spawnSync(process.execPath, [path.join(ROOT, 'scripts/record.mjs')], {
    input: JSON.stringify({ session_id: 'am', cwd: REPO, hook_event_name: 'SessionStart', source: 'startup' }),
    env: { ...process.env, WHATDID_HOME: home, WHATDID_AUTOMAP: automap, WHATDID_AUTOMAP_MIN: String(min), WHATDID_WELCOME: '0' },
    encoding: 'utf8',
  }).stdout;
  assert.equal(start(1), '', 'off by default, even for a repo above the threshold');
  assert.equal(start(1e9, 'auto'), '', 'a tiny repo stays below the threshold');
  assert.match(JSON.parse(start(1, 'auto')).hookSpecificOutput.additionalContext, /isExpired/);
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ autoMap: 'auto' }));
  assert.match(JSON.parse(start(1)).hookSpecificOutput.additionalContext, /isExpired/, 'setup automap auto');
});

test('a long turn ends with a desktop notification through terminalSequence', () => {
  const home = path.join(TMP, 'home-notify');
  const hook = (payload, env = {}) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/record.mjs')], {
    input: JSON.stringify({ session_id: 'n', cwd: REPO, ...payload }),
    env: { ...process.env, WHATDID_HOME: home, WHATDID_AUTO: '1', WHATDID_NOTIFY: '', WHATDID_NOTIFY_MIN_MS: '1', WT_SESSION: 'x', KITTY_WINDOW_ID: '', TERM_PROGRAM: '', ...env },
    encoding: 'utf8',
  }).stdout;
  hook({ hook_event_name: 'UserPromptSubmit', prompt: 'fix it' });
  hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npx whatdid doctor' } });
  const out = JSON.parse(hook({ hook_event_name: 'Stop' }));
  assert.match(out.systemMessage, /1 step/, 'a user command that mentions whatdid still counts');
  assert.match(out.terminalSequence, /^\x1b\]9;Claude finished: 1 step.*npx whatdid doctor\x07$/);
  assert.equal(JSON.parse(hook({ hook_event_name: 'Stop' }, { WHATDID_NOTIFY: '0' })).terminalSequence, undefined);
  assert.equal(JSON.parse(hook({ hook_event_name: 'Stop' }, { WHATDID_NOTIFY_MIN_MS: '3600000' })).terminalSequence, undefined, 'short turns stay quiet');
});

test('/whatdid:wd… commands are answered by the expansion hook, never by the model', () => {
  const expand = (command_name, args = []) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/record.mjs')], {
    input: JSON.stringify({ session_id: 'x', cwd: REPO, hook_event_name: 'UserPromptExpansion', command_name, arguments: args, expansion_type: 'skill' }),
    env: { ...process.env, WHATDID_HOME: path.join(TMP, 'home') },
    encoding: 'utf8',
  }).stdout;
  assert.match(JSON.parse(expand('whatdid:wd-help')).reason, /\/whatdid:wd-replay/);
  assert.match(JSON.parse(expand('whatdid:wd-map', ['src'])).reason, /isExpired/);
  assert.equal(JSON.parse(expand('whatdid:wd')).decision, 'block');
  assert.equal(expand('whatdid:explain'), '', 'the paid explain skill still reaches Claude');
  assert.equal(expand('someone-else:wd-x'), '');
  for (const f of ['wd', 'wd-replay', 'wd-map', 'wd-html', 'wd-help']) {
    assert.match(fs.readFileSync(path.join(ROOT, 'skills', f, 'SKILL.md'), 'utf8'), /disable-model-invocation: true/, f);
  }
});
