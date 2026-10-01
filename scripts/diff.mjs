// The lines Claude changed in a turn, read from Claude Code's own transcript (Edit / Write / MultiEdit results
// carry structured hunks with line numbers). what did stores no file contents itself; this reads what Claude Code
// already keeps on disk, only when you ask for it, and redacts secrets before showing anything.
import { readJsonl, redact, relPath } from './lib.mjs';

// [{ file, created, add, del, hunks: [{ oldStart, newStart, lines: [' ctx', '-old', '+new'] }] }] in edit order.
export function diffsFor(transcript, start, end, cwd = '') {
  if (!transcript) return [];
  const byFile = new Map();
  for (const l of readJsonl(transcript)) {
    const r = l.type === 'user' && !l.isSidechain && l.toolUseResult;
    if (!r || !r.filePath) continue;
    const ts = Date.parse(l.timestamp);
    if (!(ts >= start - 1000 && ts <= end + 5000)) continue;
    let hunks = Array.isArray(r.structuredPatch) ? r.structuredPatch : [];
    const created = r.type === 'create';
    if (created && !hunks.length && typeof r.content === 'string') {
      const lines = r.content.replace(/\n$/, '').split('\n');
      hunks = [{ oldStart: 0, newStart: 1, lines: lines.map((x) => `+${x}`) }];
    }
    if (!hunks.length) continue;
    const file = relPath(r.filePath, cwd) || r.filePath;
    const d = byFile.get(file) || { file, created: false, add: 0, del: 0, hunks: [] };
    d.created ||= created;
    for (const h of hunks) {
      const lines = (h.lines || []).map((x) => redact(String(x)));
      d.add += lines.filter((x) => x[0] === '+').length;
      d.del += lines.filter((x) => x[0] === '-').length;
      d.hunks.push({ oldStart: h.oldStart || 0, newStart: h.newStart || 0, lines });
    }
    byFile.set(file, d);
  }
  return [...byFile.values()];
}

// Text lines for one file's hunks: "  37   context", "  38 - old", "  38 + new", with a cap unless full.
export function diffLines(d, { full = false, cap = 60, S = { plus: '+', minus: '−' } } = {}) {
  const out = [];
  let shown = 0, total = 0;
  for (const h of d.hunks) {
    total += h.lines.length;
    if (!full && shown >= cap) continue;
    out.push(`@@ line ${h.newStart || h.oldStart} @@`);
    let o = h.oldStart, n = h.newStart;
    for (const raw of h.lines) {
      if (!full && shown >= cap) break;
      const mark = raw[0], text = raw.slice(1);
      if (mark === '-') out.push(`${String(o++).padStart(5)} - ${text}`);
      else if (mark === '+') out.push(`${String(n++).padStart(5)} + ${text}`);
      else { out.push(`${String(n).padStart(5)}   ${text}`); o++; n++; }
      shown++;
    }
  }
  if (!full && total > shown) out.push(`      +${total - shown} more lines`);
  return out;
}
