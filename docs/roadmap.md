# Roadmap

Foli is built as an independent document-editing engine ([ADR-0002](decisions/ADR-0002-own-editing-engine.md)).
This roadmap orders the work so the riskiest assumptions are tested first and every phase
leaves `main` green with a working playground.

## Status

**Update this table in the same PR that starts, advances or finishes a phase.** It is the only
place that says what is in progress; check it before starting work.

| Phase                    | Status                   | Branch | Notes                                                                                      |
| ------------------------ | ------------------------ | ------ | ------------------------------------------------------------------------------------------ |
| 0 Foundation             | ✅ Done                  | —      |                                                                                            |
| 1 Architecture spike     | ✅ Done (G1 provisional) | —      | Merged in #1; ADR-0003 accepted provisionally; IME, dead-key and screen-reader checks open |
| 2 Document model         | ✅ Done                  | —      | Merged in #2                                                                               |
| 3 Transactions & history | ✅ Done                  | —      | Merged in #4; gate G2 passed                                                               |
| 4 Editor view            | ✅ Done (G3 provisional) | —      | Merged in #8–#13; manual checks (4.6) deferred, open risks in ADR-0003                     |
| 5 Native pagination      | ✅ Done (G4 provisional) | —      | Merged in #15–#22; page-break manual checks open, risks in ADR-0003                        |
| 6 React API & 0.1.0      | Ready                    |        | G4 passed provisionally; the open manual checks (ADR-0003) run before 0.1.0                |
| 7–12                     | Not started              |        |                                                                                            |

Status values: `Ready` (dependencies met, nobody on it) · `In progress` · `In review` (PR open) ·
`✅ Done` (merged, acceptance criteria met) · `Blocked by …`.

## Working on a phase

1. **Claim it:** set the phase to `In progress` in the table above with its branch name, as the
   first commit on the branch `phase-<n>/<slug>`.
2. **Plan it:** add a `### Tasks` checklist (PR-sized, ordered, each leaving the build green)
   under the phase's section below. Large phases may use several PRs; tick tasks as they merge.
3. **Build it:** tests with each task; `pnpm check` green before every push.
4. **Close it:** verify every acceptance criterion, update architecture/model/pagination docs to
   match what was built, set status to `In review`, open a PR to `main`. After merge: `✅ Done`
   and unblock dependents.

**Shared root files** (`package.json`, `pnpm-lock.yaml`, `vitest.config.ts`, `biome.json`,
`tsconfig.base.json`, `scripts/`) collide between parallel branches:

- Put dependencies in the package that uses them (`packages/core` devDependencies), not the root,
  unless the tool is repo-wide.
- Only the phase marked "owns root tooling changes" edits root tooling config while parallel
  phases are open; others ask for it in their PR description.
- Lockfile conflicts: take `main`'s `pnpm-lock.yaml`, run `pnpm install`, commit the result.
  Never hand-merge the lockfile.

## Principles

1. **Gates before features.** Four architecture gates (below). A failed gate means fixing the
   architecture, not building more on top of it.
2. **Correctness first, then speed.** Measure before optimizing; publish numbers with method.
3. **Small, reviewable increments.** Each phase is split into PR-sized tasks when it starts
   (see "Working on a phase").
4. **Docs follow reality.** A feature is listed as done only when it is implemented and tested.
5. **No dates.** Sizes are relative effort for part-time, AI-assisted development:
   **S** days · **M** weeks · **L** 1–2 months · **XL** several months. Estimates, not commitments.

## The five core editing tests

Foli's engine is not credible until all five pass in Chromium, Firefox and WebKit:

| #   | Test                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------ |
| T1  | Type and format several paragraphs; the document tree stays valid after every keystroke.                     |
| T2  | Select across paragraphs with mixed formatting, replace the selection, undo: exact original doc + selection. |
| T3  | Paste external content (plain text, HTML, Word/Google Docs HTML) without corrupting the document.            |
| T4  | Accented input (dead keys) and IME composition (Japanese, Chinese, Korean) produce correct text and history. |
| T5  | A two-page document: edit, select and undo across the page boundary without losing text or caret position.   |

