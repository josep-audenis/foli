# Known limitations

What Foli does not do yet, or does with caveats, as of 1.6.0 (`@folijs/agent` 0.3.3,
`@folijs/mcp` 0.2.3, `@folijs/collab` 0.1.0: Phase 21 fixed what an audit of 1.4.0 found, what it
left is marked "Phase 21" below; Phase 22's collaboration has a section of its own). Read it before you ship. The
owner decided on 2026-11-20 that each of these ships in 1.0 as a known limit (the one picked as a
blocker, pictures losing their images when copied into another document, was fixed first, in
12.11); 1.x minors may lift them. Details
and the reasons are in [architecture.md](architecture.md), [pagination.md](pagination.md) and
[ADR-0003](decisions/ADR-0003-rendering-and-input.md); what comes next is in the
[roadmap](roadmap.md).

## Not verified by hand

The editor is tested in Chromium, Firefox and WebKit (Playwright on Windows), but the manual
checks below have not been run yet, and some automated parts cover one engine only (IME
emulation exists only in Chromium; paste is not automated in WebKit). The project owner accepted them as open risks for 0.x
and again for 1.0 on 2026-11-20
([ADR-0003](decisions/ADR-0003-rendering-and-input.md#release-10-with-the-manual-checks-open-decided-2026-11-20);
checklist in [testing/ime.md](testing/ime.md)):

- **IME and dead keys** (Japanese, Chinese, Korean; accented letters): tested only through
  Chromium's emulation, including next to a page break. Not on real Windows, macOS, Android or
  iOS input methods.
- **Screen readers** (NVDA, VoiceOver): not tried, including read-only mode, the placeholder,
  and a paragraph split across two pages (it may be read as two paragraphs).
- **macOS key bindings** (Cmd/Option+arrows, Cmd/Option+Backspace, Ctrl+K/H/D), and Word's keys
  as [keyboard.md](keyboard.md) maps them there (Cmd for Ctrl, Option for Alt): some are the
  system's or the browser's before the page sees them (Cmd+H, Cmd+Option+D, F3).
- **Spellcheck and autocorrect** replacing a word at the end or start of a page.
- **Pastes from real Word, Google Docs and LibreOffice**: the test fixtures are hand-written
  approximations.
- **Safari**: tests run on Playwright's WebKit on Windows, not Safari on macOS or iOS.

## Content

- The editor holds schema v5 (Word's model, 8.7; tables and pictures, 10.3; stories, fields,
  content controls and notes, 11.3): paragraphs in styles (headings are Word's heading styles),
  lists as Word's numbering, run formatting, line and page breaks, links, tables, inline and
  floating pictures, sections with columns, headers, footers, footnotes and endnotes, fields,
  content controls and bookmarks (see below); everything else Word has (charts, shapes...) is
  kept as opaque content, selected and deleted whole. Documents saved by 0.1.0 to 0.5.0 are
  migrated when loaded (a v4 document's opaque headers, notes and fields stay so until its
  `.docx` is imported again); 0.5.0 cannot read documents saved by 0.6.0, and 0.6.0 cannot read
  one holding custom node or mark types. Sections are laid out with their own page
  setups and columns (11.6); a continuous section with another page setup starts a new page, and
  a next-column section with another number of columns too. A paragraph split between columns of
  different widths is measured there by its share of the text, so a line can differ, and on
  read-only pages (`renderDocument`) a few words can repeat or go missing where it continues.
  Deleting a selection across a section break does not pass that section's header references to
  the next (Delete, Backspace at the break and `removeSectionBreak` do). The break itself is not
  drawn: an empty paragraph ending a section takes no room, as in Word, and the caret reaches it
  by the keyboard.
- Headers and footers are on the pages and edited there (11.7). While one is open its page fields
  show their stored results (the other pages show theirs). Moving between a header and the body takes a double click or the toolbar (no keyboard
  shortcut of its own). Headers are not dimmed while the body is edited, as they are in Word.
- Content controls (11.9) follow Word's rules for locks, placeholders and what each kind holds. A
  control bound to data shows what the file stores and cannot be edited: bindings are kept, not
  evaluated, and Word replaces such content with the bound value when it opens the file. A date typed
  in a date control is read but not reformatted; picked dates are written in English whatever the
  control's language. A control that removes itself when edited (`w:temporary`) stays; a group's
  fixed text can be edited; a picture control keeps its picture (no way to choose another). The
  placeholder text given to `insertControl` does not survive a save (no glossary entry is written),
  and a control's own tracked deletion is saved as its content's. An empty block control stays
  opaque. A date typed in a Russian or Ukrainian date control is not read as a date: the month
  names the browser gives are the standalone forms, the typed date uses another (Phase 21, found
  in review, not fixed).
- Fields (11.8) show their stored results until updated (F9, the Fields menu, `updateFields`,
  `view.print()`); the browser's own Print menu does not update them. Updated: `PAGE`, `NUMPAGES`,
  `SECTIONPAGES`, `DATE`, `TIME`, `SEQ`, `REF`, `PAGEREF`, `TOC`, `MERGEFIELD`. Any other field
  (`IF`, `STYLEREF`, formulas, form fields…), and a switch Foli does not follow (`TOC \c`, `\f`,
  `\l`, `\a`, `\s`, `\d`; `REF \f`, `\d`; the number words of `\* CardText`, `OrdText`,
  `DollarText`; a `\#` picture with backquotes, two points or a comma in its decimals), keeps its
  result and is reported; so does a reference to a missing bookmark or to a bookmark holding the
  field, where Word writes an error into the result, and bookmarks referring to each other, which
  Word lets grow at every update. `REF \p` and `PAGEREF \p` say "above", "below" and "on page" in
  English, whatever Word's language. A numbered table of contents entry's tab is 440 twips a level;
  Word works it out from the number's width. `\* MERGEFORMAT` keeps the old result's first run's look,
  not word by word. A `REF` to text over several paragraphs gets line breaks between them. Table of
  contents entries are plain: a heading's own italics are not carried over. Date names are in
  English. Codes shown cannot be edited there (Word's code editing, Shift+F9 for one field and
  Ctrl+F9 are not built); the last paragraph of a table of contents stays as an empty line under
  its code. A field's own `w:dirty` is kept after an update. A `MERGEFIELD` with a date picture
  (`\@`) reads its value as a date only in ISO form (`2026-03-05`, a time after it or not); a
  date in a language's own numeric form (`5/3/2026`) shows as written (Phase 21: the document's
  language is not known there). A fraction in a roman, letter or ordinal number format shows its
  digits; Word's own output there was not checked (Phase 21).
- Notes: a note's lines take no widow or orphan control and `w:continuationNotice` is not drawn. A
  reference kept verbatim in opaque content takes no number. Footnotes set beneath the text in a
  section with columns go to the foot. Options apply to the whole document, not to one section.
  With columns Word sometimes ends an earlier column sooner than its notes require, and a
  paragraph holding a reference at the end of a column can move to the next page where Word ends
  the column with it. Number formats
  beyond Word's common ones show as decimal numbers. Shift+Alt+N is Foli's: Word has no such key.
- On Android, Backspace at a list paragraph's start removes its number, as on a desktop: the
  keyboard's delete of the boundary before the paragraph is taken as the key at a caret (19.7;
  emulated, untested on a device).
- The toolbar's colors are a palette (seven text colors, Word's highlights; an app gives the
  menus another one, and the browser's color field with `custom`,
  [api.md](api.md#toolbar-items): checked by its tests only, not by hand in each browser; a
  browser that reports every movement in the field makes an undo step of each); the built-in
  menus offer no color picker by default; any
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
- Drag and drop of text (19.6): the selection dragged moves where it is dropped (pasted there,
  then deleted where it was: one undo step, tracked while tracking), copies with Ctrl or Option,
  and text dragged from another application is pasted where it lands. Selected cells are not
  dragged. The drop caret is the selection moved under the pointer (the dragged text is not
  highlighted meanwhile). A drop into another view of the same document, or between the body and
  a header, footer or note open on its page, copies rather than moves. Tested with synthetic drag
  events (a real `DataTransfer`), not the browsers' own drag of selected text; not on touch.
- Some Android keyboards split a paragraph without `beforeinput`, the browser changing the DOM:
  a paragraph split inside its text is read back and replayed as Enter (19.7; emulated,
  untested on a device). Such an Enter at a paragraph's very start or end (an empty paragraph
  added) is lost, and any other block or line break the browser adds is discarded with a `Foli:`
  console warning.
