// Shared helpers for whatdid. Zero dependencies, Node >= 18.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function home() {
  return process.env.WHATDID_HOME || path.join(os.homedir(), '.whatdid');
}

export function config() {
  try { return JSON.parse(fs.readFileSync(path.join(home(), 'config.json'), 'utf8')); } catch { return {}; }
}

// Opt-in: put the repo map into Claude's context at session start (one cached ~2k-token block, no extra turn).
// Opt-in: print a one-line whatdid card after every turn (zero tokens, shown to the user only).
// On by default: it's how people discover `wd`. `/whatdid:setup auto off` stores autoCard: false.
export function autoCardEnabled() {
  const env = process.env.WHATDID_AUTO;
  return env ? env === '1' : config().autoCard !== false;
}

// A desktop notification when a long turn finishes, so you can walk away while Claude works.
// Claude Code writes the escape sequence itself (hooks have no tty) and only allows notification OSCs.
export const NOTIFY_MIN_MS = Number(process.env.WHATDID_NOTIFY_MIN_MS) || 20_000;
export function notifyEnabled() {
  const env = process.env.WHATDID_NOTIFY;
  return env ? env === '1' : config().notify !== false;
}
export function notifySequence(title, body, env = process.env) {
  const clean = (s) => String(s).replace(/[\x00-\x1f\x7f;]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
  const [t, b] = [clean(title), clean(body)];
  if (env.KITTY_WINDOW_ID) return `\x1b]99;;${t}: ${b}\x1b\\`;
  if (/ghostty|warp/i.test(env.TERM_PROGRAM || '')) return `\x1b]777;notify;${t};${b}\x07`;
  return `\x1b]9;${t}: ${b}\x07`; // Windows Terminal, iTerm2, WezTerm, ConEmu
}

// Logs hold your prompts and commands, so ~/.whatdid is private to you (0700 dirs, 0600 files on macOS/Linux;
// Windows ignores the mode and the folder inherits your user profile's permissions).
export const PRIVATE_DIR = { recursive: true, mode: 0o700 };
export const PRIVATE_FILE = { mode: 0o600 };

// Untrusted text (file names, commands, Claude's words) must not carry terminal escape sequences to the screen:
// they could retitle the window, rewrite the clipboard or fake output. Tabs become spaces; newlines are kept.
export const stripControl = (s) => String(s ?? '').replace(/\t/g, '  ').replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '');

// mkdir's mode only applies to new folders, so tighten what an older version may have created 0755/0644.
export function tightenPermissions() {
  if (process.platform === 'win32') return;
  const dirs = ['', 'sessions', 'reports', 'pane', 'bin', 'maps'].map((d) => path.join(home(), d));
  for (const d of dirs) {
    let entries;
    try { fs.chmodSync(d, 0o700); entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) if (e.isFile()) try { fs.chmodSync(path.join(d, e.name), 0o600); } catch {}
  }
}

export function saveConfig(patch) {
  const next = { ...config(), ...patch };
  fs.mkdirSync(home(), PRIVATE_DIR);
  fs.writeFileSync(path.join(home(), 'config.json'), JSON.stringify(next, null, 2) + '\n', PRIVATE_FILE);
  return next;
}

// The first few new sessions after install say how to use what did, then it stays quiet.
export const WELCOME_SESSIONS = 3;
export function takeWelcome() {
  if (process.env.WHATDID_WELCOME === '0') return false;
  const seen = config().welcomed || 0;
  if (seen >= WELCOME_SESSIONS) return false;
  saveConfig({ welcomed: seen + 1 });
  return true;
}

// Auto-map: false (the default), true (every session) or 'auto' (only above AUTOMAP_MIN_TOKENS of source).
// It's off by default because it's the one feature that adds tokens to every session, and its savings vary
// by codebase: bench/results has one private codebase at -25% cost, excalidraw/hugo about even, pydantic +24%.
export const AUTOMAP_MIN_TOKENS = Number(process.env.WHATDID_AUTOMAP_MIN) || 400_000;
export function autoMapMode() {
  const env = process.env.WHATDID_AUTOMAP;
  if (env === '1') return true;
  if (env === '0') return false;
  if (env === 'auto') return 'auto';
  const c = config().autoMap;
  return c === true || c === 'auto' ? c : false;
}
export const autoMapEnabled = () => autoMapMode() !== false;

export function sessionsDir() {
  return path.join(home(), 'sessions');
}

export function sessionFile(id) {
  const safe = String(id || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
  return path.join(sessionsDir(), `${safe}.jsonl`);
}

export function appendEvent(sessionId, event) {
  fs.mkdirSync(home(), PRIVATE_DIR);
  fs.mkdirSync(sessionsDir(), PRIVATE_DIR);
  fs.appendFileSync(sessionFile(sessionId), JSON.stringify(event) + '\n', PRIVATE_FILE);
}

// Tolerant JSONL reader: skips corrupt lines instead of throwing.
export function readJsonl(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out;
}

export function readEvents(file) {
  return readJsonl(file).sort((a, b) => (a.t || 0) - (b.t || 0));
}

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');

function sameDir(a, b) {
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

// Pick the session to explain: explicit id if it exists, else the newest session started in cwd,
// else the newest session overall.
export function findSession({ sessionId, cwd } = {}) {
  if (sessionId && !sessionId.includes('${')) {
    const f = sessionFile(sessionId);
    if (fs.existsSync(f)) return f;
  }
  let files;
  try {
    files = fs.readdirSync(sessionsDir())
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(sessionsDir(), f))
      .map((f) => ({ f, m: fs.statSync(f).mtimeMs }))
      .sort((a, b) => b.m - a.m);
  } catch { return null; }
  if (!files.length) return null;
  if (cwd) {
    for (const { f } of files.slice(0, 50)) {
      const first = readHead(f);
      if (first && sameDir(first.cwd, cwd)) return f;
    }
  }
  return files[0].f;
}

function readHead(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return JSON.parse(buf.subarray(0, n).toString('utf8').split('\n')[0]);
  } catch { return null; }
}

