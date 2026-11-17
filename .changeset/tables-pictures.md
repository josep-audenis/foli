---
"@folijs/core": minor
"@folijs/view": minor
"@folijs/react": minor
"@folijs/docx": minor
---

Tables and pictures as Word models them: imported, edited on pages and written back to `.docx`.

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