## Gates

| Gate                           | After   | Passes when                                                                       |
| ------------------------------ | ------- | --------------------------------------------------------------------------------- |
| **G1 Rendering approach**      | Phase 1 | ADR-0003 records the chosen DOM/input approach with spike evidence for T4 and T5  |
| **G2 Headless correctness**    | Phase 3 | T1 and T2 pass headless (no DOM); property tests for steps, mapping and undo pass |
| **G3 Interactive correctness** | Phase 4 | T1–T4 pass in the browser matrix                                                  |
| **G4 Native pagination**       | Phase 5 | T5 passes; pagination fixtures deterministic; benchmark baseline published        |

## Overview

| Phase | Name                      | Outcome                                                     | Release      | Size |
| ----- | ------------------------- | ----------------------------------------------------------- | ------------ | ---- |
| 0     | Foundation                | Monorepo, docs, own schema v1, read-only view               | —            | ✅   |
| 1     | Architecture spike        | Two-page editable surface validated → ADR-0003              | —            | M    |
| 2     | Document model            | Schema, immutable nodes, positions, slices, JSON            | —            | L    |
| 3     | Transactions & history    | Steps, mapping, state, undo/redo, commands, headless editor | —            | L    |
| 4     | Editor view               | Editable DOM view: input, selection, IME, clipboard         | 0.0.x canary | XL   |
| 5     | Native pagination         | Real pages, fragments, incremental reflow, print            | —            | XL   |
| 6     | React API & first release | `FoliEditor`, hooks, toolbar, packaging                     | **0.1.0**    | M    |
| 7     | Rich content              | Lists, links, alignment, color, highlight, rules            | 0.2.0        | L    |
| 8     | Tables & images           | Tables across pages, images with resources                  | 0.3.0        | XL   |
| 9     | Professional layout       | Headers/footers, page numbers, styles, find/replace         | 0.4.0        | L    |
| 10    | Interop & Rust/WASM       | HTML + DOCX import/export, Rust document processing         | 0.5.0        | XL   |
| 11    | Ecosystem & 1.0           | Extension API freeze, docs site, examples                   | **1.0.0**    | L    |
| 12    | Optional                  | Collaboration, comments, track changes, AI hooks            | —            | —    |

```
P0 ─┬─► P1 spike ────────────────┐
    └─► P2 model ─► P3 transactions ─┴─► P4 view ─► P5 pagination ─► P6 (0.1)
                                                                       │
              P7 rich content ◄────────────────────────────────────────┘
               ├─► P8 tables & images ─► P9 professional layout ─► P11 (1.0)
               └─► P10 interop & Rust (parallel once the JSON format covers lists)
```

Phases 1 and 2 can run in parallel: the model does not depend on how text is rendered.

---

## Phase 0 — Foundation ✅

- [x] pnpm monorepo, TypeScript strict, Biome, Vitest, CI (since replaced by a local pre-push hook), graphify.
- [x] ADR-0001 (superseded), ADR-0002 (own engine), architecture, document model, pagination design.
- [x] `@foli/core`: `FoliDocument` envelope, schema v1 (paragraph, heading, text, hardBreak;
  bold/italic/underline/strike) with strict validation and error paths.
- [x] `@foli/view`: read-only DOM renderer (no `innerHTML`).
- [x] `@foli/react`: read-only `DocumentEditor` on an A4 sheet; playground uses it.
- [x] No editor-engine dependencies.

## Phase 1 — Architecture spike: one editable surface, two pages · M

**Goal:** prove or disprove the core bet before building the real view: one `contenteditable`
host, pages as visual containers inside it, one paragraph rendered as fragments on two pages.

**Scope:**

- Throwaway code in `spikes/two-page/` (private, never published, deleted or rewritten after).
- Toy model: list of plain-text paragraphs; snapshot undo. No marks.
- Render paragraphs into page containers inside one editable host; split an overflowing paragraph
  at a measured line break (`Range.getClientRects()`) into two fragments.
