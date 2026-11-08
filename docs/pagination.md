# Pagination

> Status: **built (Phase 5); gate G4 passed provisionally** (2026-11-07, on automated evidence;
> the page-break manual checks are open risks in
> [ADR-0003](decisions/ADR-0003-rendering-and-input.md)). This page describes what is built and
> why; the implementation details are in "Editor view" in [architecture.md](architecture.md),
> the numbers in [benchmarks.md](benchmarks.md).

## Invariant

One continuous logical document. Pages are a **presentation** computed by the view. Selection,
undo history, keyboard navigation and copy/paste behave as if the document were not paginated.
A paragraph spanning two pages is still one node; nothing about pages is stored in the
document except its page settings (`DocumentSettings`: page size and margins in mm) and
explicit `pageBreak` nodes.

## Why owning the engine changes the design

An editor built on a third-party engine can only paginate _around_ a continuous rendering
(spacer decorations between blocks). Because Foli owns its view, the view renders the document
**directly into pages**: a paragraph that crosses a page boundary is emitted as two DOM
fragments, one per page, both mapped to the same model node.

## How it works

Chosen in the Phase 1 spike (ADR-0003, option A: `contenteditable` with page fragments) and
built in `packages/view` (`src/view.ts`, the pure flow in `src/layout/flow.ts`).

```
editor state ──► measure the blocks without a cached measurement (DOM reads, in place)
             ──► flow: assign blocks and lines to pages (pure function, unit and property tested)
             ──► render pages:
                 <div contenteditable role="textbox">     ← one editable host: native selection,
                   <section class="foli-page">               IME, spellcheck across pages
                     <h1>…</h1>
                     <p data-fragment="0">…</p>           ← paragraph N, first lines
                   </section>
                   <section class="foli-page">
                     <p data-fragment="1">…</p>           ← paragraph N, the rest
                   </section>
                 </div>
             ──► descriptors map every fragment and text node to model positions
```

- **Geometry:** each page gets the settings' size (`width`, `min-height`) and margins
  (`padding`) inline in mm; the content box is `height − top − bottom` by
  `width − left − right`. A scaled ancestor (`transform`, `zoom`) is divided out of every
  measurement. The React theme (`@folijs/react/styles.css`) adds background, shadow and the gap
  between pages; a bare `@folijs/view` host gets none of them.
- **Measuring:** each block's border-box height and vertical margins, read from the rendered
  block. Lines only for blocks that cross a page end or hold a page break: per-character `Range` rects, a binary
  search per line, splits snapped to grapheme clusters. The browser shapes the text; Foli only
  reads where its lines fall.
- **Flow:** blocks fill a page's content box with CSS margin collapsing; a block that does not
  fit is split at a line (over as many pages as it takes). Rules:
  - a line holding a `pageBreak` (Mod+Enter; pasted from Word and Google Docs markup, checked
    with hand-written fixture HTML) ends its page;
  - widows and orphans: at least 2 lines of a split block on each page (`FlowRules`; a block too
    short for both moves whole; not applied across a page break, nor where only an empty page
    could hold the lines);
  - headings keep with the next block (chains too);
  - only a single line taller than a page makes its page grow.
- **Fragments:** each fragment is the same element type with its slice of the content and
  marks; the split edges drop their margins, so the fragments together take the block's
  height (plus the padding and border each further fragment repeats). Measuring the fragments of a split block gives the lines of the whole block, so a
  reload gives the same split.
- **Caret and selection** are native: all pages live in one editable host. At a split the end
  of one fragment and the start of the next are two caret stops for one model position (caret
  affinity): ArrowLeft/Right and word moves (with Shift) step over the edge so each press moves
  once; Backspace/Delete there delete one character; up/down, Home/End and clicks are native.
  Copy and cut come from the model, never from the DOM (the DOM would give two paragraphs).
- **Composition:** during an IME composition the view leaves the DOM to the browser and does not
  re-flow or re-split; the composed text is read back from the fragments in DOM order and the
  pages flow after it ends.
- **Incremental reflow:** measurements are cached by model node (unchanged nodes keep their
  identity). An edit measures only the blocks it changed; `flowFrom` starts at the first
  changed block from the previous flow's state and stops once the state before an unchanged
  block equals the previous one (property test: equal to a full flow). Unchanged fragments keep
  their DOM. Edits flow synchronously, and so does a settings change (`setDocument`, measuring
  every block again). A block resized without an edit (CSS, a font, a container; seen by a
  `ResizeObserver`) and web fonts loading re-flow in the next animation frame, at most once per
  frame, never during a composition.
