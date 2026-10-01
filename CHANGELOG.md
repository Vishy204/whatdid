# Changelog

> The project was renamed from glassbox to **what did** (package and command: `whatdid`) before its first release. "Glassbox" is an existing session-replay company and is used by 600+ GitHub repos. The trigger is now `wd`.

## 0.1.6 — 2026-10-01

### Changed
- **HTML report navigation.** A list of every prompt, newest first, sits at the top and jumps straight to that turn's diagram. Turns are shown newest first; the three newest are open and older ones fold to their prompt until you click them. No JavaScript: folding uses CSS `:target`.
- **Flowchart boxes show their full text.** Long text and paths wrap instead of being cut, the full text is also a hover tooltip, and failed commands show in full.
- Health counts every file Claude edited or created, so it agrees with "In short".

## 0.1.5 — 2026-10-01

### Added
- **`wd diff`** (`/whatdid:wd-diff`): the exact lines Claude changed in the last turn, file by file, with line numbers, read from Claude Code's transcript and redacted. Expand and scroll in the colour pane.
- **Health** section in `wd` and the HTML report: tests passed or failing, commands failed and fixed, files changed, and failures still unresolved.
- The HTML report shows each turn's changed lines and health.

### Changed
- **The HTML report is fully offline.** The flowchart is now SVG drawn by what did instead of Mermaid from a CDN; the page runs no JavaScript and its Content Security Policy blocks scripts and network requests.

### Security
- Config, the statusline copy and the map cache are private too (`0700`/`0600`), and older world-readable folders are tightened at session start.
- `Authorization` (any scheme), `Proxy-Authorization`, `Cookie`, `Set-Cookie` and `--cookie` values are redacted.

## 0.1.4 — 2026-10-01

### Security
- Redaction now also covers JWTs, private keys, Basic auth, passwords in URLs, `--password`-style flags, and GitLab, Google, Stripe and npm tokens. Bash descriptions and agent prompts are redacted too.
- Text shown in the terminal (pane, `whatdid` command, statusline) has control characters stripped, so file names or commands can't inject escape sequences.
- `~/.whatdid` is created private (`0700`, files `0600`) on macOS and Linux.
- The HTML report has a Content Security Policy, pins Mermaid to 11.17.2, and opens without a shell on Windows.
- Skills Claude can trigger no longer pass arguments into shell commands.
- `whatdid install --from` refuses shell metacharacters; CI runs with a read-only token.
- Added `SECURITY.md`.

### Fixed
- Recap gaps ("not verified") are highlighted in the HTML report again, and lead-in lines are filtered from "Along the way" (two regexes had a stray control character).

## 0.1.3 — 2026-10-01

### Added
- **`/wd` menu.** `/whatdid:wd`, `wd-replay`, `wd-map`, `wd-html` and `wd-help` appear in Claude Code's `/` menu with a description each. A `UserPromptExpansion` hook answers them, so they cost 0 tokens like `wd`.
- **Expand in the pane.** Click a "+3 more" line or press `e` to see every step, command and file.
- **Claude's answer** near the top: how Claude's final message begins.

### Changed
- "In Claude's words" is now **Along the way**: one key line from each message Claude wrote while working, tagged with the step it led to, e.g. "(→ step 3)".
- The paid `/whatdid:replay` skill is gone (use the free `/whatdid:wd-replay`); the `map` skill is for Claude only and no longer clutters your menu.
- ✔ and ✘ draw in colour on Windows instead of as purple emoji.

## 0.1.2 — 2026-10-01

### Added
- **`wd` opens in a colour pane** below Claude Code in Windows Terminal, tmux, WezTerm and iTerm2, with scrolling. A new `wd` replaces the old pane. `/whatdid:setup pane off` keeps it inline.
- **"In short"**: one plain-English line under your prompt, e.g. "Read 5 files, edited 2 files (+165 −16 lines), ran 17 commands, all worked."
- **`whatdid` in a terminal is coloured**, and `wd map <folder>` maps one folder.

### Changed
- Steps show what each command was for; the raw command only shows when it failed.
- "In Claude's words" skips lead-ins like "Now the next part:" in favour of findings.
- `wd map` in a folder of many projects, like your home directory, lists them instead of mixing them into one map. Auto-map skips such folders too.
- The help card no longer mentions `??`.

## 0.1.1 — 2026-10-01

### Added
- **Desktop notification after long turns.** When a turn takes 20s or more, the terminal pops a notification with the summary (Windows Terminal, iTerm2, WezTerm, Ghostty, kitty). `/whatdid:setup notify off` turns it off.

### Fixed
- Commands that mention whatdid (like `npx whatdid doctor`) were hidden from the map.
- "In Claude's words" cut sentences at version numbers like 2.1.286.

## 0.1.0 — 2026-09-30

First release.

### Added
- **Auto-map for big codebases.** Optional and off by default. `/whatdid:setup automap auto` preloads the repo map, now with line numbers for big files, only on codebases with ~400k+ tokens of source; `on` does it for every session. Benchmarked read-only on excalidraw, pydantic, hugo and a private codebase (see the README).
- **`bench/local.mjs`.** A read-only benchmark on your own repo with your own questions.
- **Auto card (on by default).** A one-line summary after every turn at zero tokens; `/whatdid:setup auto off` hides it. It shows: steps, what changed, the last command, failures and Claude's latest note.
- **Typed narration.** The `whatdid` output style: ◆ why, ▸ plan, ◇ found, ✔ done, ✘ failed, ▲ risk, ◌ need, and a ✎ changed / ✔ verified / ○ left recap. They show up in `wd`, replay, the statusline and the HTML report.
- **Welcome hint.** The first 3 sessions after install show how to use `wd`. It costs zero tokens and is shown to you only.
- **`whatdid` with no arguments** shows the latest session for the current folder.
- **Recorder hooks.** They log every prompt, tool call, failure and stop to `~/.whatdid/sessions/<session>.jsonl`. They run async, never store file contents, and redact secrets.
- **`wd` magic prompt** (`??` also works; type a space first). Type it in Claude Code for a plain-English map of the last turn: steps, file tree, failures, Claude's notes and token usage. The prompt never reaches the model, so it costs zero tokens. Variants: `wd 3`, `wd all`, `wd replay`, `wd html`, `wd map`, `wd ascii`, `wd help`.
- **"How it connects".** The `wd` map now shows the import chains between the files Claude touched, e.g. `routes.js ──▶ guard.js ──▶ session.js [edited]`. They come from the cached repo map.
- **Auto-map (opt-in).** `/whatdid:setup automap` puts a ~2k-token repo map into context at session start, with no extra tool-call turn.
- **`/whatdid:explain`.** The same map plus a short summary for non-programmers.
- **`/whatdid:replay`.** A step-by-step timeline.
- **`/whatdid:setup`.** A live statusline that keeps any existing statusline, such as GSD's.
- **`whatdid` output style.** It asks Claude to write short `why:` lines and a `recap:`.
- **`/whatdid:map`.** A deterministic repo map (symbols, imports, ranking) that Claude can read instead of exploring file by file.
- **`whatdid` CLI.** Commands: `install`, `uninstall`, `explain`, `map`, `doctor`.
- **`bench/`.** A reproducible token benchmark: 10 tasks on pinned commits of ky, click and commander.js, comparing baseline, what did, whatdid with the output style, and whatdid with auto-map.
- **`demo/`.** A deterministic demo session and a vhs tape for the README GIF, with no API calls.
- **CI.** Tests run on Ubuntu, macOS and Windows with Node 20, 22, 24 and 26, plus `claude plugin validate`.