- Handle `beforeinput` (`insertText`, `deleteContentBackward/Forward`, `insertParagraph`,
  `insertReplacementText`), composition events, DOM selection ↔ (paragraph, offset) mapping.
- Playwright set up for Chromium, Firefox, WebKit (kept for later phases).

**Experiments (each recorded with result per browser):**

| ID  | Experiment                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------ |
| E1  | Typing at the end of page 1 reflows text onto page 2; caret stays at the right logical offset.               |
| E2  | Mouse and Shift+Arrow selection across the page boundary; delete; undo.                                      |
| E3  | IME: automated in Chromium (CDP `Input.imeSetComposition`); manual on macOS Safari, Windows, Android Gboard. |
| E4  | ArrowUp/ArrowDown across the fragment boundary keeps the horizontal caret position.                          |
| E5  | Spellcheck and autocorrect (`insertReplacementText`) work in both fragments.                                 |
| E6  | Screen reader (NVDA, VoiceOver) reads the split paragraph as one continuous text.                            |
| E7  | Reflow time for a 50-page plain-text document after a keystroke on page 1.                                   |

**Exit (G1):** `docs/decisions/ADR-0003-rendering-and-input.md` chooses one of:
A) `contenteditable` with page fragments · B) hidden input + Foli-rendered DOM ·
C) `contenteditable` with block-level pages only. Evidence attached. Phase 4/5 design follows it.

### Tasks

- [x] Claim phase, branch `phase-1/two-page-spike`
- [x] Playwright at the root: Chromium, Firefox, WebKit; `pnpm test:e2e`
- [x] Spike app `spikes/two-page`: toy model, line measurement, page-flow layout (unit-tested), page rendering
- [x] Input: `beforeinput` editing, DOM ↔ model selection mapping, composition read-back, snapshot undo
- [x] Automated experiments E1–E4, E7 (E3 Chromium only) in all three engines
- [x] Manual checklist for E3 (other platforms), E5, E6 (`spikes/two-page/README.md`)
- [x] Manual checks partially executed and recorded (warm-up and spellcheck pass on Windows); IME,
  screen readers, dead keys, macOS and mobile not tested and carried to Phase 4
- [x] ADR-0003 draft with automated evidence (status: Proposed, recommends option A)
- [x] ADR-0003 accepted provisionally (gate G1 passed provisionally; risks recorded in ADR-0003)

## Phase 2 — Document model (`@foli/core`) · L ✅

**Goal:** the permanent document model. Pure TypeScript, no DOM.

- `Schema` built from node and mark specs: groups, content expressions (subset: `block+`,
  `inline*`, sequences; grow as needed), attrs with defaults and validators, inline/leaf flags,
  allowed marks, mark exclusion. Replaces the hand-written v1 validator.
- Immutable `Node`, `Fragment`, `Mark`; text nodes; structural sharing; `eq`.
- Integer positions and `ResolvedPos` (depth, parent, index, text offset).
- `Slice` with open start/end (for copy/paste and replace).
- JSON in/out; normalization (merge adjacent text with equal marks, canonical mark order);
  `parseDocument` uses the schema.
- Extensibility from the start: built-in nodes defined through the same spec API third parties
  will use.
- Dev tooling: property-based tests (`fast-check`, dev-only), benchmark harness (Vitest bench).

**Acceptance:** property tests (≥10k runs) for `fromJSON(toJSON(x)) = x` and position/resolve
invariants; ≥95% line coverage of the model; existing v1 documents load unchanged; build and
serialize timings for 1/10/50/100-page fixtures recorded in `docs/benchmarks.md`.

### Tasks

- [x] 2.1 Claim the phase; `fast-check` and `@vitest/coverage-v8` as `@foli/core` devDependencies.
- [x] 2.2 `Schema` from node/mark specs (content expressions, attrs, allowed marks, exclusion);
  immutable `Mark`, `Node`, `Fragment`; schema v1 defined through the spec API; strict JSON in
  with normalization, canonical JSON out; `parseDocument` on the schema.
