#!/usr/bin/env node
// whatdid statusline: one live line saying what Claude is doing right now.
// Standalone on purpose (no imports): it is copied to ~/.whatdid/bin and run from user settings.
// If ~/.whatdid/config.json has {"wrap": "<previous statusline command>"}, that command's output comes first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HOME = process.env.WHATDID_HOME || path.join(os.homedir(), '.whatdid');
// Claude Code sets COLUMNS to the terminal width before running a statusline.
const COLS = Math.max(40, (Number(process.env.COLUMNS) || 120) - 2);
const DIM = '\x1b[2m', RESET = '\x1b[0m', CYAN = '\x1b[36m', RED = '\x1b[31m', BOLD = '\x1b[1m';

// Claude's narration types (see output-styles/whatdid.md), with a colour each.
const NOTES = {
  why: ['◆', '\x1b[36m'], plan: ['▸', '\x1b[35m'], found: ['◇', '\x1b[96m'], done: ['✔', '\x1b[32m'],
  failed: ['✘', '\x1b[31m'], risk: ['▲', '\x1b[33m'], need: ['◌', '\x1b[95m'],
};
const NOTE_RE = new RegExp(
  '^[ \\t>*_`-]*(?:[^\\p{L}\\p{N}\\s][ \\t]*)?[*_`]*(' + Object.keys(NOTES).join('|') + ')[*_`]*[ \\t]*[:·—–|][*_`]*[ \\t]*(.+?)[*_`\\s]*$',
  'gimu',
);

function tailJson(file, bytes) {
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  const start = Math.max(0, size - bytes);
  const buf = Buffer.alloc(size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  const lines = buf.toString('utf8').split('\n');
  if (start > 0) lines.shift();
  const out = [];
  for (const l of lines) { try { if (l.trim()) out.push(JSON.parse(l)); } catch {} }
  return out;
}

// Claude's most recent typed note in this turn, read from the tail of its transcript.
function latestNote(transcript, since) {
  if (!transcript || !fs.existsSync(transcript)) return null;
  let note = null;
  for (const l of tailJson(transcript, 131072)) {
    if (l.type !== 'assistant' || l.isSidechain || !(Date.parse(l.timestamp) >= since)) continue;
    for (const c of l.message?.content || []) {
      if (c.type !== 'text') continue;
      for (const m of String(c.text).matchAll(NOTE_RE)) note = { type: m[1].toLowerCase(), text: m[2].replace(/\*\*|`/g, '') };
    }
  }
  return note;
}

const VERB = {
  read: 'reading', search: 'searching', edit: 'editing', write: 'writing', run: 'running',
  web: 'researching', agent: 'delegating to', skill: 'using skill', mcp: 'calling', plan: 'planning', ask: 'asking you', other: 'using',
};

function tail(file, bytes = 65536) {
  return tailJson(file, bytes).sort((a, b) => (a.t || 0) - (b.t || 0));
}

// Untrusted text (file names, commands, Claude's words) must not smuggle terminal escape sequences.
const clean = (s) => String(s ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
const short = (s, n = 36) => {
  s = clean(s);
  if (s.length <= n) return s;
  const base = s.split('/').pop();
  return base.length <= n ? '…/' + base : s.slice(0, n - 1) + '…';
};

function ours(input) {
  const id = String(input.session_id || '').replace(/[^A-Za-z0-9_-]/g, '_');
  const file = path.join(HOME, 'sessions', `${id}.jsonl`);
  if (!id || !fs.existsSync(file)) return [`${CYAN}◆ what did${RESET}${DIM} · type wd to explain${RESET}`];
  const ev = tail(file);
  let i = ev.length - 1;
  while (i >= 0 && ev[i].ev !== 'prompt') i--;
  const turn = ev.slice(i + 1);
  const tools = turn.filter((e) => e.ev === 'tool');
  const changed = new Set(tools.filter((e) => e.kind === 'edit' || e.kind === 'write').map((e) => e.target));
  const fails = tools.filter((e) => e.ok === false && !(e.kind === 'read' && e.target === '.')).length;
  // Session start/resume events say nothing about whether the turn is still running.
  const last = [...turn].reverse().find((e) => e.ev !== 'start');
  const done = !last || last.ev === 'stop';

  const since = i >= 0 ? ev[i].t : 0;
  let note = null;
  try { note = latestNote(input.transcript_path, since); } catch {}
  const parts = [];
  if (done) {
    parts.push(tools.length ? `done · ${tools.length} steps` : 'idle');
  } else {
    const cur = [...turn].reverse().find((e) => e.ev === 'pre' || e.ev === 'tool');
    parts.push(`step ${tools.length + 1}`);
    if (cur) parts.push(`${VERB[cur.kind] || 'using'} ${short(cur.why || cur.target || cur.detail || cur.tool, Math.max(36, COLS - 60))}`);
  }
  if (changed.size) parts.push(`${changed.size} file${changed.size > 1 ? 's' : ''} changed`);
  if (fails) parts.push(`${RED}${fails} failed${RESET}`);
  parts.push(`${DIM}wd explains${RESET}`);
  const status = parts.join(`${DIM} · ${RESET}`);
  if (!note) return [`${CYAN}◆${RESET}${DIM} · ${RESET}${status}`];

  // Claude's note in full: on the same row when it fits, else on rows of its own above the status.
  const [glyph, color] = NOTES[note.type];
  const head = `${color}${glyph} ${BOLD}${note.type}${RESET} `;
  const text = clean(note.text).replace(/\s+/g, ' ').trim();
  const headLen = note.type.length + 3;
  if (headLen + text.length + 3 + visible(status) <= COLS) return [`${head}${text}${DIM} · ${RESET}${status}`];
  return [...wrapText(text, COLS - headLen, 3).map((l, k) => (k ? ' '.repeat(headLen) : head) + l), status];
}

const visible = (s) => s.replace(/\x1b\[[0-9;]*m/g, '').length;

// Splits text into at most `max` rows of `width` characters at spaces; the last row ends in … if text is left over.
function wrapText(text, width, max) {
  const rows = [];
  let rest = text;
  while (rest && rows.length < max) {
    if (rest.length <= width) { rows.push(rest); rest = ''; break; }
    let cut = rest.lastIndexOf(' ', width);
    if (cut < width / 2) cut = width;
    rows.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) rows[rows.length - 1] = rows[rows.length - 1].slice(0, width - 1).trimEnd() + '…';
  return rows;
}

function wrapped(raw) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(HOME, 'config.json'), 'utf8')); } catch {}
  if (!cfg.wrap) return '';
  const r = spawnSync(cfg.wrap, { input: raw, shell: true, encoding: 'utf8', timeout: 2000, windowsHide: true });
  return (r.stdout || '').replace(/\s+$/, '');
}

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch {}
let input = {};
try { input = JSON.parse(raw); } catch {}
let lines;
try { lines = ours(input); } catch { lines = [`${CYAN}◆ what did${RESET}`]; }
// The previous statusline keeps its own rows; what did goes on the rows below, so neither gets cut off.
const prev = wrapped(raw);
process.stdout.write([prev, ...lines].filter(Boolean).join('\n'));