## Extensions, keys and the toolbar

Custom nodes and marks, plugins and toolbar items ([extensions](guides/extensions.md)).

- Node and mark views draw in the editor and, given the `extensions` (19.3), in `renderDocument`
  and `exportPdf` (a script setting `globalThis.foliPdfExtensions` in the page) and in headers,
  footers and notes as the pages show them; without them a custom node is its `.docx` text or its
  type in brackets and a custom mark is not drawn. Decorations and plugin views are the editor's
  only. On read-only pages, and in headers, footers and notes, what `render` returned is copied:
  the copies do not follow later changes to it (a chart drawn afterwards, a canvas's pixels) and
  `destroy` is not called; a custom block is kept whole unless taller than a page. In `exportPdf`
  a custom node whose attributes its spec refuses throws inside the page (Node validates without
  the extensions), and a script that fails prints the document without the views, silently. A custom block in a table cell is kept whole (it does not split between pages); a split
  block node view is drawn once per page (its `render` runs per part, each part's `destroy` when
  dropped). A node view's DOM is never read back: what it changes later is not checked, and
  `h`'s checks cover only what `h` makes. Decorations take body
  positions and nothing in tables' own nodes (tables, rows, cells); a decoration changing a
  block redraws and measures that block again. Find's marks and the selected field's shading stay
  on the Custom Highlight API and an attribute: decorations would redraw blocks for each match. Custom types
  are leaves and marks only (no custom containers in 1.x). A custom block node cannot be inserted
  or deleted as a tracked change (block content is tracked through paragraph marks).
  `setControlValue` with rich content holding an unknown custom type is refused.
- A copy holding custom content carries its Foli JSON in the HTML too, on one wrapping `div`
  (`data-foli-clipboard`), read back only when that wrapper is all the pasted HTML holds. An
  application that rewrites the HTML on the way (wrapping it in its own markup) loses the
  custom types: they paste as their text.
- An editor's schema is built once per extensions array and kept for it: do not change an array
  after giving it to `createEditor`, `parseDocument` or `exportDocx`; make a new one.
- `PluginSpec` is frozen for 1.x; the history plugin's state is internal, and collaboration is
  not part of 1.0 (steps, maps and mapping are public, which a later package needs).
- `extensions` (of `FoliEditor` and `useFoliEditor`) are read once: changing them after mount does
  not reconfigure the editor (a warning unless `process.env.NODE_ENV` is `"production"` at run
  time, which a bundle without `process` always shows; a new `key` makes a new editor, losing undo
  history and the selection). `plugins` follow the prop since 24.5 (`editor.reconfigure`).
- A toolbar wider than its place wraps, or with `overflow="menu"` puts whole groups under
  More: a group wider than the toolbar is then in the panel whole (its items are not split),
  and a change of an item's own width (a box showing a longer value, a late font) is not
  measured again. A tab that comes with the
  selection (`visible`) is not selected for the user, as Word's is not.
  People cannot change the toolbar themselves: an app does it over `items` or `tabs`.
- The Word ribbon (`wordRibbonTabs`, 1.9) has no File tab or backstage (open, save and print
  are the app's), no Quick Access Toolbar, and only the tabs Foli has commands for (no Design,
  Mailings or Draw). Its buttons show text, not Word's icons; a large one wraps its text, so
  drawn small it would be wider and stays large while groups go under More (Word's further
  steps, icon only and a group as one button, are not built). Launchers exist only where Foli
  has a dialog (Page setup, Note options): no Font or Paragraph dialog yet. Picture Format is the
  picture dialog and a quarter turn. KeyTips are one letter or digit each (35 per tab at most: A to Z, 1 to 9);
  they show on Alt released alone with the focus in the ribbon or an editable element, not
  checked with NVDA or JAWS. Ctrl+F1 may be the system's on macOS (the collapse button works
  there).
- The toolbar's strings are English unless an app gives `messages`; `FoliNavigation`,
  `FoliComments` and the canvas's own strings cannot be translated yet. One English text is one
  message wherever it is shown.
- Toolbar items of an app are buttons, menus of `ToolbarAction`s, boxes, color menus, buttons
  opening the app's dialog and the app's own controls. An app's dialog does not close when the
  document or the selection changes (the built-in ones do), and the toolbar takes
  ArrowLeft, ArrowRight, Home and End from an app's control unless the control stops them. An app item's state without `enabled` is
  a dry run of its command after every transaction, which costs what the command costs (a box
  or a color menu is not dry-run: it is enabled unless its `enabled` says no).
  `useCommand(command)` with a command made anew on each render dry-runs it on each render.
