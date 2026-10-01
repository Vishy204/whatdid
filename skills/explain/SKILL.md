---
name: explain
description: Uses tokens · Claude reads the what did map of this session and explains it in plain English, for someone who is not a programmer. Use when the user asks "what did you do", "what just happened", "explain that", or seems lost. For the free map, type /whatdid:wd.
---

Here is the what did record of this session. A script built it from hook data, with no model involved:

```text
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/render.mjs" --session "${CLAUDE_SESSION_ID}"`
```

Reply with exactly two things:

1. The block above, reprinted verbatim inside a ```text fence.
2. Under the heading **In plain English**, at most 4 short sentences for someone who is not a programmer. Say what the goal was, what actually changed and where, and anything that failed, is risky, or is unfinished. Name files by what they do ("the login check"), not only by path.

Don't add anything else. End with this line: `Tip: type wd as your whole message to see the map instantly, without using any tokens (wd help lists more).`
