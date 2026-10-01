---
name: wd-diff
description: Free (0 tokens) · the exact lines Claude changed in the last turn, file by file, with line numbers.
disable-model-invocation: true
---

The what did hook answers this command for free, before it reaches you, so this text only appears if the plugin's hooks are off.
In that case, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/render.mjs" --session "${CLAUDE_SESSION_ID}" --diff` and show its output verbatim in a text block, with nothing else.
