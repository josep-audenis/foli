# ADR-0003: Rendering and input approach

- **Status:** Accepted provisionally (2026-11-04). Automated evidence is complete; manual checks
  are partial (see "Manual results"). The untested items are accepted risks: the checks that do not
  need pages must pass on the Phase 4 view (gate G3), the page-break versions on the Phase 5 view
  (gate G4). G3 passed provisionally on automated evidence (2026-11-05), and G4 likewise
  (2026-11-07); their manual checks are still open (see "Gate G3" and "Gate G4").
- **Date:** 2026-11-04
- **Evidence:** `spikes/two-page` (spike) and `spikes/two-page/e2e/experiments.spec.ts`

## Question

Can Foli render the document as real pages inside **one** `contenteditable` host, with a paragraph
that crosses a page boundary rendered as two DOM fragments, while keeping native selection,
caret movement and IME? The options from the roadmap:

- **A.** `contenteditable` with page fragments.
- **B.** Hidden input + Foli-rendered DOM.
- **C.** `contenteditable` with block-level pages only.

## What the spike does

- A toy model: plain-text paragraphs, snapshot undo.
- Line breaks are measured with `Range` rects, using a binary search per line.
- A pure page-flow function splits paragraphs at line boundaries.
- Pages are `<section>` elements inside one editable host, and each fragment is a `<p>`.
- Edits go through `beforeinput` (prevented) into the model, then a full re-render, then the selection is restored from the model.
- During IME composition the browser mutates the DOM. At `compositionend` (and on any unprevented `input`) the spike rebuilds paragraphs from fragment text, in DOM order.

## Automated results

Playwright 1.64.1 bundled browsers (Chromium, Firefox, WebKit 27.2), Windows 11, i7-13700H, 16 GB.
Stability: 3 consecutive runs × 3 repetitions, 69/69 tests passed each run with 4 workers.

| ID  | Experiment                                                                   | Chromium | Firefox | WebKit |
| --- | ---------------------------------------------------------------------------- | -------- | ------- | ------ |
| E1  | Typing before the split: text, caret and layout correct                      | ✅       | ✅      | ✅     |
| E1  | Typing on page 1 reflows lines onto page 2; caret correct                    | ✅       | ✅      | ✅     |
| E2  | Mouse drag selection page 1 → page 2, Backspace, undo                        | ✅       | ✅      | ✅     |
| E2  | Shift+ArrowRight ×10 across the boundary, Delete, undo                       | ✅ \*    | ✅ \*   | ✅ \*  |
| E2  | Shift+ArrowDown extends selection onto page 2                                | ✅       | ✅      | ✅     |
| E4  | ArrowDown/ArrowUp across the page gap keep the horizontal position (< 20 px) | ✅       | ✅      | ✅     |
| E3  | IME composition at the end of page 1, commit, undo (CDP)                     | ✅       | n/a     | n/a    |
| E3  | IME composition replacing a selection that spans both pages (CDP)            | ✅       | n/a     | n/a    |

\* Only after a fix. See finding 2.

Every test that edits also checks layout consistency:

- No page overflows its body.
- Every fragment renders exactly the number of lines measured for it.

**E7: performance, 50-page document (55 pages).** Each number is synchronous main-thread time for
layout, a full DOM re-render and the selection write-back. Paint is excluded. Recorded with `--workers=1`, 20
keystrokes on page 1. Numbers vary between runs (a later run measured WebKit at 486 ms initial and
43 ms max), so treat them as indicative.

| Browser  | Initial layout | Keystroke median | Keystroke max |
| -------- | -------------- | ---------------- | ------------- |
| Chromium | 71 ms          | 13.7 ms          | 24.4 ms       |
| Firefox  | 46 ms          | 3 ms             | 5 ms          |
| WebKit   | 382 ms         | 22 ms            | 30 ms         |

Firefox's `performance.now()` has 1 ms granularity. Measurement is cached per paragraph text, so
keystroke cost is mostly the full re-render.

## Findings

