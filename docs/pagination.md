# Pagination

> Status: **in progress (Phase 5).** Built: real page containers (5.1), paragraphs split
> across pages at a line with caret affinity at the split (5.2), and the rules: explicit page
> breaks, widows and orphans, keep-with-next for headings (5.3), and incremental reflow with
> cached measurements (5.4); see "Editor view" in [architecture.md](architecture.md). Not built
> yet: print, fixtures with a bundled font, benchmarks. The rendering approach is
> validated by the Phase 1 spike (ADR-0003).

## Invariant

One continuous logical document. Pages are a **presentation** computed by the layout engine.
Selection, undo history, keyboard navigation and copy/paste behave as if the document were not
paginated. A paragraph spanning two pages is still one node.

## Why owning the engine changes the design

An editor built on a third-party engine can only paginate _around_ a continuous rendering
(spacer decorations between blocks). Because Foli owns its view, the view can render the
document **directly into pages**: a paragraph that crosses a page boundary is emitted as two
DOM fragments, one per page, both mapped to the same model node.

## Chosen design (Phase 1 spike; ADR-0003 accepted provisionally)

Spike result so far: works in Chromium, Firefox and WebKit for selection, caret movement,
deletion and (Chromium) IME. Requires caret affinity at fragment edges and incremental rendering.
Manual IME, dead-key and screen-reader checks not yet run (accepted risks) — see
[ADR-0003](decisions/ADR-0003-rendering-and-input.md).

```
EditorState ──► layout
                 1. measure blocks / line boxes (DOM reads, batched per frame)
                 2. page flow: assign lines to pages (pure function, unit-testable)
                 3. emit fragments: (node, fromLine, toLine, page)
             ──► view renders pages:
                 <div contenteditable>            ← one editable host = native selection,
                   <section class="foli-page">       IME, spellcheck across pages
                     <p data-fragment>…</p>       ← fragment 1 of paragraph N
                   </section>
                   <section class="foli-page">
                     <p data-fragment>…</p>       ← fragment 2 of paragraph N
                   </section>
                 </div>
             ──► view descriptors map every fragment to its model range
```

- **Selection and caret** are native, because all pages live in one editable host. Foli maps
  DOM positions through fragment descriptors to model positions.
- **Typing in a fragment** is intercepted (`beforeinput`) and applied to the model; the layout
  reflows and fragments are re-emitted. During IME composition the fragment is left alone and
  reflow is deferred until composition ends.
- **Page chrome** (page rectangle, margins, later headers/footers and numbers) is part of each
  page container and is `contenteditable="false"` / `aria-hidden` where appropriate.
- **Geometry** comes from `DocumentSettings` in mm; content box per page is
  `height − top − bottom` by `width − left − right`, converted to CSS px.

### Line breaking

Browsers do the text shaping. Layout finds line boundaries by measuring the rendered paragraph
(`Range.getClientRects()` over text positions), then chooses the split line. Fragment 2 starts
at the model offset of that line's first character. The algorithm must converge: re-rendering
the fragment at the same width must produce the same lines.

### Rules (Phase 5)

Explicit `pageBreak` node (inline, built in 5.3); headings keep-with-next; widow/orphan
control (2 lines default); blocks taller than a page are split by lines; elements that cannot
split (images, later) move whole.

### Incremental reflow

ProseMirror-style immutability gives free cache keys: unchanged nodes keep identity. Cache
measurements in a `WeakMap<Node, Measurement>` keyed also by content width. After an edit,
reflow from the page containing the first changed block; stop when a page starts at the same
block/line as before (the rest of the document is unchanged). Full invalidation on font load,
width or zoom change, and settings change.

## Alternatives (fallbacks if the spike fails)

| Approach                                                | When to use                                                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hidden input element + Foli-rendered DOM (Monaco-style) | If fragments inside `contenteditable` break IME/selection irreparably. Costs: own caret and selection drawing, hit testing, no native spellcheck. |
| `contenteditable` with block-level pages only           | If line-level fragments fail but block-level works. Long paragraphs cannot span pages.                                                            |
| Canvas rendering                                        | Not planned. Requires our own text shaping, IME bridge and accessibility tree.                                                                    |

## Risks and open questions

| Risk                       | Notes                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Selection across fragments | Does the browser treat two `<p>` fragments as one selectable run? Arrow keys at boundaries? (spike E2, E4) |
| IME at a fragment boundary | Composition that pushes text onto the next page (spike E3)                                                 |
| Screen readers             | Two fragments may be read as two paragraphs; may need ARIA hints (spike E6)                                |
| Justified text             | The last line of fragment 1 must stay justified; CSS `text-align-last` on fragments                        |
| Print                      | Print pages from our page containers with `break-after: page`; verify with Playwright PDF                  |
| Fonts                      | Pagination is valid only after fonts load; bundled font for tests                                          |
| Large documents            | Measuring every block on load; benchmark before virtualizing anything                                      |

## Rust?

Page flow is arithmetic over measurements; the cost is DOM measurement, which must happen in
the browser. No Rust here unless benchmarks prove otherwise.
