#!/usr/bin/env node
// Turns a whatdid session log into a plain-English ASCII explanation. Deterministic: no model calls.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { findSession, readEvents, readJsonl, clip } from './lib.mjs';
import { importEdges, mapView } from './map.mjs';
import { writeReport, openInBrowser } from './html.mjs';
import { colorize } from './colorize.mjs';
import { diffsFor, diffLines } from './diff.mjs';

export const UNICODE = { tl: '┌', v: '│', bl: '└', h: '─', tee: '├─ ', last: '└─ ', pipe: '│  ', ok: '✔', fail: '✘', wait: '…', dot: '·', arrow: '→', uses: '──▶', bullet: '›', plus: '+', minus: '−' };
export const ASCII = { tl: '+', v: '|', bl: '+', h: '-', tee: '|- ', last: '`- ', pipe: '|  ', ok: 'ok', fail: 'FAIL', wait: '..', dot: '-', arrow: '->', uses: '-->', bullet: '>', plus: '+', minus: '-' };

const GROUP = {
  read: 'explore', search: 'explore',
  edit: 'change', write: 'change',
  run: 'run', web: 'web', agent: 'agent', skill: 'skill', mcp: 'mcp', plan: 'plan', ask: 'ask', other: 'other',
};
export const VERB = {
  explore: 'Looked at', change: 'Changed', run: 'Ran', web: 'Looked up', agent: 'Delegated',
  skill: 'Used skill', mcp: 'Used tool', plan: 'Planned', ask: 'Asked you', other: 'Used',
};

// Split the event stream into turns, one per user prompt.
export function splitTurns(events) {
  const turns = [];
  let cur = null;
  const pres = new Map();
  const finish = () => {
    if (!cur) return;
    const done = new Set(cur.tools.map((t) => t.id));
    cur.pending = [...pres.values()].filter((p) => !done.has(p.id) && !isSelf(p));
    pres.clear();
  };
  for (const e of events) {
    if (e.ev === 'prompt') {
      finish();
      cur = { prompt: e.text, start: e.t, end: e.t, tools: [], pending: [], stopped: false };
      turns.push(cur);
      continue;
    }
    if (!cur) {
      if (e.ev !== 'tool' && e.ev !== 'pre') continue;
      cur = { prompt: null, start: e.t, end: e.t, tools: [], pending: [], stopped: false };
      turns.push(cur);
    }
    // A resumed session's "start" event must not stretch the previous turn.
    if (e.ev !== 'start') cur.end = Math.max(cur.end, e.t || 0);
    if (e.ev === 'pre' && e.id) pres.set(e.id, e);
    if (e.ev === 'tool' && !isSelf(e)) cur.tools.push(e);
    if (e.ev === 'stop') cur.stopped = true;
  }
  finish();
  return turns;
}

// Hide whatdid's own render calls from the explanation.
// Commands what did runs for its own skills; the user's own commands that mention whatdid still count.
const isSelf = (e) => e.kind === 'run' && /[\\/]scripts[\\/](?:render|html|map)\.mjs/.test(e.detail || '');

export function groupSteps(tools) {
  const steps = [];
  for (const t of tools) {
    const g = GROUP[t.kind] || 'other';
    const prev = steps[steps.length - 1];
    if (prev && prev.group === g) prev.items.push(t);
    else steps.push({ group: g, items: [t] });
  }
  return steps;
}

// One step -> a description string, or several lines (commands).
// full: list everything instead of summarising (the pane's expanded view).
export function describeStep(step, S = UNICODE, full = false) {
  const { group, items } = step;
  const cap = full ? Infinity : 4;
  switch (group) {
    case 'explore': {
      const files = uniq(items.filter((i) => i.kind === 'read' && i.target !== '.').map((i) => i.target));
      const searches = uniq(items.filter((i) => i.kind === 'search' && i.detail).map((i) => `"${i.detail}"`));
      const parts = [];
      if (files.length) parts.push(full ? files.join(', ') : compressPaths(files));
      const shown = full ? searches : searches.slice(0, 3);
      if (searches.length) parts.push(`searched ${shown.join(', ')}${searches.length > shown.length ? ` +${searches.length - shown.length} more` : ''}`);
      return parts.join('; ') || 'the project folder';
    }
    case 'change': {
      const byFile = new Map();
      for (const i of items) {
        const f = byFile.get(i.target) || { add: 0, del: 0, created: false };
        f.add += i.add || 0; f.del += i.del || 0; f.created ||= !!i.created;
        byFile.set(i.target, f);
      }
      return [...byFile].map(([f, s]) => `${f} (${s.created ? 'new, ' : ''}${S.plus}${s.add} ${S.minus}${s.del})`).join(', ');
    }
    case 'run': {
      // One command per line, in plain words when Claude described it. The raw command only shows when it
      // failed (you will want to see it then) or when there is no description.
      const out = items.slice(0, cap).map((i) => {
        if (!i.why) return `${i.ok === false ? S.fail : S.ok} ${clip(i.detail, 70)}`;
        return i.ok === false ? `${S.fail} ${i.why}: ${clip(i.detail, 50)}` : `${S.ok} ${i.why}`;
      });
      if (items.length > cap) out.push(`+${items.length - cap} more commands`);
      return out;
    }
    case 'web':
      return uniq(items.map((i) => i.detail)).slice(0, 3).join('; ');
    case 'agent':
      return items.map((i) => `${i.target}: ${i.detail}`).join('; ');
    case 'skill':
    case 'mcp':
      return uniq(items.map((i) => i.target)).join(', ');
    case 'plan':
      return 'updated the plan / todo list';
    case 'ask':
      return 'asked you a question';
    default:
      return uniq(items.map((i) => i.tool)).join(', ');
  }
}

