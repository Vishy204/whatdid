import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.WHATDID_PANE = '0'; // never open real side panes from tests

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'whatdid-render-'));
process.env.WHATDID_HOME = TMP;
process.env.WHATDID_NO_OPEN = '1';

const { render, parseArgs, parseRecap, parseWhys, parseNotes, transcriptInfo, renderHelp } = await import('../scripts/render.mjs');
const { renderHtml, flowchartSvg, writeReport } = await import('../scripts/html.mjs');
const { splitTurns, groupSteps } = await import('../scripts/render.mjs');

// A turn in memory: prompt at T0, then read/search/edit/run, with a fake transcript around it.
const T0 = Date.parse('2026-09-30T10:00:00Z');
const TRANSCRIPT = path.join(TMP, 'transcript.jsonl');
const events = [
  { t: T0 - 5000, ev: 'start', cwd: '/proj', transcript: TRANSCRIPT },
  { t: T0, ev: 'prompt', text: 'fix the "login" <redirect>', transcript: TRANSCRIPT },
  { t: T0 + 2000, ev: 'tool', id: 'a', tool: 'Grep', kind: 'search', target: 'src', detail: 'redirect' },
  { t: T0 + 3000, ev: 'tool', id: 'b', tool: 'Read', kind: 'read', target: 'src/auth/guard.js' },
  { t: T0 + 4000, ev: 'tool', id: 'c', tool: 'Read', kind: 'read', target: 'src/auth/session.js' },
  { t: T0 + 9000, ev: 'tool', id: 'd', tool: 'Edit', kind: 'edit', target: 'src/auth/session.js', add: 1, del: 1 },
  { t: T0 + 12000, ev: 'tool', id: 'e', tool: 'Bash', kind: 'run', detail: 'node test.mjs', why: 'Run the tests', ok: false },
  { t: T0 + 75000, ev: 'stop' },
];

const msg = (sec, id, text, usage) => JSON.stringify({
  type: 'assistant', timestamp: new Date(T0 + sec * 1000).toISOString(),
  message: { id, content: [{ type: 'text', text }], usage },
});
fs.writeFileSync(TRANSCRIPT, [
  msg(1, 'm1', "I'll help with that.\nwhy: find where the redirect decision happens", { output_tokens: 1200, input_tokens: 10, cache_read_input_tokens: 30000 }),
  msg(8, 'm2', '**why:** fix the expiry check that compares seconds to ms', { output_tokens: 300, input_tokens: 10, cache_read_input_tokens: 31000 }),
  msg(70, 'm3', 'Fixed.\n\nrecap:\n- changed: session expiry check in session.js\n- verified: test still fails, see output\n- left: **decide** on clock skew', { output_tokens: 100 }),
].join('\n'));

test('parseWhys tolerates markdown decoration', () => {
  assert.deepEqual(parseWhys('why: a b c\n> **why:** d e\ntext\n- why: f'), ['a b c', 'd e', 'f']);
});

test('parseRecap extracts bullets and returns the remaining text', () => {
  const r = parseRecap('Done here.\nrecap:\n- one\n* two\n3. three\n\nAfter text.');
  assert.deepEqual(r.bullets.map((b) => b.text), ['one', 'two', 'three']);
  assert.match(r.rest, /Done here\./);
  assert.match(r.rest, /After text\./);
  assert.ok(!/- one|two|three/.test(r.rest));
  assert.deepEqual(parseRecap('recap: changed x; verified y').bullets.map((b) => b.text), ['changed x', 'verified y']);
  // The styled form: bold label, glyphs, "·" separators.
  const styled = parseRecap('**recap**\n- ✎ **changed** · `session.js` compares ms\n- ✔ **verified** · tests pass\n- ○ **left** · nothing');
  assert.deepEqual(styled.bullets, [
    { label: 'changed', text: 'session.js compares ms' }, { label: 'verified', text: 'tests pass' }, { label: 'left', text: 'nothing' },
  ]);
});

