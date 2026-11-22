# @folijs/docx

## 1.3.0

### Patch Changes

- 85d54c1: The bugs the earlier sweeps left known and open, each fixed with a regression test.

  **core**
  - Accepting several whole-deleted paragraphs before a table gives the same result in any order: the chain goes after a paragraph that stays, and one paragraph stays where Word's rules need it (at the start, between tables).

  **docx**
  - A document that binds WordprocessingML to another prefix (or none) exports with its `fldSimple` fields and modeled attributes well-formed, instead of being refused.

  **view**
  - With field codes shown, a code holding U+E000 in a header or footer is kept beside a page number.

  **react**
  - A link dialog opened from inside another dialog gives the focus back to the Link button on cancel.
  - A tab removed from `tabs` and added again is not selected by itself.
  - Arrow keys in the toolbar and its tabs follow right-to-left layouts.
  - Mod-K with two toolbars on one editor opens one link dialog: the toolbar holding the focus, else the first mounted.
  - An open menu closes when its item is disabled.

  **mcp**
  - A save's export error is one line, as an open's is.
  - A byte order mark before the first message is ignored, also when it comes split over chunks.
  - The server stops, instead of waiting forever, when its output closes while an answer waits to be taken.
  - Saving a document again under its own file's name in other capitals is allowed.
- Updated dependencies [85d54c1]
- Updated dependencies [753b774]
  - @folijs/core@1.3.0

## 1.2.0

### Patch Changes

- Updated dependencies [4895bc9]
- Updated dependencies [fc6fdb8]
  - @folijs/core@1.2.0

## 1.1.0

### Patch Changes

- 617ed0b: A second round of the bug sweep: the suspects the first could not prove, each now shown by a test and fixed (or dismissed).

  **core**
  - Deleting from a paragraph into a table, or the rows of a merge's first cell while tracking, no longer leaves covered cells with no merge above; a tracked row delete leaves the caret in a row not marked deleted.
  - Pasting over cells of one row no longer puts the row's content control around the pasted paragraphs.
  - Renaming a bookmark follows `REF "Name"` and `HYPERLINK \l Name` field codes.
  - `\* Roman` and `\* Alphabetic` (an initial capital) are the uppercase formats; `\* Hex` rounds a fraction.
  - A date control keeps a year under 100 (it was read as 19xx).
  - `history({ depth: 0 })` keeps no undo events; `Fragment.cut` past the end throws a `RangeError`.
  - A style that sets a hanging indent (0 too) clears the first-line indent it inherits.

  **view**
  - A table whose rows are all header rows is no longer repeated whole on each page it runs to.
  - Ctrl+Shift+V that brings no paste event no longer makes the next paste plain.
  - A pasted `<p>&nbsp;</p>` is an empty paragraph.
  - `destroy()` leaves no cursor style on the host.
  - A `PAGE` field reads every `\*` switch (`\* MERGEFORMAT \* roman`), and `Roman` / `Alphabetic` as uppercase.
  - Header and footer text holding U+E000 is kept beside a page number.

  **react**
  - The Bookmarks dialog follows the document while open, and says so when a delete is refused.
  - A comments pane mounted before its canvas positions its threads once the pages are there.

  **docx**
  - Styles, numbering, comments, notes, headers and footers that bind WordprocessingML to another prefix (or none) are written well-formed, as the main document already was.
  - A namespace prefix declared on a hyperlink, a tracked change, a comment or a note no longer makes export throw.
  - A tracked change's `w:date` in a form the model does not hold is kept on export.
  - Move sources (`w:moveFrom`) are written with `w:t`, as Word writes them, not `w:delText`.

  **agent**
  - A block-level control showing its placeholder over several paragraphs reads `[empty: …]` once.
  - A new paragraph takes a style's `next` style only when the document has that paragraph style.