// Replay: one tool call -> [verb, detail].
export function describeCall(e, S = UNICODE) {
  const diff = e.add || e.del ? `  ${S.plus}${e.add || 0} ${S.minus}${e.del || 0}` : '';
  switch (e.kind) {
    case 'read': return ['Read', e.target || '?'];
    case 'search': return [e.tool === 'Glob' ? 'Listed' : 'Searched', `"${e.detail || ''}"${e.target && e.target !== '.' ? ` in ${e.target}` : ''}`];
    case 'edit': return ['Edited', `${e.target}${diff}`];
    case 'write': return [e.created ? 'Created' : 'Rewrote', `${e.target}${diff}`];
    case 'run': return ['Ran', e.why ? `${e.detail}  (${e.why})` : e.detail || ''];
    case 'web': return [e.tool === 'WebSearch' ? 'Searched web' : 'Fetched', e.detail || ''];
    case 'agent': return ['Delegated', `${e.target}: ${e.detail || ''}`];
    case 'skill': return ['Skill', e.target || ''];
    case 'mcp': return ['Tool', e.target || ''];
    case 'plan': return ['Planned', e.tool];
    case 'ask': return ['Asked you', 'a question'];
    default: return [e.tool, e.target || ''];
  }
}

// Truncate a rendered line without collapsing the spaces that align it.
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// Word-wrap text to width; continuation lines get the indent. Caps at maxLines.
export function wrap(text, width, indent = '', maxLines = 3) {
  const words = String(text).split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const lim = width - (lines.length ? indent.length : 0);
    if (cur && (cur + ' ' + w).length > lim) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines) shown[maxLines - 1] = cut(shown[maxLines - 1] + ' …', width - indent.length);
  return shown.map((l, i) => (i ? indent + l : l));
}

const uniq = (a) => [...new Set(a.filter(Boolean))];

// "src/auth/a.ts, src/auth/b.ts, src/auth/c.ts" -> "src/auth/ (3 files)"
export function compressPaths(files) {
  const byDir = new Map();
  for (const f of files) {
    const i = f.lastIndexOf('/');
    const dir = i >= 0 ? f.slice(0, i + 1) : './';
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(f);
  }
  const parts = [];
  for (const [dir, fs_] of byDir) parts.push(fs_.length >= 3 ? `${dir} (${fs_.length} files)` : fs_.join(', '));
  return parts.join(', ');
}

