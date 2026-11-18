# Known limitations

What Foli does not do yet, or does with caveats, as of 0.5.0. Read it before you ship. Details
and the reasons are in [architecture.md](architecture.md), [pagination.md](pagination.md) and
[ADR-0003](decisions/ADR-0003-rendering-and-input.md); what comes next is in the
[roadmap](roadmap.md).

## Not verified by hand

The editor is tested in Chromium, Firefox and WebKit (Playwright on Windows), but the manual
checks below have not been run yet, and some automated parts cover one engine only (IME
emulation exists only in Chromium; paste is not automated in WebKit). The project owner accepted them as open risks
([ADR-0003](decisions/ADR-0003-rendering-and-input.md#gate-g4-passed-provisionally-2026-11-07);
checklist in [testing/ime.md](testing/ime.md)):

- **IME and dead keys** (Japanese, Chinese, Korean; accented letters): tested only through
  Chromium's emulation, including next to a page break. Not on real Windows, macOS, Android or
  iOS input methods.
- **Screen readers** (NVDA, VoiceOver): not tried, including read-only mode, the placeholder,
  and a paragraph split across two pages (it may be read as two paragraphs).
- **macOS key bindings** (Cmd/Option+arrows, Cmd/Option+Backspace, Ctrl+K/H/D).
- **Spellcheck and autocorrect** replacing a word at the end or start of a page.
- **Pastes from real Word, Google Docs and LibreOffice**: the test fixtures are hand-written
  approximations.
- **Safari**: tests run on Playwright's WebKit on Windows, not Safari on macOS or iOS.

## Content

- The editor holds schema v5 (Word's model, 8.7; tables and pictures, 10.3; v5's stories, fields and content controls are not produced yet): paragraphs in
  styles (headings are Word's heading styles), lists as Word's numbering, run formatting, line
  and page breaks, links, tables, inline and floating pictures, fields (shown with their stored
  results) and content controls (their text editable, nothing marking them yet; those bound to
  data, showing their placeholder or with locked content stay opaque); everything else
  Word has (charts, shapes...) is kept as opaque content, selected and deleted whole. Documents saved by 0.1.0 to 0.4.0 are migrated when loaded; 0.4.0 cannot read
  documents saved by 0.5.0. No headers, footers or page numbers (Phase 11). Sections are laid out with their own page
  setups; a continuous section with another page setup starts a new page, and an even or odd
  page section gets no blank page before it. Page setups and section breaks are not editable
  yet.
- Imported headers, footers, footnotes and endnotes are in the document (`stories`) and exported,
  but the editor does not show or lay them out yet, and a note's reference shows nothing.
- No horizontal rule button (Word's rule is a paragraph's bottom border, kept and shown).
- On Android, Backspace at a list paragraph's start may join it into the paragraph before
  instead of removing its number (untested on a device).
- Colors come from a fixed palette in the toolbar (seven text colors, Word's highlights); any
  `#rrggbb` works through `setTextColor` (a highlight outside Word's is written as shading).
- Left and Right next to an opaque block treat Left as backward: in right-to-left text, Left at
  the start of a paragraph selects the block before it (left-to-right is the only direction the
  view handles fully).
- Up and Down next to an opaque block decide "first or last line" from the caret's on-screen
  box: at a position where the browser gives none (beside some line breaks) the browser moves
  the caret instead, past the block.
- Links:
  - A link address without a scheme that looks like a host name gets `https://`
    (`page.html` too): write `./page.html` for a relative link.
  - Links are not followed on touch devices (no Ctrl/Cmd+click), nor with a middle click;
    there is no hover preview of the address.
  - Mod-K opens the dialog only with a `FoliToolbar` for the editor; elsewhere it does
    nothing (the browser's own Ctrl+K is not run inside the document). With two toolbars for
    one editor, each opens its own dialog.
  - Relative links include `//host/path`, which goes to another site over the page's own
    protocol (allowed by the format; the protocol is still http or https).
- HTML paste keeps paragraphs, headings, lists, rules, links, colors and alignment; tables from
  other applications become paragraphs, images in pasted HTML are dropped (an image file pasted
  or dropped alone goes to the upload hook). Word and Google Docs lists are read best effort, from
  hand-written fixtures, not real captures. Pasted text colors equal to black or white and
  highlights equal to white are dropped (defaults, or text from a dark page); colors on block
  containers (a web page's colored sections) and a link's own underline and color are not
  kept. A pasted
  plain-text URL becomes a link.
- Drag and drop of text does nothing.
- Some Android keyboards insert paragraphs without the events the editor needs; such an edit is
  discarded with a `Foli:` console warning.
- Documents in `schemaVersion: 1` load in later versions: they migrate without dropping
  content.

## Tables

- Autofit tables keep the column widths Word saved (Foli does not fit them to their content);
  border conflicts are resolved by the browser's `border-collapse`, close to Word's rules.
- A row splits across pages between its lines; a row in a vertical merge, or holding a nested
  table, moves whole to the next page.
- Rows pasted into a table fill its cells from the selected one; columns beyond the table's are
  dropped (not reported). Tables pasted from other applications become paragraphs.
- No keyboard way to set a column's width (drag its border); a nested table's column borders
  cannot be dragged. Nested tables are drawn whole with their parent's row.
- Table styles: banding, the first and last column and inside borders count cells, not grid
  columns, so a table with merged cells or rows starting late (`gridBefore`) may be formatted
  differently from Word; a style's whole-table conditional format (`wholeTable`) is kept
  and exported but not applied; where Word lets a table style's paragraph properties win over
  the Normal style's, Foli uses Normal's.
- An exact row height is drawn as a minimum (a cell never clips its content), and contextual
  spacing between paragraphs in a cell is not applied.
- Copying cells: a row with no cell of its own in the selected columns (a gap Word leaves with
  `gridBefore`/`gridAfter`) is left out of the copy, so pasted rows after it land one row
  higher.
- `renderDocument` (read-only) draws a vertically merged cell as an empty cell under the first
  (with any inside border between them); the editing view draws it as one cell.
- Page agreement in cells: 277 of the corpus's 280 cell paragraphs are on Word's page; the
  three others are one row of 02's fee table that Word moves to the next page and Foli keeps on
  the first.
- A text range across cells deleted through the API (not a cell selection) empties the cells in
  document order between its ends, not Word's rectangle.
- While tracking, text in cells is tracked as everywhere; of the table's structure only rows
  are (inserted and deleted as Word records them): column commands, merging and splitting cells,
  header rows, table styles, shading and column widths are refused. A table style's own definition cannot be changed (a changed one is refused on
  export).
- A table the model cannot hold stays opaque (a page, column or section break in a cell, and
  the other cases in the [docx README](../packages/docx/README.md)).
- IME in table cells is tested in Chromium only, as everywhere else.

## Pictures

- Pictures are inline or floating (wrapped square and top-and-bottom, behind and in front of
  text); tight and through wrapping are shown as square, and text goes on one side of a square
  picture only (the side with more room). Charts, shapes, text boxes and linked images stay
  opaque, and so do floating pictures positioned by `simplePos`, hidden, or sized relative to
  the page.
- A picture whose resource is a web `url` is fetched by the view as soon as it is shown (with
  no referrer) unless the app's `resource` resolver returns `null` for it: for JSON documents
  from untrusted sources, resolve or block such URLs.
- A floating picture is laid out with its paragraph; a square or top-and-bottom picture placed
  against the page or its margins vertically is drawn at its paragraph's top, horizontal
  positions count the paragraph's indents, several floating pictures in a paragraph stack
  instead of sitting side by side, and a picture reaching past the page's text makes the page
  taller instead of moving to the next page. Positions are against the last section's page; a
  horizontal position against a character is drawn against the column. There is no command to change a
  picture's position or wrapping; one changed through the API is written as a new drawing,
  losing what only its original held (cropping, effects, z-order).
- A picture behind text cannot be clicked where text covers it (select it with the keyboard).
- A floating picture in a table cell is placed against the page, not its cell.
- Screen readers meet a floating picture at the start of its paragraph (or of the part on that
  page, for a paragraph split across pages), where it is drawn, not at its place in the text (not tried with a screen reader; see "Not verified by hand").
- Pictures are inserted, and resized by dragging, no wider than the last section's text, not
  the caret's section or table cell.
- In the editing view a line holding only a picture is measured from its span's box, not the
  image: such a line can end a page a little early. `renderDocument` measures text lines only: a
  paragraph holding only a picture moves to the next page whole, and a page break may fall
  inside a picture standing between text lines.
- Pages settle after an edit near a floating picture (checked with one split across two
  pages); a block that might move back and forth between two pages beside a float is not
  tested.
- Pasting and dropping image files is tested in Chromium only (synthetic events carry no files
  in the other engines).
- No cropping, rotation or touch resizing; resizing is refused while tracking (Foli does not
  record a size change yet). Alt text changes are not tracked.
- Pictures copied to another document lose their images (their resources stay behind); Word's
  picture-and-text paste brings the text only. The clipboard writes a floating picture inline.
- `renderDocument` measures blocks on one long page: the lines after a floating picture may
  wrap a little differently than on the editing view's pages.
- Word's line numbers count the lines beside a floating picture differently from its own
  layout: `pnpm corpus:pages` reports fewer paragraphs on Word's line there (04: 25 of 35, 33
  in 0.3.0 before the chart was laid out; 101 of 115 for the corpus). Accepted as a known
  limit (2026-11-17).

## Tracked changes and comments

- While tracking, an edit that would delete or insert content Foli keeps verbatim (an opaque
  block) is not made; tables are tracked row by row. Moves are kept and shown from imported files but not
  recorded: moving text records a deletion and an insertion.
- Accepting removes a paragraph whose text and mark are both deleted whole, as Word does; the
  same edits made untracked, one after another, may have kept its properties on the joined
  paragraph. Enter in a paragraph next to a deleted paragraph mark splits that paragraph as it
  is, not the paragraph accepting would make.
- In the simple and no-markup views, a paragraph whose mark is deleted is not shown joined with
  the next while editing (`renderDocument` joins it).
- Changes' and comments' dates are written in UTC; Word writes local time there, so Word shows
  Foli's times shifted by the time zone.
- Comments: the pane (`FoliComments`) is React only (the view marks commented text); a comment
  with formatting other than its paragraph style is not editable there, only replied to,
  resolved or deleted. A comment anchored inside content Foli keeps verbatim (an opaque block)
  stays: its anchors there cannot be removed.
- Revisions carry no initials (Word has none); comments do.

## .docx (`@folijs/docx`)

Details in the [package README](../packages/docx/README.md).

- Strict Open XML documents are refused (`DocxError`) until a real file needs them. Encrypted
  zip entries, ZIP64 and compression methods other than stored and deflate are refused too.
- Keep the imported `package` with the document: a document that refers to parts of its
  original package (headers, footers, pictures, content kept verbatim with relationship ids)
  cannot be exported without it (`DocxError`).
- The theme is read-only: export keeps the original part; a new package has none, so Word's
  default theme applies.
- Elements Foli does not model (charts, shapes, equations...) are
  kept verbatim and exported, but are not editable. A value the model cannot hold (out of
  range, a unit such as `1.5cm`) stays in its element and is exported, but is not editable
  (`report.unmodeled`).
- Import does not keep exactly what Word reads as the same: run boundaries (adjacent runs with
  the same properties become one), `w:cr` (read as a line break), non-breaking and soft hyphens
  (read as U+2011 and U+00AD), XML comments, processing instructions and whitespace between
  elements. Spelling marks, rendered page breaks, editing session ids and runs with no content
  are not imported (Word recomputes them or they show nothing).

## Pages

- Page breaks depend on the fonts the browser has: the same document can paginate differently
  on another machine, or before a web font loads (the editor re-flows when it does).
- Line measurement assumes left-to-right text and no `vertical-align` offsets: right-to-left
  text may break across pages at the wrong line.
- A split paragraph repeats its padding and border on both pages. Negative block margins are
  not modelled.
- A CSS change that only alters block margins, or rewraps text without changing any block's
  height, is noticed only at the next height change.
- No virtualization: every page is in the DOM and measured on load. Fine up to a few hundred
  pages ([benchmarks.md](benchmarks.md): 100 pages lay out in about 40–85 ms, a keystroke
  paints within 8–19 ms at p95 in Chromium and Firefox).
- Long documents made of lists were slower in 0.2.0 (schema v2, where lists were nested
  blocks; not measured on schema v3 yet): in a 114-page list document, Enter near the top took
  about 9-24 ms to handle (p50) and up to ~65 ms to paint (p95), and the first layout ~85-95 ms,
  about twice a paragraph document (two runs, [benchmarks.md](benchmarks.md)). An edit there
  moved the last item of every later page to the next one; every render also walks every
  block.
- Formatting thousands of paragraphs at once is slow: bold over 4,000 paragraphs takes about
  0.6 s, the next edit about 0.7 s, its undo about 0.5 s.
- Undo history keeps the last 100 undo steps (a run of typing is one step).

## Print

- One `@page` size per web page: with several editors of different page sizes, the last one's
  sheet size wins.
- Sections with different page setups print on sheets of their own size through named pages;
  engines without named pages print every sheet at the last section's size.
- Print-only CSS must not change text metrics. PDF output is checked in Chromium only.
- Your page's other content prints too; hide it ([styling.md](styling.md#print)).

## React and the browser

- Server rendering gives the editor's shell, not its content: the document appears on
  hydration, so it is not indexed from the server HTML.
- `FoliEditor` is uncontrolled: `initialContent` is read once. Load another document with
  `editor.setDocument()` or a new `key`; there is no `value` prop.
- `editor.setDocument()` during an IME composition is not handled: load documents from a click
  or a file picker (which end the composition), not from a timer.
- A Content Security Policy without `'unsafe-inline'` styles hides the placeholder and breaks
  print sheets ([styling.md](styling.md#content-security-policy)).
- `Plugin`, `Transaction` metadata, steps and mapping are exported but not a stable API.