- [x] 2.3 Integer positions: `ResolvedPos`, `nodeAt`, `nodesBetween`, `textBetween`.
- [x] 2.4 `Slice` (open start/end), `Node.slice`, `Node.replace` (`canReplace` moves to Phase 3).
- [x] 2.5 Property tests (≥10k runs), ≥95% line coverage of the model, benchmarks in
  `docs/benchmarks.md`.
- [x] 2.6 Docs match the code; status `In review`.

Acceptance evidence: `model.property.test.ts` (5 properties × 10,000 runs);
`pnpm --filter @foli/core coverage` (100% lines of the model sources in `src/model/`, threshold 95%); v1 fixtures in
`document.test.ts` load unchanged; timings in [benchmarks.md](benchmarks.md). Not in `pnpm check` yet:
coverage and benchmarks run from `@foli/core` scripts (root config belongs to Phase 1).

## Phase 3 — Transactions, history, commands · L

**Goal:** all editing semantics, testable without a browser.

- Steps: `ReplaceStep`, `AddMarkStep`, `RemoveMarkStep`, `AttrStep` (`ReplaceAroundStep` arrives
  with lists in Phase 7). Each step: `apply`, `invert`, `map`, `getMap`.
- `StepMap`, `Mapping` (with mirroring for undo rebasing), association bias, deletion detection.
- Transform helpers: replace with fitting (within/between textblocks), split, join, set block type,
  add/remove mark.
- Selections: `TextSelection` (anchor/head), `AllSelection`; `NodeSelection` with first leaf node.
- `EditorState` (doc, selection, stored marks) and `Transaction` (steps + selection + metadata:
  `addToHistory`, timestamp; an `origin` field was not built).
- History: undo/redo of inverted steps, grouping by time and adjacency, selection restore,
  remote/unrecorded changes mapped through.
- Commands as `(state, dispatch?) => boolean` (dry run = enabled state for toolbars):
  `insertText`, `deleteBackward/Forward` (character, word), `deleteSelection`, `splitBlock`,
  `joinBackward/Forward`, `toggleMark`, `setBlockType`, `insertHardBreak`, `selectAll`.
- Headless API: `createEditor({ document })` → `editor.commands.*`, `undo()`, `redo()`,
  `getDocument()`, `subscribe()`.
- Plugin hooks (internal, dogfooded): transaction filters/appenders, state fields, keymaps.

**Acceptance (G2):** T1, T2 headless; property tests: random step sequences — `apply` then
`invert` restores the doc; mapping round-trips; undo after N random edits restores exact
doc and selection.

### Tasks

- [x] Claim phase, branch `phase-3/transactions`
- [x] `StepMap` / `Mapping`: association bias, deletion detection, mirroring with recovery
- [x] Steps: `ReplaceStep`, `AddMarkStep`, `RemoveMarkStep`, `NodeMarkupStep` (covers `AttrStep`:
  type/attribute changes that keep inner positions)
- [x] Transform helpers: replace/delete/insertText, split, join, setBlockType, add/remove mark
  (exactly invertible). General slice fitting (closed blocks into a textblock) moves to Phase 4 paste.
- [x] `TextSelection`, `AllSelection`, `EditorState`, `Transaction`, plugins (state fields,
  filter/append, keymaps). `NodeSelection` waits for the first block leaf node (Phase 7).
- [x] History: grouping by time and adjacency, selection restore, rebase over unrecorded changes
- [x] Commands, base keymap, headless `createEditor`
- [x] Property tests (10k runs each: step inversion, map round-trips, schema rejection, undo/redo of
  random command sequences with a no-op guard) and headless T1/T2 (gate G2); docs updated

## Phase 4 — Editor view (`@foli/view`) · XL

**Goal:** an editable, continuous (unpaginated) page that passes T1–T4. Design per ADR-0003.

- Rendering with view descriptors: every DOM node knows its model range; incremental updates
  reuse DOM for unchanged nodes (node identity).
- Selection sync both ways; `selectionchange`; native caret; scroll caret into view.
- Input: `beforeinput` by `inputType`; keymap (Mod-B/I/U, Mod-Z, Mod-Shift-Z/Mod-Y, Enter,
  Backspace/Delete edge cases, Home/End, word movement left to the browser where safe).