// Files touched in a turn: Map of path -> { marks:Set(R|E|N), add, del }. Project-relative paths only.
export function touchedFiles(tools) {
  const files = new Map();
  for (const t of tools) {
    if (!t.target || t.target === '.' || !['read', 'edit', 'write'].includes(t.kind)) continue;
    if (t.target.startsWith('~/') || /^[A-Za-z]:\//.test(t.target) || t.target.startsWith('/')) continue;
    const f = files.get(t.target) || { marks: new Set(), add: 0, del: 0 };
    if (t.kind === 'read') f.marks.add('R');
    if (t.kind === 'edit') f.marks.add('E');
    if (t.kind === 'write') f.marks.add(t.created ? 'N' : 'E');
    f.add += t.add || 0; f.del += t.del || 0;
    files.set(t.target, f);
  }
  return files;
}

// Import chains between the files this turn touched, e.g. "routes.js ──▶ auth/guard.js ──▶ auth/session.js [edited]".
// Uses the cached repo map, so it costs a few ms and no tokens. Chains through edited files come first.
export function importChains(cwd, tools, S = UNICODE, max = 4) {
  const files = touchedFiles(tools);
  if (files.size < 2) return [];
  let edges;
  try { edges = importEdges(cwd, [...files.keys()]); } catch { return []; }
  if (!edges.length) return [];
  const out = new Map(), indeg = new Map();
  for (const [a, b] of edges) {
    if (a === b) continue;
    if (!out.has(a)) out.set(a, []);
    out.get(a).push(b);
    indeg.set(b, (indeg.get(b) || 0) + 1);
  }
  const paths = [];
  const dfs = (node, pathSoFar) => {
    const next = (out.get(node) || []).filter((n) => !pathSoFar.includes(n));
    if (!next.length || paths.length > 50) return paths.push(pathSoFar);
    next.forEach((n) => dfs(n, [...pathSoFar, n]));
  };
  const starts = [...out.keys()].filter((n) => !indeg.get(n));
  (starts.length ? starts : [...out.keys()].slice(0, 1)).forEach((n) => dfs(n, [n]));
  const changed = (f) => { const m = files.get(f)?.marks; return m && (m.has('E') || m.has('N')); };
  const score = (p) => p.filter(changed).length * 10 + p.length;
  const picked = [];
  for (const p of paths.sort((a, b) => score(b) - score(a))) {
    // Skip a chain whose every link is already shown by a better one.
    const links = p.slice(1).map((n, i) => p[i] + '>' + n);
    if (picked.some((q) => links.every((l) => q.links.includes(l)))) continue;
    picked.push({ p, links });
    if (picked.length >= max) break;
  }
  const base = (f) => f.split('/').pop();
  const clash = new Set([...files.keys()].map(base).filter((b, i, a) => a.indexOf(b) !== i));
  const label = (f) => {
    const name = clash.has(base(f)) ? f : base(f);
    const m = files.get(f)?.marks;
    return m?.has('N') ? `${name} [new]` : m?.has('E') ? `${name} [edited]` : name;
  };
  return picked.map(({ p }) => p.map(label).join(` ${S.uses} `));
}

// File tree of everything touched, with R/E/N marks.
export function fileTree(tools, S = UNICODE, max = 25) {
  const files = touchedFiles(tools);
  if (!files.size) return [];
  // Changed files first so they survive truncation.
  const changed = (f) => f.marks.has('E') || f.marks.has('N');
  const entries = [...files].sort((a, b) => changed(b[1]) - changed(a[1]));
  const shown = entries.slice(0, max);
  const root = {};
  for (const [f, info] of shown) {
    const parts = f.split('/');
    let node = root;
    for (const p of parts.slice(0, -1)) node = node[p + '/'] ||= {};
    node[parts[parts.length - 1]] = info;
  }
  const out = [];
  const walk = (node, prefix) => {
    const keys = Object.keys(node).sort((a, b) => (b.endsWith('/') - a.endsWith('/')) || a.localeCompare(b));
    keys.forEach((k, idx) => {
      const lastOne = idx === keys.length - 1;
      const val = node[k];
      if (k.endsWith('/')) {
        // Collapse single-child directory chains: src/ -> auth/ becomes src/auth/
        let name = k, v = val;
        while (Object.keys(v).length === 1 && Object.keys(v)[0].endsWith('/')) {
          const only = Object.keys(v)[0];
          name += only; v = v[only];
        }
        out.push({ text: prefix + (lastOne ? S.last : S.tee) + name });
        walk(v, prefix + (lastOne ? '   ' : S.pipe));
      } else {
        const marks = ['R', 'E', 'N'].filter((m) => val.marks.has(m)).join(' ');
        const diff = val.add || val.del ? `${S.plus}${val.add} ${S.minus}${val.del}` : '';
        out.push({ text: prefix + (lastOne ? S.last : S.tee) + k, marks, diff });
      }
    });
  };
  walk(root, '');
  const w = Math.min(48, Math.max(...out.map((o) => o.text.length)) + 2);
  const lines_ = out.map((o) => (o.marks ? `${o.text.padEnd(w)}${o.marks.padEnd(6)}${o.diff}`.trimEnd() : o.text));
  if (entries.length > max) lines_.push(`… and ${entries.length - max} more files`);
  return lines_;
}

// The whatdid narration vocabulary. The output style asks Claude to write lines like
//   ◆ **why** · check how login decides a session has expired
// The older plain form "why: ..." still parses, as does any glyph or markdown decoration around the label.
export const NOTE_TYPES = {
  why: { glyph: '◆', ascii: '*' },    // before each batch of tool calls: what and why
  plan: { glyph: '▸', ascii: '>' },   // the approach, once, for multi-step work
  found: { glyph: '◇', ascii: 'o' },  // a discovery that explains the problem
  done: { glyph: '✔', ascii: '+' },   // a milestone reached mid-turn
  failed: { glyph: '✘', ascii: 'x' }, // something didn't work, and what happens instead
  risk: { glyph: '▲', ascii: '!' },   // something destructive, irreversible or uncertain
  need: { glyph: '◌', ascii: '?' },   // blocked on a decision from the user
};
export const RECAP_TYPES = {
  changed: { glyph: '✎', ascii: '~' },
  verified: { glyph: '✔', ascii: '+' },
  left: { glyph: '○', ascii: '-' },
};

const DECO = '[ \\t>*_`-]*(?:[^\\p{L}\\p{N}\\s][ \\t]*)?[*_`]*'; // leading markdown and an optional glyph
const SEP = '[*_`]*[ \\t]*[:·—–|][*_`]*[ \\t]*';               // ":" or "·" between label and text
const NOTE_RE = new RegExp(`^${DECO}(${Object.keys(NOTE_TYPES).join('|')})${SEP}(.+?)[*_\`\\s]*$`, 'gimu');
const RECAP_RE = new RegExp(`^${DECO}recap[*_\`]*(?:[ \\t]*[:·][*_\`]*[ \\t]*(.*))?[ \\t]*$`, 'imu');
const RECAP_ITEM_RE = new RegExp(`^${DECO}(${Object.keys(RECAP_TYPES).join('|')})${SEP}(.+)$`, 'iu');
const BULLET_RE = /^\s*(?:[-*•]|\d+[.)])\s+(.+?)\s*$/;
const plain = (s) => s.replace(/\*\*|__|`/g, '').trim();

// "✎ **changed** · session.js" -> { label: 'changed', text: 'session.js' }; unlabeled bullets keep label ''.
function recapItem(s) {
  const m = plain(s).match(RECAP_ITEM_RE);
  return m ? { label: m[1].toLowerCase(), text: m[2].trim() } : { label: '', text: plain(s).replace(/^[^\p{L}\p{N}\s]\s*/u, '') };
}

// Pull the recap out of a text block. Returns { bullets: [{label, text}], rest } where rest is the text without it.
export function parseRecap(text) {
  const m = RECAP_RE.exec(text);
  if (!m) return { bullets: [], rest: text };
  const inline = (m[1] || '').trim();
  const bullets = inline ? inline.split(/\s*;\s*/).filter(Boolean).map(recapItem) : [];
  const after = text.slice(m.index + m[0].length).split('\n');
  let used = 0;
  for (const line of after.slice(1)) {
    const b = line.match(BULLET_RE);
    if (b) { bullets.push(recapItem(b[1])); used++; continue; }
    if (!line.trim() && !bullets.length) { used++; continue; }
    break;
  }
  const rest = text.slice(0, m.index) + after.slice(1 + used).join('\n');
  return { bullets: bullets.slice(0, 5), rest };
}

// Every typed note in a text block, in order: [{ type: 'why' | 'found' | ..., text }].
export function parseNotes(text) {
  return [...String(text).matchAll(NOTE_RE)].map((m) => ({ type: m[1].toLowerCase(), text: plain(m[2]) })).filter((n) => n.text);
}

export function parseWhys(text) {
  return parseNotes(text).filter((n) => n.type === 'why').map((n) => n.text);
}

// "◆ why   " — glyph and label padded so note texts line up.
export function noteLead(type, S, pad = 6) {
  const t = NOTE_TYPES[type] || RECAP_TYPES[type];
  if (!t) return `${S.bullet} `;
  return `${S === ASCII ? t.ascii : t.glyph} ${type.padEnd(pad)}  `;
}

function recapLead(item, S) {
  if (!item.label) return `${S.bullet} `;
  let key = item.label;
  // A recap that admits a gap should look like one.
  if (key === 'verified' && /^not\b|^no\b|unverified|untested/i.test(item.text)) return `${S === ASCII ? 'x' : '✘'} ${key.padEnd(8)}  `;
  if (key === 'left' && !/^(nothing|none|n\/a)\b/i.test(item.text)) return `${S === ASCII ? '!' : '▲'} ${key.padEnd(8)}  `;
  const t = RECAP_TYPES[key];
  return `${S === ASCII ? t.ascii : t.glyph} ${key.padEnd(8)}  `;
}

// Best-effort enrichment from Claude Code's transcript: token usage, Claude's own narration, and its recap.
// timeline: [{ t, text, why }] in time order; notes: the texts to show (why: lines if any, else narration).
export function transcriptInfo(transcriptPath, start, end) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
  const seen = new Set();
  let out = 0, ctx = 0;
  const timeline = [];
  let recap = [];
  let last = '';
  for (const l of readJsonl(transcriptPath)) {
    if (l.type !== 'assistant' || !l.message || l.isSidechain) continue;
    const ts = Date.parse(l.timestamp);
    if (!(ts >= start - 1000 && ts <= end + 5000)) continue;
    const m = l.message;
    if (m.usage && !seen.has(m.id)) {
      seen.add(m.id);
      out += m.usage.output_tokens || 0;
      const c = (m.usage.input_tokens || 0) + (m.usage.cache_read_input_tokens || 0) + (m.usage.cache_creation_input_tokens || 0);
      if (c) ctx = c;
    }
    for (const c of m.content || []) {
      if (c.type !== 'text' || !c.text) continue;
      const r = parseRecap(c.text);
      if (r.bullets.length) recap = r.bullets;
      if (r.rest.trim()) last = r.rest;
      const typed = parseNotes(r.rest);
      if (typed.length) typed.forEach((n) => timeline.push({ t: ts, ...n }));
      else {
        const s = bestSentence(r.rest);
        if (s) timeline.push({ t: ts, type: null, text: s });
      }
    }
  }
  // With the output style on, show only Claude's typed notes; otherwise fall back to its best sentences.
  const styled = timeline.some((n) => n.type);
  const picked = timeline.filter((n) => !!n.type === styled);
  const seenText = new Set();
  const notes = picked.filter((n) => !seenText.has(n.text) && seenText.add(n.text));
  // The start of Claude's last message: its answer once the turn is over.
  const answer = styled ? '' : leadSentences(last, 2);
  return { out, ctx, notes, timeline: picked, recap, styled, answer };
}

// Filler openers that say nothing about what happened.
const LEAD_IN = /^(now|next|then|first|here'?s|here is|checking|looking|writing|adding|running)\b/i;
const FILLER = /^(i'?ll|i will|let me|now let me|now i'?ll|perfect|great|excellent|good|okay|ok|done|sure|alright)\b/i;

// Pick the most informative sentence of a text block, skipping filler like "Let me check".
// Lines and list items are boundaries too; a "." only ends a sentence before a space, so 2.1.286 survives.
function sentencesOf(t) {
  return t.replace(/```[\s\S]*?```/g, '').split(/\n+/)
    .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').replace(/[#*`>|✓✔]/g, '').trim())
    .flatMap((l) => l.split(/(?<=[.!?])\s+/)).map((x) => x.trim()).filter(Boolean);
}

