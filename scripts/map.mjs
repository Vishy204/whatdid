#!/usr/bin/env node
// Repo map: a compact, ranked summary of a codebase that Claude reads instead of exploring file by file.
// Deterministic and zero-dependency: regex symbol extraction + import graph + PageRank, cached per file.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { home } from './lib.mjs';

const CACHE_VERSION = 2; // 2: symbol line numbers and file line counts
const MAX_BYTES = 256 * 1024;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'target', 'vendor', '.venv', 'venv',
  '__pycache__', 'coverage', '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', '.idea', '.vscode', '.whatdid', '.tox', '.mypy_cache', '.pytest_cache',
  'AppData', 'Library', 'site-packages', 'bower_components', 'Pods', 'DerivedData']);
const LANG = {
  '.js': 'js', '.jsx': 'js', '.mjs': 'js', '.cjs': 'js', '.ts': 'ts', '.tsx': 'ts', '.mts': 'ts', '.cts': 'ts',
  '.py': 'py', '.go': 'go', '.rs': 'rs', '.java': 'java',
};
const JS_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.d.ts'];
const TEST_RE = /(^|\/)(tests?|__tests__|spec|testdata|fixtures?|examples?)\/|[._-](test|spec)\.\w+$|_test\.go$|(^|\/)test_[^/]*\.py$/;
const ENTRY_RE = /(^|\/)(main|index|app|cli|server|lib|mod|__init__|__main__)\.\w+$/;

const posix = (p) => p.replace(/\\/g, '/');
const clipSig = (s, n = 90) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

// ---------- file walk ----------

function gitignoreMatchers(root) {
  let text = '';
  try { text = fs.readFileSync(path.join(root, '.gitignore'), 'utf8'); } catch { return []; }
  const out = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.slice(0, -1);
    const anchored = line.startsWith('/') || line.includes('/');
    line = line.replace(/^\//, '');
    const re = line.split('**').map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')).join('.*');
    out.push({ re: new RegExp(`^${re}$`), anchored, dirOnly });
  }
  return out;
}

function ignored(matchers, rel, isDir) {
  const base = rel.slice(rel.lastIndexOf('/') + 1);
  for (const m of matchers) {
    if (m.dirOnly && !isDir) continue;
    if (m.re.test(m.anchored ? rel : base)) return true;
  }
  return false;
}

// Guard rails so a map started in a huge folder (e.g. a home directory) stays fast.
export const MAX_FILES = 5000;
const MAX_DIRS = 20000;

export function walk(root) {
  const matchers = gitignoreMatchers(root);
  const files = [];
  let dirs = 0;
  const visit = (dir, relDir) => {
    if (files.length >= MAX_FILES || ++dirs > MAX_DIRS) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || (e.name.startsWith('.') && e.name !== '.github') || ignored(matchers, rel, true)) continue;
        visit(path.join(dir, e.name), rel);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (!LANG[ext] || ignored(matchers, rel, false)) continue;
        if (/\.min\.js$|\.d\.ts$/.test(e.name) && !/index\.d\.ts$/.test(e.name)) continue;
        files.push(rel);
      }
    }
  };
  visit(root, '');
  return files.sort();
}

// ---------- symbol + import extraction ----------

const JS_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'else', 'do', 'try', 'with', 'new', 'await', 'typeof', 'super']);