- Keys ([keyboard.md](keyboard.md)): `editor.handleKey` runs the plugins' keymaps only, not the
  view's own keys (they need the pages). A keymap cannot take a reserved key, nor the browser's
  editing commands that arrive without a key name (word and line deletion, the browser's undo
  and bold from its menus): those come through `beforeinput`. Plugin commands are typed only
  through `FoliCommands`: one an app does not declare there is reachable but untyped. Ctrl+Alt
  typing a character other than a–z or 0–9 is taken for AltGr (not every browser reports AltGr),
  so on a non-Latin layout Ctrl+Alt+F and Ctrl+Alt+D do not insert notes.

## Tables

- Autofit tables (Word's default) keep the column widths Word saved while their content fits or
  wraps, and widen a column for what cannot break (a long word, a picture), taking from the
  others, then growing past the saved width when they cannot give more; this is the browsers' automatic table layout, close to Word's but not its algorithm
  (preferred widths in percent or `auto`, and the room left on the page, are not weighed as Word
  does). Border conflicts are resolved by the browser's `border-collapse`, close to Word's rules.
- A row splits across pages between its lines; a row in a vertical merge, or holding a nested
  table, moves whole to the next page.
- Rows pasted into a table fill its cells from the selected one; columns beyond the table's are
  dropped (not reported). Tables pasted from other applications become paragraphs.
- A column's width is set by dragging its border with a mouse (not by touch) or from the keyboard (Table, Column width…: the
  selection's last column, the next one giving the difference and keeping 0.1 inch, so the
  dialog's range depends on it; a merged cell sets only its last column); a nested table's column
  borders cannot be dragged. Nested tables are drawn whole with their parent's row.
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
- While tracking, text in cells is tracked as everywhere; of the table's structure rows are
  (inserted and deleted as Word records them), and so are header rows, table styles and cell
  shading (as Word's `w:trPrChange`, `w:tblPrChange`, `w:tcPrChange`, 23.2). Column commands,
  merging and splitting cells and column widths are refused: Word records them as cells
  inserted and deleted (`w:cellIns`, `w:cellDel`), a grid change (`w:tblGridChange`) and cell
  formatting together, which Foli does not model. A recorded change Word wrote is read, shown in
  the list of changes and accepted or rejected; rejecting one that restores a cell's span or
  vertical merge can leave the row's cells not matching the grid. Its previous properties are
  the ones Foli models: on rejecting, what it does not model stays as it is now. A table style's own definition cannot be changed (a changed one is refused on
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
- A picture's rotation and crop (schema 6, 19.5) are read from `.docx`, shown and written back;
  a rotated picture keeps its unrotated room in the line (Word gives it the rotated box's), and
  so does a float's wrapping. A document saved as JSON by 1.0 to 1.3 kept a file's crop and
  rotation only in the drawing's XML: they are written back to `.docx` as they were, but not
  shown until the file is imported again. They are set in the picture dialog (Rotation, the two
  90° buttons, Crop in percent; core's `setPictureRotation` and `setPictureCrop`, which keeps the
  image's scale as Word does; each change is its own undo step), not by dragging on the page (no
  crop handles); a crop or rotation only in the drawing's XML (see above) cannot be changed there
  until the file is imported again; cropping a floating picture's left or top keeps its anchor
  offset, so what shows moves. A picture is resized by its handle with a mouse, a pen or a finger
  (19.5c; touch tested with synthetic pointer events, not on a device; on a touch screen the
  handle is 24 px and reaches past the picture, so a tap just beside a selected picture's corner
  can land on it);
  resizing is refused while tracking (Foli does not record a size change yet). Alt text changes
  are not tracked.
- A picture copied into another document brings its image (12.11): its own `data:` or web URL,
  else the image the source view shows, as a `data:` URL; one shown from an object URL (a
  `.docx` package's JPEG or PNG) is read from the drawn image and comes as PNG, the same pixels
  in another encoding. One whose image lives only in the source (a package part the source view
  does not show, or an object URL not drawn yet) comes without its image: a box with its alt
  text, as Word shows a missing image, which `.docx` export refuses until an image is given; a
  paste never takes another package's part name or a page's object URL. Copying in WebKit is not
  automated (as every clipboard test). Word's
  picture-and-text paste brings the text only. The clipboard writes a floating picture inline.
- `renderDocument` measures blocks on one long page: the lines after a floating picture may
  wrap a little differently than on the editing view's pages.
- Word's line numbers count the lines beside a floating picture differently from its own
  layout: `pnpm corpus:pages` reports fewer paragraphs on Word's line there (04: 25 of 35, 33
  in 0.3.0 before the chart was laid out; 101 of 115 for the corpus). Accepted as a known
  limit (2026-11-17).

## Finding and going places

- Find reads the body and the stories, table cells included; comments apart (`findInComments`, a
  list in the find panel): not text boxes or other content kept opaque (text boxes are not drawn). A match stays inside a paragraph; `^p`-style codes, wildcards and regular
  expressions are not offered (a pattern could hang the page), nor replacing formatting. Find
  looks through soft hyphens and zero-width spaces (`cooperate` finds `co-operate` broken by a
  soft hyphen), so a zero-width space does not end a word for "whole word" either, which matters
  in Thai text that separates words with it (Phase 21).
- Replacing keeps bookmarks and comment anchors found inside the match, where Word loses them; text
  already deleted as a tracked change is refused and reported, where Word adds the replacement
  after it. In the review views that hide deleted text a match runs across it, as the reader sees
  the text; Word's does not.
- While the document is edited with the panel open, the matches are looked for again once typing
  pauses (300 ms): until then only the current match is marked, moved with the text, and none is
  current once an edit touches it or its story.
- Marks need the CSS Custom Highlight API (Chromium 105, Safari 17.2, Firefox 140); without it find
  still counts, goes to and selects matches. Only pages within a screen of the window are marked.
  In the drawn copies of a story that is not open, marks come from looking for the text there.
  A hint (`view.hint`) needs the same API to show: without it, it still scrolls. Its fading is
  one lighter colour for 0.4 s, not a smooth fade. In a header, footer or note that is not open
  it marks the drawn copies by their text, so a page number drawn in the same paragraph with
  another length than the story's own shifts what follows it; a change to that story ends the
  hint. A point shows its whole paragraph. In a story, field codes shown and content Foli keeps
  verbatim with text in it are drawn but not counted: a mark after them in the same paragraph
  is off by them. (Merged cells and the final and simple review views are counted as drawn.)
- A match in a header no page shows (an unused first-page or even-page variant) is found and
  replaced but cannot be gone to. A read-only view does not open stories.
- Go to takes a page's place in the document, not the number printed on it. Renaming a bookmark
  does not reach a reference whose name is split over two `w:instrText` runs. The cross-reference
  dialog offers the body's bookmarks.
- Ctrl+H, Ctrl+G, F3 and Ctrl+Shift+F5 are browser keys too: they are taken only while the focus
  is in the document or in the panels, and only where `FoliNavigation` is mounted.

## Tracked changes and comments

- While tracking, an edit that would delete or insert content Foli keeps verbatim (an opaque
  block) is not made; tables are tracked row by row, and so are their style, header rows and cells' shading (23.2). Moves are kept and shown from imported files but not
  recorded: moving text records a deletion and an insertion.
- Your own inserted paragraph, deleted whole while tracking, goes without a trace, at the end of
  the document or of a cell too, except as the last after a table (a table cannot end the
  document or a cell) or when it holds someone else's text: it stays then, and accepting keeps
  an empty paragraph the same edits made untracked would not have.
- Accepting removes a paragraph whose text and mark are both deleted whole, as Word does; the
  same edits made untracked, one after another, may have kept its properties on the joined
  paragraph. Enter in a paragraph next to a deleted paragraph mark splits that paragraph as it
  is, not the paragraph accepting would make. A paragraph whose mark was deleted while it was
  empty and that was typed into afterwards keeps its own properties when accepting joins it to
  the next; the same edits untracked joined an empty paragraph and kept the next one's (found
  by the tracked-changes property test in 12.11).
- In the simple and no-markup views, a paragraph whose mark is deleted is not shown joined with
  the next while editing (`renderDocument` joins it).
- Changes' and comments' dates are written in UTC; Word writes local time there, so Word shows
  Foli's times shifted by the time zone.
- Comments: the pane (`FoliComments`) is React only (the view marks commented text); a comment
  with formatting other than its paragraph style is not editable there, only replied to,
  resolved or deleted. A comment anchored inside content Foli keeps verbatim (an opaque block)
  stays: its anchors there cannot be removed.
- Mentions (27.3): Foli sends nothing; `onMention` fires only for saves in the pane, so a server
  that must tell people about comments from agents or collab peers reads them with
  `commentMentions`. Word's people part (`people.xml`) is not written, so Word shows a mention
  as a mailto link rather than its contact card. The resolved list is in document order (no
  date of resolving is kept); deleted comments are not kept anywhere. Two people of one name in
  one comment are told apart by name only: every `@Name` links the latest picked. A Word mention
  with other formatting than its link is not editable in the pane (replied to, resolved, deleted).
- Comment-only mode (`commentOnly`, 1.10) is enforced in the client by a transaction filter: an
  app that lets untrusted users save checks their changes on its server (`onlyCommentSteps`).
  Comments stay body-only, so a commenter cannot comment in headers, footers or notes. Without
  `author`, the check lets any comment change through (the pane only hides Edit and Delete on
  others'); `FoliEditor` passes its `author`. A commenter cannot delete someone else's reply in
  their thread on its own (only with the thread). Inserted anchors may carry formatting marks
  and kept attributes (an imported comment's, back on undo), never a tracked change.
- Revisions carry no initials (Word has none); comments do.
- Since 1.6, undo takes back a style, list definition, resource or control's properties added with
  an edit, with the edit (before, they stayed; not checked against what Word does). The tracking switch is the
  document's (`settings.trackRevisions`, schema 7): a document with it set, or an imported
  `.docx` that tracks changes, cannot be read by 1.5 or earlier.

## Collaboration

Real-time editing (Phase 22, 1.6; Phase 24; ADR-0012; [the guide](guides/collaboration.md)):

- A central authority over steps, not a CRDT: one process orders each document's steps. No
  peer-to-peer and no long offline editing: a client that was away sends its steps when it comes
  back, rebased over what it missed (or starts again from a snapshot once the authority's log was
  compacted past its version, losing its unsent steps then).
- Foli ships no transport, no store and no server: the app moves the JSON messages, stores the
  snapshot (and the original package beside it), authenticates, and decides who may edit
  (`authorize`). `createHub` and `connect` speak the protocol over any transport; the app still
  carries the text, and rate-limits `catchup` when clients may be hostile (each answers with steps
  or a whole snapshot).
- A host in a browser holds the authority: when the host leaves, the session ends. Moving the
  authority to another browser (which needs the document as last confirmed, without the leaving
  host's pending steps) is not done.
- `connect` notices a lost broadcast when the next one arrives (a gap) and catches up; a lost
  last message is found only by `resume` after a reconnect, or by the next broadcast. A transport
  that drops messages without reconnecting should call `resume` itself from time to time.
- The authority validates a step by applying it (the schema, envelope and story steps that no
  longer find what they change); it does not run the locked content controls' rules again, which
  depend on the command that made the edit: an app whose clients may be hostile checks locks in
  `authorize`.
- Two people changing one property of one style at once: the last confirmed wins; other envelope
  entries (other styles, other properties) merge.
- Ids of new changes, comments, notes and controls are kept apart by the client id's class
  (`id ≡ clientID mod 256`); two live clients in one class can still take the same id. Give the
  live clients of a document distinct small integers.
- Presence is drawn in the body only, not in an open header, footer or note; a presence message
  sent from an older version than the receiver's is dropped (the next one comes), and the hub drops
  one over 4000 characters.
- Speed: remote steps cost every client a transaction and a redraw each; three others typing
  without pause roughly double to quintuple keystroke-to-paint p95 on a 50-page document
  ([benchmarks](benchmarks.md#typing-while-others-edit-2212)).
- **Convergence is tested, not proven.** The property test (2–5 clients, 10–40 random edits a run,
  1000 runs) passes, and so does 24.2's run over an unreliable channel (2–4 clients, 30–60 edits,
  broadcasts reordered, repeated and lost) across 50 seeds of 300 runs, with catch-ups that end
  inside another client's batch too. The one divergence these runs found (a client left with a
  bold mark the others did not have, about one run in 4000) is fixed: taking back a mark step over
  text partly marked already read the marks outside the step. Its shrunk case stays in
  `collab.property.test.ts`. Passing runs are not a proof: a client that does end apart stays so
  until it loads the authority's snapshot again (a reload).
- The agent library and the MCP server do not edit a shared document.
- Not tried by hand: a document edited together and exported opened in Word (the e2e reads it
  back with `@folijs/docx`).

## Agent editing (`@folijs/agent`)

Unstable (0.x). Details in the [package README](../packages/agent/README.md).

- The body is read and edited, and with `read({ headers: true })` the headers and footers
  (23.7): their blocks have handles `h1`…, `f1`…, each story under a line saying which sections
  use it (a section without its own goes on with the one before's), and the operations take them
  but `comment` (Word keeps no comments there), breaks and notes; their content controls are not
  listed or filled. The text of footnotes and endnotes is not
  read; `insertItem` writes a new note's. A header's or footer's label counts its first-page
  part only for sections with a title page, and its even-page part only with the document's
  even-and-odd setting; the others are "not shown". No breaks or notes go in a header or
  footer. `updateFields`
  updates the fields in every story, as tracked changes it does not report there.
- Tables (23.3): a table is inserted next to a paragraph (next to a table, the paragraph after
  or before it is used; with none, it is refused), rows inserted and deleted, cells' text set,
  table styles, shading and header rows set. Columns, merging and splitting cells and column
  widths are refused: they cannot be recorded as tracked changes, and every edit of a session is
  one. A table put after an empty paragraph goes before it.
- Text formatting (23.4): bold, italic, underline, strike, font, size, color, highlight and
  links, on a paragraph or text in it; not superscript or subscript (core has no command for them
  yet). `read({ formatting: true })` shows a run's own formatting,
  not what its style gives; underline is on or off (Word's other underline styles are kept, not
  set); highlight is one of Word's named colors.
- Paragraph formatting (23.5): alignment, line spacing as a multiple, space before and after,
  indentation by half-inch steps (a list level in a list) and bullet or numbered lists of
  Word's default kinds. Exact line spacing, right and first-line indents, borders, tabs and
  other list formats are not offered. A paragraph's own properties are what
  `read({ formatting: true })` shows, not its style's (exact line spacing and right indents are
  not shown). Numbering paragraphs already in two numbered lists leaves two lists; table cells
  are apart, each its own list. A paragraph in a locked content control is refused, and so is
  the call. Left and right are Word's `left` and `right` (not checked in right-to-left text).
- Inserting (23.6): a picture or a horizontal line goes in a paragraph of its own; a page or
  section break at a paragraph's end or start (a section break in the body only, and the
  paragraph splits there as in Word); a footnote or endnote at a paragraph's end or after text in
  it. A picture is inline, its size read from PNG, JPEG and GIF headers (else given), shown at
  96 dpi and fitted to the text width; alt text is required. A picture or line paragraph has no
  properties of its neighbour's. A section break after a paragraph splits it: its text, ending
  the section, gets a new handle, and the old handle names the empty paragraph after the break.
  The MCP server reads a picture from a .png, .jpg or .gif under its root, at most 16 MB, and
  counts its bytes in the session's weight; an app gives bytes. EXIF rotation is not applied to
  the size. No floating pictures, captions or picture from a URL.
- Review (23.8) only in a session opened with `review: true` (the MCP server's `--review`): the
  body's changes are listed (300 at a time) and accepted or rejected by id; "all" reaches every
  story. A header's, footer's or note's changes are counted, not listed one by one. An answer
  names the changes that a locked content control kept, in whole or in part. Accepting or rejecting a change in a
  locked content control follows Word's rule (what leaves the text as it shows goes through). `session.editor` is the
  headless editor for those, by positions.
- A paragraph whose mark is deleted as a tracked change but that keeps text is read as its own
  block; Word's final view shows it joined with the next paragraph.
- Text is matched with its capitals and spaces as read; what stands in brackets in a read
  (`[picture]`, `[note]`, `[page break]`, `[empty: …]`) cannot be part of a match, and text is
  not matched across it.
- A new paragraph has no formatting of its own beyond what the paragraph next to it has or the
  style named gives: no bold or links from its text.
- Comments are not tracked changes: rejecting the agent's changes leaves its comments.
- Rejecting the agent's changes gives the document back, with these differences (13.6): a
  content control emptied again shows its placeholder without the run properties Foli kept
  verbatim for it (`w:lang`…), and a date control keeps the date it was given in its
  properties; the entries of a table of contents built again come back with their text and
  style but without what Foli kept of them verbatim (`w14:paraId`, their tab stops).
- `replaceText` with `all` makes one change and one undo step per place; a paragraph inserted
  in a built-in style the document lacks is two changes (the paragraph, then its style).
- One insert takes 500 paragraphs at most and one `replaceText` with `all` 500 places; one
  replace, fill or `updateFields` writes 300,000 characters at most, its places together.
  Comments and notes have no total of their own per document: each call is bounded, many
  calls are not.
- A document may grow 16 million characters, as it would be saved, past what it was when
  opened (`MAX_GROWTH`): a call or a run past that is taken back, and the message says to save,
  close and open the saved file to go on. What it weighs when opened is held only by the
  reader's limits (64 MB unpacked): a document whose fields hold long instructions can need
  several hundred MB to open and to save (a 385 KB file holding 62 MB of field
  instructions: 700 MB open, 1.34 GB for a save; measured on Windows, Node 25).
- `updateFields` returns no blocks, and leaves page numbers as they are: they need a page
  layout the session does not have. It leaves a table of contents as it is unless
  `contents: true`; one built that way has its entries' page numbers empty until Word updates
  the field (F9).
- Core's rules let a paragraph be inserted into a locked block content control; the session
  refuses it itself, the editor under it (`session.editor`) does not.
- A style the session adds to the document stays when its changes are rejected: a built-in
  heading it used, and the styles a rebuilt table of contents or a control's placeholder needs
  (undo takes it back since 1.6; rejecting a tracked change does not).
- A handle lost (its block removed, or joined into the next) does not come back with undo.
- Every operation reads the whole body again; not measured on long documents.

## The MCP server (`@folijs/mcp`)

Unstable (0.x). Details in the [package README](../packages/mcp/README.md) and
[ADR-0009](decisions/ADR-0009-mcp-server.md).

- Everything under "Agent editing" above: the tools are that library's operations.
- Not tried with a model calling the tools in a real client; Claude Code connects to it, and
  the official SDK's client drives every tool in the tests.
- Stdio only: no network transport, no authentication, one client a process. Of the protocol
  it speaks tools; no resources, prompts, progress or cancellation. A JSON-RPC batch is
  refused, though the `2025-03-26` version of the protocol has them.
- One message at a time: while a tool runs (an `open` of a large file takes seconds) nothing
  else is answered, a `ping` included.
- Code mode (`run`, with `--code`): not tried with a model in a client of its own. A script is
  plain JavaScript as QuickJS runs it: no `await` that waits for anything, no timers, no
  imports, no `Intl`. 10 seconds, 64 MB, 5,000 calls to the document, 2,000 paragraphs inserted and a million characters given a run, not
  configurable. It works on one open document, and cannot open or save. A run costs about
  55 ms before the script starts, not counted in its 10 seconds. Its answer shows 40 changed blocks at most. `doc` has the
  tools' operations and no more: no reading in parts (`blocks()` is the whole body), nothing
  of the editor under it.
- Documents live in memory: unsaved edits are lost when the server stops, and nothing is saved
  on its own. A file is open once.
- Only `.docx` (and, for `insert`, pictures: `.png`, `.jpg`, `.jpeg`, `.gif` up to 16 MB), up to
  64 MB and 64 MB unpacked; the open documents hold about 3 million
  characters of body together, so a very long document may be refused, or leave no room for
  another. An answer over 200,000 characters is cut: read less at a time.
- A save beside the original takes the first free name up to `.agent-100.docx`; when all are
  taken it refuses, and a path must be given.
- File links (symlinks) could not be made on the Windows machine it was built on: the tests
  of those rules ran once on Linux (`pnpm check` on `ubuntu-latest`, 2026-11-21) and run in
  every Release workflow. Not tested on macOS.

## .docx (`@folijs/docx`)

Details in the [package README](../packages/docx/README.md).

- Checked over 3 445 external test files ([corpus-report.md](corpus-report.md)): 3 259 import,
  export and read back, 3 204 of them with no difference counted, none crashes. Most of what
  still differs changes the file, not what it shows: an empty `w:hyperlink` dropped, field lock
  and dirty flags normalized, `w:tblPr`/`w:tblGrid` written for a table without them, a
  paragraph added to an empty body, a break's default type left out. Besides: 8 files with two
  `w:pPr` in a paragraph get one, merged as Word merges them; one POI file has its `w:ins` and
  `w:moveFrom` nested the other way round. In Word, of a sample of 150, the 143 Word measured
  measure the same in the export but one: a literal soft hyphen (U+00AD) or non-breaking hyphen
  (U+2011) in `w:t` comes back as `w:softHyphen` / `w:noBreakHyphen`.
- Strict Open XML documents are read and written back Strict (Phase 28, ADR-0014: translated to
  Transitional names and values as they are read, and back as they are written). A Strict
  document saved as JSON and exported without its package comes out Transitional. A part whose
  root is `mc:AlternateContent` is read as Word reads it (Phase 28.4: the branch it understands,
  the documents in it joined); Word's own recovery from other roots (`w:madeUp`, a bare `w:p`
  and the like, 38 docx4j tests) is not imitated: refused, the message naming the root. One
  docx4j test Word cannot open (`rq-31`, a text box's content as the branch) is read, its text
  kept.
- Encrypted zip entries, ZIP64 and compression methods other than stored and deflate are
  refused. A package whose zip entries name one part twice
  (`word/document.xml` and `word/%64ocument.xml`) is refused; a name that is no valid part name
  (a leading `/`, a backslash, a `..` segment) is kept as a part of its own, as Word's own reading
  of such names was not checked (Phase 21).
- A package may hold at most 10 000 entries, 512 MiB uncompressed and 4 000 000 XML nodes in the
  parts read, a paragraph counting four (`maxEntries`, `maxSize`, `maxNodes`; lower them on a
  server). A 659-page document of dense tables counts 1.9 million and takes about 0.8 GB to
  import; at the limit a crafted file can still take about 2.3 GB and 12-28 s depending on heap headroom
  ([security.md](security.md)).
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
- Custom nodes and marks are content controls tagged with their type and attributes: a tag holds
  at most 255 characters, so larger attributes are refused at export (`DocxError`), never cut.
  A tagged control is read back as its node or mark only when nothing would be lost: a node's
  control holding anything but text runs formatted alike (a bookmark, a field, a comment anchor),
  a block node's paragraph with properties, a section, a tracked change, formatting or another
  control around it, an empty mark control, or one Word split in two stays an ordinary content
  control, its tag kept.
- A foreign node (its extension not loaded) shows its control's text in the next `.docx` only
  while the document stays in memory: saved as JSON and loaded again it writes `[type]`. Keeping
  the text in the JSON would change the saved format (a key `parseDocument` refuses today, or an
  attribute the extension's own validation would refuse), which ADR-0008 rules out for custom
  types.

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
  pages, but 1.0 misses Phase 5's speed targets at 100 pages ([benchmarks.md](benchmarks.md#10-numbers),
  the owner's laptop on mains; accepted by the owner for 1.0, the incremental redraw left for a
  1.x minor): 104 pages lay out in about 118 ms in Chromium, 146 ms in Firefox and 194 ms in
  WebKit (target 60 ms); a full re-flow takes 148-164 ms in Chromium and Firefox (target 100);
  Enter's paint p95 is 35-49 ms (target 25). Handling a keystroke cost 11-13 ms in 0.6.0 (p50,
  Chromium), 3.3-3.5 times what 0.2.0 took; 1.0 takes 7.9 ms typing (at the 8 ms target) and
  9.9 ms for Enter (Firefox 11 and 14 ms), after 12.11's fix to list numbers: typing meets the
  targets in Chromium (paint p95 14 ms), not in Firefox (28 ms). The first layout
  is mostly the browser's own layout of every page.
- Long documents made of lists were slower in 0.2.0 (schema v2, where lists were nested
  blocks; not measured on schema v3 yet): in a 114-page list document, Enter near the top took
  about 9-24 ms to handle (p50) and up to ~65 ms to paint (p95), and the first layout ~85-95 ms,
  about twice a paragraph document (two runs, [benchmarks.md](benchmarks.md)). An edit there
  moved the last item of every later page to the next one; every render also walks every
  block.
- Formatting thousands of paragraphs at once is slow: bold over 4,000 paragraphs takes about
  0.6 s, the next edit about 0.7 s, its undo about 0.5 s.
- Undo history keeps the last 100 undo steps (a run of typing is one step).
- Page numbers made of digits are taken to be equally wide when a header's height is measured:
  with a font whose digits differ, a header on the verge of wrapping can overlap the text.

## Print and PDF

- One `@page` size per web page: with several editors of different page sizes, the last one's
  sheet size wins.
- Sections with different page setups print on sheets of their own size through named pages;
  engines without named pages print every sheet at the last section's size.
- Print-only CSS must not change text metrics. PDF output is checked in Chromium only.
- Your page's other content prints too; hide it ([styling.md](styling.md#print)).
- `exportPdf` (`@folijs/pdf`) is Chromium's PDF: it needs the app's headless Chromium page
  (Playwright 1.42+ for the outline and tags; Puppeteer's page type fits but is not run in the
  tests) and the document's fonts on that machine or in `styles` as `data:` URLs: a missing font
  prints in a fallback with other line breaks. It replaces the page's content.
- The page `exportPdf` prints in loads nothing from the network (its Content Security Policy
  allows `data:` images and fonts only), so a document cannot make the exporting server request
  an address: a picture known only by a web URL prints as its box, a web font in `styles` is not
  loaded. Give images as bytes and fonts as `data:` URLs. An image not decoded after 10 seconds
  prints without it.
- `exportPdf` lays the document out with the read-only renderer, the editor's `print()` with the
  editing one: the same pages (count, sizes, text), drawn alike but where the two differ. A
  table's header rows repeated on a continuation page are plain text in the editor's print and
  formatted in the PDF; the editor draws change bars beside tracked changes, the PDF does not;
  where a paragraph continues in a column of another width, the PDF can repeat or lose a few
  words there (08 in the corpus repeats two).
- A field's page in `exportPdf` is the page its paragraph (or table) starts on: a `PAGEREF` to a
  bookmark in a paragraph carried over to the next page gives the first page.
- Links: absolute links with a safe target (`https:`, `http:`, `mailto:`, `tel:`) and links to a
  bookmark of the document are PDF links; other targets (relative, `file:`) print as text. Headings (paragraphs with an outline
  level 1-6) are the PDF's bookmarks; a table of contents' dot leaders are not drawn (on screen
  neither).
- Pictures in EMF, WMF or TIFF print as their box. Comments are not printed: with markup their
  text is highlighted, without Word's balloons.

## React and the browser

- Server rendering gives the editor's shell, not its content: the document appears on
  hydration, so it is not indexed from the server HTML.
- `FoliEditor` is uncontrolled: `initialContent` is read once. Load another document with
  `editor.setDocument()` or a new `key`; there is no `value` prop.
- `editor.setDocument()` during an IME composition is not handled: load documents from a click
  or a file picker (which end the composition), not from a timer.
- A Content Security Policy without `'unsafe-inline'` styles hides the placeholder and breaks
  print sheets ([styling.md](styling.md#content-security-policy)).
- An editor inside a shadow root works in Chromium and Firefox but not in WebKit (Safari): WebKit
  gives a shadow root no selection of its own and the document's stops at the shadow host, so
  the caret is not read (typing goes to the start). A same-origin iframe works in all three
  (checked in Phase 21, `e2e/realms.spec.ts`; waiting for the owner's acceptance as a limit).
  In a shadow root, `@folijs/react`'s toolbar and navigation pane do not give the focus back
  where they took it from (they read the document's `activeElement`, the shadow host there).

## Word's look and everyday commands (Phase 29)

- Change Case writes the new text as a deletion and an insertion while tracking (as Word does);
  text of tracked deletions is left as it is. Title and sentence case look at each paragraph on
  its own.
- Ctrl+= and Ctrl+Shift+= (subscript, superscript) are taken from the browser's zoom while the
  document has the focus: Ctrl+minus still zooms the browser out. On a layout without = or the
  period and comma where a US keyboard has them, the keys are those places, not the characters.
- `wordKeymap()` is opt-in: without it Shift+F3 is find's previous result, Ctrl+Shift+8 the
  bulleted list and Ctrl+Shift+V the plain-text paste.
- The format painter is per story: formatting copied in the body is not painted in a header,
  footer or note, and the reverse. A click paints the word under it (no paragraph formatting);
  paragraph properties go to paragraphs a selection covers whole.
- Formatting marks are drawn over the text in a layer of their own (fixed, clipped to the
  editor): when the whole window scrolls, they can paint over an app's sticky toolbar that has no
  `z-index` of its own. Page and column breaks show as labels, not Word's dotted line. Their
  color token is read from `:root` only: in a shadow root the marks keep the default color.
- Zoom is CSS `zoom`: a picture's resize handles and a header or footer edited at a zoom other
  than 100% are not checked by hand yet. A device sending page-mode wheel deltas barely zooms.
- The status bar has no document language (Foli does not keep `w:lang`) and no line count;
  `countWords` counts no text boxes (they are opaque). A large selection is counted again at
  each move.
- The right-click menu's Paste goes through the Clipboard API, which the browser may refuse or ask about first; a browser
  that ignores a synthetic paste event's data pastes nothing (not seen; not checked in WebKit).
  Shift+right-click keeps the browser's menu (its spelling suggestions); the page cannot tell
  where the browser saw a misspelling. In read-only and comment-only documents an app's own
  entries are hidden with the editing ones.
- The mini toolbar is for the pointer, as Word's: the keyboard does not reach it (the ribbon
  has the same commands). It shows after a drag that ends in the editor's body, not outside it.
- The Styles gallery draws Word's built-in headings the document does not have yet in the
  default look until one is used. Word's Quick Styles and their order come from `w:qFormat` and
  `w:uiPriority` as the file has them.
- The ribbon's icons are Lucide's, not Word's.

## Word's dialogs (Phase 30)

- The Font, Paragraph and Tabs dialogs are the toolbar's: `openDialog`, Ctrl+D and the right-click
  menu's Font… and Paragraph… open nothing without a toolbar on the editor (the entries still
  show), nor on a comment-only toolbar.
- Paragraphs with different special indents (first line on one, hanging on another, or the same
  kind by different amounts) show Special blank: pick First line or Hanging to set By for all.
- The Font dialog has no Scale box (the model has no `w:w`), no Position (raised or lowered by
  points, `w:position`), no kerning and no OpenType features; Font color and Underline color
  list Automatic, the theme's colors and Word's standard ones (no shades, no custom picker:
  the toolbar's color menu has those). With no text selected (empty paragraphs only), the
  dialog shows the paragraph's formatting but OK changes nothing: Word would format the
  paragraph marks, which Foli keeps (`markFormat`) but does not set from the dialog.
- The Layout tab's Margins menu has no Mirrored preset (Foli does not keep `w:mirrorMargins` in
  the model) and no Last Custom Setting; Orientation swaps the page's sides but leaves the
  margins as they are (Word turns them with the page); Size checks an entry within a millimetre of its paper. Breaks has Remove
  section break, which Word's has not, for the Section menu it replaces in the ribbon.
- The default unit comes from `navigator.language`, not from the operating system's
  measurement setting (a browser does not expose it). Rendered on the server, the Layout tab's
  Indent boxes show centimetres until the page runs in the browser.
- Tab stops set in the Tabs dialog are kept and saved, but the pages lay text out with the
  default stops every half inch (custom stops are not drawn yet, see architecture.md). The
  dialog has no Default tab stops box: Foli keeps `w:defaultTabStop` in the settings part as the
  file has it. Paragraphs with different stops show none in the list (Set and Clear All still
  work on each).
- The Paragraph dialog has no Mirror indents, no automatic space before or after (Auto), no
  Don't hyphenate or the Asian Typography tab.

## The ruler (Phase 31)

- Right-to-left paragraphs are measured and dragged as left-to-right ones.
- In `FoliEditor`, a page wider than the window (a large zoom) scrolls the document sideways and
  the horizontal ruler with it: its handles are under the pointer where the ruler shows, not
  past the window's edge (an app can scroll the pages in a box of their own, as the
  playground's `?ruler` does).
- A table's columns show on the ruler for a top-level table of the body only (not a nested one,
  nor one in a header, footer or note), and only its grid's borders, not a row's own cell
  edges, and none while cells are selected; while changes are tracked the borders are disabled
  (as in the table). In an autofit table drawn wider or narrower than its grid, a border dragged
  (on the ruler or in the table) sets the width the grid then gives, so the next border may move.
  A table as wide as the text puts its last border over the right margin's edge: take the margin
  above or below it.
  A cell's right indent marker sits over the lower half of the border's marker: take the
  border by its top.
- Tab stops added, moved or removed on the ruler are the document's (saved, in the Tabs dialog),
  but the pages still lay text out at the default stops (Phase 30's limit, "Word's dialogs").
  The tab selector has Word's five stop kinds, not its first-line and hanging indent entries,
  and no default stops are drawn.
- With several paragraphs selected, a stop moved on the ruler is cleared where it was and set
  in every selected paragraph (as the Tabs dialog does). A Word start, end or list (`num`) stop
  is shown as left or right, and moving one writes it back as that kind. A stop a table style
  gives a cell's paragraphs is shown, but moving or removing it leaves the style's in place
  (`setTabStops` reads the paragraph without its table style). Arrows step a stop over another
  rather than onto it; a drag onto one replaces it, as Word's.
- A paragraph with a left or right border draws its text at the border's spacing, not at its
  indent (the border's padding replaces the indent's, `styleParagraph`): its ruler markers show
  the indent the document has, not where the text is drawn.
- In a section with several columns the ruler shows the page's margins and the caret's column as
  the box its indents are measured from; columns are not shown or dragged.
- A header, footer or note open: the margins dragged are those of the body caret's section.
- The vertical ruler shows the top and bottom margins as the section sets them, also where a
  header or footer taller than its margin pushes the text; header and footer distances are not
  on it. It follows the caret's page: with that page scrolled out of view, its marks are too.
  Its Up and Down move a margin the way they point, so Up makes the top margin smaller (a
  slider's Up makes its value larger).
- A margin's edge is taken between the indent markers (Word's layout), a few pixels: hard by
  touch. While the left box or the hanging marker is dragged the other markers stay until the
  release. A drag a section's fixed column widths no longer fit is refused (the margin stays).
- The ruler reads the pages again in the next animation frame: in a hidden browser tab it waits
  until the tab shows.

## Page decoration (Phase 32)

- The page color is drawn as its color: Fill Effects (a gradient, texture, pattern or picture
  behind the page) are kept in the file while the color stays, not drawn; a new color replaces
  them, as Word's Page Color does. A theme color is drawn as the RGB value Word wrote beside it.
  The page color is printed and in `exportPdf` (Word prints it only with "Print background
  colors and images" on).
- Page borders are drawn as lines: an art border (apples, stars…) as a solid line of its width,
  a double, triple or thick-thin border as CSS draws `double` (one line when thin), a wave or 3-D
  border as a solid line. A border's shadow (`w:shadow`) and frame are kept in the file, not
  drawn; changing the borders writes them anew without them. Borders measured from the text
  are placed from the section's margins, not around a header or footer (Word's "Surround
  header" and "Surround footer" settings are kept, not applied).
- Page Color sets the RGB value of the color picked, also for a theme color (Word writes the
  theme color and its tint as well): changing the theme does not change it.
- The Page Borders dialog has None, Box and Custom (not Word's Shadow and 3-D), no art borders
  and no preview; its sides are check boxes and one distance applies to every side.
- Watermarks are Word's VML ones (`PowerPlusWaterMarkObject…`, `WordPictureWatermark…`): a
  DrawingML shape or picture named as a watermark stays opaque, and one positioned other than
  centered on the margins is drawn centered. A text watermark's letters are drawn stretched over
  its box with SVG (`textLength`), close to Word's WordArt but not its exact glyph shapes; a
  picture's washout is a CSS filter. Watermark sizes Foli makes follow Word's proportions for
  Calibri capitals; another font is drawn in the same box. The gallery has Word's diagonal
  presets (Custom watermark… has Horizontal). A picture watermark needs the toolbar's `upload`;
  with no new file picked the dialog keeps the picture, its washout changed, and its Scale
  applies to a new picture only.
- Paragraph borders are drawn on each paragraph alone: Word joins the boxes of neighbouring
  paragraphs with the same borders (one box, the border between them drawn only when set), and
  draws the border between paragraphs; Foli draws each box, and no border between. Shading is
  drawn as its fill color: a pattern (10%, stripes…) and its color are kept and written, not
  drawn. The Borders and Shading dialog has no preview, no Shadow or 3-D setting, and no Page
  Border tab (Design ▸ Page Borders has it); Shading in Home's menu sets a clear fill.
- Line numbers are drawn from the text's line boxes as laid out (a floating picture's box left
  out), each beside its own column: a line of a picture alone may count differently from Word,
  and lines in tables, headers, footers, notes and text boxes are not numbered (as in Word). The
  numbers use the page's font, at most 11 pt, at the bottom of their line (not on its
  baseline), not Word's Line Number style; "From text" Auto is a quarter inch. They are not
  dimmed while a header or footer is open. An `lnNumType` without `w:restart` is continuous, as
  Word 16 writes and reads it (ECMA-376 says each page). An `lnNumType` without `countBy` numbers no line in Word
  and stays in the section's verbatim XML. The Line Numbers menu sets the caret's section (Word
  applies it to the selected sections).
- In the Borders and Shading dialog, None or a side turned off removes the paragraph's own
  borders only: a border its style draws stays (Home ▸ Borders' menu turns one off with a
  `nil` border, as Word does).
- On a dark page color, text in Automatic color stays black (Word draws it white).
- A file whose `w:background` Word hides (no `w:displayBackgroundShape` in its settings) shows
  the color in Foli; its settings stay as they are unless the color is changed.

- The docs site's search matches headings and API names, not body text. The API pages show
  each declaration's `.d.ts` text; code is not highlighted.
- The guides' TypeScript samples are compiled and mostly run by `pnpm test`; their CSS samples
  are not checked, beyond the variable names existing.
- Benchmarks run by hand on the owner's machine against its baseline (`pnpm bench`), not in a
  hosted CI; the browser ones run on the dev server.