// Path relative to cwd with forward slashes; absolute paths outside cwd are kept (shortened by ~).
export function relPath(p, cwd) {
  if (!p) return '';
  const P = norm(p);
  const C = norm(cwd);
  if (C) {
    const inside = process.platform === 'win32'
      ? P.toLowerCase().startsWith(C.toLowerCase() + '/')
      : P.startsWith(C + '/');
    if (inside) return P.slice(C.length + 1);
    if (sameDir(P, C)) return '.';
  }
  const h = norm(os.homedir());
  if (h && P.toLowerCase().startsWith(h.toLowerCase() + '/')) return '~/' + P.slice(h.length + 1);
  return P;
}

const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '***'],
  [/\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|npm_[A-Za-z0-9]{30,}|(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,})\b/g, '***'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '***'],
  // Authorization / Proxy-Authorization / Cookie / Set-Cookie: the whole value, whatever the scheme.
  [/\b((?:proxy-)?authorization|set-cookie|cookie)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\r\n"']+)/gi, '$1$2***'],
  [/\b(bearer|basic|token|digest)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***'],
  // Passwords inside URLs: https://user:pass@host, postgres://user:pass@db
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s@/]+@/gi, '$1:***@'],
  // --password hunter2, -p=secret style flags
  [/(--?(?:password|passwd|pass|token|secret|api[_-]?key|access[_-]?key|auth|cookie)[ =])("[^"]*"|'[^']*'|\S+)/gi, '$1***'],
  [/\b([A-Za-z_]*(?:api[_-]?key|token|secret|passw(?:or)?d|pwd)[A-Za-z_]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1$2***'],
];

export function redact(s) {
  let out = String(s ?? '');
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

export function clip(s, n) {
  const str = String(s ?? '').replace(/\s+/g, ' ').trim();
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

const lines = (s) => (s ? String(s).split('\n').length : 0);

const KIND = {
  Read: 'read', NotebookRead: 'read',
  Grep: 'search', Glob: 'search', LS: 'search',
  Edit: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit',
  Write: 'write',
  Bash: 'run', PowerShell: 'run', BashOutput: 'run', Monitor: 'run',
  WebFetch: 'web', WebSearch: 'web',
  Task: 'agent', Agent: 'agent',
  Skill: 'skill',
  TodoWrite: 'plan', TaskCreate: 'plan', TaskUpdate: 'plan', EnterPlanMode: 'plan', ExitPlanMode: 'plan',
  AskUserQuestion: 'ask',
};

export function kindOf(tool) {
  if (KIND[tool]) return KIND[tool];
  if (String(tool).startsWith('mcp__')) return 'mcp';
  return 'other';
}

// Reduce a raw hook payload to the few fields the renderer needs. Never stores file contents.
export function summarizeTool(tool, input = {}, response, cwd) {
  const kind = kindOf(tool);
  const e = { tool, kind };
  const file = input.file_path || input.notebook_path || input.path;
  switch (kind) {
    case 'read':
      e.target = relPath(file, cwd);
      break;
    case 'search':
      e.target = relPath(input.path || '', cwd) || '.';
      e.detail = clip(redact(input.pattern || ''), 60);
      break;
    case 'edit': {
      e.target = relPath(file, cwd);
      const edits = Array.isArray(input.edits) ? input.edits : [input];
      e.add = 0; e.del = 0;
      for (const ed of edits) {
        e.add += lines(ed.new_string ?? ed.new_source);
        e.del += lines(ed.old_string);
      }
      break;
    }
    case 'write': {
      e.target = relPath(file, cwd);
      e.add = lines(input.content);
      const created = response && typeof response === 'object' && response.type === 'create';
      if (created) e.created = true;
      break;
    }
    case 'run':
      e.detail = clip(redact(tidyCommand(input.command || input.bash_id || '', cwd)), 120);
      if (input.description) e.why = clip(redact(input.description), 80);
      if (response && typeof response === 'object' && response.interrupted) e.ok = false;
      break;
    case 'web':
      e.detail = clip(redact(input.query || hostOf(input.url)), 80);
      break;
    case 'agent':
      e.detail = clip(redact(input.description || input.prompt || ''), 80);
      e.target = input.subagent_type || 'agent';
      break;
    case 'skill':
      e.target = input.skill || input.command || '';
      break;
    case 'mcp': {
      const [, server, name] = String(tool).split('__');
      e.target = `${server}:${name}`;
      break;
    }
    case 'plan':
    case 'ask':
      break;
    default:
      if (file) e.target = relPath(file, cwd);
  }
  return e;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Drop a leading `cd "<cwd>" &&` and show the project dir as "." so commands read like what they do.
export function tidyCommand(cmd, cwd) {
  let c = String(cmd);
  if (cwd) {
    const forms = [...new Set([cwd, cwd.replace(/\\/g, '/'), cwd.replace(/\//g, '\\')])].map(escapeRe).join('|');
    c = c.replace(new RegExp(`^\\s*cd\\s+(?:"(?:${forms})"|'(?:${forms})'|(?:${forms}))\\s*(?:&&|;)\\s*`, 'i'), '');
    c = c.replace(new RegExp(`(["']?)(?:${forms})(["']?)`, 'gi'), (m, a, b) => (a && a === b ? '.' : `${a}.${b}`));
  }
  return c;
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return String(url || ''); }
}
