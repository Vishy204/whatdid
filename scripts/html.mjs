// Writes a session as one self-contained HTML page: turns, health, a flowchart, steps, files and changed lines.
// Deterministic, no model calls, no JavaScript and no network: the flowchart is SVG drawn here.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { home, PRIVATE_DIR, PRIVATE_FILE } from './lib.mjs';
import {
  splitTurns, groupSteps, describeStep, fileTree, touchedFiles, transcriptInfo, VERB, UNICODE, fmtK, fmtDur, NOTE_TYPES, RECAP_TYPES,
  healthOf, inShort,
} from './render.mjs';
import { diffsFor, diffLines } from './diff.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Wrap text into at most `max` lines of about `n` characters.
// Wrap text into lines of about n characters, keeping all of it. Words longer than a line (paths) are split.
// Only past `max` lines does it stop, and then the last line says how much is left.
function wrapText(t, n, max = 12) {
  const words = String(t ?? '').replace(/\s+/g, ' ').trim().split(' ')
    .flatMap((w) => (w.length > n ? w.match(new RegExp(`.{1,${n}}`, 'g')) : [w]));
  const out = [''];
  for (const w of words) {
    const cur = out[out.length - 1];
    if (!cur || (cur + ' ' + w).length <= n) out[out.length - 1] = cur ? `${cur} ${w}` : w;
    else out.push(w);
  }
  if (out.length <= max) return out;
  const rest = out.slice(max - 1).join(' ').split(' ').length;
  return [...out.slice(0, max - 1), `… +${rest} more words (hover for all)`];
}

// Flowchart for one turn as inline SVG: your prompt, then each step in order down the left, and the files on the
// right, with dashed lines for files read and solid ones for files changed. Built here, so the report needs no
// JavaScript and no network.
export function flowchartSvg(turn) {
  const steps = groupSteps(turn.tools).slice(0, 16);
  const files = [...touchedFiles(turn.tools).keys()].slice(0, 14);
  const W = 860, SX = 16, SW = 430, FX = 560, FW = 284, LH = 16, PAD = 10, GAP = 22;
  const parts = [];
  const box = (x, y, w, lines, cls, rx = 8, full = lines.join(' ')) => {
    const h = lines.length * LH + PAD * 2 - 4;
    parts.push(`<g class="${cls}"><title>${esc(full)}</title><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>` +
      lines.map((l, i) => `<text x="${x + 12}" y="${y + PAD + 11 + i * LH}">${esc(l)}</text>`).join('') + '</g>');
    return h;
  };
  let y = 12;
  const ask = `You asked: ${turn.prompt || '(no prompt)'}`;
  const ph = box(SX, y, SW, wrapText(ask, 54, 8), 'fc-prompt', 18, ask);
  let prevBottom = y + ph;
  y += ph + GAP;
  const stepMid = [];
  steps.forEach((st, i) => {
    const desc = [].concat(describeStep(st, UNICODE, true)).join('; ');
    const failed = st.items.some((x) => x.ok === false);
    const cls = failed ? 'fc-step fc-fail' : st.group === 'change' ? 'fc-step fc-change' : 'fc-step';
    const label = `${i + 1}. ${VERB[st.group]}: ${desc}`;
    const h = box(SX, y, SW, wrapText(label, 54, 10), cls, 8, label);
    parts.push(`<path class="fc-flow" d="M${SX + SW / 2} ${prevBottom} V${y - 2}" marker-end="url(#fc-arrow)"/>`);
    stepMid.push(y + h / 2);
    prevBottom = y + h;
    y += h + GAP;
  });
  const fileMid = new Map();
  let fy = 12;
  for (const f of files) {
    const h = box(FX, fy, FW, wrapText(f, 38, 4), 'fc-file', 4, f);
    fileMid.set(f, fy + h / 2);
    fy += h + 10;
  }
  steps.forEach((st, i) => {
    const seen = new Set();
    for (const it of st.items) {
      if (!fileMid.has(it.target) || seen.has(it.target)) continue;
      seen.add(it.target);
      const y1 = stepMid[i], y2 = fileMid.get(it.target);
      const cls = it.kind === 'read' ? 'fc-read' : 'fc-write';
      parts.push(`<path class="${cls}" d="M${SX + SW} ${y1} C${SX + SW + 60} ${y1}, ${FX - 60} ${y2}, ${FX - 2} ${y2}"/>`);
    }
  });
  const H = Math.max(y, fy) + 4;
  return `<svg class="flow" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Flowchart of the steps Claude took">` +
    '<defs><marker id="fc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z"/></marker></defs>' +
    parts.join('') + '</svg>';
}