1. **One editable host across pages works.** Native mouse and keyboard selection, vertical caret
   movement across the page gap, and deletion across pages all behave in all three engines. Page
   containers inside the host cause no editing problems.
2. **A fragment edge is an extra caret stop.** The end of a page-1 fragment and the start of its
   continuation are two DOM caret positions for one model offset. Native Left/Right therefore needs
   an extra key press there. The spike steps in the model when the caret is at a fragment edge,
   which fixed E2 in all engines. The real view needs an explicit **caret affinity** concept.
   Untested, likely needing the same treatment: Ctrl/Alt+Arrow (word), Home/End at fragment
   edges, bidi text.
3. **The model selection must be synced on demand.** `selectionchange` is asynchronous, so the
   model selection lags the DOM right after native caret movement. The tests found this race.
   Every handler must read the live DOM selection before acting; the spike does.
4. **Composition read-back works (Chromium).** Letting the browser own the DOM during
   composition, then rebuilding the model from fragments in DOM order, produced correct text,
   caret and undo. That includes composition replacing a selection across pages. Paragraph ids in
   the DOM are pre-edit indices and must be remapped after merges.
5. **Native copy is expected to split paragraphs (not verified).** The browser serializes two fragments as two
   paragraphs, so copy and cut must come from the model. The spike does this, but it is not yet
   covered by a test.
6. **Measurement is fast enough, but WebKit's is slow.** Initial layout of 55 pages takes 382 ms
   in WebKit, against 46–71 ms in the other engines. Full re-render per keystroke exceeds one frame
   (16.7 ms) at 50 pages: the median in WebKit, the worst case in Chromium. **Incremental rendering is required** (already
   planned for Phase 5). Measurement may need a cheaper first pass in WebKit.

## Manual results (partial)

Manual checklist: [`spikes/two-page/README.md`](../../spikes/two-page/README.md). Run by the
project owner on Windows 11, 2026-11-04:

| Check                                                                                        | Result |
| -------------------------------------------------------------------------------------------- | ------ |
| Typing at the page break, selection across pages + replace + undo, ArrowDown across pages    | Pass   |
| E5 spellcheck: replacing a misspelling on page 2 via the context menu (browser not recorded) | Pass   |

**Not tested (accepted risks, carried into Phase 4):**

- **E3 IME on real platforms:** no manual IME check yet (only the automated Chromium CDP
  emulation passed). Windows Japanese/Chinese/Korean IME, Firefox, macOS Safari, Android Gboard,
  iOS. Also dead keys.
- **E6 screen readers:** NVDA, VoiceOver. Whether a split paragraph is announced as one or two
  is still unknown.
- macOS and mobile autocorrect.
- Also untested: justified text, inline formatting and mixed fonts, RTL, very long words, images.

Where they are re-run:

- **Gate G3 (Phase 4, unpaginated view):** real IME and dead keys (T4), and NVDA/VoiceOver
  reading the editor.
- **Gate G4 (Phase 5, pages):** the same checks across a page break: IME at a fragment edge, a
  screen reader reading a split paragraph.

Any check not run at its gate stays recorded here as an open risk. A failure at G4 that cannot be
fixed at the fragment edge triggers the fallback below.

### Gate G3: passed provisionally (2026-11-05)

The project owner chose to continue to Phase 5 without the manual checks (roadmap task 4.6),
in the same way G1 passed. Automated evidence on the Phase 4 view (Playwright, Chromium,
Firefox and WebKit, Windows 11):

- **T1, T2:** typing and formatting keep the tree valid after every keystroke; replacing a
  cross-paragraph selection with mixed marks and undoing restores the exact document and
  selection (`apps/playground/e2e/caret.spec.ts`).
- **T3:** paste through the model: Foli JSON, sanitized HTML (hand-written Word, Google Docs,
  LibreOffice and web-page fixtures), plain text; scripts and images never load. Copy/paste
  inside the editor is not automated in WebKit (Playwright gives WebKit paste events no
  clipboard contents).
- **T4, automated part only:** IME composition (commit, undo as one step, inside bold text,
  over a cross-paragraph selection) through Chromium's CDP emulation. Firefox and WebKit have
  no IME emulation.

