// Terminal colours for what did's text views (the same palette as the README GIFs).
// Claude Code shows hook text in one colour, so these are used where what did owns the terminal: the pane
// and the `whatdid` command. Colouring never changes the text, only how it looks.

import { stripControl } from './lib.mjs';

const rgb = (r, g, b) => [r, g, b];
const C = {
  fg: rgb(230, 237, 243), dim: rgb(125, 133, 144), faint: rgb(72, 79, 88), ink: rgb(13, 17, 23),
  cyan: rgb(53, 224, 197), violet: rgb(157, 140, 255), green: rgb(90, 208, 122), red: rgb(255, 107, 107),
  amber: rgb(240, 180, 41), pink: rgb(244, 114, 182), blue: rgb(121, 192, 255),
};
const GLYPH = { '◆': C.cyan, '◇': C.violet, '✔': C.green, '✘': C.red, '▲': C.amber, '◌': C.pink, '▸': C.violet, '✎': C.blue, '○': C.dim, '›': C.amber, '⧗': C.amber };
const LABEL = { why: C.cyan, found: C.violet, done: C.green, failed: C.red, risk: C.amber, need: C.pink, plan: C.violet, changed: C.blue, verified: C.green, left: C.dim };
// Section headings become coloured badges, one colour per section.
const HEADINGS = {
  'What Claude did': C.cyan, Files: C.blue, 'How it connects': C.violet, "In Claude's words": C.amber,
  "Claude's notes": C.amber, Recap: C.green, recap: C.green, Timeline: C.cyan,
  "Claude's answer": C.green, 'Latest from Claude': C.amber, 'Along the way': C.pink,
};
// The verb of a step, coloured by what kind of step it is.
const VERBS = {
  'Looked at': C.blue, Read: C.blue, Searched: C.blue, Listed: C.blue, 'Looked up': C.violet, Fetched: C.violet, 'Searched web': C.violet,
  Changed: C.amber, Edited: C.amber, Rewrote: C.amber, Created: C.green,
  Ran: C.cyan, Delegated: C.pink, 'Used skill': C.violet, Skill: C.violet, 'Used tool': C.violet, Tool: C.violet,
  Planned: C.violet, 'Asked you': C.pink, Used: C.violet,
};
const VERB_RE = new RegExp(`^(\\s*(?:\\d+\\.|\\+\\d\\d:\\d\\d)\\s+)(${Object.keys(VERBS).sort((a, b) => b.length - a.length).join('|')})\\b`);