function healthHtml(turn) {
  if (!turn.tools.length) return '';
  const h = healthOf(turn);
  const item = (cls, label, text) => `<li class="${cls}"><span class="tag">${label}</span><span>${esc(text)}</span></li>`;
  const tests = !h.tests ? item('h-none', '○ tests', 'not run in this turn')
    : item(h.tests.passed ? 'h-ok' : 'h-bad', `${h.tests.passed ? '✔' : '✘'} tests`, `${h.tests.passed ? 'passed' : 'failing'} · ${h.tests.last.why || h.tests.last.detail}${h.tests.runs > 1 ? ` (${h.tests.runs} runs)` : ''}`);
  const fixed = h.failedCommands - h.unresolved.filter((e) => e.kind === 'run').length;
  const cmds = h.commands ? item(h.failedCommands > fixed ? 'h-bad' : 'h-ok', `${h.failedCommands > fixed ? '✘' : '✔'} commands`,
    !h.failedCommands ? `${h.commands} ran, all worked` : `${h.commands} ran, ${h.failedCommands} failed${fixed ? `, ${fixed} fixed later` : ''}`) : '';
  const files = item('h-none', '✎ files', h.changed ? `${h.changed} changed (+${h.add} −${h.del})` : 'none changed');
  const open = h.unresolved.length ? item('h-warn', '▲ unresolved', h.unresolved.map((e) => e.why || e.detail || e.target || e.tool).join(' · '))
    : item('h-ok', '✔ unresolved', 'none');
  return `<h3>Health</h3><ul class="notes health">${tests}${cmds}${files}${open}</ul>`;
}

function diffHtml(turn, transcript, cwd) {
  const diffs = diffsFor(transcript, turn.start, turn.end, cwd);
  if (!diffs.length) return '';
  const body = diffs.map((d) => {
    const lines = diffLines(d, { full: true }).map((l) => {
      const cls = /^@@/.test(l) ? 'd-hunk' : /^\s*\d+ \+ /.test(l) ? 'd-add' : /^\s*\d+ - /.test(l) ? 'd-del' : 'd-ctx';
      return `<span class="${cls}">${esc(l)}</span>`;
    }).join('\n');
    return `<details><summary><code>${esc(d.file)}</code> <span class="add">+${d.add}</span> <span class="del">−${d.del}</span>${d.created ? ' · new file' : ''}</summary><pre class="diff">${lines}</pre></details>`;
  }).join('');
  return `<h3>Changed lines <small>from Claude's Edit and Write tools</small></h3>${body}`;
}

