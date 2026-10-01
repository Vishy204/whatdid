# Security

## Reporting a vulnerability

Please report security issues privately through GitHub's **Report a vulnerability** button on the repo's Security tab, not in a public issue. You'll get a reply within a few days.

## What what did does on your machine

- **Reads:** Claude Code's hook events, Claude's transcript for the current session (for notes, token counts and, with `wd diff`, the lines Claude changed), and your project's source files when you ask for a map.
- **Writes:** only inside `~/.whatdid/` (session logs, config, reports, the statusline script). On macOS and Linux the folder and everything in it (logs, config, reports, map cache, statusline script) is private to you (`0700`, files `0600`), and folders made by older versions are tightened at the next session start. The one exception is `/whatdid:setup`, which adds a statusline entry to `~/.claude/settings.json` after making a backup.
- **Network:** none. The HTML report is fully self-contained: its flowchart is SVG drawn by what did, and a Content Security Policy blocks scripts and every network request.
- **Model calls:** none, except `/whatdid:explain` and the optional auto-map, which are documented in the README.

## What is logged

Logs hold file paths, line counts, your prompts and the commands Claude ran. They never hold file contents. `wd diff` shows changed lines by reading Claude Code's own transcript when you ask, and redacts them the same way. `wd html` includes them in the report it writes, which is private like everything else in `~/.whatdid/`. Before anything is written, what did redacts common secrets: API keys and tokens (Anthropic, OpenAI, GitHub, GitLab, AWS, Google, Stripe, npm, Slack), JWTs, private keys, `Authorization`, `Proxy-Authorization`, `Cookie` and `Set-Cookie` headers (whatever the scheme), passwords in URLs, `--cookie`, `--password`-style flags, and `KEY=value` pairs whose name contains token, secret, password or api key. Redaction is pattern-based, so treat the logs as private.

## Hardening

- Hook input never reaches a shell. Session ids are reduced to safe file names.
- Text shown in the terminal has control characters removed, so a file name or command can't inject escape sequences.
- The HTML report escapes all content and contains no JavaScript.
- Skills Claude can trigger on its own never pass arguments into shell commands.

Delete `~/.whatdid/` at any time to remove everything.
