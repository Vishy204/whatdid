# Testing what did before launch

A checklist for testers while the repo is private. It takes about 20 minutes.

## 1. Get access and install

The repo is private, so the owner first adds you under *Settings → Collaborators*. Accept the invite, then make sure git can reach the repo (`gh auth login`, or `git clone https://github.com/Vishy204/whatdid` works).

Inside Claude Code:

```text
/plugin marketplace add Vishy204/whatdid
/plugin install whatdid@whatdid
```

Restart Claude Code. Alternatives: `npx github:Vishy204/whatdid install`, or clone the repo and run `claude --plugin-dir ./whatdid` to try a working copy without installing it.

Run `npx github:Vishy204/whatdid doctor` (or `whatdid doctor` from a clone) if anything looks off.

## 2. Try every feature

Open Claude Code in a real project and give it a real task, e.g. "find where X is handled and add a test".

- [ ] The first new session shows the hint `◆ what did is on · when Claude finishes, type wd`.
- [ ] When Claude finishes, a one-line card appears: `◆ what did · N steps · …`.
- [ ] `wd`: the map of the last turn. Check that the files, +/− counts and commands match what really happened.
- [ ] `wd replay`, `wd 3`, `wd all`, `wd help`.
- [ ] Type `/wd`: the menu lists `/whatdid:wd`, `wd-replay`, `wd-map`, `wd-html`, `wd-help` with descriptions. Each one opens without using tokens.
- [ ] In the colour pane, click a "+3 more" line (or press `e`): everything expands. `q` closes it.
- [ ] `wd html`: a report opens in the browser with a flowchart.
- [ ] `wd map`: the repo map. Spot-check a few line numbers in a big file.
- [ ] `wd why did you change that` still goes to Claude as a normal question.
- [ ] `/output-style whatdid`, then another task: Claude writes ◆ why / ◇ found notes and ends with a recap.
- [ ] `/whatdid:setup`: the statusline shows Claude's latest note while it works. If you already had a statusline, it should still show first.
- [ ] `/whatdid:setup auto off` hides the card; `auto on` brings it back.
- [ ] Auto-map is off by default. On a big codebase (about 1.6 MB of source code or more), run `/whatdid:setup automap auto`, start a new session and ask an architecture question: Claude should go straight to the right files.

## 3. Measure it yourself (optional, costs about $1 per suite on haiku)

```bash
git clone https://github.com/Vishy204/whatdid && cd whatdid
node bench/local.mjs bench/large/hugo.json                 # a pinned public repo
node bench/local.mjs ~/code/my-app my-questions.json        # your own repo, read-only
```

## 4. Report back

Open an issue on the repo with your OS, terminal, Node version (`node -v`), Claude Code version (`claude -v`), what you typed and what you saw. Screenshots help. Things that are confusing count as bugs too.
