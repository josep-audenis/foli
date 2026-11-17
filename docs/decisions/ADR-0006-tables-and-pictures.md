# ADR-0006: Tables and pictures in the model and on pages

- **Status:** Accepted (owner, 2026-11-16), task 10.1.
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
as non-editable content (`thead contenteditable=false`), one row split at a line (a3 on page 1,
its rest a3b on page 2; b3 its second cell). Where the caret is after each press, in Chromium,
Firefox and WebKit (Playwright, Windows), 2026-11-16:

| Experiment                              | Chromium                | Firefox                                                | WebKit                  |
| --------------------------------------- | ----------------------- | ------------------------------------------------------ | ----------------------- |
| ArrowRight at a cell's end              | next cell's start       | next cell's start                                      | next cell's start       |
| ArrowDown ×3 from a3 (last row, page 1) | b3 → a3b → a4           | a3b → a4 → after the table                             | b3 → a3b → a4           |
| ArrowUp ×2 from a3b (first row, page 2) | b3 → a3                 | **page 1's header row** (skips three rows) → before it | b3 → a3                 |
| Shift+ArrowDown ×2 from a1              | b1 → a2                 | a2 → a3                                                | b1 → a2                 |
| A mouse drag from a1 to b2              | one range               | **four ranges** (one per cell)                         | one range               |
| A click in the repeated header          | **caret in the header** | **caret in the header**                                | **caret in the header** |
| Typing in a cell on page 2              | stays in the cell       | stays in the cell                                      | stays in the cell       |
| Enter at a cell's end (not prevented)   | a paragraph in the cell | a paragraph in the cell                                | a paragraph in the cell |

Horizontal movement and typing inside cells work natively everywhere. Vertical movement is not
Word's: Chromium and WebKit go to the next column first, Firefox jumps to the table's first row
going up (skipping rows) and leaves the table going down. Every engine puts a click's caret into the repeated
header, and Firefox selects dragged cells as one range each. So the view owns vertical movement
(with and without Shift) and redirects carets out of repeated rows, as it already owns Enter and
Backspace, and reads a selection of several ranges back as a `CellSelection`.

## Options

- **A. Tables as nodes in the model; rows as the units of the flow.** `table` → `tableRow` →
  `tableCell` → blocks. Each page holds a `<table>` with the rows (or row parts) that fall on
  it; header rows are drawn again on later pages as non-document DOM.
- **B. Keep tables opaque, edit each cell in its own editor.** Rejected: no selection, undo,
  tracked changes or search across cells and the text around them; a second engine per cell.
- **C. One `<table>` across pages, paginated by CSS.** Rejected: browsers do not fragment a
  table inside an editable host the way print does, and the flow could not place it.

## Decision

**Option A.**

### Model (schema v4)

- **Nodes and content.** `doc` content `block+` as now (`paragraph | table | opaqueBlock`).
  `table` content `tableRow+`; `tableRow` content `tableCell+`; `tableCell` content
  `(paragraph | table | opaqueBlock)* paragraph`: as Word requires, a cell ends with a paragraph.
  Validation (and the commands) keep Word's other rules: a table is followed by a paragraph (two
  tables in a row would merge in Word: Foli inserts the paragraph Word would); the body ends with
  a paragraph; a paragraph in a cell carries no section break and no page or column break (refused
  when parsing, removed with a report when importing). (10.3: checked as "no table right after
  a table, none ending the body": a table followed by opaque content is accepted, as Word opens
  it, and a body ending with an opaque block stays valid, as in v3. 10.4: a table whose cell
  has such a break stays an opaque block on import instead, so nothing is removed.)
- **Properties.** `table` attrs from `w:tblPr` (style, width, alignment, indent, layout fixed or
  autofit, borders, cell margins, shading, `tblLook`), `grid` (`w:tblGrid` widths), `ext` (the
  `w:tblPr` verbatim, as paragraphs keep theirs); `tableRow` from `w:trPr` (height and rule,
  `cantSplit`, `header`, `gridBefore` and `gridAfter` with their widths, the row's revision,
  `ext`) and `tblPrEx` (the row's table property exceptions, kept as `exceptions`: attrs of the
  same shape as the table's); `tableCell` from `w:tcPr` (width, `gridSpan`, `vMerge`
  `restart`/`continue`, borders, shading, margins, vertical alignment, text direction, `noWrap`,
  `ext`). Merges keep Word's representation (a merged-down cell is present in every row it
  covers) so the round trip is exact; layout derives the spans.
