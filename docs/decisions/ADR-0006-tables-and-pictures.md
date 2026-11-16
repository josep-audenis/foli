# ADR-0006: Tables and pictures in the model and on pages

- **Status:** Proposed (2026-11-16), task 10.1. Accepted by the owner before 10.2 starts.
- **Context:** schema v3 ([ADR-0005](ADR-0005-word-compatible-model.md)) keeps a table as one
  `opaqueBlock` (its `w:tbl` XML: exported byte for byte, shown read-only from the XML, selected
  and deleted whole, refused while tracking) and a drawing as an `opaqueInline` (shown as
  nothing). Contracts and reports are full of tables (schedules, price lists, signature blocks)
  and carry logos and figures: Phase 10 makes both editable as Word models them. Blocks in v3 are
  flat; the nested-blocks-on-pages design ([ADR-0004](ADR-0004-nested-blocks-on-pages.md)) went
  with schema v2.

## Question

How does Foli model, lay out, select and edit Word tables and pictures, while keeping what the
engine has (one `contenteditable` host, line-level page splitting, incremental reflow, tracked
changes and comments, a lossless DOCX round trip)?

## Spike (`spikes/two-page/tables.html`, `e2e/tables.spec.ts`)

A table split across two pages in one editable host: its header row repeated on the second page
as non-editable content, one row split at a line. Chromium, Firefox and WebKit (Playwright,
Windows), 2026-11-16:

| Experiment                                     | Chromium                     | Firefox                         | WebKit                       |
| ---------------------------------------------- | ---------------------------- | ------------------------------- | ---------------------------- |
| ArrowRight at a cell's end                     | next cell's start            | next cell's start               | next cell's start            |
| ArrowDown twice from the last row on page 1    | the split row's rest (p. 2)  | the row after it (skips a line) | the split row's rest (p. 2)  |
| ArrowUp from the first row on page 2           | the next column's cell, p. 1 | **inside the repeated header**  | the next column's cell, p. 1 |
| Typing in a cell on page 2                     | stays in the cell            | stays in the cell               | stays in the cell            |
| Shift+ArrowDown, Shift+ArrowRight across cells | one range                    | one range                       | one range                    |
| A click in the repeated header                 | **caret in the header**      | **caret in the header**         | **caret in the header**      |
| Enter at a cell's end (not prevented)          | a new paragraph in the cell  | a new paragraph in the cell     | a new paragraph in the cell  |

Horizontal movement and typing inside cells work natively everywhere. Vertical movement across
rows and pages is inconsistent (Firefox skips a line, two engines change column) and two engines
put the caret into the non-editable repeated header; every engine puts a click's caret there.
So the view owns vertical movement in tables and redirects carets out of repeated rows, as it
already owns Enter and Backspace.

## Options

- **A. Tables as nodes in the model; rows as the units of the flow.** `table` → `tableRow` →
  `tableCell` → blocks (paragraphs, nested tables). Each page holds a `<table>` with the rows (or
  row parts) that fall on it; header rows are drawn again on later pages as non-document DOM.
- **B. Keep tables opaque, edit each cell in its own editor.** Rejected: no selection, undo,
  tracked changes or search across cells and the text around them; a second engine per cell.
- **C. One `<table>` across pages, paginated by CSS.** Rejected: browsers do not fragment a
  table inside an editable host the way print does, and the flow could not place it.

## Decision

**Option A.**

- **Model (schema v4).** `table` (block; attrs: `style`, Word's `w:tblPr` as attributes:
  width, alignment, indent, layout fixed or autofit, borders, cell margins, shading, the
  style's `tblLook` options; `grid`: the column widths of `w:tblGrid`; `ext`: the `w:tblPr` read
  verbatim, as paragraphs keep theirs), `tableRow` (attrs from `w:trPr`: height and rule,
  `cantSplit`, `header` (`w:tblHeader`), revisions on the row; `ext`), `tableCell` (content
  `block+`; attrs from `w:tcPr`: width, `gridSpan`, `vMerge` (`restart`/`continue`, as Word
  keeps it: a merged-down cell is present in every row it covers), borders, shading, margins,
  vertical alignment, text direction; `ext`). Merges keep Word's representation so the round trip
  is exact; layout derives the spans. Whatever a table holds that the model does not (a table
  property it lacks, a cell-level tracked change it cannot hold) stays verbatim in `ext` or as
  opaque content; a whole `w:tbl` the importer cannot model stays an `opaqueBlock`, reported.