// The first sentences that say something, e.g. "The doctor check passed, and the npx command worked."
function leadSentences(t, n) {
  return sentencesOf(t).filter((x) => x.split(' ').length >= 4 && !FILLER.test(x) && !/:$/.test(x)).slice(0, n).join(' ');
}

function bestSentence(t) {
  const ok = sentencesOf(t).filter((x) => x.split(' ').length >= 5 && !FILLER.test(x));
  // Prefer a finding over a lead-in like "Now the pane launcher itself:" that only announces the next step.
  return ok.find((x) => !/:$/.test(x) && !LEAD_IN.test(x)) || ok[0] || '';
}

export const fmtK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
export const fmtDur = (ms) => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`;
};
const fmtOffset = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `+${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function header(turn, idx, total, tx, S, label) {
  const head = [`${label} ${S.dot} turn ${idx + 1} of ${total}`];
  if (turn.end - turn.start >= 1000) head.push(fmtDur(turn.end - turn.start));
  head.push(`${turn.tools.length} tool call${turn.tools.length === 1 ? '' : 's'}`);
  if (tx && tx.out) head.push(`${fmtK(tx.out)} tokens written ${S.dot} ${fmtK(tx.ctx)} in context`);
  if (!turn.stopped) head.push('still running');
  return `${S.tl}${S.h} ${head.join(` ${S.dot} `)}`;
}

function frame(S, width) {
  const L = [];
  const push = (s = '') => L.push(cut(`${S.v} ${s}`, width).replace(/\s+$/, ''));
  const close = () => {
    while (L.length && L[L.length - 1] === S.v) L.pop();
    L.push(S.bl);
    return L.join('\n');
  };
  return { L, push, close };
}

function pushPrompt(push, turn, width, S = UNICODE) {
  if (turn.prompt) wrap(`"${clip(turn.prompt, 300)}"`, width - 16, ' '.repeat(12)).forEach((l, i) => push((i ? '' : 'You asked:  ') + l));
  const short = inShort(turn, S);
  if (short) wrap(short, width - 16, ' '.repeat(12)).forEach((l, i) => push((i ? '' : 'In short:   ') + l));
  if (turn.prompt || short) push();
}

// One plain-English line: how much Claude read, changed and ran, and whether anything failed.
export function inShort(turn, S = UNICODE) {
  const t = turn.tools;
  const files = (pred) => new Set(t.filter(pred).map((e) => e.target)).size;
  const n = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const parts = [];
  const read = files((e) => e.kind === 'read');
  const searched = t.filter((e) => e.kind === 'search').length;
  if (read) parts.push(`read ${n(read, 'file')}`);
  if (searched) parts.push(searched === 1 ? 'searched once' : `searched ${searched} times`);
  const created = files((e) => e.kind === 'write' && e.created);
  const edited = new Set(t.filter((e) => (e.kind === 'edit' || e.kind === 'write') && !e.created).map((e) => e.target));
  const add = t.reduce((a, e) => a + (e.add || 0), 0), del = t.reduce((a, e) => a + (e.del || 0), 0);
  if (created) parts.push(`created ${n(created, 'file')}`);
  if (edited.size) parts.push(`edited ${n(edited.size, 'file')}`);
  if (created || edited.size) parts[parts.length - 1] += ` (${S.plus}${add} ${S.minus}${del} lines)`;
  const runs = t.filter((e) => e.kind === 'run');
  const failed = runs.filter((e) => e.ok === false).length;
  if (runs.length) parts.push(`ran ${n(runs.length, 'command')}${failed ? `, ${failed} failed` : runs.length > 1 ? ', all worked' : ''}`);
  if (!parts.length) return '';
  const s = parts.join(', ');
  return s[0].toUpperCase() + s.slice(1) + '.';
}

function pushRecap(push, tx, S, width) {
  if (!tx || !tx.recap.length) return;
  push('Recap');
  tx.recap.forEach((b) => {
    const lead = recapLead(b, S);
    wrap(b.text, width - 6 - lead.length, ' '.repeat(2 + lead.length), 2).forEach((l, k) => push(k ? l : `  ${lead}${l}`));
  });
  push();
}

export function renderTurn(turn, idx, total, opts = {}) {
  const S = opts.ascii ? ASCII : UNICODE;
  const width = opts.width || 100;
  const { L, push, close } = frame(S, width);
  const tx = opts.transcript ? transcriptInfo(opts.transcript, turn.start, turn.end) : null;

  L.push(header(turn, idx, total, tx, S, 'what did'));
  push();
  pushPrompt(push, turn, width, S);

  if (tx && tx.answer) {
    push(turn.stopped ? "Claude's answer  (how its final message begins)" : 'Latest from Claude  (it is still working)');
    wrap(tx.answer, width - 8, '  ', 3).forEach((l, k) => push(k ? l : `  ${l}`));
    push();
  }

  pushHealth(push, turn, S, width);

  const steps = groupSteps(turn.tools);
  if (steps.length) {
    push('What Claude did');
    const maxSteps = opts.full ? Infinity : opts.maxSteps || 12;
    steps.slice(0, maxSteps).forEach((st, i) => {
      const lead = ` ${String(i + 1).padStart(2)}. ${VERB[st.group].padEnd(10)} `;
      const pad = ' '.repeat(lead.length);
      [].concat(describeStep(st, S, opts.full)).forEach((d, j) => {
        wrap(d, width - lead.length - 3, pad, 2).forEach((l, k) => push((j === 0 && k === 0 ? lead : k ? '' : pad) + l));
      });
    });
    if (steps.length > maxSteps) push(`     … ${steps.length - maxSteps} more steps (wd replay shows every one)`);
    if (turn.pending.length && !turn.stopped) {
      const [verb, detail] = describeCall(turn.pending[turn.pending.length - 1], S);
      push(`  ${S.wait}  now:      ${verb} ${clip(detail, width - 22)}`);
    }
    push();
  } else if (turn.pending.length) {
    const [verb, detail] = describeCall(turn.pending[turn.pending.length - 1], S);
    push(`${S.wait} now: ${verb} ${clip(detail, width - 14)}`);
    push();
  } else if (turn.stopped) {
    push('Claude answered directly, without using any tools.');
    push();
  }

  const tree = fileTree(turn.tools, S, opts.full ? Infinity : 25);
  if (tree.length) {
    push(`Files  (R read ${S.dot} E edited ${S.dot} N new)`);
    tree.forEach((t) => push(' ' + t));
    push();
  }

  const chains = opts.cwd && !opts.noChains ? importChains(opts.cwd, turn.tools, S) : [];
  if (chains.length) {
    push(`How it connects  (A ${S.uses} B: A uses code from B)`);
    chains.forEach((c) => wrap(c, width - 6, '      ', 3).forEach((l) => push('  ' + l)));
    push();
  }

  // A failed Read of the project folder itself is Claude probing, not a real problem.
  const fails = turn.tools.filter((t) => t.ok === false && !(t.kind === 'read' && t.target === '.'));
  if (fails.length) {
    push(`Heads up: ${fails.length} step${fails.length > 1 ? 's' : ''} failed`);
    fails.slice(0, 3).forEach((f) => push(`  ${S.fail} ${f.tool} ${clip(f.detail || f.target || '', 70)}`));
    push();
  }

  if (tx && tx.styled && tx.notes.length) {
    push("Claude's notes");
    const pad = Math.max(3, ...tx.notes.map((n) => (n.type || '').length));
    tx.notes.slice(-8).forEach((n) => {
      const lead = noteLead(n.type, S, pad);
      wrap(n.text, width - 6 - lead.length, ' '.repeat(2 + lead.length), 2).forEach((l, k) => push(k ? l : `  ${lead}${l}`));
    });
    push();
  } else if (tx) {
    // One line from each message Claude wrote while working, tied to the step that came right after it.
    const along = tx.notes.filter((n) => !tx.answer || !tx.answer.includes(n.text));
    if (along.length) {
      push('Along the way  (one key line from each message Claude wrote while working)');
      const starts = steps.map((st) => st.items[0].t || 0);
      along.slice(opts.full ? 0 : -8).forEach((n) => {
        const i = starts.findIndex((t0) => t0 >= n.t);
        const tag = i < 0 ? '(at the end)' : `(→ step ${i + 1})`;
        const lead = `${S.bullet} ${tag} `;
        wrap(n.text, width - 6 - lead.length, ' '.repeat(2 + lead.length), 2).forEach((l, k) => push(k ? l : `  ${lead}${l}`));
      });
      push();
    }
  }
  pushRecap(push, tx, S, width);
  return close();
}

// Replay: every tool call in order with its time offset, interleaved with Claude's notes.
export function renderReplay(turn, idx, total, opts = {}) {
  const S = opts.ascii ? ASCII : UNICODE;
  const width = opts.width || 100;
  const { L, push, close } = frame(S, width);
  const tx = opts.transcript ? transcriptInfo(opts.transcript, turn.start, turn.end) : null;

  L.push(header(turn, idx, total, tx, S, 'what did replay'));
  push();
  pushPrompt(push, turn, width, S);

  const rows = [
    ...turn.tools.map((e, i) => ({ t: e.t, o: i, call: e })),
    ...turn.pending.map((e, i) => ({ t: e.t, o: 1e6 + i, call: e, pending: true })),
    // Notes are stamped when the message was written, i.e. just before the calls they introduce.
    ...(tx ? tx.timeline.map((n, i) => ({ t: n.t, o: -1e6 + i, note: n })) : []),
  ].sort((a, b) => a.t - b.t || a.o - b.o);

  if (!rows.length) push('No tool calls in this turn.');
  const vw = Math.max(0, ...turn.tools.concat(turn.pending).map((e) => describeCall(e, S)[0].length));
  // With typed notes, each note heads the tool calls it introduced, which sit indented beneath it.
  const indent = tx && tx.styled ? '   ' : '';
  const pad = Math.max(3, ...(tx ? tx.timeline.map((n) => (n.type || '').length) : [0]));
  for (const r of rows) {
    const off = fmtOffset(r.t - turn.start);
    if (r.note) {
      const lead = r.note.type ? noteLead(r.note.type, S, pad) : `${S.bullet}  `;
      const hang = ' '.repeat(off.length + 2 + lead.length);
      wrap(r.note.text, width - 6 - hang.length, hang, 2).forEach((l, k) => push(k ? l : `${off}  ${lead}${l}`));
      continue;
    }
    // A call that started but never finished in a completed turn was denied or cancelled.
    const skipped = r.pending && turn.stopped;
    const mark = skipped || r.call.ok === false ? S.fail : r.pending ? S.wait : S.ok;
    let [verb, detail] = describeCall(r.call, S);
    if (skipped) detail += '  (not run: denied or cancelled)';
    const lead = `${off}  ${indent}${mark.padEnd(S === ASCII ? 4 : 1)}  ${verb.padEnd(vw)}  `;
    push(lead + cut(detail, Math.max(20, width - lead.length - 3)));
  }
  push();
  pushRecap(push, tx, S, width);
  return close();
}

export function renderHelp(opts = {}) {
  const S = opts.ascii ? ASCII : UNICODE;
  const { L, push, close } = frame(S, 100);
  L.push(`${S.tl}${S.h} what did ${S.dot} every command is free: it never reaches the model (0 tokens)`);
  push();
  push('Type the short form as your whole message, or type /wd to pick from the menu.');
  push();
  const rows = [
    ['wd', '/whatdid:wd', 'the last turn: files, commands, failures, answer'],
    ['wd 3 · wd all', '/whatdid:wd 3', 'the last 3 turns · the whole session'],
    ['wd replay', '/whatdid:wd-replay', 'every single step in order, with timings and why'],
    ['wd diff', '/whatdid:wd-diff', 'the exact lines Claude changed in the last turn'],
    ['wd map', '/whatdid:wd-map', 'map of this codebase: key files, symbols, who imports what'],
    ['wd map src', '/whatdid:wd-map src', 'the map of one folder'],
    ['wd html', '/whatdid:wd-html', 'the session as a web page with a flowchart'],
    ['wd help', '/whatdid:wd-help', 'this card'],
  ];
  rows.forEach(([k, c, v]) => push(`  ${k.padEnd(14)} ${c.padEnd(20)} ${v}`));
  push();
  push('In the colour pane: ↑↓ or the wheel scroll, e or a click on "+N more" shows everything, q closes.');
  push('Uses tokens: /whatdid:explain (Claude explains the map in plain English).');
  push('Settings: /whatdid:setup (statusline, pane, notify, auto card, automap).');
  push('Tip: /output-style whatdid makes Claude narrate: ◆ why  ◇ found  ✔ done  ▲ risk  ◌ need …');
  return close();
}

// Commands that run a test suite, in the common ecosystems.
const TEST_CMD = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|t)\b|\b(?:pytest|jest|vitest|mocha|ava|phpunit|rspec|ctest|unittest)\b|\b(?:go|cargo|dotnet|mix|deno|swift|zig)\s+test\b|\b(?:mvn|gradlew?|make)\b[^|;&]*\b(?:test|check)\b|\bnode\s+(?:--test|test\/)/i;
export const isTestCommand = (e) => e.kind === 'run' && (TEST_CMD.test(e.detail || '') || /\btests?\b/i.test(e.why || ''));

