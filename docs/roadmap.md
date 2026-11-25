# Roadmap

Foli is built as an independent document-editing engine ([ADR-0002](decisions/ADR-0002-own-editing-engine.md)).
This roadmap orders the work so the riskiest assumptions are tested first and every phase
leaves `main` green with a working playground.

## Status

**Update this table in the same PR that starts, advances or finishes a phase.** It is the only
place that says what is in progress; check it before starting work.

| Phase                         | Status                   | Branch                     | Notes                                                                                                                                                                                         |
| ----------------------------- | ------------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Foundation                  | ✅ Done                  | —                          |                                                                                                                                                                                               |
| 1 Architecture spike          | ✅ Done (G1 provisional) | —                          | Merged in #1; ADR-0003 accepted provisionally; IME, dead-key and screen-reader checks open                                                                                                    |
| 2 Document model              | ✅ Done                  | —                          | Merged in #2                                                                                                                                                                                  |
| 3 Transactions & history      | ✅ Done                  | —                          | Merged in #4; gate G2 passed                                                                                                                                                                  |
| 4 Editor view                 | ✅ Done (G3 provisional) | —                          | Merged in #8–#13; manual checks (4.6) deferred, open risks in ADR-0003                                                                                                                        |
| 5 Native pagination           | ✅ Done (G4 provisional) | —                          | Merged in #15–#22; page-break manual checks open, risks in ADR-0003                                                                                                                           |
| 6 React API & 0.1.0           | ✅ Done                  | —                          | Merged in #23–#31; 0.1.0 on npm; manual checks shipped as known risks (ADR-0003)                                                                                                              |
| 7 Rich content                | ✅ Done                  | —                          | Merged in #33–#41; 0.2.0 on npm; list-document benchmark misses accepted (known limit)                                                                                                        |
| 8 Word model & DOCX           | ✅ Done                  | —                          | Merged in #44–#61; 0.3.0 on npm (`@folijs/docx` first released); gate G5 passed                                                                                                               |
| 9 Review                      | ✅ Done                  | —                          | Merged in #63–#72; 0.4.0 on npm                                                                                                                                                               |
| 10 Tables & images            | ✅ Done                  | —                          | Merged in #73–#97 (#90, the landing page, went to main); 0.5.0 on npm; two misses accepted                                                                                                    |
| 11 Sections & templates       | ✅ Done                  | —                          | Merged in #100–#118 (#106, #107, #110, #112 and #113, the site, went to main); 0.6.0 on npm; misses accepted                                                                                  |
| 12 Ecosystem & 1.0            | ✅ Done                  | —                          | Merged in #120–#133; 1.0.0 on npm (2026-11-20); Phase 5 speed misses and manual checks accepted as 1.0 risks                                                                                  |
| 13 Agent library              | ✅ Done                  | —                          | Merged in #138–#146; `@folijs/agent` 0.1.0 on npm (2026-11-21)                                                                                                                                |
| 14 MCP server                 | ✅ Done                  | —                          | Merged in #148–#162; `@folijs/mcp` 0.1.0 on npm (2026-11-21); a model in a client of its own is not tried (see 14.8)                                                                          |
| 15 Toolbar                    | ✅ Done                  | —                          | Merged in #149–#160; 1.1.0 on npm (2026-11-21); the release's bench ran on a busy machine (see #160)                                                                                          |
| 16 Code mode                  | ✅ Done                  | —                          | Merged in #164–#176; `@folijs/mcp` 0.2.0 and `@folijs/agent` 0.2.0 on npm (2026-11-21), `run` behind `--code`; four security reviews; not tried in a client of its own                        |
| 17 Toolbar for developers     | ✅ Done                  | —                          | Merged in #167–#173; 1.2.0 on npm (2026-11-21), released with Phase 16 (#176)                                                                                                                 |
| 18 Hint                       | ✅ Done                  | —                          | Merged in #180–#184; 1.3.0 and `@folijs/agent` 0.3.0 on npm (2026-11-22)                                                                                                                      |
| 19 Editing gaps               | ✅ Done                  | —                          | Merged in #187–#202; 1.4.0 (schema 6), `@folijs/agent` 0.3.1 and `@folijs/mcp` 0.2.2 on npm (2026-11-22); text boxes in find and crop handles left for later; Android and touch emulated only |
| 20 Corpus run                 | ✅ Done                  | —                          | Merged in #206–#222; its five `@folijs/docx` fixes ship with Phase 21's release (owner, 2026-11-23)                                                                                           |
| 21 Hardening                  | ✅ Done                  | —                          | Merged in #220–#237; 1.5.0, `@folijs/agent` 0.3.2 and `@folijs/mcp` 0.2.3 on npm (2026-11-23), with Phase 20's docx fixes; two limits await the owner's word (21.13)                          |
| 22 Collaboration              | ✅ Done                  | —                          | Merged in #238–#251; released as 1.6.0 (#252; `@folijs/collab` 0.1.0, `@folijs/agent` 0.3.3, `@folijs/mcp` 0.2.4); a rare divergence a heavier property run found is a known limit            |
| 23 Agent editing parity       | ✅ Done                  | —                          | Merged in #253–#268; 1.7.0 (schema 8), `@folijs/agent` 0.4.0 and `@folijs/mcp` 0.3.0 on npm (2026-11-24)                                                                                      |
| 24 Collab integration         | ✅ Done                  | —                          | Merged in #270–#276; 1.8.0 and `@folijs/collab` 0.2.0 on npm (2026-11-25), then 1.8.1 and collab 0.2.1 with the mark fix (#278)                                                               |
| 25 Word ribbon                | ✅ Done                  | —                          | Merged in #282–#289; 1.9.0, `@folijs/agent` 0.4.3, `@folijs/mcp` 0.3.3 and `@folijs/collab` 0.2.2 on npm (2026-11-25)                                                                         |
| 26 Comment-only mode          | In review                | `phase-26/comment-only`    | 26.1-26.3 built; release waits on owner                                                                                                                                                       |
| 27 Comment history & mentions | In progress              | `phase-27/comment-history` | Asked for by the owner on 2026-11-25                                                                                                                                                          |

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

| Phase | Name                      | Outcome                                                                           | Release                | Size |
| ----- | ------------------------- | --------------------------------------------------------------------------------- | ---------------------- | ---- |
| 0     | Foundation                | Monorepo, docs, own schema v1, read-only view                                     | —                      | ✅   |
| 1     | Architecture spike        | Two-page editable surface validated → ADR-0003                                    | —                      | M    |
| 2     | Document model            | Schema, immutable nodes, positions, slices, JSON                                  | —                      | L    |
| 3     | Transactions & history    | Steps, mapping, state, undo/redo, commands, headless editor                       | —                      | L    |
| 4     | Editor view               | Editable DOM view: input, selection, IME, clipboard                               | 0.0.x canary           | XL   |
| 5     | Native pagination         | Real pages, fragments, incremental reflow, print                                  | —                      | XL   |
| 6     | React API & first release | `FoliEditor`, hooks, toolbar, packaging                                           | **0.1.0**              | M    |
| 7     | Rich content              | Lists, links, alignment, color, highlight, rules                                  | 0.2.0                  | L    |
| 8     | Word model & DOCX         | Schema v3 (Word-shaped), styles, numbering, lossless DOCX                         | 0.3.0                  | XL   |
| 9     | Review                    | Tracked changes and comments, Word-compatible                                     | 0.4.0                  | XL   |
| 10    | Tables & images           | Word tables across pages, inline and floating images                              | 0.5.0                  | XL   |
| 11    | Sections & templates      | Headers/footers, fields, content controls, notes, PDF                             | 0.6.0                  | L    |
| 12    | Ecosystem & 1.0           | Extension API freeze, docs site, performance tracking                             | **1.0.0**              | L    |
| 13    | Agent library             | `@folijs/agent`: an LLM edits a document without positions                        | agent 0.1.0            | M    |
| 14    | MCP server                | `@folijs/mcp`: the agent library as tools for any MCP client                      | mcp 0.1.0              | M    |
| 16    | Code mode                 | `run` in `@folijs/mcp`: a script over the document, sandboxed                     | mcp 0.2.0              | M    |
| 17    | Toolbar for developers    | Tabs an app controls, the built-in dialogs and strings open to it, overflow       | 1.2.0                  | M    |
| 18    | Hint                      | Show a place for a few seconds: an app's, or an agent's change                    | 1.3.0                  | S    |
| 22    | Collaboration             | Real-time editing by several people: steps over the app's transport, an authority | 1.6.0, collab 0.1.0    | L    |
| 23    | Agent editing parity      | Tables, formatting, lists, pictures, headers: the agent edits as a user does      | agent 0.4.0, mcp 0.3.0 | M    |
| 24    | Collab, easy to integrate | Versions checked, a client loop over any transport, plugins switched in place     | 1.8.0, collab 0.2.0    | M    |
| 25    | Word ribbon               | Captioned groups, contextual tabs, collapse, shrinking groups, KeyTips            | 1.9.0                  | M    |
| 26    | Comment-only mode         | Select and comment, never change the text; the collab authority checks it too     | next minor             | S    |

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
UI is keyboard-usable and axe-clean in three engines; 0.5.0 published. (Checked 2026-11-17: the
corpus imports with every table and picture modeled, what stays opaque reported per document
(fields, content controls, footnote references; corpus/README); every document equals its
original after canonicalization, other parts byte for byte (`export.test.ts`); Word opens the
corpus's tables (4 documents unchanged and edited, 2 made in the model) and pictures (04 and 07
unchanged and edited: alt text, size, floats moved, a new picture) with Foli's content
(`table-roundtrip.mjs`, `picture-roundtrip.mjs`); every paragraph outside tables on Word's page
(115 of 115) and 277 of 280 cell paragraphs, rows broken where Word breaks them in 06; T1, T2,
T3 and T5 in cells in three engines; tracked text in cells and row insertion and deletion
recorded, accepted and rejected, and Word reads Foli's tracked insertion in a cell and tracked
row deletion back (table round trip, revisions counted); pictures keep their resources, `report.picturesWithoutAlt` counts the ones without alt
text; v3 → v4 migration changes the version only (tests); the table menu, its dialog, the table
style and shading boxes and the picture dialog are keyboard-usable and axe-clean in three
engines. Two misses, accepted by the owner as known limits on 2026-11-17 (docs/limitations.md): on Word's line, 101 of 115
paragraphs; 04 has 25 of 35, below 0.3.0's 33, because its floating chart is now laid out and
Word's line numbers count the 9 lines beside it, which its own PDF shows as Foli does, as 5; and
T4 (IME) in cells runs in Chromium only, as everywhere in the editor. 0.5.0 published
2026-11-17 with the owner's approval.)

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
- [x] 10.5 Tables on pages in the view: tables rendered from the model, column widths (fixed and
  autofit), borders as Word resolves conflicts, shading; rows flowed across pages (header rows
  repeated, `cantSplit` kept whole, other rows split at a line), position mapping and read-back
  inside cells, composition in cells; per-paragraph page agreement with Word including cell
  paragraphs (`pnpm corpus:pages`).
  (Done: cell paragraphs are view blocks of their own; tables are flow items drawn per page
  from the model; 277 of 280 corpus cell paragraphs on Word's page; e2e on 06 in three engines.
  Shortcuts: autofit tables keep Word's saved grid; `border-collapse` resolves border conflicts;
  rows in a vertical merge or holding a nested table split only between rows; composition is
  the view's read-back (checked with DOM changes in cells; no IME run).)
- [x] 10.6 Editing in tables: core's table-aware editing first (cells isolate; a range delete of
  whole rows across a table's edges; Backspace and Delete next to a table; paste of rows; tracked
  row deletion and insertion as row revisions), then the view: typing, Enter, Backspace and Delete in cells (a cell never loses its
  last paragraph), Tab and Shift+Tab between cells (Tab in the last cell adds a row), arrows
  across cells and out of the table, `CellSelection` (drag, Shift+arrows) with copy, cut, paste
  of cells and delete of their content, undo; tracked changes in cells; T1–T5 in cells.
  (Done. 10.6a, core: cells isolate, Backspace and Delete next to a table move into it,
  range deletes across a table's edges take whole rows (or empty cells), tracked text in cells,
  row deletion and insertion as row revisions with accept and reject. 10.6b: Tab and Shift+Tab
  between cells (Tab in the last cell adds a row), Up and Down across rows, pages and out of the
  table. 10.6c: `CellSelection` (drag, Shift+arrows), Delete empties cells, typing replaces the
  anchor cell's content, formatting and review act on the selected cells only. 10.6d: cells copy
  and cut as a table (JSON, HTML, tab-separated text); rows pasted into a table fill its cells
  from the selected one, adding rows (extra columns dropped, not yet reported); pasted into text,
  a table. T1, T2, T3 (pasted HTML) and T5 (cells across a page break) in cells pass in
  Chromium, Firefox and WebKit; T4 (CDP IME) and the system clipboard's Foli type in Chromium
  only, as for the rest of the editor. HTML tables from other applications paste as
  paragraphs.)
- [x] 10.7 Table commands and UI: insert a table (rows × columns), insert and delete rows and
  columns, merge and split cells, header row, column width by dragging a border, table style and
  cell shading; row insertion and deletion tracked as Word records them; a table menu in the
  toolbar (React), keyboard-usable; axe in three engines.
  (Done. 10.7a, core: insert a table, insert and delete rows and columns, delete a table;
  rows tracked, column commands refused while tracking; Word's Table Grid style added and
  exported. 10.7b, core: merge and split cells, header rows, table style, cell shading, column
  width; none while tracking. 10.7c: column borders dragged in the view (three engines). 10.7d:
  the toolbar's Table menu (keyboard-usable, with an insert table dialog), table style box and
  cell shading menu; axe on the toolbar, menu, dialog and pages in Chromium, Firefox and WebKit.
  Not yet: a keyboard way to set a column's width, nested tables' borders.)
