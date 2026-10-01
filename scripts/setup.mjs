#!/usr/bin/env node
// Installs or removes the whatdid statusline in ~/.claude/settings.json.
// Plugins can't set statusLine themselves, so this is the one step users opt into.
// An existing statusline (e.g. GSD's) is kept: whatdid runs it and shows its output first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { home } from './lib.mjs';

const settingsPath = process.env.WHATDID_CLAUDE_SETTINGS || path.join(os.homedir(), '.claude', 'settings.json');
const configPath = path.join(home(), 'config.json');
const target = path.join(home(), 'bin', 'statusline.mjs');
const ourCommand = `node "${target.replace(/\\/g, '/')}"`;

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n'); };

function install() {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'statusline.mjs'), target);

  const settings = readJson(settingsPath);
  const current = settings.statusLine?.command;
  if (current === ourCommand) return console.log('what did statusline is already installed.');

  if (fs.existsSync(settingsPath)) fs.copyFileSync(settingsPath, settingsPath + '.whatdid-backup');
  const cfg = readJson(configPath);
  if (current) cfg.wrap = current;
  writeJson(configPath, cfg);
  settings.statusLine = { type: 'command', command: ourCommand };
  writeJson(settingsPath, settings);
  console.log(`Installed whatdid statusline.${current ? `\nYour previous statusline still shows first: ${current}` : ''}\nBackup: ${settingsPath}.whatdid-backup\nIt appears after your next message.`);
}

function uninstall() {
  const settings = readJson(settingsPath);
  const cfg = readJson(configPath);
  if (settings.statusLine?.command !== ourCommand) return console.log('what did statusline is not installed; nothing changed.');
  const prev = cfg.wrap;
  if (prev) settings.statusLine = { type: 'command', command: prev };
  else delete settings.statusLine;
  delete cfg.wrap;
  writeJson(configPath, cfg);
  writeJson(settingsPath, settings);
  console.log(prev ? `Restored previous statusline: ${prev}` : 'Removed what did statusline.');
}

function automap(mode) {
  const cfg = readJson(configPath);
  if (mode === 'off') delete cfg.autoMap;
  else cfg.autoMap = mode === 'on' ? true : 'auto';
  writeJson(configPath, cfg);
  console.log({
    on: 'Auto-map on: every new session starts with a ~2k-token map of the repo, so Claude knows where things live before it reads anything.',
    off: 'Auto-map off (the default). Type wd map any time to see the map yourself, for free.',
    auto: 'Auto-map for big codebases: the ~2k-token map is preloaded only when a repo has ~400k+ tokens of source.',
  }[mode]);
}

function autoCard(on) {
  const cfg = readJson(configPath);
  cfg.autoCard = on;
  writeJson(configPath, cfg);
  console.log(on
    ? 'Auto card on: after every turn, a one-line what did summary appears. Zero tokens. Type wd for the full map.'
    : 'Auto card off.');
}

function notify(on) {
  const cfg = readJson(configPath);
  if (on) delete cfg.notify;
  else cfg.notify = false;
  writeJson(configPath, cfg);
  console.log(on
    ? 'Notifications on: when a turn takes 20s or more, your terminal pops a desktop notification with the summary (Windows Terminal, iTerm2, WezTerm, Ghostty, kitty).'
    : 'Notifications off.');
}

function pane(on) {
  const cfg = readJson(configPath);
  if (on) delete cfg.pane;
  else cfg.pane = false;
  writeJson(configPath, cfg);
  console.log(on
    ? 'Pane on: wd opens in colour in a pane below Claude Code (Windows Terminal, tmux, WezTerm, iTerm2).'
    : 'Pane off: wd prints inside Claude Code instead.');
}

const cmd = process.argv[2];
if (cmd === 'statusline') install();
else if (cmd === 'uninstall-statusline') uninstall();
else if (cmd === 'automap') automap(['on', 'off'].includes(process.argv[3]) ? process.argv[3] : 'auto');
else if (cmd === 'auto') autoCard(process.argv[3] !== 'off');
else if (cmd === 'notify') notify(process.argv[3] !== 'off');
else if (cmd === 'pane') pane(process.argv[3] !== 'off');
else console.log('usage: setup.mjs statusline | uninstall-statusline | auto [on|off] | notify [on|off] | pane [on|off] | automap [on|off|auto]');