function parseJs(text) {
  const symbols = [], imports = [];
  let cls = null;
  let ln = 0;
  for (const line of text.split(/\r?\n/)) {
    ln++;
    let m;
    if (/^\S/.test(line)) {
      if (/^}/.test(line)) { cls = null; continue; }
      const x = /^export\b/.test(line);
      if ((m = line.match(/^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\*?\s*(\w*)\s*(<[^>]*>)?\s*\(([^)]*)\)?\s*(?::\s*([^{=]+))?/))) {
        symbols.push({ l: ln, k: 'fn', n: m[1] || 'default', sig: `${m[1] || 'default'}(${m[3] ?? ''})${m[4] ? ': ' + m[4].trim() : ''}`, x });
      } else if ((m = line.match(/^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+(\w+)(?:<[^>]*>)?(\s+extends\s+[\w.]+)?/))) {
        cls = { l: ln, k: 'class', n: m[1], sig: `class ${m[1]}${m[2] ? m[2].replace(/\s+/g, ' ') : ''}`, x, methods: [] };
        symbols.push(cls);
        if (/}\s*;?\s*$/.test(line)) cls = null;
        continue;
      } else if ((m = line.match(/^(?:export\s+)?(?:declare\s+)?(interface|type|enum)\s+(\w+)/))) {
        symbols.push({ l: ln, k: 'type', n: m[2], sig: `${m[1]} ${m[2]}`, x });
      } else if ((m = line.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\s*\*?\s*\w*\s*)?(\([^)]*\)|\w+)\s*(?:=>|\{|$)/)) && (/=>|function/.test(line))) {
        const params = m[2].startsWith('(') ? m[2] : `(${m[2]})`;
        symbols.push({ l: ln, k: 'fn', n: m[1], sig: `${m[1]}${params}`, x });
      } else if (x && (m = line.match(/^export\s+(?:const|let|var)\s+(\w+)/))) {
        symbols.push({ l: ln, k: 'const', n: m[1], sig: `const ${m[1]}`, x });
      } else if ((m = line.match(/^module\.exports\s*=\s*(\w+)/))) {
        symbols.push({ l: ln, k: 'const', n: m[1], sig: `module.exports = ${m[1]}`, x: true });
      }
    } else if (cls && (m = line.match(/^(?: {2}| {4}|\t)(?:public\s+|protected\s+|static\s+|async\s+|readonly\s+|override\s+|get\s+|set\s+)*([A-Za-z]\w*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::[^{]+)?\{.*$/))) {
      if (!JS_KEYWORDS.has(m[1]) && !/^\s*(private)\b/.test(line)) (cls.methods.push(m[1]), (cls.ml ||= []).push(ln));
    }
    const re = /(?:^|[^.\w])(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"]+)['"]|(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((m = re.exec(line))) imports.push(m[1] || m[2]);
  }
  return { symbols, imports };
}

function parsePy(text) {
  const symbols = [], imports = [];
  let cls = null;
  let ln = 0;
  for (const line of text.split(/\r?\n/)) {
    ln++;
    let m;
    if ((m = line.match(/^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)?\s*(?:->\s*([^:]+))?/))) {
      cls = null;
      symbols.push({ l: ln, k: 'fn', n: m[1], sig: `${m[1]}(${m[2]}${line.includes(')') ? '' : '…'})${m[3] ? ' -> ' + m[3].trim() : ''}`, x: !m[1].startsWith('_') });
    } else if ((m = line.match(/^class\s+(\w+)\s*(\([^)]*\))?\s*:/))) {
      cls = { l: ln, k: 'class', n: m[1], sig: `class ${m[1]}${m[2] || ''}`, x: !m[1].startsWith('_'), methods: [] };
      symbols.push(cls);
    } else if (cls && (m = line.match(/^(?: {4}|\t)(?:async\s+)?def\s+(\w+)\s*\(/))) {
      if (!m[1].startsWith('_') || m[1] === '__init__' || m[1] === '__call__') (cls.methods.push(m[1]), (cls.ml ||= []).push(ln));
    } else if ((m = line.match(/^([A-Z][A-Z0-9_]{2,})\s*(?::[^=]+)?=/))) {
      cls = null;
      symbols.push({ l: ln, k: 'const', n: m[1], sig: m[1], x: true });
    } else if (/^[^\s#@)\]]/.test(line)) {
      cls = null;
    }
    if ((m = line.match(/^\s*from\s+(\.*[\w.]*)\s+import\s+\(?\s*([\w\s,*]+)/))) {
      imports.push({ from: m[1], names: m[2].split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean) });
    } else if ((m = line.match(/^\s*import\s+([\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*)/))) {
      for (const part of m[1].split(',')) imports.push({ from: part.trim().split(/\s+/)[0], names: [] });
    }
  }
  return { symbols, imports };
}

function parseGo(text) {
  const symbols = [], imports = [];
  let inImport = false, pkg = '';
  let ln = 0;
  for (const line of text.split(/\r?\n/)) {
    ln++;
    let m;
    if ((m = line.match(/^package\s+(\w+)/))) pkg = m[1];
    else if ((m = line.match(/^func\s+\(\s*\w*\s*\*?(\w+)(?:\[[^\]]*\])?\s*\)\s+(\w+)\s*\(([^)]*)\)?/))) {
      symbols.push({ l: ln, k: 'method', n: m[2], p: m[1], sig: `(${m[1]}) ${m[2]}(${m[3]})`, x: /^[A-Z]/.test(m[2]) });
    } else if ((m = line.match(/^func\s+(\w+)\s*(?:\[[^\]]*\])?\s*\(([^)]*)\)?\s*([^{]*)/))) {
      symbols.push({ l: ln, k: 'fn', n: m[1], sig: `${m[1]}(${m[2]})${m[3].trim() ? ' ' + m[3].trim() : ''}`, x: /^[A-Z]/.test(m[1]) });
    } else if ((m = line.match(/^type\s+(\w+)\s+(struct|interface|func|[\w.[\]*]+)/))) {
      symbols.push({ l: ln, k: m[2] === 'struct' || m[2] === 'interface' ? 'class' : 'type', n: m[1], sig: `type ${m[1]} ${m[2]}`, x: /^[A-Z]/.test(m[1]), methods: [] });
    } else if ((m = line.match(/^import\s+(?:\w+\s+)?"([^"]+)"/))) imports.push(m[1]);
    else if (/^import\s*\(/.test(line)) inImport = true;
    else if (inImport) {
      if (/^\s*\)/.test(line)) inImport = false;
      else if ((m = line.match(/^\s*(?:[\w.]+\s+)?"([^"]+)"/))) imports.push(m[1]);
    }
  }
  // Attach methods to their receiver type.
  const types = new Map(symbols.filter((s) => s.methods).map((s) => [s.n, s]));
  const out = [];
  for (const s of symbols) {
    if (s.k === 'method' && types.has(s.p)) types.get(s.p).methods.push(s.n);
    else out.push(s);
  }
  return { symbols: out, imports, pkg };
}

function parseRs(text) {
  const symbols = [], imports = [];
  let impl = null;
  let ln = 0;
  for (const line of text.split(/\r?\n/)) {
    ln++;
    let m;
    if (/^}/.test(line)) { impl = null; continue; }
    if ((m = line.match(/^(pub(?:\([\w:]+\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)?\s*(?:->\s*([^{]+))?/))) {
      symbols.push({ l: ln, k: 'fn', n: m[2], sig: `${m[2]}(${m[3]})${m[4] ? ' -> ' + m[4].trim().replace(/\s*where.*$/, '') : ''}`, x: !!m[1] });
    } else if ((m = line.match(/^(pub(?:\([\w:]+\))?\s+)?(struct|enum|trait|type)\s+(\w+)/))) {
      symbols.push({ l: ln, k: m[2] === 'type' ? 'type' : 'class', n: m[3], sig: `${m[2]} ${m[3]}`, x: !!m[1], methods: [] });
    } else if ((m = line.match(/^impl(?:<[^>]*>)?\s+(?:([\w:]+)(?:<[^>]*>)?\s+for\s+)?(\w+)/))) {
      impl = m[2];
    } else if (impl && (m = line.match(/^\s{4}(?:pub(?:\([\w:]+\))?\s+)?(?:async\s+)?fn\s+(\w+)/))) {
      const t = symbols.find((s) => s.n === impl && s.methods);
      if (t) t.methods.push(m[1]);
    }
    if ((m = line.match(/^\s*(?:pub(?:\([\w:]+\))?\s+)?mod\s+(\w+)\s*;/))) imports.push({ mod: m[1] });
    else if ((m = line.match(/^\s*(?:pub(?:\([\w:]+\))?\s+)?use\s+((?:crate|super|self)::[\w:]+)/))) imports.push({ use: m[1] });
  }
  return { symbols, imports };
}

function parseJava(text) {
  const symbols = [], imports = [];
  let pkg = '', cls = null;
  let ln = 0;
  for (const line of text.split(/\r?\n/)) {
    ln++;
    let m;
    if ((m = line.match(/^\s*package\s+([\w.]+)\s*;/))) pkg = m[1];
    else if ((m = line.match(/^\s*import\s+(?:static\s+)?([\w.]+)(?:\.\*)?\s*;/))) imports.push(m[1]);
    else if ((m = line.match(/^\s*(public\s+|protected\s+|private\s+)?(?:(?:abstract|final|static|sealed)\s+)*(class|interface|enum|record)\s+(\w+)/))) {
      const c = { l: ln, k: 'class', n: m[3], sig: `${m[2]} ${m[3]}`, x: /public/.test(m[1] || ''), methods: [] };
      symbols.push(c);
      cls ||= c;
    } else if (cls && (m = line.match(/^\s+(?:@\w+\s+)*(public|protected)\s+(?:(?:static|final|abstract|synchronized|default)\s+)*(?:<[^>]+>\s+)?[\w<>[\],.? ]+\s+(\w+)\s*\(/))) {
      (cls.methods.push(m[2]), (cls.ml ||= []).push(ln));
    }
  }
  return { symbols, imports, pkg };
}

const PARSERS = { js: parseJs, ts: parseJs, py: parsePy, go: parseGo, rs: parseRs, java: parseJava };

// ---------- import resolution ----------

function makeResolver(root, files) {
  const set = new Set(files);
  const byDir = new Map();
  for (const f of files) {
    const d = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d).push(f);
  }

  // Python: dotted module name -> file, stripping leading dirs that aren't packages (e.g. src/).
  const pyMods = new Map();
  for (const f of files) {
    if (!f.endsWith('.py')) continue;
    const parts = f.replace(/\.py$/, '').split('/');
    if (parts[parts.length - 1] === '__init__') parts.pop();
    for (let i = 0; i < parts.length; i++) {
      const name = parts.slice(i).join('.');
      if (name && !pyMods.has(name)) pyMods.set(name, f);
      const dir = parts.slice(0, i + 1).join('/');
      if (set.has(`${dir}/__init__.py`)) break;
    }
  }

  let goModule = '';
  try { goModule = (fs.readFileSync(path.join(root, 'go.mod'), 'utf8').match(/^module\s+(\S+)/m) || [])[1] || ''; } catch {}

  const javaFqn = new Map();

  const norm = (p) => {
    const out = [];
    for (const seg of p.split('/')) {
      if (seg === '..') out.pop();
      else if (seg && seg !== '.') out.push(seg);
    }
    return out.join('/');
  };

  const js = (from, spec) => {
    if (!spec.startsWith('.')) return [];
    const base = norm(`${from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : ''}/${spec}`);
    const stem = base.replace(/\.(m?js|cjs|jsx)$/, '');
    const cands = [base, ...JS_EXT.map((e) => stem + e), ...JS_EXT.map((e) => `${base}/index${e}`)];
    const hit = cands.find((c) => set.has(c));
    return hit ? [hit] : [];
  };

  const py = (from, imp) => {
    let mod = imp.from;
    if (mod.startsWith('.')) {
      const level = mod.match(/^\.+/)[0].length;
      const pkgParts = from.replace(/\.py$/, '').split('/');
      pkgParts.pop();
      for (let i = 1; i < level; i++) pkgParts.pop();
      const rest = mod.slice(level);
      const dir = [...pkgParts, ...(rest ? rest.split('.') : [])].join('/');
      const out = [];
      for (const n of imp.names) {
        if (set.has(`${dir}/${n}.py`)) out.push(`${dir}/${n}.py`);
        else if (set.has(`${dir}/${n}/__init__.py`)) out.push(`${dir}/${n}/__init__.py`);
      }
      if (!out.length) {
        if (set.has(`${dir}.py`)) out.push(`${dir}.py`);
        else if (set.has(`${dir}/__init__.py`)) out.push(`${dir}/__init__.py`);
      }
      return out;
    }
    const out = [];
    for (const n of imp.names) if (pyMods.has(`${mod}.${n}`)) out.push(pyMods.get(`${mod}.${n}`));
    if (!out.length) {
      // Longest matching prefix of the dotted path.
      const parts = mod.split('.');
      for (let i = parts.length; i > 0; i--) {
        const name = parts.slice(0, i).join('.');
        if (pyMods.has(name)) { out.push(pyMods.get(name)); break; }
      }
    }
    return out;
  };

  const go = (from, spec) => {
    if (!goModule || !(spec === goModule || spec.startsWith(goModule + '/'))) return [];
    const dir = spec.slice(goModule.length + 1);
    return (byDir.get(dir) || []).filter((f) => f.endsWith('.go') && !f.endsWith('_test.go'));
  };

  const rs = (from, imp) => {
    const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
    const stemName = from.slice(from.lastIndexOf('/') + 1).replace(/\.rs$/, '');
    if (imp.mod) {
      const base = ['main', 'lib', 'mod'].includes(stemName) ? dir : `${dir ? dir + '/' : ''}${stemName}`;
      const p = base ? `${base}/` : '';
      return [`${p}${imp.mod}.rs`, `${p}${imp.mod}/mod.rs`].filter((c) => set.has(c)).slice(0, 1);
    }
    const parts = imp.use.split('::');
    let baseDir;
    if (parts[0] === 'crate') {
      const crateRoot = files.find((f) => /(^|\/)src\/(lib|main)\.rs$/.test(f) && (from.startsWith(f.replace(/(lib|main)\.rs$/, ''))));
      baseDir = crateRoot ? crateRoot.replace(/\/(lib|main)\.rs$/, '') : 'src';
    } else if (parts[0] === 'super') {
      baseDir = ['mod', 'lib', 'main'].includes(stemName) ? dir.split('/').slice(0, -1).join('/') : dir;
    } else {
      baseDir = ['mod', 'lib', 'main'].includes(stemName) ? dir : `${dir ? dir + '/' : ''}${stemName}`;
    }
    const segs = parts.slice(1);
    for (let i = segs.length; i > 0; i--) {
      const p = [baseDir, ...segs.slice(0, i)].filter(Boolean).join('/');
      for (const c of [`${p}.rs`, `${p}/mod.rs`]) if (set.has(c) && c !== from) return [c];
    }
    return [];
  };

  const java = (from, fqn) => (javaFqn.has(fqn) ? [javaFqn.get(fqn)] : []);

  return { js, ts: js, py, go, rs, java, javaFqn };
}

// ---------- ranking ----------

export function pagerank(files, edges, personalize = () => 1, { d = 0.85, iters = 20 } = {}) {
  const n = files.length;
  if (!n) return new Map();
  const idx = new Map(files.map((f, i) => [f, i]));
  const out = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) if (idx.has(a) && idx.has(b) && a !== b) out[idx.get(a)].push(idx.get(b));
  let p = files.map((f) => personalize(f));
  const ps = p.reduce((a, b) => a + b, 0) || 1;
  p = p.map((x) => x / ps);
  let r = p.slice();
  for (let it = 0; it < iters; it++) {
    const next = new Array(n).fill(0);
    let dangling = 0;
    for (let i = 0; i < n; i++) {
      if (!out[i].length) { dangling += r[i]; continue; }
      const share = r[i] / out[i].length;
      for (const j of out[i]) next[j] += d * share;
    }
    for (let i = 0; i < n; i++) next[i] += (1 - d) * p[i] + d * dangling * p[i];
    r = next;
  }
  return new Map(files.map((f, i) => [f, r[i]]));
}

// ---------- build ----------

function cachePath(root) {
  const h = crypto.createHash('sha1').update(posix(path.resolve(root)).toLowerCase()).digest('hex');
  return path.join(home(), 'maps', `${h}.json`);
}

export function buildMap(root, opts = {}) {
  const t0 = Date.now();
  root = path.resolve(root || '.');
  const cp = cachePath(root);
  let cache = { v: CACHE_VERSION, files: {} };
  if (opts.cache !== false) {
    try {
      const c = JSON.parse(fs.readFileSync(cp, 'utf8'));
      if (c.v === CACHE_VERSION) cache = c;
    } catch {}
  }
  const files = walk(root);
  const info = {};
  let parsed = 0, reused = 0, dirty = false;
  for (const f of files) {
    const abs = path.join(root, f);
    let st;
    try { st = fs.statSync(abs); } catch { continue; }
    if (st.size > MAX_BYTES) continue;
    const c = cache.files[f];
    if (c && c.m === st.mtimeMs && c.s === st.size) { info[f] = c; reused++; continue; }
    let text;
    try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    if (text.slice(0, 8000).includes('\0')) continue;
    const lang = LANG[path.extname(f).toLowerCase()];
    const r = PARSERS[lang](text);
    const lines = text.split('\n').length;
    info[f] = { m: st.mtimeMs, s: st.size, lang, chars: text.length, lines, symbols: r.symbols, imports: r.imports, pkg: r.pkg };
    parsed++; dirty = true;
  }
  if (Object.keys(cache.files).some((f) => !info[f])) dirty = true;
  if (dirty && opts.cache !== false) {
    try {
      fs.mkdirSync(path.dirname(cp), { recursive: true });
      fs.writeFileSync(cp, JSON.stringify({ v: CACHE_VERSION, root: posix(root), files: info }));
    } catch {}
  }

  const list = Object.keys(info).sort();
  const res = makeResolver(root, list);
  for (const f of list) {
    const i = info[f];
    if (i.lang === 'java' && i.pkg) res.javaFqn.set(`${i.pkg}.${f.slice(f.lastIndexOf('/') + 1).replace(/\.java$/, '')}`, f);
  }
  const edgeSet = new Set();
  const edges = [];
  for (const f of list) {
    const i = info[f];
    for (const imp of i.imports || []) {
      for (const to of res[i.lang](f, imp)) {
        const k = `${f}\n${to}`;
        if (to !== f && !edgeSet.has(k)) { edgeSet.add(k); edges.push([f, to]); }
      }
    }
  }

  const focus = (opts.focus || []).map((s) => s.toLowerCase()).filter(Boolean);
  const weight = (f) => {
    let w = 1;
    if (TEST_RE.test(f)) w *= 0.2;
    if (ENTRY_RE.test(f)) w *= 3;
    if (focus.some((q) => f.toLowerCase().includes(q))) w *= 10;
    return w;
  };
  // Blend PageRank with (log) importer count. Pure PageRank lets a hub pass its whole score to a leaf
  // it alone imports (click's _compat -> _winconsole); importer count keeps real hubs on top.
  const pr = pagerank(list, edges, weight);
  const inbound = new Map();
  for (const [a, b] of edges) inbound.set(b, (inbound.get(b) || 0) + (TEST_RE.test(a) ? 0.25 : 1));
  const maxPr = Math.max(...pr.values(), 1e-9);
  const maxIn = Math.log1p(Math.max(0, ...inbound.values()));
  const ranks = new Map(list.map((f) => {
    const deg = maxIn ? Math.log1p(inbound.get(f) || 0) / maxIn : 0;
    return [f, (0.4 * pr.get(f)) / maxPr + 0.6 * deg * Math.min(1, weight(f))];
  }));
  const symbols = Object.fromEntries(list.map((f) => [f, info[f].symbols]));
  const lines = Object.fromEntries(list.map((f) => [f, info[f].lines || 0]));
  const langs = {};
  let chars = 0;
  for (const f of list) { langs[info[f].lang] = (langs[info[f].lang] || 0) + 1; chars += info[f].chars || 0; }
  return {
    root: posix(root), files: list, edges, ranks, symbols, lines, langs,
    stats: { ms: Date.now() - t0, parsed, reused, sourceTokens: Math.round(chars / 4), cache: posix(cp) },
  };
}

// Edges among the given repo-relative files (for drawing paths between files Claude touched).
export function importEdges(root, files) {
  const want = new Set(files.map(posix));
  return buildMap(root).edges.filter(([a, b]) => want.has(a) && want.has(b));
}

// ---------- render ----------

const KIND_ORDER = { class: 0, fn: 1, method: 1, type: 2, const: 3 };

// Files longer than this get line numbers, so Claude can Read just a range instead of the whole file.
export const LONG_FILE = 300;

function symbolLine(s, long) {
  const tag = s.k === 'fn' || s.k === 'method' ? 'fn' : s.k === 'const' && !/^(const|module)[ .]/.test(s.sig) ? 'const' : '';
  let line = `${long && s.l ? `L${s.l} ` : ''}${tag ? tag + ' ' : ''}${clipSig(s.sig)}`;
  if (s.methods && s.methods.length) {
    // Keep each method's first line number (duplicates are overloads/getter-setter pairs).
    const seen = new Map();
    s.methods.forEach((m, i) => { if (!seen.has(m)) seen.set(m, s.ml ? s.ml[i] : null); });
    const ms = [...seen].map(([m, l]) => (long && l ? `${m}:${l}` : m));
    line += ` { ${ms.slice(0, 8).join(', ')}${ms.length > 8 ? `, +${ms.length - 8}` : ''} }`;
  }
  return clipSig(line, long ? 160 : 120);
}

// A folder like your home directory holds many projects; one map of all of them mixed together helps nobody.
const MARKERS = ['.git', 'package.json', 'pyproject.toml', 'setup.py', 'requirements.txt', 'go.mod', 'Cargo.toml',
  'pom.xml', 'build.gradle', 'composer.json', 'Gemfile', 'deno.json'];
export const isProject = (dir) => MARKERS.some((m) => fs.existsSync(path.join(dir, m)));

export function subProjects(dir, depth = 2) {
  const found = [];
  const visit = (d, left) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name) || /^(AppData|Library|Applications)$/.test(e.name)) continue;
      const full = path.join(d, e.name);
      if (isProject(full)) found.push(path.relative(dir, full).split(path.sep).join('/'));
      else if (left > 1) visit(full, left - 1);
    }
  };
  visit(dir, depth);
  return found.sort();
}

