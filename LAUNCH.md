# Launch kit

Everything needed to take what did public. Delete this file after launch, or keep it for the next release.

## Before launch (about 30 minutes)

- [ ] Create the GitHub repo **Vishy204/whatdid** (public). Push, then check that the CI badge goes green.
- [ ] Repo settings: upload `assets/social-preview.png` under *Settings → Social preview*.
- [ ] Description: `See what Claude Code did, in plain English, for zero tokens. Type wd.`
- [ ] Topics: `claude-code` `claude-code-plugin` `ai-agents` `developer-tools` `observability` `cli` `anthropic`
- [ ] Publish to npm: run `npm publish` (the name `whatdid` was free on 2026-09-30), then check that `npx whatdid install` works.
- [ ] Do a fresh install on a clean machine or account: `/plugin marketplace add Vishy204/whatdid`, then do a task, then type `wd`.
- [ ] Tag the release: `claude plugin tag` or `git tag v0.1.0`, and write the GitHub release notes from `CHANGELOG.md`.
- [ ] Optional: submit to Anthropic's plugin directory, and open PRs to the awesome-claude-code lists.

## Timing

Post Tuesday to Thursday, 8–10am US Eastern. Post Show HN first; post Reddit and X about an hour later, linking to the repo, not to HN. Stay online for 3–4 hours and answer every comment fast and honestly.

## Show HN

The brand is **what did**. The repo, npm package and command are `whatdid`.

**Title:** Show HN: What did – a zero-token map of what Claude Code just did

**Text:**

> Claude Code's terminal scrolls by as a wall of Read/Grep/Edit calls, and I kept pasting it into another chat to ask "what did it just do?"
>
> what did is a Claude Code plugin that records every step with hooks. When you type `wd`, a hook intercepts the prompt and prints a plain-English map: what you asked, the files it read and changed (with +/− lines), how those files import each other, commands with pass/fail, and a recap. The prompt is blocked before it reaches the API, so it costs zero tokens and can't make anything up. It's a log, not Claude's own account.
>
> There's also an optional output style where Claude narrates as it works, with typed one-line notes (◆ why, ◇ found, ▲ risk, ◌ need), plus a replay timeline, an HTML report with a flowchart, and a live statusline.
>
> It's zero-dependency Node and works on Windows, macOS and Linux. Everything stays local.
>
> Optionally, it preloads a ~2k-token repo map with line numbers into large files, so Claude knows where things live on big codebases. The README has a table of exactly what costs tokens (almost nothing), benchmarks on excalidraw, pydantic and hugo pinned so you can rerun them, and a script to measure your own repo.
>
> I'd love feedback on the narration vocabulary and on what else you wish you could see after a long agent run.

## r/ClaudeAI

**Title:** I made Claude Code explain what it did — type `wd`, get a plain-English map, 0 tokens

**Body:** use the HN text, drop the benchmark caveat into a comment, and attach `assets/hero.gif`.

## X / Twitter thread

1. Claude Code is amazing until you scroll up and have no idea what it just did.
   So I built what did: type `wd`, get a plain-English map of every step. Zero tokens. 🧵 [hero.gif]
2. How it's free: a Claude Code hook intercepts `wd` before it reaches the API, then prints the map from a local log. No model call, so no tokens and no hallucinated summary.
3. With the what did output style, Claude narrates as it works: ◆ why · ◇ found · ✔ done · ▲ risk · ◌ need, then a recap of changed / verified / left. [replay.gif]
4. Optional auto-map: a 2k-token repo map with line numbers into large files, preloaded so Claude knows where things live on big codebases.
5. Also: a replay timeline, an HTML report with a flowchart, a live statusline, and an auto one-line card after every turn.
6. Zero deps, Windows/macOS/Linux, MIT. github.com/Vishy204/whatdid

## Likely questions, with honest answers

- **"Why not just ask Claude?"** You can. It costs a full model call, it's Claude's own account, and it only knows what survived compaction. `wd` is free and comes from a factual log.
- **"Doesn't `/recap` do this?"** `/recap` is a one-line summary when you return to a session. `wd` is the full map, with files, diffs, commands, failures and reasons.
- **"Does it save tokens overall?"** `wd` is free every time. For auto-map the savings depend on the codebase: it was 25% cheaper on one private 670k-token product, about even on excalidraw and hugo, and 24% more on pydantic. Per-question numbers are in `bench/results`, and `bench/local.mjs` measures your own repo.
- **"Is my code sent anywhere?"** No. Logs stay in `~/.whatdid/`, hold no file contents, and have secrets redacted.