- Composition: let the browser mutate during composition, then reconcile via DOM read-back into
  steps; MutationObserver safety net for Android and DOM-mutating browser extensions.
- Clipboard: copy/cut as `text/plain`, `text/html`, and Foli slice JSON; paste priority Foli
  JSON > sanitized HTML (own parser mapping known tags to schema, everything else dropped) >
  plain text. Fixture corpus from Word, Google Docs, LibreOffice, web pages.
- Read-only mode, focus management, placeholder.
- Accessibility baseline: `role="textbox"`, `aria-multiline`, label; semantic `<p>`/`<h1>`…
- Test matrix: Playwright (Chromium, Firefox, WebKit), IME checklist (`docs/testing/ime.md`),
  manual Android/iOS smoke per milestone.

**Acceptance (G3):** T1–T4 green; the original success criterion works in the playground
(type, format via shortcuts, undo, serialize, reload without loss). Optional `0.0.x` canary.

The gate includes the manual checks ADR-0003 left open that do not need pages:
- real IME: Windows Japanese/Chinese/Korean in Chrome and Firefox, plus macOS Safari and Android
  where available;
- dead keys;
- NVDA/VoiceOver reading the editor.

The same checks across a page break are part of G4, because the Phase 4 view is unpaginated. Any
check not run stays recorded in ADR-0003 as an open risk.

### Tasks

Each task is one PR that leaves `pnpm check` green and the playground working.

