import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.WHATDID_PANE = '0'; // never open real side panes from tests

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'whatdid-map-'));
process.env.WHATDID_HOME = path.join(TMP, 'home');

// Work on a copy so we can add ignored dirs (node_modules/dist) that git wouldn't keep in the fixture.
const REPO = path.join(TMP, 'repo');
fs.cpSync(path.join(HERE, 'fixtures', 'map-repo'), REPO, { recursive: true });
for (const d of ['node_modules/dep', 'dist', '.venv/lib']) {
  fs.mkdirSync(path.join(REPO, d), { recursive: true });
  fs.writeFileSync(path.join(REPO, d, 'index.js'), "import '../../src/core/util';\nexport function ignoredThing() {}\n");
}

const { buildMap, renderMap, importEdges, estimateTokens } = await import('../scripts/map.mjs');
const map = buildMap(REPO);
const sigs = (f) => map.symbols[f].map((s) => s.sig);
const find = (f, n) => map.symbols[f].find((s) => s.n === n);
const has = (a, b) => map.edges.some(([x, y]) => x === a && y === b);

test('skips ignored dirs and .gitignore patterns', () => {
  assert.ok(!map.files.some((f) => /node_modules|dist\/|\.venv/.test(f)), map.files.join(', '));
  assert.ok(!map.files.includes('generated/client.ts'), 'generated/ is in .gitignore');
  assert.ok(!map.files.includes('src/big.gen.ts'), '*.gen.ts is in .gitignore');
  assert.ok(map.files.every((f) => !f.includes('\\')), 'forward slashes only');
});

test('extracts JS/TS symbols', () => {
  assert.ok(sigs('src/core/util.ts').includes('formatDate(d: Date, opts?: Options): string'));
  assert.ok(sigs('src/core/util.ts').includes('interface Options'));
  assert.ok(sigs('src/core/util.ts').includes('const VERSION'));
  assert.equal(find('src/core/util.ts', 'formatDate').x, true);
  assert.equal(find('src/core/util.ts', 'internalHelper').x, false);
  const engine = find('src/engine.ts', 'Engine');
  assert.equal(engine.sig, 'class Engine extends Base');
  assert.deepEqual(engine.methods, ['start', 'stop']);
  assert.ok(sigs('src/engine.ts').includes('createEngine(opts: Options)'));
  assert.ok(sigs('src/components/Button.tsx').some((s) => s.startsWith('Button(')));
});

test('extracts Python symbols', () => {
  const user = find('py/app/models.py', 'User');
  assert.equal(user.sig, 'class User(Base)');
  assert.deepEqual(user.methods, ['__init__', 'display_name']);
  assert.ok(sigs('py/app/models.py').includes('load_users(path: str) -> list'));
  assert.ok(sigs('py/app/models.py').includes('MAX_USERS'));
  assert.ok(sigs('py/app/service.py').includes('run_service(config)'));
});

test('extracts Go, Rust and Java symbols', () => {
  assert.deepEqual(find('pkg/store/store.go', 'Store').methods, ['Get']);
  assert.ok(sigs('pkg/store/store.go').includes('New() *Store'));
  assert.equal(find('pkg/store/store.go', 'helper').x, false);
  assert.deepEqual(find('rs/src/parser.rs', 'Parser').methods, ['new', 'parse']);
  assert.ok(sigs('rs/src/lib.rs').includes('run(input: &str) -> usize'));
  assert.equal(find('rs/src/lexer.rs', 'private_lex').x, false);
  assert.deepEqual(find('java/com/acme/Service.java', 'Service').methods, ['run']);
});

test('resolves imports in every language', () => {
  assert.ok(has('src/index.ts', 'src/core/util.ts'), '.js specifier -> .ts file');
  assert.ok(has('src/index.ts', 'src/engine.ts'), 'extensionless');
  assert.ok(has('src/api/routes.ts', 'src/api/handlers.js'), 'require()');
  assert.ok(has('src/api/handlers.js', 'src/core/util.ts'));
  assert.ok(has('py/app/service.py', 'py/app/models.py'), 'python relative');
  assert.ok(has('py/app/service.py', 'py/app/utils.py'), 'python absolute');
  assert.ok(has('cmd/server/main.go', 'pkg/store/store.go'), 'go module import');
  assert.ok(has('rs/src/lib.rs', 'rs/src/parser.rs'), 'rust mod');
  assert.ok(has('rs/src/parser.rs', 'rs/src/lexer.rs'), 'rust use crate::');
  assert.ok(has('java/com/acme/Service.java', 'java/com/acme/model/User.java'), 'java import');
  assert.ok(!map.edges.some(([, b]) => /node_modules|os|fmt/.test(b)), 'no external edges');
});

test('ranking puts the hub file first', () => {
  const top = [...map.ranks].sort((a, b) => b[1] - a[1])[0][0];
  assert.equal(top, 'src/core/util.ts');
  const text = renderMap(map);
  const firstFile = text.split('## Key files\n')[1].split('\n')[0];
  assert.match(firstFile, /^src\/core\/util\.ts {2}\(imported by 5\)$/);
});

test('--focus lifts matching files', () => {
  const focused = buildMap(REPO, { focus: ['rs/'] });
  const top = [...focused.ranks].sort((a, b) => b[1] - a[1])[0][0];
  assert.ok(top.startsWith('rs/'), top);
});

test('render respects the token budget and degrades gracefully', () => {
  for (const budget of [150, 300, 600, 2000]) {
    const text = renderMap(map, { budget });
    assert.ok(estimateTokens(text) <= budget, `budget ${budget}: got ${estimateTokens(text)}`);
    assert.match(text, /^# Repo map: repo · 17 source files/);
  }
  const small = renderMap(map, { budget: 300 });
  assert.match(small, /lower-ranked files not shown/);
  const full = renderMap(map, { budget: 4000 });
  assert.match(full, /## Imports\n/);
  assert.match(full, /src\/index\.ts → src\/core\/util\.ts, src\/engine\.ts/);
});

test('cache is reused and invalidated per file', () => {
  const warm = buildMap(REPO);
  assert.equal(warm.stats.parsed, 0);
  assert.equal(warm.stats.reused, 17);
  const f = path.join(REPO, 'py/app/utils.py');
  fs.appendFileSync(f, '\ndef extra(x):\n    return x\n');
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(f, later, later);
  const after = buildMap(REPO);
  assert.equal(after.stats.parsed, 1);
  assert.ok(after.symbols['py/app/utils.py'].some((s) => s.n === 'extra'));
});

test('importEdges returns edges among the given files', () => {
  const e = importEdges(REPO, ['src/index.ts', 'src/engine.ts', 'src/core/util.ts']);
  assert.deepEqual(e.map((x) => x.join('>')).sort(), ['src/engine.ts>src/core/util.ts', 'src/index.ts>src/core/util.ts', 'src/index.ts>src/engine.ts']);
});