- [x] 10.8 Inline pictures: import and export `wp:inline` drawings (`a:blip` resources kept in the
  package), shown in the line at their size, laid out on pages; insert from a file, paste or
  drop through the upload hook; resize with the aspect ratio kept; alt text required to insert
  and editable; tracked insertion and deletion of a picture.
  (Done. 10.8a, docx: inline pictures imported as `picture` nodes with their images as
  resources (alt text missing counted), exported from their drawing with the model's changes
  written in (unchanged: byte for byte), new ones as fresh drawings with media parts from the
  package, a `data:` URL or the app. 10.8b: the views draw them in their lines at their size,
  from the app's URLs (`packageImages` for a package) or the resource's own, marked when alt
  text is missing; laid out on pages as lines (three engines, axe). 10.8c, core: inserting a
  picture (alt text required unless decorative), its size and alt text; tracked insertion and
  deletion, exported and read back. 10.8d: pictures selected by a click and resized by a handle
  with their aspect ratio (three engines); image files inserted through the upload hook where
  pasted or dropped (three engines; the paste and drop events themselves in Chromium only:
  synthetic ones carry no files elsewhere), without alt text then, marked (ADR-0006). 10.8e:
  the toolbar's Picture… dialog: insert from a file with alt text (required unless decorative),
  edit a selected picture's alt text and size from the keyboard; axe on the dialog, three
  engines. Not yet: touch resizing, Word's picture-plus-text paste, cropping.)
- [x] 10.9 Floating pictures, starting with a spike (lines laid out around an exclusion inside
  the editable host, three engines: ADR-0006's open risk): `wp:anchor` positions (relative to page, margin, column or
  paragraph), wrapping square and top-and-bottom with text flowing around them, behind and in
  front of text; other wrappings shown as square (reported); moved with their paragraph;
  position agreement with Word measured on the corpus.
  (Done: spike passed, CSS floats in the editable host in three engines, ADR-0006 updated;
  `wp:anchor` read and written as `picture.float`; floats laid out on pages in both views, 07's
  three on Word's page and paragraph at Word's offsets. Shortcuts (architecture.md, "Floating
  pictures"): a square or top-and-bottom picture placed against the page or its margins
  vertically is drawn at its paragraph's top; text goes on one side of a square picture; several
  floats in a paragraph stack; one reaching past its page's text makes the page taller.)
- [x] 10.10 Close: docs (ADR-0006 outcome, architecture, document model, pagination, docx README,
  limitations), size budgets, the acceptance above checked with the harness, the 0.5.0
  changeset (schema v4: 0.4.0 cannot read documents saved by 0.5.0), the version PR; publish
  with the owner's approval. (Done: docs as of 0.5.0 (README, document model, pagination, api,
  limitations with table and picture sections, ADR-0006's outcome, docx and corpus READMEs);
  budgets as raised per task (core 52.7, view 63.5, React 87.9, docx 44.9 kB gzip), each with
  its reason; acceptance checked (above), `scripts/corpus/picture-roundtrip.mjs` added; the
  0.5.0 changeset with the changed behaviours (#95); the version PR (#96); 0.5.0 published
  2026-11-17 with the owner's approval.)

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

**Starts from (Phase 10):** sections are read and laid out (each paragraph's `section` ends one;
its page size, orientation and margins apply to its pages, printed through named pages), but
their page setups and breaks are not editable, `nextColumn` and columns (`w:cols`) are not laid
out, and a section's headers and footers are only relationship ids into the original package:
their parts are exported verbatim, never shown. Footnote and endnote parts are kept the same
way; a note reference is an `opaqueInline`. Fields keep their result as editable text with
their structure (`w:fldChar`, `w:instrText`) opaque; simple fields, merge fields, content
controls and bookmarks are opaque nodes. The corpus already has the Word content: 01 (`REF`,
Page X of Y, first-page header), 03 (five content controls, `MERGEFIELD`, a picture in the
header), 04 (`TOC`, `PAGEREF`, `SEQ`, footnotes, a landscape section), 05 (a page number in
the header). Its page score against Word's PDFs (`pnpm corpus:pages`) leaves headers, footers
and footnotes out. New node types and stories in the envelope are a format change (schema v5 with a v4 → v5
migration), so 0.5.0 will not read documents with them.

**Acceptance:** the corpus (with new Word-authored documents for what it lacks: several
sections with columns, even and odd headers and footers, endnotes, bookmarks with
cross-references) imports with its headers, footers, notes, fields, content controls and
bookmarks modeled (what stays opaque reported, per document); every document round-trips with
no part or element lost (canonical comparison) and opens in Word without repair, edited too
(a header changed, a field updated, a content control filled, a note added, a section break
inserted); per-paragraph page agreement with Word at least the 0.5.0 baseline, and headers,
footers and footnotes on Word's pages (the page score measured over the whole page, not only
inside the margins); page fields show each page's number and the page count; a table of
contents updated in Foli lists Word's headings and page numbers; T1–T5 inside a header and a
footnote in three engines; tracked changes in headers, footers and notes are recorded,
accepted, rejected and round-trip with Word; content controls filled from the UI and through
the API, and merge fields from data, export as Word reads them; find and replace reaches every
story; `exportPdf` gives the editor's pages, scored against Word's PDF; v4 documents migrate
without loss; the new UI (section setup, header and footer editing, fields, content controls,
notes, outline, find and replace) is keyboard-usable and axe-clean in three engines; 0.6.0
published. (Checked 2026-11-19, Word 16.0.20625, Chromium, Firefox and WebKit on Windows: the
corpus, 08 and 09 added, imports with every header, footer, note, field, content control and
bookmark modeled, only 02's 4 comment reference marks opaque (`import-report.mjs`); every
document equals its original after canonicalization (`export.test.ts`, `pnpm check`: 1574
tests); Word opens every export, unchanged and edited, and finds Foli's content: sections 4 files
(a continuous break, columns, the same tracked), stories 24 (every header and footer changed,
notes added, deleted, tracked, converted), fields 24 (updated, rebuilt, merged, inserted),
controls 9 (filled through the API, typed into, emptied, tracked), find 9 (replaced in every
story, tracked, bookmarks), and again tables 10, pictures 4, review 9 (the review script now
reads an inline picture as Word does); per-paragraph page agreement above the 0.5.0 baseline:
158 of 158 paragraphs outside tables on Word's page (0.5.0: 115 of 115), 142 on Word's line
(101 of 115), no document lower than in 0.5.0, 277 of 280 cell paragraphs; the page score over
the whole page, headers, footers and notes included, 0.889 over 24 pages (0.894 inside the
margins; 08 1.000 with its even, odd and first headers, 09 0.999 with its notes, 03 0.830 where
the screenshot draws its letterhead picture as a box); page fields per page and the page count
(`word-headers.spec.ts`, 08's five pages at 1.000); a table of contents rebuilt in Foli is
Word's (04, `fields-word.test.ts`, `field-roundtrip.mjs`); T1, T2, T3 and T5 in a header and in
a footnote in three engines (T5 as a header or note growing and pushing the text across a page
end); tracked changes in headers, footers and notes recorded, accepted, rejected
(`word-headers.spec.ts`, `word-notes.spec.ts`) and read by Word (`story-roundtrip.mjs`,
`find-roundtrip.mjs`); content controls filled through the API and by editor commands and merge
fields from data are what Word reads (`control-roundtrip.mjs`, `field-roundtrip.mjs` 03-merged),
filling from the UI is checked in the browser (`word-controls.spec.ts`); find and replace reaches
the body and every story (`find-roundtrip.mjs`, `word-navigation.spec.ts`); `exportPdf`'s PDF
scores 0.954 over the 24 pages against Word's, every page count and sheet size Word's, and the
editor's print gives the same pages, sizes and text for the nine documents (`pdf.spec.ts`,
Chromium); v4 → v5 changes the version only (`v5.test.ts`); the section, header, fields, notes,
controls and navigation menus, dialogs and panels are keyboard-usable and axe-clean in three
engines. The whole playground e2e suite passes in three engines (762 tests, 75 skipped where an
engine cannot run them). Misses, accepted by the owner as known limits on 2026-11-19: T4 (IME) in a header and in a
footnote runs in Chromium only (CDP), as everywhere in the editor; filling a control from the UI
is not itself exported to Word (the UI runs the commands the round trip exports); on Word's line
04 stays at 25 of 35, the limit accepted for 0.5.0; on screen 07 scores 0.394 and 02's second
page 0.595 (pictures drawn as boxes; one fee table row Word moves to the next page). 0.6.0
published 2026-11-19 with the owner's approval.)

### Tasks

Each task is a PR on `phase-11/sections-fields`, the build green after each.

- [x] Claim phase, branch `phase-11/sections-fields`
- [x] 11.1 ADR-0007, stories, fields and content controls in the model and on pages: headers,
  footers, footnotes and endnotes as stories (content trees of their own in the envelope,
  referenced by id from sections and note references; one editor state per story or one state
  with several roots, and what undo, selection, tracking and comments do across them); fields
  (simple and complex, nested, a field spanning paragraphs such as `TOC`: instruction kept,
  result as content, updated on demand from layout: `PAGE`, `NUMPAGES`, `PAGEREF`, `REF`,
  `SEQ`, `DATE`, `TOC`), content controls (inline, block, row and cell; their properties,
  placeholder and data binding kept), bookmarks (start and end marks); layout (a header or
  footer taller than its margin pushes the text, first and even variants, linked to the
  previous section; notes at the page's foot taking space from its text, continued on the next
  page; columns and column breaks; continuous sections), editing in place (focus moves between
  the body and a story, the body dimmed); `exportPdf`'s approach; schema v5 and its migration.
  Spike evidence for a header edited in place and a footnote moving pages as its reference
  does, in three engines. The owner accepts it before 11.2. (Done: spike passing in three
  engines; the host is turned off while a story is edited, an editable island leaks select-all
  and arrows. A real `EditorView` takes input on a page with the main view's observer stopped
  and its events kept off, but a render of the main view still removes it: `place` changes in
  11.7. Accepted by review on merge, as the owner instructed on 2026-11-18: each task merged
  after an agent's review.)
- [x] 11.2 Corpus: Word-authored documents for what 01–07 lack (several sections with two and
  three columns, a column break, a continuous section, even and odd headers and footers, a
  section with headers not linked to the previous, endnotes, bookmarks with `REF` and
  `PAGEREF` to them, a date field) added to the generator, with Word's reference data (pages of
  headers, footers and notes, field results) and PDFs; the page score measured over the whole
  page. (Done: 08 newsletter and 09 pump test memo; `word-reference.ps1` records sections,
  headers and footers, notes, fields and bookmarks for every document, Word giving a note only
  its reference's page; the score over the whole page is the harness's "on the page". Starting
  points in corpus/README.)
- [x] 11.3 Schema v5 in `@folijs/core`: stories in the envelope, field, content control,
  bookmark and note reference nodes and their properties, sections' header and footer
  references to stories; validation, the v4 → v5 migration (a version change: what stays
  opaque until imported again), `SCHEMA_VERSION` 5. (Done: nothing produces the new content
  yet: `.docx` export refuses it, the views show its result or nothing, until 11.4-11.10. The
  steps of ADR-0007 come with their first user, 11.7.)
- [x] 11.4 DOCX stories: headers, footers, footnotes and endnotes imported as stories and
  exported losslessly (unchanged parts byte for byte, changed ones rewritten, new ones with
  their relationships and content types); pictures, tables, tracked changes and comments in
  them; harness: round trip, opens in Word, edited exports too. (Done: headers, footers and
  notes are stories, note references and note marks nodes; a story unchanged keeps its part or
  note byte for byte; `scripts/corpus/story-roundtrip.mjs` has Word read the corpus unchanged and
  edited and a new package with a header, footer and notes. What a story may not hold stays
  verbatim, comments included: Word 16 drops a comment anchored in a note when it saves. The
  editor does not show stories yet, and a reference shows nothing until 11.10.)
- [x] 11.5 DOCX fields, content controls and bookmarks: complex and simple fields (nested,
  across runs and paragraphs), merge and form fields, content controls at every level (with
  data binding and placeholders kept), bookmarks; what the model cannot hold stays verbatim,
  reported; harness as in 11.4. (Done: fields as markers with their codes, `w:fldSimple` written
  back as one; controls at run, block, row and cell level, nested, their properties in `controls`
  with `w:sdtPr` kept; `scripts/corpus/field-roundtrip.mjs` has Word read them, unchanged and with
  a field's result, a control's text and a control split in two. Controls that are bound, show
  their placeholder or lock their content stay verbatim until 11.9 honours that, and a control's
  properties changing is refused until then. Bookmarks were modeled already. Until 11.8 a field's
  code range with a nested field shows that field's result.)
- [x] 11.6 Sections on pages and their editing: columns (equal and set widths, the line between
  them, column breaks), continuous sections, even and odd page sections with Word's blank page;
  insert and remove section breaks, page setup per section (size, orientation, margins,
  columns) as commands and a keyboard-usable dialog; tracked as Word records them; page
  agreement with Word (`pnpm corpus:pages`). (Done: bands and columns in the flow and both
  renderers, balanced above a continuous break; `insertSectionBreak`, `removeSectionBreak`,
  `setSectionSetup`, `insertColumnBreak`, `EnvelopeStep` with a stale undo dropped whole; a Section
  menu and page setup dialog. Tracked, not refused, as Word 16 saves them: a break is an inserted
  or deleted paragraph mark, a setup `w:sectPrChange`, reviewed like other changes;
  `scripts/corpus/section-roundtrip.mjs` has Word read them. Word's PDFs also showed that it takes
  the larger of space after and space before, not their sum (the sum only with
  `w:doNotUseHTMLParagraphAutoSpacing`, read into `settings`): fixed in the flow, which moved
  most corpus documents' scores. Shortcuts: a paragraph split between columns of different widths
  continues by its share of the text, and read-only pages can repeat or lose a few words there; a
  selection deleted across a break does not pass its header references on; the break is not
  drawn; a next-column section with another column count starts a page.)
- [x] 11.7 Headers and footers: laid out in their margins on every page (first, even and
  default variants, linked to the previous section, a taller one pushing the text), page
  fields filled per page; edited in place (double-click or a command opens the story, Escape
  returns) with typing, formatting, pictures, tables, undo and tracking; link to previous and
  different first page and even pages as commands; T1–T5 in a header; on Word's pages. (Done:
  `StoryStep`, `editor.story(id)` with one history, accept and reject all across stories,
  `settings` read and written; both renderers draw the regions, the variant rules checked on
  Word's PDFs, which added one: Word's blank page has no header or footer. Page score 0.768 to
  0.811, 03 from 0.138 to 0.830 and 1.000 inside the margins, 08 1.000. `word-headers.spec.ts` in
  three engines, T4 by CDP in Chromium; T5 here is a header pushing the body across pages, a
  header having no pages of its own. Shortcuts: an open header shows its page fields' stored
  results; a line with text and a picture keeps the room below the baseline, only a line of
  pictures alone ends at their foot; a story's height comes from the read-only renderer, the open
  one is drawn by the editing renderer.)
- [x] 11.8 Fields: shown with their results (shaded when selected, as Word does), selected and
  deleted whole, updated on demand (one field, all, before print and PDF): `PAGE`, `NUMPAGES`,
  `SECTIONPAGES`, `DATE`, `REF`, `PAGEREF`, `SEQ`, `TOC` built from heading styles with their
  pages; insert a page number, the date, a cross-reference and a table of contents; merge
  fields filled from data through the API; field codes shown and hidden. (Done: `fieldsIn`, the
  selection rules as a plugin, `updateFields` with Word's switches, one undo step, tracked, stories
  included; `TOC` built with `TOC1`-`TOC9`, `_Toc` bookmarks, links, nested `PAGEREF`, a right tab;
  `insertField`, `insertPageNumber`, `insertDate`, `insertCrossReference`,
  `insertTableOfContents`; code ranges hidden in both renderers, Alt+F9, F9, Ctrl+A then F9, the
  selected field shaded, `view.print()` updating first; a Fields menu and cross-reference dialog.
  On the corpus with Word's pages every field works out to Word's result and nothing changes
  (`fields-word.test.ts`); `word-fields.spec.ts` in three engines; `field-roundtrip.mjs` has Word
  read updated, rebuilt (in a content control too), merged (tracked) and inserted fields: all 24
  files pass; `\#` pictures match 558 cases read from Word. Shortcuts: unknown
  fields, unfollowed switches and missing bookmarks keep their result and are reported;
  `MERGEFORMAT` keeps the first run's look, not word by word; a multi-paragraph `REF` gets line
  breaks; table of contents entries are plain text; English date names; codes shown are not
  editable, no Shift+F9 or Ctrl+F9; the browser's own Print does not update fields.)
- [x] 11.9 Content controls: shown with their bounds, title and placeholder; plain and rich
  text edited inside (and only inside when locked), drop-down and combo box lists, date picker,
  check box, repeating sections kept; filled from the UI and through the API (by tag or id),
  read back as data; keyboard-usable and axe-clean. (Done: every control modeled, 03 with none
  opaque; a filter on what each transaction leaves enforces locks and what a kind holds, in stories
  too; placeholders selected whole, replaced, brought back; `insertControl`, `setControlValue`,
  `controlValues`, `setControlProperties`, `addRepeatingItem`; properties patched into the kept
  `w:sdtPr`, new ones written whole; frames, titles, lists, date picker and check boxes in the view,
  by keyboard too (Alt+Down, Space); a Controls menu and properties dialog.
  `word-controls.spec.ts` in three engines, T1 to T3 in a rich text control;
  `control-roundtrip.mjs` has Word read 9 files, every control as Foli holds it. Word's rules are
  in ADR-0007. Shortcuts: a bound control's content is read-only, the binding not evaluated;
  dates picked are written with English names and typed ones are not reformatted; `w:temporary` is
  kept but does not remove the control when edited; a group control's fixed content is editable; no
  picture chosen for a picture control; a custom placeholder of `insertControl` is lost on reload
  (no glossary entry is written); a control's own tracked deletion is not written; a list's or
  date's button is mouse-only, Alt+Down its keyboard way.)
- [x] 11.10 Footnotes and endnotes: insert a note (numbered in Word's formats, restarting per
  section or page where set), its text edited in place; footnotes laid out at their reference's
  page foot (separator, continuation to the next page), endnotes at the end of the document or
  section; deleted with their reference; tracked; T1–T5 in a note; on Word's pages. (Done:
  `noteNumbers` from the settings and sections, drawn and never stored; `insertNote`,
  `setNoteProperties`, `convertNotes`; a plugin keeps a note with its reference, tracked as Word
  records it; a copy carries the note and pastes a new one. The flow and both renderers place notes,
  separators and continuations, `beneathText` and `sectEnd` too; a note opens in place by double
  click, Shift+Alt+N or the Notes menu, with an options dialog. Page score 0.811 to 0.889: 09 from
  0.391 to 0.999, 04 from 0.821 to 0.832 (the rest of 04 is not notes), none lower, all 158
  paragraphs on Word's page; made documents with restarts, section endnotes, notes beneath the text
  and most column cases match Word's PDFs. `word-notes.spec.ts` in three engines, T4 by CDP in
  Chromium; T5 here is a note growing and pushing the text; `story-roundtrip.mjs` has Word read 24
  files. Word's PDFs corrected the ADR: notes in columns are set across the columns' foot, not in
  their reference's column. Shortcuts: no widow or orphan control in a note's lines,
  `w:continuationNotice` not drawn, options for the whole document only, a reference in opaque
  content not counted, Word sometimes ends an earlier column sooner than the notes need.)
- [x] 11.11 Navigation: bookmarks (insert, go to, used by cross-references), the document
  outline (headings, moving to them; a React panel), find and replace across every story (case
  and whole words, replace tracked while tracking, one undo step for replace all); keyboard
  shortcuts as Word's; axe. (Done: `findAll`, `replace`, `replaceAll` with the rules Word showed
  through its object model (ADR-0007), refusals returned with their reason; `insertBookmark`,
  `renameBookmark`, `deleteBookmark`, `listBookmarks`, `goTo`, `documentOutline`; matches marked with
  the CSS Custom Highlight API, a story opened for its match and left for the body's;
  `FoliNavigation` in `FoliEditor`: find, replace and go to panel, bookmarks dialog, outline, a
  Navigate menu; Ctrl+F, Ctrl+H, Ctrl+G, F3, Shift+F3, Ctrl+Shift+F5, only with the focus in the
  document or the panels. `word-navigation.spec.ts` in three engines, axe included; on 107 pages a
  key takes 14 to 55 ms in Chromium, 14 to 37 in Firefox, 57 to 78 in WebKit, `findAll` itself 1 ms
  or two; `find-roundtrip.mjs` has Word read 9 files. Shortcuts: no regular expressions, no search
  in comments or opaque content, no match across paragraphs; bookmarks and comment anchors kept in a
  replaced match and deleted text refused, unlike Word; marks only near the window and only where
  the browser has the API; Go to by place, not printed number; a reference split over runs not
  renamed; the cross-reference dialog lists the body's bookmarks.)
- [x] 11.12 PDF: `exportPdf` from the editor's own layout as decided in ADR-0007 (fields updated
  first, links and the outline as PDF bookmarks where the engine gives them), the page score
  against Word's PDF for every corpus document; print uses the same pages. (Done: `@folijs/pdf`,
  depending on core only, ships `dist/renderer.js` (core and the read-only renderer, 82.9 kB gzip)
  for the app's Playwright or Puppeteer page; `exportPdf(document, { page, resources, review,
  styles })` validates, lays out, updates fields from `DocumentPages.fieldLayout` (twice more at
  most, as the editor), makes safe absolute links and bookmark links PDF links, prints with the
  editor's print rules (`print.ts`, now shared) and `preferCSSPageSize`, `outline`, `tagged`:
  each section on its own sheet size, headings as PDF bookmarks. `pdf.word.ts` scores Foli's PDF
  against Word's for every corpus document: 0.954 over 24 pages (on screen 0.889; pictures now
  count), every page count and sheet size as Word's, every field already Word's result.
  `e2e/pdf.spec.ts` (Chromium) reads the PDFs back with pdf.js: 04's pages, sizes, text, notes and
  outline; fields updated, links; for all nine documents the editor's print has the same pages,
  sizes and text, and the same ink but where the renderers draw differently. Shortcuts: a field's
  page is its block's first page; the editor's print and the PDF differ in a table's repeated
  header rows (plain text in the editor), change bars (the editor's only) and a few words where a
  paragraph continues in a column of another width (08); Puppeteer typed, not run; pictures only
  from bytes or `data:` URLs (the page loads nothing); no dot leaders; comments not printed.)
- [x] 11.13 Close: docs (ADR-0007 outcome, architecture, document model, pagination, api, docx
  README, limitations), size budgets, the acceptance above checked with the harness, the 0.6.0
  changeset (schema v5: 0.5.0 cannot read documents saved by 0.6.0), the version PR; publish
  with the owner's approval. (Done in #117: docs as of 0.6.0 (README, document model
  with schema v5's envelope, pagination, architecture, api, getting started, limitations,
  benchmarks' bundle sizes, ADR-0007's outcome and status, docx, React and corpus READMEs);
  budgets unchanged, every Phase 11 raise with its reason in a shorter `scripts/size.mjs` comment
  (core 84.6, view 106.6, React 149.9, docx 55.3, pdf 16.2 kB gzip, pdf's renderer 83.1);
  acceptance checked (above), the review round trip fixed for inline pictures, a control test's
  race on a click fixed (`expect.poll`); the 0.6.0 changeset (`.changeset/sections-fields.md`,
  `@folijs/pdf` first released); the version PR (#118); 0.6.0 published 2026-11-19 with the
  owner's approval, `@folijs/pdf` for the first time.)

## Phase 12 — Ecosystem & 1.0 · L

Freeze the extension API (custom nodes, marks, commands, keymaps, plugins), docs site, examples,
theming guide, deprecation policy, contributor onboarding, performance tracking (ADR-0008: by hand
with stored baselines, no hosted CI). Rust/WASM only where a benchmark shows the need.

**Starts from (Phase 11):** the generic model is open (`NodeSpec`, `MarkSpec`, `Schema` exported)
but the editor is bound to the one Word schema (schema v5): `EditorOptions` takes no schema,
`parseContent` validates against it, and unknown Word content becomes `opaqueBlock` or
`opaqueInline`, drawn as boxes. Plugins exist (`Plugin`, `PluginKey`, `PluginSpec` with state,
`filterTransaction`, `appendTransaction` and `keymap`; `createEditor({ plugins })` and
`FoliEditor`'s `plugins` prop, user plugins before the built-ins) and every built-in feature uses
them, but they are documented as unstable and most built-ins (`fieldsPlugin`, `controlsPlugin`,
`notesPlugin`, `trackPlugin`…) are not exported. Commands are free functions
(`(state, dispatch?) => boolean`); `editor.commands` is a fixed object. Keymaps are plugin maps
over `keyName`, but the view handles some keys before them (fields, controls, notes, document
edges, Ctrl+F/H/G, F3, Escape, Tab), so those cannot be overridden (Shift+arrows in tables can). The
view has no node views, decorations or plugin views (`EditorViewOptions`: `editable`,
`placeholder`, `resource`, `upload`, `paged`, `noteMark`); theming is 13 `--foli-*` CSS
variables. `FoliToolbar` cannot be extended, only replaced. Core's root re-exports `model`,
`state`, `transform` and `v3` whole (about 300 names); 29 `@internal` tags, no API report or
`stripInternal`; `docs/api.md` says nothing is stable before 1.0. `apps/site` is the landing page
and a test page, not docs; `examples/` has a Vite and a Next.js app installed from tarballs
(`pnpm examples`). Benchmarks (`pnpm bench:layout`, find) run by hand, numbers in
`docs/benchmarks.md`; only bundle sizes are checked (`pnpm size`). There is no CI by design:
`pnpm check` runs in the pre-push hook and GitHub Actions only publishes. The manual checks of
ADR-0003 (IME, screen readers, macOS keys, real pastes, Safari) are still open risks.

**Acceptance:** ADR-0008 records what 1.0 promises (the public API per package, the persisted
format, semver and the deprecation policy) and the owner accepts it; an API report per package is
checked in `pnpm check` and changes only with a reviewed report; a custom node and a custom mark
defined outside the packages are typed, rendered on pages, undone, copied and pasted, saved and
loaded, and go through `.docx` as ADR-0008 decides, without losing content (an example app does it
from tarballs); a plugin adds a command, a keymap that overrides a built-in key, a decoration and a
toolbar item; every key the view handles itself is overridable or listed as reserved; the
benchmarks run with stored baselines and fail on a regression past their threshold where
ADR-0008 decides (no hosted CI unless the owner chooses it); the docs site is published with
getting started, guides (extensions, theming, styling, DOCX, PDF, migration from 0.x), the API
reference from the reports, live examples and the limitations; contributing covers setup, the
architecture tour and the release; every 0.x document format (v1–v5) loads in 1.0; the manual
checks are run or accepted again by the owner as 1.0 risks; 1.0.0 published with the owner's
approval. (Checked 2026-11-20, Word 16.0.20625, Chromium, Firefox and WebKit on Windows, the
owner's laptop on mains: ADR-0008 records the public API per package, the saved format, semver
and deprecation; its acceptance was delegated to an agent's review by the owner's instruction of
2026-11-19 (Phase 12 built task by task, each merged after review), and only its one open point
(a 1.x minor may add a schema version, saved at the lowest version needed) was decided by the
owner explicitly, on 2026-11-20; `pnpm check` (1,699 unit tests) compares the five API reports and fails on a forgotten
export (`scripts/api.mjs`, tested in `api.test.mjs`); a mention (custom inline node), a card
(custom block node) and a topic (custom mark) are typed, drawn on pages (the card split across a
page end), undone, copied and pasted into editors with and without the extension (Chromium and Firefox;
WebKit skips every clipboard test), saved and loaded and taken through `.docx` (`extension.spec.ts`), Word 16 reads, edits and saves them and
Foli reads every node and mark back (`extension-roundtrip.mjs`, 4 of 4), and
`examples/extension` does it from the tarballs (`pnpm examples`: the four apps install, typecheck
and build, the SSR and DOCX checks pass, 27 passed and 6 skipped, the Next.js server-HTML test
outside Next, in three engines); a plugin adds a command (`insertMention`, by name), a keymap
taking a built-in key (`keymaps.spec.ts` presses every overridable key with a user keymap on
it), decorations and a toolbar item (`extension.spec.ts`, `toolbar-items.spec.ts`, the example);
every key the view takes itself is overridable or reserved, listed per platform in
`keyboard.md` (`keys.test.ts`); `pnpm bench` compares 51 metrics with the committed baseline and
fails past a threshold: of three runs in 12.12 the first failed 12 metrics on a busy machine
(exit 1), the second passed all 51, the third (`--update`) passed all but Chromium's re-flow at
200 sections (+110%, noise: that metric is noisy), and the baseline was recorded from the
second's medians ([benchmarks](benchmarks.md#10-numbers));
no hosted CI, as ADR-0008 decides; the docs site is published at
[foli.josepaudenis.com/docs](https://foli.josepaudenis.com/docs/) (the 35 pages built before the DOCX
and PDF guides each serve their own title, 12.11's content live; Cloudflare Pages builds every push and publishes `main`) with getting started, the extensions, theming and migration guides,
styling, the API reference per package from the reports, three live examples, the limitations
and the changelogs; the DOCX and PDF guides are the packages' READMEs, published as
`/docs/guides/docx/` and `/docs/guides/pdf/` (one text for npm and the site; links to them from
other pages stay on the site); site e2e 75 and the built site's 9 in three engines (`site-*`
projects, 83 passed, 1 skipped: WebKit's Tab); contributing covers setup, where things live, the keystroke tour,
tests and harnesses, the site and releasing; every 0.x format (v1–v5 fixtures saved by
0.1.0–0.6.0) loads and saves, in core and through `.docx` (`formats.test.ts`, in `pnpm check`);
the manual checks were accepted again by the owner as 1.0 risks on 2026-11-20 (ADR-0003,
limitations, the 1.0.0 release notes). Also run: `pnpm test:e2e` 1,083 tests, 997 passed, 84
skipped where an engine cannot run them, 2 failed under load then passed 3 of 3 when rerun
(contributing.md, known flaky); the Word harnesses, extension 4 of 4 and stories 24 of 24;
`pnpm corpus:pages` as 0.6.0 (158 of 158 paragraphs on Word's page, 142 on its line, 277 of 280
cell paragraphs). Misses: Phase 5's speed targets at 100 pages (first layout, re-flow, Enter;
typing meets them in Chromium only), accepted by the owner on 2026-11-20 as not blocking 1.0;
the manual checks not run on real devices, accepted by the owner as 1.0 risks. The version PR
(#133); 1.0.0 published 2026-11-20 with the owner's approval.)

### Tasks

Each task is a PR on `phase-12/ecosystem`, the build green after each.

- [x] Claim phase, branch `phase-12/ecosystem`
- [x] 12.1 ADR-0008, the 1.0 contract and the extension API: what is public and stable per package
  (what leaves core's `export *`, what becomes `@internal` and is stripped), the persisted format
  promise (schema v5 frozen for 1.x, new content only through a new major or as content 1.x
  ignores safely), semver and the deprecation policy (warn for a minor, remove in the next major);
  custom nodes and marks on the Word schema (how they are declared, validated, stored in the
  envelope, laid out and drawn, and what `.docx` gets: refused, a content control with a tag, or
  custom XML, read back as the same node); the plugin spec frozen (plus view-side hooks:
  decorations, node views, plugin views); commands and keymaps (a registry behind
  `editor.commands`, which built-in keys become overridable, which stay reserved); toolbar
  extension; where the history plugin's state stands with collaboration left optional; where
  performance is tracked without CI (pre-push, a bench command with baselines, or a workflow the
  owner turns on); the docs site's tool and host; Rust/WASM not planned unless a benchmark asks.
  Spike: one custom inline node and one mark end to end in the editor and through `.docx`. The
  owner accepts it before 12.2. (Done:
  [ADR-0008](decisions/ADR-0008-1.0-contract-and-extensions.md), accepted by review as the owner
  asked for Phase 12. Decided: indexes list exports by name, internals `@internal` and stripped
  (`stripInternal` works in TypeScript 7.0.2), what the other packages need from core on
  `@folijs/core/internal`, an API report per package (`dist` `.d.ts` joined, compared in
  `pnpm check` by a script that also catches forgotten exports); core as an exact peer dependency of
  the other packages; every 1.x reads every earlier format, a minor may add a schema version with a
  migration and a document is saved at the lowest version it needs (not v5 frozen: Word's opaque
  content still has to be modeled; this one point the owner accepted on 2026-11-20, in 12.11), an older
  1.x refuses a document that needs a newer one; `@deprecated`, a dev warning where cheap, removal
  in the next major; custom inline and block leaves and marks as namespaced extensions on the Word
  schema, foreign nodes when the extension is missing, in `.docx` a content control tagged `foli:`
  and the JSON (255 characters at most, longer refused); `PluginSpec` frozen plus `commands`, view
  hooks in `@folijs/view`, every key the view takes itself listed as overridable or reserved;
  toolbar `items`; history's state internal, collaboration not in 1.0; `pnpm bench` with baselines
  per machine before each release, no hosted CI; the docs site in `apps/site` from `docs/*.md` with
  `marked`, hosted with the landing page by the owner; no Rust. Spike `spikes/extension`: a mention
  and a topic mark typed, drawn on pages, undone, saved and loaded, through `.docx` in Chromium,
  Firefox and WebKit; copy and paste in Chromium only (Playwright's Firefox pastes HTML, which drops
  them: 12.3 carries them in the HTML; WebKit skipped); Word 16 opened, edited and saved 5 files and
  Foli read every node and mark back. Shortcuts: the packages are patched as the spike's dev server
  serves them (no package changes); block nodes, find, tracking and foreign nodes not exercised.)
- [x] 12.2 Public API surface: core's exports listed by name (no `export *`), internals marked and
  stripped from the published types, the built-in plugins and keys exported where ADR-0008 says;
  an API report per package (`.d.ts` of `dist` compared with a committed report, no new tool
  unless the ADR picks one) in `pnpm check`; `docs/api.md` marks every name stable or internal. (Done: core's index lists its 346 public names by name, no `export *`;
  `@folijs/core/internal` (`src/internal.ts`, an `exports` entry with the `@folijs/source`
  condition; publint passes) holds 37 the other packages use without a promise: the Word context,
  envelope and their steps, the resolver and its formats, clipboard fitting, the view's layout
  helpers, the Word schema and its checks. `defaultTextblockType`, `isNote` and `storyBody` left the
  API. Public per package: core 346, view 14 (`RenderDocumentOptions` added: `renderDocument`'s `review`, `fieldCodes`, `resource`),
  React 19, docx 27, PDF 8. Every other module export is tagged `@internal` (362 tags: core 123,
  view 119, docx 117, React 3) and stripped (`stripInternal` in `tsconfig.base.json`). Built-in
  plugins: only `history()`, `baseKeymap()` and `listKeymap()` are exported, as ADR-0008 says.
  View, docx and PDF take core, React core and view, as `workspace:*` peer dependencies (and
  devDependencies, for the workspace); `changeset status` still plans 0.7.0 for all, no major from
  the peers. `scripts/api.mjs` (`pnpm api` in `pnpm check`, `pnpm api:update`) joins each package's
  `dist/**/*.d.ts` into `packages/<name>/api-report.d.ts` (core 3,445 lines, view 749, docx 385,
  React 225, PDF 81) and fails on a difference, a forgotten export, `export *` in an entry, or
  published types that do not compile alone with `skipLibCheck` off, and on a public entry's types
  importing `@folijs/core/internal` (after the review of #122); the compile check found public
  types using stripped names (`Story`, `EnvelopeKey`, `Check` went to the internal entry, the
  structure helpers `canJoin`, `canSplit`, `findWrapping`, `liftTarget` stayed public with
  `Transform`, and `NodeType.createOpen`, used by the view's clipboard, lost its tag). Tested in
  `scripts/api.test.mjs`. `docs/api.md` marks internal names (the rest is stable) and lists the
  model, state, transform and option types; contributing documents the reports; the install
  lines name `@folijs/view`. Shortcuts: the checks read `.d.ts` text with regular expressions and
  match names, not symbols (two modules exporting one name count once); doc comments are in the
  reports, so editing one changes them. Review of #122: the model classes' constructors are no
  longer tagged (stripped, they left an implicit public `new Node()` in the types), and the
  examples' smoke test expected schema v3 (stale since 11.3). `pnpm examples` run on 2026-11-19:
  both apps install the tarballs with the exact peers and build, the SSR and DOCX checks pass,
  15 passed and 3 skipped (the Next.js server-rendering test outside Next) in three engines.)
- [x] 12.3 Custom nodes and marks in `@folijs/core`: the schema extension from ADR-0008
  (`createEditor` and `parseDocument` take it), validation, JSON, copy and paste between editors
  with and without the extension (never dropped: opaque when unknown), find and review over them;
  `@folijs/docx` writes and reads them as decided; tests and a round trip that Word opens; delete
  `spikes/extension` and its Playwright project once the real API replaces it. (Done: `Extension`
  (`{ name, nodes?, marks?, plugins? }`), `ExtensionNodeSpec` (a leaf with `text(attrs)`) and
  `ParseOptions` in core; `createEditor({ extensions })`, `parseDocument(json, { extensions })`,
  `exportDocx(…, { extensions })`; `NodeSpec.text`; `parseContent(json, { path?, fragment?,
  extensions? })` (`ContentOptions`) in place of its positional parameters.
  `schemaWith` builds the Word schema plus the types (namespaced, not taken twice, leaves only,
  else a `RangeError`) and every parse inside an editor uses `state.schema`, so Word's table rules
  still apply. Unknown namespaced types become `foreignInline`, `foreignBlock` and the `foreign`
  mark (in the Word schema, holding the type and attributes, plain JSON up to 64 KiB) and are
  written back by `parseDocument`, `getDocument`, React's `onChange` and control values (one
  helper, `documentJSON`); opaque for deletion (selected first); a foreign
  node's `.docx` text rides on its JSON in memory only. Find matches a node's text as one position
  and replace refuses it (`locked`); tracked insertions and deletions of custom and foreign inline
  nodes are accepted and rejected as text. The view draws custom and foreign nodes as their text
  (`data-foli-custom`); a copy holding them carries its Foli JSON in the HTML
  (`data-foli-clipboard`) as well, read back only when that wrapper is all the pasted HTML holds.
  `@folijs/docx` maps them to `foli:`-tagged controls and back (`src/custom.ts`), a control only
  when nothing would be lost (else it stays a content control). The saved-format rule needs nothing here: custom types never change the
  version and v5 is the lowest. Tests: core `v3/extensions.test.ts` (12), docx `custom.test.ts` (6),
  view `custom.test.ts` (2), React `onChange` (1); e2e `apps/playground/e2e/extension.spec.ts` on `/extension.html`
  (typed, drawn on a later page, undone, copied and pasted into editors with and without the
  extension, a block node, saved and loaded, `.docx` both ways): 11 passed, the paste skipped in
  WebKit as the other clipboard tests, Firefox's paste now passing through the HTML. Word:
  `scripts/corpus/extension-roundtrip.mjs` with `extension-word.ps1` (the spike's harness moved),
  4 files (the sample with a block card, a 255-character tag, the sample re-exported without the
  extension, one typed through commands): Word 16.0 lists every control as written, types into a
  marked run and saves, Foli reads every node and mark back with the typed text under the mark: 4
  of 4 (2026-11-19). The spike and its Playwright project are deleted. Size: view, React and docx
  budgets raised (`scripts/size.mjs`). Shortcuts: custom marks are not drawn and custom nodes only
  as their text until 12.4's views; `renderDocument` and `exportPdf` take no extensions (a custom
  node shows its `.docx` text or `[type]`); a custom block node cannot be tracked as inserted or
  deleted; a foreign node's `.docx` text is kept in memory only (JSON saved and loaded writes
  `[type]`: keeping it would change the format); the HTML carries the whole copy's JSON on a wrapper instead of per-element `data-foli-node`/
  `data-foli-mark` attributes (simpler, and full fidelity in Firefox); schemas are cached per
  extension array (a WeakMap: an array given again must not have changed). Review of #123: no
  silent loss on `.docx` import, `onChange` and control values without foreign names, carried JSON
  only from a lone wrapper, `parseContent`'s options object, foreign types never read as Word's.)
- [x] 12.4 View extension: node views for custom nodes (measured and placed by the flow, split or
  kept whole across pages as declared), decorations (inline and node; find matches and the
  selected field move onto them where it is simpler), plugin views (mount, update, destroy) and
  their CSS; T1–T3 with a custom node in three engines; axe. (Done: `ViewExtension` in
  `@folijs/view` (`view/src/extension.ts`) extends core's `Extension` with `nodeViews`
  (`NodeView`: `render(node, { document, h })`, `split?`), `markViews` (`MarkView`: attributes on a
  marked run), `decorations(state)` (`Decoration`: `{ from, to, node?, attrs }`,
  `DecorationAttrs`) and `view(editorView)` (`PluginView`: `update(view, previous)`, `destroy()`);
  it goes to `createEditor({ extensions })` like any extension and the editor keeps the list
  (`editor.extensions`, new in core, the same on story editors), so every `EditorView` reads it;
  React's `FoliEditor` and `useFoliEditor` take `extensions`. Inline node views sit in their leaf
  span (one position, the line sized by the browser); block ones in a `div` the flow measures, and
  one that may split (the default) gives its root's children as its lines (`anyLine`: no widow
  control), each page's part drawn again and clipped, `aria-hidden` after the first; `split: false`
  keeps it whole. `h` builds elements without HTML and refuses handlers, `contenteditable`,
  `srcdoc`, the view's `data-foli-*`, unsafe URLs and script-like elements; decorations and mark
  views are checked the same way. Every run of a custom mark gets `data-foli-mark`. Decorations
  are asked on each update, compared as JSON, split per block relative to its content and made
  part of each block's key, so only blocks whose decorations changed are drawn and measured again.
  Find's matches and the selected field stay as they were (the Custom Highlight API and one
  attribute draw them without redrawing blocks: decorations would not be simpler). No CSS added to
  the view: extensions style their own classes (`docs/styling.md`). Tests: view
  `extension.test.ts` (6, jsdom): node and mark views drawn, `h`'s refusals, decorations per
  block, only changed blocks redrawn, refused attributes, the plugin view's mount, update and
  destroy. e2e `extension.spec.ts` on `/extension.html` (now a chip, a card of twelve rows, a
  topic style, "TODO" and caret-paragraph decorations, a word-count plugin view): T1 and T2 with a
  custom node, T3 as the paste test (pasted content drawn by the views), a card split across the
  page end (two parts on consecutive pages adding up to the card, broken between rows), decorations,
  the plugin view's lifecycle, axe on the whole page: 29 passed, 1 skipped (WebKit paste, as
  before) in Chromium, Firefox and WebKit; the renderers' smoke (`word-editing`, `clipboard`, `word-navigation`, `word-pages`, `word-tables`, `word-fields`): 205 passed, 8 skipped in the three engines. Keystroke cost (Chromium, 400 paragraphs, 60
  `insertText`s, median): 5.0-5.4 ms without the extension, 6.4-6.7 ms with the page's
  decorations (a "TODO" scan of the whole document per change, 400 decorations, and the word
  count): an editor without decorations does no added work. Sizes within budgets (view 109.4 of
  112.0 kB). Shortcuts: `renderDocument`, `exportPdf` and the pages' headers, footers and notes
  (until opened on their page) draw no views; a custom block in a table cell is kept whole; a
  split block's `render` runs per part; decorations cover body positions, not tables, rows or
  cells, and a block whose decorations change is measured again even when only a color changed.
  Review of #124: `h` makes only allowlisted content elements and checks `style` (no `url(`,
  `expression`, `@import`, escapes), `foli-` classes and URL lists (`srcset`, `ping`,
  `background`); decorations with refused attributes are left out and reported; a node view's
  later DOM changes are not read back (no redraw loop); `NodeView.destroy(dom)` when a drawing is
  dropped; split copies are `inert`; a throwing hook or editor listener is reported and the rest
  goes on; tests for each.)
- [x] 12.5 Commands and keymaps: commands registered by plugins and reachable through
  `editor.commands` and `editor.run`, typed; the view's own keys moved into keymaps or reserved as
  the ADR lists; a user keymap overrides each overridable built-in key; Word's keys documented per
  platform (macOS included). (Done: `PluginSpec.commands` (names to command factories) are added
  to `editor.commands` by `createEditor`, on the body's and the stories' editors, beside the
  built-in ones; `editor.run`/`editor.can` take the factory's command; `FoliCommands` (new, core)
  is the interface of `editor.commands` that apps augment (`declare module "@folijs/core"`,
  checked by the typecheck in view's `keys.test.ts` and the playground's extension page); a name
  taken twice or by a built-in command throws a `RangeError` (`__proto__` is a name like any).
  The view's overridable keys (Ctrl+Home/End with Shift, F9, Alt+F9, Alt+Down, Ctrl+Alt+F/D,
  Shift+Alt+N, Ctrl+F/H/G, F3, Shift+F3, Ctrl+Shift+F5) run where a `viewKeys` marker plugin
  (`@folijs/core/internal`) stands, after the user's and extensions' plugins and before every
  core keymap, as before them; the reserved ones (caret fixes for arrows, Escape out of a story,
  Tab after Escape or read-only, Ctrl+Shift+V, the keys of a column drag, a picture resize or a
  control pop-up, IME) stay ahead of the keymaps; in a note, Shift+Alt+N back to the reference
  yields to a binding the story's view ran. `keyName` names Alt (Option) + letter or digit by the
  physical key, as with Mod, so Option+Shift+N is `Alt-Shift-n` on macOS. `docs/keyboard.md`:
  every built-in key on Windows/Linux and macOS, its name, command and whether it is overridable
  or reserved (all keymap keys are overridable), linked from the README, getting started, api and
  architecture. Tests: core `editor.test.ts` (2: commands by name, collisions), view
  `keys.test.ts` (20, jsdom: each overridable key taken by a user keymap with the built-in not
  run, the built-ins without one, Tab after Escape reserved, a typed plugin command, `keyName`
  with Option); e2e `keymaps.spec.ts` on `/edit.html?keys=override` (every overridable key
  pressed where its built-in would act: header and footer, a drop-down control, a footnote, the
  find panel; Shift+Alt+N inside an open note) and `extension.spec.ts` (the plugin's
  `insertMention` by name, undone): 38 passed, 1 skipped (WebKit paste, as before) in Chromium, Firefox and WebKit. No regression in the suites that press keys (`word-editing`, `word-navigation`, `word-fields`, `word-controls`, `word-notes`, `word-headers`, `word-tables`, `lists`, `toolbar`, `clipboard`, `caret`, `editing`): 448 passed, 14 skipped (Chromium 154, Firefox 148, WebKit 146; the usual clipboard and IME skips), none of the known flaky ones failing. Sizes within budgets (core 82.8 of 85.9 kB, view
  110.1 of 112.0 kB). Shortcuts: the view's keys are a table in `EditorView` run at the marker,
  not a `Plugin` with a `keymap` (their commands need the view), so `editor.handleKey` does not
  run them; plugin commands are untyped unless an app augments `FoliCommands`; the macOS mapping
  (Cmd+H, Cmd+Option+D and F3 taken by the system) is documented, not checked on a Mac; ADR-0008's
  table says "dragging or resizing a picture" where the view drags column borders and resizes
  pictures. Review of #125: AltGr typing a character (AltGr+F is `[` on Hungarian Windows) is
  named by the character, so it types instead of inserting a footnote (AltGraph state, or Ctrl+Alt
  giving a character other than a–z/0–9; unit-tested, no e2e: Playwright cannot press AltGr on
  another layout); keyboard.md warns against binding Option and AltGr combos and places the
  view's after-keymap arrows apart; `BuiltInCommands` (public) holds the built-in commands and
  `FoliCommands` extends it, so a forgotten built-in fails to compile.)
- [x] 12.6 React: toolbar items added, removed and grouped (built-in items exported, a custom item
  driven by a command's dry run and `useEditorState`), menus too where they share the code;
  `plugins` stable (changing it after mount documented or supported); hooks for commands; axe and
  keyboard tests on a customized toolbar. (Done: `FoliToolbar` takes `items`, groups of
  `ToolbarItem`s (a separator between groups, an empty one left out, New comment only with
  `comments`), and `FoliEditor`'s `toolbar` takes the same groups in place of `true`. The 41
  built-in items are exported by name in `toolbarItems` (`ToolbarItemName`; camelCase names, the
  alignments' keys and classes stay `align-start`…) and the default toolbar as
  `defaultToolbarItems`; without `items` the toolbar renders as before. `ToolbarItem` (public):
  `key`, `label`, `text`, `icon` (then `label` names it), `command` (a `Command`: the built-ins'
  `(state) => Command` factories became commands), `pressed`, `enabled` (default: the command's dry
  run, `editor.can`, in the toolbar's one `useEditorState` selector; the built-ins keep their cheap
  checks), `actions` (`ToolbarAction`s: `{ key, label, command, checked? }`, the same
  `ActionMenu` as the built-in menus, dry-run on opening; a built-in menu gets more entries
  through its own `actions`). The boxes, color menus and dialogs stay the built-ins' (an internal
  `Item` extends `ToolbarItem`). App items share the built-ins' rendering: one tab stop (kept on
  the toolbar when items go away), arrows, Home, End, `aria-pressed`, `aria-disabled`, mousedown
  kept off the document's focus, `onClickCommand` on a click, ArrowDown opens a menu.
  `useCommand(command, { editor? })` and `useCommand(name, ...args)` (any named command, typed by `FoliCommands`; throws for an unknown name) give `CommandState` `{ enabled, run }`. `plugins` and `extensions` stay read
  once (ADR-0008: "take the same list once"): `useFoliEditor` compares them element by element
  and warns once outside production (`globalThis.process?.env?.NODE_ENV`, as ADR-0008's
  deprecation rule) that a new `key` is needed. Docs: api.md (toolbar items, hooks, props),
  getting started (a customized toolbar), React README, limitations. Tests: React
  `items.test.tsx` (17 after the review, jsdom: names both ways, groups and roving tabindex, a custom item's dry
  run, `aria-pressed` and focus-keeping mousedown, an icon item, a custom menu and an entry added
  to Fields, `FoliEditor`'s `toolbar`, `useCommand` by command and by name, unknown name, the
  plugins and extensions warnings); e2e `toolbar-items.spec.ts` on `/toolbar.html` (new: built-in
  items cut down and regrouped, a plugin's command as an item, a custom toggle, a custom menu,
  a `useCommand` button): items in order and axe clean with the menu open, mouse (dry run
  disables over a selection, focus and selection kept, pressed toggle, undo, the hook's button),
  keyboard only (Shift+Tab in, End, wrapping arrows, visible focus, Enter runs and keeps focus,
  ArrowDown, Escape and Enter in the menu, Tab back to the caret): 9 passed in Chromium, Firefox
  and WebKit. No regression in the suites that use the toolbar or its menus (`toolbar`, `format`, `links`, `lists`, `lifecycle`, `view-options`, `visual`, `extension`, `word-columns`, `word-comments`, `word-controls`, `word-fields`, `word-format`, `word-headers`, `word-navigation`, `word-notes`, `word-pictures`, `word-review`, `word-sections`, `word-tables`): 534 passed, 18 skipped (the usual clipboard and IME skips) of 184 per engine in Chromium, Firefox and WebKit, visual snapshots unchanged. Sizes within budgets (React 154.4 of 157.0 kB). Shortcuts:
  app items cannot be boxes, color menus or open dialogs; an item's dry run runs after every
  transaction, so its cost is the command's; changing `plugins` is warned about, not supported;
  the warning reads `NODE_ENV` through `globalThis`, which bundlers do not replace statically, so
  a bundle without `process` shows it in production too (documented as such). Review of #126:
  `useCommand` acts on the story open on its page, as the toolbar does; it keeps one command and
  selector per editor, target and arguments, so `useEditorState` keeps its answer across
  renders; `useCommand(name)` takes any name of `editor.commands`, built-in too (core keeps each
  editor's command factories; `editorCommand` in `@folijs/core/internal`; `setControlValue`'s
  became a command that dry-runs over the body and its stories); `ToolbarItem` is a union of
  `ToolbarButton` (`command`, `pressed`) and `ToolbarMenu` (`actions`), the built-in menus typed
  as menus, and `checked` takes `(state, editor)` like `pressed`; a menu without entries is
  disabled and never opens; inline `items` of the same items reuse the selector; two items with
  one key warn in development; tests for each, and for no dry run by the default toolbar.)
- [x] 12.7 Performance tracking: the layout, keystroke, find, `.docx` import and export and PDF
  benchmarks with stored baselines per engine and machine, thresholds, a summary that fails on a
  regression, run where ADR-0008 says; `docs/benchmarks.md` rerun for 1.0 with method and hardware.
  (Done: `pnpm bench` (`scripts/bench.mjs`) builds, runs each benchmark 3 times (`--runs`) and
  compares each metric's median with `bench/baselines/<machine>.json`: per engine and metric the
  median, a relative `threshold` and a `floor` in ms (both must be passed: whole-millisecond clocks,
  a frame of waiting), the hardware and browser versions; prints a table, writes
  `test-results/bench.json`, exits 1 on a regression; `--update` records (keeping tuned
  thresholds, replacing only the engines run, with their dates), no baseline prints the numbers and
  how to record one and fails. The machine is its platform plus a hash of host name, CPU, cores and memory (`--machine` or
  `FOLI_BENCH_MACHINE` to name it). Metrics, 51 in all: layout, re-flow and the keystroke handlers'
  p50 at 100 and 200 sections in Chromium, Firefox and WebKit, paint p95 in Chromium and Firefox
  (WebKit's software painting swung 2× between runs); the find panel (new
  `apps/playground/bench/find.bench.ts`, the 11.11 document and queries) in the three engines;
  `findAll` (20 calls per sample), `.docx` import and export of the 9 corpus files in Node (built
  packages); `exportPdf` of them in Chromium. Thresholds from two full runs of the same code:
  browser medians within ±30%, so paint and handlers ±50% (8 and 1.5 ms floors), layout and
  re-flow ±40%, find ±50%, PDF ±40%; Node's `.docx` medians took 53-92 ms between invocations, so
  `.docx` and `findAll` ±60%. Not in `pnpm check`; contributing's release steps run it before each
  release. The bench config has its own port (5177) and never reuses a server. Tests:
  `scripts/bench.test.mjs` (9: medians, machine id, options, `BENCH` lines to metrics, WebKit
  paint left out, comparison with threshold and floor, table, update keeping thresholds). Baseline
  `win32-5f39f6c2` (the owner's i7-13700H laptop, on mains power, 2026-11-20): Chromium at 100
  pages layout 110 ms, type handler p50 11.4 ms, Enter 12.9 ms, re-flow 131 ms (Firefox layout
  151 ms, WebKit 204 ms); find panel 16 ms (Chromium, Firefox) to 46-62 ms (WebKit); `findAll`
  ≤ 0.5 ms; the corpus imports in 53-72 ms, exports in 65-80 ms, prints to PDF in 537 ms. On battery the
  same code measured 1.5-2× slower. Found: a keystroke's handler costs 3.3-3.5× and the first
  layout and re-flow about 2.2× what 0.2.0 did (each release's checkout run in one session on
  mains, 3 runs each: mostly from Phase 8, the layout's in 8-10, none from Phase 12), so the
  Phase 5 targets are missed at 100 pages; not investigated here (12.11). Rust/WASM: no benchmark
  shows a need (the cost is the view's DOM work and the browsers' layout). Shortcuts: the browser
  benchmarks run on the dev server as before; the 1-50-section and list documents stay in
  `pnpm bench:layout` only; model build and block type change stay in core's Vitest bench, untracked. No changeset: no published package
  changed. Review of #127: a baseline metric not measured, or a median that is no number, fails
  (`MISSING`) and `--update` refuses no number; `findAll` timed 20 calls at a time; the machine id
  hashes memory in GB (the baseline renamed); no baseline fails; dates and runs kept per engine;
  `--machine` may not start with `-`; tests for each (10).)
- [x] 12.8 Docs site: `apps/site` gets the docs (getting started, guides, API reference from the
  12.2 reports, limitations, changelog), built from `docs/` so they do not drift, with live
  examples (the editor, a custom node, a plugin) and search if the tool gives it; keyboard-usable
  and axe-clean; deployed where ADR-0008 says, with the owner's approval.
  (Done: `apps/site/src/docs/build.ts`, called by `vite.config.ts` before Vite reads its inputs,
  renders the 30 pages of `src/docs/nav.ts` with `marked` 18.2.1 (MIT, no dependencies, a
  devDependency of the private site) to static HTML in `apps/site/docs/` (git-ignored), each a Vite
  input at `/docs/…/`: getting started, limitations, styling, keyboard, document model,
  pagination, `api.md`, architecture, contributing, benchmarks, roadmap, the testing notes and the
  eight ADRs from `docs/`; one API page per package from its `api-report.d.ts` (each entry's
  exports, then every declaration by source file with its doc comment, tagged `internal` or `not
  exported`); the five changelogs on one page; three live examples (`src/examples/*.md` + `.tsx`,
  the page showing the script it runs): `FoliEditor`, a custom inline node with a node view and a
  toolbar button inserting it, a plugin with a command, a key (Ctrl+Shift+O), a toolbar button and
  decorations. Heading ids as GitHub makes them; a relative link to a page goes to the site, to any
  other file to GitHub; a link to a missing heading fails the build (found one:
  `document-model.md` → `architecture.md#editing-engine-folicore`, fixed); raw HTML in the
  markdown is shown as text. Search: the build
  writes `search.json` (headings h1–h3 and API names, 67 kB, 11 kB gzipped), fetched on first use,
  results built with `textContent`.
  Dev rewrites the pages when a markdown file, changelog, API report or example changes. The
  landing's Docs and limitations links now go to `/docs/`. Bundle: `dist` 0.95 → 2.4 MB, of which
  1.35 MB the 30 pages (`/docs/api/core/` 240 kB, 55 kB gzipped); docs script 1.2 kB, CSS 4.6 kB;
  the examples (1 kB each) share the editor chunk with `/test/`; the landing unchanged. Tests:
  `src/docs/build.test.ts` (4: ids, links, raw HTML, report parsing) and `apps/site/e2e/docs.spec.ts`
  (a `site` project on port 5178 in `playwright.config.ts`; 22 tests: every nav page opens marked
  current, links, API pages, search, skip link and nav by keyboard, axe on 7 pages and the 3
  examples, light and dark, no sideways scroll at 375px, the nav folded there): 65 passed, 1
  skipped (WebKit's Tab reaches no link, Safari's default) in Chromium, Firefox and WebKit. Not
  deployed: contributing.md "The site" says how the owner builds and uploads `apps/site/dist/`
  (how Cloudflare gets the files is set up outside the repository and not known here; corrected
  in 12.12: a Cloudflare Pages project connected to the repository builds every push and
  publishes `main`, so the site went live with each merge).
  Shortcuts: no syntax highlighting; code wraps instead of scrolling; search matches substrings of
  headings and API names only, not body text; the API pages show each declaration's `.d.ts`
  text, not a typed model of it (two doc comments in a row would merge into the code); a page
  dropped from the nav stays in `apps/site/docs/` in dev until deleted (never built); a new page
  needs the dev server restarted. No changeset: no published package changed. Review of #128:
  links and images with a scheme other than http, https or mailto render as text, relative images
  link GitHub's raw file; a broken link saved in dev is logged, not fatal to the server; a
  malformed relative URL names its file; headings with inline HTML get GitHub's ids; the skip link
  tested in WebKit too (focused directly); a `site-build` project runs three pages on the built
  site (`vite preview`, port 5179); 6 unit tests; 77 passed and 1 skipped in three engines.)
- [x] 12.9 Guides: extensions (a custom node, a mark, a plugin, a command, a keymap, a toolbar
  item), theming (CSS variables, dark, print, forced colors; a theme example), migration from 0.x,
  the deprecation policy, contributing (setup, architecture tour, where things live, tests and
  harnesses, the release), `docs/limitations.md` reviewed for 1.0. (Done:
  [`guides/extensions.md`](guides/extensions.md) (an inline mention with a node view, a topic
  mark with a mark view, a block card that splits across pages, a plugin with state,
  `appendTransaction`, `filterTransaction`, decorations and a plugin view, named commands with
  `FoliCommands` and `useCommand`, a keymap taking Ctrl+F and the reserved keys, a toolbar
  button, a menu and an entry added to Controls, JSON and `.docx` with and without the
  extension, what `h` refuses and what is trusted); [`guides/theming.md`](guides/theming.md)
  (where to set the variables, a complete theme, dark with paper pages or dark pages, print,
  forced colors, extension content; the dark theme and forced colors moved out of
  `styling.md`, which stays the reference); [`guides/migrating-from-0x.md`](guides/migrating-from-0x.md)
  (documents v1–v5, install lines with the exact peers, the 0.6 → 1.0 changes from the pending
  changesets, each older minor's breaks); [`deprecation.md`](deprecation.md) (what is public,
  semver, deprecation, the saved format promise with ADR-0008's open point); all in the site's
  nav. The samples are the files of `apps/site/src/guides/` (typechecked with the site);
  `guides.test.ts` fails when a `ts` or `tsx` block of `docs/guides/*.md` is in none of them,
  runs the extension samples (commands by name, a key, the lock, "(c)", decorations, JSON and
  `.docx` round trips, foreign without the extension) and checks that the theming page names
  only the stylesheet's variables. Contributing: `playwright install`, where things live, a
  keystroke from keydown to listeners, tests and harnesses (unit, e2e projects, visual, examples,
  API reports, sizes, benchmarks, the corpus and Word harnesses, the manual checks), the missing
  commands, the bump rule from 1.0. Limitations: as of the 1.0 work, an "Extensions, keys and
  the toolbar" group (with 12.3's clipboard wrapper and schema-per-array shortcuts, which were
  missing), the plugin API no longer called unstable, 12.7's layout and keystroke numbers in
  place of Phase 5's, a "Docs and tooling" group; the v1 note dropped (not a limit). Stale and
  fixed: architecture's diagram (a Rust box for `.docx`; now `@folijs/docx` and `@folijs/pdf`)
  and "target design" heading, `@folijs/docx`'s README (a dependency, now a peer), README's
  `pnpm check` line and docs list, getting started's links. Site e2e: 80 passed, 1 skipped
  (WebKit's Tab, as before) in three engines, the extensions guide added to the axe pages.
  Shortcuts: CSS samples are not checked beyond the variable names; the React sample is
  typechecked, not run. No changeset: no published code changed (`@folijs/docx`'s README only).)
- [x] 12.10 Examples: an extension example (custom node, mark, plugin, toolbar item, saved to
  `.docx` and read back) and a framework-free one (`@folijs/view` without React) in `pnpm examples`
  from tarballs in three engines; the Next.js and Vite examples updated to the stable API. (Done:
  `examples/extension` (Vite 8, React 18.3, TypeScript 5.9 strict): a mention (custom inline node
  with a node view), a topic (custom mark with a mark view), a plugin with the `insertMention`
  command (typed through `FoliCommands`), Ctrl+Shift+M and "TODO" decorations, two toolbar items
  after `defaultToolbarItems`, Save `.docx` (`exportDocx` with the extensions, in the browser, a
  download) and Open `.docx` (`importDocx`, `editor.setDocument` through `FoliEditor`'s handle).
  `examples/vanilla` (Vite 8, TypeScript 5.9 strict, no framework; only `@folijs/core` and
  `@folijs/view` installed): `EditorView` on a `div`, buttons for bold, italic, bullets, undo and
  redo (commands, `aria-pressed`, undo and redo disabled by dry runs), autosave to `localStorage`,
  JSON saved to and loaded from a text box (a bad document refused). Both in `pnpm examples`
  (installed from the tarballs with npm, typechecked over the published types, built) and in
  `playwright.examples.config.ts` (ports 5182, 5183; each app runs only its specs). e2e:
  `extension.spec.ts` (type, a mention by the toolbar item and by the key, undo, the mark from its
  item, the decoration, axe, `.docx` saved, the page reloaded and the file opened: mention, mark
  and decoration back, no console errors); `success.spec.ts` now also on the vanilla app (its
  toolbar check is a Bold button, in either app); `vanilla.spec.ts` (the buttons, JSON save and
  load, a bad document refused, axe). The Vite and Next.js apps already used only stable public
  API (`FoliEditor`, `initialContent`, `onChange`, `placeholder`, `createDocument`,
  `parseDocument`, the stylesheet; `@folijs/view` and the exact peers installed); the smoke test's
  stale "schema v3" wording fixed. `pnpm examples` on 2026-11-20: the four apps install and
  build, the SSR and DOCX checks pass, 27 passed and 6 skipped (the Next.js server-HTML test
  outside Next) in Chromium, Firefox and WebKit. Found: with TypeScript 5.9 (strict) the
  guide's decorations pattern did not compile, `doc.descendants` taking a callback typed
  `boolean | undefined` (TypeScript 7, used in the repository, accepts one without `return`);
  fixed in core (`Node.descendants`, `Node.nodesBetween`, `Fragment.nodesBetween` take
  `boolean | void`; API report updated, changeset `node-callbacks-void`). Docs: examples README (a table of
  the apps and their tests), getting started, the extensions guide, architecture, contributing
  and README link the new apps. Shortcuts: the vanilla app styles pages with a few rules of its
  own instead of `@folijs/react`'s `styles.css`; no copy and paste, block node or
  built-in key override in the example (the playground's `extension` and `keymaps` specs cover
  them); the `.docx` is checked by reading it back in Foli, not in Word. Review of #130: Save
  `.docx` reports a failed export instead of an unhandled rejection, and a file that is no
  `.docx` is refused with the document kept (tested); `exportDocx`, `DocxPackage.write` and
  `exportPdf`'s `pdf` are typed `Uint8Array<ArrayBuffer>` (TypeScript 5.7+'s `Blob` refused
  `Uint8Array<ArrayBufferLike>`: the `as BlobPart` casts in the site, playground and example
  are gone; `DocxPart.data` stays `Uint8Array`, as it may view the caller's buffer), the
  published types need TypeScript 5.7+ (getting started, migration guide; changeset
  `bytes-array-buffer`); the migration test also fails on console errors; `insertMention` sets
  `closeHistory` so the mention is its own undo step (the guide's sample too), in place of a
  600 ms wait; the vanilla app reads storage inside its `try`. `pnpm examples` again: 27 passed,
  6 skipped (one run before it lost both vite-firefox tests to Firefox hanging on a reload, with
  Juggler and graphics errors in its log; the app was unchanged and the next run passed).)
- [x] 12.11 1.0 readiness: every 0.x format (v1–v5 fixtures) loads and saves without loss; the
  limitations the owner picks as 1.0 blockers fixed, the rest listed; a security pass (paste,
  links, `.docx` and zip limits, pictures, `exportPdf` input); the ADR-0003 manual checks run or
  accepted again by the owner as 1.0 risks; `pnpm examples`, the corpus harnesses and the e2e
  suite green in three engines; investigate the keystroke and first-layout cost added in Phases
  8–11 (12.7) and decide with the owner whether it blocks 1.0. (Done: the owner decided on
  2026-11-20 (recorded in 12.11's `release-1.0-decisions.md`, folded in 12.12 into ADR-0003,
  ADR-0008, limitations, benchmarks and the 1.0.0 release notes): pictures
  losing their images when copied into another document fixed before 1.0, every other limitation
  shipped as a documented known limit; the performance does not block 1.0 (the missed Phase 5
  targets stated in limitations and the release notes, the incremental redraw for a 1.x minor);
  the ADR-0003 manual checks accepted again as 1.0 risks (ADR-0003, limitations); ADR-0008's
  format point accepted (ADR-0008, deprecation.md); GitHub's private vulnerability reporting
  enabled. Formats: a fixture per 0.x version saved by the release that wrote it
  (`packages/core/fixtures/formats/`: v1 by 0.1.0, v2 by 0.2.0, v3 by 0.3.0, v4 by 0.5.0, v5 by
  0.6.0; `generate.mjs` compiles each release's core and docx from its tag and reproduces the files
  byte for byte), loaded, saved through an editor (canonically equal; v3 to v5 equal to the file
  but for the version; v1 and v2 every character, and their migrated documents as reviewed golden
  files) and through `.docx` (`formats.test.ts` in core and docx). Found: a v3 document read from
  a `.docx` could not be exported (its table styles' parts were never in the model; written as
  read now, a changed part still refused). Security: `docs/security.md` (threat model, what is
  checked where, the app's part, residual risks, reporting); no XSS found (paste, clipboard JSON,
  links, zip, XML entities, pictures, `exportPdf`, `h`, the site). Found and fixed: a `.docx` of a
  few kilobytes exhausting memory (13 KB of empty paragraphs took 2 GB, 64 MB of XML crashed
  Node): `maxNodes` counts every element, attribute, text, comment and instruction across a
  package, a paragraph four (the review of #131 found comments and attributes uncounted), default
  4 000 000 from measurements: a 659-page Word document of dense tables (made with Word, 250
  tables of 30 × 5) counts 1.9 million and peaks at 0.8 GB, the costliest crafted file at the
  limit at 2.3 GB and 12-28 s depending on heap headroom; and an import quadratic in a paragraph's length (custom controls'
  scan: 200 000 line breaks took 18 s, now under a second). Pictures copied into another document
  bring their images (a copy carries its pictures' resources, an object URL's as a `data:` URL
  read from the drawn image; a paste adds them under keys of their own; the HTML carries them for
  Firefox): core and view unit tests, e2e copying 07 into another page in Chromium and Firefox
  (WebKit skipped as every clipboard test). Performance: profiled in Chromium at 100 sections;
  list numbers resolved every paragraph's formatting on each keystroke, now only numbered ones,
  and `FoliComments` skips its scan without comments: measured A/B on one machine (slowed 25-45%
  that evening, so the baseline was not updated: rerun `pnpm bench --update` on a quiet machine
  before 1.0.0), Chromium handler p50 17.1 → 8.0 ms typing and 22.8 → 14.8 ms Enter at 100
  sections, 34.9 → 17.8 and 40.6 → 19.2 at 200, Firefox 18 → 11 and 19 → 14 at 100; first layout
  and re-flow unchanged (the browser's layout of every page; options in `benchmarks.md`). Flaky:
  five unit runs beside the e2e suite found the tracked-changes property test failing on a seed
  (a known difference now compared without paragraph properties) and two `.docx` tests past their
  timeouts (raised); the full e2e run's five failures (Firefox print, WebKit) passed 3 of 3 when
  rerun (contributing.md). Runs on 2026-11-20: `pnpm test:e2e` 993 passed, 82 skipped, 5 failed
  then passed (1,080 tests, three engines); `pnpm examples` 27 passed, 6 skipped; the Word
  harnesses: extension 4 of 4, find 9, fields 24, pictures 4, sections 4, tables 10, stories 24,
  review 9 checked, controls 9 of 9 after its imports were fixed (names 12.2 made internal),
  rewrite 37 opened and the 27 without edits equal to Word's reference; `pnpm corpus:pages` as
  0.6.0: 158 of 158 paragraphs on Word's page, 142 on its line, 277 of 280 cell paragraphs.
  Changesets: `v3-table-styles-export`, `docx-element-limit` (minor: `maxNodes`),
  `keystroke-list-markers`, `picture-copy`. Shortcuts: the node limit bounds a crash, not a
  server's budget (security.md); a picture the source view does not show still pastes without
  its image, and one from an object URL comes as PNG; the table-style fix is not gated on the
  version (a v3 document saved again says v5), so clearing all four parts of a read style writes
  them as read.)
- [x] 12.12 Close: docs as of 1.0 (README, architecture, api, ADR-0008's outcome), size budgets,
  the acceptance checked, the 1.0.0 changeset and version PR; publish with the owner's approval.
  Fold `docs/release-1.0-decisions.md` (12.11) into the roadmap, limitations and release notes.
  (Done: docs as of 1.0.0: README (status, what 1.0 promises, the known risks, the docs site and
  guides), api.md (stable under 1.x semver, exact peers since 1.0.0), architecture (budgets, the
  published site, React's API stable), ADR-0008's status and outcome, limitations (the owner's
  decision that every limit ships, 1.0's speed numbers), benchmarks (1.0 numbers, bundle sizes),
  getting started and the migration guide, contributing (the site published, two flaky tests),
  the five package READMEs (stable since 1.0.0, the docs site), `@folijs/docx`'s and
  `@folijs/pdf`'s published as the site's DOCX and PDF guides (`nav.ts` takes a `title`; a
  package README's page is `/docs/guides/<name>/`); the deploy documented as it is (Cloudflare
  Pages builds every push and publishes `main`); `release-1.0-decisions.md` folded
  into ADR-0003 and ADR-0008 (already recorded there), limitations, benchmarks and the release
  notes, and deleted (the site's nav never had it). Budgets unchanged: the only Phase 12 raise
  (12.3: view, React, docx) has its reason in `scripts/size.mjs`, now with the sizes at the close
  (core 82.9, view 110.8, React 155.3, docx 58.0, pdf 17.2, pdf's renderer 84.7 kB gzip). Bench:
  `pnpm bench` on mains with no heavy process, first run 12 regressions in Node and Chromium only
  (2-3× throughout: the machine), rerun passed all 51 metrics (keystroke handlers 15-31% faster
  than 12.7's baseline), `--update` run again with Chromium's re-flow at 200 sections past its
  threshold (+110%, the rest within), so the baseline was written from the passing run's
  medians; that metric's tolerance kept (benchmarks.md, "Thresholds"). Acceptance checked
  (above). The 1.0.0 changeset (`.changeset/release-1-0.md`, major for the five packages: the
  promise, Phase 12's highlights, the known risks, the missed targets with numbers, the migration
  guide); `changeset status` plans 1.0.0 for all five. The version PR (#133); 1.0.0 published
  2026-11-20 by the Release workflow with the owner's approval, README's status switched after.)

## Phase 13 — Agent library (`@folijs/agent`) · M → agent 0.1.0

A library an LLM agent uses to read and edit a document without computing positions: the
document as text with a handle per block, a few coarse operations, every edit a tracked change
in the agent's name that a person accepts or rejects in Foli or in Word. Background, and what
was tried: [explorations/agent-editing.md](explorations/agent-editing.md). Planned 2026-11-21;
what is built is ticked under Tasks.

Decided with the owner on 2026-11-21: the MCP server is a separate package (`@folijs/mcp`, Phase
14, planned when this phase closes), because it follows the MCP SDK's releases and needs Node,
files and stdio, while this package stays pure. Not in this phase: the MCP server, `run(code)`
(code mode), the hint highlight (After 1.0), accepting or rejecting changes (the agent proposes,
a person decides), inserting tables and pictures, headers, footers and notes, steps as JSON.

**Starts from (1.0.0):** the headless editor does every edit an agent needs, but by integer
positions and the selection. `createEditor({ document, author, trackChanges })`; commands on the
selection (`setParagraphStyle`, `addComment`, `insertText`, `setControlValue`…); `findAll` and
`replaceAll` over the model; `documentOutline` (headings only, with positions);
`paragraphStyles`, `controlValues`, `updateFields`; `rejectAllChanges(author)`.
`editor.subscribe` gives each change's transactions and a `Transaction` has its `mapping`, so a
position held outside the editor can follow edits. Paragraphs imported from Word keep
`w14:paraId` as an unknown attribute, but paragraphs Foli creates get none and a paste drops
them (export writes only the ones comment threads need), so it cannot identify a block.
`@folijs/docx` imports and exports in Node with no DOM.

**Acceptance:** `@folijs/agent` depends on `@folijs/core` only (an exact peer, as ADR-0008 has
the other packages) and loads with no DOM and no Node built-ins (checked by a test); a session
over a document gives its body as text, one block per line group with a handle, the paragraph's
style, its list number and its text, tables with their cells' paragraphs as blocks, and what
Foli does not model shown as a placeholder that cannot be edited; a handle issued by one read
still names the same block after any of the session's edits, and a handle whose block is gone is
refused by name; the operations (replace text in a block, insert paragraphs before or after a
block, delete a block, set a block's style, comment on a block or on text in it, list and fill
content controls, update fields) each refuse with a message a model can act on (no match, three
matches, unknown style with the styles that exist) and never by throwing a position error;
every edit is a tracked change by the session's author; three tasks written as a model would
call them pass on corpus documents through `importDocx` and `exportDocx`: fill a template's
controls, redline a contract (replace, insert and delete clauses, comment), restyle headings;
for each, `rejectAllChanges(author)` on the result gives back the input document, or what
differs is listed in limitations; Word opens each result and shows the changes under the
agent's name (the Word harness); the API report, size and package checks of `pnpm check` cover
the package; README, `api.md`, `architecture.md` and the site document it, with a system-prompt
snippet for the handle format; 0.1.0 published with the owner's approval, as 0.x: outside
ADR-0008's 1.0 promise until Phase 14 has used it. (Checked 2026-11-21, Word 16.0.20625 on
Windows, `pnpm check` green with 75 tests in the package: its only dependency is `@folijs/core`,
an exact peer; no DOM and no Node built-ins, checked by its build (`lib: ["ES2022"]`, no
`types`) rather than by a test; `read` gives the body a line per block with handle, table
place, style, list number, changes, comments and text, tables before their cells' blocks,
what Foli does not model as `not editable`; a handle names its block through the session's
edits, undo, and accepting or rejecting them (a property test of 200 runs of tracked edits
made on the session's editor, and the operations' own tests; the handle is the
block's end, Word's paragraph mark), and a handle whose block is gone is refused as `gone`;
`replaceText`, `insertAfter`, `insertBefore`, `deleteBlock`, `setStyle`, `comment`, `controls`,
`fillControl` and `updateFields` return values, a refusal with a code and a message, and do
not throw on wrong arguments or a null options object; every edit is a tracked change by the author (comments are
comments, as in Word); the three tasks pass through `importDocx` and `exportDocx`
(`scenarios.test.ts`), with a fourth on a document Word's reviewers had redlined; rejecting
the agent's changes gives the content back exactly for the redlines and the restyling, and
with differences in two places, listed in limitations: a filled control and a rebuilt table
of contents, both core's; Word opens the three results and shows every change under the agent's
name, its accepted and rejected text Foli's (`agent-roundtrip.mjs`, 3 of 3); the API report,
size (72.4 kB gzip with core, budget 75.7) and publint are in `pnpm check`; README, `api.md`,
`architecture.md` and the site document it, the README with a system prompt for the handle
format. Each task merged after an agent's review (#138–#143, this one #144), which found and
had fixed: the
package about to be published by the next 1.x release; handles moving to another block when a
deleted paragraph was accepted; a nested table deleted in place of its table; inserts into a
locked content control; a section break deleted with its empty paragraph; a restyle reported
done in a locked control; a control filled by another's name; a Word harness that compared
none of the edits' text. 0.1.0 published 2026-11-21 with the owner's approval (13.8).)

### Tasks

Each task is a PR on `phase-13/agent`, the build green after each.

- [x] Claim phase, branch `phase-13/agent`
- [x] 13.1 Package: `packages/agent` as `@folijs/agent` 0.0.0, core as its exact peer, the
  `@folijs/source` condition, in `scripts/` (`PACKAGES` of the API report, size, package checks)
  and the changeset config; typechecked without the DOM lib and without Node's types, so a
  stray import fails the build. `openSession(document, { author })` over a tracking
  `createEditor`, `session.document()` for export. Record here why 0.x. (Done: the
  package builds with `lib: ["ES2022"]` and no `types`, so the DOM and Node fail its build;
  tests are typechecked with Node's types, as they read the corpus. `openSession` returns
  `{ editor, author, document() }`: the editor is exposed for what the session has no operation
  for. `author` is required. Not in changesets' `fixed` group: it versions on its own. Why 0.x:
  the operations are shaped by the first real tool calls, which come with Phase 14, and ADR-0008
  forbids changing a 1.x API; the peer on core is exact all the same. Size 56.2 kB gzip with
  core, budget 60.5 kB. `private` until 13.7: otherwise the next release of the
  1.x packages would bump and publish it, as their dependant.)
- [x] 13.2 Reading and handles: `session.read()` (the whole body, or from a handle for a number
  of blocks, so a long document can be read in parts) and `session.block(handle)`. Decide and
  write down the text format (a line per block: handle, style, list number, text; cells nested
  under their table), how existing tracked changes and comments by others show (as Word's
  final text, with a mark that the block has changes), and what a placeholder says. Handles are
  session ids (`b1`, `b2`…) on block start positions, moved through each transaction's
  `mapping` from `editor.subscribe`; a block made by an operation gets a handle the operation
  returns. Property test: random operations, every live handle still resolves to its block. (Done:
  `session.read({ from, limit })` gives `{ text, blocks, next }` and `session.block(handle)`
  one block; both return a value with `ok`, a refusal carrying a `code` and a message. The
  format, a line per block: `[b7] Clause, 1.1, changed, 2 comments: text`; in a table
  `[b5]   r1 c1, Normal: Item` under `[b4] table, 3 rows, 2 columns`; what Foli does not model
  `[b9] not editable: <what>`; a line break in a paragraph as ↵; a bullet as • whatever its
  font's character. The text is the document with every change accepted (the session's editor
  is in the `final` review view, so find agrees): deleted text and hidden text are left out, as
  are field codes; a paragraph, row or table deleted as a tracked change is not read.
  Shortcut: a paragraph whose mark is deleted but that keeps text is its own block,
  where Word joins it with the next. Styles and list numbers come from core's resolver
  (`@folijs/core/internal`). What is not text stands in brackets, where find stops too:
  `[picture]`, `[note]`, `[page break]`, `[empty: Offer date]` for a control showing its
  placeholder. A paragraph whose deleted mark joins it to the next is not numbered apart, as in
  the view; one that cannot join (before a table, the last one) is still read. A handle is the
  position after its block, its two sides moved through each transaction's mapping: a
  paragraph's closing is Word's paragraph mark, which is what a paragraph is there. So Enter
  leaves the handle on the text after the caret (the text before gets a new mark), a paragraph
  joined with the next loses its handle, and accepting a deleted paragraph or rejecting an
  inserted one leaves the blocks around under theirs. (First built on the position before the
  block; the review of #139 showed accepting a deletion moved the dead handle onto the next
  block.) `setDocument` forgets every handle; a block removed and brought back by undo comes
  back without its own. Property test, 200 runs of up to 25 random tracked edits and undos: no
  handle out of order at any step; then either `rejectAllChanges(author)` gives back every
  block under its first handle with its first text, or `acceptAllChanges` leaves the read text
  whole with every block under a handle it had.)
- [x] 13.3 Editing text: `replaceText(handle, find, replacement, { all })` (refuses on none, or
  on several without `all`, saying how many), `insertAfter` and `insertBefore(handle, paragraphs)`
  (text and an optional style each), `deleteBlock(handle)`. Each returns what changed in the
  read format, so the model need not read again. Refusals as values, not exceptions. (Done:
  `replaceText` goes through core's `findAll` and `replace` with capitals counting, kept to the
  block's range, so it finds what `read` shows and nothing deleted; ↵ and `\n` are a line break
  in `find`, the replacement and new paragraphs; it returns how many places were replaced and
  how many could not be, and records nothing when the replacement is the text there.
  `insertAfter` and `insertBefore` take one paragraph or a list, each a string or
  `{ text, style }`, next to any block. A new paragraph is formatted as Enter there gives in
  Word (core's `splitAttrs`): the neighbour's properties and controls without its mark's own
  (section break, revisions, `w14:paraId`), or after a paragraph whose style names another as
  the next (a heading) that style; one that names a style has only that style. A style is named
  by name or id, capitals not counting; a built-in heading the document lacks is added, as a
  second change. Nothing is inserted into a locked content control. `deleteBlock` takes a
  paragraph (a whole-node delete, which tracking records) or a table (`deleteTable`, the caret
  in the table's own first cell). A paragraph that must stay is emptied and the result says
  why: the last of the body or of a cell, one before a table or other block (its mark could not
  join, so accepting would leave it), one that ends a section. The session's own inserted
  paragraph there is removed for real. A block in or holding a locked control is refused as
  `read-only`. Each returns the blocks as they read now, in `blocks` and `text` (`deleteBlock`
  a sentence). A block deleted as a tracked change is `gone` to every operation. Arguments of
  the wrong type are refused as `invalid`, not thrown. Tests reject the agent's changes after
  each operation and compare the read, handles included, with the first. Found by the review of
  #140 and fixed: a table whose first cell starts with a table had the nested one deleted;
  inserting next to a locked control's paragraph went in; a heading's new paragraph was a
  heading; a section break went with its empty paragraph. Not fixed here: core's control filter
  lets a paragraph into a locked block control (`allowed()`, `state/controls.ts`).)
- [x] 13.4 Style and comments: `styles()`, `setStyle(handle, name)`,
  `comment(handle, text, { on })` (`on`: text in the block to anchor to; the whole block
  without it). (Done: `styles()` gives the names `read` shows, the document's and
  Word's Heading 1 to 3 where it lacks them (core's `paragraphStyles`). `setStyle` runs
  `setParagraphStyle` with the caret in the block: a tracked paragraph formatting change, the
  direct formatting kept; no change when the paragraph is in the style already. `comment` runs
  `addComment` over the block's content, or over `on`, which must be in the block once; a line
  break in the text starts a new paragraph of the comment; it returns the comment's id. A
  comment is not a tracked change, as in Word: rejecting the session's changes leaves it. Both
  refuse a table or other block as `not-a-paragraph`. From the review of #141: `setStyle` said
  yes in a locked block control while the document's rules dropped the change; it now looks at
  the document after and refuses as `read-only` (a paragraph that only holds a locked inline
  control is restyled). Comments carry the author's initials. A comment in a locked control is
  made, as in Word.)
- [x] 13.5 Templates: `controls()` (tag, title, kind, value, the block it is in),
  `fillControl(tagOrTitle, value)`, `updateFields()`. A read-only control is refused by name. (Done: `controls()` gives the body's
  content controls in order: `name` (the tag, else the title, else the id: what `fillControl`
  takes), kind, value, whether it still shows its placeholder, a list's items, whether it is
  locked, and the handle of the block it is in. A read shows an unfilled one as
  `[empty: Offer date]` (13.2). `fillControl(name, value)` matches the id, else the tag (every
  control with it), else the title, capitals not counting, and runs core's `setControlValue`:
  text, a list's item, `yyyy-mm-dd`, true or false; null empties. Refused with what would work:
  the controls there are, a drop-down's items, true or false for a check box, `read-only` for a
  locked one. `updateFields({ data })` runs core's `updateFields`: `data` fills merge fields
  (`«Name»` in a read); the result counts what changed and names the merge fields left without
  data and the fields skipped with why (page numbers need a layout the session does not have).
  All tracked. Size 72.0 kB gzip with core (field updates are most of the growth), budget
  75.7 kB. From the review of #142: a control has its `id`, which `fillControl` matches before
  tags, so a control without a tag, or one of several sharing a tag, can be filled alone;
  controls sharing a name that do not all take the value give `unfilled` with why, and each
  reads "true" its own way; a control in a block deleted as a tracked change is not listed;
  a value the control has records nothing; a day that does not exist is refused, other text in
  a date control is kept as typed; merge fields without data are named once, by core's own
  matching (capitals not counting); page numbers left are said in words.)
- [x] 13.6 The three tasks and the tracking check: tests that import a corpus `.docx`, run the
  calls a model would make, export, and import again; `rejectAllChanges(author)` compared with
  the input for each; the results opened in Word by the harness. Fix what they find in the
  operations; write the rest in limitations. (Done: `scenarios.test.ts` runs each task as a model would,
  picking handles off the read's lines: the offer letter's controls and merge fields filled
  (03), the NDA redlined (01: two replacements, one first refused for several matches, a clause
  inserted, a clause deleted, a comment on replaced text), the agreement Word's reviewers
  already redlined edited again with their changes left (02), the board report's seven
  headings moved a level down and its table of contents built again (04). Each is exported,
  imported again and read: the same as the session's read, every new change the agent's. Then
  the agent's changes are rejected and its comments deleted: the read is the input's in all
  four, and the content is the input's exactly in 01, in 02 and for the restyling of 04. What
  differs (limitations.md): in 03 a placeholder that comes back has lost the run properties
  kept verbatim for it (`w:lang`) and the date control keeps its date in its properties; in 04
  the entries of the rebuilt table of contents come back without their `w14:paraId` and the
  tab stops kept in `ext`. Both are core's (control values and field updates under tracking),
  not the agent's operations. The envelope (styles, numbering, comments, controls, stories) is
  the input's too, but for that date; and for 01 and 02 the file written after the reject reads
  as the input written. Word: `scripts/corpus/agent-roundtrip.mjs` makes three documents
  through the package (04 with its table of contents built again) and checks what Word reads
  with `word-review.ps1` (corpus/README.md). 2026-11-21, Word 16.0.20625: 3 of 3 open without
  a repair prompt; every revision is the agent's and of the task's kinds (9, 6 and 19: Word
  shows adjacent restyled headings as one); Word's insertions, deletions and restyled
  paragraphs hold the texts the tasks wrote and removed; the comment is there; Word's text
  with every change accepted and with every change rejected is Foli's paragraph by paragraph.
  From the review of #143: the harness compared no text of the edits themselves (their
  paragraphs hold fields and were set aside) and passed on a paragraph count that differed;
  the tests' "nothing else differs" stripped more than the known differences.)
- [x] 13.7 Docs: README (also the site's guide), `api.md`, `architecture.md`,
  `limitations.md`, the exploration note marked with what was built, acceptance checked above.
  (Done: the README has the read format, every operation, the templates and a system prompt
  for the model; it is the site's guide `/docs/guides/agent/`; `api.md`, `architecture.md`
  ("Agent editing"), `limitations.md` (13.6), `benchmarks.md` (the bundle), `contributing.md`
  and the exploration note say what was built. From the review of #144: `read` and
  `replaceText` threw on a null options object; the README said every call returns a result
  and that no operation throws, and its system prompt told the model never to read again,
  which `updateFields` needs. Split from the release, 13.8.)
- [x] 13.8 Release: the changeset, `private` removed from the manifest, the package versioned
  0.1.0 with its changelog, its API page and changelog on the site; 0.1.0 published with the
  owner's approval. Its own PR, for the owner to merge; then the Release workflow. Phase 14
  (`@folijs/mcp`) is not planned here: it starts with the owner. (Prepared in
  #145, merged on the owner's word after an agent's review: it removes `private`, applies the changeset (`pnpm changeset version`: 0.1.0
  and `CHANGELOG.md`, the other packages untouched), and gives the site the package's API page
  and changelog. The tarball holds `dist`, `src` without tests, README, changelog and licence,
  with `@folijs/core` `1.0.0` as its exact peer; core's source is unchanged since that tag.
  The review installed the tarball beside `@folijs/core@1.0.0` and `@folijs/docx@1.0.0` from
  npm and ran a session through it. Published 2026-11-21 by the Release workflow, started at the owner's word: only
  `@folijs/agent@0.1.0` went out, with provenance, and its tag was pushed; the five 1.0.0
  packages were skipped as already on npm. The registry took about five minutes to serve the
  new package. Installed from npm beside `@folijs/docx` in an empty project, a session read
  and edited the NDA and exported it.)

## Phase 14 — MCP server (`@folijs/mcp`) · M → mcp 0.1.0

The agent library as tools for any MCP client (Claude Code, Claude Desktop, Cursor…): a program
the client starts, which opens `.docx` files, gives the model `@folijs/agent`'s reading and
operations as tools, and saves the result with every edit a tracked change. For agents that
cannot run code; one that can uses `@folijs/agent` directly. Background:
[explorations/agent-editing.md](explorations/agent-editing.md). Planned 2026-11-21; built, not
released: see the tasks.

Not in this phase: `run(code)` (code mode, After 1.0), a network transport (HTTP), resources
and prompts of the protocol, accepting or rejecting changes, the hint highlight, anything that
shows the document. Changes to `@folijs/agent` only where a tool needs one (its 0.x allows it;
each with a changeset).

**Starts from (agent 0.1.0):** `@folijs/agent` runs anywhere and has no file access: a session
is opened from a document already imported. Its results are made for a model: `text` in the
read format, or a refusal with a message. `@folijs/docx` reads and writes `.docx` in Node. The
repository has no runtime dependency besides React and its own packages
([architecture](architecture.md#dependency-policy)), and no program that reads or writes the
user's files: this is the first. The MCP TypeScript SDK (`@modelcontextprotocol/sdk` 1.32.2,
MIT; checked on npm 2026-11-21) needs `zod` as a peer and brings 17 dependencies (express,
hono, jose, ajv…, 4.5 MB unpacked), most of them for the HTTP transports and authentication a
stdio server does not use. A stdio server that only has tools speaks a small part of the
protocol: JSON-RPC 2.0, one message per line, `initialize`, `ping`, `tools/list`,
`tools/call`.

**Acceptance:** ADR-0009 records the server's decisions (below) and is accepted by review, as
the owner delegates; `npx @folijs/mcp` starts a stdio server that an MCP client lists and
calls; its tools open a `.docx` from a path, read it in parts, run every operation of
`@folijs/agent` and save a `.docx`, with what a tool returns being the library's `text` or its
refusal (marked as an error the model can read and act on); several documents can be open at
once; files are read and written only under the root the server was started with, a path that
leaves it is refused, and the input file is never written over unless the server was started
allowing it; a file that is not a `.docx`, too large or damaged is a refusal, not a crash, and
no input of a client's makes the server exit or write outside the root (tests, and a fuzz of
malformed messages); the official SDK's client drives the server in the tests (a
devDependency: the conformance check), over stdio against the built `bin`; the three tasks of
13.6 pass through the tools and their results open in Word (the harness of 13.6, fed by the
server); a real client is set up by hand and does one task end to end (Claude Code at least;
recorded with its version); the tools' descriptions are enough for the model without a system
prompt (the one of `@folijs/agent`'s README, said once in the server's `instructions`);
README (the site's guide) with the configuration for the clients tried, `security.md` on what
the server may read and write, `api.md`, `architecture.md`, limitations; the package is in
`pnpm check` (tests, publint, its API report if it exports any); 0.1.0 published with the
owner's approval, as 0.x. (Checked 2026-11-21, Word 16.0.20625, Windows 11 and one run on
`ubuntu-latest` with Node 24, `pnpm check` green with 38 tests in the package:
[ADR-0009](decisions/ADR-0009-mcp-server.md) accepted by review (#148); the built `bin` is a
stdio server the SDK's client lists and calls (`pnpm mcp:e2e`) and Claude Code 2.1.92 reports
connected; 14 tools: `open` by a path under the root, `read` in parts, every operation of
`@folijs/agent`, `save`; a tool returns the library's `text`, or its refusal with `isError`;
several documents by id, 16 at most; files read and written only under the root, a path that
leaves it refused (by `..`, an absolute path, a link), and no file written over unless the
server wrote it or was started with `--overwrite`; what is not a `.docx`, too large or damaged
is refused; a fuzz of calls and of what is not a message leaves the server answering, the
originals whole and nothing written outside the root, and fails when the file rules are taken
out; the three tasks of 13.6 pass through the tools and Word opens their results with every
revision the agent's and its accepted and rejected text Foli's (3 of 3); README, `security.md`,
`api.md`, `architecture.md` and limitations; the API report and publint in `pnpm check`. Beyond
what was asked, from two security reviews (#148, #153): a result is cut at 200,000 characters,
the open documents are held to a size together, a save is written to a new file and renamed,
and nothing a document names can start a line of an answer (a block's text, a style, a list
number, a control's name, items and value, a field's instruction, a merge field's name). A
model has used the tools, though not in a client of its own: see 14.8. **Not met:** no model
has called the tools in a real client (the CLI on the build machine is not logged in), so "a
real client does one task end to end" is not shown. 0.1.0 is published and `npx @folijs/mcp`
works from npm: see 14.8.
Each task after an agent's review: #148, #153, #155, and this one, #156.)

### Tasks

Each task is a PR on `phase-14/mcp`, the build green after each, merged after an agent's
review.

- [x] Claim phase, branch `phase-14/mcp`
- [x] 14.1 ADR-0009 and a spike. To decide, with the spike's evidence: (a) the protocol by hand
  or by the SDK. Proposed: by hand (stdio, tools only, no runtime dependency beyond Foli's own
  packages), with the SDK's client as the test of conformance; the SDK instead if the spike
  shows a client (Claude Code, the MCP Inspector) the hand-written server does not satisfy.
  (b) The protocol versions answered. (c) Files: a root (`--root`, default the working
  directory), paths resolved and checked after symlinks, the size limit, and where a save
  goes: by default a new file beside the input (`<name>.agent.docx`), the input itself only
  with `--overwrite`. (d) The author of the changes: `--author`, else the client's name from
  `initialize`, else "Agent". (e) Sessions: in memory, by an id the `open` tool returns, gone
  when the server stops; what `close` does to unsaved changes. (f) The tools, one per
  operation or fewer and wider; how a refusal is returned (`isError` with the message).
  Spike: `initialize`, `tools/list` and one `read` tool, called by the SDK's client and by
  Claude Code. (Done:
  [ADR-0009](decisions/ADR-0009-mcp-server.md), accepted by review. Decided as proposed: the
  protocol by hand, the SDK's client its conformance check and a devDependency only; the
  versions `2025-11-25` to `2024-11-05`; a root, `.docx` only, 64 MB, a save beside the input
  unless `--overwrite`; the author from `--author`, the client's name, or "Agent"; documents
  by id, at most 16, the id left out while one is open; one tool per operation; a refusal and
  wrong arguments as a result with `isError`. The spike is the package itself, `private`:
  `protocol.ts` (the stdio loop, about 150 lines) and `schema.ts` (the check of arguments),
  with one tool, `read`, to be replaced in 14.3. The SDK's client initializes, lists and calls
  on the oldest and the newest version (7 tests, which also send what is not a message: bad
  JSON, a batch, a line over 8 MB, messages cut inside a character). Claude Code 2.1.92 reports
  the built `bin` connected; a model calling a tool through it was not tried, the CLI on the
  machine not being logged in: 14.6's. In `pnpm check`: the API report and publint; no size
  budget, as nothing ships it to a browser. From the review of #148 (a security review): an
  error with `"id": null` is not a message the SDK's transports take, and the tests' transport
  did not check messages as they do; the 8 MB limit did not hold for a line that came whole
  with its newline; fractional ids were echoed; answers were written without waiting for a
  slow client; a schema was checked more strictly than it was published. All fixed here. For
  the ADR's file rules: a save through a planted link would have written outside the root, so
  a save goes to a new file created exclusively and renamed; a file system's root is not a
  root; `:` in a path is refused; line-ending characters in a document's text must not forge
  read lines.)
- [x] 14.2 Package and protocol: `packages/mcp` as `@folijs/mcp` 0.0.0, `private`, with
  `@folijs/agent`, `@folijs/docx` and `@folijs/core` as exact dependencies, a `bin`, Node only
  (its build has Node's types and no DOM). The stdio loop: messages parsed and validated,
  `initialize` with `instructions`, `ping`, `tools/list`, `tools/call`, errors as JSON-RPC
  errors, nothing but protocol messages on stdout (logs on stderr), a clean end when stdin
  closes. A tool is a name, a description, a JSON Schema for its arguments and a function;
  arguments checked against the schema before the function runs. Tests with the SDK's client. (Done with 14.3 to 14.5 in one PR, #153: the tools are thin and
  read best with the server. `bin.ts` reads `--root`, `--author`, `--overwrite`, `--help` and
  `--version`, logs on stderr as `foli-mcp: …`, ends quietly when the client goes; `server.ts`
  (`foliServer`) puts the file rules, the documents and the tools together, with the
  instructions; the client's name is cut to a line of 60 characters before it is an author. A
  tool that throws is logged by its error's kind and stack, not its message, which may quote
  a document.)
- [x] 14.3 Documents: `open(path)` (the file read under the root, imported, a session made;
  returns the document's id and the start of a read), `save(id, path?)`, `close(id)`,
  `list_documents`. The file rules of ADR-0009, each with its test: outside the root, through
  a symlink, not a `.docx`, over the size limit, a damaged zip, the input written over. (Done: `files.ts` and
  `documents.ts`, by ADR-0009 as the review of #148 left it. A path is relative, with no `:`;
  a file to read is found by its real path under the root's, and what is outside is answered
  as what is not there; 64 MB, then `@folijs/docx` held to limits of its own (set in the
  review, below). A save goes to a new file made exclusively beside the target and renamed over it;
  over a file only when the server wrote it in this run or was started with `--overwrite`;
  never over what is not a plain file. Without a path: `<name>.agent.docx`, or
  `.agent-2.docx`… when that is another's. A whole drive is refused as the root. Tests on real
  folders: paths up, absolute, through a folder link (a junction) and, where the system lets a
  test make them, file links, one to nothing; not a zip, an empty and a cut file; a file a
  byte over the limit; the input and another file not written over; nothing left beside what
  was saved. File links cannot be made on the machine the phase was built on (Windows without
  developer mode): those cases run in the Release workflow's check, on Linux.)
- [x] 14.4 Reading and editing tools over a session: `read` (from, limit), `replace_text`,
  `insert_paragraphs` (before or after), `delete_block`, `set_style`, `list_styles`, `comment`.
  Descriptions written for the model, with the read format; results the library's `text`.
  What the tools show the library lacks goes into `@folijs/agent`, with a changeset. (Done: `tools.ts`. Each tool is the library's method and returns its
  `text`; `read` gives 200 blocks unless told (2,000 at most) and says where to go on from;
  `open` returns the id and the first read. Every schema names each argument and what it is,
  and takes none it does not name. From the review of #148, in `@folijs/agent` (a patch, with
  a changeset): a read shows every character that ends a line as ↵, not only the line break,
  so a document's text cannot start a line that reads as another block.)
- [x] 14.5 Template tools: `list_controls`, `fill_control`, `update_fields` (with `data`). (Done: `list_controls` gives a line per control: its
  name, kind, whether it is locked, its block, its value or `empty`, a list's items, and its
  id when that is not its name; `fill_control` returns the blocks changed and those lines;
  `update_fields` the library's sentence. From the security review of #153, each proved on a file
  made for it and fixed: a style's name, a list's number, a control's tag or an error of the
  reader could start a line of an answer that read as another block (now on one line, in
  `@folijs/agent`); a 266 KB file gave a 251 MB answer and a 23 KB one 300 MB of heap, the
  fourteenth open ending the process (a result is cut at 200,000 characters, a file held to
  64 MB unpacked and 400,000 nodes, the open documents to 3 million positions together); a
  save beside the original did not check its folder again; a file opened twice was saved over
  by its other session (a file is open once); a client's name cut through a character or
  holding a control character made every save fail; `..` told the names of the folders above
  the root; a test of links could not fail. Not fixed, written in the ADR: a file that
  appears between the last look and the rename is replaced.)
- [x] 14.6 End to end: the three tasks of 13.6 through the built server and the SDK's client;
  their results through 13.6's Word harness; a fuzz of malformed and hostile messages (the
  server answers or ignores, never exits, never writes outside the root); Claude Code set up
  by hand, one task done, recorded. Fix what they find. (Done but for a model in a real client.
  `scripts/corpus/mcp-roundtrip.mjs` starts the built `bin` and speaks to it over its stdin and
  stdout with the SDK's client: the tools by name; an absolute path, a path up to a file that
  is there, and a save over the original refused, each by its message; the three tasks done
  (`agent-tasks.mjs` holds what both harnesses expect of them) and saved beside the originals;
  the originals byte for byte as they were; every saved file read again by Foli, with changes,
  all the author's; nothing on stderr. It also runs the command line (`--version`, an unknown
  argument, a whole drive, an empty author: their exit codes and where they print), sends the
  process what is not a message and has its ping answered, and requires it to end by itself
  with code 0 when its input ends. That runs in `pnpm check` (`pnpm mcp:e2e`). What it saved
  went through 13.6's Word harness: 2026-11-21, Word 16.0.20625, 3 of 3 open, every revision
  the agent's (9, 6 and 19), the texts written and removed in Word's revisions, accepted and
  rejected text Foli's. `fuzz.test.ts`: 60 runs, the same every time, of up to 30 lines each
  against the server on a folder: calls made to fit their tool from its own schema, with values
  mostly right, paths as often an attempt to leave the folder as a file in it, and the rest
  wrong on purpose. Those runs reach 35 edits, 10 saves, 14 opens and saves by a path that
  leaves the folder, 33 refusals by the file rules, 63 by the library and 78 by the schema,
  and the test fails if any of these is none. After each run: every call answered once with a
  valid message; no answer over the cap or quoting the file outside; no tool threw; the
  originals and the file outside whole; nothing beside the folder; in it only `.docx` files
  Foli reads again, their changes the author's. With the `..` rule and the check of the real
  path taken out of `files.ts`, the test fails; so it does when a save may overwrite. 400 other
  runs (`FC_SEED=random`) pass. Linux: `pnpm check` passed once on `ubuntu-latest`, Node 24
  (a workflow on a branch since deleted, run 44908327247), the first run there of the server's
  tests, of the end-to-end script and of the cases with file links, which Windows did not let
  the build machine make. Claude Code 2.1.92 reports the built server connected. From the
  review of #155: the first fuzz sent every argument name to every tool, so 97% of its calls
  were refused by the schema and none edited, saved or met the file rules, and it passed with
  those rules taken out; the script's check of the server's end could not fail (the SDK kills
  a server that stays), nor its path up (to a file that was not there), nor its count of
  fields; `--author ""` started a server, against the ADR. Not done: a model calling the
  tools through Claude Code. The CLI on the machine is not logged in; it is the owner's to try
  before the release, 14.8.)
- [x] 14.7 Docs: README (the site's guide) with the clients' configuration, `security.md`,
  `api.md`, `architecture.md`, `limitations.md`, acceptance checked above. (Done: the README has the set-up for Claude Code and the shape
  other clients take, the options, the tools, what the server does to files and its limits;
  it is the site's guide `/docs/guides/mcp/`. `security.md` has the server's section: who is
  not trusted, each check and where it is, what stays the user's, what is known and accepted.
  `api.md` (`serve`, `Tool`, `foliServer`), `architecture.md` ("The MCP server"),
  `limitations.md`, the root README and `contributing.md` say what was built. From the
  review of #156, a fact check that also ran the server: a field's instruction, a merge
  field's name and a control's value still reached an answer with their line ends (fixed in
  `@folijs/agent`, tested through the server); the hundredth name beside the original was
  written over when the server was started to overwrite (refused now); the README gave `npx`
  commands for a package that is not on npm.)
- [x] 14.8 Release: first a model in a real client doing one task end to end (Claude Code at
  least; recorded with its version, and what its use of the tools showed wrong in their
  descriptions fixed); then the changeset, `private` removed, 0.1.0; published with the owner's
  approval (the Release workflow). `@folijs/agent`'s pending patch goes out with it.
  (Partly, 2026-11-21: a model did the tasks, not in a real client. A fresh Claude agent, told
  nothing but what the server says of itself (its instructions and `tools/list`), called the
  built `bin` through the official SDK's client over stdio, one tool call a command: an NDA
  amended with comments, an offer letter filled from a template, a board report's headings
  changed and its fields updated. 35 tool calls, none refused, none a protocol error; the
  originals unchanged; the three saved files open in Word 16.0.20625 with every revision the
  client's name as author (19 revisions and 1 comment, 8 and 2, 9 and 0). What it showed
  wrong, fixed here: a table of contents built again without pages came back with its page
  numbers empty and the answer did not say so (now left as it is unless `contents` is true,
  and the answer says what building it costs); a comment's initials for "Claude (trial)" were
  `C(` (now `Ct`); the descriptions did not say that a style's name takes any capitals, nor
  how to comment a deletion. Released 2026-11-21 with the owner's approval, without the
  real-client step: `@folijs/mcp` 0.1.0 and `@folijs/agent` 0.1.2 on npm (#162, the Release
  workflow). After it, `npx -y @folijs/mcp@0.1.0 --root <folder>` was started from npm
  outside the repository by the SDK's client: 14 tools, a document opened, edited and saved.
  A model in a client of its own: done 2026-11-22, see "Agent editing" under After 1.0.)

## Phase 15 — Toolbar customization · S → 1.1.0

What an app could not do with `FoliToolbar` in 1.0, asked for by the owner on 2026-11-21: its own
boxes and color menus, other colors, fonts and sizes than the built-in ones, its own dialogs and
controls in the toolbar, and tabs. All of it added to `@folijs/react` (a minor release: nothing
of 1.0 removed or changed in what it does). Independent of Phase 14.

Not in this phase: people changing the toolbar while they use the editor (hide, reorder, a
Customize dialog; an app does it over `items`), a color picker (any `#rrggbb` already works
through `setTextColor`; an app's own item can now offer one), tabs that appear with the
selection (Word's Table tab), a toolbar that collapses when it does not fit.

**Starts from (1.0.0):** `items` takes groups of `ToolbarButton`s (a command) and
`ToolbarMenu`s (`actions`). The boxes (`select`), color menus (`menu`) and dialogs exist only as
the built-in items' private shapes in `FoliToolbar.tsx`; `toolbarItems` types them
`ToolbarButton`, which they are not (they have no `command`).

**Acceptance:** an app's item can be a box and a color menu, with the built-in ones' keyboard
and ARIA behavior; the built-in color menus and boxes take other options through a copy
(`{ ...toolbarItems.textColor, colors: … }`); an app's item can open the app's own dialog under
the toolbar (focus into it, Escape and `close` back to its button, gone when the toolbar is
disabled) and can render its own control that keeps the toolbar's one tab stop; `FoliToolbar`
and `FoliEditor` take tabs of groups (WAI-ARIA tabs over the toolbar, arrow keys between tabs,
Mod-K's link dialog on any tab); tests for each (jsdom) and one e2e for the tabs in the
playground; `api.md`, the extensions guide, `styling.md`, `limitations.md` and the API report
say what is there; a changeset (minor); released as 1.1.0 with the owner's approval.

### Tasks

Each task is a PR on `phase-15/toolbar-customization`, the build green after each, merged after
an agent's review.

- [x] Claim phase, branch `phase-15/toolbar-customization` (with 15.1, #149)
- [x] 15.1 (#149) Boxes and color menus: `ToolbarSelect` and `ToolbarColorMenu` public, the built-in
  ones typed so in `toolbarItems`, their options replaceable through a copy.
- [x] 15.2 (#150) Dialogs and controls: `ToolbarDialog` (the app's content in a dialog under the
  toolbar) and `ToolbarCustom` (`render`, with the props that keep the one tab stop).
- [x] 15.3 (#152) Tabs: `tabs` on `FoliToolbar`, `toolbar` of `FoliEditor` taking them; the playground
  shows them; e2e.
- [x] 15.4 (#154, #160) Docs checked against the acceptance above (every point holds, with
  jsdom tests for each and the tabs' e2e in three browsers); three changesets (minor); 1.1.0
  published on 2026-11-21 with the owner's approval (the Release workflow), checked by an
  install from npm. `pnpm bench` before it exited non-zero on a machine that was not quiet,
  and so did the 1.0.0 tag under the same load (#160): to rerun on a quiet machine.

## Phase 16 — Code mode: `run` in the MCP server · M → mcp 0.2.0

A tool of `@folijs/mcp` that takes a script instead of one operation: the model writes a loop
over the document ("replace X in every table cell", "put every clause title in Heading 2") and
the server runs it in a sandbox, in one call where the plain tools take dozens. For agents
that talk MCP only; one that can run code itself uses `@folijs/agent` in its own sandbox and
needs none of this. Background:
[explorations/agent-editing.md](explorations/agent-editing.md#where-code-modes-sandbox-runs).
Planned 2026-11-21 at the owner's request; nothing built.

Not in this phase: Foli's own API in the script (core's commands and positions: the script
gets the session's operations, as the tools do), files from a script (`open` and `save` stay
tools), anything asynchronous in a script (no timers, no network, no imports), state kept
between two runs, a sandbox in the browser or in `@folijs/agent`, accepting or rejecting
changes.

**Starts from (mcp 0.1.0, agent 0.1.2):** 14 tools over a session per open document; every
argument checked against a schema; an answer is the library's `text` or its refusal, cut at
200,000 characters; the server's only dependencies are Foli's own packages, and the protocol
is written by hand to keep it so (ADR-0009). The trial of 14.8 took 35 tool calls for three
small tasks. The exploration's spike (2026-11-21, not kept) ran all of `@folijs/core` inside
QuickJS: it works, but core needs `Intl.Segmenter`, `Intl.DateTimeFormat` and
`structuredClone`, which QuickJS has not; loading the bundle costs about 180 ms a runtime; and
tracking cannot be enforced on code that holds the editor. `isolated-vm` did not install on
Node 25. `quickjs-emscripten-core` and `@jitl/quickjs-wasmfile-release-sync` are 0.32.0, MIT,
795 kB and 650 kB unpacked (npm, 2026-11-21).

**Proposed shape, for the ADR to confirm or change:** the script is the only thing in the
sandbox. The session stays in the server; the script gets one object, `doc`, whose methods are
the server's functions over the open session: the operations the tools have, with the same
checks and the same refusals as values. Only JSON crosses, both ways. So the script cannot
turn tracking off, reach a file, or do to a document what a tool call could not; core needs no
`Intl` in the guest; and there is no bundle to load.

**Acceptance:** ADR-0010 records the decisions (below) and is accepted by review, as the
owner delegates; a `run` tool takes a script and a document and answers with what the script
returned, what it logged and the blocks it changed; every edit a script makes is a tracked
change by the server's author, as a tool's is; a script that throws, runs out of time or of
memory, or is stopped, leaves the document as it was before the run, and the answer says
where it failed (the line) in words a model can act on; nothing a script does makes the
server exit, hang past its time limit, grow past its memory limit, read or write a file,
or reach the network (tests, and a fuzz of hostile scripts: endless loops, memory and stack
exhaustion, huge results, getters and proxies as arguments, prototype pollution, use after
the run ended); what a document says still cannot start a line of the answer; the tool's
description alone (the `doc` object's types, a short example) is enough for a model: a fresh
model, told nothing else, does in one `run` call each a task of 13.6 that needs a loop, the
result opens in Word with every revision the agent's, and the count of calls is recorded
beside the plain tools'; the plain tools work as before whether or not `run` is there;
README, `security.md` (the sandbox: what it holds, what crosses, its limits), `api.md`,
`architecture.md`, limitations, `THIRD_PARTY_NOTICES.md` if the dependency asks for it; the
package's checks in `pnpm check` (e2e through the built `bin` included), on Windows and one
run on Linux; 0.2.0 published with the owner's approval.

### Tasks

Each task is a PR on `phase-16/run-code`, the build green after each, merged after an agent's
review.

- [x] Claim phase, branch `phase-16/run-code`
- [x] 16.1 ADR-0010 and a spike. To decide, with the spike's evidence: (a) what is in the
  sandbox. Proposed: the script alone, with host functions over the session (above); against
  it, core inside the guest (the exploration's spike), kept only if the spike shows a task the
  operations cannot do. (b) The engine. Proposed: QuickJS as WASM (`quickjs-emscripten-core`
  with one synchronous release variant), MIT, no native build, any Node the server runs on;
  `isolated-vm` ruled out (native, Node 24 and 26 only, in maintenance); Node's `vm` is not a
  boundary. The spike measures start-up, a host call's cost and a 500-block loop, and tries
  the limits (time by the interrupt handler, memory, stack) on Windows. (c) The dependency:
  the server's first outside Foli. Proposed: a dependency of `@folijs/mcp`, loaded when `run`
  is first called, licenses checked and noticed; or an optional one, the tool absent without
  it. (d) Whether the tool is there by default or behind a flag (`--code`). Proposed: behind
  the flag in 0.2.0: it is new surface for hostile input. (e) All or nothing: how a failed
  run is taken back (the editor's undo, or a checkpoint of the session with its handles; a
  change to `@folijs/agent` if it needs one). (f) Limits and their defaults (time, memory,
  stack, host calls, the size of what is returned and logged). (g) One run at a time, a new
  sandbox each run. (Done: [ADR-0010](decisions/ADR-0010-code-mode.md). As proposed: the
  script alone in QuickJS as WebAssembly, behind `--code`, a plain dependency. Changed by the
  spike: the sandbox is in a worker thread, because in the server's own thread QuickJS's
  interrupt is not asked inside its native functions (a 2 s deadline overrun past 5 s) and a
  deep recursion overflowed the host's stack; and a failed run is taken back by a checkpoint
  of the session (`@folijs/agent`, built in 16.3), not by undo, which joins and drops steps.)
- [x] 16.2 The sandbox, apart from documents (`sandbox.ts`): runs a script with a set of host
  functions and limits, and answers with its value, its log, or its failure with the line.
  JSON only across; a new context each run, disposed whatever happens. Tests for each limit
  and for what must not be there (`fetch`, `require`, `process`, timers, `import()`). (Done:
  `sandbox.ts` and `sandbox-worker.mjs`, 16 tests: the value as JSON, the host's answer and
  its error, the line of a failure; time ended within the limit for loops and for calls slow
  inside the engine; memory, stack and the number of calls; nothing of Node in the script;
  each run clean. From the security review of #165, which ran the built sandbox: QuickJS's
  memory limit did not hold (2 GB under a limit of 8 MB: the module's memory is now refused
  growth past the limit, and the test counts what a script got); a call's arguments were of
  any size and parsed where the timer lives (a 2 s run held for 62 s: held to 200,000
  characters now); the value and an error's message were of any size; a call made while a
  call's name was read mixed the answers; a host error with a message that is not text
  ended the process. Each has a test; the memory test fails without the guard. From the second review, which
  drove the built server: the host's own work was not bounded, since no timer fires while the
  server's thread works (one insert of 20,000 paragraphs ended the server; a stopped loop took
  27 s to take back): an insert and a replace are held to 500 (`@folijs/agent`, so the plain
  tools too), a run to 2,000 paragraphs added, and a rollback gives undo its state back
  where it rebased every stored step; a rollback left the run in undo and a style the run
  added in the document: both put back; the memory test passed without its guard in all but
  one line: rewritten to count what a script got. Left, and in limitations: a paragraph
  inserted then deleted leaves a wrong tracked change (older than this phase). From the third,
  on the fixes: a script that swapped a paragraph's text back and forth, adding nothing, still
  ended the server in 14 s (the checkpoint kept every step's transaction and its documents),
  and paragraphs inserted in a cell were not counted. The checkpoint now keeps no body step:
  a rollback puts the body back whole, in one step whatever was done; inserts are counted
  where they are made. The worst scripts of the three reviews answer in 10.0 to 10.2 s with
  the document as it was. Four assertions that could not fail were rewritten or removed. A fourth review, of main after the merge,
  found the rollback right on nine documents and sixteen kinds of edit, and two holes: one
  replace could write 100 million characters (500 places of 199,000), and comment text was
  counted nowhere. One operation now writes 300,000 characters at most, and a run's calls
  give a million at most; measured, each worst script answers in 10.0 s or less. Its re-check found merge data
  multiplied the same way (a value written into a template's thousand fields of one name:
  190 million characters, then a save that failed), and then the document's own fields (a
  thousand date pictures of 50,000 characters: 90 million characters from an update with no
  arguments). So core's `updateFields` takes `maxWritten`, counts what the results hold as it
  works them out, and changes nothing past it; the agent gives it 300,000. Its re-check found
  a reference copying its bookmark's formatting (60 KB a run, 2,000 references: a save that
  ended the server): core now counts results as JSON, and the server holds every open
  document to a weight, 16 million characters past what it was when opened, every tool call
  and run taken back past it.)
- [x] 16.3 `doc` over a session: reading as blocks (handle, style, text, table place,
  changed) in parts, every operation of the tools with the same argument checks, results and
  refusals as values a script can test (`if (!r.ok)`); `console.log` kept as the log. A
  failed run takes back every edit it made. (Done: `code.ts`. `doc` has `blocks`, `block` and
  the eleven operations; a refusal is thrown in the script, so a script that does not look
  stops there. `session.checkpoint()` in `@folijs/agent` takes a run back: the document equal
  as JSON and every handle as it was, on the three corpus documents after every kind of
  edit. Two arguments the tools' schemas refuse the library takes as no options
  (`comment`'s and `updateFields`' options given as a string or a number).)
- [x] 16.4 The `run` tool: schema, a description that carries the `doc` types and one
  example, the answer's format (returned value, log, blocks changed, each held to a size and
  to one line per block), a refusal's wording. In `tools/list` as decided in (d). (Done: `run`
  with `--code`, 15 tools then, 14 without. The answer: `Returned:` and the value as JSON on a
  line, the blocks changed as they read now (40 at most), what was deleted, the log; a
  failure with its line and "Nothing was changed". 10 tests through the SDK's client.)
- [x] 16.5 Hostile scripts: the fuzz and the escape tests of the acceptance, each proved to
  fail when its guard is taken out; a security review by an agent, on the built server. (Done:
  `code-fuzz.test.ts`, 30 scripts on each of three documents, seed 20261121: operations with
  arguments of any shape, caught or not, then one of twenty ends (a return, a throw, loops
  without end, recursion, memory, a huge or cyclic value, prototypes changed, `import()`).
  A failed run leaves the document and every handle as before; a kept one only the author's
  tracked changes. It fails with the rollback taken out, and with the handles not put back.
  It found that a footnote taken out and put back has its keys in another order: the same
  document, compared so. The e2e runs the bin with `--code`. The review: under 16.2.)
- [x] 16.6 A model's trial, as 14.8's: a fresh model with the server's own words only, tasks
  that need a loop, through the SDK's client; calls counted against the plain tools; Word
  opens the results. What it shows wrong in the description, fixed. (Done 2026-11-21: a fresh
  Claude agent, told only what the server says of itself, through the SDK's client against
  the built `bin` with `--code`: a company renamed through an NDA with a comment, a report's
  headings moved a level down, an offer letter filled. 11 tool calls (3 `open`, 3 `run`, 3
  `save`, `list_controls`, `list_documents`), none refused; every script ran at the first try.
  The same kind of tasks took 35 calls with the plain tools (14.8). Word 16.0.20625 opens the
  three files, every revision the client's (6 and a comment, 5, 9). It had to guess, and the
  description now says: what `replaced`, `refused`, `comment` and `unfilled` are; that
  `blocks()` is a copy; that a table's text is empty; that built-in headings read "heading 1"
  without a capital; that headers, footers and notes are not there (now in the server's
  instructions too). It left the table of contents as it was, as the tool says. Not a client
  of its own, as in 14.8.)
- [x] 16.7 Docs, the e2e in `pnpm check`, one run on Linux; then the changeset and 0.2.0,
  published with the owner's approval (the Release workflow). (Partly, 2026-11-21: README, `security.md`,
  `architecture.md`, `api.md`, limitations and `contributing.md` say what is built; the e2e
  with `--code` is in `pnpm check`; one run of `pnpm check` on `ubuntu-latest` with Node 24
  passed at 25fd822, before the last review's fix (the rollback in one step), which was
  checked on Windows only; the changesets are written (agent minor, mcp minor). After a fourth review asked by the
  owner (#175: what one call writes, core's `maxWritten`, the document's weight), one more
  Linux run passed at #165's merge. Released 2026-11-21 with the owner's approval: `@folijs/mcp`
  0.2.0, `@folijs/agent` 0.2.0 and the five 1.x packages at 1.2.0 (#176, the Release workflow,
  run 44949052726); then `npx -y @folijs/mcp@0.2.0 --code` from npm, outside the repository,
  by the SDK's client: 15 tools, a run of 11 replacements kept, an endless script stopped at
  10.0 s, the document saved. Not run on Linux after #175. Not tried: a model in a client of
  its own.)

## Phase 17 — Toolbar for developers · M → 1.2.0

What a developer still could not do with `FoliToolbar` after Phase 15 (1.1.0), asked for by the
owner on 2026-11-21 ("maximum customization for developers"). All of it added to
`@folijs/react`: a minor release, nothing of 1.1 removed or changed in what it does. Independent
of Phase 16.

Not in this phase: people changing the toolbar while they use the editor (an app does it over
`items` and `tabs`; the owner left it out), translating `FoliNavigation` and `FoliComments`
(the same way, later), changing what a built-in dialog contains (an app that wants another
dialog writes its own, a `ToolbarDialog`).

**Starts from (1.1.0):** tabs are uncontrolled and fixed; a group is an array without a name; a
built-in dialog opens only from its own item or menu entry; the color menus offer a palette
only; a toolbar wider than its place wraps; every built-in string is English in the source.

**Acceptance:** an app says which tab shows and hears of a change (`tab`, `onTabChange`), and
a tab can come and go with the selection (`visible`); a group can have a caption; an app's
button opens a built-in dialog by name; a color menu can offer any color (the browser's color
field) beside its palette; with `overflow="menu"` the groups that do not fit one row go into a
More menu, reachable by the same arrow keys; every string the toolbar shows or announces
(items, menu entries, dialogs, messages) can be replaced through `messages`, the list of them
is exported and a test finds none outside it; tests for each (jsdom), e2e for overflow and one
translated toolbar with axe; `api.md`, the extensions guide, `styling.md`, `limitations.md`,
the API report; changesets (minor); released as 1.2.0 with the owner's approval.

### Tasks

Each task is a PR on `phase-17/toolbar-developers`, the build green after each, merged after an
agent's review.

- [x] Claim phase, branch `phase-17/toolbar-developers` (with 17.1)
- [x] 17.1 (#167, #168) Tabs and groups (also `toolbarProps` on `FoliEditor`, for these and the later props): `tab` and `onTabChange` (controlled), `defaultTab`;
  `ToolbarTab.visible(state, editor)`; a group as `{ label, items }` (`ToolbarGroup`), shown as
  a named `role="group"` with its caption.
- [x] 17.2 (#169) Built-in dialogs by name: a `ToolbarDialog` whose `dialog` is `"link"`,
  `"picture"`, `"insertTable"`, `"pageSetup"`, `"crossReference"`, `"controlProperties"` or
  `"noteOptions"`.
- [x] 17.3 (#170) Any color: `colors.custom` adds an entry with the browser's color field to a color
  menu.
- [x] 17.4 (#172) Overflow: `overflow="menu"` (default `"wrap"`, as today).
- [x] 17.5 (#173) Strings: `messages`, `toolbarMessages` (the list, kept by
  `scripts/toolbar-messages.mjs` in `pnpm lint`), the test that every string shown is in it.
- [x] 17.6 Docs checked against the acceptance above (done 2026-11-21: every point but the
  release holds; jsdom tests for each, e2e in three browsers with axe for tabs, overflow and a
  translated toolbar; six changesets, minor); 1.2.0 published 2026-11-21 with the owner's
  approval, with Phase 16 (#176, the Release workflow).

## Phase 18 — Hint: show a place for a few seconds · S → 1.3.0, agent 0.3.0

An app, or an agent saying what it changed, points at a place in the document; the editor
scrolls there and marks it for a few seconds, then the mark fades, without changing the
document or the selection. Wanted by the owner since the agent exploration (the fourth of
the pieces around `@folijs/agent`, after the library, the MCP server and code mode). Planned
2026-11-21; built and released 2026-11-22: see the tasks.

Not in this phase: a hint in the MCP server (it has no view: it can only say a block's handle,
which it does), a hint that stays until dismissed (that is a selection or a comment), several
hints styled apart (one name, `foli-hint`, for all), a hint in `renderDocument` or a PDF,
virtualized pages (none today; a requirement noted below if they come).

**Starts from (1.2.0):** `view.reveal({ story, from, to })` and core's `goTo(editor, target)`
scroll to any range of the body or a story, but select it: the caret moves. Find marks its
matches with the CSS Custom Highlight API (`::highlight(foli-find)`, `view/src/word/matches.ts`:
ranges beside the DOM, nothing added to the pages, a forced-colors and a print rule), and maps
them to the pages again after each render. `listBookmarks` names a document's bookmarks.
`@folijs/agent` sessions make their own editor (`openSession(document)`), so a block's handle
is a position in the session's document; an app shows that editor by giving it to `FoliCanvas`
(`editor` prop). Every page is in the DOM, so a far page is reached. The view's bundle is at its
size budget (112.0 of 112.0 kB gzip): what this adds must be small, or the budget raised with
the reason.

**Acceptance:** `view.hint(target, { ms })` and core's `hint(editor, target, options)` (as
`goTo` is to `reveal`) scroll the target into view, mark it for `ms` (default 2 s) and let the
mark fade (`::highlight(foli-hint)`, then `foli-hint-fading`); neither the document, the selection, undo nor the focus changes (tests compare
each); the target is a range of the body or of a story (a header shown on its page: opened
there as `reveal` does, closed again after, unless the person was editing it), a bookmark by
name, or an agent's block by handle (`session.target(handle)` gives the `DocumentTarget`); a
range is mapped through edits made while it shows and the mark goes when its text is deleted;
a new hint replaces the one showing; `prefers-reduced-motion` gives no fade and no smooth
scroll; forced colors use the system's mark colors, print shows none; without the Highlight
API it still scrolls, as find does; an app themes it with `::highlight(foli-hint)`; the
React components expose it (`FoliEditor`'s ref, a hook if one is needed); e2e in Chromium,
Firefox and WebKit (a far page, a header, an edit while it shows, reduced motion) with axe;
README, `api.md`, `architecture.md`, limitations, the site's guide on agents shows an agent's
change hinted; size budgets met or raised with a reason; the changesets (core, view, react
minor; agent minor) and 1.3.0 / agent 0.3.0 published with the owner's approval.

A requirement for later, if pages are ever virtualized (an option for the first layout's
speed): `reveal` and `hint` must lay out the target's page before they scroll.

### Tasks

Each task is a PR on `phase-18/hint`, the build green after each, merged after an agent's
review.

- [x] Claim phase, branch `phase-18/hint`
- [x] 18.1 `view.hint` in the body: its own highlight (`foli-hint`, beside find's, with the
  forced-colors and print rules), scrolling without selecting (`scrollToRange` exists, private),
  the range mapped through each transaction and redrawn after each render as find's matches
  are, removed when deleted, when its time is up or when a new hint comes; the fade a CSS
  transition of the highlight's color, none under reduced motion (and no smooth scroll). To
  decide in the PR, with the measurements: whether the fade is CSS (a class on the pages with a
  transition on `::highlight`, if the browsers allow it) or a few timed steps of the colour.
  jsdom tests for what does not need a browser; core's `hint(editor, target, options)` over
  `storyView`. (Done: `view.hint`, core's `hint`, `StoryView.hint` optional so a view of
  another make still fits the type. The fade is one lighter highlight, `foli-hint-fading`, for
  0.4 s: whether CSS transitions apply to `::highlight` in the three engines was not checked; one
  step needs nothing of them, reads as fading, and costs nothing per frame. To look at in 18.3
  with the e2e. No smooth
  scroll at all (the view's scrolling was already instant), so reduced motion drops only the
  fading step. Six jsdom tests: marked, faded, gone; nothing else changed (document, selection,
  undo); edits followed, deletion ends it; replaced; a new document ends it; reduced motion;
  refusals; no Highlight API. The view's budget raised 1 kB for it (112.6 of 113.0 kB). From
  the review of #182: a point (`from === to`) marked nothing and ended at the first edit (now
  it shows its paragraph); positions not whole numbers are refused; three tests that could not
  fail made to (a replaced hint's timers, a new document with text, the focus compared).)
- [x] 18.2 Targets: a story's range (opened for the hint as `reveal` opens it, closed after);
  a bookmark by name (`{ bookmark: "Intro" }`, refused when there is none); an agent's block
  (`session.target(handle)` in `@folijs/agent`: the block's `DocumentTarget`, or a refusal
  as for any handle). The answer is a value: `true`, or false when no page shows the target.
  (Done, otherwise than planned for stories: a header's, footer's or note's range is not
  opened, which would turn the view to editing it; its copies drawn on the pages near the
  window are marked by their text (`rangesInCopy`), the page scrolled to when none is near, and
  a change to the story ends the hint. The story being edited hints in its own view. Tested in
  jsdom as far as it goes (the copy's marks; bookmarks through a stand-in view;
  `session.target` on the NDA, through an insert); the pages themselves in 18.3's e2e. From
  the review of #182's second commit: a tab, a note's number and a list's number are drawn as
  text and were not counted, so the mark slid by them (now counted as the copy draws them,
  tested on a real header and note in three browsers); a new hint now ends one shown in the
  open story; a target that is not an object, or a bookmark name that is not a string, is
  false. Left, in limitations: merged cells, the final review view, field codes shown.)
- [x] 18.3 React and the app's side: `FoliEditor`'s ref gets `hint`; whether a hook adds
  anything (`useHint`) is decided here, and not built if not. The playground gets a "show"
  button per tracked change; the site's agent guide shows a session's edits hinted one after
  the other. e2e in three browsers with axe: a far page, a header, an edit while it shows, a
  hint replaced, reduced motion. (Done: `FoliEditor`'s ref has `hint`; no hook, since core's
  `hint(editor, …)` already works with `useCurrentEditor`. `hint.spec.ts`, 6 tests, passed in
  Chromium, Firefox and WebKit on Windows (2026-11-21): a far page scrolled to and marked on
  the screen, faded, gone, the selection unchanged, axe on the pages while marked; a range over
  two pages marked on both; an edit before the mark followed and a deletion ending it; a
  header's copies marked without opening it; reduced motion without the fading step. The
  replaced hint is tested in jsdom only. The agent's README (the site's guide) shows a
  session's changes hinted. Not built: the playground's "show" button, the e2e drives
  `view.hint` itself.)
- [x] 18.4 Docs (README, `api.md`, `architecture.md`, limitations, the guide), size budgets,
  the changesets; then 1.3.0 and agent 0.3.0, published with the owner's approval (the Release
  workflow). (Partly: `api.md`, `architecture.md`, limitations, the agent's README (the guide) say
  what is built; budgets met, view and React raised with their reasons; four changesets (core,
  view, React minor; agent minor). Released 2026-11-22 with the owner's approval: 1.3.0 for the
  five, `@folijs/agent` 0.3.0, `@folijs/mcp` 0.2.1 (#183, the Release workflow, run
  45008261931). The first run (45006968553) stopped in its `pnpm check` before publishing: a
  sandbox test of eight runs at once was too much for GitHub's 2-core runner (#184, four runs;
  the full check then passed there once, run 45008031810). Not built: the playground's
  "show" button.)

## Phase 19 — Editing gaps · M → 1.4.0

The "gaps users will meet" of the After 1.0 backlog, picked up by the owner on 2026-11-22: what
a person editing a document hits first. Planned 2026-11-22; being built: see the tasks.

Not in this phase: a color picker in the built-in menus by default (the `custom` field exists
since Phase 17, an app turns it on), tracking a picture's size change (resizing stays refused
while tracking), replacing inside text boxes or other opaque content, custom container nodes,
checks on a real Android device (deferred as the other manual checks, ADR-0003).

**Starts from (1.3.0):** Word's horizontal rule is a paragraph's bottom border, kept and drawn,
with no button. `setTextColor` takes any `#rrggbb`. `findAll` reads the body and the stories
(`core/src/state/find.ts`), not comments (`CommentJSON` in the document) nor opaque content.
`renderDocument` and `exportPdf` take no extensions: node views are only `EditorView`'s. Autofit
tables keep Word's saved grid (`view/src/word/table.ts`, a `shortcut:`); a column's width is set
only by dragging its border. A picture keeps its DrawingML, and export writes back its size
(`a:xfrm`); rotation (`rot`) and cropping (`a:srcRect`) are neither read nor drawn; resizing
takes a mouse. The view handles only dropped image files (`onDrop`); dragging text does nothing.
On Android, Backspace at a list paragraph's start may join it into the one before, and some
keyboards split paragraphs without the `beforeinput` the editor needs (the edit is discarded with
a warning).

**Acceptance:** a toolbar button inserts a horizontal rule as Word writes one (a paragraph's
bottom border), tracked when tracking is on, and it round-trips through `.docx`; find (and
`findAll`) also reports matches in comments and in text boxes, each match saying where it is,
going to one opens its comment or selects its text box, and replace skips what it cannot edit
and reports it; `renderDocument` and `exportPdf` take `extensions` and draw custom nodes and
marks with the editor's views; autofit tables are fitted to their content within Word's rules
(a fixed table keeps its grid), and a column's width can be set from the keyboard (a table
properties field, undoable); a picture can be rotated (90° steps and Word's own rotation shown)
and cropped (Word's crop shown, a crop mode with handles), both kept through `.docx`, and
resized by touch; text can be dragged: moved within the document (a tracked move as delete and
insert when tracking), copied with Ctrl, dropped from another application as a paste; on
Android, Backspace at a list paragraph's start removes its number, and a paragraph split without
`beforeinput` is recovered instead of discarded (tested with the event sequences of Gboard and
Samsung Keyboard as recorded in public bug reports, not on a device); e2e in Chromium, Firefox
and WebKit with axe for each new piece of UI; limitations, `api.md`, `architecture.md`,
`keyboard.md` updated; size budgets met or raised with a reason; changesets; 1.4.0 published
with the owner's approval.

### Tasks

Each task is a PR on `phase-19/editing-gaps`, the build green after each, merged after an
agent's review.

- [x] Claim phase, branch `phase-19/editing-gaps`
- [x] 19.1 Horizontal rule: a command and a toolbar button inserting Word's rule (an empty
  paragraph with a bottom border, as Word's AutoFormat makes it), tracked, round-tripped. (Done:
  core's `insertHorizontalRule`, the toolbar's `horizontalRule` item, "Horizontal line", in the
  Insert group. Mid-paragraph it splits twice, as Enter would, so rejecting a tracked rule joins
  the text again; at a paragraph's start it goes before it. The border round-trips as `w:pBdr`
  (a docx test added).)
- [x] 19.2 Find in comments and text boxes: matches in comment bodies (going there opens the
  comment) and in text boxes kept opaque (going there selects the box); replace edits comments,
  skips text boxes and reports them. (Done for comments: core's `findInComments` and
  `replaceInComments` (one undo step, untracked, as Word records no changes in comments), kept
  apart from `findAll` so its matches stay positions of the body and stories; the find panel
  lists the comments found, each going to its thread's text, and offers Replace in comments.
  Text boxes left out: the view does not draw them yet (opaque, `NOT_INLINE` in
  `view/src/word/blocks.ts`), so a match would point at nothing on the page; find in them comes
  with drawing them, After 1.0.)
- [x] 19.3 Extensions in `renderDocument` and `exportPdf`: the same `extensions` array, node and
  mark views drawn on read-only pages; headers, footers and notes too. (Done: `renderDocument`'s
  `extensions`; the view's `customDrawing` reads each custom node into the extensions' schema and
  calls its `render`, else draws its spec's `text`; mark views' attributes on runs; the editor's
  headers, footers and notes as the pages show them use it too. `exportPdf`'s `extensions` is a
  script run in the page before the renderer, setting `globalThis.foliPdfExtensions` (taken once,
  so a page used again does not keep them): functions cannot cross into the page. A custom block
  on read-only pages is kept whole unless taller than a page; copies (headers, notes, later
  parts) are snapshots and `destroy` is not called (limitations). Tested in jsdom and in Chromium's PDF (e2e).)
- [x] 19.4 Tables: a column width field in the table properties (keyboard, undoable); autofit
  tables fitted to their content (Word's rules: preferred widths, minimum content width, the
  page's width), a fixed table untouched; the `shortcut:` in `table.ts` removed. (Done: the Table
  menu's Column width… dialog (`"columnWidth"`, cm, core's `columnAt` and `setColumnWidth`, one
  undo step, not while tracking). Autofit tables are laid out by the browsers' automatic table
  layout with Word's grid as the widths: measured in Chromium, Firefox and WebKit, saved widths
  stay while content fits or wraps and only unbreakable content widens a column, taking from the
  others, then widening the table. The whole table is laid out once and its drawn columns
  (`drawnColumns`) are kept for its parts on each page (drawn fixed at them) and for dragging
  borders, so every page has the same columns and the flow places what it measured. The corpus's
  tables are all fixed, so none of them changes; e2e in three browsers on 06's table made
  autofit. Not Word's algorithm (percent and `auto` preferred widths, the page's room).)
- [x] 19.5 Pictures: rotation (`rot`, read, drawn, 90° commands) and cropping (`a:srcRect`, read,
  drawn, a crop mode), written back to `.docx`; resizing with touch (pointer events). In three
  PRs:
  - [x] 19.5a Schema 6: the picture's `rotation` and `crop` attributes, read from `.docx`, drawn
    (a cropped picture is a box of its size holding the image scaled past it; a rotation is a CSS
    rotation) and written back into the file's own `a:xfrm` and `a:srcRect`. Documents are now
    saved with the lowest schema their content needs (ADR-0008's rule, first used here:
    `schemaVersionOf`), so only one holding a rotated or cropped picture says 6. A v6 fixture.
  - [x] 19.5b Commands and UI: rotate by 90°, a crop mode with handles, set from the picture
    dialog too. (Done: core's `setPictureRotation` (modulo a turn) and `setPictureCrop` (the
    image keeps its scale, so the picture's size follows, as Word's crop does), each its own undo
    step (the dialog's Apply makes one per thing changed), refused while tracking; the picture dialog's Rotation field with Rotate left and right
    90°, and Crop (%) by side. Not built: crop handles on the page, kept for 19.5c with the
    pointer events touch needs.)
  - [x] 19.5c Crop handles on the page, and touch (pointer events) for them and the resize
    handle. (Done: touch. The resize handle's moves and release are pointer events, so a mouse, a
    pen and a finger resize alike; a touch or pen press on the handle starts it (`touch-action:
    none`, a 24 px handle on coarse pointers), and the mouse events the browser emulates after it
    are not a second press. e2e in three browsers with synthetic touch pointer events. Not built:
    crop handles on the page, moved to After 1.0: the dialog crops by keyboard and pointer, and
    handles need a crop mode of their own.)
- [x] 19.6 Drag and drop of text: move inside the document (one undo step; delete and insert when
  tracking), copy with Ctrl, a drop from outside as a paste; the drop caret shown. (Done in the
  view: `dragstart` fills the drag as a copy fills the clipboard; a drop is a paste at the drop
  point, and a move then deletes the dragged range mapped through it, joined to the paste's undo
  step; Ctrl or Option copies; a drop inside the dragged text changes nothing; the selection
  follows the pointer as the drop caret and comes back when the drag ends elsewhere. e2e in three
  browsers with synthetic drag events and a real `DataTransfer`, tracking included.)
- [x] 19.7 Android: Backspace at a list paragraph's start removes its number; a paragraph split
  without `beforeinput` recovered from the DOM mutation's text, not discarded. Tests with
  recorded event sequences; device checks deferred (ADR-0003). (Done in the view: a
  `deleteContentBackward` whose target range is only the boundary before the caret's paragraph
  runs as Backspace at a caret (the list binding lifts the number); a block the browser split off
  one of the view's, the element right after it, is read back as the next block and the change
  replayed as the text and Enter. e2e in three browsers with emulated events (a `StaticRange`
  target, a DOM split as the browser makes it); no recorded device sequences or device checks,
  deferred with the other manual checks.)
- [x] 19.8 Docs, size budgets, changesets; then 1.4.0, published with the owner's approval (the
  Release workflow). (Partly: docs (api.md, architecture.md, document-model.md,
  limitations, the extensions guide, the PDF README) updated with each task; budgets raised with
  their reasons (React 170.0, view 116.2 kB); a changeset per task. Released 2026-11-22 (#202, the
  Release workflow): 1.4.0, agent 0.3.1, mcp 0.2.2, installed from npm and checked. `v6.json` then
  regenerated from 1.4.0 by `generate.mjs` (the other fixtures reproduced unchanged).)

## Phase 20 — The corpus run: real .docx files · M → fixes in 1.4.x

The robustness item of the After 1.0 backlog, picked by the owner on 2026-11-22: every phase so
far was checked against the same nine synthetic documents (`corpus/word/`), written by Word for
the features each phase built. Real files carry what nobody wrote them for. This phase runs
import → export → compare over a large set of real `.docx` files, reports what is lost, refused
or broken, and fixes what the report ranks first. Planned 2026-11-22; being built: see the tasks.

Not in this phase: new features the report asks for (a ranked list for the next phase, not
built here), speed work (the run records times; the misses of Phase 5 stay in the backlog),
`.doc`, `.odt` or `.rtf`, files nobody may redistribute (a private folder is run the same way,
by its owner, printing counts only), manual checks in Word beyond what automation reports.

**Starts from (1.4.0):** `scripts/corpus/import-report.mjs` prints, for a folder, what each
file's import made editable or kept opaque, counts and element names only, never text.
`rewrite-corpus.mjs` writes each file back (`-same`, `-rewritten`, `-exported`, `-edited`)
for Word to check; `word-reference.ps1` records what Word does with a file (pages, revisions,
comments, notes; opened read-only, macros off) and `corpus/reference/word/` holds it for the nine.
`importDocx` reports `opaque`, `dropped` and `unmodeledCount`; it refuses a damaged or too large
package with a `DocxError`. Lossless export is claimed for what the model holds and for what it
keeps verbatim; nothing measures it beyond the nine.

**Sources, proposed (each license checked in 20.1 before anything is fetched):** the test files
of projects that publish them: Apache POI's `test-data/document` (Apache-2.0), LibreOffice's
`sw/qa/extras/ooxmlexport/data` and `ooxmlimport/data` (MPL-2.0), docx4j's sample documents
(Apache-2.0), python-docx's test files (MIT), the Open XML SDK's test files (MIT). Together
several thousand files, many written to break readers: odd structures, old Word versions,
other writers (LibreOffice, Google Docs, WPS, generators). Fetched at a pinned commit into an
ignored folder, each file checked against a manifest of its SHA-256; never committed.

**Acceptance:** ADR-0011 records the sources (with their licenses and pinned commits), what is
fetched and how (`pnpm corpus:fetch`, ignored cache, manifest of hashes), what the run checks and
how a difference is classed, and that reports hold counts, element names and file names, never
document text; at least 1 000 `.docx` files run; no file makes the run crash, hang or exceed a
memory cap (each file in a worker with a time limit: a refusal is a `DocxError` with its
message, counted as such); per file and in total: import refused or not (and why), opaque and
dropped elements, unmodeled values, export without edits compared part by part with the file
(parts added or lost, XML that differs once canonicalized: classed as lost content, changed
values, reordered or reformatted only), a second import of the export equal to the first
(idempotence), an edit then an export that `importDocx` and the schema accept, the read-only
renderer laying it out in Chromium without an error (pages, time), times per step; a sample
(the 50 files the report ranks most at risk, and 50 at random) opened by Word through automation
on the owner's Windows machine: opens without a repair, and its pages, revisions and comments
equal the original's; `docs/corpus-report.md` publishes the totals, the classes of loss ranked by
how many files they touch, and each fix made; the fixes of what ranks first, each a PR with a
reduced fixture written for it (never a third-party file committed), until the owner says the
rest goes to the backlog; `pnpm corpus:run` documented (README, `docs/testing/corpus.md`), not
in `pnpm check` (too long, and it needs the network once); a patch release with the fixes,
published with the owner's approval.

### Tasks

Each task is a PR on `phase-20/corpus-run`, the build green after each, merged after an agent's
review.

- [x] Claim phase, branch `phase-20/corpus-run`
- [x] 20.1 ADR-0011 and the fetch: each source's license read (repository-level: many files are
  bug-report attachments with no license of their own; none is redistributed), its commit pinned, `pnpm corpus:fetch` writing
  the files into `.corpus-cache/` (ignored) and checking each against `corpus/external.json` (url,
  commit, path, SHA-256, license, source). A file that fails its hash is refused, not run. (Done:
  ADR-0011; the five sources' licenses read (Apache-2.0 for POI and docx4j, MPL-2.0 for
  LibreOffice, MIT for python-docx and the Open XML SDK) and their commits pinned; the manifest
  holds 3 551 files (94.5 MB; 3 445 distinct by hash): POI 181, LibreOffice 1 540, docx4j 1 365, python-docx 46, Open XML
  SDK 419. `pnpm corpus:fetch` downloads what is missing and checks every hash (a mismatch is
  deleted and refused); `--update` lists the trees again. Files over 25 MB are left out.)
- [x] 20.2 The runner, `pnpm corpus:run [folder]`: each file in a worker thread (a time limit and
  a heap cap; a worker that dies is that file's failure, the run goes on), the checks of the
  acceptance in Node (import, report, export compared part by part, idempotence, an edit then an
  export), results as JSON lines plus a summary; the part comparison canonicalizes XML
  (namespace prefixes, attribute order, whitespace Word ignores) so only real differences count,
  and names the element and attribute that differ. Tested on the nine and on hand-made broken
  packages. (Done: `scripts/corpus/check.mjs` (the checks of one file on the
  built packages: never throws, a `DocxError`, `ZipError` or `XmlError` is a refusal, anything
  else a crash with the first frame in Foli's code) and `run.mjs` (a pool of workers, each file
  with 120 s and a 2 GB heap, a hung or dead worker replaced; files run once per distinct
  content; `.corpus-cache/results/<time>.jsonl` and a summary of outcomes and of the classes of
  difference by how many files they touch). The comparison counts elements, attribute values and
  text characters per part, prefixes, order and whitespace aside, and reports names only. On
  the nine: all import, export and read back; differences already show (runs merged on export,
  `w:lastRenderedPageBreak` dropped), for 20.4 to class. Four hand-made broken packages (random
  bytes, a truncated file, an empty one, a zip that is not a .docx) are refused, none crashes.)
- [x] 20.3 The renderer pass: the files the Node pass imported, laid out by `renderDocument` in
  Chromium (Playwright), pages and time recorded, an exception or a page that overflows its
  sheet counted. (Done: `pnpm corpus:render`
  (`playwright.corpus.config.ts`, the Word page's setup; `corpus:pages` leaves it out): each
  file the latest `corpus:run` imported, through the Word page's `render` (`renderDocument`,
  markup view); pages, time, page errors and pages whose content overflows their sheet, as
  `<run>.render.jsonl` beside the run; 60 s a file, a hung or crashed tab replaced, a fresh page
  every 200 files. The nine: all laid out, no error, no overflow.)
- [x] 20.4 The first run and the report: the whole set run, the results classed, `docs/corpus-
  report.md` written; the classes ranked, each with how many files it touches and an example
  element (no text). The owner picks with this ranking what 20.5 fixes. (Done: [corpus-report.md](corpus-report.md).
  3 445 distinct files: 3 252 import, export and read back (3 181, 92.3%, with no difference
  counted), 186 refused with a reason (71 Strict Open XML, 60 with the document's root in markup
  compatibility), 7 crash (3 on import: a run property twice; 4 on export: a note reference
  without its note); none hangs. All 3 256 that import lay out in Chromium, 10 with a page that
  overflows. Fourteen classes ranked. The comparison counts what Word shows: runs of one
  formatting joined, empty runs aside, text as Word reads it (`xml:space`), `w:t`/`w:instrText`/
  `w:delText` told apart, what Word writes anew at each save (`rsid*`, `w14:paraId` outside
  comments, `w:proofErr`, `w:lastRenderedPageBreak`) aside, paragraphs matched by their text;
  before it, run merging made about 1 200 files look lossy. 20.5 follows the plan's order:
  crashes, then data loss.)
- [x] 20.5 Fixes, one PR each, in the ranked order: a reduced fixture (written by hand or by
  `build-word-corpus.ps1`) reproducing the loss, the fix, the class's count after it in the
  report. Crashes and data loss first, then refusals, then losses on export, then opaque content.
  (Done: crashes and data loss, #210–#213: a run property written twice, a reference to a
  missing note, tab characters in `w:t`, a field code holding elements, a second `w:pPr`; no
  crash and no paragraph text changed in the whole set. The refusals, Strict Open XML (71) and
  the markup-compatibility root (60), went to the backlog by the owner's choice on 2026-11-22,
  with the classes that change the file without changing what it shows.)
- [x] 20.6 Word on a sample (Windows with Word, `word-reference.ps1` on the originals and their
  exports): opens without a repair, pages, revisions and comments compared; differences added to
  the report. (Done: `scripts/corpus/word-sample.mjs`, 150 files, 30 a project: no export Word
  refuses, 142 of the 143 it measured the same; the one: a literal U+00AD written back
  as `w:softHyphen`. [corpus-report.md](corpus-report.md#word-on-a-sample).)
- [x] 20.7 Bug intake: a GitHub issue template asking for the `.docx` (or a reduced one), the
  browser and what was lost; `docs/testing/corpus.md` on running a private folder. (Done:
  `.github/ISSUE_TEMPLATE/docx-file.yml`, public files only or a reduced copy or the result line;
  [corpus.md](testing/corpus.md): the external set, a private folder, what each file goes through,
  reading the results.)
- [x] 20.8 Docs (limitations from what the report found, the corpus README, `docs/testing/
  corpus.md`), the changesets; then a patch release with the fixes, published with the owner's
  approval (the Release workflow). (Docs done: limitations' `.docx` section, the corpus README's
  external files, `docs/testing/corpus.md` (20.6, 20.7); changesets for the five `@folijs/docx`
  fixes. The release waits for Phase 21, by the owner's choice on 2026-11-23: its fixes, merged
  with changesets, ship in the same patch.)

## Phase 21 — Hardening: what the audit of 1.4.0 found · M → 1.4.x, agent and mcp patches

An audit of every package on 2026-11-22 (one reviewer per area, told to skip what
[limitations.md](limitations.md) already lists) found bugs that lose data, hang the editor or
leak a document between users, none of them reported by a user yet. The owner chose on
2026-11-22 to fix these as a phase before new features. Each item was found by reading the code;
those marked "reproduced" were run by the auditor in a scratch test. Planned 2026-11-22; built
2026-11-23 (#220–#236), each task reviewed by an agent before its merge.

Not in this phase: the features the audit listed (below, under After 1.0), Phase 20's corpus
fixes (its own phase; 21.10 touches `packages/docx` only where Phase 20 has not), the speed
targets of Phase 5, splitting `view.ts`, manual checks (ADR-0003), GitHub settings only the
owner can change (branch protection, a reviewer on the `npm` environment: 21.12 writes them down
for the owner).

**Starts from (1.4.0, agent 0.3.1, mcp 0.2.2):** the code as the audit read it, file and line
given with each task.

**Acceptance:** each bug below has a test that fails before its fix and passes after; no
`limitations.md` entry is added to explain one away unless the owner accepts it as a limit; the
two "verify first" items (21.8) are either reproduced in a browser test and fixed, or written
down in limitations.md as checked and not a bug; `pnpm check` green after each PR; the patch
releases published with the owner's approval.

### Tasks

Each task is a PR on `phase-21/hardening`, the build green after each, merged after an agent's
review. 21.1 to 21.6 lose data, hang or leak: they go first, in this order.

- [x] Claim phase, branch `phase-21/hardening`
- [x] 21.1 MCP: a save never writes over the file another open document came from
  (`mcp/src/documents.ts`, `save` and `#mine`). Reproduced: open `a.docx`, save (writes
  `a.agent.docx`), open `a.agent.docx`, edit, save (back to `a.agent.docx`), save the first
  again: the second document's edits are gone. Refuse with a message naming the other document.
- [x] 21.2 Core: a date control's format cannot hang the editor (`core/src/state/controls.ts`,
  `dateFromText`). Reproduced: `dateFormat: "hdhdhdhdhdhd"`, one keystroke 13 s (the format
  becomes a regular expression of `\S+(\d+)` groups that backtracks). Read the format with a
  linear tokenizer, as `find.ts` avoids regular expressions for the same reason; a test with a
  hostile format under a time limit.
- [x] 21.3 Core and docx: duplicate comment ids. Reproduced: comments `1, 1, 2`;
  `editComment(1)` loses the edit and `resolveComment(2)` overwrites the first comment.
  `parseDocument` refuses duplicate comment ids; docx import (`import/parts.ts`) renumbers them
  (and their anchors), as paste already renumbers. Same check for bookmark names and control
  ids where a duplicate makes a command act on the wrong one.
  (Done: `parseDocument` renumbers them instead of refusing, so a document 1.4 saved with
  them still opens; a reply to a repeated id stays the first's. Bookmark names and control ids need no
  check: a repeated bookmark name acts as in Word, the first found and every one renamed
  together; `importDocx` gives each control an id of its own and paste renumbers them.)
- [x] 21.4 PDF: two `exportPdf` calls on one page cannot mix (`pdf/src/index.ts`). Today the
  second `setContent` replaces the first's DOM while it renders: on a server with a pool of
  pages, one user's PDF can hold another's document. A lock per page (exports on one page run
  one after another), a `signal` (AbortSignal) and a `timeout` option; README: one export per
  page at a time, keep `@folijs/pdf` external in bundlers (it loads `dist/renderer.js` beside
  itself).
- [x] 21.5 View: the browser's page translation cannot rewrite the document. The host has no
  `translate="no"`: Chrome's Translate changes the text nodes, `readBack` takes the change for
  typing, and the translation is saved (as tracked changes while tracking). `translate="no"` on
  the editing host and on `renderDocument`'s pages; an e2e test changing a text node the way a
  translator does.
- [x] 21.6 Docx: a zip entry cannot stand in for another part. `zip.ts` refuses duplicate names
  by lower case only; `package.ts` keys parts percent-decoded, so `word/%64ocument.xml` replaces
  `word/document.xml` silently (probed). Refuse when the decoded key is already taken.
- [x] 21.7 Core, smaller bugs: a new tracked change reuses a table row's revision id
  (`track.ts`, `maxRevisionIn` reads no row attrs: duplicate `w:id` on export); `MERGEFIELD \@`
  takes any value `Date.parse` accepts (`"12"` becomes 2001-12-01; `fieldupdate.ts`): accept
  ISO dates and the document locale's numeric form only; `SEQ \r` with no number restarts at 0;
  `ordinal`, `roman` and `letters` given negative or fractional numbers; a reply whose parent
  is missing cannot be resolved (`comments.ts`, `rootOf`); a string `schemaVersion` gets a
  message saying it must be a number.
- [x] 21.8 View, smaller bugs: `w:widowControl="0"` honoured by the editor's flow and
  `renderDocument` (core resolves it; `layout/flow.ts` keeps two lines always); Ctrl+click on a
  link to a bookmark goes there (TOC entries, cross-references); `beforeinput` types the view
  does not handle are left to the browser or warned about, not cancelled silently
  (`view.ts`, the `preventDefault` before the switch; `formatJustify*`, `insertTranspose`…);
  `render()` and `mountStory` leave the view consistent when they throw (try/finally); control
  popup option ids unique per view; `renderDocument`'s print rules scoped to their own output.
  Verify first, in a browser test: editing inside a shadow root (`hasFocus`, `getSelection`)
  and in a same-origin iframe (`instanceof Element` across realms, `observeSizes`).
  (Done: all fixed. Verified: a same-origin iframe works in the three engines; a shadow root
  did not (focus and selection read from the document): fixed for Chromium, Firefox worked,
  WebKit has no selection inside a shadow root and is written down in limitations.md for the
  owner to accept. Core's `widowControl` set nowhere now resolves as on, as Word does.)
- [x] 21.9 React: `FoliComments` does no work while hidden or without threads, and none per
  keystroke beyond what a change to its threads needs (today `measure()` queries every page and
  forces a layout on each `doc` change); `upload` and `resource` held in refs so an inline
  function does not reset the view each render (`FoliCanvas.tsx`); a built-in dialog closed by
  an outside transaction gives the focus back; the font, size and style boxes apply on Enter,
  not on each arrow. Tests counting renders and subscriptions.
- [x] 21.10 Docx export correctness: a new package writes `w:compat` with
  `compatibilityMode=15` (today Word opens it in compatibility mode); `withSettings` writes
  `doNotUseHTMLParagraphAutoSpacing` to an existing part; an existing relationship whose part is
  missing is reused, not doubled; `xml:space` inherited from an ancestor; a border with both
  `left` and `start` writes one; `docPrIds` reads single-quoted and UTF-16 parts; `.docm`,
  `.dotm` and `.dotx` can be exported as `.docx` (an option, the content type changed, macros
  dropped and reported). Checked against Phase 20's state first: what it fixed meanwhile is
  struck here.
  (Done: Phase 20 had fixed none of these, its fixes were the import's (20.5), so nothing is
  struck. The macro option is `asDocument`, its report the `dropped` callback.)
- [x] 21.11 Agent and MCP, what costs a model retries: `find` loosens the soft hyphen (U+00AD),
  the non-breaking hyphen (U+2011) and the zero-width space, and a refusal quotes invisible and
  look-alike characters escaped; the 200 000-character cut keeps the `more:` line and cuts at a
  block; `null` for an optional argument is taken as absent; a save refused by the system (a
  file open in Word) says so; cuts never split a surrogate pair; an invalid request with an id
  is answered with it; `console.log` bound to stderr in `bin.ts`; a read gives a table cell's
  grid column and marks merged cells.
- [x] 21.12 Tooling: `pnpm test:e2e` (three engines) and `pnpm examples` run in the Release
  workflow before publishing; the site deploy runs `pnpm check` first; e2e configs do not reuse
  a server on a fixed port another checkout may have started (`reuseExistingServer`, as the
  bench config already does); `docs/contributing.md` lists both workflows. Written down for the
  owner, who alone can set them: branch protection on `main` and a required reviewer on the
  `npm` environment.
  (Done: the browser tests and examples run in a Windows job the publish waits for, as the
  visual snapshots are Windows'; not run in GitHub yet, the first release will. Branch
  protection and the reviewer on `npm` written in contributing.md for the owner.)
- [x] 21.13 Docs and release: limitations.md updated ("as of" its version, what this phase
  fixed or accepted), the stale `shortcut:` comments the audit found (`core/src/state/word.ts`
  v2, `mark.ts` Phase 9) removed or rewritten, changesets per package; patch releases
  (packages at 1.4.x, agent, mcp) published with the owner's approval.
  (Done: docs, limitations.md and changesets; the shortcuts rewritten. Published 2026-11-23
  with the owner's approval by the Release workflow, its Windows browser job green first.
  Waiting for the owner: acceptance of two limits written down in
  limitations.md, editing in a shadow root in WebKit and Russian and Ukrainian date controls.
  The new options (`exportPdf`'s `signal` and `timeout`, `exportDocx`'s `asDocument` and
  `dropped`) are under patch changesets; the owner may prefer minor versions.)

## Phase 22 — Real-time collaboration · L → 1.6.0, `@folijs/collab` 0.1.0

Several people edit one document at once, as in Google Docs: each sees the others' typing,
cursors and names within a moment, and the document stays a lossless Word document. Asked for
by the owner on 2026-11-23; planned the same day, nothing built.

The approach is a central authority over steps: the app's server orders every change, each
client rebases its unconfirmed steps over the ones it receives (Google Docs works the same way).
Foli's steps and mapping already do the rebasing; what is missing is listed under "Starts
from". A CRDT binding (Yjs) was weighed and left out: it bypasses steps, so the server cannot
validate a change, a merge can leave a document the schema refuses (a table row with the wrong
number of cells), and Word's envelope and stories would need their own mapping into Yjs types.
22.1 records this as an ADR.

Foli ships the protocol, the client plugin and a server-side authority that runs anywhere
`packages/core` runs (Node, workers, Durable Objects). It ships no transport and no hosted
service: the app passes messages over WebSocket, SSE or anything else, and keeps auth and
storage. A WebSocket example shows the whole loop.

Not in this phase: a CRDT or Yjs binding; offline editing beyond a reconnect (long offline
sessions, peer-to-peer); auth, sharing and permissions UI (the authority takes a callback, the
app decides); version history UI (the step log makes it possible); the agent library and the MCP
server editing a shared document; a hosted service.

**Starts from (1.5.0, `main` after Phase 21), checked again 2026-11-23 when claimed:**

- No `Step` has a JSON form: `ReplaceStep`, `ReplaceAroundStep`, `AddMarkStep`,
  `RemoveMarkStep`, `NodeMarkupStep`, `NodeMarkupBatchStep` (`transform/steps.ts`),
  `CommentStep`, `EnvelopeStep`, `StoryStep` (`state/word.ts`). Selections have one
  (`Selection.toJSON`/`fromJSON`).
- Most envelope changes are not steps: styles, numbering, resources and the rest go through
  `withEnvelope`, a transaction meta (about 15 callers: `wordformat.ts`, `notes.ts`,
  `pictures.ts`, `controls.ts`, `fieldupdate.ts`, `tablecommands.ts`, `review.ts`,
  `stories.ts`, the view, the agent). Steps alone would not carry them to other clients, and
  history does not record them (undo leaves a style change as it is). `EnvelopeStep` covers
  `section`, `settings` and `controls`; `withEnvelope` cannot change `settings` or comments
  (`word.ts:388` takes them from the state), and changes `section` and `controls` too, beside
  `EnvelopeStep`. A story's editor passes its `withEnvelope` change to the body by hand
  (`carryStoryChange`, `stories.ts:65`).
- Whether edits are tracked (`w:trackRevisions`) is the track plugin's state, set by meta
  (`setTrackChanges`, `track.ts:133`), an editor option and an `exportDocx` argument: not part
  of the document (`WordSettingsJSON` has no such key, and its check refuses unknown keys, so
  adding one is a schema change), so neither other clients nor a server's snapshot would have
  it. Every dispatched transaction goes through `trackTransaction` (`editor.ts:603`); it already
  leaves a transaction kept out of history as it is (`track.ts:293`), so a received one marked so
  is not tracked again, but nothing says it was received.
- One plugin filters the body's transactions by what they change: locked controls
  (`controls.ts:946`, `allowed`). A received transaction could be refused there although its
  sender's checks held, and the documents would part. (The stories' filter, `stories.ts:211`,
  is on a story's own state: received steps reach a story through the body, so it is not in the
  way.)
- `StoryStep` replaces a whole header, footer or note (`before`/`after`) and maps to itself: two
  people typing in one header at once would overwrite each other.
- New ids are the largest in the document plus one: revisions (`nextRevisionId`, `track.ts:224`,
  and the rebuild's own counter, `track.ts:319`), comments (`nextCommentId`, `comments.ts:59`),
  notes, controls, numbering instances (`wordformat.ts:921`) and the `_Toc`/`_Ref` bookmark
  names (`bookmarkNames`, `fieldupdate.ts:410`): two clients would give two changes the same id,
  and Word would get duplicate `w:id`s. Phase 21 made import renumber duplicate comment ids
  (21.3) and kept revision ids unique across a document's trees (21.7), within one editor.
- Four plugins append transactions (`comments.ts:338`, `controls.ts:947`, `fields.ts:426`,
  `notes.ts:496`): each client would run them again on steps received from another, doubling
  their steps.
- The history plugin's state is internal (`history.ts:15`, ADR-0008) so this phase can change
  it. It already rebases its events over changes kept out of it, mirroring inverted and rebased
  maps (`RebaseMapping`), which is what received steps need; the client plugin will pair its own
  with `Mapping.appendMap(map, mirror)`.
- Export needs the package the document came from (`DocxImport.package`: latent styles, picture
  bullets, parts Foli does not edit) and the bytes of uploaded pictures: a server must keep
  them beside the document, not the JSON alone.

**Acceptance:**

- Two to five simulated clients making random edits (text, marks, lists, tables, styles,
  comments, tracked changes, headers and notes) with messages delayed and reordered at random
  end with identical documents that the schema accepts, in a property test of at least 1000
  runs; no client's edit is lost.
- Undo undoes only the user's own changes, mapped over everyone else's.
- The authority refuses a malformed message, a step that does not apply, a stale version
  (the client rebases and resends) and a message over its size limit, without changing the
  document.
- A client that disconnects and comes back catches up from its version, or from a snapshot when
  the log was compacted past it.
- A document edited by three clients and exported from the authority's snapshot and package
  matches the export of the same edits made in one editor; the parts Foli does not edit are
  byte for byte the original's; Word opens it.
- Two browsers over WebSocket (e2e): both type in the same paragraph and see each other's text,
  carets and names; the tracked changes carry each user's name.
- Keystroke time with remote steps arriving (four clients, a 50-page document) measured with
  `pnpm bench` against the single-user baseline.
- `pnpm check` green after each PR; 1.6.0 and `@folijs/collab` 0.1.0 published with the
  owner's approval.

**Verified (2026-11-23):** convergence: `collab.property.test.ts`, 2–5 clients, 10–40 random edits
a run (text, deletions, bold, lists, styles, tables, comments, tracking, a header, notes, undo),
sends and deliveries interleaved and reordered, 1000 runs, identical documents `parseDocument`
accepts, every kind of edit seen; typed text never lost (300 runs); a heavier run (30–80 edits,
seeds 1–8) found one divergence that does not replay alone (limitations.md). Undo of one's own
changes only: the same file. Refusals without change, catching up from the log or a snapshot,
the export from the snapshot and package equal to one editor's with untouched parts byte for
byte: `packages/collab/src/authority.test.ts` (Word opening it is not tried by hand). Two
browsers over WebSocket: `examples/e2e/collab.spec.ts`, three engines locally (the whole
`pnpm examples` not run). Keystroke time with remote steps: `pnpm bench`'s new case, a miss
written in benchmarks.md. Released 2026-11-24 as 1.6.0 (#252).

### Tasks

Each task is a PR on `phase-22/collab`, the build green after each, merged after an agent's
review. 22.2 to 22.6 make the editor ready for collaboration and are useful alone (22.2 also
lets the agent library return steps); 22.7 onwards build it.

- [x] Claim phase, branch `phase-22/collab`
- [x] 22.1 ADR-0012 Collaboration: central authority over steps, not a CRDT (the reasons
  above); the message protocol (`{ version, steps, clientID }`, confirm, refuse); what Foli
  ships and what the app keeps (transport, auth, storage); how ids, envelope changes and
  stories are handled (22.3–22.5); what a snapshot holds (document, package, resources).
- [x] 22.2 Steps as JSON: `toJSON` on every step and `Step.fromJSON(schema, json)`, with a
  registry (`Step.jsonID`) so an extension can add its own; slices keep `ext`, `attributes` and
  opaque nodes. Property test: random transactions → JSON → applied on a second state give the
  same document. `fromJSON` validates its input (a trust boundary: it will read the network).
- [x] 22.3 Envelope changes as steps: `withEnvelope` keeps its signature but adds an
  `EnvelopeStep` for each key it changes (`styles`, `numbering`, `resources`, `section`,
  `controls` and the rest it can change; a list in the ADR), with `before` and `after` so a
  change made from a stale value is refused. This changes undo: a style or numbering change is
  undone with the edit it came with (today it stays); limitations.md and the changeset say so.
  The tracking switch becomes a `settings` value carried by a step, read by the track plugin
  and by `exportDocx` when no argument is given. Tests for each caller listed above.
- [x] 22.4 Stories that merge: a story change carries the story's own steps (story id + steps)
  instead of the whole story, so two edits in one header rebase. `StoryStep` kept for
  creating and removing a story. Tests: two transactions in one footer, applied in either order,
  give the same footer.
- [x] 22.5 Ids unique across clients: revision, comment, note, control ids and bookmark names
  never collide between two editors of one document (an id space per client, from its
  `clientID`). Export unchanged for a single editor. Test: two editors tracking changes at once,
  exported, have unique `w:id`s.
- [x] 22.6 Received transactions are applied as they are: this task defines a `remote` meta
  (22.7 sets it; the tests here set it by hand). With it, the four appending plugins add
  nothing (the sender already sent their steps), the filter of locked controls lets it
  through (the sender's checks held, and the authority's `authorize` decides), and
  `trackTransaction` leaves it untracked. Test: two editors stay identical after edits that
  trigger each plugin and filter, tracking on.
- [x] 22.7 The client plugin (`packages/core`, headless): `collab({ version, clientID })`,
  `sendableSteps(state)`, `receiveTransaction(state, steps, clientIDs)`, `getVersion(state)`.
  Unconfirmed steps are rebased over received ones through mapping; history takes received
  steps as not undoable and maps its own events over them. The convergence property test of the
  acceptance list lives here.
- [x] 22.8 `@folijs/collab`, the authority: `createAuthority({ document, package?, limits })`
  with `receive(version, steps, clientID)` → accepted or refused with the reason,
  `stepsSince(version)` (or a snapshot), a snapshot (document, package, resources) and
  compaction of the log. It validates every step by applying it with `packages/core`; an
  `authorize(clientID, steps)` callback lets the app refuse edits (a read-only user). No
  transport, no storage: the app persists what it gives. Size limits on messages, steps per
  batch and the log.
- [x] 22.9 Presence: a message with a client's name, colour and selection (as JSON), mapped
  through changes until the next one. The view draws remote carets and selections with the
  CSS Custom Highlight API, as find does, and the name beside the caret; nothing added to the
  document or its undo; reduced motion respected. A presence list for apps
  (`presence(state)`).
- [x] 22.10 Authorship: each client's tracked changes and comments carry its user's name; a
  received step keeps its author.
- [x] 22.11 Example and e2e: `examples/collab`, a Node WebSocket server (the authority, a JSON
  file as storage) and a page with the editor; the playground shows two editors side by side
  over an in-memory transport. Playwright: two pages type in one paragraph and converge; one
  drops its connection and catches up; the exported .docx opens.
- [x] 22.12 Speed: a `pnpm bench` case with remote steps from four clients arriving while the
  user types in a 50-page document; a miss is written down in benchmarks.md, not hidden.
- [x] 22.13 Docs and release: architecture.md (the collab loop), api.md, a site page (how to
  wire a transport and a store), limitations.md (no CRDT, no long offline, what the app must
  do), changesets; 1.6.0 and `@folijs/collab` 0.1.0 published with the owner's approval.

## Phase 23 — Agent editing parity · M → agent 0.4.0, mcp 0.3.0, 1.7.0 (schema 8)

The agent does what a person does in the editor, not only text: it inserts tables and edits
their rows, columns, cells and styles; formats text (bold, italic, font, size, colour,
highlight, links) and paragraphs (alignment, spacing, indentation, lists); inserts pictures,
breaks and notes; edits headers and footers; accepts and rejects changes. Asked for by the owner
on 2026-11-23 after trying the MCP server: the agent could not add a table or a row. Planned the
same day, nothing built.

The work lives in `@folijs/agent`: an app that runs its own model loop, without MCP, gets every
operation as a session method and the tool definitions to give its model (names, descriptions,
JSON Schemas, the instructions), so it writes no schema of its own. `@folijs/mcp` and code mode
(`run`) are built from the same definitions and add nothing an app could not do with the
package alone. Most operations wrap core commands the editor already has, taking handles
instead of positions. Tools are few (one per area, an `action` field), not one per command:
every tool's description costs the model context.

Not in this phase: the agent editing a shared document (Phase 22 leaves it out too); a picture
from a URL (the MCP server reads files under its root only); comments' own formatting; text
boxes and other opaque content; Word features the editor itself lacks (the After 1.0 backlog).

**Starts from (agent 0.3.x, mcp 0.2.x), checked 2026-11-23:**

- The session's operations (`agent/src/operations.ts`, `templates.ts`): `replaceText`,
  `insertAfter`/`insertBefore` (paragraphs only), `deleteBlock` (a paragraph or a whole table),
  `setStyle` (paragraph style), `comment`, `fillControl`, `updateFields`. limitations.md says
  so: "No operation inserts a table or a picture, changes a run's formatting (bold, color), or
  accepts or rejects changes." `session.editor` reaches the rest by positions, but neither the
  MCP tools nor `run` expose it.
- The tool definitions (names, descriptions, JSON Schemas) exist only in `@folijs/mcp`
  (`mcp/src/tools.ts`), tied to the server; an app using `@folijs/agent` directly writes its
  own, from the README's suggested system prompt.
- Core has the commands: tables (`tablecommands.ts`: `insertTable`, `insertRow`,
  `insertColumn`, row and column deletion, merge and split, header rows, `setTableStyle`,
  `setCellShading`, `setColumnWidth`), marks and run formatting (`toggleMark`, `setFontFamily`,
  `setFontSize`, `setTextColor`, `setHighlight`), paragraphs (`setAlign`, `setLineSpacing`,
  `setParagraphSpacing`, `changeIndent`), lists (`toggleList`, `sinkListItem`,
  `liftListItem`), links (`insertLink`, `setLink`, `removeLink`), `insertPicture`,
  `insertNote`, `insertSectionBreak`, `insertHorizontalRule`, page breaks, and review
  (`acceptChange`/`rejectChange` and the rest of `review.ts`).
- Every agent edit is a tracked change, and while tracking core refuses column commands,
  merging and splitting cells, header rows, table styles, shading and column widths
  (`tablecommands.ts`; limitations.md, Tables). Rows are tracked; run and paragraph formatting
  are tracked as formatting changes (`track.ts`).
- `read` shows a paragraph's style, list number and changes, not its run formatting: the model
  cannot see what is bold before changing it.
- Only the body is read and edited; headers, footers and notes' text are not shown.
- Links are not recorded while tracking: `link` is not in `RUN_PROPERTY_MARKS`
  (`v3/schema.ts`), so `recordRun` (`track.ts`) skips it and rejecting all leaves a link added.
- `run`'s API is written by hand in `mcp/src/code.ts` (`METHODS`, a `switch` of methods,
  `DOC_TYPES`), apart from the MCP tools.

**Acceptance:**

- Each area below is a `@folijs/agent` session method by handle, usable with no MCP server,
  with refusals a model can act on (as today's: a code and a sentence saying what to do
  instead) and tests in `agent` alone (`scenarios.test.ts` style: an edit, the read after it,
  export, reject all gives the document back where it can); then its tool in `agentTools`,
  the MCP server and `run`.
- `agentTools(session)` in `@folijs/agent`: each tool's name, description, JSON Schema and a
  function that runs it on the session, and the instructions text; an app maps them to its
  model's tool format. `@folijs/mcp` builds its tools and `run`'s methods and types from it,
  and adds what is the server's: `open`, `save`, `close`, `list_documents`, `run` and its
  sandbox, the `document` argument, and the wrapper around each call (checkpoint, size limit,
  rollback).
- Tables: insert a table (rows, columns, optional header row and cell text) next to a block;
  insert and delete rows and columns; merge and split cells; set the table style, a cell's
  shading, a column's width, header rows. While tracking, each is a tracked change Word shows
  and round-trips, or is refused with the reason (23.2 decides which, from what Word writes).
- Text formatting on a block or on text in it (`on`, as `comment` takes it): bold, italic,
  underline, strikethrough, superscript, subscript, font, size, colour, highlight: tracked as
  formatting changes. Links added, changed and removed: tracked as Word records them (a
  hyperlink field's insertion and deletion), or refused while tracking with the reason; 23.2
  decides, as for tables.
- Paragraph formatting: alignment, spacing before and after, line spacing, indentation; lists
  (bulleted, numbered, a level in or out, a number removed). Tracked.
- Insert: pictures (bytes and type in the package, a file under the root in the MCP server;
  alt text required, size), page and section breaks, horizontal rules, footnotes and endnotes
  (with their text).
- Headers and footers: read and edited with the same operations, their blocks' handles marked
  as theirs in a read.
- Review: list the document's tracked changes (author, kind, text), accept or reject one, all,
  or all by an author. Off unless asked for (a session option in the package, `--review` in the
  MCP server, as `--code` is): a model accepting a person's changes is not undone by rejecting
  the agent's.
- `read` can show run formatting (an option, off by default so reads stay short).
- READMEs, limitations.md, the MCP server's instructions and tool descriptions updated;
  `pnpm check` green after each PR; agent 0.4.0, mcp 0.3.0 (and any core patch) published with
  the owner's approval.

### Tasks

Each task is a PR on `phase-23/agent-parity`, the build green after each, merged after an
agent's review. Starts after Phase 21 (21.7 and 21.11 change `track.ts` and the agent's read of
table cells). Independent of Phase 22, but 22.5 and 22.6 also change `track.ts`: whichever
lands second merges the other in (no rebase: force push is blocked).

- [x] Claim phase, branch `phase-23/agent-parity`
- [x] 23.1 ADR-0013 Agent tools: one tool per area with an `action` field (the list above),
  how a handle names a table, row, column or cell (the table's handle and indexes, as `read`
  prints `r1 c1`), and how `on` names text in a block for formatting. Then `agentTools(session)`
  in `@folijs/agent` for today's operations, moved from `mcp/src/tools.ts`; the MCP tools and
  `run`'s `METHODS`, method switch and `DOC_TYPES` (`mcp/src/code.ts`) built from it, the
  per-call wrapper staying in `mcp`, with no change a model sees (`server.test.ts` and
  `code.test.ts` unchanged). Tool count and description length measured before and after.
  Each later task adds its operation to the session first, then its tool to `agentTools`,
  which gives it to MCP and `run` too.
  Done: `AGENT_TOOLS`, `agentTools(session)`, `INSTRUCTIONS` and `invalid` in
  `@folijs/agent` (`agent/src/tools.ts`, `schema.ts`); the server's tools, `run`'s methods and
  its `doc` summary built from them. What a client lists compared as JSON before and after:
  the same bytes, 14 tools and 2,978 description characters (8,273 with schemas), 15 and 5,658
  (11,236) with `--code`; ADR-0013 has the table.
- [x] 23.2 Core: table structure and links while tracking. What Word records for each table
  command (`w:tblPrChange`, `w:tcPrChange`, `w:trPrChange`, `w:tblGridChange`, `w:cellIns`,
  `w:cellDel`, `w:cellMerge`) and for a link, from ECMA-376 and from tracked tables in the
  Phase 20 corpus; files saved by Word 365 only if the owner supplies them (no manual check is
  waited for). Track in core what is recorded that way and round-trips; keep refusing the rest
  while tracking with a reason the agent passes on (the fallback for all of it if the sources
  disagree). Findings and the list of what stays refused in limitations.md.
  Done. Found in the Phase 20 corpus (3,551 files; no Word 365 files supplied): Word wrote
  `w:tblPrChange` in 61 files, `w:tcPrChange` in 62, `w:tblGridChange` in 63, `w:trPrChange`
  in 3, `w:cellIns` and `w:cellDel` in 3 each, `w:cellMerge` in none (Word records a merge as
  `w:tcPrChange` holding the old `w:gridSpan` or `w:vMerge`); the elements agree with ECMA-376.
  Tracked now (schema 8, a `formatChange` on tables, rows and cells, `tableFormatting` in
  `trackedChanges`): table styles, header rows, cell shading, read from and written to `.docx`;
  the 62 corpus files with them round-trip their 675 records and accept and reject cleanly.
  Links added, changed or taken off while tracking are the text deleted and inserted again with
  the link (Word has no record of a link; before, the link itself was not tracked). Still
  refused while tracking, with the reason in limitations.md: column insertion and deletion,
  merging and splitting, column widths (each needs cells inserted or deleted, a grid change and
  cell formatting recorded together).
- [x] 23.3 Agent: tables. `insertTable` next to a block (rows, columns, header row,
  cell text), rows and columns in and out, merge and split, style, shading, widths, header
  rows; one tool `edit_table`; `run` methods.
  Done: `insertTable`, `insertRows`, `deleteRows`, `setCells`, `tableStyles`,
  `setTableStyle`, `shadeCells`, `setHeaderRows` on the session, the `edit_table` tool and
  eight `run` methods; `read` counts a row's `gridBefore` and marks a table with recorded
  formatting as changed. Columns, merging, splitting and widths are refused with what to do
  instead (23.2 left them untracked). Tools: 15 and 10,942 characters with schemas (16 and
  14,428 with `--code`).
- [x] 23.4 Agent: text formatting and links on a block or on `on` text; `read` option
  showing run formatting; one tool `format_text`.
  Done (merged with 23.3 in one PR: they were built together): `formatText`, `read`'s
  `formatting` option (a line under a paragraph with its runs' own formatting), the
  `format_text` tool and `formatText` in `run`. 16 tools, 12,646 characters with schemas (17,
  16,262 with `--code`); ADR-0013's aim raised for `--code`. 23.3's review fixed with it: row
  commands in a vertically merged table act on the row named; several edits all or nothing;
  code mode counts what changed, not the whole table.
- [x] 23.5 Agent: paragraph formatting and lists; one tool `format_paragraph`.
  Done: `formatParagraphs` (alignment, line spacing, space before and after, indent, bullet
  and numbered lists; paragraphs next to each other one list), `read`'s formatting line starts
  with the paragraph's own properties, the `format_paragraph` tool and `doc.formatParagraphs`.
  17 tools, 14,036 characters with schemas (18, 17,702 with `--code`).
- [x] 23.6 Agent: insert pictures (bytes and type in the package; in the MCP server a path
  under the root, size limits as `open`'s; alt text), page and section breaks, horizontal
  rules, footnotes and endnotes; one tool `insert`.
  Done: `insertItem` (picture, page and section breaks, horizontal line, footnote, endnote),
  `imageInfo`, the `insert` tool and `doc.insert`; a `ToolHost` gives the tools a picture's bytes
  by path (the MCP server reads .png, .jpg and .gif under its root). 18 tools, 15,709 characters
  with schemas (19, 19,579 with `--code`).
- [x] 23.7 Agent: headers and footers read and edited (the stories), handles marked
  with their story in a read; the existing tools take them.
  Done: `read({ headers: true })` and the read tool's `headers`, each story under where its
  sections use it; handles `h…` and `f…` (a `Handles` per story, following the body editor's
  changes through the story's mapping); every operation runs in the story's editor, `comment`
  refused there; the server's instructions and `run`'s summary say so.
- [x] 23.8 Agent: review (list changes, accept or reject), a session option turning it on;
  the tools behind `--review` in the MCP server.
  Done: core's `acceptChangesById` and `rejectChangesById` (the changes named, not those around a
  selection); `SessionOptions.review`, `changes`, `acceptChanges`, `rejectChanges`; the `review`
  tool, offered only to a reviewing session (`toolsFor`), and `--review` in the MCP server;
  `run`'s summary lists the review methods only there.
- [x] 23.9 A scenario per area run twice with a model's kind of calls: through `agentTools`
  on a session alone (no MCP), and through the MCP server (`mcp/src/server.test.ts` with
  `testing/client.ts`): build a table from data, add a row to an existing one, format a
  heading, make a list, insert a picture; each exported and opened again. Then a fresh model
  given only the tools' own words does the same tasks, as in 14.8 and 16.6; what it got wrong
  goes into the descriptions, and the result is recorded here.
  Done (2026-11-24). Scenarios on the corpus's 04-board-report through `agentTools` alone
  (`agent/src/scenarios-23.test.ts`) and through the server with the SDK's client
  (`mcp/src/scenarios-23.test.ts`): a table built from data with a header row, a row added to
  the appendix's table, a heading colored and centered, a numbered (bulleted) list made of new
  paragraphs, a picture inserted from a file, the header edited; exported and opened again,
  every change the agent's. Then a fresh Claude agent, told only what the built server says of
  itself, through the SDK's client against `dist/bin.js` (each call replayed in a fresh server):
  five tasks on the report and three on the business letter (a price table in place of three
  tabbed lines, the subject bold, a paragraph's sentences as a bulleted list). 22 calls, none
  refused; it saw the subject was bold already, and left a comment where the report had a
  picture it could not identify. Word 16.0 opens both files, every revision the trial's
  author's (2 tables, the picture and the comment in the report; the table in the letter). What
  it found unclear, now in the tools' words: what `insert_table`'s `header` does; that new
  paragraphs take the neighbour's indents and numbering; a picture, now read as
  `[picture: its alt text]`; a table's style and header rows, now on its line
  (`table, 3 rows, 2 columns, Table Grid, 1 header row`); `delete_block`'s answer, which now
  says a tracked deletion (or its own insertion removed). Left as is: a table's borders are
  not read, and an answer gives the blocks changed, not where they are (a read shows it).
- [x] 23.10 Docs and release: agent and MCP READMEs, limitations.md (Agent editing), the
  server's instructions, the site's agent page; changesets; agent 0.4.0 and mcp 0.3.0 (and any
  core patch) published with the owner's approval.
  (Docs done 2026-11-24: the agent and MCP READMEs (the site's Agents and MCP server pages),
  limitations.md's Agent editing, the server's instructions, architecture.md, api.md, ADR-0013
  (its cost table to the end of the phase); changesets: `@folijs/agent` minor (0.4.0), `@folijs/mcp` minor (0.3.0),
  `@folijs/core` and `@folijs/docx` minor (1.7.0, schema 8), `@folijs/react` patch. Publishing
  was approved by the owner: released 2026-11-24 (#268, the Release workflow, run 45486606305;
  its browser job failed once on a flaky Firefox collab test and passed on a rerun). The release
  also carried another phase's
  `@folijs/react` change already on main, `.changeset/react-word-colors-fonts.md`. Superscript
  and subscript, in this phase's list, were not built: core has no command for them.)

## Phase 24 — Collaboration, easy to integrate · M → 1.8.0, `@folijs/collab` 0.2.0

An app wires collaboration up without trial and error, over whatever transport it already has.
Asked for by the owner on 2026-11-24, from an integrator's coding agent that got 0.1.0 working
only after a week of chasing "works for one character, then stops". Its six points, and what this
phase does with each: version numbers undocumented (24.1); no tested example of a host and a
joiner (24.4); a broadcast that does not fit the editor's version is applied without a word
(24.2); the collab plugin cannot be added or removed without rebuilding the editor (24.5);
shared cursors wired by hand (already built, `connect` sends them: 24.3); an official Yjs
connector holding the document (left out, below). Planned the same day, nothing built.

Not in this phase: a Yjs (or any CRDT) binding that keeps the document in Yjs: ADR-0012 chose a
central authority, Word's envelope and stories have no Yjs mapping, and the library stays
neutral to the transport (Yjs, WebSocket, WebRTC and BroadcastChannel all carry 24.3's
messages). Moving the authority to another browser when the hosting one leaves (it needs the
document as last confirmed, without the leaving host's pending steps): written down for later.
Offline editing over days, as in Phase 22.

**Starts from (core 1.6.0, collab 0.1.0), checked 2026-11-24:**

- `authority.receive()` returns `Received.version`, the version after the steps, and
  `broadcast.version`, the version before them (the one a client must be at to apply it). The
  sender gets its own broadcast too: that is how its steps are confirmed. Neither README nor
  TSDoc says which version is which.
- `receiveTransaction(state, steps, clientIDs)` (`core/src/state/collab.ts`) takes no version and
  checks none: it adds `steps.length` to the editor's version whatever it is given. A broadcast
  applied twice, the sender's own echo skipped, or `Received.version` used as the broadcast's
  leaves the count off; every later send is then refused as `stale`, and an app that drops
  refusals stops with no message. A step that no longer applies throws from `tr.step`.
- Every app writes the same client loop: `examples/collab/src/main.ts` spends about 100 lines on
  one batch in flight, broadcasts held until their version is reached, catching up after
  `stale` or a reconnect, and sending presence. The guide repeats it.
- Presence is built: `presenceMessage`, `receivePresence`, `presence` and `removePresence` in
  core; `EditorView` draws the others' carets (`view/src/word/presence.ts`, body only); the guide
  has a section on it. Apps miss it, and its sending is theirs to wire.
- `createEditor` reads its plugins once; React's `useFoliEditor` (`react/src/editor.tsx`) warns
  in development when `plugins` changes and tells the app to give a new `key` (ADR-0008). Starting
  or leaving a session therefore rebuilds the editor: version, undo history and view state lost.
- `authority.test.ts` drives the authority with core's client functions, but no test is written
  as an app would integrate: a host in a browser (an authority and its own editor) and a joiner,
  over an unreliable channel.

**Acceptance:**

- The version contract written once and linked from everywhere it matters: TSDoc on
  `Broadcast`, `Received`, `getVersion`, `sendableSteps` and `receiveTransaction`, both
  READMEs, the guide (with a "my edits stop" section: the causes above and what each looks like).
- `receiveBroadcast(state, broadcast)` in core: takes a broadcast as received (its `version`,
  JSON steps and `clientIDs`), compares its version with `getVersion`, and returns what happened:
  applied (with the transaction to dispatch), already had (nothing to do; a broadcast that
  overlaps what the editor has applies only the part it lacks) or a gap (the version it has and
  the one it got: the app asks for `stepsSince`). `receiveTransaction` keeps its signature and
  gains a version check that throws a `RangeError` naming both versions when given one that
  does not fit. Property test: random delivery order, duplicates and drops, the editors agree
  with the authority after catching up.
- `@folijs/collab` gives the loop, transport-neutral: `connect(editor, { send, clientID, name,
  color })` returns `{ receive(message), destroy() }` and does one batch in flight, holding early
  broadcasts, catch-up after `stale` or a gap, resending after a reconnect, and presence (sent on
  selection change and after receiving, received and removed). `hub(authority)` on the other
  side turns a client's message into what to send everyone and what to send back to it
  (broadcasts, refusals, catch-ups, presence relayed). The messages are JSON a transport carries
  as text. A host in a browser is a hub with its own editor connected in memory.
- A test written as an app would: a host and a joiner over a channel that reorders, duplicates
  and drops messages, several rounds of concurrent edits from both, a reconnect and a catch-up
  from a snapshot, both documents and both presences equal to the authority's at the end; once
  with the raw functions (`collab`, `sendableSteps`, `receiveBroadcast`, `getVersion`,
  `createAuthority`), once with `connect` and `hub`. The guide's "host in a browser" example is
  that test's code. `examples/collab` moves onto `connect` and `hub`, and its e2e stays green.
- `editor.reconfigure({ plugins })` in core: the document, selection and the state of every
  plugin in both lists kept (history keeps its undo), added plugins initialised on the current
  state, removed ones dropped. React's `plugins` prop follows changes through it instead of
  warning (extensions still read once). ADR-0008 amended. Starting a session on the editor's own
  document (the host) and leaving one keep the editor and its undo; joining someone else's loads
  their document, as before.
- READMEs, the guide, limitations.md and the site's collab page updated; `pnpm check` green after
  each PR; the next core minor and collab 0.2.0 published with the owner's approval.

### Tasks

Each task is a PR on `phase-24/collab-integration`, the build green after each, merged after an
agent's review. Starts after Phase 22 (done). Independent of Phase 23: it touches `collab.ts`,
`state.ts`, `editor.ts`, `react/src/editor.tsx` and `packages/collab`, not `track.ts` or the
agent; if both change a shared file, whichever lands second merges the other in (no rebase).

- [x] Claim phase, branch `phase-24/collab-integration`
- [x] 24.1 The version contract in TSDoc, both READMEs and the guide, with the "my edits stop"
  section. Docs only: what 0.1.0 already does.
  Done: the guide's Versions and My edits stop sections, the collab README's Versions
  paragraph, TSDoc on `Broadcast`, `Received`, `getVersion`, `sendableSteps` and
  `receiveTransaction`; core's README links the guide.
- [x] 24.2 Core: `receiveBroadcast` with its three outcomes; the version check in
  `receiveTransaction`; the property test over reordered, duplicated and dropped broadcasts.
  Done: `receiveBroadcast` (`applied`, `had`, `gap`; an overlapping broadcast applies only what
  the editor lacks), `BroadcastJSON` and `ReceivedBroadcast`; `receiveTransaction`'s optional
  fourth argument; `broadcast.test.ts` (an overlap starting inside the editor's own batch
  included), and 300 property runs (fixed seed) of 2–4 clients, 30–60 edits, over a channel that
  reorders, repeats and loses broadcasts and catches up from before the editor's version
  (counted while the edits run: over 50 duplicates, 20 gaps and 50 partial overlaps). The run
  found Phase 22's known mark divergence about once in 4000 runs and shrank one that replays
  alone: pinned as an expected failure, limitations.md updated; fixing it is not this phase's.
- [x] 24.3 Collab: `connect` and `hub`, their message types, presence through them; unit tests of
  each case (stale, gap, duplicate, reconnect, a client refused for good).
  Done: `createHub(authority)` (`join`, `receive`, `leave` giving `Outgoing[]` to everyone, the
  sender or the others; presence relayed under the connection's id and kept for those who join)
  and `connect(editor, options)` (`receive`, `resume`, `destroy`; `onSnapshot`, `onError`), with
  `ClientMessage` and `HubMessage`; `connect.test.ts` covers each case over hand-delivered
  queues. A snapshot still means a new editor (24.5 reconfigures plugins, not the document).
- [x] 24.4 The host-and-joiner test over an unreliable channel, both ways (raw functions,
  `connect` and `hub`); the guide's host-in-a-browser example from it; `examples/collab` and
  its e2e on `connect` and `hub`.
  Done: the guide's samples (`apps/site/src/guides/collab.ts`) are `host` (an authority, its hub
  and the host's editor connected in memory) and `joinHost`, and the by-hand `serve` and `join`
  (on `receiveBroadcast`); `collab.test.ts` beside them runs both over lanes that reorder,
  repeat and drop messages (three seeds for the host, one with a log short enough that the
  joiner starts again from a snapshot; two by-hand clients). The guide opens with A host in a
  browser. The hub's `snapshot` message now carries its client id. `examples/collab` on
  `createHub` and `connect`.
- [x] 24.5 Core: `editor.reconfigure({ plugins })`, tests that undo survives adding and removing
  `collab` and that every kept plugin's state carries over; React's `plugins` prop through it;
  ADR-0008 amended. The riskiest task: a plugin whose state depends on another's is checked.
  Done: `EditorState.reconfigure(plugins)` (a plugin given again keeps its state; new ones
  `init` on the current state); `editor.reconfigure` swaps the app's plugins in the body and open
  stories, keeping built-ins and extensions' (history keeps its undo), and makes `commands` again
  (a clash throws first); `reconfigure.test.ts`; React's `plugins` through it
  (`items.test.tsx`); ADR-0008 amended; the guide says how a person starts sharing their open
  document.
- [x] 24.6 Docs and release: READMEs, guide, limitations.md, the site's collab page; changesets;
  the next core minor and collab 0.2.0 published with the owner's approval.
  Done but the release: READMEs (core, collab, the example), api.md, the guide (it is the site's
  collab page), limitations.md (the hub's limits, the host leaving, a lost last message) and three
  changesets (core and react minor, collab minor). Released 2026-11-25 as 1.8.0 (#277), with
  `@folijs/collab` 0.2.0, `@folijs/agent` 0.4.1 and `@folijs/mcp` 0.3.1; `pnpm bench` passed
  before it. The fix for the pinned mark divergence (#278, #280) followed as 1.8.1 (#283), with
  `@folijs/collab` 0.2.1, `@folijs/agent` 0.4.2 and `@folijs/mcp` 0.3.2 (2026-11-25); its two bench
  runs flagged different engines each time, read as a busy machine (the PR says why).

## Phase 25 — Word ribbon · M → 1.9.0

The toolbar looks and works like Word's ribbon: tabs of captioned groups (Home: Undo, Font,
Paragraph, Styles…), the contextual tabs Word shows for a table and a picture, References and
View tabs, large buttons, a group's dialog launcher, a ribbon that collapses, groups that shrink
step by step before going under More, and KeyTips (Alt, then letters). Asked for by the owner
on 2026-11-24 ("a pretty similar experience to Word"). Planned the same day, nothing built.

The work lives in `@folijs/react` (`FoliToolbar.tsx`) and is built from commands core already
has: no engine change, no schema change. It can run beside Phase 23 (`@folijs/agent` and
`@folijs/mcp`) and Phase 24 (`@folijs/collab`), and touches no root tooling. The ribbon is
opt-in: `FoliToolbar` without `tabs` and `defaultToolbarTabs` stay as they are (1.x semver;
`defaultToolbarTabs` promises arrays only), and the Word ribbon is a new export,
`wordRibbonTabs`.

Not in this phase: the File tab and its backstage (open, save and print are the app's); a Quick
Access Toolbar; zoom, a ruler, a status bar, format painter, showing ¶ marks, Paragraph and Font
dialogs (the After 1.0 backlog: once one exists, its group gets a launcher); Mailings, Design,
Draw and the other Word tabs with no commands behind them; Word's icons (Foli draws its own: no
Microsoft artwork or branding beyond the tabs' ordinary words).

**Starts from (1.6.0), checked 2026-11-24:**

- Tabs and captioned groups exist (15.3, #152): `ToolbarTab { key, label, items, visible }`,
  `ToolbarGroup { label, items }`, WAI-ARIA tabs, `tab`/`onTabChange`/`defaultTab`,
  `overflow: "menu"` putting whole groups under More, `messages` for every string (api.md,
  Toolbar tabs).
- `defaultToolbarTabs` has Home, Insert, Layout and Review, every built-in item once, in
  uncaptioned groups (`FoliToolbar.tsx:1321`). There is no References or View tab and no
  contextual tab.
- Table commands are entries of one Table menu (`FoliToolbar.tsx:532`: insert table, rows and
  columns, delete, merge, column width, header row); `tableStyle` and `cellShading` are items of
  Layout. A selected picture is edited through the picture dialog (alt text, size, crop,
  rotation).
- Fields, notes and controls are menus of Insert; the table of contents and cross-reference are
  entries of Fields; `toggleFieldCodes` is Alt+F9 and the Fields menu's "Show field codes"
  entry; the navigation pane is the `navigate` item, the review view the `reviewView` item;
  Page Setup and note options are dialogs opened from the Section and Notes menus.
- Every item is the same size (an icon or a short label); a group has no launcher; the ribbon
  cannot be collapsed; nothing reacts to Alt.
- The playground's editor (`apps/playground/src/edit.tsx:121`) shows the flat toolbar, not tabs.

**Decisions to take in 25.1** (recorded in api.md; an ADR if one reaches past the toolbar):

- KeyTips and the browser: Alt alone opens the menu bar in Firefox and some Windows browsers,
  and Alt+letter is taken by browsers and screen readers. Proposed: Alt pressed and released
  alone, with the focus in the editor or the toolbar, shows the KeyTips (Word's gesture); no key
  is taken while a chord is in progress; an app turns KeyTips off with a prop. That NVDA and
  JAWS keep their own Alt keys is a manual check, deferred as the other screen-reader checks are.
- How groups shrink: Word's steps are large → small with label → icon only → the whole group as
  one button opening its items. Proposed: one step at a time, from the rightmost group, before
  `overflow: "menu"` takes whole groups; an item says which steps it allows.
- Contextual tabs: Word shows them after the others under a coloured heading. Proposed: a
  `contextual` label on `ToolbarTab` drawing that heading, `visible` as today.

### Tasks

- [x] 25.1 The decisions above settled; each prop comes with the task that builds it (none
  typed ahead of its behaviour). Decided: KeyTips as proposed (Alt pressed and released alone,
  the focus in the ribbon or the document; `keyTips={false}` turns them off; a letter from the
  item's label unless its `keyTip` says, Word's for the tabs). Groups shrink in two steps, not
  four: large items become small, then a captioned group becomes one button opening its items;
  rightmost first, then `overflow: "menu"` takes whole groups (the built-ins have text, not
  icons, so an icon-only step would show nothing). A tab of the selection is `contextual: true`,
  drawn in its own color, without the heading over it (Word 365 has none). Picture Format keeps
  the picture dialog whole (alt text, size, crop and rotation are one dialog), with a quarter
  turn left and right beside it.
- [x] 25.2 `wordRibbonTabs` (api.md, Word ribbon): Home, Insert, Layout, References, Review,
  View in captioned groups, every built-in item in them; 26 new built-ins in `toolbarItems`
  (menus' entries as buttons: rows and columns, the dialogs, notes, fields, field codes, the
  navigation pane, rotation), not in the default toolbar.
- [x] 25.3 Contextual tabs: Table Design and Table Layout while the selection is in a table
  (`selectionInTable` exported), Picture Format while a picture is selected;
  `ToolbarTab.contextual` and `--foli-ribbon-contextual`.
- [x] 25.4 Large buttons and launchers: an item's `size: "large"` (the group's height, its
  icon over its text, which names it); a group's `launcher`, shown in the caption's corner and
  the group's last item for the arrow keys (Page setup, Note options in `wordRibbonTabs`).
- [x] 25.5 Collapse: the button at the end of the tabs, a double-click on a tab or Ctrl+F1;
  a click (Enter, Space, ArrowDown) on a tab then shows its panel over the document until a
  command runs from it, Escape, a press elsewhere or the focus leaves; `collapsed`,
  `defaultCollapsed`, `onCollapsedChange`.
- [x] 25.6 Groups shrink as the width falls: large buttons become small a group at a time from
  the end of the row while that narrows it, then `overflow: "menu"` takes whole groups; measured
  again at each width, nothing measured while typing. Found in 25.8's e2e: the built-ins have
  text and no icon, and a large one wraps its text, so drawn small it is wider; the shrinking
  now keeps a step only when the row got narrower, and the built-ins stay large. Changed from 25.1: a captioned group does not become one
  button opening its items. More already reaches every item that does not fit, and a second
  kind of panel would mean a second way through the items for the keyboard; left for later.
- [x] 25.7 KeyTips: Alt alone, then a tab's letter (Word's: H, N, P, S, R, W), then an item's;
  Escape steps back; `keyTips={false}`; `keyTip` on a tab or an item. Letters come from the
  translated names, so they follow `messages`.
- [x] 25.8 The site's try page uses `wordRibbonTabs` (`overflow: "menu"`); the playground
  shows it at `edit.html` (by default since 1.9.0's release; `edit.html?toolbar` gives the
  one-row toolbar the other specs drive). `ribbon.spec.ts` in Chromium, Firefox and WebKit: tabs and axe, the table tabs coming
  and going, collapse and Ctrl+F1, shrinking at 1366, 1024 and 768 px with every item
  reachable, KeyTips; a screenshot of the References tab per engine. Found there: the collapse
  button sat between the tabs and the toolbar for Tab; it now comes after the panel.
- [x] 25.9 Docs and release: api.md, styling.md, theming.md, keyboard.md, limitations.md (the
  ribbon's gaps), architecture.md, the React README and the extensions guide updated; five
  changesets for `@folijs/react` (minor). `pnpm bench --engines chromium` (2026-11-25): no
  regression past a threshold, keystrokes at or under the baseline (the bench page has the
  one-row toolbar, not the ribbon: the ribbon's own cost while typing is its items' state, the
  same selector as any toolbar's). Firefox and WebKit not benched. Published as 1.9.0 with the owner's
  approval (#289, Release run 45587048081, 2026-11-25), with agent 0.4.3, mcp 0.3.3 and
  collab 0.2.2 as dependants; installed from npm and checked.

### Acceptance

- An app gets a Word-like ribbon with `<FoliEditor toolbar={wordRibbonTabs} />` and nothing else.
- With the caret in a table, Table Design and Table Layout show and every table command is one
  click away; a selected picture shows Picture Format; leaving hides them.
- At 1366, 1024 and 768 px wide, groups shrink before anything goes under More, and every item
  stays reachable.
- Every tab and item is reachable by keyboard alone (one tab stop for the tabs, one for the
  toolbar, KeyTips); axe finds no new violation.
- Existing toolbars (`items`, `tabs`, `defaultToolbarTabs`) behave as in 1.6.0: the current
  toolbar tests pass unchanged.
- `pnpm check` green; the bench shows no keystroke slower than 1.6.0.

## Phase 26 — Comment-only mode · S → next minor

Asked for by the owner on 2026-11-25, from the After 1.0 backlog (#259): a person selects text,
comments it and replies, but cannot change the text, as Word's "Comments only" protection and
Google Docs' "Commenter" role. Reading (`readOnly`) and editing already work; suggest-only
editing stays app code (a `filterTransaction` plugin, see the backlog entry).

How a comment changes the document (`state/comments.ts`): its anchors (`commentStart`,
`commentEnd`, `commentReference`, inline leaves) inserted or removed by `ReplaceStep`s, and the
comment itself in the envelope by `CommentStep`s. So "only comments" is checkable from steps
and the document they apply to, which is what both the editor and the collab authority have.

Not in this phase: suggest-only as a built-in mode, per-range permissions (Word's editable
regions), comments in headers, footers or notes (comments are body-only already), access
control (the app's server decides who may save; the filter keeps an honest client honest).

### Tasks

- [x] Claim phase, branch `phase-26/comment-only`
- [x] 26.1 Core and collab: `onlyCommentSteps(doc, steps)` (every step a `CommentStep`, or a
  flat `ReplaceStep` that inserts and removes nothing but comment anchors) and `commentOnly()`, a
  plugin whose `filterTransaction` refuses every other local transaction (received ones pass: the
  others still edit). `authorize` in `@folijs/collab` also gets the authority's document, so a
  server can refuse a commenter's other steps with the same check. After an agent's review:
  inserted anchors must be plain and belong to a comment the same steps add, removed ones to a
  comment they delete; `{ author }` limits a commenter to their own comments (and resolving).
- [x] 26.2 React: `FoliEditor`'s `commentOnly`: the canvas read-only (select, copy, find), the
  `commentOnly()` plugin added, the toolbar's items off but "New comment", review navigation and
  the View tab (`FoliToolbar`'s `commentOnly`), the comments pane writing, `onlyOwnComments` on
  unless given. Tested: typing, paste, drop and shortcuts change nothing; a comment and a reply
  are made and undone. After a second review: undo and redo kept (toolbar, and the keyboard:
  a read-only view passes comment changes while `commentOnly()` is in the plugins), `FoliEditor`
  passes its `author`, the owner of a thread deletes it with others' replies, and inserted
  anchors may carry formatting (an imported comment back on undo) but never a tracked change.
- [x] 26.3 Docs (api.md, the React and collab READMEs, limitations), changesets; the playground
  at `edit.html?comment-only` (checked in Chromium: Delete and typing change nothing, a comment
  is made and deleted). Left: released with the next minor, with the owner's approval.

### Acceptance

- `<FoliEditor commentOnly />`: no key, paste, drop or toolbar item changes the text; "New
  comment" on a selection makes a comment the pane opens for writing; replies, resolve and the
  user's own edits and deletes work; undo takes them back.
- `editor.run` of any non-comment command is refused while `commentOnly()` is in the plugins.
- A collab authority with `authorize: (id, steps, doc) => onlyCommentSteps(doc, steps)` accepts
  a comment and refuses a text edit as `unauthorized`.
- `pnpm check` green.

## Phase 27 — Comment history and mentions · S → next minor

Asked for by the owner on 2026-11-25, from what people using the comments pane said: a resolved
comment should leave the margin (but stay findable), the text of a resolved or deleted comment
sometimes keeps a mark, and a comment should be able to tag people from a list the app gives
(not only those connected), so the app can tell them (by email, say).

What is there: resolved comments are `done` in the envelope (Word's `w15:done`) and stay in the
pane beside their text, their text still shaded; the pane marks a focused thread's text with a
class it removes from the elements it marked, which misses copies the page layout makes of a
paragraph split across pages. Deleted comments are gone from the document (undo brings them
back): the history is the resolved ones, as in Word.

A mention is what Word writes: the person's name, `@` first, linked to `mailto:` their address.
So it round-trips through .docx with no schema change, and a server sees who a comment tags from
the comment alone (`commentMentions`), whoever made it (the pane, an agent, a collab peer).

Not in this phase: sending anything (the app does, from `onMention` or from the comments it
receives), Word's people part (`people.xml`, its own contacts), notifications for replies to a
thread someone is in, keeping deleted comments.

### Tasks

- [x] Claim phase, branch `phase-27/comment-history`
- [x] 27.1 Highlights: the text of a resolved thread is not shaded (both renderers; a thread is
  resolved when its first comment is, as Word marks it); the pane removes its focus mark from
  every element that has it, copies included.
- [x] 27.2 History: the pane shows open threads beside their text and, once a thread is
  resolved, an Open / Resolved switch; Resolved lists them in document order, each with Reopen
  and Delete; focusing one marks its text. A thread resolved, reopened or deleted while focused
  takes its mark with it (no blur comes for a removed element).
- [ ] 27.3 Mentions: `commentMentions(comment)` in core; the pane's `mentions` (people, or a
  function that finds them) suggest people after `@` in a comment or reply, a pick writes the
  linked name; `onMention` gets the comment and the people it newly tags when one is saved.
  `FoliEditor` passes both. A mention survives export and import.
- [ ] 27.4 Docs (api.md, React README, limitations), changesets, the playground with a list of
  people.

### Acceptance

- Resolving a thread takes it out of the margin and its text's shading; Reopen in the Resolved
  tab brings both back; undo of either works.
- No text keeps the focus mark after its thread is resolved, deleted or loses focus, for a
  paragraph split across pages too.
- Typing `@jo` in a comment lists matching people; picking one and saving calls `onMention` once
  with them; editing the comment without a new mention does not call it again.
- A comment with a mention exported to .docx and imported back keeps the link.
- `pnpm check` green.

## After 1.0

Not a phase yet: the backlog written down on 2026-11-21, from [limitations.md](limitations.md),
[benchmarks.md](benchmarks.md) and ADR-0003's open risks. Nothing here is started. GitHub has
no open issues, so there is no bug intake yet; real-world bugs are expected to come from the
first group and from .docx files the corpus does not cover.

**From the audit of 2026-11-22** (not in Phase 21; candidates for the next phases):

- Word commands: superscript and subscript (the `verticalAlign` mark exists), clear formatting,
  change case; Word's keys for them and for alignment, font size, headings, track changes and a
  new comment ([keyboard.md](keyboard.md)); Ctrl+P through `view.print()` so fields update.
- A status bar (words, pages), zoom, a ruler, format painter, showing ¶ marks, Paragraph and Font
  dialogs; lengths in inches as well as centimetres.
- Right-to-left paragraphs drawn (`w:bidi`, `w:rtl` resolved, `dir` set) and `w:lang` given to
  the DOM (spellcheck, screen readers, hyphenation).
- Styles created and changed through the API, as undoable steps.
- Agent and MCP: comment text and tracked changes readable, a search tool, undo of the agent's
  last call, a summary of its changes before `save`.
- For integrators: steps as JSON (collaboration, a persisted history); `FoliEditor` not pulling
  the toolbar, navigation and comments in when they are off; React 18 tested; a browser support
  matrix and an ESM-only statement; server-side examples (`exportPdf`, agent, MCP); a dark
  theme default for the `--foli-*` tokens.
- Docx: media inflated on demand, not all at once; an `AbortSignal` and progress; export's
  re-parsing of kept XML memoised (about 45% of export in a profile); a fuzzer over zip, XML and
  import beside the corpus run.
- Process: finished phases moved out of this file; SECURITY.md at the root; Dependabot or
  Renovate and a license check; trusted publishing instead of the long-lived npm token.

**Checks accepted as risks for 1.0** ([limitations.md](limitations.md#not-verified-by-hand)):

- IME and dead keys on real input methods (Windows, macOS, Android, iOS), not only Chromium's
  emulation; next to a page break and in table cells.
- Screen readers (NVDA, VoiceOver), including a paragraph split across two pages.
- macOS key bindings and Word's keys as mapped there; Safari on macOS and iOS (tests run on
  Playwright's WebKit on Windows).
- Pastes from real Word, Google Docs and LibreOffice (fixtures are hand-written); spellcheck and
  autocorrect at a page's start or end.

**Robustness** (left by Phase 20's corpus run, [corpus-report.md](corpus-report.md)):

- Strict Open XML (71 files refused): Word's "Strict" format, the same parts under
  `purl.oclc.org/ooxml` namespaces.
- The document's root inside markup compatibility (60 files refused, all docx4j's `mc-root/*`).
- What changes the file without changing what it shows (the report's rows 8 and 10–13): empty
  hyperlinks dropped, field lock and dirty flags, `w:tblPr`/`w:tblGrid` added, a paragraph added
  to an empty body, a break's default type dropped; POI's `Tika-792`, its `w:ins` and
  `w:moveFrom` nested the other way round (row 9's last file); and the renderer's 10 files with a page
  that overflows its sheet (row 14).
- A literal soft hyphen (U+00AD) or non-breaking hyphen (U+2011) in `w:t` is read as
  `w:softHyphen` / `w:noBreakHyphen` and written back as the element (Word on a sample, 20.6).

**Speed** ([benchmarks.md](benchmarks.md)): Phase 5's targets at 100 pages, missed at 1.0. In
Chromium: Enter's handler 9.9 ms and paint p95 35 ms (≤ 25), first layout 118 ms (≤ 60), full
re-flow 148 ms (≤ 100). Firefox misses each. Chromium's re-flow at 200 sections was +110% over
its baseline in 12.12.

Large `.docx` files are not the bottleneck; the editor's pages are. Measured 2026-11-21 (the
corpus NDA's body repeated, Node 25 on the shared laptop, median of 3, pages estimated as 2 per
copy, not laid out): import / export took 29 / 26 ms at 2 pages, 107 / 219 ms at ~50, 240 /
605 ms at ~200, 646 ms / 1.6 s at ~500, 1.1 / 2.7 s at ~1000. Export is ~2.5× slower than
import, the first place to look if file speed ever matters.

**Rust and WebAssembly** (checked against this list 2026-11-21): none of the items here needs
them. Input, accessibility and the missed targets are the browser's work (`renderPages`, forced
layouts, the browser's own layout of the pages; [benchmarks.md](benchmarks.md)); autofit needs
fonts measured. WebAssembly is useful only as a portable sandbox (QuickJS, in
[explorations/agent-editing.md](explorations/agent-editing.md)) and, much later, for a PDF
writer that does not need Chromium (`exportPdf` prints through a headless Chromium page the app
supplies, so a server without a browser cannot make PDFs).

**Gaps users will meet** ([limitations.md](limitations.md); planned as Phase 19):

- Android input (19.7) emulated only, not checked on a device; an Enter at a paragraph's very
  start or end from a keyboard that sends no `beforeinput` is lost.
- Pictures: no crop handles on the page (the dialog crops); resizing is refused while tracking.
- Find does not look in text boxes (comments: 19.2).

**Pictures:** crop handles on the page (a crop mode, as Word's), left from 19.5c; a rotation
handle; a rotated picture's room in its line (Word's `effectExtent`).

**Hint: show a place for a few seconds** (wanted by the owner; built in Phase 18, 1.3.0). An app, or an agent
citing what it changed, points at a range, a block or a bookmark; the editor scrolls there and
marks it briefly, then the mark fades, without changing the document or the selection. Pieces
that exist: `view.reveal({ story, from, to })` and `goTo(editor, range)` scroll to any range,
`findAll` reads the model (not the DOM), so it finds matches on every page, and find already
marks with the CSS Custom Highlight API (`::highlight(foli-find)`). To build: a
`view.hint(range, { ms })` with its own highlight name (`foli-hint`) and a style apps can theme,
the range mapped through edits while it shows, targets by bookmark name and block handle, and
reduced motion respected (no fade, no smooth scroll). A requirement if pages are ever virtualized
(an option for the first layout's speed, above): `reveal` and `hint` must lay out the target
page before scrolling. Today every page is in the DOM, so a far page is reached. (An editor
compared before 1.0 failed exactly there: pages not yet rendered could not be gone to.)

**Agent editing:** built and released: the library (Phase 13, `@folijs/agent`), the MCP server
(Phase 14, `@folijs/mcp`), code mode (Phase 16) and the hint (Phase 18, 1.3.0). Explored:
[explorations/agent-editing.md](explorations/agent-editing.md). A model in a real client, checked
2026-11-22: Claude Code started the published `@folijs/mcp` 0.2.1 (`npx -y @folijs/mcp --root .
--code`); the model, through its own tools, opened the corpus services agreement (already
redlined in Word by two authors), raised the 2027 support fees with one `run` (12 cells) and a
comment, and saved: 24 tracked changes and the comment by `claude-code`, the client's name,
beside Word's; rejecting them gives the original text; Word 16 opens it (31 revisions, 5
comments). Left, not built on purpose: headers, footers and notes through the tools, tables
inserted, accepting or rejecting changes (the person's part), a network transport.

**Comment-only mode** (asked for by the owner on 2026-11-24; planned as Phase 26): a person can select text, add
comments and reply to them, but cannot change the text, as Word's "Comments only" protection
and Google Docs' "Commenter" role. Two of the three usual roles already work with props:
reading (`FoliEditor`'s canvas `readOnly`, which also disables the toolbar, the comments pane
and navigation) and editing (the default, with `author`). Suggest-only editing (every edit
tracked) is app code: `trackChanges: true`, a toolbar without "Track changes" and accept/reject,
and a plugin's `filterTransaction` refusing whatever turns tracking off or resolves a change.
Comment-only cannot be built from outside: `readOnly` blocks comments too (`FoliComments`'s
`readOnly` is meant to go with a read-only canvas). To build: a mode (on `FoliEditor`, the view
and the toolbar) in which the canvas keeps selection and copy but takes no input, the toolbar
offers only "New comment" and review navigation, and the comments pane writes; and, in core, a
filter that lets through only the transactions a comment makes (its `CommentStep`s and whatever
else adding a comment changes in the document; to check), so shortcuts, paste and drop change
nothing. With `@folijs/collab`, the server must refuse a commenter's other steps too. Not access
control on its own: the app's server still checks who may save.

**Optional, later:** headless server-side processing. Real-time collaboration is Phase 22.

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