function styles(line) {
  const n = line.length;
  const st = Array.from({ length: n }, () => ({ fg: C.fg, bg: null, bold: false }));
  const paint = (a, b, fg, bold = false, bg) => {
    for (let i = Math.max(0, a); i < Math.min(n, b); i++) {
      st[i].fg = fg; st[i].bold = bold || st[i].bold;
      if (bg !== undefined) st[i].bg = bg;
    }
  };
  const each = (re, fn) => { for (const m of line.matchAll(re)) fn(m); };

  each(/[│┌└├─]/g, (m) => paint(m.index, m.index + 1, C.faint));
  const head = line.match(/^┌─ (what did(?: replay)?)(.*)$/);
  if (head) {
    paint(0, 2, C.cyan, true);
    paint(3, 3 + head[1].length, C.cyan, true);
    paint(3 + head[1].length, n, C.dim);
    each(/still running/g, (m) => paint(m.index, m.index + m[0].length, C.amber, true));
  }
  const framed = /^[│|]/.test(line);
  const body = line.replace(/^[│| ]+/, '');
  const off = n - body.length;
  if (framed) {
    for (const [h, c] of Object.entries(HEADINGS)) {
      if (body === h || body.startsWith(`${h}  `) || body.startsWith(`${h} (`)) {
        paint(off - 1, off + h.length + 1, C.ink, true, c);
        paint(off + h.length + 1, n, C.dim);
      }
    }
    if (body.startsWith('You asked:')) { paint(off, off + 10, C.dim); paint(off + 10, n, C.fg, true); }
    if (body.startsWith('In short:')) paint(off, off + 9, C.pink, true);
    if (body.startsWith('Heads up')) paint(off, n, C.red, true);
    const v = body.match(VERB_RE);
    if (v) {
      paint(off, off + v[1].length, C.dim);
      paint(off + v[1].length, off + v[1].length + v[2].length, VERBS[v[2]], true);
    }
  }
  each(/([◆◇✔✘▲◌▸✎○›⧗])( ?\*{0,2})(why|found|done|failed|risk|need|plan|changed|verified|left)?/g, (x) => {
    paint(x.index, x.index + 1, GLYPH[x[1]], true);
    if (x[3]) { const a = x.index + 1 + x[2].length; paint(a, a + x[3].length, LABEL[x[3]], true); }
  });
  each(/(?<![\w/])\+\d+\b(?! more)/g, (x) => paint(x.index, x.index + x[0].length, C.green, true));
  each(/−\d+\b/g, (x) => paint(x.index, x.index + x[0].length, C.red, true));
  each(/\+\d{2}:\d{2}/g, (x) => paint(x.index, x.index + x[0].length, C.dim));
  // File tree: folders, and the R / E / N marks.
  if (/[├└]─ /.test(line)) {
    each(/[├└]─ (\S+\/)/g, (x) => paint(x.index + 3, x.index + 3 + x[1].length, C.blue, true));
    const mk = line.match(/\s(R E N|R E|R N|E N|R|E|N)(\s{2,}|$)/);
    if (mk) for (let i = mk.index + 1; i < mk.index + 1 + mk[1].length; i++) paint(i, i + 1, { R: C.dim, E: C.amber, N: C.green }[line[i]] || C.fg, true);
  }
  each(/\((?:→ step \d+|at the end)\)/g, (x) => paint(x.index, x.index + x[0].length, C.dim));
  each(/\+\d+ more( commands)?/g, (x) => paint(x.index, x.index + x[0].length, C.violet, true));
  // wd diff: added and removed lines, hunk headers and the changed file.
  if (framed) {
    const d = body.match(/^\s*\d+ ([+-]) /);
    if (d) paint(off, n, d[1] === '+' ? C.green : C.red);
    else if (/^\s*\d+ {3}/.test(body)) paint(off, n, C.dim);
    else if (/^@@ line \d+ @@$/.test(body)) paint(off, n, C.cyan);
    else if (/^› \S.*  \((new file, )?\+\d+ −\d+\)$/.test(body)) paint(off + 2, off + body.indexOf('  ('), C.blue, true);
  }
  each(/^┌─ (what did diff)/g, () => paint(3, 16, C.cyan, true));
  // Import chains.
  each(/──▶/g, (x) => paint(x.index, x.index + 3, C.violet, true));
  each(/\[edited\]/g, (x) => paint(x.index, x.index + x[0].length, C.amber));
  each(/\[new\]/g, (x) => paint(x.index, x.index + x[0].length, C.green));
  if (!body.startsWith('You asked:')) each(/"[^"]*"/g, (x) => paint(x.index, x.index + x[0].length, C.blue));
  // Repo map: headings, file lines and line numbers.
  if (/^# /.test(line)) paint(0, n, C.cyan, true);
  else if (/^## /.test(line)) paint(0, n, C.ink, true, C.blue);
  else if (/^\S.*\.\w+\s{2}\(/.test(line)) { const i = line.indexOf('  ('); paint(0, i, C.blue, true); paint(i, n, C.dim); }
  each(/\bL\d+\b|:\d+(?=[,\s}]|$)/g, (x) => paint(x.index, x.index + x[0].length, C.dim));
  each(/^\s+(fn|class|interface|type|struct|enum|trait|const)\b/g, (x) => paint(x.index, x.index + x[0].length, C.violet, true));
  return st;
}

const sgr = (s) => `\x1b[0;${s.bold ? '1;' : ''}38;2;${s.fg.join(';')}${s.bg ? `;48;2;${s.bg.join(';')}` : ''}m`;

export function colorize(text) {
  return stripControl(text).split('\n').map((line) => {
    if (!line) return line;
    const st = styles(line);
    let out = '', prev = '';
    for (let i = 0; i < line.length; i++) {
      const code = sgr(st[i]);
      if (code !== prev) { out += code; prev = code; }
      // U+FE0E asks for the text form of ✔/✘, so Windows draws them in our colour instead of as purple emoji.
      out += line[i] + (line[i] === '✔' || line[i] === '✘' ? '︎' : '');
    }
    return out + '\x1b[0m';
  }).join('\n');
}