test('transcriptInfo prefers why: lines, collects recap and tokens', () => {
  const tx = transcriptInfo(TRANSCRIPT, T0, T0 + 75000);
  assert.equal(tx.styled, true);
  assert.deepEqual(tx.notes.map((n) => [n.type, n.text]), [['why', 'find where the redirect decision happens'], ['why', 'fix the expiry check that compares seconds to ms']]);
  assert.deepEqual(tx.recap, [
    { label: 'changed', text: 'session expiry check in session.js' },
    { label: 'verified', text: 'test still fails, see output' },
    { label: 'left', text: 'decide on clock skew' },
  ]);
  assert.equal(tx.out, 1600);
});

test('map shows why notes and recap', () => {
  const text = render(events, {});
  assert.match(text, /Claude's notes/);
  assert.match(text, /◆ why +find where the redirect decision happens/);
  assert.match(text, /Recap\n│ {3}✎ changed +session expiry check/);
  // Something left over is flagged, not shown like "nothing to do".
  assert.match(text, /▲ left +decide on clock skew/);
  assert.match(text, /1\.6k tokens written/);
  assert.match(text, /1m15s/);
});

test('replay lists every call in order with offsets, marks and interleaved notes', () => {
  const text = render(events, { replay: true });
  const lines = text.split('\n');
  const idx = (re) => lines.findIndex((l) => re.test(l));
  assert.match(text, /what did replay · turn 1 of 1/);
  // Notes head the calls they introduced; the calls sit indented beneath them.
  const why1 = idx(/\+00:01 {2}◆ why +find where the redirect/);
  const grep = idx(/\+00:02 {5}✔ {2}Searched\s+"redirect" in src/);
  const read1 = idx(/\+00:03 {5}✔ {2}Read\s+src\/auth\/guard\.js/);
  const why2 = idx(/\+00:08 {2}◆ why +fix the expiry check/);
  const edit = idx(/\+00:09 {5}✔ {2}Edited\s+src\/auth\/session\.js {2}\+1 −1/);
  const run = idx(/\+00:12 {5}✘ {2}Ran\s+node test\.mjs {2}\(Run the tests\)/);
  for (const i of [why1, grep, read1, why2, edit, run]) assert.ok(i > 0, text);
  assert.ok(why1 < grep && grep < read1 && read1 < why2 && why2 < edit && edit < run, text);
  assert.match(text, /Recap/);
});

test('replay shows a call still in progress', () => {
  const running = [...events.slice(0, 3), { t: T0 + 2500, ev: 'pre', id: 'z', tool: 'Read', kind: 'read', target: 'src/x.js' }];
  const text = render(running, { replay: true, transcript: null });
  assert.match(text, /\+00:03 {2}… {2}Read\s+src\/x\.js/);
  assert.match(text, /still running/);
  assert.match(render(running, { transcript: null }), /now:\s+Read src\/x\.js/);
  // Once the turn stops, a call that never finished was denied or cancelled.
  const stopped = [...running, { t: T0 + 4000, ev: 'stop' }, { t: T0 + 90000, ev: 'start', source: 'resume' }];
  const text2 = render(stopped, { replay: true, transcript: null });
  assert.match(text2, /✘ {2}Read\s+src\/x\.js {2}\(not run: denied or cancelled\)/);
  assert.match(text2, /turn 1 of 1 · 4s ·/);
});

test('ascii replay has no box-drawing characters', () => {
  const text = render(events, { replay: true, ascii: true });
  assert.ok(!/[│┌└✔✘›−]/.test(text), text);
  assert.match(text, /FAIL {2}Ran/);
});

test('parseNotes reads every note type, styled or plain', () => {
  const text = [
    '▸ **plan** · reproduce, fix, then add a test',
    '◆ **why** · check how login decides a session has expired',
    '◇ **found** · `expiresAt` is seconds, compared with milliseconds',
    '✔ **done** · all 14 auth tests pass',
    '✘ **failed** · migration timed out; retrying with batches',
    '▲ **risk** · this deletes cached sessions',
    '◌ **need** · keep old tokens valid for a day?',
    'why: plain form still works',
    'Just a sentence about why this matters.',
  ].join('\n\n');
  const notes = parseNotes(text);
  assert.deepEqual(notes.map((n) => n.type), ['plan', 'why', 'found', 'done', 'failed', 'risk', 'need', 'why']);
  assert.equal(notes[2].text, 'expiresAt is seconds, compared with milliseconds');
});

test('ascii mode swaps note glyphs for plain characters', () => {
  const t = render(events, { ascii: true });
  assert.match(t, /\* why +find where the redirect/);
  assert.match(t, /~ changed +session expiry check/);
});

test('help card lists every wd variant', () => {
  const text = renderHelp();
  for (const v of ['wd 3', 'wd all', 'wd replay', 'wd html', 'wd map', 'wd help', '/wd-replay', '/wd-map']) assert.ok(text.includes(v), v);
  assert.equal(render([], { help: true }), text);
});

test('parseArgs flags unknown words so real questions are not intercepted', () => {
  assert.deepEqual(parseArgs(['replay', '2']), { unknown: [], replay: true, last: 2 });
  assert.deepEqual(parseArgs(['why', 'did', 'you']).unknown, ['why', 'did', 'you']);
  assert.equal(parseArgs(['html']).html, true);
});

test('the flowchart is plain SVG with escaped labels, one box per step and a line per file', () => {
  const turn = splitTurns(events).find((t) => t.prompt);
  const svg = flowchartSvg(turn);
  assert.match(svg, /^<svg class="flow" viewBox="0 0 860 \d+"/);
  assert.match(svg, /You asked: fix the &quot;login&quot; &lt;redirect&gt;/);
  assert.ok(!svg.includes('<redirect>'));
  assert.equal((svg.match(/class="fc-step/g) || []).length, groupSteps(turn.tools).length);
  assert.ok(svg.includes('class="fc-read"') && svg.includes('class="fc-write"'));
  assert.ok(!/<script|on\w+=/i.test(svg));
});

test('html report is self-contained, escaped, and has light/dark themes', () => {
  const html = renderHtml(events, {});
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>what did · session report<\/title>/);
  assert.match(html, /<svg class="flow"/);
  assert.match(html, /<h3>Health<\/h3>/);
  assert.ok(!/<script|https?:\/\//i.test(html.replace(/https:\/\/github\.com[^"<]*/g, '')), 'no scripts and nothing loaded from the network');
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /<p class="ask">fix the &quot;login&quot; &lt;redirect&gt;<\/p>/);
  assert.ok(!html.includes('<redirect>'));
  assert.equal((html.match(/<section class="turn" id=/g) || []).length, 1);
  assert.match(html, /Recap/);
  const out = writeReport(path.join(TMP, 'sessions', 'abc.jsonl'), events, {});
  assert.equal(out, path.join(TMP, 'reports', 'abc.html'));
  assert.ok(fs.existsSync(out));
});

function hook(payload) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/record.mjs')], {
    input: JSON.stringify({ session_id: 'rs', cwd: '/proj', transcript_path: TRANSCRIPT, ...payload }),
    env: { ...process.env, WHATDID_HOME: TMP, WHATDID_NO_OPEN: '1' }, encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test('?? variants through the hook: replay, html, help, and real questions pass through', () => {
  hook({ hook_event_name: 'UserPromptSubmit', prompt: 'fix it' });
  hook({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/proj/a.js' } });
  hook({ hook_event_name: 'Stop' });

  assert.match(JSON.parse(hook({ hook_event_name: 'UserPromptSubmit', prompt: '?? replay' })).reason, /what did replay/);
  assert.match(JSON.parse(hook({ hook_event_name: 'UserPromptSubmit', prompt: '?? help' })).reason, /wd replay/);
  const html = JSON.parse(hook({ hook_event_name: 'UserPromptSubmit', prompt: '?? html' })).reason;
  assert.match(html, /what did report written:/);
  assert.ok(fs.existsSync(path.join(TMP, 'reports', 'rs.html')));

  // A question that starts with ?? goes to Claude and is recorded as a normal prompt.
  assert.equal(hook({ hook_event_name: 'UserPromptSubmit', prompt: '?? why did you edit a.js' }), '');
  const log = fs.readFileSync(path.join(TMP, 'sessions', 'rs.jsonl'), 'utf8');
  assert.match(log, /why did you edit a\.js/);
});

test('notification sequences never carry control characters and match the terminal', async () => {
  const { notifySequence } = await import('../scripts/lib.mjs');
  assert.equal(notifySequence('a', 'b;c\x1b[31m\nd', {}), '\x1b]9;a: b c [31m d\x07');
  assert.equal(notifySequence('a', 'b', { TERM_PROGRAM: 'ghostty' }), '\x1b]777;notify;a;b\x07');
  assert.equal(notifySequence('a', 'b', { KITTY_WINDOW_ID: '1' }), '\x1b]99;;a: b\x1b\\');
});

test('wd opens a side pane only in terminals that can split, with the right command', async () => {
  const { paneCommand } = await import('../scripts/pane.mjs');
  const wt = paneCommand('job.json', { WT_SESSION: '1' }, 'win32', 'node');
  assert.equal(wt.cmd, 'wt.exe');
  assert.deepEqual(wt.args.slice(0, 4), ['-w', '0', 'split-pane', '-H']);
  assert.deepEqual(wt.args.slice(-1), ['job.json']);
  assert.match(paneCommand("it's.json", { TMUX: '1' }, 'linux', 'node').args.at(-1), /^node \S+pane\.mjs'? 'it'\\''s\.json'$/);
  assert.equal(paneCommand('j', { WEZTERM_PANE: '3' }, 'darwin', 'node').cmd, 'wezterm');
  assert.equal(paneCommand('j', { TERM_PROGRAM: 'iTerm.app' }, 'darwin', 'node').cmd, 'osascript');
  assert.equal(paneCommand('j', {}, 'linux', 'node'), null, 'plain terminals print inline');
  assert.equal(paneCommand('j', { WT_SESSION: '1' }, 'linux', 'node'), null, 'WT_SESSION leaks into WSL; wt.exe is not there');
});

test('colorize paints the same palette as the README GIFs and keeps the text', async () => {
  const { colorize } = await import('../scripts/colorize.mjs');
  const line = '│   ◆ why  check the guard · session.ts +3 −2';
  const out = colorize(line);
  assert.equal(out.replace(/\x1b\[[\d;]*m/g, ''), line);
  assert.match(out, /38;2;53;224;197m◆/);
  assert.match(out, /38;2;90;208;122m\+3/);
  assert.match(out, /38;2;255;107;107m−2/);
});

test('wd map in a folder of many projects lists them instead of mixing them', async () => {
  const { mapView } = await import('../scripts/map.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-multi-'));
  for (const p of ['a', 'b/c']) { fs.mkdirSync(path.join(root, p), { recursive: true }); fs.writeFileSync(path.join(root, p, 'package.json'), '{}'); fs.writeFileSync(path.join(root, p, 'x.js'), 'export const x = 1;'); }
  const text = mapView(root);
  assert.match(text, /holds 2 projects/);
  assert.match(text, /^ {2}b\/c$/m);
  assert.match(mapView(root, 'a'), /# Repo map: a/);
  assert.match(mapView(root, 'nope'), /no folder "nope"/);
  const notes = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-notes-'));
  fs.writeFileSync(path.join(notes, 'notes.md'), '# just notes');
  assert.match(mapView(notes), /no code to map[\s\S]*Open Claude Code in your project folder/);
  fs.mkdirSync(path.join(notes, 'app'));
  fs.writeFileSync(path.join(notes, 'app', 'package.json'), '{}');
  fs.writeFileSync(path.join(notes, 'app', 'i.js'), 'export const i = 1;');
  assert.match(mapView(notes), /# Repo map/, 'one project inside is simply mapped');
});

test('health: tests passed or failing, failures fixed later, and what is still unresolved', async () => {
  const { healthOf } = await import('../scripts/render.mjs');
  const t0 = 1_000_000;
  const run = (detail, ok, extra = {}) => ({ ev: 'tool', kind: 'run', tool: 'Bash', detail, ok, ...extra });
  const turn = (tools) => ({ tools: tools.map((e, i) => ({ t: t0 + i, ...e })) });
  let h = healthOf(turn([run('npm test', false), { ev: 'tool', kind: 'edit', tool: 'Edit', target: 'a.js', add: 2, del: 1, ok: true }, run('npm test -- auth', true)]));
  assert.deepEqual([h.tests.passed, h.tests.runs, h.failedCommands, h.unresolved.length, h.changed, h.add, h.del], [true, 2, 1, 0, 1, 2, 1]);
  h = healthOf(turn([run('pytest -q', false), run('npm run build', false), run('ls', true)]));
  assert.equal(h.tests.passed, false);
  assert.deepEqual(h.unresolved.map((e) => e.detail), ['pytest -q', 'npm run build']);
  h = healthOf(turn([run('ls', true)]));
  assert.equal(h.tests, null);
  assert.equal(healthOf(turn([run('make check', true)])).tests.passed, true);
  assert.equal(healthOf(turn([run('node x.mjs', true, { why: 'Run the unit tests' })])).tests.runs, 1);
});

test('wd diff shows the changed lines from Claude\'s transcript, redacted, with line numbers', async () => {
  const { renderDiff, viewText } = await import('../scripts/render.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-diff-'));
  const tx = path.join(dir, 't.jsonl');
  const at = (ms) => new Date(T0 + ms).toISOString();
  fs.writeFileSync(tx, [
    { type: 'user', timestamp: at(2000), toolUseResult: { type: 'update', filePath: '/repo/src/a.js',
      structuredPatch: [{ oldStart: 10, newStart: 10, lines: [' keep', '-const k = 1;', '+const k = 2;', '+const API_KEY = "sk-abcdefghijklmnopqrstuv";'] }] } },
    { type: 'user', timestamp: at(3000), toolUseResult: { type: 'create', filePath: '/repo/test/new.test.js', content: 'line1\nline2\n', structuredPatch: [] } },
    { type: 'user', timestamp: at(99_999_999), toolUseResult: { type: 'update', filePath: '/repo/other.js', structuredPatch: [{ oldStart: 1, newStart: 1, lines: ['+later turn'] }] } },
  ].map((x) => JSON.stringify(x)).join('\n'));
  const ev = [
    { t: T0, ev: 'prompt', cwd: '/repo', text: 'bump k', transcript: tx },
    { t: T0 + 2000, ev: 'tool', tool: 'Edit', kind: 'edit', target: 'src/a.js', add: 2, del: 1 },
    { t: T0 + 4000, ev: 'stop' },
  ];
  const text = renderDiff(ev, { transcript: tx });
  assert.match(text, /what did diff · turn 1 · 2 files changed \(\+4 −1\)/);
  assert.match(text, /› src\/a\.js {2}\(\+2 −1\)/);
  assert.match(text, /^│ {4}11 - const k = 1;$/m);
  assert.match(text, /^│ {4}11 \+ const k = 2;$/m);
  assert.match(text, /› test\/new\.test\.js {2}\(new file, \+2 −0\)/);
  assert.ok(!text.includes('sk-abcdef'), 'secrets in changed lines are redacted');
  assert.ok(!text.includes('later turn'), 'only the last turn');
  const job = path.join(dir, 's.jsonl');
  fs.writeFileSync(job, ev.map((e) => JSON.stringify(e)).join('\n'));
  assert.equal(viewText({ file: job, transcript: tx, opts: { unknown: [], diff: true } }, 100), renderDiff(ev, { transcript: tx, width: 100, unknown: [], diff: true }));
});

test('html: a prompt list jumps to each turn, the newest three open, and box text is never cut', () => {
  const ev = [];
  for (let i = 0; i < 5; i++) {
    ev.push({ t: T0 + i * 10_000, ev: 'prompt', cwd: '/r', text: `prompt number ${i + 1}` });
    ev.push({ t: T0 + i * 10_000 + 1, ev: 'tool', tool: 'Read', kind: 'read', target: 'src/deeply/nested/folder/structure/with/a/really/long/file-name-component.ts' });
    ev.push({ t: T0 + i * 10_000 + 2, ev: 'stop' });
  }
  const html = renderHtml(ev, { transcript: null });
  assert.match(html, /<nav id="prompts">/);
  const links = [...html.matchAll(/<a href="#turn-(\d+)">/g)].map((m) => Number(m[1]));
  assert.deepEqual(links, [5, 4, 3, 2, 1], 'newest first');
  assert.equal((html.match(/<section class="turn" id=/g) || []).length, 3);
  assert.ok(html.indexOf('id="turn-5"') < html.indexOf('id="turn-1"'), 'newest turn first on the page');
  // The long path is wrapped across lines inside its box, not cut with an ellipsis.
  const svg = flowchartSvg(splitTurns(ev)[0]);
  const shown = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join('');
  assert.ok(shown.replace(/\s/g, '').includes('file-name-component.ts'));
  assert.ok(!/…<\/text>/.test(svg));
  assert.match(svg, /<title>[^<]*file-name-component\.ts<\/title>/);
});
