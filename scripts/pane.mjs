#!/usr/bin/env node
// Shows a wd view in colour, in a full-width pane below Claude Code.
// Claude Code prints hook text in a single colour under "blocked by hook", so when the terminal can split
// (Windows Terminal, tmux, WezTerm, iTerm2, kitty) the hook opens a pane running this script instead.
// Other macOS terminals (Terminal, Ghostty, VS Code, Warp) can't be split from outside: a Terminal window opens.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { home, config, PRIVATE_DIR, PRIVATE_FILE } from './lib.mjs';
import { viewText } from './render.mjs';
import { colorize } from './colorize.mjs';

const SELF = fileURLToPath(import.meta.url);

export function paneEnabled() {
  const env = process.env.WHATDID_PANE;
  return env ? env === '1' : config().pane !== false;
}

const shellQuote = (a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);

// The command that splits the current terminal and runs `node pane.mjs <job>` in the new pane, or null.
export function paneCommand(job, env = process.env, platform = process.platform, node = process.execPath) {
  const run = [node, SELF, job];
  if (platform === 'win32' && env.WT_SESSION) {
    return { cmd: 'wt.exe', args: ['-w', env.WHATDID_WT_WINDOW || '0', 'split-pane', '-H', '--size', '0.55', '--title', 'what did', ...run] };
  }
  if (env.TMUX) return { cmd: 'tmux', args: ['split-window', '-v', '-l', '55%', run.map(shellQuote).join(' ')] };
  if (env.WEZTERM_PANE) return { cmd: 'wezterm', args: ['cli', 'split-pane', '--bottom', '--percent', '55', '--', ...run] };
  if (env.TERM_PROGRAM === 'iTerm.app') {
    const line = run.map(shellQuote).join(' ').replace(/["\\]/g, '\\$&');
    return { cmd: 'osascript', args: ['-e', `tell application "iTerm2" to tell current session of current window to split horizontally with default profile command "${line}"`] };
  }
  // Needs allow_remote_control in kitty.conf; without it the command fails and wd prints inline.
  if (env.KITTY_WINDOW_ID) return { cmd: 'kitty', args: ['@', 'launch', '--location=hsplit', '--title', 'what did', ...run] };
  if (platform === 'darwin') {
    const line = `${run.map(shellQuote).join(' ')}; exit`.replace(/["\\]/g, '\\$&');
    return { cmd: 'osascript', args: ['-e', 'tell application "Terminal"', '-e', `do script "${line}"`,
      '-e', 'try', '-e', 'set bounds of front window to {60, 60, 1100, 760}', '-e', 'end try', '-e', 'activate', '-e', 'end tell'] };
  }
  return null;
}

// Opens the pane; returns false (so the caller prints inline) when this terminal can't split or the split failed.
export function openPane(view) {
  if (!paneEnabled()) return false;
  const dir = path.join(home(), 'pane');
  fs.mkdirSync(dir, PRIVATE_DIR);
  const job = path.join(dir, `${Date.now()}.json`);
  const c = paneCommand(job);
  if (!c) return false;
  fs.writeFileSync(job, JSON.stringify(view), PRIVATE_FILE);
  fs.writeFileSync(path.join(dir, 'latest'), path.basename(job));
  const r = spawnSync(c.cmd, c.args, { stdio: 'ignore', windowsHide: true, timeout: 5000 });
  if (r.status === 0) return true;
  // A timeout is usually macOS asking to allow controlling Terminal or iTerm2: the pane may still open once
  // the person clicks OK, so keep its job. wd prints inline this time either way.
  if (r.error?.code !== 'ETIMEDOUT') fs.rmSync(job, { force: true });
  return false;
}

// A tiny pager: opens at the top, scrolls with arrows / PgUp / PgDn / space / mouse wheel, closes with q, Esc or Enter.
function show(jobFile) {
  let job;
  try { job = JSON.parse(fs.readFileSync(jobFile, 'utf8')); } catch { job = null; }
  fs.rmSync(jobFile, { force: true });
  const out = process.stdout;
  // Wrap to the pane ourselves: if the terminal wrapped long lines, the pager's line count would be wrong.
  const fit = (text, cols) => text.split('\n').flatMap((l) => {
    if (l.length <= cols) return [l];
    const indent = ' '.repeat(Math.min(l.match(/^\s*/)[0].length + 2, 12));
    const parts = [];
    let rest = l;
    while (rest.length > cols - (parts.length ? indent.length : 0)) {
      const room = cols - (parts.length ? indent.length : 0);
      const cut = rest.lastIndexOf(' ', room) > room / 2 ? rest.lastIndexOf(' ', room) : room;
      parts.push((parts.length ? indent : '') + rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^ /, '');
    }
    parts.push((parts.length ? indent : '') + rest);
    return parts;
  });
  // full: every step, command and file, instead of "+3 more" summaries.
  let full = false, plain = [], lines = [];
  const build = () => {
    const width = Math.max(40, Math.min((out.columns || 100) - 2, 120));
    const text = job ? viewText({ ...job, opts: { ...job.opts, full } }, width) : 'what did: this view has expired. Type wd again.';
    plain = fit(text, Math.max(20, (out.columns || 100) - 1));
    lines = colorize(plain.join('\n')).split('\n');
  };
  build();
  if (!out.isTTY || !process.stdin.isTTY) return out.write(`${lines.join('\n')}\n`);
  const canExpand = () => !full && plain.some((l) => /\+\d+ more|\d+ more (steps|files)|\(\d+ files\)/.test(l));

  let top = 0;
  const rows = () => Math.max(3, (out.rows || 30) - 1);
  const maxTop = () => Math.max(0, lines.length - rows());
  const draw = () => {
    top = Math.min(Math.max(0, top), maxTop());
    const view = lines.slice(top, top + rows());
    const hints = [maxTop() ? `${top < maxTop() ? '↓ more' : 'end'} · ↑↓ or wheel to scroll` : '',
      canExpand() ? 'e or click "+N more" to show everything' : full ? 'e to summarise again' : '', 'q to close'].filter(Boolean);
    out.write(`\x1b[H\x1b[2J${view.join('\n')}\n\x1b[38;2;125;133;144m  ${hints.join(' · ')}\x1b[0m`);
  };
  const quit = () => { out.write('\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[?1049l'); process.exit(0); };
  out.write('\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h');
  // Only one pane at a time: when a newer wd opens its pane, this one closes itself.
  const latest = path.join(path.dirname(jobFile), 'latest');
  setInterval(() => { try { if (fs.readFileSync(latest, 'utf8') !== path.basename(jobFile)) quit(); } catch {} }, 400);
  out.on('resize', () => { build(); draw(); });
  const toggle = () => { full = !full; build(); };
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (b) => {
    const k = b.toString();
    const wheel = k.match(/\x1b\[<(64|65);/);
    const click = k.match(/\x1b\[<0;\d+;(\d+)M/);
    if (wheel) top += wheel[1] === '64' ? -3 : 3;
    else if (click) {
      // Clicking a "+3 more" (or "N files") line expands everything.
      if (!/more|\d+ files/.test(plain[top + Number(click[1]) - 1] || '')) return;
      toggle();
    } else if (k.startsWith('\x1b[<')) return; // releases and other mouse events
    else if (k === 'e' || k === 'E') toggle();
    else if (k === '\x1b[A' || k === 'k') top -= 1;
    else if (k === '\x1b[B' || k === 'j') top += 1;
    else if (k === '\x1b[5~' || k === 'b') top -= rows() - 1;
    else if (k === '\x1b[6~' || k === ' ') top += rows() - 1;
    else if (k === 'g' || k === '\x1b[H') top = 0;
    else if (k === 'G' || k === '\x1b[F') top = maxTop();
    else if (k === 'q' || k === 'Q' || k === '\x1b' || k === '\r' || k === '\x03') return quit();
    draw();
  });
  draw();
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  // A crash here would leave a dead pane, so log it and exit cleanly (Windows Terminal closes panes that exit 0).
  const fail = (err) => {
    try { fs.appendFileSync(path.join(home(), 'pane', 'error.log'), `${new Date().toISOString()} ${err.stack || err}\n`); } catch {}
    process.stdout.write('\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[?1049l');
    process.exit(0);
  };
  process.on('uncaughtException', fail);
  try { show(process.argv[2]); } catch (err) { fail(err); }
}