// Session health for one turn: did tests pass, what failed, and is any failure still unresolved?
// A failure counts as resolved when the same command (any test run, for a failed test run) or the same
// file operation succeeds later in the turn.
export function healthOf(turn) {
  const t = turn.tools.filter((e) => !(e.kind === 'read' && e.target === '.'));
  const key = (e) => (e.kind === 'run' ? (isTestCommand(e) ? 'test-suite' : `run:${e.detail}`) : `${e.kind}:${e.target}`);
  const runs = t.filter((e) => e.kind === 'run');
  const tests = runs.filter(isTestCommand);
  const failed = t.filter((e) => e.ok === false);
  const unresolved = failed.filter((f) => !t.slice(t.indexOf(f) + 1).some((e) => e.ok !== false && key(e) === key(f)));
  const changed = [...touchedFiles(t)].filter(([, f]) => f.marks.has('E') || f.marks.has('N'));
  return {
    tests: tests.length ? { runs: tests.length, passed: tests[tests.length - 1].ok !== false, last: tests[tests.length - 1] } : null,
    commands: runs.length,
    failedCommands: runs.filter((e) => e.ok === false).length,
    failed: failed.length,
    unresolved,
    changed: changed.length,
    add: changed.reduce((a, [, f]) => a + f.add, 0),
    del: changed.reduce((a, [, f]) => a + f.del, 0),
  };
}

