---
name: map
description: Compact ranked map of this codebase (key files, their function/class signatures, and the import graph) in about 2k tokens. Use it BEFORE broad Glob/Grep/Read exploration whenever you need to get oriented in an unfamiliar codebase, find where something lives, or decide which files to read.
user-invocable: false
---

This is whatdid's repo map of this project. A script built it from the source (regex symbols, import graph, PageRank), with no model involved:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/map.mjs" "${CLAUDE_PROJECT_DIR}"`

Use it like this:

- Treat the map as your first survey of the codebase. Don't re-list directories or grep for things the map already shows: file locations, exported names, signatures, and who imports whom.
- From the map, pick the **few** files that matter for the task (usually 1–5, starting with the highest-ranked relevant ones) and Read only those. Grep only for specifics the map can't answer, such as string literals, call sites inside function bodies, or config values.
- **Big files have line numbers** (`L234 class Context`, `make_formatter:660`). Read just that region with offset/limit, e.g. offset 230, limit 120, instead of the whole file. That's where most of the token savings come from.
- "imported by N" marks hub files: changing one affects every file that imports it. Check the Imports section before editing a hub.
- If the part you need isn't shown, use Grep for that specific name.
- If the user only asked for the map, show it in a ```text block with a one-line summary, and read no files.
