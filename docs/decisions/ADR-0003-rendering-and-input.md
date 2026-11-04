# ADR-0003: Rendering and input approach

- **Status:** Proposed. Automated evidence is complete. It becomes Accepted (gate G1) once the
  manual checks below are recorded.
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

Every test also checks layout consistency:

- No page overflows its body.
- Every fragment renders exactly the number of lines measured for it.

**E7: performance, 50-page document (55 pages).** Each number is synchronous main-thread time for
layout, a full DOM re-render and the selection write-back. Paint is excluded. Runs are serial, 20
keystrokes on page 1.

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
5. **Native copy would split paragraphs.** The browser serializes two fragments as two
   paragraphs, so copy and cut must come from the model. The spike does this, but it is not yet
   covered by a test.
6. **Measurement is fast enough, but WebKit's is slow.** Initial layout of 55 pages takes 382 ms
   in WebKit, against 46–71 ms in the other engines. Full re-render per keystroke goes beyond one
   frame in Chromium and WebKit at 50 pages. **Incremental rendering is required** (already
   planned for Phase 5). Measurement may need a cheaper first pass in WebKit.

## Not yet covered (manual)

Manual checklist: [`spikes/two-page/README.md`](../../spikes/two-page/README.md).

- **E3 IME on real platforms:** Windows (Japanese, Chinese, Korean IME), macOS Safari, Android
  Gboard, iOS. Also dead keys.
- **E5 spellcheck and autocorrect:** `insertReplacementText` cannot be triggered by automation.
- **E6 screen readers:** NVDA, VoiceOver. Is a split paragraph announced as one or two?
- Also untested: justified text, inline formatting and mixed fonts, RTL, very long words, images.

## Proposed decision

**Option A: `contenteditable` with page fragments.** Every automated experiment passes in all
three engines once the caret-affinity fix is in. No result so far points to option B or C.

Consequences for Phases 4–5:

- View descriptors must allow **several DOM fragments per model node**, with caret affinity at
  fragment edges.
- Selection is synced from the DOM on demand, not only on `selectionchange`.
- IME and Android input use DOM read-back into steps. A generic `input` safety net catches
  unprevented changes.
- Copy, cut and paste always go through the model.
- Incremental rendering and reflow are mandatory, not optional.

**Fallback triggers:** move to option B if manual IME on Safari or Android, or the screen-reader
checks, show failures that cannot be fixed at the fragment edge.
