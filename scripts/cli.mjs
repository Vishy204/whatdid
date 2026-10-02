#!/usr/bin/env node
// whatdid: install whatdid into Claude Code, and use it from any terminal.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { home, sessionsDir, findSession } from './lib.mjs';

export const GITHUB_REPO = 'Vishy204/whatdid';
const PLUGIN = 'whatdid@whatdid';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const settingsPath = () => process.env.WHATDID_CLAUDE_SETTINGS || path.join(os.homedir(), '.claude', 'settings.json');

const HELP = `what did — see what Claude Code did

Usage: whatdid                 show what Claude did in this folder's latest session
       whatdid <command> [options]

Commands:
  install [--from <repo|path>]  Add the what did marketplace and install the plugin
                                (default source: ${GITHUB_REPO})
  uninstall                     Remove the plugin, its marketplace, and the statusline
  explain [n|all] [--ascii]     Show the session map for this folder (same as typing wd in Claude)
          [--replay] [--html]
  map [root] [--stats]          Print the repo map what did gives Claude
  doctor                        Check that everything is wired up
  help                          Show this help

Inside Claude Code, type wd for the same map at zero token cost.`;

function claude(args, opts = {}) {
  // Tests point WHATDID_CLAUDE_BIN at a fake node script so they never touch the real Claude Code config.
  const fake = process.env.WHATDID_CLAUDE_BIN;
  if (fake) return spawnSync(process.execPath, [fake, ...args], { encoding: 'utf8', stdio: opts.capture ? 'pipe' : 'inherit' });
  return spawnSync('claude', args, { encoding: 'utf8', stdio: opts.capture ? 'pipe' : 'inherit', shell: process.platform === 'win32' });
}

function install(argv) {
  const i = argv.indexOf('--from');
  const source = i >= 0 ? argv[i + 1] : GITHUB_REPO;
  if (!source || source.startsWith('OWNER/')) {
    console.error('whatdid: no published repo is configured yet. Use: whatdid install --from <github-user/whatdid | path/to/whatdid>');
    return 1;
  }
  // On Windows `claude` runs through the shell, so refuse anything a shell would interpret.
  if (/[&|<>^"%!`$;()\r\n]/.test(source)) {
    console.error(`whatdid: "${source}" is not a GitHub repo (owner/name) or a folder path.`);
    return 1;
  }
  const add = claude(['plugin', 'marketplace', 'add', source]);
  if (add.status !== 0) return add.status || 1;
  const inst = claude(['plugin', 'install', PLUGIN]);
  if (inst.status !== 0) return inst.status || 1;
  console.log('\nInstalled. Restart Claude Code, do something, then type wd to see what it did.\nOptional live statusline: run /wd-setup inside Claude Code.');
  return 0;
}

function uninstall() {
  spawnSync(process.execPath, [path.join(HERE, 'setup.mjs'), 'uninstall-statusline'], { stdio: 'inherit' });
  const a = claude(['plugin', 'uninstall', PLUGIN]);
  const b = claude(['plugin', 'marketplace', 'remove', 'whatdid']);
  console.log(`\nSession logs are kept in ${home()}. Delete that folder to remove them too.`);
  return a.status === 0 || b.status === 0 ? 0 : 1;
}

function proxy(script, args) {
  const file = path.join(HERE, script);
  if (!fs.existsSync(file)) {
    console.error(`whatdid: ${script} is not part of this version.`);
    return 1;
  }
  return spawnSync(process.execPath, [file, ...args], { stdio: 'inherit' }).status ?? 1;
}

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

// Each check returns [level, message]; level is ok | warn | fail.
export function doctorChecks({ cwd = process.cwd() } = {}) {
  const checks = [];
  const major = parseInt(process.versions.node, 10);
  checks.push(major >= 20 ? ['ok', `Node ${process.versions.node}`] : ['fail', `Node ${process.versions.node} is too old; what did needs Node 20+`]);

  const v = claude(['--version'], { capture: true });
  checks.push(v.status === 0 ? ['ok', `Claude Code ${String(v.stdout).trim()}`] : ['fail', 'claude not found on PATH']);

  const settings = readJson(settingsPath()) || {};
  const enabled = Object.entries(settings.enabledPlugins || {}).find(([k]) => k.startsWith('whatdid@'));
  checks.push(enabled?.[1] ? ['ok', `Plugin enabled (${enabled[0]})`]
    : enabled ? ['warn', `Plugin installed but disabled (${enabled[0]}); run: claude plugin enable ${enabled[0]}`]
    : ['warn', 'Plugin not installed from a marketplace (fine if you run claude --plugin-dir <whatdid>); install: whatdid install']);

  try {
    fs.mkdirSync(sessionsDir(), { recursive: true });
    const probe = path.join(sessionsDir(), `.doctor-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe);
    checks.push(['ok', `Session logs writable: ${sessionsDir()}`]);
  } catch (e) {
    checks.push(['fail', `Cannot write session logs in ${sessionsDir()}: ${e.code || e.message}`]);
  }

  const newest = findSession({ cwd });
  if (!newest) checks.push(['warn', 'No sessions recorded yet. Start Claude Code with what did enabled and ask it something.']);
  else {
    const ageMin = Math.round((Date.now() - fs.statSync(newest).mtimeMs) / 60000);
    checks.push(['ok', `Latest recorded activity ${ageMin < 1 ? 'just now' : ageMin < 120 ? `${ageMin} min ago` : `${Math.round(ageMin / 60)} h ago`} (${path.basename(newest)})`]);
  }

  const sl = settings.statusLine?.command || '';
  checks.push(sl.includes('statusline.mjs') && sl.includes('.whatdid')
    ? ['ok', 'Statusline installed']
    : ['warn', `Statusline not installed${sl ? ' (another statusline is active; whatdid keeps it)' : ''}; optional: run /wd-setup in Claude Code`]);
  return checks;
}

function doctor() {
  const icon = { ok: '✔', warn: '!', fail: '✘' };
  const checks = doctorChecks();
  for (const [lvl, msg] of checks) console.log(`${icon[lvl]} ${msg}`);
  const fails = checks.filter(([l]) => l === 'fail').length;
  console.log(fails ? `\n${fails} problem(s) found.` : '\nwhat did looks healthy.');
  return fails ? 1 : 0;
}

export function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'install': return install(rest);
    case 'uninstall': return uninstall();
    case 'explain': return proxy('render.mjs', ['--cwd', process.cwd(), ...rest]);
    case undefined: return proxy('render.mjs', ['--cwd', process.cwd()]);
    case 'map': return proxy('map.mjs', rest);
    case 'doctor': return doctor();
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      return 0;
    default:
      // "whatdid replay", "whatdid 3", "whatdid html": the same words as typing wd inside Claude Code.
      if (/^(d+|all|replay|html|map|ascii|--ascii|--replay|--html|--all)$/.test(cmd)) return proxy('render.mjs', ['--cwd', process.cwd(), cmd, ...rest]);
      console.error(`whatdid: unknown command "${cmd}"\n`);
      console.log(HELP);
      return 1;
  }
}

const realArgv1 = (() => { try { return fs.realpathSync(process.argv[1]); } catch { return ''; } })();
// npm links the bin (symlink or shim), so compare real paths.
if (realArgv1 && realArgv1 === fs.realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