function pushHealth(push, turn, S, width) {
  if (!turn.tools.length) return;
  const h = healthOf(turn);
  const g = S === ASCII ? { none: 'o', pen: '*', warn: '!' } : { none: '○', pen: '✎', warn: '▲' };
  const row = (glyph, label, text) => wrap(text, width - 20, ' '.repeat(16), 2).forEach((l, i) => push(i ? l : `  ${glyph} ${label.padEnd(11)} ${l}`));
  push('Health');
  if (!h.tests) row(g.none, 'tests', 'not run in this turn');
  else {
    const what = h.tests.last.why || clip(h.tests.last.detail, 50);
    row(h.tests.passed ? S.ok : S.fail, 'tests', `${h.tests.passed ? 'passed' : 'failing'} ${S.dot} ${what}${h.tests.runs > 1 ? ` (${h.tests.runs} runs)` : ''}`);
  }
  if (h.commands) {
    const fixed = h.failedCommands - h.unresolved.filter((e) => e.kind === 'run').length;
    const text = !h.failedCommands ? `${h.commands} ran, all worked`
      : `${h.commands} ran, ${h.failedCommands} failed${fixed ? `${fixed === h.failedCommands ? ', all' : `, ${fixed}`} fixed later` : ''}`;
    row(h.failedCommands > fixed ? S.fail : S.ok, 'commands', text);
  }
  row(g.pen, 'files', h.changed ? `${h.changed} changed (${S.plus}${h.add} ${S.minus}${h.del})` : 'none changed');
  if (!h.unresolved.length) row(S.ok, 'unresolved', 'none');
  else row(g.warn, 'unresolved', h.unresolved.slice(0, 3).map((e) => clip(e.why || e.detail || e.target || e.tool, 50)).join(` ${S.dot} `) + (h.unresolved.length > 3 ? ` +${h.unresolved.length - 3} more` : ''));
  push();
}