- [x] Claim phase, branch `phase-4/editor-view`
- [x] 4.1 (#8) Smallest editable slice: `EditorView` renders an `EditorState` into one
  `contenteditable` host with block/leaf descriptors (DOM ↔ model positions; unchanged blocks
  reused by node identity); `beforeinput` → core commands (insertText, deletes, splitBlock,
  hard break, history, format); keydown through the plugin keymaps; selection synced both ways,
  read from the live DOM on demand; React `DocumentEditor` editable with `onChange`; playground
  persists to `localStorage`. Playwright in all three engines: typing, Enter, Backspace, Mod-b,
  undo/redo, reload without loss.
- [x] 4.2 (#9) Composition: let the browser mutate during composition, read the changed blocks back
  into steps at `compositionend`; `MutationObserver` safety net for unprevented changes
  (Android, extensions, spellcheck in Firefox); automated Chromium CDP IME tests;
  `docs/testing/ime.md` checklist (T4 automated part).
- [x] 4.3 (#10) Clipboard: copy/cut from the model (`text/plain`, `text/html`, Foli
  JSON with an open/closed flag); paste joins open content into the target block and puts
  closed blocks into an empty textblock whole (general fitting into nested blocks moves to
  Phase 7); own HTML parser to the schema (everything else dropped); fixture corpus for Word,
  Google Docs, LibreOffice, web pages, hand-written for now (T3; real captures in 4.6).
- [x] 4.4 (#11) Keyboard and caret edges: native Home/End, word and line movement measured safe in
  all three engines (Playwright, Windows bindings; macOS bindings in the manual checklist);
  carets shown at grapheme-cluster boundaries; word and line deletes from the browser's
  `beforeinput` (so macOS Cmd+Backspace is expected to delete to the line start; manual check
  pending in 4.6), line deletes without a target
  range via `Selection.modify`; Delete/Backspace at block and document edges; scroll caret into
  view; stored marks dropped across native caret moves; browser T1/T2.
- [x] 4.5 (#13) Read-only mode (one dispatch gate drops user edits; select and copy still work),
  focus management (keyboard and code focus show the model selection), placeholder (CSS on
  the empty block, `aria-placeholder`); accessibility baseline (label, `aria-readonly`,
  semantic blocks); axe check on the playground in all three engines.
- [ ] 4.6 Manual G3 checks recorded: real IME (Windows Japanese/Chinese/Korean in Chrome and
  Firefox; macOS Safari and Android where available), dead keys, NVDA/VoiceOver reading the editor (page-break variants: G4). **Deferred:** gate G3 passed
  provisionally on the automated evidence (2026-11-05); the open checks are listed in
  ADR-0003 and run before 0.1.0 at the latest, or with their page-break versions at G4.
- [x] Gate G3 review (provisional): T1–T3 and the automated part of T4 pass in the browser
  matrix; see ADR-0003.

## Phase 5 — Native pagination · XL

**Goal:** Foli's defining feature. See [pagination.md](pagination.md).

- Page geometry from `DocumentSettings` (mm → px); A4, Letter, custom sizes; margins.
- Layout: measure blocks and line boxes; page-flow algorithm assigns lines to pages; paragraphs
  split into per-page fragments; explicit `pageBreak` node (schema v1 addition, before release).
- Rules: headings keep-with-next; widow/orphan control (default 2 lines).
- Incremental reflow: dirty from the first changed block; measurement cache keyed by node
  identity + content width; stop when page starts realign; one pass per animation frame; never
  during composition. Full invalidation on font load, width, zoom, settings change.
- Cross-page caret movement, selection and undo (T5).
- Print: `@page` from settings; Playwright PDF page count matches screen page count on fixtures.
- Deterministic fixtures with a bundled font: short, multi-page, long paragraph, heading at
  boundary, explicit breaks, mixed font sizes, different margins.
- Benchmarks (1/10/50/100+ pages): initial layout, keystroke-to-paint p50/p95, reflow time;
  hardware, browser and method published.

**Acceptance (G4):** T5 in all three engines; fixtures produce identical page breaks across runs;
visual regression snapshots stable; benchmark baseline published (targets set from it).
Includes ADR-0003's page-break checks: IME at a fragment edge and a screen reader reading a split
paragraph. A failure that cannot be fixed at the fragment edge triggers ADR-0003's fallback
(option B).

### Tasks

Each task is one PR that leaves `pnpm check` green and the playground working. Layout lives in
`packages/view` (`src/layout/`) until the seam is proven; page flow stays a pure function.

- [x] Claim phase, branch `phase-5/pagination`
- [x] 5.1 (#15) Pages in the view, block level: `EditorView` renders `section.foli-page` containers
  (size and margins from `editor.settings`, in mm) inside the one editable host and flows
  whole blocks into them by measured height with the pure `flowBlocks` (no splitting yet; no
  reflow during composition; re-flow when web fonts load). Position mapping, read-back and
  triple-click work with blocks under pages. React's `DocumentEditor` drops its single sheet;
  the playground shows real pages. Playwright in all three engines: existing suites on pages;
  a long document flows into A4 pages that respect the content box and are never under-filled;
  Enter pushes blocks onto the next page and undo pulls them back; selection and deletion
  across pages with undo; ArrowDown across the page gap; clicks on a later page. The bundled
  test font moved to 5.5, where exact page breaks are asserted; page chrome (headers, numbers)
  arrives with Phase 9.
- [x] 5.2 (#16) Paragraphs split across pages: line starts and line-box bottoms measured from the
  rendered block (per-character `Range` rects, binary search per line, only for blocks that
  do not fit; splits snapped to grapheme clusters); the pure `flow` assigns lines to pages;
  one block descriptor owns several DOM fragments (`data-fragment`), each rendering its slice
  with its marks, the split edges without margins. Caret affinity at fragment edges:
  Left/Right and word moves (with Shift) step over the edge; Backspace/Delete delete one
  character there (the browser's target range collapses); Home/End and up/down are native.
  Read-back joins fragments; copy is from the model; an IME composition just before the
  break gives exact text (Chromium CDP; no re-split while composing). Same split after a
  reload. Playwright T5
  basics in all three engines: split onto both pages, type at the end of page 1, arrows
  across the break (also right after a hard break), Backspace/Delete at it, a line-height
  smaller than the glyph boxes, Shift-select + replace + undo (text and
  selection back), mouse drag across + delete + undo. Mixed font sizes on one line are not in
  schema v1 yet (measured with equal-line-height assumptions; see architecture.md).
- [x] 5.3 (#17) Pagination rules: explicit `pageBreak` node (schema v1 addition before release;
  inline like `hardBreak`, as DOCX stores it; JSON, Mod-Enter, copy as a page-breaking `<br>`,
  paste from Word's `<br style='page-break-before:always'>`, Google Docs' hidden `<hr>` and
  Foli's own markup); the line holding a break ends its page; headings keep with the next
  block (chains too); widow/orphan control (2 lines by default, `FlowRules`). Unit tests on
  `flow` for each rule; Playwright in all three engines: Mod+Enter (undo, redo, Backspace),
  a break at a paragraph end, a heading slid over the end of page 1 never ends a page, a
  paragraph slid over it never leaves one line. (Blocks taller than a page split by lines
  since 5.2.)
- [x] 5.4 (#18) Incremental reflow: measurements cached by node identity (an edit reads the DOM only
  for the blocks it changed; settings changes and font loads drop the cache); `flowFrom`
  starts at the first changed block with the previous state and stops once the state before an
  unchanged block equals the previous one (property test against a full flow); unchanged
  fragments keep their DOM; a `ResizeObserver` on blocks re-measures one whose size changed
  without an edit (CSS, fonts, width, zoom); those re-flows are batched to one per animation
  frame and wait for a composition to end. Edits themselves flow synchronously (the DOM must
  match the model for the next mapping). Playwright: a CSS change re-flows without an edit;
  typing on page 1 of a 200-paragraph document keeps every page valid.
- [x] 5.5 (#19) Deterministic fixtures and visual regression with a bundled test font: Tinos (SIL
  OFL 1.1, `@fontsource/tinos` dev dependency, served to the page by the tests only; recorded
  in THIRD_PARTY_NOTICES.md). Fixtures in `apps/playground/e2e/fixtures.ts`: short,
  multi-page, long paragraph, heading at a boundary, explicit breaks, mixed font sizes
  (heading levels and bold/italic: schema v1 has no font-size mark), different margins (US
  Letter). Each fixture: a second load gives the same page breaks, which also match a
  recorded snapshot (block, fragment, characters per page), and a screenshot snapshot per
  engine (`visual.spec.ts`; see `docs/testing/visual-regression.md`). Found and fixed on
  the way: a re-flow without an edit (font, CSS) measured a split block's lines across its
  old split, and kept line starts of blocks rewrapped without a height change (WebKit sends
  no `loadingdone` for CSS fonts), so page breaks depended on when the font loaded.
- [x] 5.6 (#20) Print: the view writes a print stylesheet from the settings (`@page` of the page
  size with no margins, since each page's padding holds them; for its own pages, also inside a
  shadow root: each exactly one sheet tall, no gap, `break-after: page` but after the last);
  the React theme and the playground drop their chrome in print. Playwright on every fixture:
  in print media every page's content fits its sheet (all three engines); a PDF (Chromium) has
  as many sheets as screen pages, each of the page size (US Letter included). `@page` is per
  document: several editors with different page sizes on one web page print with the last
  one's sheet size.
- [x] 5.7 (#21) Benchmarks: 1/10/50/100/199 pages in all three engines (`pnpm bench:layout`,
  Playwright, a dev-only bench page that mounts the editor and times it from inside): initial
  layout and paint, keystroke handler and keystroke-to-paint p50/p95 (typing and Enter at the
  start of page 1, with an `onChange`), full re-flow after a font change; hardware, browsers
  and method in `docs/benchmarks.md`; targets set from the baseline with headroom (100 pages:
  handler p50 ≤ 8 ms, keystroke-to-paint p95 ≤ 25 ms, layout ≤ 60 ms, re-flow ≤ 100 ms in
  Chromium and Firefox). WebKit's paint times on Windows are Playwright's software-painting
  port, not Safari.
- [x] 5.8 (#22) Gate G4 review: T5 passes in all three engines (pages, visual and print suites run
  three times in a row); the page-break manual checks (IME at a fragment edge, a screen reader
  reading a split paragraph, spellcheck at the break) are recorded as open risks in ADR-0003,
  with checklist rows in `docs/testing/ime.md`; `docs/pagination.md` rewritten to match what was
  built (design, evidence, known limits).
- [x] Gate G4 review (provisional): T5 in the browser matrix, deterministic fixtures, benchmark
  baseline published; see ADR-0003.

## Phase 6 — React API & first release · M → 0.1.0

- `@foli/react`: `FoliEditor` (batteries included), `useFoliEditor`, `FoliEditorProvider`,
  `FoliCanvas`, `FoliToolbar`, `useEditorState(selector)` to avoid re-render storms.
  Final names decided here (current `DocumentEditor` is provisional).
- Toolbar: accessible (roving tabindex, `aria-pressed`, labels, visible focus); buttons driven by
  command dry runs.
- Lifecycle: uncontrolled with `onChange` (with transaction metadata); `editor.setDocument()` for
  external replacement; no per-keystroke controlled `value`. SSR-safe imports.
- Packaging: ESM, exports map, types, CSS entry, peer deps only for React; bundle size tracked;
  tarball install test into fresh Vite and Next.js apps (`examples/`); Changesets; npm publish
  with provenance from CI; `@foli` scope registered.
- Docs: getting started, API, styling, known limitations.

**Acceptance:** success criterion via npm-installed tarballs; axe checks on toolbar; 0.1.0 published.

## Phase 7 — Rich content · L → 0.2.0

- Lists: ordered/bullet, nesting, `ReplaceAroundStep`, wrap/lift/sink, Tab/Shift-Tab, Enter on
  empty item; lists across pages.
- Links: mark with validated `href` (safe protocols only), autolink on paste, editing UI.
- Paragraph alignment, text color, highlight (mark attrs), horizontal rule, `NodeSelection`.
- **Schema v2** with the first real migration (v1 → v2) and migration tests.

## Phase 8 — Tables & images · XL → 0.3.0

- Tables: table/row/cell with colspan/rowspan, cell selection, table commands, keyboard
  navigation; row-level page breaks with repeated header rows.
- Images: resource references in the envelope (no inline base64 by default), upload hook API,
  resize, required alt text, layout within pages.

## Phase 9 — Professional layout · L → 0.4.0

- Headers/footers as separate content in the envelope, edited in place with their own state.
- Page numbers and fields; different first page.
- Named paragraph/character styles in the envelope.
- Document outline/navigation; find & replace.
- Print/PDF polish.

## Phase 10 — Interop & Rust/WASM · XL → 0.5.0

Can start after Phase 7, in parallel with 8–9.

- HTML import/export (sanitized, schema-mapped).
- DOCX import/export: Rust crate (`zip` + XML) compiled to WASM, run in a Web Worker; also usable
  natively server-side. TypeScript baseline benchmarked first (e.g. against `docx`, MIT).
- JSON Schema generated from the TypeScript schema so Rust validates the same format
  (single source of truth).
- Fidelity corpus: documents authored in Word and LibreOffice; content round-trip tests.
  Content fidelity is the goal, not identical pagination to Word.
- Other Rust candidates (validation, batch transforms) only with before/after benchmarks.

## Phase 11 — Ecosystem & 1.0 · L

Freeze the extension API (custom nodes, marks, commands, keymaps, plugins), docs site, examples,
theming guide, deprecation policy, contributor onboarding, performance tracking in CI.

## Phase 12 — Optional

Collaboration (steps + mapping enable a central-authority protocol; CRDT binding evaluated
separately), comments, tracked changes (step metadata), AI-assisted editing on the
programmatic transaction API, headless server-side processing.

---

## Cross-cutting tracks

| Track         | Starts | Practice                                                                                              |
| ------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| Testing       | now    | Unit (Vitest) → property tests (P2) → browser e2e (P1) → visual regression (P5)                       |
| Performance   | P2     | Benchmark harness; numbers only with hardware, browser, dataset, method                               |
| Accessibility | P4     | Semantic DOM, keyboard-only use, screen-reader checks per release; no compliance claims without audit |
| Security      | now    | No `innerHTML` with untrusted data; sanitized paste; safe link protocols                              |
| Dependencies  | now    | No editor engines; license check for every dependency; provenance for copied code                     |
| Documentation | now    | Architecture, ADRs and this roadmap updated in the same PR as the change                              |
