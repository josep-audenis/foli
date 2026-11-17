# @folijs/docx

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