// wd diff: the lines Claude changed in the last turn, from Claude Code's transcript.
export function renderDiff(events, opts = {}) {
  const S = opts.ascii ? ASCII : UNICODE;
  const width = opts.width || 100;
  const turns = splitTurns(events).filter((t) => t.prompt || t.tools.length);
  const turn = turns[turns.length - 1];
  const { L, push, close } = frame(S, width);
  if (!turn) return 'what did: nothing recorded in this session yet.';
  const cwd = [...events].reverse().find((e) => e.cwd)?.cwd || '';
  const transcript = 'transcript' in opts ? opts.transcript : [...events].reverse().find((e) => e.transcript)?.transcript;
  const diffs = diffsFor(transcript, turn.start, turn.end, cwd);
  const add = diffs.reduce((a, d) => a + d.add, 0), del = diffs.reduce((a, d) => a + d.del, 0);
  L.push(`${S.tl}${S.h} what did diff ${S.dot} turn ${turns.length} ${S.dot} ${diffs.length} file${diffs.length === 1 ? '' : 's'} changed (${S.plus}${add} ${S.minus}${del})`);
  push();
  if (turn.prompt) { wrap(`"${clip(turn.prompt, 200)}"`, width - 16, ' '.repeat(12)).forEach((l, i) => push((i ? '' : 'You asked:  ') + l)); push(); }
  if (!diffs.length) push('No file edits in this turn.');
  for (const d of diffs) {
    push(`${S.bullet} ${d.file}  (${d.created ? 'new file, ' : ''}${S.plus}${d.add} ${S.minus}${d.del})`);
    diffLines(d, { full: opts.full, S }).forEach((l) => push(l.length > width - 4 ? l.slice(0, width - 5) + '…' : l));
    push();
  }
  push('From Claude\'s Edit and Write tools. Edits made by shell commands are not shown.');
  return close();
}