- a4945da: Fixes from a bug sweep of every package, each with a regression test.

  **core**
  - Marks toggled at a caret no longer follow the selection: moving it (or `editor.select()`) drops them.
  - A plugin's change appended to a selection-only transaction is an undo step of its own.
  - `canJoin` and `liftTarget` no longer say yes where `join` and `lift` throw; a structure step out of range fails instead of throwing a `RangeError`.
  - Tables: inserting or deleting a row never leaves the caret in a cell a merge covers; Tab from such a cell goes to the next cell; a row inserted above a header row is a header row, so the header keeps repeating.
  - Fields: `SEQ id bookmark` reads a bookmark after it or around the numbered field; a `MERGEFIELD` date given as `yyyy-mm-dd` is not a day early west of UTC; date pictures take `D` and `Y` in either case.
  - Content controls: a multi-line text control takes CRLF and CR line ends; a date typed in a format with `am/pm` is read; a drop-down given an item's value picks that item before another item's display text.
  - Accepting a paragraph deleted whole before a table removes it, as rejecting an inserted one does.
  - Renaming a bookmark follows links whose anchor differs only in case.
  - The `chicago` number format no longer throws on a large counter.
  - `parseDocument` refuses a custom node its extension is not loaded for when it holds `content` or `text`, instead of dropping them.

  **view**
  - Pasted control characters and lone surrogates are dropped (they made the document unexportable to `.docx`); a vertical tab in plain text ends the paragraph.
  - A rule (`<hr>`) at an end of pasted HTML, or alone, is pasted where it was.
  - A long run of spaces in preformatted pasted text no longer hangs the page.
  - Pasted `details`, `summary`, `center`, `fieldset`, `legend`, `form` and `caption` are blocks of their own.
  - `destroy()` removes `data-foli-cells` from the host.
  - A page break before the first paragraph after a continuous section break starts a page.
  - A deleted break breaks nothing in the `final` and `simple` review views.
  - `renderDocument` (and so PDF export) hides deleted text and draws list numbers in table cells.

  **react**
  - Replace and an open comment form are no longer usable after the editor turns read-only.
  - The control properties dialog leaves unedited list items alone (a value with a `|` was cut).
  - The link dialog closes when another document is set; opening one toolbar dialog closes any other.

  **docx**
  - Export writes well-formed XML for documents that bind WordprocessingML or relationships to another prefix (or none), in the body, the relationships part and the content types.
  - No-break spaces at the ends of a `w:t` are kept on import; a line end inside a `w:t` is read as a space.
  - A comment's start tag (its date with an offset, attributes Foli does not model) is kept on an unedited export.
  - A namespace prefix declared on a paragraph or row no longer makes export throw.

  **agent**
  - `deleteBlock` no longer removes other authors' or untracked text untracked from a paragraph the session's author inserted.
  - A drop-down control's `value` is its display text, as `items` lists and `fillControl` takes.
  - Comment initials of an author whose name starts outside the BMP are well-formed.
- Updated dependencies [617ed0b]
- Updated dependencies [a4945da]
  - @folijs/core@1.1.0

## 1.0.0

### Major Changes

