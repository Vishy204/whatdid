---
name: wd
description: Free (0 tokens) · what Claude did in the last turn: files read and changed, commands, failures, its answer. Add 3 or all for more turns.
disable-model-invocation: true
argument-hint: "[3 | all]"
---

The what did hook answers this command for free, before it reaches you, so this text only appears if the plugin's hooks are off.
In that case, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/render.mjs" --session "${CLAUDE_SESSION_ID}"  $ARGUMENTS` and show its output verbatim in a text block, with nothing else.
