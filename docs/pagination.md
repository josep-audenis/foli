# Pagination

> Status: **design only.** The current editor renders one tall page (`min-height` = page height).
> Nothing in this document is implemented yet.

## Invariant

One continuous ProseMirror document. Pages are a **presentation** computed from it.
Selection, undo history, keyboard navigation and copy/paste must behave exactly as if the
document were not paginated.

## Options considered

| Approach                                                           | Verdict                                                                                         |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| One editor instance per page                                       | **Rejected.** Breaks cross-page selection, undo history, and moving content between pages.      |
| CSS-only (repeating page background, columns)                      | **Rejected.** Text runs straight through page gaps and margins; no real page boundaries.        |
| Custom layout engine (positioned spans / canvas, like Google Docs) | **Rejected for now.** Requires reimplementing selection, IME, accessibility. Explicit non-goal. |
| **Continuous editable doc + measured layout pass + decorations**   | **Chosen.** Keeps ProseMirror in charge of editing; layout injects visual-only spacers.         |

## Chosen design

```
 doc changes ──► ProseMirror view renders continuous content
                       │
                       ▼  (after paint, rAF-batched)
            measure: read heights of top-level blocks (DOM reads only)
                       │
                       ▼
            computePageBreaks(measurements, geometry)   ← pure function, unit-testable
                       │
                       ▼
            dispatch meta transaction (no doc change, addToHistory: false)
                       │
                       ▼
            plugin state → widget decorations = page gap spacers
            + page chrome layer (page backgrounds, later headers/footers/numbers)
```

Key properties:

- **Decorations are not document content**: they are excluded from `doc`, from the undo
  history, from serialization and from the clipboard. This is what keeps editing semantics intact.
- **Page geometry from settings**: content height per page = `pageSize.height − margins.top − margins.bottom`, in mm, converted to CSS px for measurement.
- **No feedback loop**: break computation uses block heights, never positions that include
  previously inserted spacers.
- **Page chrome** (white page rectangles, shadows) is a separate layer behind the content,
  positioned from the computed breaks, so the content column itself stays one DOM tree.

### Stages

1. **Block-level breaks (Phase 2).** A spacer is inserted _between_ top-level blocks. A block
   taller than the remaining space moves to the next page. Explicit `pageBreak` nodes force a
   break. A block taller than a whole page overflows (documented limitation).
2. **Line-level breaks (Phase 3).** For a paragraph crossing the boundary, measure its line
   boxes (`Range.getClientRects()`), find the first line that does not fit, and insert an
   inline widget decoration at that text position that renders a block-level spacer. The
   paragraph stays a single node.
3. **Keep-with-next, widow/orphan control (Phase 3)** as rules inside `computePageBreaks`.
4. **Tables (Phase 5).** Row-level breaks; widgets cannot live between `<tr>` elements, so
   this likely needs a table node view that renders spacer rows. Open question.

### Incremental repagination

ProseMirror nodes are immutable and unchanged nodes keep identity across transactions, so
measurements can be cached in a `WeakMap<Node, height>`. After an edit only changed top-level
blocks are re-measured; breaks are recomputed from the first changed block onward (arithmetic
is cheap; measurement is the cost). Full invalidation on: content width change, font load
(`document.fonts` `loadingdone`), zoom, page settings change. Obsolete layout work is dropped
by coalescing to one pass per animation frame.

## Risks and open questions

| Risk                                 | Notes / mitigation                                                                                                                                                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Caret movement across spacer widgets | Arrow keys must skip spacers. Test with Playwright in Chromium, Firefox, WebKit. Use `side` on widgets and `ignoreSelection`.                                                                                                    |
| Justified text on a line-level break | The line before an inline spacer is treated as a "last line" and not justified. Needs a CSS workaround or accepted limitation.                                                                                                   |
| Font metrics                         | Layout differs until web fonts load; repaginate on font load. Visual tests must use bundled fonts.                                                                                                                               |
| Screen vs print                      | Print fragmentation is the browser's, not ours. Plan: print with `@page { size; margin }` from settings and the same spacer geometry in mm; verify with Playwright PDF output. Not guaranteed identical to DOCX/Word pagination. |
| IME / composition                    | Do not dispatch layout transactions during composition (`view.composing`); defer until it ends.                                                                                                                                  |
| Large documents                      | Measuring every block on load is O(n) layout reads. Benchmark at 10/50/100+ pages before optimizing (virtualization is out of scope).                                                                                            |
| Accessibility                        | Spacers must be `aria-hidden`; page numbers announced via chrome layer, not inside content.                                                                                                                                      |

## Rust?

Break computation is simple arithmetic over measurements; the cost is DOM measurement, which
must happen in the browser. No Rust here unless benchmarks prove otherwise.
