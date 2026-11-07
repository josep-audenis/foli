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

## Block type change over many blocks (Phase 6 follow-up)

**Run:** `pnpm --filter @foli/core bench` (source: `packages/core/src/transform/transform.bench.ts`).

**Fixture:** 4,000 paragraphs of ~40 characters, no marks (about a 200-page document's block
count).

**Operations:**

- **Transform.setBlockType:** every block to heading level 1 in one transform.
- **undo:** invert that step against the old document and apply it to the new one.
- **editor command:** `editor.commands.setBlockType` with everything selected (`selectAll`),
  alternating H1 and paragraph, including history and selection mapping.

**Environment:** Intel Core i7-13700H, Windows 11, Vitest 5.1.0, 2026-11-07, laptop under normal
desktop load.

Mean time per operation, in milliseconds:

| Transform.setBlockType | undo | editor command |
| ---------------------: | ---: | -------------: |
|                   1.65 | 1.32 |           2.61 |

**Before:** one `NodeMarkupStep` per block, each rebuilding the document, took 1.4-1.9 s for the
same `Transform.setBlockType` (three runs, Vitest test runner). Now a single
`NodeMarkupBatchStep` rebuilds the document once; positions do not move (empty step map).
`packages/core/src/state/editor.test.ts` ("setBlockType over many blocks") guards it with a
generous 250 ms bound.

## Pagination: layout, keystrokes and re-flow (Phase 5)

**Run:** `pnpm bench:layout` (Playwright, `playwright.bench.config.ts`, one worker; about 3
minutes for all three engines). Each test prints a `BENCH {…}` line. Not part of `pnpm check` or
`pnpm test:e2e`. Source: `apps/playground/bench/pagination.bench.ts`, driving the dev-only page
`apps/playground/bench.html` (`src/bench.tsx`), which mounts `FoliEditor` and times it from
inside the page.

**Fixtures:** `benchDocument(sections)` in `apps/playground/e2e/fixtures.ts`: per section a level-2
heading and thirteen paragraphs of one to five lines (synthetic words, no marks), A4 with 25.4 mm
margins, laid out with the bundled test font (Tinos, loaded before the editor mounts). One section
is about one page; paragraphs split across pages and the keep-with-next and widow/orphan rules
apply. 1, 10, 50, 100 and 200 sections give 1, 10, 50, 100 and 199 pages.

**Operations:**

- **layout:** mounting the editor (`flushSync` render of `FoliEditor`: view creation, measuring
  every block, the page flow, the DOM of every page), synchronous. **To paint:** until the next
  frame has been painted. Median of 5 mounts.
- **type / Enter:** 88 characters typed, then 40 Enter presses, at the start of the first
  paragraph on page 1. Each Enter adds a line there and moves every later page (the incremental
  re-flow runs to the end of the document). A typed character changes the paragraph's line count
  about once in 80 keys, so the typing samples are mostly edits that move nothing (the re-flow
  stops after that paragraph).
  - **handler:** from the start of the `keydown` dispatch in the page to the end of the editor's
    handlers (transaction, view update, incremental re-flow, `onChange`).
  - **paint:** from the event's `timeStamp` (input delivery included) to the next painted frame
    (`requestAnimationFrame`, then a task: the main thread has finished the frame's style,
    layout and paint; rasterizing and compositing are not included).
  - Keys are 40-56 ms apart plus a round trip, so they arrive at any point of a frame; each
    sample is checked to belong to the key just pressed.
  - Since 6.2 the bench page's `FoliEditor` includes its toolbar (state updated after every
    transaction); re-run at 100 and 200 pages in Chromium and Firefox, every number stays within
    the targets below (handler p50 3-7 ms).
  - The editor has an `onChange` that reads `change.document`, as an app that saves on every
    change does: the whole document is serialized per keystroke. (Measured with Phase 5's
    `DocumentEditor`, which always serialized; `FoliEditor` only does when `document` is read,
    so the numbers carry over.)
- **re-flow:** a full re-flow as when a web font with other metrics finishes loading: the editor's
  font family switches (to the default sans-serif, then back to the test font; the page count
  changes, e.g. 101 → 105 pages) and a `loadingdone` event fires on `document.fonts`. The browser
  lays all the text out again, and the view measures every block and flows the whole document.
  Timed from the start of the frame that re-flows to its paint. Median of 6 (3 each way); by then
  the document also holds the 40 paragraphs the Enter presses added.

