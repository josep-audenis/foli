# Known limitations

What Foli does not do yet, or does with caveats, as of 1.0.0. Read it before you ship. The
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
  opaque.
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
  its code. A field's own `w:dirty` is kept after an update.
- Notes: a note's lines take no widow or orphan control and `w:continuationNotice` is not drawn. A
  reference kept verbatim in opaque content takes no number. Footnotes set beneath the text in a
  section with columns go to the foot. Options apply to the whole document, not to one section.
  With columns Word sometimes ends an earlier column sooner than its notes require, and a
  paragraph holding a reference at the end of a column can move to the next page where Word ends
  the column with it. Number formats
  beyond Word's common ones show as decimal numbers. Shift+Alt+N is Foli's: Word has no such key.
- On Android, Backspace at a list paragraph's start may join it into the paragraph before
  instead of removing its number (untested on a device).
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
- Drag and drop of text does nothing.
- Some Android keyboards insert paragraphs without the events the editor needs; such an edit is
  discarded with a `Foli:` console warning.
## Extensions, keys and the toolbar

Custom nodes and marks, plugins and toolbar items ([extensions](guides/extensions.md)).

- Node views, mark views and decorations draw only in the editor (`EditorView`): `renderDocument` and `exportPdf` take no extensions, so they draw a
  custom node as its `.docx` text or its type in brackets and a custom mark not at all; the same
  for headers, footers and notes as the pages show them, until one is opened for editing on its
  page. A custom block in a table cell is kept whole (it does not split between pages); a split
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
- `plugins` and `extensions` (of `FoliEditor` and `useFoliEditor`) are read once: changing them
  after mount does not reconfigure the editor (a warning unless `process.env.NODE_ENV` is `"production"` at run time, which a bundle without `process` always shows; a new `key` makes a
  new editor, losing undo history and the selection).
- A toolbar wider than its place wraps, or with `overflow="menu"` puts whole groups under
  More: a group wider than the toolbar is then in the panel whole (its items are not split),
  and a change of an item's own width (a box showing a longer value, a late font) is not
  measured again. A tab that comes with the
  selection (`visible`) is not selected for the user, as Word's is not.
  People cannot change the toolbar themselves: an app does it over `items` or `tabs`.
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
  expressions are not offered (a pattern could hang the page), nor replacing formatting.
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
  hint. A point shows its whole paragraph. In a story, a vertically merged cell's paragraphs,
  a paragraph joined to the next in the final review view, deleted text and field codes shown
  make the copy's paragraphs or characters differ from the story's: the mark is then off by
  them.
- A match in a header no page shows (an unused first-page or even-page variant) is found and
  replaced but cannot be gone to. A read-only view does not open stories.
- Go to takes a page's place in the document, not the number printed on it. Renaming a bookmark
  does not reach a reference whose name is split over two `w:instrText` runs. The cross-reference
  dialog offers the body's bookmarks.
- Ctrl+H, Ctrl+G, F3 and Ctrl+Shift+F5 are browser keys too: they are taken only while the focus
  is in the document or in the panels, and only where `FoliNavigation` is mounted.

## Tracked changes and comments

- While tracking, an edit that would delete or insert content Foli keeps verbatim (an opaque
  block) is not made; tables are tracked row by row. Moves are kept and shown from imported files but not
  recorded: moving text records a deletion and an insertion.
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
- Revisions carry no initials (Word has none); comments do.

## Agent editing (`@folijs/agent`)

Unstable (0.x). Details in the [package README](../packages/agent/README.md).

- Only the body is read and edited: not headers, footers, footnotes or endnotes. One
  exception: `updateFields` also updates the fields there (core's does), as tracked changes the
  session does not read back, and does not report what it skipped there.
- No operation inserts a table or a picture, changes a run's formatting (bold, color), or
  accepts or rejects changes. `session.editor` is the headless editor for those, by positions.
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
- A paragraph the session inserted and then deleted leaves a tracked paragraph insertion on
  the paragraph before it: rejecting every change then joins that paragraph with the next
  (found by the review of #165; not fixed).
- `updateFields` returns no blocks, and leaves page numbers as they are: they need a page
  layout the session does not have. It leaves a table of contents as it is unless
  `contents: true`; one built that way has its entries' page numbers empty until Word updates
  the field (F9).
- Core's rules let a paragraph be inserted into a locked block content control; the session
  refuses it itself, the editor under it (`session.editor`) does not.
- A style the session adds to the document stays when its changes are rejected: a built-in
  heading it used, and the styles a rebuilt table of contents or a control's placeholder needs.
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
- Only `.docx`, up to 64 MB and 64 MB unpacked; the open documents hold about 3 million
  characters of body together, so a very long document may be refused, or leave no room for
  another. An answer over 200,000 characters is cut: read less at a time.
- A save beside the original takes the first free name up to `.agent-100.docx`; when all are
  taken it refuses, and a path must be given.
- File links (symlinks) could not be made on the Windows machine it was built on: the tests
  of those rules ran once on Linux (`pnpm check` on `ubuntu-latest`, 2026-11-21) and run in
  every Release workflow. Not tested on macOS.

## .docx (`@folijs/docx`)

Details in the [package README](../packages/docx/README.md).

- Strict Open XML documents are refused (`DocxError`) until a real file needs them. Encrypted
  zip entries, ZIP64 and compression methods other than stored and deflate are refused too.
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

## Docs and tooling

- The docs site's search matches headings and API names, not body text. The API pages show
  each declaration's `.d.ts` text; code is not highlighted.
- The guides' TypeScript samples are compiled and mostly run by `pnpm test`; their CSS samples
  are not checked, beyond the variable names existing.
- Benchmarks run by hand on the owner's machine against its baseline (`pnpm bench`), not in a
  hosted CI; the browser ones run on the dev server.
