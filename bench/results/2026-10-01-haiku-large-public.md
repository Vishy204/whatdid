# what did bench · large public codebases · haiku · 2026-10-01

Three well-known open-source repos, pinned to exact commits in `bench/large/*.json`. Four architecture questions each, read-only (Read/Grep/Glob only), two runs per condition. Graded by expected file/symbol names. Rerun with `node bench/local.mjs bench/large/<repo>.json`.

## excalidraw (TypeScript, ~1.5M tokens of source)

| task | condition | runs | pass | median input tok | median output tok | median cost $ | median time s | median turns |
|---|---|---|---|---|---|---|---|---|
| excalidraw-undo | baseline | 2 | 2/2 | 68k | 1.0k | 0.028 | 12 | 4 |
| excalidraw-undo | whatdid-automap | 2 | 2/2 | 99k (+46%) | 1.1k (+6%) | 0.029 (+5%) | 14 | 4.5 |
| excalidraw-collab | baseline | 2 | 2/2 | 121k | 1.6k | 0.034 | 19 | 10 |
| excalidraw-collab | whatdid-automap | 2 | 2/2 | 145k (+20%) | 1.7k (+5%) | 0.044 (+27%) | 19 | 9 |
| excalidraw-export | baseline | 2 | 2/2 | 160k | 1.5k | 0.037 | 19 | 8 |
| excalidraw-export | whatdid-automap | 2 | 2/2 | 227k (+42%) | 1.7k (+19%) | 0.057 (+51%) | 23 | 9.5 |
| excalidraw-hit-test | baseline | 2 | 2/2 | 687k | 4.5k | 0.133 | 56 | 24 |
| excalidraw-hit-test | whatdid-automap | 2 | 2/2 | 477k (-31%) | 3.6k (-20%) | 0.101 (-24%) | 42 | 23.5 |

**Totals (sum of per-task medians)**

| condition | pass | input tok | output tok | cost $ |
|---|---|---|---|---|
| baseline | 8/8 | 1036k | 8.5k | 0.233 |
| whatdid-automap | 8/8 | 948k (-8%) | 8.0k (-6%) | 0.230 (-1%) |


## pydantic (Python + Rust, ~1.9M tokens of source)

| task | condition | runs | pass | median input tok | median output tok | median cost $ | median time s | median turns |
|---|---|---|---|---|---|---|---|---|
| pydantic-model-build | baseline | 2 | 2/2 | 232k | 2.2k | 0.063 | 27 | 13 |
| pydantic-model-build | whatdid-automap | 2 | 2/2 | 281k (+21%) | 2.5k (+11%) | 0.067 (+6%) | 30 | 11.5 |
| pydantic-field-validator | baseline | 2 | 1/2 | 324k | 2.4k | 0.074 | 31 | 13.5 |
| pydantic-field-validator | whatdid-automap | 2 | 2/2 | 645k (+99%) | 3.4k (+43%) | 0.128 (+74%) | 54 | 22.5 |
| pydantic-json-schema | baseline | 2 | 2/2 | 163k | 1.7k | 0.044 | 21 | 9.5 |
| pydantic-json-schema | whatdid-automap | 2 | 2/2 | 159k (-2%) | 1.4k (-18%) | 0.039 (-11%) | 18 | 7.5 |
| pydantic-core-errors | baseline | 2 | 2/2 | 111k | 1.2k | 0.040 | 14 | 7 |
| pydantic-core-errors | whatdid-automap | 2 | 2/2 | 120k (+7%) | 1.2k (+1%) | 0.040 (-1%) | 15 | 6 |

**Totals (sum of per-task medians)**

| condition | pass | input tok | output tok | cost $ |
|---|---|---|---|---|
| baseline | 7/8 | 830k | 7.6k | 0.221 |
| whatdid-automap | 8/8 | 1204k (+45%) | 8.6k (+13%) | 0.273 (+24%) |


## hugo (Go, ~1.6M tokens of source)

| task | condition | runs | pass | median input tok | median output tok | median cost $ | median time s | median turns |
|---|---|---|---|---|---|---|---|---|
| hugo-build | baseline | 2 | 2/2 | 114k | 1.2k | 0.053 | 16 | 7 |
| hugo-build | whatdid-automap | 2 | 2/2 | 158k (+38%) | 1.6k (+38%) | 0.045 (-16%) | 21 | 9 |
| hugo-markdown | baseline | 2 | 2/2 | 110k | 1.3k | 0.030 | 17 | 8 |
| hugo-markdown | whatdid-automap | 2 | 2/2 | 105k (-5%) | 1.3k (0%) | 0.032 (+5%) | 17 | 6.5 |
| hugo-front-matter | baseline | 2 | 2/2 | 131k | 1.4k | 0.039 | 17 | 6.5 |
| hugo-front-matter | whatdid-automap | 2 | 2/2 | 90k (-31%) | 1.2k (-15%) | 0.046 (+18%) | 14 | 7 |
| hugo-image-resize | baseline | 2 | 2/2 | 282k | 2.2k | 0.073 | 29 | 12 |
| hugo-image-resize | whatdid-automap | 2 | 2/2 | 325k (+15%) | 2.7k (+19%) | 0.072 (-2%) | 34 | 13.5 |

**Totals (sum of per-task medians)**

| condition | pass | input tok | output tok | cost $ |
|---|---|---|---|---|
| baseline | 8/8 | 638k | 6.1k | 0.195 |
| whatdid-automap | 8/8 | 678k (+6%) | 6.8k (+11%) | 0.195 (0%) |