- **Table styles.** Conditional formatting (first and last row and column, odd and even bands,
  corner cells, as `tblLook` turns them on) is resolved by `Resolver` per cell, in Word's order:
  table style, then the conditional parts, then the cell's and paragraph's own properties.
- **Pictures.** One inline node, `picture` (attrs: `resource` (the key of the image in the
  envelope's `resources`), size in EMU, `alt` (`wp:docPr/@descr`), `title`, `decorative`,
  `float`: null for an inline picture or the anchor (position relative to page, margin, column
  or paragraph; wrapping: square, tight, through, top-and-bottom, behind, in front; distances);
  `ext`: the drawing's XML, so cropping, effects and anything else come back unchanged).
  `resources` in the envelope: per key, the content type and where the bytes are: the original
  package's part (a `.docx` import), a URL the app gave, or (opt-in) a `data:` URL. No base64 in
  the JSON by default. Inserting a picture goes through an upload hook the app provides
  (`(file) => Promise<{ src }>`); exporting a picture the package lacks asks the app for its
  bytes. A picture without alt text is allowed (Word allows it) but reported by import and
  flagged in the UI; inserting one asks for it.
- **Layout.** The flow's units become rows: a `table` contributes its rows, each a unit whose
  height is the tallest cell. A row that does not fit splits at a line (each cell at its own line
  boundary, as Word does) unless `cantSplit`; a row taller than a page splits regardless. Header
  rows (`header`) are drawn again at the top of every page the table continues on, as
  non-document DOM (`contenteditable="false"`, no leaves). Paragraphs in cells are measured with
  the cell's width; their lines are the split candidates. Incremental reflow reuses rows by node
  identity, as blocks today. Floating pictures are exclusion rectangles for the lines of the
  paragraphs beside them (square and top-and-bottom first; the other wrappings drawn as square,
  reported), anchored to their paragraph's page.
- **Positions and DOM.** Paragraphs inside cells are leaves as top-level ones are: the
  position mapping walks pages → table fragments → rows → cells → blocks. Repeated header rows
  and the cell parts of a split row on the next page map to the row's own positions (the part
  carries its offset range, as paragraph fragments do). A DOM point inside a repeated header maps
  to the first editable position of the table's first body row on that page.
- **Selection.** A `CellSelection` (anchor cell, head cell: a rectangle) in core, beside text and
  node selections. The view draws it with a class on the cells and keeps the native selection
  collapsed in the head cell; copy gives the cells as a table, Delete empties their content, typing
  replaces the anchor cell's content. A text selection that starts outside a table and ends inside
  it extends to whole rows, as Word does.
- **Keyboard.** Left, Right and typing stay native inside cells. The view handles Up and Down
  when the next line is in another row or on another page, Tab and Shift+Tab (next and previous
  cell; Tab in the last cell adds a row), Enter and Backspace (a cell keeps at least one
  paragraph; Backspace at a cell's start does nothing), and redirects carets out of repeated rows.
- **Tracked changes and comments.** Text in cells is tracked as everywhere (9.2). Inserting or
  deleting a row records the row's revision (`w:trPr/w:ins`, `w:del`) as Word does; accept and
  reject act on rows too. Deleting a whole table while tracking deletes its rows. Comments anchor
  in cells as in paragraphs. Cell-level revisions Word writes (`w:cellIns`, `w:cellDel`,
  `w:cellMerge`) are kept verbatim and shown, not recorded (reported).
- **Format.** Schema v4 adds the node types and `resources`. The v3 → v4 migration changes the
  version only (an opaque table stays opaque until its `.docx` is imported again): 0.4.0 cannot
  read v4 documents, which the 0.5.0 changeset says.

## Consequences

- The flow and position mapping gain a level (rows and cells) and the view handles vertical
  movement and clicks in tables itself: most of Phase 10's risk. The spike's experiments become
  e2e tests of the real view in 10.5 and 10.6.
- A row split across pages keeps Word's rule (each cell at its own line); page agreement with
  Word is measured cell paragraph by cell paragraph (10.5).
- Pictures add the first binary data the document refers to: apps that store documents as JSON
  store pictures beside them (the upload hook), or opt into `data:` URLs.
- Nested tables are modeled (a cell holds blocks) but not split across pages inside an outer row
  (kept whole; reported where they do not fit), until measured otherwise.
