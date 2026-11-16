# @folijs/react

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
  - @folijs/view@0.4.0

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
  - @folijs/view@0.3.0

## 0.2.0

### Minor Changes

- Rich content (schema v2): bulleted and numbered lists (nested, across pages), links, text color, highlight, alignment and horizontal rules, with toolbar controls and keyboard shortcuts; HTML paste from Word, Google Docs and web pages keeps them. Documents saved by 0.1.0 load unchanged; 0.1.0 cannot read documents saved by 0.2.0.

  Known risks, besides those of 0.1.0 (manual IME, screen-reader and real-paste checks not run): Word and Google Docs lists are read from hand-written fixtures; long documents made of lists miss the editing-speed targets (Enter near the top, first layout, full re-flow). See [Known limitations](https://github.com/josep-audenis/foli/blob/main/docs/limitations.md).

  Breaking (pre-1.0 minor): upgrade every app that reads your documents before saving with 0.2.0, since 0.1.0 cannot read version 2. `Transform.split(pos, after)` is now `split(pos, depth, typesAfter)` (`split(pos, 1, [after])`); `StepMap.side` is now `sides`; `MARK_TYPES` now lists every mark, `link`, `textColor` and `highlight` included (for attribute-free toggles use `SIMPLE_MARK_TYPES`); JSON no longer writes attributes equal to their default; `setBlockType` returns false when nothing changes, and `toggleMark` with invalid attributes returns false instead of throwing.

- 069f986: Alignment, colors and horizontal rules. Core: `setAlign`, `setTextColor`, `setHighlight` (null removes; at a caret, for the next typed text), `insertHorizontalRule`, `alignAt`, `colorAt`, `Transform.setBlockAttrs`, and `editor.commands` for each; typing over a selected rule replaces it with a paragraph, Enter adds one after it; arrow keys select a rule from the text beside it and leave it again (`arrowAcrossLeaf`). View: Up/Down onto a rule from a textblock's first or last line. React: toolbar alignment group, text color and highlight menu buttons (accessible menus, fixed palette), horizontal rule button; CSS variables `--foli-link-color`, `--foli-marker-color`, `--foli-rule-color`, `--foli-rule-thickness`; a rule is a taller box (easier to click) with its line in the middle.
- c0290aa: Links. Core: `setLink(href)`, `removeLink`, `insertLink(href, text?)`, `linkAt(state)`, `normalizeHref` (trim, `\` to `/`, spaces percent-encoded, `mailto:` for an email address and `https://` for a host name) and `autolinkHref`; the commands, the dialog and plain-text paste normalize the href, and every entry (including document load and paste) validates it, so unsafe protocols never apply; `editor.commands.setLink` and `removeLink`. Mod-K runs `openLinkEditor`, a request (`linkEditorRequest` transaction metadata, `requestsLinkEditor(tr)`) that a link UI answers. View: Ctrl+click (Cmd+click on Apple platforms) opens a link in a new tab with `noopener,noreferrer`; pasting plain text that is one URL makes a link (over selected text, links it), except paste as plain text; `view.paste(data, autolink?)`. React: a Link toolbar button (pressed in a link) and Mod-K open an accessible link dialog (URL field, Apply, Remove link, Cancel, Escape; an invalid URL is announced and not applied); new CSS variable `--foli-error-color`.
- ed66e43: List editing. Core: `toggleList`, `wrapInList`, `splitListItem`, `sinkListItem`, `liftListItem`, `liftListItemAtStart`, `listTypeAt` and `listKeymap()` (in every editor): Enter splits an item and leaves the list on an empty one, Tab and Shift+Tab nest and lift items (outside a list Tab is left to the browser), Backspace at an item's start lifts it, Ctrl/Cmd+Shift+7 and +8 toggle numbered and bulleted lists; `editor.commands.toggleList`, `wrapInList`, `indentListItem`, `outdentListItem`. Backspace after a list and Delete before one join into it; Delete at the end of a list item pulls in the next item's text (or what follows the list). Toggling a list off takes the selected items out of every list of that type they are in, leaving unselected items of outer lists; a numbered list split by lifting items goes on counting. Enter over a range across items deletes it, then splits. Each list change is its own undo step. View: Ctrl/Cmd+Shift+digit shortcuts work on every layout; `insertParagraph` and one-character delete inputs (keyboards without keydown) go through the same key bindings. React: toolbar buttons for bulleted and numbered lists (pressed inside one, disabled where no list can be made), decrease and increase indent.
- a034e62: The view renders document format v2: bulleted and numbered lists (nested, rebuilt on each page they are on, numbering continued across pages, no repeated marker on an item continued from the previous page), horizontal rules (a click selects one; shown with the class `foli-selected-node`, outlined by the default theme), links (`<a href>` that does not navigate on click), text color, highlight and alignment. Copy writes real nested lists.

### Patch Changes

- Updated dependencies [cb92eb4]
- Updated dependencies [069f986]
- Updated dependencies [c0290aa]
- Updated dependencies [ed66e43]
- Updated dependencies [ef157b2]
- Updated dependencies [f09aefe]
- Updated dependencies [a034e62]
  - @folijs/view@0.2.0
  - @folijs/core@0.2.0

## 0.1.0

### Minor Changes

- First release: a document editor for the web with its own editing engine, on real pages.
  - **Documents** (`@folijs/core`): a versioned JSON format (`schemaVersion: 1`) with page size and margins in millimetres; `parseDocument` validates untrusted input and never drops document content silently. Schema v1: paragraphs, headings 1–6, line breaks, page breaks; bold, italic, underline, strikethrough.
  - **Engine** (`@folijs/core`): immutable state, steps and transactions, undo/redo history, commands, key bindings, a headless `createEditor`. No DOM.
  - **View** (`@folijs/view`): `EditorView` renders the document on A4 or Letter pages in one `contenteditable` host. Paragraphs split across pages at a line, with widow/orphan and keep-with-next rules, explicit page breaks, incremental reflow, and print with one sheet per page (PDF output checked in Chromium). Typing, IME composition, copy, cut and paste (Foli JSON, HTML mapped to the schema, plain text), read-only mode, placeholder.
  - **React** (`@folijs/react`, React 18.2+ and 19): `FoliEditor` with a formatting toolbar and `onChange`; `useFoliEditor`, `FoliEditorProvider`, `FoliCanvas`, `FoliToolbar`, `useCurrentEditor`, `useEditorState`. Server rendering gives the editor's shell; the document appears on hydration. Default theme in `@folijs/react/styles.css` (CSS variables).

  Known risks: real IME and dead keys (Windows, macOS, Android, iOS input methods), NVDA and VoiceOver, macOS key bindings, spellcheck at a page break, and pastes from real Word, Google Docs and LibreOffice have not been checked by hand. Automated tests run in Chromium, Firefox and WebKit on Windows (IME only through Chromium's emulation, paste not in WebKit, no screen-reader tests); Safari on macOS and iOS is not tested. See [Known limitations](https://github.com/josep-audenis/foli/blob/main/docs/limitations.md).

### Patch Changes

- Updated dependencies
  - @folijs/core@0.1.0
  - @folijs/view@0.1.0
