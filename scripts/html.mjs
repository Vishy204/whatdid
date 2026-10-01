// Writes a session as one self-contained HTML page: turns, steps, file tree and a Mermaid flowchart.
// Deterministic, no model calls. Mermaid loads from jsDelivr; without network the diagram source stays readable.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { home, PRIVATE_DIR, PRIVATE_FILE } from './lib.mjs';
import {
  splitTurns, groupSteps, describeStep, fileTree, touchedFiles, transcriptInfo, VERB, UNICODE, fmtK, fmtDur, NOTE_TYPES, RECAP_TYPES,
} from './render.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Mermaid label text inside ["..."]: quotes and markup-ish characters become entity codes.
export function mermaidLabel(s, n = 60) {
  let t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (t.length > n) t = t.slice(0, n - 1) + '…';
  return t.replace(/[#"<>{}[\]()|`;\\]/g, (c) => `#${c.charCodeAt(0)};`);
}

// Flowchart for one turn: prompt -> steps in order, with dotted "read" and thick "changed" edges to files.
export function mermaidFor(turn, ti) {
  const id = (k, i) => `t${ti}${k}${i}`;
  const lines = ['flowchart TD'];
  const steps = groupSteps(turn.tools).slice(0, 14);
  lines.push(`  ${id('p', 0)}(["${mermaidLabel(`You asked: ${turn.prompt || '(no prompt)'}`, 70)}"])`);
  let prev = id('p', 0);
  const files = [...touchedFiles(turn.tools).keys()];
  const shownFiles = new Map();
  const fileId = (f) => {
    if (!shownFiles.has(f)) {
      if (shownFiles.size >= 12) return null;
      shownFiles.set(f, id('f', shownFiles.size));
    }
    return shownFiles.get(f);
  };
  steps.forEach((st, i) => {
    const sid = id('s', i);
    const desc = [].concat(describeStep(st, UNICODE)).join('; ');
    const cls = st.group === 'change' ? ':::change' : st.items.some((x) => x.ok === false) ? ':::fail' : '';
    lines.push(`  ${sid}["${mermaidLabel(`${i + 1}. ${VERB[st.group]}: ${desc}`, 70)}"]${cls}`);
    lines.push(`  ${prev} --> ${sid}`);
    prev = sid;
    const seen = new Set();
    for (const it of st.items) {
      if (!files.includes(it.target) || seen.has(it.target)) continue;
      seen.add(it.target);
      const fid = fileId(it.target);
      if (!fid) continue;
      lines.push(it.kind === 'read' ? `  ${sid} -. reads .-> ${fid}` : `  ${sid} == changes ==> ${fid}`);
    }
  });
  for (const [f, fid] of shownFiles) lines.push(`  ${fid}[/"${mermaidLabel(f, 50)}"/]:::file`);
  lines.push('  classDef change stroke-width:3px', '  classDef fail stroke-dasharray:4 3', '  classDef file font-size:12px');
  return lines.join('\n');
}

function turnSection(turn, ti, total, transcript) {
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
<section class="turn" id="turn-${ti + 1}">
  <header><h2>Turn ${ti + 1} <span>of ${total}</span></h2><p class="meta">${meta.map(esc).join(' · ')}</p></header>
  ${turn.prompt ? `<blockquote>${esc(turn.prompt)}</blockquote>` : ''}
  ${turn.tools.length ? `<pre class="mermaid">${esc(mermaidFor(turn, ti))}</pre>` : ''}
  ${steps ? `<h3>What Claude did</h3><ol class="steps">${steps}</ol>` : '<p>Claude answered directly, without using any tools.</p>'}
  ${tree.length ? `<h3>Files <small>R read · E edited · N new</small></h3><pre class="tree">${esc(tree.join('\n'))}</pre>` : ''}
  ${fails.length ? `<h3 class="bad">Heads up: ${fails.length} failed</h3><ul>${fails.map((f) => `<li><code>${esc(f.tool)}</code> ${esc(f.detail || f.target || '')}</li>`).join('')}</ul>` : ''}
  ${notes}${recap}
</section>`;
}

export function renderHtml(events, opts = {}) {
  const turns = splitTurns(events).filter((t) => t.prompt || t.tools.length);
  const transcript = 'transcript' in opts ? opts.transcript : [...events].reverse().find((e) => e.transcript)?.transcript;
  const started = events.find((e) => e.t)?.t;
  const cwd = events.find((e) => e.cwd)?.cwd || '';
  const project = cwd.split(/[\\/]/).filter(Boolean).pop() || 'session';
  const body = turns.length
    ? turns.map((t, i) => turnSection(t, i, turns.length, transcript)).join('\n')
    : '<p>Nothing recorded for this session yet.</p>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">
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
.turn { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 18px; margin: 0 0 20px; }
.turn header { display:flex; flex-wrap:wrap; align-items:baseline; gap:4px 12px; }
.turn h2 { font-size:1.15rem; margin:0; } .turn h2 span { color:var(--muted); font-weight:400; }
.meta { color:var(--muted); margin:0; font-size:.9rem; }
h3 { font-size:.95rem; margin:18px 0 6px; } h3 small { color:var(--muted); font-weight:400; }
h3.bad { color: var(--bad); }
blockquote { margin:12px 0; padding:8px 12px; border-left:3px solid var(--accent); background:color-mix(in srgb, var(--accent) 8%, transparent); border-radius:0 8px 8px 0; }
pre { overflow-x:auto; font:13px/1.45 ui-monospace, "Cascadia Mono", Consolas, monospace; margin:0; }
pre.tree { background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:10px 12px; }
pre.mermaid { background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:12px; text-align:center; margin-top:12px; }
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
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.esm.min.mjs';
  const dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light';
  mermaid.initialize({ startOnLoad: true, securityLevel: 'strict', theme: dark ? 'dark' : 'neutral', flowchart: { useMaxWidth: true } });
</script>
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