- **What stays verbatim.** In `ext`: properties the model lacks, `w:cnfStyle`, `w:hideMark`,
  `w:tcFitText`. Shown and exported unchanged, not recorded: cell-level revisions
  (`w:cellIns`, `w:cellDel`, `w:cellMerge`) and `w:tblPrChange`/`w:trPrChange`/`w:tcPrChange`
  read from files (kept in `ext`, reported). The whole `w:tbl` stays an `opaqueBlock` (reported)
  when a row or cell sits inside `w:sdt`, `w:customXml` or another wrapper the model cannot hold.
  An `opaqueBlock` table stays a valid v4 shape, shown by the read-only renderer; table commands
  do not apply to it.
- **Table styles.** Conditional formatting (first and last row and column, odd and even bands,
  corner cells, as `tblLook` turns them on) is resolved by `Resolver` per cell, in Word's order:
  table style, the conditional parts, then the cell's and paragraph's own properties.

### Pictures

- **Which drawings.** A `w:drawing` whose graphic is a picture (`pic:pic`) becomes a `picture`
  node; charts, shapes, SmartArt, text boxes, VML and any other graphic stay `opaqueInline`.
- **The node.** One inline node, `picture`: `resource` (a key in the envelope's `resources`),
  size in EMU, `alt` (`wp:docPr/@descr`), `title`, `decorative`, `float` (null for an inline
  picture, else the anchor: position relative to page, margin, column or paragraph; wrapping:
  square, tight, through, top-and-bottom, behind, in front; distances), `ext` (the drawing's XML,
  so cropping, effects and anything else come back unchanged).
- **Resources.** `resources` in the envelope, per key: the content type and where the bytes are
  (a part of the original package; a URL the app gave; opt-in, a `data:` URL). No base64 in the
  JSON by default. An SVG picture with its PNG fallback (`asvg:svgBlip`) has two resources, both
  kept. Export writes `r:embed` (and `r:link` for linked pictures) from the resource: an unchanged
  picture keeps its relationship and part; a new or replaced one gets a new media part and
  relationship, its bytes asked of the app when the package lacks them.
- **The app's part.** An upload hook (`(file) => Promise<{ src }>`) for inserting and pasting
  pictures, and a resolver (`(resource) => string`) for a URL the view can show for a resource
  that lives in a package part (the docx package gives one through object URLs). A picture pasted
  into another document carries its resource; one whose bytes the target cannot reach is pasted
  as a placeholder, reported.
- **Alt text.** A picture without alt text is allowed (Word allows it) but reported by import
  and marked in the UI; inserting one asks for it. (10.8d: a picture pasted or dropped goes in
  without asking, as an imported one, marked, its alt text asked for later; inserting from a
  file asks for it.)

### Layout

- **Units.** The flow's units for a table become row groups: a row, or the rows a vertical merge
  spans (a merged cell's content is laid out across them), kept as one unit. A unit's height is
  its tallest cell (or merged cell over its rows), with the row heights' rules.
- **Splitting.** A unit that does not fit splits at a line unless a row of it is `cantSplit`; a
  unit taller than a page splits regardless. A split unit's fragment keeps, per cell, the range
  of that cell's lines it holds (`Fragment` gains a per-cell line range; a paragraph fragment
  keeps its single range). Header rows (`header`) are drawn again at the top of every page the
  table continues on, as non-document DOM (`contenteditable="false"`, no leaves).
- **Measurement.** Paragraphs in cells are measured with the cell's resolved width. A table's
  units are cached by node identity together with the table's resolved grid: with autofit, an
  edit that changes a column's width measures the table's rows again. Nested tables are laid out
  inside their cell and kept whole within the outer row (reported when they do not fit a page).
- **Floating pictures.** Exclusion rectangles for the lines beside them (square and
  top-and-bottom first; other wrappings drawn as square, reported), anchored to their paragraph's
  page. An exclusion changes the lines of every paragraph it overlaps, so those paragraphs are
  measured again when a picture moves. How the browser lays lines out around an exclusion inside
  the editable host (CSS floats or `shape-outside`) has no spike evidence yet: 10.9 starts with
  one, and this part of the decision is an open risk until then.

### Positions, selection and keyboard

- **Positions and DOM.** Paragraphs inside cells are leaves as top-level ones are: the
  position mapping walks pages → table fragments → rows → cells → blocks. A split row's parts
  carry their offset ranges, as paragraph fragments do. A DOM point inside a repeated header maps
  to the first editable position of the table's first body row on that page.
- **`CellSelection`** in core (JSON `{ type: "cell", anchor, head }`, the positions of the anchor
  and head cells; `Selection.fromJSON` reads it): the rectangle of cells between them, merged
  cells widening it. Mapped through changes by its cells; when the anchor or head cell is deleted
  it falls back to a text selection near it. The view draws it with a class on the cells, keeps
  the native selection collapsed in the head cell, and reads a native selection of several ranges
  (Firefox) or one spanning cells back as a `CellSelection`. Copy gives the cells as a table,
  Delete empties their content, typing replaces the anchor cell's content.
- **Keyboard.** Left, Right and typing stay native inside cells. The view handles Up and Down
  (and Shift+Up and Shift+Down, which grow a `CellSelection` once they leave a cell) when the next
  line is in another row or on another page, Tab and Shift+Tab (next and previous cell; Tab in
  the last cell adds a row), and redirects carets out of repeated rows.

### Editing across a table's edges

- **Cells isolate.** A cell's content is never joined with what is outside it: Backspace at a
  cell's start and Delete at its end do nothing; Enter in a cell splits its paragraph there.
- **Next to a table.** Backspace in the paragraph after a table, at its start, and Delete at the
  end of the paragraph before one select the table's last (first) cell's content end (start), as
  Word moves into the table; Delete with the whole table selected deletes it (and a following
  empty paragraph Word would not keep).
- **A selection across an edge.** A text selection from outside a table into it extends to the
  whole rows it touches (as Word selects); deleting it deletes those rows and the text outside.
  Core gains the step this needs: a range delete that removes whole rows and the partial
  paragraphs at its ends, joining nothing across a table, written as ordinary `ReplaceStep`s
  (structure kept valid at each step). A selection inside one cell is ordinary text.
- **Paste.** Rows pasted into text insert a table (split the paragraph); rows pasted into a
  `CellSelection` or a cell fill the cells from there, adding rows as needed (not columns:
  extra cells are dropped, reported); text pasted into a `CellSelection` goes into its anchor cell.

### Tracked changes and comments

- **Text in cells** is tracked as everywhere (9.2): the rebuild's ranges stay inside cells.
- **Rows.** A tracked edit whose range covers whole rows records each row's deletion (a markup
  step setting the row's revision, `w:trPr/w:del`) instead of removing it; inserted rows get
  `w:trPr/w:ins`; text in partly covered cells is deleted per cell. Accept and reject act on
  row revisions (a deleted row accepted goes; an inserted row rejected goes). Deleting a whole
  table while tracking deletes its rows.
- **Not tracked, refused while tracking** (Foli does not record them yet; Word records some, as
  `w:tblPrChange`, `w:trPrChange`, `w:tcPrChange`, kept when read): inserting or deleting
  columns, merging and splitting cells, changing table, row or cell properties (9.3's paragraph
  and run records unchanged).
  The commands say so (they do not apply while tracking). A picture's size does not change while
  tracking either; its alt text does, untracked (Word does not track it).
- **Comments** anchor in cells as in paragraphs; deleting a row deletes the comments whose
  reference goes with it (9.6).

### Format

Schema v4 adds the node types and `resources`. The v3 → v4 migration changes the version only
(an opaque table stays opaque until its `.docx` is imported again): 0.4.0 cannot read v4
documents, which the 0.5.0 changeset says.

## Consequences

- The flow and position mapping gain a level (row groups and cells) and the view handles
  vertical movement and clicks in tables itself: most of Phase 10's risk. The spike's experiments
  become e2e tests of the real view in 10.5 and 10.6.
- Core gains table-aware delete, join and paste before the view's editing (10.6 builds on them).
- A row split across pages keeps Word's rule (each cell at its own line); page agreement with
  Word is measured cell paragraph by cell paragraph (10.5).
- Pictures add the first binary data the document refers to: apps that store documents as JSON
  store pictures beside them (the upload hook and resolver), or opt into `data:` URLs.
- Floating pictures depend on a spike (10.9); until it passes, only inline pictures are a
  commitment.
