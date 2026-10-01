# Security

## Reporting a vulnerability

Please report security issues privately through GitHub's **Report a vulnerability** button on the repo's Security tab, not in a public issue. You'll get a reply within a few days.

## What what did does on your machine

- **Reads:** Claude Code's hook events, Claude's transcript for the current session, and your project's source files when you ask for a map.
- **Writes:** only inside `~/.whatdid/` (session logs, config, reports, the statusline script). On macOS and Linux the folder is private to you (`0700`, files `0600`). The one exception is `/whatdid:setup`, which adds a statusline entry to `~/.claude/settings.json` after making a backup.
- **Network:** none. The HTML report loads Mermaid, pinned to an exact version, from cdn.jsdelivr.net, under a Content Security Policy that blocks every other connection.
- **Model calls:** none, except `/whatdid:explain` and the optional auto-map, which are documented in the README.

## What is logged

Logs hold file paths, line counts, your prompts and the commands Claude ran. They never hold file contents. Before anything is written, what did redacts common secrets: API keys and tokens (Anthropic, OpenAI, GitHub, GitLab, AWS, Google, Stripe, npm, Slack), JWTs, private keys, Bearer and Basic auth headers, passwords in URLs, `--password`-style flags, and `KEY=value` pairs whose name contains token, secret, password or api key. Redaction is pattern-based, so treat the logs as private.

## Hardening

- Hook input never reaches a shell. Session ids are reduced to safe file names.
- Text shown in the terminal has control characters removed, so a file name or command can't inject escape sequences.
- The HTML report escapes all content and renders Mermaid with `securityLevel: 'strict'`.
- Skills Claude can trigger on its own never pass arguments into shell commands.

Delete `~/.whatdid/` at any time to remove everything.
