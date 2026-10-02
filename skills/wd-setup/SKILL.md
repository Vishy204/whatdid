---
name: wd-setup
description: Configure what did. Default installs the live statusline. "auto off" hides the one-line summary shown after every turn ("auto on" brings it back), "pane off|on" chooses whether wd opens in a colour pane below Claude Code, "notify off|on" turns the desktop notification after long turns off or on, "automap on|off|auto" controls preloading the ~2k-token repo map into every session (off by default; auto does it only for large codebases), "uninstall" removes the statusline.
disable-model-invocation: true
argument-hint: "[auto on|off | pane on|off | notify on|off | automap on|off|auto | uninstall]"
---

If the arguments start with "auto" but not "automap", run (pass "off" to disable):
`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" auto <on|off>`
Tell the user what changed in one sentence: the summary after every turn is now shown or hidden. It costs zero tokens either way.

If the arguments start with "pane", run (pass "off" to disable):
`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" pane <on|off>`

If the arguments start with "notify", run (pass "off" to disable):
`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" notify <on|off>`

If the arguments start with "automap", run with on, off or auto (off is the default; with no word after automap, use auto, which preloads the map only for large codebases):
`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" automap <on|off|auto>`
Tell the user it applies from the next new session.

If the arguments are "uninstall" or "remove", run:
`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" uninstall-statusline`

Otherwise run:
`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" statusline`

Report what the script printed in one or two sentences. If the user already had a statusline, tell them it is kept and still shows first.