function turnSection(turn, ti, total, transcript, cwd, open = true) {
  const tx = transcript ? transcriptInfo(transcript, turn.start, turn.end) : null;
  const meta = [`${turn.tools.length} tool calls`];
  if (turn.end - turn.start >= 1000) meta.unshift(fmtDur(turn.end - turn.start));
  if (tx && tx.out) meta.push(`${fmtK(tx.out)} tokens written`, `${fmtK(tx.ctx)} in context`);
  if (!turn.stopped) meta.push('still running');
  const steps = groupSteps(turn.tools).map((st) => {
    const d = [].concat(describeStep(st, UNICODE));
    return `<li><b>${esc(VERB[st.group])}</b> ${d.map(esc).join('<br>')}</li>`;
  }).join('');
  const tree = fileTree(turn.tools, UNICODE);
  const fails = turn.tools.filter((t) => t.ok === false);
  const note = (n) => n.type
    ? `<li class="note n-${n.type}"><span class="tag">${NOTE_TYPES[n.type].glyph} ${n.type}</span><span>${esc(n.text)}</span></li>`
    : `<li class="note"><span class="tag">›</span><span>${esc(n.text)}</span></li>`;
  const notes = tx && tx.notes.length
    ? `<h3>${tx.styled ? 'Claude’s notes' : 'In Claude’s words'}</h3><ul class="notes">${tx.notes.map(note).join('')}</ul>` : '';
  const recapItem = (b) => {
    const gap = (b.label === 'verified' && /^not\b|^no\b/i.test(b.text)) || (b.label === 'left' && !/^(nothing|none)\b/i.test(b.text));
    const glyph = b.label ? (gap ? (b.label === 'left' ? '▲' : '✘') : RECAP_TYPES[b.label].glyph) : '›';
    return `<li class="note r-${b.label || 'plain'}${gap ? ' gap' : ''}"><span class="tag">${glyph} ${b.label}</span><span>${esc(b.text)}</span></li>`;
  };
  const recap = tx && tx.recap.length ? `<div class="recap"><h3>Recap</h3><ul class="notes">${tx.recap.map(recapItem).join('')}</ul></div>` : '';
  return `
<section class="turn${open ? '' : ' folded'}" id="turn-${ti + 1}">
  <a class="head" href="#turn-${ti + 1}"><h2>Turn ${ti + 1} <span>of ${total}</span></h2><p class="meta">${meta.map(esc).join(' · ')}${open ? '' : ' · <b>click to open</b>'}</p>
    <p class="ask">${esc(turn.prompt || '(no prompt)')}</p></a>
  <div class="body">
  ${inShort(turn) ? `<p class="short"><b>In short:</b> ${esc(inShort(turn))}</p>` : ''}
  ${healthHtml(turn)}
  ${turn.tools.length ? `<div class="flowwrap">${flowchartSvg(turn)}</div>` : ''}
  ${steps ? `<h3>What Claude did</h3><ol class="steps">${steps}</ol>` : '<p>Claude answered directly, without using any tools.</p>'}
  ${tree.length ? `<h3>Files <small>R read · E edited · N new</small></h3><pre class="tree">${esc(tree.join('\n'))}</pre>` : ''}
  ${fails.length ? `<h3 class="bad">Heads up: ${fails.length} failed</h3><ul>${fails.map((f) => `<li><code>${esc(f.tool)}</code> ${esc(f.detail || f.target || '')}</li>`).join('')}</ul>` : ''}
  ${diffHtml(turn, transcript, cwd)}
  ${notes}${recap}
  <p class="top"><a href="#prompts">↑ all prompts</a></p>
  </div>
</section>`;
}