- 7f252a3: **Foli 1.0.** The first stable release: from here the public API and the saved format change only
  as [semver](https://semver.org/) allows. Moving from 0.x:
  [the migration guide](https://foli.josepaudenis.com/docs/guides/migrating-from-0x/) (every
  change since 0.6.0, each older minor's breaks, documents v1 to v5).

  **What 1.0 promises** ([ADR-0008](https://foli.josepaudenis.com/docs/decisions/ADR-0008-1.0-contract-and-extensions/),
  [versions and deprecation](https://foli.josepaudenis.com/docs/deprecation/)):
  - **The API.** What each package's entry exports by name, as the
    [API reference](https://foli.josepaudenis.com/docs/api/) lists it and its API report
    (`api-report.d.ts`) records it, is the 1.x API: nothing is removed or changed before 2.0.
    `@folijs/core/internal` is what the other Foli packages use from core, with no promise. The
    `--foli-*` CSS variables and the documented classes are part of it.
  - **Deprecation.** A name that will go is first deprecated in a minor (`@deprecated` naming its
    replacement, a one-time development warning where cheap, listed in the changelog) and stays
    until the next major at least.
  - **One version.** The five packages share one version, and `@folijs/view`, `@folijs/react`,
    `@folijs/docx` and `@folijs/pdf` take `@folijs/core` (React also `@folijs/view`) as a peer at
    exactly that version: install and upgrade them together.
  - **Saved documents.** Every 1.x reads every earlier format without loss: schema v1 to v5 (0.1.0
    to 0.6.0), and any version a 1.x minor adds (only by adding, with a migration). A document is
    saved with the lowest version its content needs: 1.0 saves v5, as 0.6.0 does. An older 1.x
    refuses a document that needs a newer version with a `FoliDocumentError`; it never reads one
    in part. Apps that walk the JSON must ignore node and mark types they do not know.

  **New since 0.6.0** (details in the entries below):
  - Custom nodes and marks (`Extension`: namespaced inline and block leaves and marks on Word's
    schema), validated, saved in the JSON, copied and pasted, found, tracked, and written to `.docx`
    as content controls tagged `foli:` and read back; without their extension they load as foreign
    nodes and are kept.
  - View extensions in `@folijs/view` (`ViewExtension`): node views (block ones laid out and split
    across pages), mark views, decorations and plugin views, through `createEditor({ extensions })`
    or React's `extensions` prop.
  - Named commands from plugins (`PluginSpec.commands`, `editor.commands`, typed by augmenting
    `FoliCommands`); a plugin's keymap overrides the view's own keys, the rest listed as reserved
    ([keyboard](https://foli.josepaudenis.com/docs/keyboard/)).
  - Toolbar items: `FoliToolbar`'s and `FoliEditor`'s `items`, the built-in items by name
    (`toolbarItems`, `defaultToolbarItems`), app buttons and menus, `useCommand`.
  - The public API listed by name, internals stripped from the published types, exact peers.
  - Safer `.docx` import (`maxNodes`, a long paragraph in linear time), pictures copied into another
    document with their images, faster keystrokes in long documents with lists.
  - The docs site, [foli.josepaudenis.com/docs](https://foli.josepaudenis.com/docs/): getting
    started, guides (extensions, theming, migration), the API reference per package, live examples,
    the limitations.

  **Known risks, accepted by the owner for 1.0 (2026-11-20):**
  - The manual checks of ADR-0003 were never run on real devices: IME and dead keys on real
    Windows, macOS, Android and iOS input methods (only Chromium's emulation is automated), screen
    readers (NVDA, VoiceOver), macOS key bindings, spellcheck and autocorrect at a page edge, pastes
    from real Word, Google Docs and LibreOffice, Safari (tests run on Playwright's WebKit on
    Windows). A failure found later is fixed in a 1.x patch.
  - Phase 5's speed targets are missed at 100 pages (104 pages, the owner's laptop, Chromium; Firefox
    in brackets; [benchmarks](https://foli.josepaudenis.com/docs/benchmarks/#10-numbers)): the
    first layout takes 118 ms (146; target 60), a full re-flow 148 ms (164; target 100), Enter's
    handler 9.9 ms (14; target 8) and its paint p95 35 ms (49; target 25). Typing meets them in
    Chromium (handler 7.9 ms, paint p95 14 ms), not in Firefox (11 and 28 ms). Every page is in the
    DOM and laid out on load (no virtualization); the incremental redraw is for a 1.x minor.
  - Everything else is a documented known limit:
    [limitations](https://foli.josepaudenis.com/docs/limitations/).

### Minor Changes

- 6e698b3: Custom nodes and marks (ADR-0008). An app declares its own types as an `Extension`
  (`{ name, nodes?, marks?, plugins? }`) named `<namespace>:<name>` (`acme:mention`): inline or block
  leaves with `text(attrs)`, the text they stand for, and marks. `createEditor({ extensions })`,
  `parseDocument(document, { extensions })` and `exportDocx(document, package, { extensions })` take
  them; they are stored as ordinary node and mark JSON and never change `schemaVersion`. Without its
  extension a custom type is never dropped: it loads as a foreign node or mark (attributes checked as
  plain JSON, at most 64 KiB), drawn as its type in brackets, and is saved back unchanged.
  - Find matches a custom node's text as one position (replace leaves it, `locked`); inserting or
    deleting one while tracking is a tracked change.
  - `@folijs/view` draws custom nodes as their text (`data-foli-custom`) until node views; plain text
    copies get their text, and a copy holding custom content carries its Foli JSON in the HTML too
    (`data-foli-clipboard`), so pasting in Firefox keeps it.
  - `@folijs/docx` writes a custom node as a locked plain text content control tagged `foli:` with
    its type and attributes (a block node around a paragraph), each run of a custom mark as a rich
    text control, and reads them back with or without the extension (a control holding anything
    more stays a content control). A tag over 255 characters throws a `DocxError`. Checked through Word 16 (open, edit, save, read back).
  - `NodeSpec` takes an optional `text(attrs)`. `parseContent(json, path?, fragment?)` becomes
    `parseContent(json, { path?, fragment?, extensions? })` (`ContentOptions`).
- 68ee717: `readPackage` and `importDocx` take `maxNodes` (default 4 000 000, for all the parts read
  together; every element, attribute, text, comment and processing instruction counts one, a
  paragraph four), and `parseXml` takes it per document (no limit by default): a `.docx` of a few
  kilobytes holding millions of empty paragraphs used to exhaust the memory of a browser tab or a
  Node server (an uncatchable crash) before the 512 MiB `maxSize` was reached. Past the limit the
  `DocxError` names it. `XmlDocument` gives its `nodes` count. A long paragraph of many runs
  imports in linear time (200 000 line breaks took 18 s, now under a second).
- 2fac8e8: The public API is now listed by name (ADR-0008). `@folijs/core`'s entry exports each public name
  explicitly; what the other Foli packages need from core without a promise moved to a second
  entry, `@folijs/core/internal` (the Word context and envelope: `wordContext`, `withEnvelope`,
  `setComments`, `StoryStep`, `CommentStep`, `EnvelopeStep`; the formatting resolver: `Resolver`,
  `formatNumber`, `tableConditions` and their types; clipboard fitting: `copiedDefinitions`,
  `fitPaste`, `fitPastedV2`; layout helpers; `schema`, `checkSection`, `checkControl`,
  `RUN_PROPERTY_MARKS`), and a few helpers left the API (`defaultTextblockType`, `isNote`,
  `storyBody`). Every other module export is tagged `@internal` and left out of the published
  types. `@folijs/view` exports `RenderDocumentOptions`, the type of `renderDocument`'s options
  (`review`, `fieldCodes`, `resource`). The model classes' constructors now appear in the types
  with their parameters (create nodes and marks through `NodeType`, `MarkType` and `Schema`).
  `@folijs/view`, `@folijs/react`, `@folijs/docx` and `@folijs/pdf` now take `@folijs/core` (and
  `@folijs/react` also `@folijs/view`) as a peer dependency at exactly their own version instead of
  a dependency: install the Foli packages together, at one version (npm 7+ and pnpm install peers
  themselves).

### Patch Changes

- 75d0cb6: `exportDocx` and `DocxPackage.write` return, and `exportPdf`'s `pdf` is, a
  `Uint8Array<ArrayBuffer>` (they always were): with TypeScript 5.7 or later the bytes go into a
  `Blob` or a `Response` without a cast. The published types now need TypeScript 5.7 or later.
- 785538a: `exportDocx` no longer refuses a document saved with schema v3 (0.3.0, 0.4.0) from a `.docx`
  with "a changed table style cannot be exported yet": v3 kept a table style's properties in its
  original XML only, so their absence from the model is now written as read, not taken as a change.
- Updated dependencies [0cb49e7]
- Updated dependencies [6e698b3]
- Updated dependencies [4f7197a]
- Updated dependencies [f96c3dc]
- Updated dependencies [c9c227d]
- Updated dependencies [2fac8e8]
- Updated dependencies [7f252a3]
- Updated dependencies [9a4a87f]
  - @folijs/core@1.0.0

## 0.6.0

### Minor Changes

- cd343e4: Sections, headers and footers, notes, fields, content controls, find and replace, and PDF, as Word models them: imported, laid out on pages, edited there and written back to `.docx`.
  - **Schema v5** (`@folijs/core`, ADR-0007): `stories` in the envelope (headers, footers, footnotes and endnotes, each a tree of blocks), `controls` (content controls' properties) and `settings` (even and odd headers, note options, `doNotUseHTMLParagraphAutoSpacing`); field markers (`fieldStart`, `fieldCode`, `fieldSeparator`, `fieldEnd`), content control markers (`controlStart`, `controlEnd`; a `controls` attribute on blocks, rows and cells), `noteReference` and `noteMark` nodes; sections gain `columns`, `pageNumbers`, note properties and a tracked setup change (`change`). `SCHEMA_VERSION` 5: v4 documents migrate on load (the version only: what was opaque stays so until the `.docx` is imported again).
  - **Stories and undo** (`@folijs/core`): `editor.story(id)` gives an editor over a header, footer or note; its changes are `StoryStep`s of the body's history (one undo across the document), `EnvelopeStep` for the last section, settings and controls; accept and reject all reach every story.
  - **Sections** (`@folijs/core`, `@folijs/view`, `@folijs/react`): columns (equal and set widths, the line between, column breaks), continuous, next-column and even and odd page sections with Word's blank page, balanced columns above a continuous break; `insertSectionBreak`, `removeSectionBreak`, `setSectionSetup`, `insertColumnBreak`, tracked as Word records them; a Section menu and Page setup dialog.
  - **Headers and footers**: drawn in their margins on every page (first, even and default variants, linked to the previous section, a taller one pushing the text, page fields filled per page), edited in place (double click or the Header menu, Escape returns) with typing, formatting, pictures, tables, undo and tracking; `setDifferentFirstPage`, `setDifferentEvenPages`, `setStoryLinked`.
  - **Footnotes and endnotes**: at their reference's page foot under a separator, continued on the next page, beneath the text or at the end of a section or the document; numbered in Word's formats with restarts (`noteNumbers`, never stored); `insertNote`, `setNoteProperties`, `convertNotes`; deleted with their reference, tracked, carried on the clipboard; edited in place (double click, Shift+Alt+N, the Notes menu and its options dialog).
  - **Fields**: shown with their results, selected and deleted whole, codes hidden or shown (Alt+F9); `updateFields` (`PAGE`, `NUMPAGES`, `SECTIONPAGES`, `DATE`, `TIME`, `REF`, `PAGEREF`, `SEQ`, `TOC` from heading styles with their pages, `MERGEFIELD` from data; F9, Ctrl+A then F9, `view.updateFields`, `view.print()`) returning what it updated and what it left; `fieldsIn`, `insertField`, `insertPageNumber`, `insertDate`, `insertCrossReference`, `insertTableOfContents`; a Fields menu and cross-reference dialog.
  - **Content controls**: plain and rich text, drop-down, combo box, date, check box, picture, repeating sections, with Word's locks, placeholders and what each kind holds; frames, titles, lists, a date picker and check boxes in the view (Alt+Down, Space); `insertControl`, `setControlValue` and `controlValues` (by id or tag), `setControlProperties`, `addRepeatingItem`; a Controls menu and properties dialog.
  - **Navigation**: `findAll`, `replace`, `replaceAll` over the body and every story (match case, whole words, tracked while tracking, one undo step), `insertBookmark`, `renameBookmark`, `deleteBookmark`, `listBookmarks`, `goTo`, `documentOutline`; matches marked with the CSS Custom Highlight API; `FoliNavigation` (find, replace and go to panel, bookmarks dialog, outline), included in `FoliEditor`, with Word's keys (Ctrl+F, Ctrl+H, Ctrl+G, F3, Shift+F3, Ctrl+Shift+F5) and a Navigate menu.
  - **DOCX** (`@folijs/docx`): headers, footers, footnotes and endnotes read and written as stories (unchanged ones byte for byte, new ones with their parts, relationships and content types), complex and simple fields, content controls at every level (properties patched into the kept `w:sdtPr`), sections' columns, page numbers and note properties, `word/settings.xml`'s even and odd headers and note options. Word reads Foli's sections, headers, notes, fields, controls and replacements back (`scripts/corpus/*-roundtrip.mjs`).
  - **PDF** (`@folijs/pdf`, first released): `exportPdf(document, { page, resources, review, styles })` prints Foli's own pages with a headless Chromium page the app supplies (Playwright 1.42+; Puppeteer's page type fits): each section on its own sheet size, fields updated from the pages first, safe links and bookmark links as PDF links, headings as PDF bookmarks, a tagged PDF. The page loads nothing from the network (images and fonts as `data:` URLs only). Against Word's PDFs of the corpus it scores 0.954 over 24 pages.
  - **Pages against Word**: all 158 paragraphs outside tables that the harness compares on Word's page; headers, footers and notes scored with the rest of the page (0.889 over 24 pages on screen).

  0.5.0 cannot read documents saved by 0.6.0 (schema v5). Known limits are in [Known limitations](https://github.com/josep-audenis/foli/blob/main/docs/limitations.md) (content, finding and going places, print and PDF sections).

  Changed behaviour (pre-1.0 minor):
  - `.docx` headers, footers and notes import as `stories` (0.5.0 kept them as parts, never shown); note references, fields (`w:fldChar`, `w:instrText`, `w:fldSimple`) and content controls (`w:sdt`) that imported as `opaqueInline` or `opaqueBlock` now import as nodes. A v4 document's opaque content stays opaque until the `.docx` is imported again.
  - Layout: between two paragraphs goes the larger of the first's space after and the second's space before, as in Word's PDFs (0.5.0 added them; they still add up with `w:doNotUseHTMLParagraphAutoSpacing`); a line is as tall as its runs and paragraph mark, not the paragraph style's font; a header or footer taller than its margin pushes the text. Pages break differently than in 0.5.0, closer to Word.
  - `FoliEditor` includes `FoliNavigation` and takes Ctrl+F, Ctrl+H, Ctrl+G, F3, Shift+F3 and Ctrl+Shift+F5 while the focus is in the document or its panels (the browser's own find no longer opens there).
  - `FoliToolbar` shows the Section, Header, Fields, Navigate, Notes and Controls menus.
  - `view.print()` updates every field before printing; the print rules are shared with `exportPdf`.
  - Backspace at a field's edge selects the field first, and a selection crossing a field's markers takes the whole field, as in Word; the caret steps over a field's code.
  - `acceptAllChanges` and `rejectAllChanges` also settle the tracked changes in headers, footers and notes.

### Patch Changes

- Updated dependencies [cd343e4]
  - @folijs/core@0.6.0

## 0.5.0

### Minor Changes

- 18f838a: Tables and pictures as Word models them: imported, edited on pages and written back to `.docx`.
  - **Schema v4** (`@folijs/core`, ADR-0006): `table`, `tableRow` and `tableCell` nodes with Word's table, row and cell properties (grid, merges, borders, shading, widths, header rows, `cantSplit`), table styles resolved as Word does (conditional formatting for first and last rows and columns, bands), `picture` nodes (inline or floating: `float` with Word's position and wrapping) and the envelope's `resources` (the pictures' images by key: content type, size, a URL or an opted-in `data:` URL; no base64 by default). `SCHEMA_VERSION` 4: v3 documents migrate on load.
  - **Table editing** (`@folijs/core`, `@folijs/view`): cells isolate edits; typing, Enter, Backspace and Delete in cells; Tab and Shift+Tab between cells (Tab in the last cell adds a row); arrows across rows, pages and out of the table; `CellSelection` (drag, Shift+arrows) with copy, cut, paste and delete; commands `insertTable`, `insertRow`, `deleteRows`, `insertColumn`, `deleteColumns`, `deleteTable`, `mergeCells`, `splitCell`, `toggleHeaderRow`, `setTableStyle`, `setCellShading`, `setColumnWidth`; column borders dragged in the view. Rows inserted and deleted while tracking are tracked as Word records them.
  - **Tables on pages** (`@folijs/view`): tables drawn from the model, rows flowed across pages (split at a line, header rows repeated, `cantSplit` kept whole); 277 of the corpus's 280 cell paragraphs on Word's page.
  - **Pictures** (`@folijs/core`, `@folijs/view`): `insertPicture` (alt text required unless decorative, or `{ requireAlt: false }`: pasted and dropped files go in so and are marked), `setPictureSize`, `setPictureAlt`, `selectedPicture`; pictures drawn at their size, selected by a click, resized by a handle with their aspect ratio kept; image files pasted or dropped go through the app's `upload` hook (`EditorViewOptions.upload`, `view.insertFiles`), images shown through `EditorViewOptions.resource`; floating pictures laid out with the text around them (square, top and bottom, behind and in front of text), where Word places them in the corpus. `measureImageFile`, `textWidthEmu` and `EMU_PER_PX` are exported.
  - **React** (`@folijs/react`): `FoliToolbar` gets a Table menu (insert table dialog, rows, columns, merge, split, header row, delete), a table style box, a cell shading menu and a Picture… dialog (insert from a file with alt text; edit a picture's alt text and size); `FoliEditor` and `FoliCanvas` take `upload` and `resource` props, `FoliToolbar` `upload`. Keyboard-usable and axe-clean in Chromium, Firefox and WebKit.
  - **DOCX** (`@folijs/docx`): tables read into the model and written back (unchanged ones as written, changed ones child by child; tracked row changes); inline (`wp:inline`) and floating (`wp:anchor`) pictures read as picture nodes with their images as resources, written back byte for byte when unchanged, new images as media parts from `data:` URLs or `ExportOptions.resource`; `packageImages(pkg)` gives the view URLs for a package's images; `report.picturesWithoutAlt`. Word opens the corpus's tables and pictures exported unchanged and edited.

  0.4.0 cannot read documents saved by 0.5.0 (schema v4). Known limits are in [Known limitations](https://github.com/josep-audenis/foli/blob/main/docs/limitations.md) (tables and pictures sections).

  Changed behaviour (pre-1.0 minor):
  - `.docx` tables and drawings that imported as `opaqueBlock` and `opaqueInline` now import as `table` and `picture` nodes; a v3 document's opaque tables stay opaque until the `.docx` is imported again.
  - `exportDocx` needs the bytes of a picture added since import: a `data:` URL resource or `ExportOptions.resource(key, resource)`; without them it throws a `DocxError` (never drops the picture).
  - The editor's pages are `position: relative; isolation: isolate; display: flow-root` (pictures behind and in front of text are positioned against them; a floating picture past the page's text makes the page taller).
  - Inserting or deleting a table while tracking is recorded as tracked rows (0.4.0 did not make the edit), and `deleteComment` and `deleteAllComments` remove comments anchored in tables (0.4.0 kept them: tables were opaque).
  - `FoliToolbar` shows the Table menu, table style box, cell shading menu and Picture… button.

### Patch Changes

- Updated dependencies [18f838a]
  - @folijs/core@0.5.0

## 0.4.0

### Minor Changes

- e2a6e23: Review as in Word: tracked changes recorded, shown, accepted and rejected; comments written, answered and resolved; both round-trip with Word.
  - **Tracked changes** (`@folijs/core`): with tracking on (`createEditor({ author, trackChanges })`, `editor.commands.setTrackChanges`), every edit is recorded as Word records it: what is removed stays marked deleted, what is added is marked inserted, paragraph marks removed or added are recorded on the paragraph, formatting changes keep the properties from before the first change (`formatChange`), and deleting your own insertion removes it. Commands need no tracking code: the editor rebuilds each transaction it dispatches (`trackTransaction`). Accept and reject (`acceptChange`, `rejectChange` at the caret or in the selection, `acceptAllChanges(author?)`, `rejectAllChanges(author?)`, `nextChange`, `previousChange`, `trackedChanges(doc)`), each its own undo step; both ends of a move together. A property test checks that accepting everything gives the same document as the edits made untracked and rejecting everything gives the original.
  - **Comments** (`@folijs/core`): `addComment`, `replyToComment`, `editComment`, `resolveComment`, `deleteComment`, `deleteAllComments`, with Word's anchors; comment changes are part of undo history (`CommentStep`); a comment whose text is deleted with its reference goes with it.
  - **Review view** (`@folijs/core` state, drawn by `@folijs/view`): tracked changes shown as all markup (author colors, a bar beside changed paragraphs), simple markup or no markup while editing (`setReviewView`, `createEditor({ reviewView })`); while tracking, or where it is hidden, Backspace and Delete step over deleted text; the caret never goes into hidden text.
  - **React** (`@folijs/react`): a review group in `FoliToolbar` (New comment, Track changes, Show changes as, previous and next change, Accept, Reject, Accept all, Reject all); `FoliComments`, a comments pane beside the pages (threads level with their text; reply, edit, resolve, delete), shown by `FoliEditor` while the document has comments (`comments` prop); `FoliEditor` props `author`, `trackChanges`, `reviewView`.
  - **DOCX** (`@folijs/docx`): `DocxImport.trackRevisions` and `exportDocx(document, package?, { trackRevisions })` read and write Word's tracking setting. Checked with Word on the corpus: files with changes and comments made in Foli open without a repair prompt with those changes, authors and threads; Word's accepted and rejected text equals Foli's (case aside; table paragraphs, fields and content controls aside; one corpus document, with a content control around paragraphs, not compared); Foli reads Word's own changes and replies back.

  No document format change (schema 3): 0.3.0 and 0.4.0 read each other's documents. Known limits are in [Known limitations](https://github.com/josep-audenis/foli/blob/main/docs/limitations.md) (tables are not tracked yet; dates are written in UTC).

  Changed behaviour (pre-1.0 minor):
  - A paragraph left with nothing by a join or by a deletion from its start is removed whole: the next paragraph keeps its own properties (before, the merged paragraph took the first one's).
  - `closeHistory` makes a transaction an undo step of its own on both sides: typing right after a paste, cut or drop is now its own step.
  - `FoliToolbar` shows a review group by default (Track changes, Show changes as, previous and next change, Accept, Reject, Accept all, Reject all); New comment only with its new `comments` prop (`FoliEditor` passes it).
  - Tracked changes in markup are drawn in each author's color (was one fixed red), with a bar beside changed paragraphs; commented text carries `data-foli-comments`.
  - `withEnvelope` ignores comments: change them with `setComments` (or the comment commands).
  - `FoliEditor` puts the canvas inside a `.foli-editor-body` element (beside the comments pane): CSS that relied on `.foli-canvas` being a direct child of the editor's parent needs updating.
  - Imported `w:rPrChange` properties are in canonical form (default attributes left out); inserted and deleted text in `renderDocument` and the editor is titled "Inserted by …" / "Deleted by …".

### Patch Changes

- Updated dependencies [e2a6e23]
  - @folijs/core@0.4.0

## 0.3.0

### Minor Changes

- 8da5b98: Word documents (schema v3): Foli opens a `.docx`, shows it with the file's own styles on real pages, edits it, and saves it back without losing what it does not edit.
  - **Model** (`@folijs/core`, schema v3, Word-shaped): paragraph properties as attributes (style, justification, indentation, spacing, keep and widow rules, page break before, outline level, numbering, tab stops, borders, shading); run properties as marks (character style, bold, italic, underline styles, strike, font, size, color, highlight, shading, vertical alignment, caps); headings as Word's heading styles; lists as Word's numbering (formats, starts, restarts, levels, legal numbering); sections with their own page size, orientation and margins; styles with `basedOn`, document defaults and the theme in the envelope; tracked insertions and deletions and comment anchors, with the comments; content the model does not hold kept as opaque nodes. Effective formatting and list numbers resolved as Word resolves them. Documents saved by 0.1.0 and 0.2.0 load through a migration without content loss.
  - **DOCX** (`@folijs/docx`, new; browser, worker and Node, no third-party dependencies): `importDocx` to schema v3 with a report of what stayed opaque; `exportDocx` rewriting only the parts the editor owns, so a document saved without edits is the original under a canonical comparison, and parts the editor does not own are written back byte for byte. Checked with Word: every corpus document, exported unchanged and edited, opens without a repair prompt.
  - **View** (`@folijs/view`): `renderDocument` lays a document out read-only on Word-like pages (tracked changes as markup or final); `EditorView` edits on the same pages, each section on pages of its own size and margins, and prints one sheet per page with each section's size. A font the machine lacks falls back to a metric-compatible substitute when one is installed (Carlito, Caladea, Liberation…).
  - **React** (`@folijs/react`): `FoliEditor` and `useFoliEditor` take a document of any version and edit and report it as v3; the toolbar has a style box (the document's paragraph styles, headings included), font, size, line spacing and a page break, with Word-numbered bulleted and numbered lists.
  - **Fidelity with Word** (corpus of five Word-written documents; `corpus/README.md`): 106 of 106 paragraphs start on Word's page and 103 on Word's line; pages scored against Word's PDF at 0.544.

  Known risks, besides those of 0.2.0 (manual IME, screen-reader and real-paste checks not run): headers, footers, footnotes and floating pictures are kept and exported but not shown; tables are shown from their XML but are not editable or split across pages; page setups and section breaks cannot be edited yet; tracked changes are shown but not recorded, accepted or rejected (Phase 9). See [Known limitations](https://github.com/josep-audenis/foli/blob/main/docs/limitations.md).

  Breaking (pre-1.0 minor): upgrade every app that reads your documents before saving with 0.3.0, since 0.2.0 cannot read version 3.
  - Documents persist as v3: `FoliChange.document`, `getDocument()` and `useFoliEditor` give v3; `createEditor`, `setDocument` and `FoliEditor`'s `initialContent` take a document of any version (`EditorDocument`) and migrate it.
  - Names: schema v3 takes the plain ones (`FoliDocument`, `parseDocument`, `parseContent`, `schema`, `SCHEMA_VERSION` 3). `createDocument(content?, section?)` makes a v3 document: its content is v3 and its second argument a section in twips (0.2.0's took v2 content and settings in millimetres; both still type-check, so a 0.2.0 call such as `createDocument(htmlToDoc(html))` fails in `createEditor` or gives a wrong page size). v2's are `FoliDocumentV2` and `parseContentV2`, and `htmlToDoc` still returns v2 content; v2's `schema`, `parseDocument` and `SCHEMA_VERSION` are no longer exported (`parseDocument` reads v1 and v2 documents and migrates them). `MARK_TYPES`, `HEADING_LEVELS` and the JSON types such as `DocJSON` still describe v2.
  - Marks follow Word: text color is the `color` mark (`value`), and `highlight` takes a Word color name (the palette is Word's); there is no `textColor` mark. Use `setTextColor`, `setHighlight` and `colorAt(state, "textColor" | "highlight")` rather than `toggleMark` or `isMarkActive` with these marks.
  - Links: `parseDocument` keeps any link target a file has (a `.docx` may hold `file:` links, say), where 0.2.0 rejected unsafe ones. Foli's view only makes a link of a safe target (`isSafeHref`); check it too wherever you turn a document's links into HTML yourself. Commands still refuse an unsafe href.
  - Keyboard: Tab types a tab outside lists, as in Word (in 0.2.0 it moved the focus); Escape, then Tab, moves the focus out of the editor.
  - Lists: `toggleList(kind)` and `wrapInList(kind)` take no attributes; `splitListItem`, `sinkListItem`, `liftListItem` and `liftListItemAtStart` are commands, not factories.
  - On a state without a v3 envelope, `setBlockType` and the list and format commands do not apply.
  - Removed: `insertHorizontalRule` (and `commands.insertHorizontalRule`), `listTypeAt`, the ¶, H1–H3 and rule toolbar buttons (the style box replaces them), and the CSS variables `--foli-font-family`, `--foli-font-size`, `--foli-line-height`, `--foli-link-color`, `--foli-marker-color`, `--foli-rule-color` and `--foli-rule-thickness` (the document's styles set them now).

### Patch Changes

- Updated dependencies [8da5b98]
  - @folijs/core@0.3.0
