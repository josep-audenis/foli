# Roadmap

Foli is built as an independent document-editing engine ([ADR-0002](decisions/ADR-0002-own-editing-engine.md)).
This roadmap orders the work so the riskiest assumptions are tested first and every phase
leaves `main` green with a working playground.

## Status

**Update this table in the same PR that starts, advances or finishes a phase.** It is the only
place that says what is in progress; check it before starting work.

| Phase                    | Status                   | Branch                   | Notes                                                                                      |
| ------------------------ | ------------------------ | ------------------------ | ------------------------------------------------------------------------------------------ |
| 0 Foundation             | ✅ Done                  | —                        |                                                                                            |
| 1 Architecture spike     | ✅ Done (G1 provisional) | —                        | Merged in #1; ADR-0003 accepted provisionally; IME, dead-key and screen-reader checks open |
| 2 Document model         | ✅ Done                  | —                        | Merged in #2                                                                               |
| 3 Transactions & history | ✅ Done                  | —                        | Merged in #4; gate G2 passed                                                               |
| 4 Editor view            | ✅ Done (G3 provisional) | —                        | Merged in #8–#13; manual checks (4.6) deferred, open risks in ADR-0003                     |
| 5 Native pagination      | ✅ Done (G4 provisional) | —                        | Merged in #15–#22; page-break manual checks open, risks in ADR-0003                        |
| 6 React API & 0.1.0      | ✅ Done                  | —                        | Merged in #23–#31; 0.1.0 on npm; manual checks shipped as known risks (ADR-0003)           |
| 7 Rich content           | ✅ Done                  | —                        | Merged in #33–#41; 0.2.0 on npm; list-document benchmark misses accepted (known limit)     |
| 8 Word model & DOCX      | ✅ Done                  | —                        | Merged in #44–#61; 0.3.0 on npm (`@folijs/docx` first released); gate G5 passed            |
| 9 Review                 | ✅ Done                  | —                        | Merged in #63–#72; 0.4.0 on npm                                                            |
| 10 Tables & images       | In progress              | `phase-10/tables-images` | Plan below; schema v4 (ADR-0006 first)                                                     |
| 11–12                    | Not started              |                          |                                                                                            |

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

| Gate                           | After   | Passes when                                                                          |
| ------------------------------ | ------- | ------------------------------------------------------------------------------------ |
| **G1 Rendering approach**      | Phase 1 | ADR-0003 records the chosen DOM/input approach with spike evidence for T4 and T5     |
| **G2 Headless correctness**    | Phase 3 | T1 and T2 pass headless (no DOM); property tests for steps, mapping and undo pass    |
| **G3 Interactive correctness** | Phase 4 | T1–T4 pass in the browser matrix                                                     |
| **G4 Native pagination**       | Phase 5 | T5 passes; pagination fixtures deterministic; benchmark baseline published           |
| **G5 Word fidelity**           | Phase 8 | Corpus round-trips without loss and opens in Word; page agreement with Word measured |

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
| 8     | Word model & DOCX         | Schema v3 (Word-shaped), styles, numbering, lossless DOCX   | 0.3.0        | XL   |
| 9     | Review                    | Tracked changes and comments, Word-compatible               | 0.4.0        | XL   |
| 10    | Tables & images           | Word tables across pages, inline and floating images        | 0.5.0        | XL   |
| 11    | Sections & templates      | Headers/footers, fields, content controls, notes, PDF       | 0.6.0        | L    |
| 12    | Ecosystem & 1.0           | Extension API freeze, docs site, performance in CI          | **1.0.0**    | L    |
| —     | Optional                  | Real-time collaboration, AI-assisted editing                | —            | —    |

```
P0 ─┬─► P1 spike ────────────────┐
    └─► P2 model ─► P3 transactions ─┴─► P4 view ─► P5 pagination ─► P6 (0.1)
                                                                       │
              P7 rich content ◄────────────────────────────────────────┘
               └─► P8 Word model & DOCX (ADR-0005) ─► P9 review ─► P10 tables & images
                                                                  └─► P11 sections & templates ─► P12 (1.0)
```

Phases 8–12 follow [ADR-0005](decisions/ADR-0005-word-compatible-model.md) (accepted
2026-11-09): Foli edits real Word documents, so the model follows Word and DOCX round-trips
without loss before more content types are added.

Phases 1 and 2 can run in parallel: the model does not depend on how text is rendered.

---

## Phase 0 — Foundation ✅

- [x] pnpm monorepo, TypeScript strict, Biome, Vitest, CI (since replaced by a local pre-push hook), graphify.
- [x] ADR-0001 (superseded), ADR-0002 (own engine), architecture, document model, pagination design.
- [x] `@folijs/core`: `FoliDocument` envelope, schema v1 (paragraph, heading, text, hardBreak;
  bold/italic/underline/strike) with strict validation and error paths.
- [x] `@folijs/view`: read-only DOM renderer (no `innerHTML`).
- [x] `@folijs/react`: read-only `DocumentEditor` on an A4 sheet; playground uses it.
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

## Phase 2 — Document model (`@folijs/core`) · L ✅

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

- [x] 2.1 Claim the phase; `fast-check` and `@vitest/coverage-v8` as `@folijs/core` devDependencies.
- [x] 2.2 `Schema` from node/mark specs (content expressions, attrs, allowed marks, exclusion);
  immutable `Mark`, `Node`, `Fragment`; schema v1 defined through the spec API; strict JSON in
  with normalization, canonical JSON out; `parseDocument` on the schema.
- [x] 2.3 Integer positions: `ResolvedPos`, `nodeAt`, `nodesBetween`, `textBetween`.
- [x] 2.4 `Slice` (open start/end), `Node.slice`, `Node.replace` (`canReplace` moves to Phase 3).
- [x] 2.5 Property tests (≥10k runs), ≥95% line coverage of the model, benchmarks in
  `docs/benchmarks.md`.
- [x] 2.6 Docs match the code; status `In review`.

Acceptance evidence: `model.property.test.ts` (5 properties × 10,000 runs);
`pnpm --filter @folijs/core coverage` (100% lines of the model sources in `src/model/`, threshold 95%); v1 fixtures in
`document.test.ts` load unchanged; timings in [benchmarks.md](benchmarks.md). Not in `pnpm check` yet:
coverage and benchmarks run from `@folijs/core` scripts (root config belongs to Phase 1).

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

