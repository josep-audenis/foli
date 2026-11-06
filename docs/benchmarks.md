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

## Pagination: layout, keystrokes and re-flow (Phase 5)

**Run:** `pnpm bench:layout` (Playwright, `playwright.bench.config.ts`, one worker; about 2.5
minutes for all three engines). Each test prints a `BENCH {…}` line. Not part of `pnpm check` or
`pnpm test:e2e`. Source: `apps/playground/bench/pagination.bench.ts`, driving the dev-only page
`apps/playground/bench.html` (`src/bench.tsx`), which mounts `DocumentEditor` and times it from
inside the page.

**Fixtures:** `benchDocument(sections)` in `apps/playground/e2e/fixtures.ts`: per section a level-2
heading and thirteen paragraphs of one to five lines (synthetic words, no marks), A4 with 25.4 mm
margins, laid out with the bundled test font (Tinos, loaded before the editor mounts). One section
is about one page; paragraphs split across pages and the keep-with-next and widow/orphan rules
apply. 1, 10, 50, 100 and 200 sections give 1, 10, 50, 100 and 199 pages.

**Operations:**

- **layout:** mounting the editor (`flushSync` render of `DocumentEditor`: view creation, measuring
  every block, the page flow, the DOM of every page), synchronous. **To paint:** until the next
  frame has been painted. Median of 5 mounts.
- **type / Enter:** 88 characters typed, then 10 Enter presses, at the start of the first paragraph
  on page 1, the worst place: a re-wrap or a new paragraph moves every later page. Each key is
  timed from its `keydown` event's `timeStamp` to the end of the editor's handlers (**handler**,
  the engine's own work: transaction, view update, incremental re-flow) and to the next painted
  frame (**paint**: `requestAnimationFrame`, then a task, so after the frame's style, layout and
  paint). Keys are 40-56 ms apart, so they arrive at any point of a frame.
- **re-flow:** a full re-flow without an edit, as when web fonts finish loading (a `loadingdone`
  event on `document.fonts`): every block measured again and the whole document flowed. Timed from
  the start of the frame that re-flows to its paint. Median of 5.

**Environment:** Intel Core i7-13700H, 16 GB RAM, Windows 11, laptop under normal desktop load;
Playwright 1.64.1 with its bundled Chromium 156.0.8078.4, Firefox 157.0 and WebKit 27.2
(headless, Desktop Chrome/Firefox/Safari device settings, 1280×720), Node.js 25.3.0, Vite dev
server (unminified source), 2026-11-06. Mean of two full runs.

Milliseconds (lower is better). Keystroke columns are p50 / p95 of the samples:

| Engine   | Pages | layout | to paint | type handler p50 | type paint p50 / p95 | Enter handler p50 | Enter paint p50 / p95 | re-flow |
| -------- | ----: | -----: | -------: | ---------------: | -------------------: | ----------------: | --------------------: | ------: |
| Chromium |     1 |    1.4 |     13.8 |              1.2 |            2.2 / 4.0 |               1.4 |             2.3 / 6.0 |     1.6 |
| Chromium |    10 |    4.2 |      7.5 |              1.6 |            2.8 / 4.8 |               2.9 |             4.2 / 7.3 |     3.8 |
| Chromium |    50 |   21.9 |     36.5 |              3.0 |            4.3 / 7.5 |               4.4 |            6.1 / 10.8 |     9.9 |
| Chromium |   100 |   38.7 |     64.3 |              4.2 |            6.0 / 9.8 |               6.8 |            8.9 / 15.8 |    21.4 |
| Chromium |   199 |   88.2 |    140.6 |              8.2 |          10.8 / 17.1 |               9.4 |           12.5 / 18.5 |    28.6 |
| Firefox  |     1 |      3 |        8 |                1 |                2 / 4 |               1.5 |               2.5 / 4 |       1 |
| Firefox  |    10 |      8 |       11 |                2 |                3 / 5 |               2.5 |               4 / 5.5 |       3 |
| Firefox  |    50 |     22 |       34 |              2.5 |              4 / 6.5 |                 2 |             4.5 / 9.5 |       6 |
| Firefox  |   100 |     46 |       68 |              3.5 |            5.5 / 7.5 |                 3 |             5.5 / 8.5 |      10 |
| Firefox  |   199 |    102 |      144 |                5 |               9 / 12 |                 7 |              9.5 / 19 |      22 |
| WebKit   |     1 |      3 |       60 |              1.5 |              15 / 35 |               1.5 |               14 / 33 |       9 |
| WebKit   |    10 |      8 |       66 |              1.5 |              15 / 40 |                 3 |               16 / 44 |      14 |
| WebKit   |    50 |     36 |       78 |                3 |              16 / 37 |                 4 |               16 / 34 |      22 |
| WebKit   |   100 |     91 |      147 |                4 |              21 / 48 |                 6 |               22 / 48 |      50 |
| WebKit   |   199 |    252 |      325 |                7 |              28 / 48 |               8.5 |               26 / 41 |      91 |

**Caveats:**

- Firefox and WebKit round `performance.now()` to whole milliseconds (the halves are means of
  two runs). Run-to-run differences were up to ~30% on single cells; treat them as magnitudes.
- **WebKit here is Playwright's Windows port, not Safari.** It paints in software: the page
  shadows of the default theme make its frames slow (keys pressed back to back took ~90 ms to
  paint, ~25 ms with `box-shadow: none`), which is most of its "to paint" and paint columns. Its
  handler columns are comparable with the other engines; its paint columns say nothing about
  Safari on macOS.
- Paint times depend on the frame clock (60 Hz headless): a key that arrives just after a frame
  waits for the next one, so p95 includes up to one frame of waiting.
- Typing at the start of page 1 is the worst place for the re-flow, not for the handler's other
  costs; typing late in a long document is cheaper.
- Pressing keys back to back right after each paint (no gap) put every key at the start of a frame
  and measured a full frame of waiting (~15 ms in Chromium at any size); the gap avoids that.

**Reading:**

- **Keystrokes stay within a frame up to 100 pages** in Chromium and Firefox (p95 at most
  15.8 ms with Enter, which moves every later page). The handler grows linearly with the document
  (about 0.04 ms per page in Chromium): the view walks every block on each update and the re-flow
  of an Enter runs to the end of the document. At 200 pages the p95 is just over one frame
  (17-19 ms).
- **Mounting** costs about 0.4-0.5 ms per page synchronously in Chromium and Firefox (every block
  measured once), so 100 pages block the main thread for ~40-50 ms and paint after ~65 ms.
- **A full re-flow** (font load, settings change, resize) costs about 0.1-0.2 ms per page.

**Targets** (set from this baseline, on this machine, in Chromium and Firefox; WebKit handler
columns only). A change that breaks one needs a reason in its PR, and the table above re-run:

| Measure                                 | 100 pages | 200 pages |
| --------------------------------------- | --------: | --------: |
| Keystroke-to-paint p95 (type and Enter) | ≤ 16.7 ms |   ≤ 25 ms |
| Keystroke handler p50 (type and Enter)  |    ≤ 8 ms |   ≤ 12 ms |
| Initial layout (synchronous)            |   ≤ 60 ms |  ≤ 120 ms |
| Full re-flow                            |   ≤ 30 ms |   ≤ 40 ms |

Not done yet: the per-keystroke walk over every block, virtualizing pages far from the viewport,
and moving the first layout off the main thread. None is needed for these targets; revisit when a
target fails or documents grow past a few hundred pages.