// What `wd map [folder]` shows: the map of one project, or the projects in a folder that holds several.
export function mapView(cwd, sub, opts = {}) {
  const dir = sub ? path.resolve(cwd, sub) : cwd;
  if (!fs.existsSync(dir)) return `what did map: there is no folder "${sub}" here.`;
  if (!isProject(dir)) {
    const subs = subProjects(dir);
    if (subs.length >= 2) {
      return [`# what did map: ${path.basename(dir) || dir} holds ${subs.length} projects`,
        'A map of all of them mixed together would not help. Open Claude Code inside one, or type wd map <folder>:', '',
        ...subs.slice(0, 40).map((s) => `  ${s}`), ...(subs.length > 40 ? [`  … +${subs.length - 40} more`] : [])].join('\n');
    }
  }
  return renderMap(buildMap(dir), { budget: 2000, ...opts });
}

export function renderMap(map, opts = {}) {
  const budget = (opts.budget || 2000) * 4; // chars
  const name = map.root.split('/').pop();
  const ranked = [...map.files].sort((a, b) => map.ranks.get(b) - map.ranks.get(a) || a.localeCompare(b));
  const inbound = new Map();
  for (const [, b] of map.edges) inbound.set(b, (inbound.get(b) || 0) + 1);

  const langs = Object.entries(map.langs).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} ${n}`).join(', ');
  const out = [];
  let used = 0;
  const add = (line, limit = budget) => {
    if (used + line.length + 1 > limit) return false;
    out.push(line); used += line.length + 1; return true;
  };

  add(`# Repo map: ${name} · ${map.files.length} source files · ${langs || 'no supported languages'}`);
  add('Files are ranked by how central they are in the import graph. Symbols are signatures, not code: read only the files you need.');
  add(`In files over ${LONG_FILE} lines, L123 / name:123 give line numbers: Read with offset/limit around them instead of reading the whole file.`);

  // Layout: directory -> file count, capped to ~12% of the budget.
  const dirs = new Map();
  for (const f of map.files) {
    const parts = f.split('/');
    const d = parts.length > 1 ? parts.slice(0, Math.min(2, parts.length - 1)).join('/') + '/' : './';
    dirs.set(d, (dirs.get(d) || 0) + 1);
  }
  const layout = [...dirs].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([d, n]) => `${d} (${n})`);
  const layoutCap = Math.max(200, budget * 0.12);
  let layoutLine = '';
  for (const l of layout) {
    const next = layoutLine ? `${layoutLine} · ${l}` : l;
    if (next.length > layoutCap) { layoutLine += ` · +${layout.length - layoutLine.split(' · ').length} more`; break; }
    layoutLine = next;
  }
  add('');
  add('## Layout');
  add(layoutLine);

  // Key files: greedy fill up to ~80% of the budget, leaving room for edges.
  add('');
  add('## Key files');
  const filesCap = budget * 0.82;
  const shown = [];
  for (const f of ranked) {
    const syms = [...map.symbols[f]].sort((a, b) => (b.x === true) - (a.x === true) || KIND_ORDER[a.k] - KIND_ORDER[b.k]);
    const n = inbound.get(f) || 0;
    const len = (map.lines && map.lines[f]) || 0;
    const long = len > LONG_FILE;
    const meta = [long ? `${len} lines` : '', n ? `imported by ${n}` : ''].filter(Boolean).join(', ');
    const head = `${f}${meta ? `  (${meta})` : ''}`;
    const lines = syms.slice(0, opts.symbolsPerFile || 8).map((s) => '  ' + symbolLine(s, long));
    if (syms.length > (opts.symbolsPerFile || 8)) lines.push(`  … +${syms.length - (opts.symbolsPerFile || 8)} more`);
    const blockLen = [head, ...lines].reduce((a, l) => a + l.length + 1, 0);
    if (used + blockLen > filesCap) {
      // Degrade: header plus first symbol, or just the header.
      if (!add(lines.length ? `${head} · ${lines[0].trim()}` : head, filesCap)) break;
      shown.push(f);
      continue;
    }
    add(head); lines.forEach((l) => add(l)); shown.push(f);
  }
  const hidden = map.files.length - shown.length;
  if (hidden > 0) add(`… ${hidden} lower-ranked files not shown (run with a bigger --budget or --focus <path>)`);

  // Import edges for the files shown, most central first.
  const byFrom = new Map();
  for (const [a, b] of map.edges) {
    if (!byFrom.has(a)) byFrom.set(a, []);
    byFrom.get(a).push(b);
  }
  const edgeLines = [];
  for (const f of shown) {
    const tos = (byFrom.get(f) || []).sort((a, b) => map.ranks.get(b) - map.ranks.get(a));
    if (tos.length) edgeLines.push(`${f} → ${tos.slice(0, 6).join(', ')}${tos.length > 6 ? `, +${tos.length - 6}` : ''}`);
  }
  if (edgeLines.length && used + 20 < budget) {
    add('');
    add('## Imports');
    for (const l of edgeLines) if (!add(l)) break;
  }
  return out.join('\n');
}

