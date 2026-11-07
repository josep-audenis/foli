# ADR-0004: Nested blocks on pages

- **Status:** Accepted (2026-11-07), task 7.3.
- **Context:** schema v2 (7.2) nests blocks: a `listItem` holds a paragraph and further blocks
  (nested lists), lists hold items. The view (ADR-0003, Phase 5) was built for a flat document:
  one rendered block per child of `doc`, one layout box per block, positions from top-level
  offsets, pages holding the blocks directly.

## Question

How does the paged view render, lay out and map positions for nested blocks, without losing
what Phase 5 built (line-level splitting, incremental reflow, cached measurements, native
selection and IME inside one `contenteditable` host)?

## Options

- **A. Layout over leaf blocks; containers rebuilt per page.** The units of rendering, layout
  and position mapping are the leaf blocks in document order at any depth: textblocks
  (paragraphs, headings) and block leaves (a horizontal rule). Containers (lists, list items)
  are not laid out; each page re-creates the container elements (`ul`, `ol`, `li`) around the
  units it holds.
- **B. Layout over containers.** A list is one layout box whose lines are its items' lines;
  splitting it means splitting the list element, recursively.
- **C. Flat rendering with decorations.** Units are rendered flat (no `ul`/`li`), with markers
  and indentation drawn by CSS from data attributes.

## Decision

**Option A.**

- **Units.** `render` walks the document and creates one `BlockDesc` per leaf block, with its
  position, and for each unit the chain of its container ancestors (outermost first). Units are
  reused by node identity as before; the flow (`layout/flow.ts`), the measurement cache and the
  line measurement are unchanged: they see a sequence of blocks, as in Phase 5.
- **Wrappers per page.** `place` puts each unit fragment into its page inside the container
  elements of its chain, reusing the wrapper elements already at that place in the page (matched
  by position and tag, not by model identity), so typing in a list item moves no DOM. A list that
  continues on the next page gets new wrappers there. A list item continued on the next page (its
  first unit was on the previous page, or its paragraph is split) shows no second marker; items
  of an ordered list carry their number (`value`), so numbering continues across pages.
- **The flow's model stays exact** because wrappers take no vertical space of their own: the view
  sets their block margins and paddings to 0 inline. The unit margins then collapse through the
  wrappers exactly as between siblings (CSS margin collapsing), which is what the flow assumes.
  Indentation is horizontal (the wrappers' inline padding), so it changes line widths, which are
  measured, not flow arithmetic.
- **Positions.** DOM → model goes through the unit element that contains the point (found by
  walking up to an element the view rendered as a unit); points in wrappers, pages or the host
  map to the start of the next unit fragment, as points between pages did. Model → DOM finds the
  unit by position (binary search over unit starts).
- **Composition read-back** diffs the text of the units in order, joined by a separator, as
  before; the DOM walk descends through pages and wrappers.
- **Block leaves** (a horizontal rule) are units without lines: never split, moved whole to the
  next page. A `NodeSelection` on one is shown as a DOM range around its element (plus a class for
  styling) and read back as a `NodeSelection`.

## Why not B or C

- **B** needs a recursive split of container elements at line level and a flow over nested
  boxes; Phase 5's incremental flow, caches and fragment mechanics would all have to be redone,
  for the same visible result as A.
- **C** loses list semantics: screen readers announce `ul`/`ol`/`li` (count, position, nesting),
  which flat elements cannot express (ARIA list roles need the same nesting). Copy would also
  produce flat paragraphs.

## Consequences

- A list split across pages is two lists in the DOM (one per page), as a split paragraph is two
  elements: a screen reader may announce two lists. Same open risk as split paragraphs
  (ADR-0003, G4 open checks).
- CSS on list wrappers that adds vertical margin, padding or border breaks the flow's arithmetic
  (pages may overflow). Documented in docs/styling.md; the view enforces 0 inline.
- Pagination rules inside lists (keep-with-next, widows and orphans across items), justified
  text across a break and the visual checks are task 7.4.