// The text of any wd view except html. job: { file, cwd, transcript, opts }.
export function viewText(job, width = 100) {
  const o = job.opts || {};
  if (o.help) return renderHelp(o);
  if (o.map) return mapView(job.cwd, o.mapPath);
  const events = job.file ? readEvents(job.file) : [];
  if (!events.length) return 'what did: nothing recorded in this session yet. Give Claude a task, then type wd.';
  if (o.diff) return renderDiff(events, { ...o, transcript: job.transcript, width });
  return render(events, { ...o, transcript: job.transcript, width });
}

// One line for the end of every turn: steps, what changed, what ran, and Claude's last note. Empty if no tools ran.
export function renderCard(events, opts = {}) {
  const S = opts.ascii ? ASCII : UNICODE;
  const turns = splitTurns(events).filter((t) => t.prompt || t.tools.length);
  const turn = turns[turns.length - 1];
  if (!turn || !turn.tools.length) return '';
  const tx = opts.transcript ? transcriptInfo(opts.transcript, turn.start, turn.end) : null;
  const parts = [`${S === ASCII ? '*' : '◆'} what did`, `${turn.tools.length} step${turn.tools.length === 1 ? '' : 's'}`];
  if (turn.end - turn.start >= 1000) parts.push(fmtDur(turn.end - turn.start));
  const changed = [...touchedFiles(turn.tools)].filter(([, f]) => f.marks.has('E') || f.marks.has('N'));
  if (changed.length) {
    const [f, s] = changed[0];
    const more = changed.length > 1 ? `, +${changed.length - 1} file${changed.length > 2 ? "s" : ""}` : "";
    parts.push(`changed ${f.split("/").pop()} ${S.plus}${s.add} ${S.minus}${s.del}${more}`);
  }
  const runs = turn.tools.filter((e) => e.kind === 'run');
  if (runs.length) {
    const last = runs[runs.length - 1];
    parts.push(`${last.ok === false ? S.fail : S.ok} ${clip(last.detail, 28)}`);
  }
  const failed = turn.tools.filter((e) => e.ok === false && !(e.kind === 'read' && e.target === '.'));
  if (failed.length) {
    // A failure followed by a passing run of the last command was recovered from; say so.
    const lastRun = runs[runs.length - 1];
    const recovered = lastRun && lastRun.ok !== false && failed.every((e) => e.t <= lastRun.t);
    parts.push(`${failed.length} failed${recovered ? ' earlier' : ''}`);
  }
  const line = parts.join(` ${S.dot} `) + ` ${S.dot} type wd`;
  const note = tx && [...tx.notes].reverse().find((n) => n.type && n.type !== 'why');
  return note ? `${line}
  ${noteLead(note.type, S, 0).trimEnd()} ${clip(note.text, 90)}` : line;
}

export function render(events, opts = {}) {
  if (opts.help) return renderHelp(opts);
  const turns = splitTurns(events).filter((t) => t.prompt || t.tools.length || t.pending.length);
  if (!turns.length) return 'what did: nothing recorded for this session yet. Ask Claude to do something first. (wd help lists options)';
  const n = opts.all ? turns.length : Math.max(1, opts.last || 1);
  const transcript = 'transcript' in opts ? opts.transcript : [...events].reverse().find((e) => e.transcript)?.transcript;
  const cwd = opts.cwd || [...events].reverse().find((e) => e.cwd)?.cwd;
  const pick = turns.slice(-n);
  const fn = opts.replay ? renderReplay : renderTurn;
  return pick.map((t, i) => fn(t, turns.length - pick.length + i, turns.length, { ...opts, transcript, cwd })).join('\n\n');
}

// Words the magic prompt understands. Anything else in o.unknown means "this was a real question, not a command".
export function parseArgs(argv) {
  const o = { unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--session') o.sessionId = argv[++i];
    else if (a === '--cwd') o.cwd = argv[++i];
    else if (a === '--file') o.file = argv[++i];
    else if (a === '--last') o.last = parseInt(argv[++i], 10) || 1;
    else if (a === '--all' || a === 'all') o.all = true;
    else if (a === '--all-steps') o.maxSteps = Infinity;
    else if (a === '--ascii' || a === 'ascii') o.ascii = true;
    else if (a === '--no-transcript') o.transcript = null;
    else if (a === '--replay' || a === 'replay') o.replay = true;
    else if (a === '--html' || a === 'html') o.html = true;
    else if (a === '--no-open') o.noOpen = true;
    else if (a === '--map' || a === 'map') o.map = true;
    else if (a === '--diff' || a === 'diff') o.diff = true;
    else if (a === '--help' || a === 'help' || a === '-h' || a === '?') o.help = true;
    else if (/^\d+$/.test(a)) o.last = parseInt(a, 10);
    else if (o.map && !o.mapPath && !a.startsWith('-')) o.mapPath = a;
    else o.unknown.push(a);
  }
  return o;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const o = parseArgs(process.argv.slice(2));
  const file = o.file || findSession({ sessionId: o.sessionId, cwd: o.cwd || process.cwd() });
  if (o.help) {
    console.log(renderHelp(o));
  } else if (!file) {
    console.log('what did: no sessions recorded yet. Is the plugin enabled? Try /plugin.');
  } else if (o.html) {
    const out = writeReport(file, readEvents(file), o);
    if (!o.noOpen) openInBrowser(out);
    console.log(`what did report: ${out}`);
  } else {
    o.width = Math.min(process.stdout.columns || 100, 120);
    const text = render(readEvents(file), o);
    // Colour only for a real terminal, so pipes, files and skills get plain text.
    console.log(process.stdout.isTTY && !process.env.NO_COLOR ? colorize(text) : text);
  }
}
