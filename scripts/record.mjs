#!/usr/bin/env node
// Hook sink. Appends a compact event per hook call to ~/.whatdid/sessions/<session>.jsonl.
// Rules: never block Claude Code, never print unless answering the "wd" / "??" magic prompt, always exit 0.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendEvent, home, PRIVATE_DIR, PRIVATE_FILE, tightenPermissions, autoMapMode, AUTOMAP_MIN_TOKENS, autoCardEnabled, notifyEnabled, notifySequence, NOTIFY_MIN_MS, takeWelcome, redact, clip, summarizeTool, readEvents, sessionFile } from './lib.mjs';
import { renderCard, parseArgs, viewText } from './render.mjs';
import { openPane } from './pane.mjs';
import { writeReport, openInBrowser } from './html.mjs';
import { buildMap, renderMap, isProject, subProjects } from './map.mjs';

// "wd", "wd 3", "wd all", "wd replay", "wd html", "wd map", "wd help" — explain without calling the model.
// "??" works too, but Claude Code opens its shortcuts panel when "?" is typed into an empty box,
// so "wd" is the trigger we document.
const MAGIC = /^\s*(?:\?\?|wd)(?:\s+(.*))?\s*$/is;

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function installStatusline() {
  // Statusline runs from user settings, outside the plugin, so keep a stable copy in ~/.whatdid/bin.
  const src = path.join(path.dirname(fileURLToPath(import.meta.url)), 'statusline.mjs');
  const dst = path.join(home(), 'bin', 'statusline.mjs');
  const data = fs.readFileSync(src);
  let cur = null;
  try { cur = fs.readFileSync(dst); } catch {}
  if (!cur || !cur.equals(data)) {
    fs.mkdirSync(path.dirname(dst), PRIVATE_DIR);
    fs.writeFileSync(dst, data, PRIVATE_FILE);
  }
}

function main() {
  const raw = readStdin();
  if (!raw.trim()) return;
  const h = JSON.parse(raw);
  const sid = h.session_id;
  const cwd = h.cwd || process.cwd();
  const t = Date.now();

  switch (h.hook_event_name) {
    case 'SessionStart':
      appendEvent(sid, { t, ev: 'start', source: h.source, cwd, transcript: h.transcript_path });
      try { installStatusline(); } catch {}
      try { tightenPermissions(); } catch {}
      {
        const out = {};
        if (h.source === 'startup' && takeWelcome()) {
          // Shown to the user only; Claude never sees it, so it costs nothing.
          out.systemMessage = '◆ what did is on · when Claude finishes, type wd for a free map of what it did (wd help for more) · ' +
            '/output-style whatdid adds live why-notes';
        }
        const mode = autoMapMode();
        // A folder of many projects (like your home directory) gets no map: it would mix them all together.
        if (mode !== false && h.source !== 'resume' && (isProject(cwd) || subProjects(cwd).length < 2)) {
          const map = buildMap(cwd);
          if (mode === true || map.stats.sourceTokens >= AUTOMAP_MIN_TOKENS) {
            out.hookSpecificOutput = {
              hookEventName: 'SessionStart',
              additionalContext: 'Repo map from what did (key files, symbols, imports). Use it to decide which few files to open; ' +
                'do not re-discover with broad Glob/Grep what it already shows. In big files, Read only the range around the ' +
                'listed line numbers (offset/limit).\n\n' + renderMap(map, { budget: 2000 }),
            };
          }
        }
        if (Object.keys(out).length) process.stdout.write(JSON.stringify(out));
      }
      break;

    case 'UserPromptExpansion': {
      // The /whatdid:wd… commands: listed with descriptions in Claude Code's / menu, answered here for free.
      const name = String(h.command_name || '').replace(/^whatdid:/, '');
      const sub = { wd: [], 'wd-replay': ['replay'], 'wd-diff': ['diff'], 'wd-map': ['map'], 'wd-html': ['html'], 'wd-help': ['help'] }[name];
      if (!sub) break;
      const args = Array.isArray(h.arguments) ? h.arguments : String(h.arguments || '').split(/\s+/);
      const opts = parseArgs([...sub, ...args.filter(Boolean)]);
      process.stdout.write(JSON.stringify({ decision: 'block', reason: answerWd(opts, h, sid, cwd) }));
      return;
    }

    case 'UserPromptSubmit': {
      const m = String(h.prompt || '').match(MAGIC);
      const opts = m && parseArgs((m[1] || '').trim().split(/\s+/).filter(Boolean));
      // "wd why did you do that" is a real question for Claude: only intercept words whatdid understands.
      if (opts && !opts.unknown.length) {
        // No leading newline: some Claude Code views show only the first line of a block reason,
        // so that line must already say something useful.
        process.stdout.write(JSON.stringify({ decision: 'block', reason: answerWd(opts, h, sid, cwd) }));
        return;
      }
      appendEvent(sid, { t, ev: 'prompt', cwd, text: clip(redact(h.prompt), 400), transcript: h.transcript_path });
      break;
    }

    case 'PreToolUse':
      appendEvent(sid, { t, ev: 'pre', id: h.tool_use_id, ...summarizeTool(h.tool_name, h.tool_input, null, cwd) });
      break;

    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const e = summarizeTool(h.tool_name, h.tool_input, h.tool_response, cwd);
      if (h.hook_event_name === 'PostToolUseFailure') e.ok = false;
      appendEvent(sid, { t, ev: 'tool', id: h.tool_use_id, ...e });
      break;
    }

    case 'Stop':
      appendEvent(sid, { t, ev: 'stop' });
      {
        const events = autoCardEnabled() || notifyEnabled() ? readEvents(sessionFile(sid)) : [];
        const card = events.length ? renderCard(events, { transcript: h.transcript_path }) : '';
        if (!card) break;
        const out = {};
        if (autoCardEnabled()) out.systemMessage = card;
        const asked = events.filter((e) => e.ev === 'prompt').pop();
        if (notifyEnabled() && asked && t - asked.t >= NOTIFY_MIN_MS) {
          const body = card.split('\n')[0].replace(/^\S+ what did · /, '').replace(/ · type wd$/, '');
          out.terminalSequence = notifySequence('Claude finished', body);
        }
        if (Object.keys(out).length) process.stdout.write(JSON.stringify(out));
      }
      break;

    case 'SubagentStop':
      appendEvent(sid, { t, ev: 'substop', agent: h.agent_type });
      break;
  }
}

// Answers wd and /whatdid:wd… without calling the model: a colour pane when the terminal can split, else text.
function answerWd(opts, h, sid, cwd) {
  const file = sessionFile(sid);
  const view = { file, cwd, transcript: h.transcript_path, opts };
  if (opts.html) {
    const out = writeReport(file, readEvents(file), { transcript: h.transcript_path });
    return `what did report ${openInBrowser(out) ? 'opened in your browser' : 'written'}:
${out}`;
  }
  if (openPane(view)) return '◆ what did opened below ↓ scroll with ↑↓ or the mouse wheel, q to close';
  return viewText(view, 100);
}

try { main(); } catch (err) {
  if (process.env.WHATDID_DEBUG) process.stderr.write(`whatdid: ${err.stack || err}\n`);
}
process.exitCode = 0;