- **Lists and other nested blocks** (7.3, 7.4, ADR-0004): the flow sees the leaf blocks at any
  depth (paragraphs, headings, rules), so a list item's paragraph splits at a line and the rules
  above apply inside lists as anywhere. Each page rebuilds the `ul`/`ol`/`li` elements around the
  blocks it holds: a list on several pages is a list per page, an item continued from the
  previous page shows no second marker, ordered items carry their number (`value`), so numbering
  continues. List elements take no vertical space of their own (block margins and paddings 0),
  so the blocks' margins collapse through them exactly as between siblings. A rule is a block
  without lines: never split, moved whole.
- **Justified text** keeps its last line justified on every fragment but the block's last
  (`text-align-last: justify`): a fragment's last line is not the paragraph's.
- **Print:** the view writes a print stylesheet from the settings: `@page` of the page size
  without margins, each page exactly one sheet tall with `break-after: page`. A print shows the
  screen's pagination; it does not re-flow.

## Evidence

All in Playwright on Chromium, Firefox and WebKit (Windows 11), plus unit and property tests:

- **T5** (`apps/playground/e2e/pages.spec.ts`): a paragraph split onto two pages; typing at the
  end of page 1 inside it keeps text and caret; arrows cross the break one character per press
  (also after a hard break); Backspace/Delete at the break; Shift-select across, replace, undo
  (exact text and selection back); mouse drag across, delete, undo; ArrowDown across the page
  gap; Enter pushing blocks onto page 2 and undo pulling them back; Mod+Enter, undo, redo,
  Backspace; the pagination rules; typing on page 1 of a long document keeps every page valid.
  An IME composition just before the break gives exact text (Chromium only: CDP emulation).
- **Determinism** (`visual.spec.ts`, `docs/testing/visual-regression.md`): eight fixtures with
  the bundled test font give the same page breaks on a second load and after a font-load
  re-flow, matching recorded snapshots, plus a screenshot per engine. The `lists` fixture (7.4)
  has a list item split at a line, a nested list crossing a page break and a justified
  paragraph split across pages.
- **Lists** (`lists.spec.ts`): a 70-item ordered list across four pages (no block overflows,
  numbering continues, nested lists nested); typing in an item on page 2; a split item shows
  its marker once; a split justified paragraph stays justified up to the break.
- **Print** (`print.spec.ts`): in print media every page fits its sheet (all engines); a PDF has
  one sheet of the page size per page (Chromium).
- **Performance** ([benchmarks.md](benchmarks.md)): at 100 pages, initial layout ~40-45 ms,
  a keystroke's handler 3-5 ms, keystroke-to-paint p95 8-19 ms, a re-flow after a font change
  ~60 ms (Chromium and Firefox). A 100-section document of lists (114 pages): typing within the
  targets; an Enter at the top that moves every later page, the initial layout and Chromium's
  re-flow are not (about twice the paragraph document's cost; why in benchmarks.md, "Lists").

## Known limits

- Layout works on leaf blocks (paragraphs, headings, rules) at any depth; lists are rebuilt
  around them on each page (ADR-0004). A list split across pages is two lists in the DOM.
  Tables and images (Phase 8) are not laid out yet.
- No page chrome: headers, footers and page numbers arrive in Phase 9.
- Line measurement assumes left-to-right text without vertical-align offsets. A split block's
  padding and border repeat on every fragment. Negative block margins are not modelled.
- Page breaks depend on the fonts the browser has: the same document can paginate differently
  on another machine or before a web font loads (the view re-flows when it does).
- A CSS change that only alters margins, or rewraps blocks without changing any block's height,
  is not noticed until some block's height changes.
- Every page is in the DOM and every block is measured on load (no virtualization); an edit
  walks every block, and an edit that shifts later blocks re-flows the rest of the document
  (arithmetic over cached measurements). Fine up to a few hundred pages; see benchmarks.
- `@page` is per web page: several editors with different page sizes print with the last one's
  sheet size. Print-only CSS must not change text metrics. Firefox and Safari PDF output is not
  checked.
- Not verified by hand (ADR-0003, open risks): real IME at a fragment edge (only Chromium's
  emulation), how screen readers read a split paragraph (possibly as two paragraphs), and
  spellcheck and autocorrect at a break.

## Fallbacks

ADR-0003 keeps these if the open manual checks fail in a way the fragment edge cannot fix:

| Approach                                                | When to use                                                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hidden input element + Foli-rendered DOM (Monaco-style) | If fragments inside `contenteditable` break IME/selection irreparably. Costs: own caret and selection drawing, hit testing, no native spellcheck. |
| `contenteditable` with block-level pages only           | If line-level fragments fail but block-level works. Long paragraphs cannot span pages.                                                            |
| Canvas rendering                                        | Not planned. Requires our own text shaping, IME bridge and accessibility tree.                                                                    |

## Rust?

Page flow is arithmetic over measurements; the cost is DOM measurement and the browser's own
layout, which must happen in the browser. The benchmarks give no reason for Rust here.