export function renderHtml(events, opts = {}) {
  const turns = splitTurns(events).filter((t) => t.prompt || t.tools.length);
  const transcript = 'transcript' in opts ? opts.transcript : [...events].reverse().find((e) => e.transcript)?.transcript;
  const started = events.find((e) => e.t)?.t;
  const cwd = events.find((e) => e.cwd)?.cwd || '';
  const project = cwd.split(/[\\/]/).filter(Boolean).pop() || 'session';
  const order = turns.map((t, i) => i).reverse();
  const OPEN = 3;
  const index = turns.length > 1 ? `<nav id="prompts"><h2>Prompts <small>newest first · click one to jump to its diagram</small></h2><ol class="prompts">${
    order.map((i, k) => {
      const t = turns[i];
      const h = t.tools.length ? healthOf(t) : null;
      const mark = !h ? '' : h.unresolved.length ? '<span class="pm bad">▲</span>' : h.tests && !h.tests.passed ? '<span class="pm bad">✘</span>' : '<span class="pm ok">✔</span>';
      return `<li><a href="#turn-${i + 1}"><span class="pn">${i + 1}</span>${mark}<span class="pt">${esc(t.prompt || '(no prompt)')}</span><span class="ps">${t.tools.length} step${t.tools.length === 1 ? '' : 's'}${k < OPEN ? '' : ' · collapsed'}</span></a></li>`;
    }).join('')}</ol></nav>` : '';
  const body = turns.length
    ? index + order.map((i, k) => turnSection(turns[i], i, turns.length, transcript, cwd, k < OPEN)).join('\n')
    : '<p>Nothing recorded for this session yet.</p>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>what did · session report</title>
<style>
:root { --bg:#fbfaf7; --fg:#1d1d1b; --muted:#6b6a66; --card:#ffffff; --line:#e4e1da; --accent:#2f6fd6; --bad:#c2410c; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#141413; --fg:#ecebe6; --muted:#9d9b94; --card:#1d1d1b; --line:#33322f; --accent:#7aa7ff; --bad:#fb923c; color-scheme: dark; } }
:root[data-theme="dark"] { --bg:#141413; --fg:#ecebe6; --muted:#9d9b94; --card:#1d1d1b; --line:#33322f; --accent:#7aa7ff; --bad:#fb923c; color-scheme: dark; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 900px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 1.6rem; margin: 0 0 4px; }
.sub { color: var(--muted); margin: 0 0 24px; }
.turn { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 18px; margin: 0 0 16px; scroll-margin-top: 12px; }
.turn > .head { display:flex; flex-wrap:wrap; align-items:baseline; gap:4px 12px; color:inherit; text-decoration:none; }
.turn > .head .ask { flex-basis:100%; margin:6px 0 0; padding:8px 12px; border-left:3px solid var(--accent); background:color-mix(in srgb, var(--accent) 8%, transparent); border-radius:0 8px 8px 0; }
.turn.folded > .body { display:none; }
.turn.folded:target > .body { display:block; }
.turn.folded:not(:target) > .head .ask { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.turn.folded:not(:target) { opacity:.85; } .turn.folded:not(:target):hover { opacity:1; }
.turn.folded:target .meta b { display:none; }
.turn:target { border-color: var(--accent); }
#prompts { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:12px 16px; margin:0 0 20px; }
#prompts h2 { font-size:1.05rem; margin:0 0 8px; } #prompts h2 small { color:var(--muted); font-weight:400; font-size:.85rem; }
ol.prompts { list-style:none; margin:0; padding:0; display:grid; gap:2px; max-height: 18em; overflow-y:auto; }
ol.prompts a { display:grid; grid-template-columns: 2.2em 1.4em 1fr auto; gap:8px; align-items:baseline; padding:5px 8px; border-radius:8px; color:inherit; text-decoration:none; }
ol.prompts a:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.pn { color:var(--muted); text-align:right; font-variant-numeric: tabular-nums; } .pt { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ps { color:var(--muted); font-size:.85rem; white-space:nowrap; } .pm.ok { color:#16a34a; } .pm.bad { color: var(--bad); }
.top { text-align:right; margin:14px 0 0; font-size:.85rem; } .top a { color: var(--muted); }
.turn h2 { font-size:1.15rem; margin:0; } .turn h2 span { color:var(--muted); font-weight:400; }
.meta { color:var(--muted); margin:0; font-size:.9rem; }
h3 { font-size:.95rem; margin:18px 0 6px; } h3 small { color:var(--muted); font-weight:400; }
h3.bad { color: var(--bad); }
blockquote { margin:12px 0; padding:8px 12px; border-left:3px solid var(--accent); background:color-mix(in srgb, var(--accent) 8%, transparent); border-radius:0 8px 8px 0; }
pre { overflow-x:auto; font:13px/1.45 ui-monospace, "Cascadia Mono", Consolas, monospace; margin:0; }
pre.tree { background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:10px 12px; }
.flowwrap { background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:8px; margin-top:12px; overflow-x:auto; }
svg.flow { display:block; min-width:640px; font:12.5px ui-monospace, "Cascadia Mono", Consolas, monospace; }
svg.flow text { fill: var(--fg); }
svg.flow rect { fill: var(--card); stroke: var(--line); stroke-width: 1.2; }
svg.flow .fc-prompt rect { stroke: var(--accent); stroke-width: 1.6; }
svg.flow .fc-change rect { stroke: var(--accent); stroke-width: 2.4; }
svg.flow .fc-fail rect { stroke: var(--bad); stroke-width: 2; stroke-dasharray: 5 3; }
svg.flow .fc-file rect { fill: var(--bg); } svg.flow .fc-file text { fill: var(--muted); }
svg.flow .fc-flow { stroke: var(--muted); stroke-width: 1.4; fill: none; }
svg.flow marker path { fill: var(--muted); }
svg.flow .fc-read { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 3 3; fill: none; opacity: .7; }
svg.flow .fc-write { stroke: var(--accent); stroke-width: 2.2; fill: none; }
.short { margin: 10px 0 0; }
.health .tag { min-width: 8.5em; } .h-ok .tag { --c:#16a34a; } .h-bad .tag { --c: var(--bad); } .h-warn .tag { --c:#d97706; }
details { border:1px solid var(--line); border-radius:8px; margin:6px 0; background:var(--bg); }
details summary { cursor:pointer; padding:6px 10px; } details summary code { font-weight:600; }
.add { color:#16a34a; } .del { color: var(--bad); }
pre.diff { padding:8px 10px; border-top:1px solid var(--line); }
pre.diff .d-add { color:#16a34a; } pre.diff .d-del { color: var(--bad); } pre.diff .d-hunk { color: var(--accent); } pre.diff .d-ctx { color: var(--muted); }
ol.steps { padding-left: 1.4em; margin: 0; } ol.steps li { margin: 3px 0; overflow-wrap:anywhere; }
ul.notes { list-style:none; padding:0; margin:0; display:grid; gap:6px; }
li.note { display:grid; grid-template-columns: 7.5em 1fr; gap:10px; align-items:baseline; overflow-wrap:anywhere; }
.tag { --c: var(--muted); color: var(--c); background: color-mix(in srgb, var(--c) 12%, transparent); border:1px solid color-mix(in srgb, var(--c) 30%, transparent);
  border-radius: 999px; padding: 1px 10px; font: 600 12.5px/1.6 ui-monospace, "Cascadia Mono", Consolas, monospace; white-space: nowrap; justify-self:start; }
.n-why .tag { --c: var(--accent); } .n-plan .tag { --c: #8b5cf6; } .n-found .tag { --c: #0e9f9a; }
.n-done .tag, .r-verified .tag { --c: #16a34a; } .n-failed .tag, .gap .tag { --c: var(--bad); }
.n-risk .tag { --c: #d97706; } .n-need .tag { --c: #db2777; } .r-changed .tag { --c: var(--accent); }
.recap { margin-top: 18px; padding: 4px 14px 14px; border:1px solid var(--line); border-radius:10px; background: var(--bg); }
@media (max-width: 520px) { li.note { grid-template-columns: 1fr; gap: 2px; } }
code { font-family: ui-monospace, Consolas, monospace; font-size: .9em; }
footer { color:var(--muted); font-size:.85rem; text-align:center; margin-top: 32px; }
</style>
</head>
<body>
<main>
  <h1>what did: ${esc(project)}</h1>
  <p class="sub">${turns.length} turn${turns.length === 1 ? '' : 's'}${started ? ` · started ${esc(new Date(started).toLocaleString())}` : ''} · built from hook logs, no model calls</p>
  ${body}
  <footer>Generated by what did · type <code>wd</code> in Claude Code for the terminal version</footer>
</main>
</body>
</html>
`;
}

export function reportsDir() {
  return path.join(home(), 'reports');
}

// file: the session .jsonl; the report is named after it.
export function writeReport(file, events, opts = {}) {
  const out = path.join(reportsDir(), path.basename(file).replace(/\.jsonl$/, '') + '.html');
  fs.mkdirSync(path.dirname(out), PRIVATE_DIR);
  fs.writeFileSync(out, renderHtml(events, opts), PRIVATE_FILE);
  return out;
}

// Open in the default browser, detached; never blocks and never throws. WHATDID_NO_OPEN=1 disables it.
export function openInBrowser(file) {
  if (process.env.WHATDID_NO_OPEN) return false;
  try {
    // No shell on Windows: cmd /c start would re-parse the path, so hand it to the URL handler directly.
    const [cmd, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', file]]
      : process.platform === 'darwin' ? ['open', [file]] : ['xdg-open', [file]];
    spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return true;
  } catch { return false; }
}
