# what did bench · auto-map on five large public codebases · haiku · 2026-10-01

Five well-known open-source repos, pinned to exact commits in `bench/large/*.json`. Four architecture questions each, read-only (Read/Grep/Glob only), three runs per condition: `baseline` (no plugin) and `whatdid-automap` (the ~2k-token map preloaded at session start). Answers are graded by the file and symbol names they mention. Cost is Claude Code's own `total_cost_usd` for each run. Rerun any suite with `node bench/local.mjs bench/large/<repo>.json --reps 3`.

Results vary a lot from run to run: the same question with the same setup can take 9 turns or 26. An earlier two-run pass over excalidraw, hugo and pydantic gave −1%, 0% and +24%; with three runs they came out at −17%, −16% and −23%. Read the per-repo numbers as noisy and the total across all five as the better guide.

## hugo (Go, ~1.6M tokens of source)

| task | condition | runs | pass | median input tok | median output tok | median cost $ | median time s | median turns |
|---|---|---|---|---|---|---|---|---|
| hugo-build | baseline | 3 | 3/3 | 107k | 1.2k | 0.043 | 16 | 7 |
| hugo-build | whatdid-automap | 3 | 3/3 | 91k (-15%) | 1.3k (+8%) | 0.035 (-20%) | 19 | 4 |
| hugo-markdown | baseline | 3 | 2/3 | 99k | 1.1k | 0.029 | 15 | 5 |
| hugo-markdown | whatdid-automap | 3 | 3/3 | 90k (-9%) | 1.1k (-4%) | 0.028 (-2%) | 13 | 5 |
| hugo-front-matter | baseline | 3 | 3/3 | 284k | 1.8k | 0.085 | 25 | 9 |
| hugo-front-matter | whatdid-automap | 3 | 3/3 | 119k (-58%) | 1.4k (-19%) | 0.044 (-48%) | 17 | 7 |
| hugo-image-resize | baseline | 3 | 3/3 | 293k | 2.6k | 0.067 | 32 | 12 |
| hugo-image-resize | whatdid-automap | 3 | 3/3 | 314k (+7%) | 2.6k (+1%) | 0.080 (+20%) | 28 | 15 |

**Totals (sum of per-task medians)**

| condition | pass | input tok | output tok | cost $ |
|---|---|---|---|---|
| baseline | 11/12 | 783k | 6.7k | 0.224 |
| whatdid-automap | 12/12 | 613k (-22%) | 6.4k (-4%) | 0.187 (-16%) |

## excalidraw (TypeScript, ~1.5M tokens of source)

| task | condition | runs | pass | median input tok | median output tok | median cost $ | median time s | median turns |
|---|---|---|---|---|---|---|---|---|
| excalidraw-undo | baseline | 3 | 3/3 | 74k | 876 | 0.020 | 12 | 4 |
| excalidraw-undo | whatdid-automap | 3 | 3/3 | 66k (-11%) | 734 (-16%) | 0.020 (+4%) | 10 | 4 |
| excalidraw-collab | baseline | 3 | 3/3 | 75k | 1.3k | 0.027 | 15 | 6 |
| excalidraw-collab | whatdid-automap | 3 | 3/3 | 113k (+51%) | 1.4k (+7%) | 0.033 (+20%) | 17 | 7 |
| excalidraw-export | baseline | 3 | 3/3 | 154k | 1.6k | 0.045 | 24 | 7 |
| excalidraw-export | whatdid-automap | 3 | 3/3 | 208k (+35%) | 1.6k (+2%) | 0.039 (-14%) | 22 | 9 |
| excalidraw-hit-test | baseline | 3 | 2/3 | 746k | 4.5k | 0.132 | 62 | 26 |
| excalidraw-hit-test | whatdid-automap | 3 | 3/3 | 496k (-34%) | 3.4k (-24%) | 0.095 (-28%) | 45 | 20 |

**Totals (sum of per-task medians)**

| condition | pass | input tok | output tok | cost $ |
|---|---|---|---|---|
| baseline | 11/12 | 1049k | 8.2k | 0.224 |
| whatdid-automap | 12/12 | 882k (-16%) | 7.1k (-14%) | 0.187 (-17%) |

## pydantic (Python + Rust, ~1.9M tokens of source)

