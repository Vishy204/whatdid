# what did bench · large private codebase · haiku · 2026-09-30

Codebase: private product codebase: 295 source files (Python 168, TypeScript 125, JS 2), ~670k tokens of source, plus a bundled .venv and a nested worktree copy.

Four architecture questions (auth tokens, a multi-stage pipeline, document indexing, frontend auth), each run twice per condition, read-only. Input tokens = input + cache creation + cache read; cost includes subagents.

| task | condition | runs | pass | median input tok | median output tok | median cost $ | median time s | median turns |
|---|---|---|---|---|---|---|---|---|
| q1-auth-tokens | baseline | 2 | 2/2 | 64k | 1.3k | 0.026 | 18 | 5 |
| q1-auth-tokens | whatdid | 2 | 2/2 | 75k (+17%) | 1.5k (+11%) | 0.033 (+25%) | 23 | 6.5 |
| q1-auth-tokens | whatdid-automap | 2 | 2/2 | 44k (-30%) | 861 (-36%) | 0.019 (-26%) | 13 | 2 |
| q2-pipeline-trace | baseline | 2 | 2/2 | 189k | 2.3k | 0.183 | 76 | 6 |
| q2-pipeline-trace | whatdid | 2 | 2/2 | 275k (+45%) | 3.8k (+63%) | 0.117 (-36%) | 49 | 14 |
| q2-pipeline-trace | whatdid-automap | 2 | 2/2 | 318k (+68%) | 3.5k (+51%) | 0.130 (-29%) | 48 | 9.5 |
| q3-indexing | baseline | 2 | 2/2 | 151k | 3.1k | 0.077 | 42 | 10 |
| q3-indexing | whatdid | 2 | 2/2 | 489k (+224%) | 2.9k (-5%) | 0.147 (+92%) | 53 | 14.5 |
| q3-indexing | whatdid-automap | 2 | 2/2 | 98k (-35%) | 2.3k (-26%) | 0.057 (-26%) | 29 | 6 |
| q4-frontend-auth | baseline | 2 | 2/2 | 128k | 1.5k | 0.059 | 28 | 7 |
| q4-frontend-auth | whatdid | 2 | 2/2 | 152k (+19%) | 1.7k (+17%) | 0.064 (+8%) | 33 | 7.5 |
| q4-frontend-auth | whatdid-automap | 2 | 2/2 | 93k (-27%) | 1.2k (-17%) | 0.053 (-11%) | 19 | 4 |

**Totals (sum of per-task medians)**

| condition | pass | input tok | output tok | cost $ |
|---|---|---|---|---|
| baseline | 8/8 | 532k | 8.2k | 0.345 |
| whatdid | 8/8 | 991k (+86%) | 9.9k (+21%) | 0.361 (+5%) |
| whatdid-automap | 8/8 | 553k (+4%) | 7.9k (-4%) | 0.259 (-25%) |