**Environment:** Intel Core i7-13700H, 16 GB RAM, Windows 11, laptop under normal desktop load;
Playwright 1.64.1 with its bundled Chromium 156.0.8078.4, Firefox 157.0 and WebKit 27.2
(headless, Desktop Chrome/Firefox/Safari device settings, 1280×720), Node.js 25.3.0, Vite dev
server (unminified source, React's development build), 2026-11-07. Mean of two full runs.

Milliseconds (lower is better). Keystroke paint columns are p50 / p95 of the samples:

| Engine   | Pages | layout | to paint | type handler p50 | type paint p50 / p95 | Enter handler p50 | Enter paint p50 / p95 | re-flow |
| -------- | ----: | -----: | -------: | ---------------: | -------------------: | ----------------: | --------------------: | ------: |
| Chromium |     1 |    1.5 |     13.1 |              0.9 |            2.2 / 3.5 |               1.1 |             2.0 / 9.5 |     3.0 |
| Chromium |    10 |    5.6 |     10.9 |              1.1 |            2.1 / 3.5 |               2.0 |             3.5 / 5.4 |     7.7 |
| Chromium |    50 |   18.8 |     34.3 |              1.9 |            3.2 / 5.5 |               3.0 |            5.0 / 10.7 |    30.6 |
| Chromium |   100 |   39.8 |     68.0 |              3.5 |            5.2 / 7.9 |               5.1 |            7.8 / 13.2 |    57.5 |
| Chromium |   199 |   82.2 |    136.5 |              5.0 |           7.5 / 10.8 |               6.8 |           10.4 / 21.2 |   131.9 |
| Firefox  |     1 |      3 |       10 |                1 |                2 / 4 |                 2 |                3 / 16 |     2.4 |
| Firefox  |    10 |    7.5 |       11 |              1.5 |                3 / 5 |                 2 |              3.5 / 14 |     5.5 |
| Firefox  |    50 |     20 |       32 |                2 |                4 / 6 |                 3 |                5 / 14 |      29 |
| Firefox  |   100 |     44 |       64 |                3 |              5.5 / 8 |               4.5 |              6.5 / 19 |      64 |
| Firefox  |   199 |     88 |      128 |                5 |             8.5 / 14 |                 6 |               10 / 20 |     187 |
| WebKit   |     1 |    2.5 |       62 |              1.5 |              15 / 23 |                 2 |               14 / 30 |      14 |
| WebKit   |    10 |      8 |       55 |                2 |              15 / 23 |                 2 |               15 / 22 |      14 |
| WebKit   |    50 |     31 |       68 |                2 |              15 / 23 |                 3 |               15 / 30 |      46 |
| WebKit   |   100 |     84 |      134 |                3 |              15 / 31 |               4.5 |               19 / 38 |      86 |
| WebKit   |   199 |    278 |      350 |                5 |              22 / 39 |               6.5 |               23 / 54 |     248 |

**Caveats:**

- Firefox and WebKit round `performance.now()` to whole milliseconds (the halves are means of
  two runs). Run-to-run differences were up to ~30% on single cells; treat them as magnitudes.
- **WebKit here is Playwright's Windows port, not Safari.** It paints in software: the page
  shadows of the default theme make its frames slow (keys pressed back to back took ~90 ms to
  paint, ~25 ms with `box-shadow: none`), which is most of its "to paint" and paint columns. Its
  handler columns are comparable with the other engines; its paint columns say nothing about
  Safari on macOS.
- Paint times depend on the frame clock (60 Hz headless): a key that arrives just after a frame
  waits for the next one, so p95 includes up to one frame of waiting. That is why Firefox's Enter
  p95 is 14-20 ms at every size, one page included.
- Pressing keys back to back right after each paint (no gap) put every key at the start of a frame
  and measured a full frame of waiting (~15 ms in Chromium at any size); the gap avoids that.
- An edit later in the document, or one that changes a block's height in the middle, costs
  between the two keystroke rows: the re-flow runs from the edited block to wherever the pages
  line up again.

**Reading:**

- **Keystrokes paint within a frame up to 100 pages in Chromium** (p95 at most 13.2 ms, with
  Enter moving every later page); in Firefox the p95 adds up to a frame of waiting at every size.
  The handler grows linearly with the document (about 0.03 ms per page in Chromium): the view
  walks every block on each update, `onChange` serializes the document, and an Enter re-flows to
  the end. At 200 pages Enter's p95 is just over one frame (20-21 ms).
- **Mounting** costs about 0.4-0.45 ms per page synchronously in Chromium and Firefox (every block
  measured once), so 100 pages block the main thread for ~40-45 ms and paint after ~65 ms.
- **A full re-flow after a font change** costs about 0.6 ms per page at 100 pages (the browser's
  own text layout plus the view's measuring) and grows faster than linearly in Firefox (187 ms at
  200 pages). It happens once per font load or settings change, not per keystroke.

**Targets** (set from this baseline with headroom, on this machine, in Chromium and Firefox; for
WebKit the handler columns only). A target counts as broken when two runs in a row exceed it; a
change that breaks one needs a reason in its PR, and the table above re-run:

| Measure                                 | 100 pages | 200 pages |
| --------------------------------------- | --------: | --------: |
| Keystroke handler p50 (type and Enter)  |    ≤ 8 ms |   ≤ 12 ms |
| Keystroke-to-paint p95 (type and Enter) |   ≤ 25 ms |   ≤ 33 ms |
| Initial layout (synchronous)            |   ≤ 60 ms |  ≤ 120 ms |
| Full re-flow after a font change        |  ≤ 100 ms |  ≤ 250 ms |

Not done yet: the per-keystroke walk over every block, the whole-document `onChange`
serialization, virtualizing pages far from the viewport, and moving the first layout off the main
thread. None is needed for these targets; revisit when a target fails or documents grow past a
few hundred pages.

## Bundle size (Phase 6.4)

**Run:** `pnpm size` (after `pnpm build`; part of `pnpm check`; source: `scripts/size.mjs`).

**Method:** each package's published entry (`dist/index.js`) bundled the way an app's bundler
would (Vite 8, ES module, minified), with the Foli packages it depends on and without React
(a peer dependency), then gzipped (level 9). CSS (`@foli/react/styles.css`, about 0.8 kB gzipped
in the Vite example) is not counted. The check fails when a package passes its budget.

| Package       | Includes          | Minified | Gzipped |  Budget |
| ------------- | ----------------- | -------: | ------: | ------: |
| `@foli/core`  | core              |  56.0 kB | 15.6 kB | 18.1 kB |
| `@foli/view`  | view, core        |  76.3 kB | 22.0 kB | 25.4 kB |
| `@foli/react` | react, view, core |  97.6 kB | 28.1 kB | 32.2 kB |

(kB = 1,024 bytes; measured 2026-11-07.) For comparison, the whole Vite example app (React 18,
React DOM and Foli) is 72 kB gzipped.