**Still open (accepted risks, not run):**

- Real IME: Windows Japanese, Chinese and Korean in Chrome and Firefox; macOS Safari; Android
  Gboard; iOS. Dead keys on Windows and macOS.
- NVDA and VoiceOver reading the editor, including read-only mode and the placeholder.
- macOS key bindings (Cmd/Option+arrows, Cmd/Option+Backspace, Ctrl+K/H/D) and whether every
  engine gives a target range for line deletes.
- Pastes captured from real Word, Google Docs and LibreOffice (the corpus is hand-written).

The checklist is [`docs/testing/ime.md`](../testing/ime.md). These checks run before the 0.1.0
release at the latest, or together with their page-break versions at G4; until then they are
listed in the release notes of any canary. A failure that cannot be fixed in the view triggers
the fallback below.

### Gate G4: passed provisionally (2026-11-07)

As for G3, the project owner chose to continue without the manual checks. Automated evidence on
the Phase 5 view (Playwright 1.64.1, Chromium, Firefox and WebKit, Windows 11):

- **T5** (`apps/playground/e2e/pages.spec.ts`): a paragraph split at a line onto two pages;
  typing at the end of page 1 inside it keeps text and caret; ArrowLeft/Right cross the break
  one character per press (caret affinity, finding 2), also right after a hard break;
  Backspace/Delete at the break remove one character; Shift-select across the break, replace,
  undo: exact text and selection back; mouse drag across, delete, undo; ArrowDown across the
  page gap; Enter pushes blocks onto page 2 and undo pulls them back; Mod+Enter page breaks
  with undo, redo and Backspace; typing on page 1 of a 200-paragraph document keeps every page
  valid. Run three times in a row in every engine with the visual and print suites, all
  passing.
- **IME at the break, automated part only:** a composition just before the break, then typing,
  gives exact text (Chromium CDP emulation; no re-split while composing).
- **Determinism:** seven fixtures with the bundled test font give the same page breaks on a
  second load and after a font-load re-flow, matching recorded snapshots per engine
  (`visual.spec.ts`); print gives one sheet per page (`print.spec.ts`).
- **Benchmarks:** baseline and targets in [benchmarks.md](../benchmarks.md). Finding 6 is
  answered: with incremental reflow a keystroke at 100 pages takes 3-5 ms in the view and paints
  within 8-19 ms (p95); the spike's full re-render took 3-22 ms (median) at 50 pages.

**Still open (accepted risks, not run),** in addition to the G3 list:

- IME composition at a fragment edge on real platforms (Windows Japanese/Chinese/Korean in
  Chrome and Firefox, macOS Safari, Android Gboard), including one that pushes text onto the
  next page.
- NVDA and VoiceOver reading a paragraph split across pages: one paragraph or two, and reading
  line by line across the break.
- Spellcheck and autocorrect replacing a word at the end or start of a fragment.

The checklist rows are in [`docs/testing/ime.md`](../testing/ime.md) ("Page breaks"). They run
before the 0.1.0 release at the latest; until then they are listed in the release notes of any
canary. A failure that cannot be fixed at the fragment edge triggers the fallback below.

## Decision

**Option A: `contenteditable` with page fragments** (provisional). Every automated experiment
passes in all three engines once the caret-affinity fix is in, and the manual checks run so far
pass. No result so far points to option B or C.

Consequences for Phases 4–5:

- View descriptors must allow **several DOM fragments per model node**, with caret affinity at
  fragment edges.
- Selection is synced from the DOM on demand, not only on `selectionchange`.
- IME and Android input use DOM read-back into steps. A generic `input` safety net catches
  unprevented changes.
- Copy, cut and paste always go through the model.
- Incremental rendering and reflow are mandatory, not optional.

**Fallback triggers:** move to option B if manual IME on Safari or Android, or the screen-reader
checks, show failures that cannot be fixed at the fragment edge. If those checks are never run,
the risk stays open and is listed in the release notes.
