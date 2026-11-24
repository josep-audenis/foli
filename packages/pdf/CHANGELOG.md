# @folijs/pdf

## 1.8.0

### Patch Changes

- Updated dependencies [27ff32e]
- Updated dependencies [04bf62f]
  - @folijs/core@1.8.0

## 1.7.0

### Patch Changes

- Updated dependencies [aaae3e0]
- Updated dependencies [d4b4d41]
  - @folijs/core@1.7.0

## 1.6.0

### Patch Changes

- Updated dependencies [70f9683]
- Updated dependencies [74c437a]
- Updated dependencies [42fae0f]
- Updated dependencies [fdd1ea8]
- Updated dependencies [fb9277f]
- Updated dependencies [eb3818a]
  - @folijs/core@1.6.0

## 1.5.0

### Patch Changes

- 89e7c4f: Two `exportPdf` calls given one page run one after the other: before, the second replaced the first's document while it printed, so on a server with a pool of pages one user's PDF could hold another's document. New options `signal` (an `AbortSignal`) and `timeout` (milliseconds) stop an export. The README says to keep `@folijs/pdf` external in bundlers.
- Updated dependencies [084bac7]
- Updated dependencies [d05fc3e]
- Updated dependencies [125371e]
- Updated dependencies [836abd3]
- Updated dependencies [7cd3e1e]
  - @folijs/core@1.5.0

## 1.4.0

### Minor Changes

- 532cecd: `renderDocument` takes `extensions`: custom nodes and marks draw with their node and mark views
  on read-only pages, and so do the editor's headers, footers and notes as the pages show them.
  `exportPdf` takes `extensions`, a script of the app's that sets `globalThis.foliPdfExtensions` in
  the printing page.

### Patch Changes

- Updated dependencies [249ccb7]
- Updated dependencies [5aa59f0]
- Updated dependencies [06fb3e1]
- Updated dependencies [e13f0ef]
- Updated dependencies [5386935]
- Updated dependencies [989af53]
- Updated dependencies [fce706b]
  - @folijs/core@1.4.0

## 1.3.0

### Patch Changes

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