## Phase 4 — Editor view (`@folijs/view`) · XL

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

- `@folijs/react`: `FoliEditor` (batteries included), `useFoliEditor`, `FoliEditorProvider`,
  `FoliCanvas`, `FoliToolbar`, `useEditorState(selector)` to avoid re-render storms.
  Final names decided here (current `DocumentEditor` is provisional).
- Toolbar: accessible (roving tabindex, `aria-pressed`, labels, visible focus); buttons driven by
  command dry runs.
- Lifecycle: uncontrolled with `onChange` (with transaction metadata); `editor.setDocument()` for
  external replacement; no per-keystroke controlled `value`. SSR-safe imports.
- Packaging: ESM, exports map, types, CSS entry, peer deps only for React; bundle size tracked;
  tarball install test into fresh Vite and Next.js apps (`examples/`); Changesets; npm publish
  with provenance from CI; the owner registers the npm scope (`@folijs`; `@foli` belongs to another npm user).
- Docs: getting started, API, styling, known limitations.

**Acceptance:** success criterion via npm-installed tarballs; axe checks on toolbar; 0.1.0 published.

### Tasks

Each task is one PR that leaves `pnpm check` green and the playground working. The success
criterion is the one from G3: type, format with shortcuts, undo, serialize, reload without loss.