export const estimateTokens = (s) => Math.ceil(s.length / 4);

// ---------- CLI ----------

function parseArgs(argv) {
  const o = { focus: [] };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--budget') o.budget = parseInt(argv[++i], 10) || 2000;
    else if (a === '--focus') o.focus.push(...String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--json') o.json = true;
    else if (a === '--stats') o.stats = true;
    else if (a === '--no-cache') o.cache = false;
    else if (!a.startsWith('--')) pos.push(a);
  }
  o.root = pos.shift() || process.cwd();
  // Extra positional words (e.g. from `/whatdid:map auth`) act as focus terms.
  o.focus.push(...pos);
  if (!fs.existsSync(o.root) || !fs.statSync(o.root).isDirectory()) { o.focus.unshift(o.root); o.root = process.cwd(); }
  return o;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const o = parseArgs(process.argv.slice(2));
  const map = buildMap(o.root, o);
  if (o.json) {
    const ranks = Object.fromEntries([...map.ranks].sort((a, b) => b[1] - a[1]).map(([f, r]) => [f, +r.toFixed(5)]));
    console.log(JSON.stringify({ root: map.root, files: map.files, edges: map.edges, ranks, symbols: map.symbols, stats: map.stats }, null, 2));
  } else {
    const text = renderMap(map, o);
    console.log(text);
    if (o.stats) {
      const s = map.stats;
      console.log(`\n[what did map] ${s.ms}ms · parsed ${s.parsed}, cached ${s.reused} · map ~${estimateTokens(text)} tokens vs ~${s.sourceTokens} tokens of source · cache ${s.cache}`);
    }
  }
}
