# Benchmarks

Numbers are only meaningful with their method. Each section says what was measured, on what,
and how to reproduce it. Re-run and update a section when the code it measures changes.

## Performance tracking (12.7)

**Run:** `pnpm bench` (`scripts/bench.mjs`; about 12 minutes on the owner's laptop on battery, less on mains) before each
release ([contributing](contributing.md#releasing)) and on any change meant to be faster; not in
`pnpm check` or the pre-push hook, no hosted CI
([ADR-0008](decisions/ADR-0008-1.0-contract-and-extensions.md)). It builds the packages, runs
every benchmark below `--runs` times (default 3), takes the median of each metric over the runs,
prints a table against this machine's baseline, writes `test-results/bench.json` and exits
non-zero when a metric is past its threshold, or when a metric of the baseline was not measured
by an engine that ran or came out as no number (`MISSING`: a renamed test, a query that found
nothing to time). Each benchmark prints `BENCH {…}` lines (JSON). Options: `--update` writes the
medians as the baseline (thresholds already in it are kept; refused while a median is no number),
`--engines node,chromium,firefox,webkit` runs some of them (an `--update` then replaces only those
engines' metrics and dates), `--machine NAME` (or `FOLI_BENCH_MACHINE`) names the machine,
`--no-build` skips `pnpm build`.

**Baselines:** `bench/baselines/<machine>.json`, committed: per engine the date and number of runs
it was recorded with, per engine and metric the median, its `threshold` and `floor`, and the
hardware, Node.js and browser versions. The machine is named by its platform and a hash of host
name, CPU, cores and memory in GB (`win32-5f39f6c2` is the owner's laptop), so the host name stays
out of the repository. With no baseline for the machine the table shows the numbers alone and the
run fails, saying how to record one (`pnpm bench --update`).

**Metrics** (milliseconds; engine `node` is Node.js):

| Engine                    | Metric                                                      | Benchmark                                                                                                                                                 |
| ------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chromium, Firefox, WebKit | `layout`, `reflow` at 100 and 200 sections                  | [Pagination](#pagination-layout-keystrokes-and-re-flow-phase-5), the paragraph document (104 and 208 pages today)                                         |
| Chromium, Firefox, WebKit | `typeHandlerP50`, `enterHandlerP50` at 100 and 200 sections | the same keystrokes                                                                                                                                       |
| Chromium, Firefox         | `typePaintP95`, `enterPaintP95` at 100 and 200 sections     | the same keystrokes; not WebKit's (software painting on Windows, 2× apart between runs)                                                                   |
| Chromium, Firefox, WebKit | `find "th"`, `"the "`, `"the la"`, `"zebra"`                | the [find](#find-on-a-long-document-1111) panel (`apps/playground/bench/find.bench.ts`) on the 1,640-paragraph document, each query typed 5 times, median |
| Node                      | `findAll "th" x20`, `"the "`, `"the la"`, `"zebra"`         | `findAll` on the same document's editor (built packages), 20 calls per sample, median of 30 samples after 3 warm-up ones                                  |
| Node                      | `docx import (corpus)`, `docx export (corpus)`              | `importDocx`, and `exportDocx(document, package)`, of the 9 `corpus/word` files: the sum of each file's median of 10 (after 2 warm-up calls)              |
| Chromium                  | `pdf (corpus)`                                              | `exportPdf` of the 9 imported corpus files through Playwright's Chromium, tracked changes accepted, no added fonts: the sum of each file's median of 3    |

The browser benchmarks run on the Vite dev server (unminified source, React's development build)
as `pnpm bench:layout` always has, on a port of their own (5177) and never on a server already
running (which could be another checkout's).

**Thresholds:** a metric fails when its median is past the baseline by more than `threshold`
(relative) **and** by more than `floor` (milliseconds: for whole-millisecond clocks and a frame of
waiting); as far the other way it is reported `faster`. The defaults (`TOLERANCES` in the
script) were set from two full runs of the same code an hour apart (on battery), whose browser
medians stayed within ±30% of each other (WebKit's paint p95 aside, now not tracked), and from
Node runs on mains: within one invocation `findAll` and `.docx` medians stay within ±10%, but
between invocations on the shared laptop the `.docx` corpus import took 53 to 92 ms on a quiet
machine (up to 140 ms with other work running). `findAll` is timed 20 calls at a time, since one
call (0.05-0.5 ms) is too close to the clock's noise to catch anything:

| Metric                    | Threshold |  Floor |
| ------------------------- | --------: | -----: |
| paint p95                 |     ± 50% |   8 ms |
| keystroke handler p50     |     ± 50% | 1.5 ms |
| layout, re-flow           |     ± 40% |   5 ms |
| find (panel)              |     ± 50% |  10 ms |
| `findAll` (20 calls)      |     ± 60% |   2 ms |
| `.docx` import and export |     ± 60% |  20 ms |
| PDF                       |     ± 40% | 100 ms |

**Compare on mains power.** On battery (Windows' Balanced plan) the same code measured 1.5-2×
slower than on mains, and drifted further as the charge fell, past every threshold. Rerun once
before believing a regression.

### 1.0 numbers

**Environment:** Intel Core i7-13700H (14 cores, 20 threads), 16 GB RAM, Windows 11 (10.0.26200),
**on mains power** (Balanced plan); Node.js 25.3.0; Playwright 1.64.1 with Chromium 156.0.8078.4,
Firefox 157.0 and WebKit 27.2 (headless, 1280×720); 2026-11-20, the code of 12.12 (1.0.0).
Medians of 3 runs (`bench/baselines/win32-5f39f6c2.json`); milliseconds.

Recorded in 12.12 from three full `pnpm bench` runs one after the other: the first failed 12
metrics against 12.7's baseline, all in Node and Chromium, which ran 2-3× slower throughout
(`findAll` +126-163%, `.docx` +183%, PDF +202%: the machine, busy with other work, since Firefox
and WebKit in the same run were within thresholds); the second passed every metric (below); the
third, run with `--update`, passed all but Chromium's re-flow at 200 sections (555 ms, +110%),
so the baseline was written from the second run's medians instead (the same script's `updated`,
the thresholds kept). Against 12.7's baseline the second run was 21-31% faster in the keystroke
handlers in every engine (12.11's list-number fix), the rest within ±15%, but PDF +26% and
Chromium's re-flow +13%.

| Engine   | Sections (pages) | layout | type handler p50 | type paint p95 | Enter handler p50 | Enter paint p95 | re-flow |
| -------- | ---------------: | -----: | ---------------: | -------------: | ----------------: | --------------: | ------: |
| Chromium |        100 (104) |    118 |              7.9 |           13.7 |               9.9 |            35.3 |     148 |
| Chromium |        200 (208) |    228 |             18.1 |           28.2 |              18.5 |            64.7 |     295 |
| Firefox  |        100 (104) |    146 |               11 |             28 |                14 |              49 |     164 |
| Firefox  |        200 (208) |    298 |               24 |             52 |                26 |              94 |     330 |
| WebKit   |        100 (104) |    194 |               13 |              - |                17 |               - |     217 |
| WebKit   |        200 (208) |    380 |               27 |              - |                26 |               - |     436 |

| Find (107 pages) | `findAll` (Node, per call) | Chromium panel | Firefox panel | WebKit panel |
| ---------------- | -------------------------: | -------------: | ------------: | -----------: |
| `th`             |                    0.48 ms |          16 ms |         17 ms |        46 ms |
| `the `           |                    0.48 ms |          17 ms |         17 ms |        62 ms |
| `the la`         |                    0.20 ms |          17 ms |         16 ms |        62 ms |
| `zebra`          |                    0.07 ms |          16 ms |         16 ms |        62 ms |

The panel's figures are medians of later searches (the first after loading reads the trees, see
"Find" below); Chromium's and Firefox's are about one frame. `.docx`, the 9 corpus files together
(18-32 kB each): import 77 ms, export 87 ms (Node); `exportPdf` 675 ms (Chromium, about 75 ms per
document).

**Phase 5's targets at 100 pages, missed in 1.0** (accepted by the owner on 2026-11-20, below):
Chromium meets the handler target typing (7.9 ms, ≤ 8) and typing's paint (13.7 ms, ≤ 25) but not
Enter's handler (9.9 ms) or paint p95 (35 ms, ≤ 25), the first layout (118 ms, ≤ 60) or the full
re-flow (148 ms, ≤ 100); Firefox misses each (handlers 11 and 14 ms, Enter's paint 49 ms, layout
146 ms, re-flow 164 ms).

**Against earlier numbers.** Pagination was last measured for 0.2.0 (7.9): Chromium laid 100
pages out in 41 ms and handled a key in 4-6 ms; 12.7 measured 110 ms and 11-13 ms (1.0: 118 ms and
8-10 ms, above). To separate the
code from the machine, the 100-section benchmark of each release's own checkout ran in Chromium
in one session on mains, one after the other, 3 runs each (medians):

| Code             | Pages | layout | type handler p50 | type paint p95 | Enter handler p50 | Enter paint p95 | re-flow |
| ---------------- | ----: | -----: | ---------------: | -------------: | ----------------: | --------------: | ------: |
| 0.2.0 (Phase 7)  |   100 |     50 |              3.7 |            8.9 |               4.2 |              19 |      68 |
| 0.3.0 (Phase 8)  |   106 |     78 |              9.7 |             18 |              10.8 |              31 |     133 |
| 0.5.0 (Phase 10) |   106 |    110 |             11.3 |           20.5 |              13.4 |              34 |     137 |
| 0.6.0 (Phase 11) |   104 |    107 |             12.0 |           19.9 |              13.1 |              30 |     129 |
| 12.6             |   104 |    109 |             12.2 |           19.0 |              14.5 |              37 |     146 |

0.2.0's row is within run-to-run noise (±30%) of what 7.9 measured (layout 41 ms then, 50 now;
handlers 4.1 and 5.7 then, 3.7 and 4.2 now). (An earlier pass of
single runs on battery gave the same picture at about twice the times.)

**A regression since 0.2.0, not from Phase 12:** a keystroke's handler costs 3.3-3.5× what it
did in 0.2.0, the first layout and the full re-flow about 2.2×, keystroke-to-paint p95 about 2×.
Most of the keystroke cost came with the Word model (Phase 8: schema v3, Word's formatting
resolved per block), the layout's in Phases 8 to 10; 12.6 is within the noise of 0.6.0. At 100
pages the pagination targets below are missed in Chromium and Firefox: handler p50 11-16 ms
(≤ 8), Enter's paint p95 32-45 ms (≤ 25; typing's 17 ms in Chromium passes), layout 110-151 ms
(≤ 60), re-flow 131-150 ms (≤ 100). Not investigated in 12.7 (12.11 decides whether it blocks
1.0); the baseline catches further regressions from here.

**Investigated in 12.11** (Chromium CPU profiles through the DevTools protocol of the bench page
at 100 sections: 3 mounts and 88 typed keys, 100 µs sampling). A keystroke's handler was mostly
the view redrawing the pages (`renderPages`, about 70%), and nearly half of that was list numbers:
the renderer's `prepare` asked the resolver for every block's marker on every change, each a
whole style cascade (`#resolve`), numbered or not. Now a paragraph that neither its attributes nor
its style number is skipped first. Same machine, profiler on, alternating three times: handler
p50 37-41 ms before, 23-25 ms after (a loaded machine), `renderPages` 2.0-2.7 s → 0.95-1.03 s per
88 keys. `pnpm bench --engines chromium` afterwards (2026-11-20, on mains, other work running:
layout, re-flow and PDF came out 13-33% slower than the baseline with no change to them): type
handler p50 8.9 ms (baseline 11.4, -22%), Enter 9.9 ms (12.9, -23%), at 200 sections 18.2 and
20.5 ms (-21%, -20%); the rest within thresholds. The baseline was not updated: that run's other
metrics were slower from the machine, and recording them would loosen the baseline.

Again after the review of #131 (2026-11-20 evening, on mains): the machine itself was 25-45%
slower than when the baseline was recorded (the code before 12.11 measured so too: `findAll`
+38%, `.docx` import +26%), so the fix was measured A/B, the code before 12.11 (`20d8576`) and
after, one right after the other, `pnpm bench --engines chromium,firefox`, 3 runs each (handler
p50, ms):

| Code         | Chromium type 100 | Enter 100 | type 200 | Enter 200 | Firefox type 100 | Enter 100 | type 200 | Enter 200 |
| ------------ | ----------------: | --------: | -------: | --------: | ---------------: | --------: | -------: | --------: |
| before 12.11 |              17.1 |      22.8 |     34.9 |      40.6 |               18 |        19 |       36 |        42 |
| after 12.11  |               8.0 |      14.8 |     17.8 |      19.2 |               11 |        14 |       31 |        37 |

Layout, re-flow and paint moved together in both (the machine), unchanged by the fix. The
baseline was not updated: recorded now, every metric would take the slow machine's numbers.
Recorded again in 12.12 ([1.0 numbers](#10-numbers)).

**Decided by the owner (2026-11-20):** the cost does not block 1.0; the missed targets are stated
in [limitations.md](limitations.md) and the release notes, and the incremental redraw is for a 1.x
minor.

What a keystroke still costs (same profile, after the fix): placing every block of every page
again (`renderPages`, about 55%), the selection written back with a forced layout
(`setBaseAndExtent`, about 20%), and in the bench page the app reading `change.document` (the
whole document serialized, about 16%; an app that saves later skips it). The first layout
is mostly the browser's own layout of the hundred pages (`getBoundingClientRect` forcing it,
about 40% of a mount), then building the model (`parseDocument`, `createEditor`, about 20%) and
the paragraphs' DOM with their resolved formatting. Options, none built: redraw only the pages
from the edited block on (a few ms a key, a change to `renderPages`' bookkeeping), reuse unchanged
nodes' JSON in `documentJSON` (2-3 ms a key for apps that read the document on each change;
callers must not mutate it), page virtualization (the first layout, a large change: pages must
still be measured), fewer forced layouts when the selection is written.

**Rust and WebAssembly:** no benchmark shows a need. The slow paths are the view's work per
keystroke and the browsers' own layout of the pages (DOM, measuring, painting), which WebAssembly
does not speed up; the computing parts are small (`findAll` at most 0.5 ms on 107 pages, a `.docx`
import 6-8 ms per document).

## Document model: build and serialize (Phase 2)

**Run:** `pnpm --filter @folijs/core bench` (Vitest 5 benchmark mode, tinybench under the hood;
source: `packages/core/src/model/model.bench.ts`).

**Fixtures:** `pagesFixture(n)` in `packages/core/src/testing/index.ts`: per page one heading and
five paragraphs of ~600 characters, each with a bold run, a bold+italic run and a hard break.
About 3,100 positions and 4.5 kB of JSON per page. Synthetic text, schema v1 only.

**Operations:**

- **build:** `schema.nodeFromJSON(json)`: strict validation plus construction of the immutable tree.
- **serialize:** `doc.toJSON()`: canonical JSON object tree.
- **load:** `JSON.parse` of the stored envelope + `parseDocumentV2` (validate, normalize, re-serialize; schema v2, as these numbers were measured).
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

**Run:** `pnpm --filter @folijs/core bench` (source: `packages/core/src/transform/transform.bench.ts`).

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

The tables in this section are as of Phases 5 to 7 (up to 0.2.0); 1.0's numbers, and how much
slower they are, are in [Performance tracking](#performance-tracking-127).

**Run:** `pnpm bench:layout` (Playwright, `playwright.bench.config.ts`, one worker; about 3
minutes for all three engines). Each test prints a `BENCH {…}` line. Not part of `pnpm check` or
`pnpm test:e2e`. Source: `apps/playground/bench/pagination.bench.ts`, driving the dev-only page
`apps/playground/bench.html` (`src/bench.tsx`), which mounts `FoliEditor` and times it from
inside the page. Since 8.7d2 it edits schema v3 (the stored fixtures are migrated when loaded);
the numbers below were measured on schema v2 and are measured again for gate G5 (8.8).

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
- **re-flow:** a full re-flow as when a web font with other metrics finishes loading: the text's
  font switches (to the default sans-serif, then back to the test font; the page count
  changes, e.g. 101 → 105 pages) and a `loadingdone` event fires on `document.fonts`. On schema
  v3 every run carries its font inline, so the swap is an `!important` rule over them; the bench
  checks the text did change font each time. The browser
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
WebKit the handler columns only; for the paragraph document: the list document's misses are an
accepted known limit, see "Lists"; **missed at 1.0**, see
[Performance tracking](#performance-tracking-127)). A target counts as broken when two runs in a row exceed it; a
change that breaks one needs a reason in its PR, and the table above re-run:

| Measure                                 | 100 pages | 200 pages |
| --------------------------------------- | --------: | --------: |
| Keystroke handler p50 (type and Enter)  |    ≤ 8 ms |   ≤ 12 ms |
| Keystroke-to-paint p95 (type and Enter) |   ≤ 25 ms |   ≤ 33 ms |
| Initial layout (synchronous)            |   ≤ 60 ms |  ≤ 120 ms |
| Full re-flow after a font change        |  ≤ 100 ms |  ≤ 250 ms |

### Lists (7.4)

`benchDocument(100, true)`: the same 100 sections with each section's paragraphs as an ordered
list (eleven items of one to five lines, two of them holding a nested list of three short
items): 114 pages, about 1,800 blocks (1,400 in the paragraph document). Same operations; run
next to the paragraph document in one session (2026-11-08, same machine, one run, so single
cells may be off by ~30%):

| Engine   | Document   | Pages | layout | type handler p50 | type paint p50 / p95 | Enter handler p50 | Enter paint p50 / p95 | re-flow |
| -------- | ---------- | ----: | -----: | ---------------: | -------------------: | ----------------: | --------------------: | ------: |
| Chromium | paragraphs |   100 |   48.3 |              4.2 |           7.2 / 11.2 |               5.0 |            8.1 / 19.9 |    99.3 |
| Chromium | lists      |   114 |   88.7 |              6.8 |          10.4 / 20.7 |              14.4 |           21.1 / 56.4 |   155.2 |
| Firefox  | paragraphs |   100 |     45 |                5 |               7 / 12 |                 5 |                8 / 13 |    50.7 |
| Firefox  | lists      |   114 |     82 |                8 |              11 / 18 |                16 |               18 / 53 |   124.5 |
| WebKit   | paragraphs |   100 |     72 |                4 |              15 / 31 |                 6 |               16 / 41 |      93 |
| WebKit   | lists      |   114 |    121 |               10 |              25 / 46 |                16 |               31 / 94 |     155 |

**Reading:**

- **Typing in a list stays within the targets** (handler p50 7-8 ms in Chromium and Firefox,
  keystroke-to-paint p95 18-21 ms). **Enter at the top of the document does not** (handler p50
  14-16 ms, keystroke-to-paint p95 about 55 ms), nor do the initial layout (82-89 ms) and the
  full re-flow (125-155 ms in all three engines).
- Most of the Enter difference is the document, not lists: in the paragraph document a
  paragraph split across the end of page 1 absorbs the extra line and the later pages stay as
  they were (about 18 DOM nodes added per Enter); in the list document page ends fall between
  short items that cannot split, so every Enter on page 1 moves the last item of every page to
  the next one (about 136 nodes per Enter, counted with a `MutationObserver`). A paragraph
  document of short paragraphs would behave the same.
- What lists add on top: more, shorter blocks (about 1,800 against 1,400; the documents are of
  similar but not equal length: 114 pages against 100), container elements per page
  (a moved item takes its `<li>` along, its number is rewritten only when it changes), and more
  DOM for the browser to lay out (initial layout per block ~0.049 ms against ~0.034 ms).
- Not done: placing only the pages an edit changed (today every render walks every block), and
  the items in "Not done yet" below. The paragraph document's numbers above, from the same
  session, stay within the targets.

### 0.2.0 rerun (7.9)

The whole benchmark again before 0.2.0 (2026-11-08, same machine and versions, one run), with
everything Phase 7 added (nested blocks in the view, the list keymap, the toolbar's new
controls and their state after every transaction). The paragraph document stays within every
target in Chromium and Firefox; the list document stays the accepted known limit above,
with one cell clearly worse than the 7.4 run: Firefox's Enter handler p50 (24 ms against 16,
more than the single-run noise). Chromium's Enter improved (8.6 ms against 14.4); the other
list cells moved within the noise. Not investigated for 0.2.0.

| Engine   | Document   | Pages | layout | type handler p50 | type paint p50 / p95 | Enter handler p50 | Enter paint p50 / p95 | re-flow |
| -------- | ---------- | ----: | -----: | ---------------: | -------------------: | ----------------: | --------------------: | ------: |
| Chromium | paragraphs |   100 |   40.9 |              4.1 |            6.1 / 9.1 |               5.7 |            8.2 / 15.4 |    57.6 |
| Chromium | paragraphs |   199 |   82.4 |              6.1 |           8.6 / 11.7 |               7.4 |           10.9 / 23.6 |   159.2 |
| Chromium | lists      |   114 |   95.5 |              6.9 |          10.1 / 20.0 |               8.6 |           13.1 / 39.2 |   124.0 |
| Firefox  | paragraphs |   100 |     46 |                3 |               6 / 12 |                 5 |                7 / 16 |    55.8 |
| Firefox  | paragraphs |   199 |    101 |                6 |              10 / 16 |                 8 |               11 / 19 |   110.3 |
| Firefox  | lists      |   114 |     87 |                7 |              10 / 15 |                24 |               27 / 63 |   135.6 |
| WebKit   | paragraphs |   100 |     76 |                4 |              15 / 16 |                 5 |               15 / 46 |      78 |
| WebKit   | paragraphs |   199 |    157 |                6 |              14 / 29 |                 7 |               14 / 45 |     164 |
| WebKit   | lists      |   114 |    131 |                7 |              15 / 30 |                 9 |               16 / 79 |     140 |

Against the targets (paragraph document, Chromium / Firefox): handler p50 at most 5.7 / 5 ms
(≤ 8) at 100 pages and 7.4 / 8 ms (≤ 12) at 200; keystroke-to-paint p95 at most 15.4 / 16 ms
(≤ 25) and 23.6 / 19 ms (≤ 33); initial layout 40.9 / 46 ms (≤ 60) and 82.4 / 101 ms (≤ 120);
full re-flow 57.6 / 55.8 ms (≤ 100) and 159.2 / 110.3 ms (≤ 250).

Not done yet: the per-keystroke walk over every block, the whole-document `onChange`
serialization, virtualizing pages far from the viewport, and moving the first layout off the main
thread. None is needed for these targets; revisit when a target fails or documents grow past a
few hundred pages.

## Find on a long document (11.11)

As of 11.11 (1.0's numbers: [Performance tracking](#performance-tracking-127)). A document of
1,640 paragraphs (107 A5 pages, about 125,000 characters), `findAll` in Node and the
find panel in `apps/playground/e2e/word-navigation.spec.ts`: from the input event to the next frame
after it, the panel updated and the matches marked. One worker, Windows, 2026-11-19.

| Query          | Matches | `findAll` (median) | Chromium | Firefox | WebKit |
| -------------- | ------: | -----------------: | -------: | ------: | -----: |
| `th`           |   4,922 |             1.2 ms |    85 ms |  197 ms | 170 ms |
| `the `         |   4,922 |             1.1 ms |    74 ms |  226 ms | 204 ms |
| `the la`       |   1,640 |             0.4 ms |    22 ms |   98 ms | 109 ms |
| `zebra` (none) |       0 |             0.2 ms |    18 ms |   42 ms |  80 ms |

The first search after a change reads the trees again (2 ms, 15 ms the very first time, before the
JIT has warmed up); the rest of each figure is the panel and painting. Replacing all 4,920 takes
0.64 s and undoing it 0.16 s. Marks are made only for pages near the window: marking every match of
a 224-page document took up to 1.6 s per key in WebKit.

After the review's fixes (marks made in the same commit as the count, near matches found by halving)
the same queries take 14 to 55 ms in Chromium, 14 to 37 ms in Firefox and 57 to 78 ms in WebKit.

**Typing in the document with a search open** (the same spec: 4,000 paragraphs, 84,009 matches of
`e`, ten keys pressed by Playwright, round trips included): Chromium 1.05 s against 1.08 s with no
panel, Firefox 1.28 against 1.03 s, WebKit 1.67 against 1.35 s. Each key moves only the current
match with the text (moving all 84,009 took Firefox to 2.55 s), and only it is marked until the
search comes again; the panel looks again 300 ms after typing pauses, keeps the current match if it is still there and does not scroll; each render marks
only the matches of the pages near the window, found by halving the sorted list. Before this, every
key searched again and marked every match: 8.2 s for ten keys in the reviewer's run.

## Bundle size (Phase 6.4)

**Run:** `pnpm size` (after `pnpm build`; part of `pnpm check`; source: `scripts/size.mjs`).

**Method:** each package's published entry (`dist/index.js`) bundled the way an app's bundler
would (Vite 8, ES module, fully minified: identifiers, whitespace and comments), with the Foli
packages it depends on and without React (a peer dependency), then gzipped (level 9). Plus an
app-like bundle that imports only `FoliEditor`, where the packages' `sideEffects` and tree
shaking decide what is left (almost everything: the editor uses most of the engine). CSS
(`@folijs/react/styles.css`, about 0.8 kB gzipped in the Vite example) is not counted. The check
fails when a bundle passes its budget.

| Bundle            | Includes                        | Minified |  Gzipped |   Budget |
| ----------------- | ------------------------------- | -------: | -------: | -------: |
| `@folijs/core`    | core                            | 249.8 kB |  82.9 kB |  85.9 kB |
| `@folijs/view`    | view, core                      | 334.1 kB | 110.8 kB | 112.0 kB |
| `@folijs/react`   | react, view, core               | 472.6 kB | 155.3 kB | 157.0 kB |
| `FoliEditor` only | what it reaches                 | 471.7 kB | 155.0 kB | 157.0 kB |
| `@folijs/docx`    | docx, core                      | 177.4 kB |  58.0 kB |  60.0 kB |
| `@folijs/pdf`     | pdf (Node's side), core         |  51.8 kB |  17.2 kB |  18.4 kB |
| pdf's renderer    | core, view's read-only renderer | 251.1 kB |  84.7 kB |  95.2 kB |

(kB = 1,024 bytes; measured 2026-11-20 for 1.0.0. Every raise of a budget, with its reason, is
in `scripts/size.mjs`. Gzipped sizes at 0.1.0: 14.1, 19.9, 25.3 and 25.2 kB; at 0.5.0's budgets:
core 52.7, view 63.5, React 87.9, docx 44.9 kB; at 0.6.0: core 84.6, view 106.6, React 149.9,
docx 55.3, pdf 16.2 kB. Phase 12 added custom nodes and marks, view extensions, named commands,
overridable keys, toolbar items and the picture copy; core's own bundle is smaller, as its entry
lists its exports by name and what only the other packages use moved to `@folijs/core/internal`. Phase 11 added schema v5, stories and their
editors, sections and columns, headers, footers and notes on pages, fields, content controls,
find and replace with their menus and panels, and `@folijs/pdf`. pdf's renderer is
`dist/renderer.js`, gzipped as shipped: the script `exportPdf` adds to the headless page, never
part of an app's bundle; `@folijs/pdf`'s own bundle leaves it out.)
