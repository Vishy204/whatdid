// Runs every test/*.test.mjs with node's built-in runner. A plain `node --test test/*.test.mjs`
// fails on Windows with Node 20: nothing expands the glob there, and Node only learned to in v22.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => path.join(dir, f));
// Never open real side panes from tests (WT_SESSION/TMUX may be set in the developer's terminal).
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', env: { ...process.env, WHATDID_PANE: '0' } });
process.exit(r.status ?? 1);