- [x] Claim phase, branch `phase-6/react-api`
- [x] 6.1 (#23) React API: `useFoliEditor(options)` (one `Editor` per component, created once),
  `FoliCanvas` (mounts the `EditorView` for an editor: `editable`, `placeholder`, `label`),
  `FoliEditorProvider` and a context hook, `useEditorState(selector, isEqual?)` on
  `useSyncExternalStore` (a component re-renders only when its slice changes), `FoliEditor`
  (provider + canvas; toolbar from 6.2). `onChange` gets the transactions and reads the
  document lazily (no whole-document serialization per keystroke unless asked). Final names;
  `DocumentEditor` removed (nothing is published yet), playground migrated. Tests: StrictMode
  double mount, unmount cleanup, re-render counts with selectors.
- [x] 6.2 (#24) Toolbar: `FoliToolbar` (bold, italic, underline, strike, paragraph/heading levels,
  undo, redo, page break), state from `useEditorState` and cheap applicability checks (command
  dry runs build whole transactions: too slow after every transaction on large selections);
  roving tabindex, `aria-pressed`, labels, visible focus; clicks keep the editor's selection
  and focus. `FoliEditor` shows it by default (`toolbar={false}`); a `ref` on `FoliEditor`
  gives `{ editor, focus() }`, on `FoliCanvas` `{ focus() }`. Axe on the toolbar (editable and
  read-only) in all three engines; keyboard-only and mouse Playwright tests.
- [x] 6.3 (#26) Lifecycle and SSR: replacing the document from React (`editor.setDocument` through
  `FoliEditor`'s `ref`: new content and page settings, new history, selection at the start,
  `onChange` not called; unit test and Playwright through the playground's new "Open…"
  button, which loads a JSON file); every package imports in Node without a DOM;
  `renderToString(<FoliEditor />)` gives the toolbar and an empty editable area, and
  `hydrateRoot` attaches the view without warnings (React 19); layout effects are isomorphic
  (React 18 warns about `useLayoutEffect` on the server). React 18 at runtime moved to 6.4:
  aliasing React 18 inside `@folijs/react` resolves react-dom's `react` peer to React 19, and
  the example apps install the packed packages with their own React.
- [x] 6.4 (#27) Packaging: exports maps checked (ESM, types, `@folijs/react/styles.css`; React and React
  DOM the only peer dependencies; `sideEffects`; `repository` per package, which npm
  provenance checks; `publishConfig.exports` without the workspace's `@folijs/source` condition;
  `build` empties `dist` first); `publint --strict` (MIT) on every package and bundle size budgets
  (`scripts/size.mjs`: gzip per package with its Foli dependencies, fully minified, plus an
  app importing only `FoliEditor`; 14.1 / 19.9 / 25.3 / 25.2 kB)
  in `pnpm check`; `pnpm examples` packs the packages, installs the tarballs with npm into
  `examples/vite` (React 18, strict TypeScript over the published types, a React 18
  `renderToString` check that fails on the layout-effect warning) and `examples/next` (Next.js
  16, React 19, server rendering and hydration), builds both, and runs the success criterion
  in Playwright in all three engines (no console errors; the editor's shell in the server
  HTML).
- [x] 6.5 (#29, #30) Release tooling: packages renamed to `@folijs/*` (the `@foli` npm scope belongs to
  another user); Changesets (one fixed version for the three packages, changelogs); a
  release-only GitHub Actions workflow (`.github/workflows/release.yml`, started by hand on
  `main`) that runs `pnpm check` and publishes with npm provenance. Owner setup before 6.7
  (docs/contributing.md, "Releasing"): the `folijs` npm org and the `NPM_TOKEN` secret of the
  `npm` environment. The workflow has not run yet: its first run is the 0.1.0 publish.
- [x] 6.6 (#28) Docs: a README per package (the npm pages), getting started, API reference, styling
  (CSS variables, theme, print), known limitations (from architecture.md, pagination.md and
  ADR-0003's open risks).
- [x] 6.7 (#31) Release 0.1.0: ADR-0003's manual checks (G3 and G4 lists) run, or the owner accepts
  them as known risks listed in the release notes; tarball success criterion and toolbar axe
  green; the "not on npm yet" notes (README.md, docs/getting-started.md) removed; the owner
  approves the publish. Published 2026-11-07 by the Release workflow (the first run failed
  before publishing anything: the token lacked "bypass 2FA"), with provenance and tags
  `@folijs/{core,view,react}@0.1.0`; the manual checks shipped as known risks.

## Phase 7 — Rich content · L → 0.2.0

- Lists: ordered/bullet, nesting, `ReplaceAroundStep`, wrap/lift/sink, Tab/Shift-Tab, Enter on
  empty item; lists across pages.
- Links: mark with validated `href` (safe protocols only), autolink on paste, editing UI.
- Paragraph alignment, text color, highlight (mark attrs), horizontal rule, `NodeSelection`.
- **Schema v2** with the first real migration (v1 → v2) and migration tests.

**Acceptance:** T1–T5 pass with lists, links and a horizontal rule in all three engines; a list
item split across pages and a nested list across pages paginate deterministically (snapshots)
and print one sheet per page; documents saved by 0.1.0 load through the v1 → v2 migration
unchanged in content; HTML with lists, links, rules, colors and alignment pastes into the
schema (fixtures) and copies back out; no `href` outside the safe protocols reaches the
document by any path; axe passes on the new toolbar controls; the 100-page benchmark stays
within its targets; 0.2.0 published. (Accepted 2026-11-08 by the owner: the paragraph benchmark
stays within the targets; the 100-section list document misses them on Enter at the top,
initial layout and the full re-flow, a known limit for 0.2.0; benchmarks.md, "Lists".)

### Tasks

Starting point (survey 2026-11-07): the core model is generic (nested content, mark attrs,
`excludes`), but there is no `ReplaceAroundStep`, wrap/lift transform, `NodeSelection` or
non-inclusive mark. The view, layout and clipboard assume blocks are textblocks directly under
`doc` (one `BlockDesc` per top-level child, positions from top-level offsets, one layout box per
top-level block, marks rendered without attrs).

- [x] 7.1 (#33) Structure engine (`@folijs/core`, no schema change): `ReplaceAroundStep` (apply,
  invert, map, merge rules); `Transform.wrap`, `lift`, `split` at depth > 1 with types after,
  `join` across nesting; helpers `findWrapping`, `liftTarget`, `canSplit`, `canJoin`;
  `NodeSelection` (JSON, mapping, `selectable`/`atom` node specs); mark spec `inclusive`
  (typing at a link's edge does not extend it). Tests on `testSchema` (blockquote, rule, link),
  property tests: step invert/map round-trips including `ReplaceAroundStep`, undo of wrap/lift
  exact.
- [x] 7.2 (#34) Schema v2 and migrations: `SCHEMA_VERSION` 2; `parseDocument` runs `vN → vN+1`
  migrations before validation (registry, tests with v1 documents written by 0.1.0, unknown
  future versions rejected); v1 → v2 keeps content as is. Schema v2 adds `bulletList`,
  `orderedList` (`start`), `listItem` (`paragraph block*`), `horizontalRule` (atom, selectable),
  `align` on paragraph and heading (`start`, `center`, `end`, `justify`), marks `link`
  (`href` limited to http, https, mailto, tel and relative URLs; not inclusive), `textColor`
  and `highlight` (`#rrggbb`). JSON types, docs/document-model.md. Headless only: the view
  supports the new types from 7.3, so nothing user-facing changes until then.
- [x] 7.3 (#35) Nested blocks in the view (ADR-0004): decide how nested blocks render on pages
  (proposed: layout over the flattened leaf blocks, each page rebuilding the open `ul`/`ol`/`li`
  ancestors of its blocks, so list semantics survive). Render lists, list items and rules;
  positions, selection read/write and composition read-back at any depth; `NodeSelection`
  (rule) shown and read back; triple-click, placeholder and paste target in nested
  paragraphs; marks with attrs (link as `<a>` that does not navigate on a plain click, colors
  as styles); alignment. Pagination unchanged for flat documents (all existing suites green).
- [x] 7.4 (#36) Lists across pages: the flow works on the flattened blocks with nesting-aware margins;
  a list item splits at a line, a nested list continues on the next page (continued item
  without a second marker, `ol` numbering continues); widow/orphan and keep-with-next inside
  lists; justified text keeps its alignment across a break (`text-align-last` on continued
  fragments). Deterministic fixtures and visual snapshots in three engines, print, the
  benchmark with lists.
- [x] 7.5 (#37) List editing: commands `wrapInList`, `liftListItem`, `sinkListItem`, `splitListItem`
  (Enter on an empty item leaves the list), Backspace at an item's start, list type toggle;
  keys Tab/Shift-Tab inside lists only (Tab elsewhere still leaves the editor), Mod-Shift-7/8;
  the `beforeinput` fallback runs the same commands; toolbar buttons (bulleted, numbered,
  indent, outdent). Undo restores document and selection exactly; e2e in three engines.
- [x] 7.6 (#38) Links: `setLink(href)`/`removeLink` commands validating `href`; `normalizeHref`
  (trim, percent-encode spaces, `\` to `/`) before validation, for pasted and typed URLs; React link editing
  (toolbar button and Mod-K open a small accessible dialog: URL field, apply, remove);
  Ctrl/Cmd+click opens the link in a new tab (`noopener`); autolink of a pasted plain-text URL.
  Every entry point (parse, paste, command, dialog) rejects unsafe protocols, with tests.
- [x] 7.7 (#39) Alignment, colors, rule: commands `setAlign`, `setTextColor`, `setHighlight` (and
  removal), `insertHorizontalRule`; arrows and Backspace around a rule (`NodeSelection`);
  toolbar controls: alignment group, color and highlight menus (accessible menu buttons with a
  fixed palette), rule button; CSS variables for link, marker and rule styling.
- [x] 7.8 (#40) Clipboard and interop: HTML ↔ schema v2 for `ul`/`ol`/`li` (nesting, `start`), Word
  and Google Docs list markup (fixtures, best effort), `a[href]` (sanitized), `hr`, `color`,
  `background-color`, `text-align`; copy writes the same structures; fixture corpus extended;
  T3 rerun.
- [x] 7.9 (#41) Close: docs (architecture, document model, pagination, limitations, API, styling,
  getting started), playground sample document with every v2 feature, example apps updated,
  benchmark rerun; 0.2.0 changeset, version PR, publish after the owner's approval.

## Phase 8 — Word model & lossless DOCX round trip · XL → 0.3.0

**Goal:** Foli opens a real `.docx`, shows it with the file's own styles on real pages, edits
it, and saves it back without losing anything ([ADR-0005](decisions/ADR-0005-word-compatible-model.md)).

**Depends on:** ADR-0005 accepted. Phase 7.

- **Review content in the model:** tracked insertions and deletions (author, date) as marks,
  formatting changes, comment anchors with the comments in the envelope; imported, shown
  (insertions underlined, deletions struck, in the author's color) and exported. Recording and
  accept/reject come in Phase 9.
- **Schema v3, Word-shaped** (with the v1/v2 → v3 migration): paragraph properties as
  attributes (style, justification, indentation, spacing, keep/widow rules, page break before,
  outline level, numbering, tab stops); run properties as marks (character style, bold,
  italic, underline styles, strike, font, size, color, highlight, shading, vertical alignment,
  caps); headings as styled paragraphs; lists as numbered paragraphs; sections (page size,
  orientation, margins) instead of one `settings`; Word's units.
- **Styles and numbering in the envelope:** paragraph, character and numbering styles with
  `basedOn`, document defaults, theme fonts and colors; numbering definitions (formats, starts,
  restarts, levels, legal and heading numbering). Effective formatting resolved like Word.
- **Rendering from the document:** a per-document stylesheet from the resolved styles; list
  markers from numbering; fonts with metric-compatible substitutes, reported.
- **`@folijs/docx`:** import and export in TypeScript (browser, worker, Node), own XML tokenizer
  keeping exact source text, the original package kept; unknown elements as opaque block and
  inline nodes written back verbatim; unknown properties kept on their node or mark.
- **Editing like Word:** style picker, font family and size, paragraph spacing, indentation and
  line spacing, list levels and numbering formats; existing commands and keys ported to v3;
  HTML clipboard mapped to v3.
- **Verification harness** (local, Windows): Word through automation, LibreOffice as fallback;
  round trip without loss, opens without repair, per-paragraph page agreement with Word, PDF
  page comparison; a corpus of real documents.

**Acceptance (gate G5):** every corpus document round-trips with no part or element lost
(canonical comparison) and opens in Word without a repair prompt; per-paragraph page agreement
with Word measured and published as a baseline; opaque nodes per document reported; T1–T5 pass
on schema v3 in three engines; documents saved by 0.1.0 and 0.2.0 migrate without content loss;
0.3.0 published. (Measured 2026-11-16, Word 16.0.20527: all 21 rewritten and exported corpus
packages open without a repair prompt, the 15 without edits with Word's reference numbers; the
round trip without edits equals the original under the canonical comparison (unit tests);
106 of 106 paragraphs start on Word's page, 103 on Word's line, pages against Word's PDF 0.544;
opaque nodes per document in corpus/README.md; T1–T5 on v3 in Chromium, Firefox and WebKit;
0.1.0 and 0.2.0 documents migrate with every character, break and mark (property test); 0.3.0
published 2026-11-16. Gate G5 passed.)

### Tasks

Each task is a PR on `phase-8/word-model`, the build green after each.

- [x] 8.1 Corpus and Word harness (corpus and generator: #44; harness: #45). Synthetic Word-authored
  documents (`corpus/word/`: an NDA with legal numbering, a redlined services agreement with
  comments, a template with content controls and merge fields, a board report, a business
  letter) and their generator (`scripts/corpus/build-word-corpus.ps1`, Word automation); the
  harness (`scripts/corpus/word-reference.ps1`): for every document (synthetic or a private
  folder), whether Word opens it without repair, then, with tracked changes accepted, its page
  count, every paragraph's start page and line, end page and list number, and Word's PDF, as
  reference data (`corpus/reference/`) the later tasks compare with. LibreOffice headless as a
  fallback where Word is not installed: when a machine without Word needs it.
- [x] 8.2 `@folijs/docx` package reading (#46): zip on the platform's `deflate-raw` streams (no
  dependency; an audited one was planned), own XML tokenizer keeping the exact source text of
  every element, package parts, content types and relationships; untouched parts written back
  byte for byte, so a package written without replacements is the identical file. Checked with
  Word (`scripts/corpus/rewrite-corpus.mjs`, then the harness): every corpus document written
  back, unchanged and with a replaced main part, opens with the reference numbers.
- [x] 8.3 Schema v3 in `@folijs/core` (#47): paragraph properties as attributes, run properties as
  marks, styles (with `basedOn`, defaults, theme), numbering definitions, sections, review
  content (insertion and deletion marks, comment anchors), opaque block and inline nodes; the
  v1/v2 → v3 migration; validation. v3 is defined beside v2 (`packages/core/src/v3/`): the
  view and commands keep running on v2 until 8.6 and 8.7 move them, and `SCHEMA_VERSION`
  becomes 3 with that switch.
- [x] 8.4 DOCX import to v3 (#48): paragraphs, runs, styles, numbering, sections, tracked changes,
  comments; everything else as opaque content; a coverage report (opaque nodes per document:
  `scripts/corpus/import-report.mjs`, corpus numbers in `corpus/README.md`); every imported
  paragraph's text checked against Word's.
- [x] 8.5 Lossless export (#49): v3 → DOCX rewriting only the parts the editor owns; harness: a round
  trip without edits equals the original after canonicalization (what import does not keep
  exactly is listed in `packages/docx/README.md`; the comparison is
  `packages/docx/src/testing/canonical.ts`), every export opens in Word without repair
  (`scripts/corpus/rewrite-corpus.mjs`: unchanged, edited, and a new package from schema v2).
- [x] 8.6 Rendering from the document, in three parts (the view and editor run on v2 until 8.7, so
  each part lands without breaking them):
  - [x] 8.6a Resolution in `@folijs/core` (#50, no DOM): a paragraph's and a run's effective
    formatting from defaults, styles and direct formatting as Word computes it (toggle
    properties, theme fonts and colors, numbering indents), and list markers numbered as Word
    numbers them; checked against the number Word shows for every paragraph of the corpus.
  - [x] 8.6b Rendering v3 in the view (#51, `renderDocumentV3`, read-only until 8.7): resolved
    formatting as CSS, numbering markers, headings as `h1`–`h6`, fonts with metric-compatible
    substitutes, tracked changes (markup or final) and comment anchors shown, opaque content
    shown from its XML (tables as tables, content controls and fields as their text), sections
    and Word's paragraph spacing on pages; harness: per-paragraph page and line agreement with
    Word (`pnpm corpus:pages`; baseline in corpus/README.md).
  - [x] 8.6c The PDF page comparison as a tracked number (#52): every page Foli shows compared with
    Word's PDF of it by ink (pdf.js, pixel by pixel within 2 px), a score per page and
    inside the margins, overlays to look at (`FOLI_WORD_PDF=<folder> pnpm corpus:pages`;
    baseline in corpus/README.md).
- [x] 8.7 Editing on v3, in four parts (each lands with the v2 editor still working; v2 goes in
  8.7d):
  - [x] 8.7a The editor and view on a v3 document (#53): `createEditor` takes a v3 document (envelope
    kept, page from its last section), `EditorView` renders it with Word's blocks and spacing
    and edits it; Enter, the bold/italic/underline/strike toggles, Backspace and Delete as
    Word does them (style's next style, formatting from styles, markers kept, opaque content
    selected first); plain-text paste; T1, T2 and T5 on v3 in three engines (the editing page,
    `apps/playground/edit.html`).
  - [x] 8.7b Word formatting on v3 (#54): style picker (headings as styles; Word's built-in
    headings, List Paragraph and Hyperlink added on first use), font family and size,
    paragraph spacing, indentation, alignment, colors and highlight, links; lists as numbering
    (bullets and numbers, levels with Tab and Shift+Tab, Enter and Backspace in lists; Escape
    then Tab leaves the editor); the React toolbar on v3 (on the editing page; `FoliEditor`
    itself takes v3 in 8.7d). Rules (Word's bottom border) are not offered on v3 yet; the style
    box lists every paragraph style (hidden ones too).
  - [x] 8.7c Clipboard and input on v3 (#55): HTML copy as Word formats it (list numbers Word
    reads back), Foli JSON with the styles, numbering and comments it uses and the document's
    id; paste fitted to the document as Word's "use destination styles" (styles by name, a
    list goes on only inside its own document, comments copied, bookmark names kept unique,
    paragraph ids dropped); HTML paste as Word's styles and lists; the caret over a list
    number in one press; T3 and T4 on v3 (the editing page; real Firefox's clipboard by
    hand). Pasted comments stay after undo, unlike Word (Phase 9).
  - [x] 8.7d The switch, in four parts:
    - [x] 8.7d1 React and the playground on v3 (#56): `FoliEditor` and `useFoliEditor` take a
      document of any version (0.1.0 and 0.2.0 documents migrated on load, and by
      `setDocument`) and edit and report it as v3; the playground's main page on v3; its editing
      tests (T1–T5 and the rest) on v3 in three engines. The bench page keeps a v2 editor.
      `FoliEditor` loses v2's H1–H3 and rule buttons (the style box replaces them).
    - [x] 8.7d2 v2 editing removed (#57): the editor always on v3 (older documents migrated
      when loaded), v2's editing commands, blocks, toolbar and tests gone (behaviour they
      covered that v3 tests do not is tested on v3; v2 kept only to read and migrate old
      documents and to read pasted HTML); budgets set again; the bench page measures v3 (its
      font swap overrides the runs' inline fonts). Links from outside the document must be safe
      (`isSafeLink`: a safe href, or a bookmark of the document).
    - [x] 8.7d3 The names (#58): `SCHEMA_VERSION` 3; schema v3 takes the plain names
      (`FoliDocument`, `parseDocument`, `parseContent`, `schema`, the view's `renderDocument`);
      `createDocument(content?, section?)` makes a v3 document (a migrated 0.2.0 document's
      styles and lists, a twips section merged over A4); v2 exports only `FoliDocumentV2` and
      `parseContentV2` (old documents and pasted HTML); `parseDocument` says when a newer Foli
      saved a document.
    - [x] 8.7d4 Sections with their own page setups in the editable view (#59): each section's
      pages have its size and margins and its blocks are measured and split in its width; a
      section starts a new page unless continuous with the same setup; a named print page per
      setup. Page setups are not editable yet, nor section breaks insertable.
- [x] 8.8 Close: docs, gate G5 numbers and the 0.3.0 changeset (#60), the version PR (#61); 0.3.0
  published 2026-11-16 with the owner's approval.
  The changeset lists the breaks:
  - Documents persist as v3 (0.2.0 cannot read them); `FoliChange.document`, `getDocument()` and
    `useFoliEditor` are v3; `createEditor`, `setDocument` and `initialContent` migrate any
    version. Marks follow Word (`color`, `highlight` with Word's names); `parseDocument` keeps
    any link target (check `isSafeHref` before making HTML); Tab types a tab outside lists.
    (The full list is in the 0.3.0 changeset.)
  - Lists: `toggleList(kind)` and `wrapInList(kind)` take no attrs; `splitListItem`,
    `sinkListItem`, `liftListItem` and `liftListItemAtStart` are commands, not factories.
  - Removed: `insertHorizontalRule` (and `commands.insertHorizontalRule`), `listTypeAt`, the
    H1–H3 and rule buttons, the CSS variables `--foli-font-family`, `--foli-font-size`,
    `--foli-line-height`, `--foli-link-color`, `--foli-marker-color`, `--foli-rule-color`,
    `--foli-rule-thickness`.
  - On a state without a v3 envelope, `setBlockType` and the list and format commands do not
    apply; `toggleMark("link")` refuses an unsafe href.
  - Names: schema v3 takes the plain ones (`FoliDocument`, `parseDocument`, `parseContent`,
    `schema`, `SCHEMA_VERSION` 3, view's `renderDocument`); `createDocument(content?, section?)`
    makes a v3 document: its content is v3 and its second argument a section in twips (0.2.0's:
    v2 content and settings in millimetres; both still type-check, so a 0.2.0 call fails in
    `createEditor` or gives a wrong page size). v2's are `FoliDocumentV2` and `parseContentV2`; v2's `schema`,
    `parseDocument` and `SCHEMA_VERSION` are no longer exported (`parseDocument` reads v1 and v2).

## Phase 9 — Review: tracked changes & comments · XL → 0.4.0

The owner's documents (contracts) live in review: this comes right after the model.

- Track changes on and off; every edit recorded as Word records it (insertions, deletions,
  formatting changes, moves where practical), with author and date; changes shown inline or as
  a simple markup view.
- Accept and reject: one change, a selection, all, by author; next and previous change.
- Comments: add on a range, reply, resolve, delete; a comments pane beside the pages; anchors
  kept through edits.
- Round trip with Word: changes and comments made in Foli show in Word and back, checked by the
  harness.

**Starts from (Phase 8):** schema v3 already carries review content: `insertion` and `deletion`
marks (id, author, date, `move`), the paragraph mark's `revision`, `formatChange` on runs and
paragraphs (the previous properties), `commentStart`/`commentEnd`/`commentReference` anchors and
`comments` (threads, resolved) in the envelope. `@folijs/docx` imports and exports all of it and
writes comments made in the editor; the view renders `markup` or `final`. Missing when the
phase started: recording,
accept/reject, editing comments, and undo for envelope changes (`withEnvelope` is outside
history: pasted comments stay after undo, 8.7c), and `w:trackRevisions` (`settings.xml` is not
read).

**Acceptance:** with tracking on, any sequence of edits followed by "accept all" gives the
document the same edits make with tracking off, and "reject all" gives the original back
(property test, headless); undo restores comments and changes exactly; the redlined corpus
documents give Word's text after accept all and after reject all; changes and comments made in
Foli open in Word without repair with the same changes (type, author, text) and comments
(text, replies, resolved state) Word reports, and Word's edits to such a file come back; review
UI keyboard-only and axe-clean in three engines; 0.4.0 published. (Checked 2026-11-16: the
property test passes with accept-all equal to the edits untracked and reject-all to the original,
text, styles, bold and alignment included, the cases where accepting removes a paragraph whole
listed; undo restores comments and changes exactly (tests); the redlined document gives Word's
text after accept all and reject all, and so do 01, 04 and 05 paragraph by paragraph (case
aside; tables, fields and content controls aside; 03 not compared); files with
changes and comments made in Foli open in Word without repair with those changes (type, author,
text) and comments (text, replies, resolved state), and Word's edits come back (5 of 5,
corpus/README.md); the review toolbar, views and comments pane are used by keyboard and pass axe
in Chromium, Firefox and WebKit. 0.4.0 published 2026-11-16.)

### Tasks

Each task is a PR on `phase-9/review`, the build green after each.

- [x] Claim phase, branch `phase-9/review`
- [x] 9.1 Comments in history (#63): `CommentStep` adds, changes or removes one comment of the
  envelope and leaves the tree as it is, so a transaction's comment changes undo and redo with
  it (`setComments` makes the steps; `withEnvelope` ignores comments); styles and numbering
  added on first use keep Word's behaviour (they stay after undo). Pasted comments go with undo
  (closes 8.7c's note).
- [x] 9.2 Recording insertions and deletions (#64, `@folijs/core`, headless): tracking on/off and the
  author in editor state (`createEditor({ author, trackChanges })`, `setTrackChanges`), a date
  per change; the editor rebuilds each dispatched transaction from the ranges it replaced
  (`trackTransaction`), so commands need no tracking code. Typing, paste, Enter and breaks
  recorded as `insertion` (typing on joins the change next to it); Backspace/Delete and
  replacing a selection mark text `deletion` (caret before what Backspace deleted, after what
  Delete deleted), while deleting one's own insertion removes it; paragraph marks removed or
  added recorded on the paragraph (`revision`), one's own inserted mark joined for real (the
  last paragraph's mark kept), also for a paragraph a range replaces whole; bookmarks and
  comment ranges not marked; an edit deleting or inserting a block Foli does not model (a table)
  is not made while tracking (Phase 10); ids the next free one (comments' content included).
  Revisions have no initials in Word (comments do: 9.6); list numbers follow from the recorded
  paragraph properties (9.3). Known: accept-all of Enter over a selection across a heading and
  a body paragraph gives the inserted mark the body's style (untracked keeps the heading's). Whether
  tracking is on stays out of the document format: `@folijs/docx` reads and writes
  `w:trackRevisions` (`DocxImport.trackRevisions`, `exportDocx(…, { trackRevisions })`).
  Property test: accept all = the same edits untracked, reject all = the original, undo all =
  exact. Changes made by Foli exported and imported back unchanged (unit test; Word in 9.8).
- [x] 9.3 Recording formatting changes (#65): run formatting (bold, font, character style…) records a
  `formatChange` mark with the run properties before the first change, paragraph properties
  (style, alignment, indentation, spacing, numbering) the paragraph's `formatChange`; later
  changes keep the record; one's own inserted text and paragraphs record nothing. A join that
  removes one's own inserted mark keeps the first paragraph's properties (as untracked) and
  records the last one's as its formatting change (one's own record of properties back as they
  were is dropped: Enter then Backspace leaves the original). A split's open end keeps the
  original mark with the inserted paragraph's properties (the next style after a heading):
  recorded as that paragraph's formatting change, so rejecting keeps the heading. The paragraph
  mark's look (`markFormat`) is
  not recorded. The property test adds bold, unbold and alignment: accept all = untracked,
  reject all = the original's text, style, bold and alignment, headings included (6000 runs
  locally). Known: Enter in a paragraph next to a deleted mark splits that paragraph as it is,
  not the paragraph accepting makes. Imported `w:rPrChange` properties are kept in canonical form. Changes exported and imported back (unit test).
- [x] 9.4 Accept and reject (#66, `state/review.ts`): commands for the change at the caret, the changes
  in the selection, all, and all by an author; next and previous change (selects it);
  `trackedChanges(doc)` lists them; at a caret the changes there (the paragraph's recorded
  formatting only when none other), in a selection the selected part of each. A deleted paragraph
  mark accepted joins the paragraph with the next keeping the first one's properties (as
  untracked), or removes it whole when nothing of it is left (as Word: the next one keeps its
  properties; untracked joins and deletions from a paragraph's start now do the same); an inserted one rejected joins them
  keeping the last one's (the original mark's); a move's two ends go together; formatting changes
  restore or drop `previous`. Accept and reject are untracked and undoable. The redlined corpus
  document accepted gives Word's text with changes accepted (reference data); rejected, no
  inserted text and the deleted text back (Word's reject is compared in 9.8). The property test
  accepts and rejects everything for real: accept all = the edits untracked, reject all = the
  original (text, style, bold, alignment).
- [x] 9.5 Review in the editable view and React (#67): the review view in the editor's state
  (`setReviewView`, `createEditor({ reviewView })`): `markup` (author colors, underline and
  strike), `simple` (a bar beside changed paragraphs) and `final` while editing (deleted text
  hidden, kept in the DOM: selection and mapping go through it); `ins`/`del` titled with the
  author and date for hover and screen readers; while tracking, Backspace and Delete step over
  deleted text (the arrows skip hidden text natively). `FoliEditor` props `author`,
  `trackChanges`, `reviewView`; toolbar group: Track changes (pressed state), Show changes as,
  previous and next change, Accept and Reject (at the caret or the selection), Accept all and
  Reject all (by author: through the API only); accept and reject are their own undo steps.
  The editing page reads and writes the `.docx`'s tracking setting. Playwright in three engines:
  tracked typing and deletion, the three views while editing, going to, accepting and rejecting
  from the toolbar, undo; axe on the toolbar and pages with changes. Not yet: a deleted
  paragraph mark is not shown joined in `final`/`simple` while editing (the read-only renderer
  does join).
- [x] 9.6 Comments in the engine (#68, `state/comments.ts`): `addComment` on the selection (its range
  around it, the reference mark after it, as Word places them; at a caret, a point), replies
  (`replyToComment`: the starts together, then each end with its reference, as Word writes a
  thread; a reply to a reply answers the thread), `editComment`, `resolveComment` (and reopen:
  every comment of the thread, as Word), `deleteComment` (its replies and anchors),
  `deleteAllComments` (comments anchored in verbatim content, a table, stay until Phase 10);
  select-all comments the whole text; the selection stays on the commented text; initials cut to
  Word's 9 characters; ids above those in verbatim content too; content as text lines or v3 blocks; the author from the editor. Not
  tracked changes, each its own undo step. Anchors stay through edits (a range whose text is
  deleted keeps collapsed anchors); a comment whose reference mark an edit removes goes with its
  replies, in the same undo step (a tracked deletion keeps it until accepted; a comment without
  a reference from the start stays). Copy and paste with undo from 9.1. Headless tests; comments
  made in the editor come back from a new and from a corpus package with replies and resolved
  state (unit tests; Word in 9.8).
- [x] 9.7 Comments pane (#69): `FoliComments` (React; the view marks commented text with
  `data-foli-comments`): threads beside the pages level with their text, pushed down when they
  overlap; the focused thread's text outlined, the thread of a caret in commented text marked;
  reply, edit, resolve, reopen, delete; resolved threads dimmed; a new empty comment (toolbar:
  New comment) opens for writing, one left empty goes. `FoliEditor` shows it beside the pages
  (`comments`: "auto" while there are comments). Keyboard: Escape then Tab from the document
  into the pane, native buttons and text fields; not printed. Comments are edited as plain text
  (a paragraph per line, in the comment's paragraph style: Word's CommentText comments are
  editable); a comment with other formatting is not editable in the pane (it would be lost), only
  replied to, resolved or deleted. Reply and Delete are offered only where they can apply (a
  comment anchored in a table stays: 9.6); focus goes to the thread after an action, to the next
  thread or the document after a delete. Only comments made while the pane shows open for
  writing, and only those go when cancelled empty; the toolbar's New comment is shown only with a
  pane (`FoliToolbar` `comments`). Playwright in three engines (made from
  the toolbar and aligned with its text, reply, resolve, delete, undo, keyboard path, axe,
  print); the editing page shows the pane.
- [x] 9.8 Word round trip in the harness (#70): `scripts/corpus/word-review.ps1` reports, as Word reads
  them, revisions (type, author, text), comments (text, author, initials, parent, done) and the
  text with every change accepted and rejected (a separate script: `word-reference.ps1`'s data
  stay as they were); its corpus run is the reference in `corpus/reference/review/`, which
  `review-word.test.ts` compares Foli with (kinds of changes by author, comments, threads,
  resolved state; accept-all and reject-all text). `scripts/corpus/review-roundtrip.mjs` makes changes and comments in Foli on
  every corpus document, exports them, and checks Word opens them without repair with Foli's
  revisions (insertion, deletion, run and paragraph formatting, by author, with text), comment,
  reply and resolved state, and Word's accepted and rejected text equal to Foli's paragraph by
  paragraph (fields aside; 03, a content control around paragraphs, not compared); Word edits each
  Foli-made file (automation: a tracked insertion, a reply) and Foli reads both back. 5 of 5
  pass (corpus/README.md). Known: Foli writes dates in UTC where Word writes local time.
- [x] 9.9 Close: docs (README, document model, docx README, known limitations as of 0.4.0;
  architecture and api brought up to date with the final code of each task), acceptance checked
  (above), the 0.4.0 changeset (with the changed behaviours, #71), the version PR (#72); 0.4.0
  published 2026-11-16 with the owner's approval.

## Phase 10 — Tables & images · XL → 0.5.0

- Tables as Word models them: grid, row and cell properties, horizontal and vertical merges,
  borders and shading, table styles (conditional formatting), widths and autofit; rows across
  pages with repeated header rows; cell selection, table commands, keyboard navigation.
- Images: inline and floating (anchored, text wrapping) drawings, kept as resources in the
  package (no inline base64 by default); upload hook API, resize, required alt text.

**Starts from (Phase 9):** a table is one `opaqueBlock` (its `w:tbl` XML): imported, exported
byte for byte, shown read-only by the view from its XML (grid, spans, borders, shading, header
rows), selected and deleted whole, refused while tracking. A drawing is an `opaqueInline` in its
run, shown as nothing (`renderDocument` places none). Blocks in schema v3 are flat: nested blocks
on pages (ADR-0004) went with v2. Tables and pictures need new node types: a format change
(schema v4 with a v3 → v4 migration), so 0.4.0 will not read documents with them.

**Acceptance:** the corpus (with new Word-authored documents: a schedule whose table runs over
pages with repeated header rows and merged cells, a report with inline and floating pictures)
imports with its tables and pictures modeled (what stays opaque reported, per document); every
document round-trips with no part or element lost (canonical comparison) and opens in Word
without repair, edited too; per-paragraph page agreement with Word, cell paragraphs included,
at least the 0.3.0 baseline, and rows break across pages where Word breaks them; T1–T5 inside
table cells in three engines; tracked changes inside tables (and row insertion and deletion) are
recorded, accepted, rejected and round-trip with Word; every picture keeps its resource, and a
picture without alt text is reported; v3 documents migrate without loss; the table and picture
UI is keyboard-usable and axe-clean in three engines; 0.5.0 published.

### Tasks

Each task is a PR on `phase-10/tables-images`, the build green after each.

- [x] Claim phase, branch `phase-10/tables-images`
- [x] 10.1 ADR-0006, tables and pictures in the model and on pages: the node shapes (table, row,
  cell holding blocks; properties as Word's `w:tblPr`/`w:trPr`/`w:tcPr`, the grid, merges as
  `gridSpan` and `vMerge`), pictures as inline nodes (inline and anchored) with a resource
  reference and the envelope's resources (content type, size; bytes kept by the app or the
  package, no base64 in the JSON by default; an upload hook), layout (rows as the units of the
  flow, a row split at a line where Word allows it, header rows repeated, `cantSplit`), position
  mapping and selection (`CellSelection`), how tracking and comments reach cells, schema v4 and
  its migration. Spike evidence for rows across pages and caret movement between cells in three
  engines. The owner accepts it before 10.2. (Done: #73; accepted by the owner 2026-11-16.)
- [x] 10.2 Corpus: Word-authored documents for tables (a price schedule over pages with repeated
  header rows, merged cells both ways, banded table style, a nested table) and pictures (inline,
  floating square and top-and-bottom, behind text, with and without alt text) added to the
  generator, with Word's reference data (pages, paragraphs in cells, picture positions). (Done: documents 06 and 07, `-Only` switch on the generator.)
- [x] 10.3 Schema v4 in `@folijs/core`: table, row and cell nodes and their properties, the
  table style's conditional formatting (first and last row and column, bands) resolved as Word
  does (`Resolver`), picture nodes and the envelope's resources; validation, the v3 → v4
  migration (a version change: tables stay opaque until imported again), `SCHEMA_VERSION` 4.
  (Done: Word's rules as "no table after a table or ending the body", which lets a table be
  followed by opaque content as Word does; `.docx` export refuses tables and pictures and the
  view shows a placeholder until 10.4–10.8; banding, the Normal-style precedence and a
  conditional format's `insideH`/`insideV` cell borders are checked against Word's pages in
  10.5; 10.4 must not write a table next to an opaque `w:tbl`, which Word would merge.)
- [x] 10.4 DOCX tables: import `w:tbl` into the model (nested tables too; what the model cannot
  hold stays verbatim, reported), export losslessly (unchanged tables byte for byte, changed
  ones rewritten child by child), tracked changes and comments inside tables, row insertion and
  deletion revisions; harness: round trip, opens in Word, edited exports too.
  (Done: every corpus cell paragraph has Word's text; unchanged tables come back as written but
  for what import drops everywhere (run `rsid`s); `scripts/corpus/table-roundtrip.mjs` has Word
  read 4 unchanged and 4 edited exports and 2 tables made in the model; a table with a page,
  column or section break in a cell stays opaque rather than losing it. Until 10.5/10.6 the view shows a table read-only as one
  block (not split across pages) and the editor treats it as opaque (selected, then deleted, as
  a whole). A table style's `wholeTable` part stays in `ext`; changed table styles are refused
  on export.)
- [ ] 10.5 Tables on pages in the view: tables rendered from the model, column widths (fixed and
  autofit), borders as Word resolves conflicts, shading; rows flowed across pages (header rows
  repeated, `cantSplit` kept whole, other rows split at a line), position mapping and read-back
  inside cells, composition in cells; per-paragraph page agreement with Word including cell
  paragraphs (`pnpm corpus:pages`).
- [ ] 10.6 Editing in tables: core's table-aware editing first (cells isolate; a range delete of
  whole rows across a table's edges; Backspace and Delete next to a table; paste of rows; tracked
  row deletion and insertion as row revisions), then the view: typing, Enter, Backspace and Delete in cells (a cell never loses its
  last paragraph), Tab and Shift+Tab between cells (Tab in the last cell adds a row), arrows
  across cells and out of the table, `CellSelection` (drag, Shift+arrows) with copy, cut, paste
  of cells and delete of their content, undo; tracked changes in cells; T1–T5 in cells.
- [ ] 10.7 Table commands and UI: insert a table (rows × columns), insert and delete rows and
  columns, merge and split cells, header row, column width by dragging a border, table style and
  cell shading; row insertion and deletion tracked as Word records them; a table menu in the
  toolbar (React), keyboard-usable; axe in three engines.
- [ ] 10.8 Inline pictures: import and export `wp:inline` drawings (`a:blip` resources kept in the
  package), shown in the line at their size, laid out on pages; insert from a file, paste or
  drop through the upload hook; resize with the aspect ratio kept; alt text required to insert
  and editable; tracked insertion and deletion of a picture.
- [ ] 10.9 Floating pictures, starting with a spike (lines laid out around an exclusion inside
  the editable host, three engines: ADR-0006's open risk): `wp:anchor` positions (relative to page, margin, column or
  paragraph), wrapping square and top-and-bottom with text flowing around them, behind and in
  front of text; other wrappings shown as square (reported); moved with their paragraph;
  position agreement with Word measured on the corpus.
- [ ] 10.10 Close: docs (ADR-0006 outcome, architecture, document model, pagination, docx README,
  limitations), size budgets, the acceptance above checked with the harness, the 0.5.0
  changeset (schema v4: 0.4.0 cannot read documents saved by 0.5.0), the version PR; publish
  with the owner's approval.

## Phase 11 — Sections, fields, templates & PDF · L → 0.6.0

- Several sections per document (page size, orientation, margins and columns per section).
- Headers and footers (default, first page, even pages) edited in place with their own state.
- Fields: page numbers, page count, dates, cross-references, table of contents (shown with their
  cached result, updated on demand); merge and form fields.
- Templates: content controls (plain and rich text, drop-down, date, check box), filled from
  the UI or through the API.
- Footnotes and endnotes placed on their pages; bookmarks; document outline; find and replace.
- PDF export: `exportPdf` with the editor's own layout (headless browser on a server, or the
  browser's print), checked against Word's PDF of the same document.

## Phase 12 — Ecosystem & 1.0 · L

Freeze the extension API (custom nodes, marks, commands, keymaps, plugins), docs site, examples,
theming guide, deprecation policy, contributor onboarding, performance tracking in CI. Rust/WASM
only where a benchmark shows the need.

## Optional

Real-time collaboration (steps and mapping enable a central-authority protocol; a CRDT binding
evaluated separately), AI-assisted editing on the programmatic transaction API, headless
server-side processing.

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
