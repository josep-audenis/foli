# Benchmarks

Numbers are only meaningful with their method. Each section says what was measured, on what,
and how to reproduce it. Re-run and update a section when the code it measures changes.

## Document model: build and serialize (Phase 2)

**Run:** `pnpm --filter @foli/core bench` (Vitest 5 benchmark mode, tinybench under the hood;
source: `packages/core/src/model/model.bench.ts`).

**Fixtures:** `pagesFixture(n)` in `packages/core/src/testing/index.ts`: per page one heading and
five paragraphs of ~600 characters, each with a bold run, a bold+italic run and a hard break.
About 3,100 positions and 4.5 kB of JSON per page. Synthetic text, schema v1 only.

**Operations:**

- **build:** `schema.nodeFromJSON(json)`: strict validation plus construction of the immutable tree.
- **serialize:** `doc.toJSON()`: canonical JSON object tree.
- **load:** `JSON.parse` of the stored envelope + `parseDocument` (validate, normalize, re-serialize).
- **save:** `JSON.stringify(doc.toJSON())`.

**Environment:** Intel Core i7-13700H, 16 GB RAM, Windows 11, Node.js 25.3.0, Vitest 5.1.0,
2026-11-04, on a laptop under normal desktop load (not an isolated machine).

Mean time per operation, in milliseconds (lower is better):

| Pages | Positions | JSON size | build | serialize |  load |  save |
| ----: | --------: | --------: | ----: | --------: | ----: | ----: |
|     1 |     3,116 |    4.6 kB | 0.044 |     0.001 | 0.082 | 0.009 |
|    10 |    31,272 |   44.7 kB |  0.49 |     0.012 |  0.85 | 0.074 |
|    50 |   156,438 |  223.1 kB |  2.84 |     0.059 |  3.92 |  0.48 |
|   100 |   312,889 |  446.1 kB |  3.50 |     0.095 |  6.15 |  1.66 |

**Caveats:**

- Run-to-run variance on this machine is large (up to ~±40% for the 1-page build); treat the
  numbers as orders of magnitude, not targets. The 50-page row had GC outliers (p99 ≫ mean).
- Vitest runs the source through its module runner, which turns cross-module references into
  getter calls and warns about it. A native Node.js cross-check of the built package (`dist/`,
  plain `performance.now()` loop, 500 iterations after 200 warm-up) measured **2.55 ms** for the
  100-page build, so the Vitest numbers overstate build time by roughly a quarter.
- `serialize` returns a fresh object tree each time; most of `save` is `JSON.stringify`.

**Reading:** loading a 100-page document (parse, validate, normalize) takes a few milliseconds,
well under one frame. Nothing here is on the keystroke path; edits will reuse unchanged nodes
(structural sharing) instead of rebuilding the tree.
