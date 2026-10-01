---
name: wd-help
description: Free (0 tokens) · list every what did command and what it does.
disable-model-invocation: true
argument-hint: ""
---

The what did hook answers this command for free, before it reaches you, so this text only appears if the plugin's hooks are off.
In that case, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/render.mjs" --session "${CLAUDE_SESSION_ID}" --help $ARGUMENTS` and show its output verbatim in a text block, with nothing else.
