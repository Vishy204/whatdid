import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.WHATDID_PANE = '0'; // never open real side panes from tests
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-sec-'));
process.env.WHATDID_HOME = HOME;
const { redact, stripControl, sessionFile, appendEvent } = await import('../scripts/lib.mjs');
const { colorize } = await import('../scripts/colorize.mjs');
const { renderHtml } = await import('../scripts/html.mjs');

test('secrets are redacted before anything is logged', () => {
  const cases = {
    'export ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstu': 'sk-ant',
    'mysql --password hunter2 -u root': 'hunter2',
    'curl -H "Authorization: Basic dXNlcjpwYXNzd29yZA==" x': 'dXNlcjpwYXNzd29yZA',
    'curl -H "Authorization: Bearer abc.def.ghijklmnop" x': 'ghijklmnop',
    'git clone https://bob:s3cret@github.com/x/y': 's3cret',
    'psql postgres://admin:pw123@db:5432/app': 'pw123',
    'echo eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3': 'dozjgNryP4J3',
    'gh auth login --with-token ghp_abcdefghijklmnopqrstuvwxyz0123': 'ghp_abc',
    'aws configure set aws_access_key_id AKIAABCDEFGHIJKLMNOP': 'AKIAABCDEFGHIJKLMNOP',
    'STRIPE=sk_live_abcdefghijklmnop1234 node pay.js': 'sk_live_abcdef',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----': 'MIIEow',
  };
  for (const [input, secret] of Object.entries(cases)) assert.ok(!redact(input).includes(secret), `${input} -> ${redact(input)}`);
  assert.equal(redact('npm test -- auth'), 'npm test -- auth', 'ordinary commands are untouched');
  const t = Date.now();
  redact('a'.repeat(500000) + ' token=' + 'b_'.repeat(200000));
  assert.ok(Date.now() - t < 1000, 'no catastrophic backtracking');
});

test('terminal escape sequences in logged text never reach the screen', () => {
  const evil = '│ "fix \x1b]52;c;ZXZpbA==\x07it\x1b[2J\x9b31m" done\x00';
  assert.equal(stripControl(evil), '│ "fix ]52;c;ZXZpbA==it[2J31m" done');
  const out = colorize(evil);
  // Only what did's own colour codes remain: ESC followed by "[0;" ... "m".
  assert.equal(out.replace(/\x1b\[0;[\d;]*m|\x1b\[0m/g, '').match(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/), null);
});

test('session ids cannot escape the sessions folder', () => {
  const f = sessionFile('../../../etc/passwd');
  assert.equal(path.dirname(f), path.join(HOME, 'sessions'));
  assert.ok(!path.basename(f).includes('..') || !path.basename(f).includes('/'));
});

test('logs are private to the user on macOS and Linux', { skip: process.platform === 'win32' }, () => {
  appendEvent('perm', { ev: 'start' });
  assert.equal(fs.statSync(path.join(HOME, 'sessions')).mode & 0o077, 0);
  assert.equal(fs.statSync(sessionFile('perm')).mode & 0o077, 0);
});

test('the HTML report escapes everything and locks scripts down', () => {
  const t = Date.now();
  const html = renderHtml([
    { t, ev: 'prompt', cwd: '/x', text: '<img src=x onerror=alert(1)> "]; click A callback' },
    { t: t + 1, ev: 'tool', tool: 'Bash', kind: 'run', detail: '</pre><script>alert(2)</script>', ok: false },
    { t: t + 2, ev: 'stop' },
  ], { transcript: null });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!/<script>alert/.test(html));
  assert.match(html, /Content-Security-Policy[^>]*default-src 'none'[^>]*connect-src 'none'/);
  assert.match(html, /securityLevel: 'strict'/);
  assert.match(html, /mermaid@\d+\.\d+\.\d+\//, 'Mermaid is pinned to an exact version');
});

test('install refuses sources a Windows shell would interpret', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/cli.mjs'), 'install', '--from', 'x/y & calc'], {
    encoding: 'utf8', env: { ...process.env, WHATDID_HOME: HOME, WHATDID_CLAUDE_BIN: path.join(HOME, 'never-called.mjs') },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /is not a GitHub repo/);
});

test('skills Claude can trigger never put arguments into a shell command', () => {
  for (const name of fs.readdirSync(path.join(ROOT, 'skills'))) {
    const md = fs.readFileSync(path.join(ROOT, 'skills', name, 'SKILL.md'), 'utf8');
    const userOnly = /disable-model-invocation: true/.test(md);
    for (const line of md.split('\n').filter((l) => l.includes('!`'))) {
      assert.ok(userOnly || !line.includes('$ARGUMENTS'), `${name}: ${line}`);
    }
  }
});