| task | condition | runs | pass | median input tok | median output tok | median cost $ | median time s | median turns |
|---|---|---|---|---|---|---|---|---|
| pydantic-model-build | baseline | 3 | 3/3 | 279k | 2.3k | 0.079 | 32 | 12 |
| pydantic-model-build | whatdid-automap | 3 | 3/3 | 228k (-18%) | 2.1k (-9%) | 0.049 (-38%) | 25 | 10 |
| pydantic-field-validator | baseline | 3 | 3/3 | 559k | 3.9k | 0.115 | 49 | 21 |
| pydantic-field-validator | whatdid-automap | 3 | 3/3 | 210k (-62%) | 1.8k (-55%) | 0.103 (-10%) | 23 | 9 |
| pydantic-json-schema | baseline | 3 | 3/3 | 152k | 1.6k | 0.036 | 25 | 8 |
| pydantic-json-schema | whatdid-automap | 3 | 3/3 | 110k (-28%) | 1.3k (-19%) | 0.032 (-12%) | 15 | 7 |
| pydantic-core-errors | baseline | 3 | 3/3 | 118k | 1.4k | 0.046 | 17 | 8 |
| pydantic-core-errors | whatdid-automap | 3 | 3/3 | 90k (-24%) | 1.2k (-17%) | 0.028 (-39%) | 14 | 6 |

**Totals (sum of per-task medians)**

| condition | pass | input tok | output tok | cost $ |
|---|---|---|---|---|
| baseline | 12/12 | 1108k | 9.3k | 0.277 |
| whatdid-automap | 12/12 | 637k (-42%) | 6.3k (-32%) | 0.213 (-23%) |

## tokio (Rust, ~1.5M tokens of source)

| task | condition | runs | pass | median input tok | median output tok | median cost $ | median time s | median turns |
|---|---|---|---|---|---|---|---|---|
| tokio-work-stealing | baseline | 3 | 3/3 | 166k | 2.0k | 0.051 | 25 | 10 |
| tokio-work-stealing | whatdid-automap | 3 | 3/3 | 177k (+6%) | 1.8k (-12%) | 0.052 (+1%) | 24 | 7 |
| tokio-sleep | baseline | 3 | 3/3 | 242k | 2.4k | 0.060 | 28 | 14 |
| tokio-sleep | whatdid-automap | 3 | 3/3 | 379k (+56%) | 2.8k (+15%) | 0.092 (+54%) | 35 | 15 |
| tokio-spawn | baseline | 3 | 3/3 | 184k | 1.8k | 0.044 | 23 | 10 |
| tokio-spawn | whatdid-automap | 3 | 3/3 | 208k (+13%) | 2.1k (+14%) | 0.064 (+47%) | 27 | 11 |
| tokio-mpsc | baseline | 3 | 3/3 | 321k | 2.6k | 0.080 | 32 | 14 |
| tokio-mpsc | whatdid-automap | 3 | 3/3 | 328k (+2%) | 2.3k (-12%) | 0.077 (-4%) | 32 | 12 |

**Totals (sum of per-task medians)**

| condition | pass | input tok | output tok | cost $ |
|---|---|---|---|---|
| baseline | 12/12 | 914k | 8.8k | 0.234 |
| whatdid-automap | 12/12 | 1091k (+19%) | 8.9k (+1%) | 0.284 (+21%) |

## fastapi (Python, ~0.9M tokens of source)

| task | condition | runs | pass | median input tok | median output tok | median cost $ | median time s | median turns |
|---|---|---|---|---|---|---|---|---|
| fastapi-depends | baseline | 3 | 3/3 | 346k | 2.6k | 0.083 | 37 | 15 |
| fastapi-depends | whatdid-automap | 3 | 3/3 | 130k (-62%) | 1.5k (-43%) | 0.034 (-59%) | 18 | 8 |
| fastapi-openapi | baseline | 3 | 3/3 | 327k | 1.9k | 0.109 | 24 | 9 |
| fastapi-openapi | whatdid-automap | 3 | 3/3 | 208k (-36%) | 1.9k (+1%) | 0.041 (-62%) | 27 | 10 |
| fastapi-request-handler | baseline | 3 | 2/3 | 221k | 2.0k | 0.056 | 26 | 10 |
| fastapi-request-handler | whatdid-automap | 3 | 3/3 | 247k (+12%) | 2.1k (+3%) | 0.060 (+7%) | 27 | 10 |
| fastapi-errors | baseline | 3 | 3/3 | 140k | 1.2k | 0.030 | 17 | 7 |
| fastapi-errors | whatdid-automap | 3 | 3/3 | 67k (-52%) | 857 (-30%) | 0.023 (-22%) | 10 | 4 |

**Totals (sum of per-task medians)**

| condition | pass | input tok | output tok | cost $ |
|---|---|---|---|---|
| baseline | 11/12 | 1034k | 7.8k | 0.277 |
| whatdid-automap | 12/12 | 653k (-37%) | 6.4k (-18%) | 0.159 (-43%) |
