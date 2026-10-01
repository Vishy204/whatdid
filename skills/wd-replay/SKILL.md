---
name: wd-replay
description: Free (0 tokens) · every single step of the last turn in order, with timings and Claude's reason for each.
disable-model-invocation: true
argument-hint: "[turns back, e.g. 2]"
---

The what did hook answers this command for free, before it reaches you, so this text only appears if the plugin's hooks are off.
In that case, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/render.mjs" --session "${CLAUDE_SESSION_ID}" --replay $ARGUMENTS` and show its output verbatim in a text block, with nothing else.
