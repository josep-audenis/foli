# @folijs/view

## 0.2.0

### Minor Changes

- Rich content (schema v2): bulleted and numbered lists (nested, across pages), links, text color, highlight, alignment and horizontal rules, with toolbar controls and keyboard shortcuts; HTML paste from Word, Google Docs and web pages keeps them. Documents saved by 0.1.0 load unchanged; 0.1.0 cannot read documents saved by 0.2.0.

  Known risks, besides those of 0.1.0 (manual IME, screen-reader and real-paste checks not run): Word and Google Docs lists are read from hand-written fixtures; long documents made of lists miss the editing-speed targets (Enter near the top, first layout, full re-flow). See [Known limitations](https://github.com/josep-audenis/foli/blob/main/docs/limitations.md).
- cb92eb4: HTML paste reads schema v2: lists at any depth (`ul`/`ol`/`li`, `start`, a list nested directly in a list), Word list paragraphs (`mso-list` levels, numbered or bulleted from their marker) and Google Docs lists, rules (`hr`), links from `a[href]` when the href is safe (in-page `#…` anchors dropped), text color and highlight from inline styles and `<font color>` (black or white text and white highlight are dropped), and block alignment (`text-align`, `align`). Lists and rules that cannot be pasted as a slice go in as whole blocks at the caret (a list pasted into a list item joins it). Copy writes the same structures, so Foli's HTML reads back as the same document.
- 069f986: Alignment, colors and horizontal rules. Core: `setAlign`, `setTextColor`, `setHighlight` (null removes; at a caret, for the next typed text), `insertHorizontalRule`, `alignAt`, `colorAt`, `Transform.setBlockAttrs`, and `editor.commands` for each; typing over a selected rule replaces it with a paragraph, Enter adds one after it; arrow keys select a rule from the text beside it and leave it again (`arrowAcrossLeaf`). View: Up/Down onto a rule from a textblock's first or last line. React: toolbar alignment group, text color and highlight menu buttons (accessible menus, fixed palette), horizontal rule button; CSS variables `--foli-link-color`, `--foli-marker-color`, `--foli-rule-color`, `--foli-rule-thickness`; a rule is a taller box (easier to click) with its line in the middle.
- c0290aa: Links. Core: `setLink(href)`, `removeLink`, `insertLink(href, text?)`, `linkAt(state)`, `normalizeHref` (trim, `\` to `/`, spaces percent-encoded, `mailto:` for an email address and `https://` for a host name) and `autolinkHref`; the commands, the dialog and plain-text paste normalize the href, and every entry (including document load and paste) validates it, so unsafe protocols never apply; `editor.commands.setLink` and `removeLink`. Mod-K runs `openLinkEditor`, a request (`linkEditorRequest` transaction metadata, `requestsLinkEditor(tr)`) that a link UI answers. View: Ctrl+click (Cmd+click on Apple platforms) opens a link in a new tab with `noopener,noreferrer`; pasting plain text that is one URL makes a link (over selected text, links it), except paste as plain text; `view.paste(data, autolink?)`. React: a Link toolbar button (pressed in a link) and Mod-K open an accessible link dialog (URL field, Apply, Remove link, Cancel, Escape; an invalid URL is announced and not applied); new CSS variable `--foli-error-color`.
- ed66e43: List editing. Core: `toggleList`, `wrapInList`, `splitListItem`, `sinkListItem`, `liftListItem`, `liftListItemAtStart`, `listTypeAt` and `listKeymap()` (in every editor): Enter splits an item and leaves the list on an empty one, Tab and Shift+Tab nest and lift items (outside a list Tab is left to the browser), Backspace at an item's start lifts it, Ctrl/Cmd+Shift+7 and +8 toggle numbered and bulleted lists; `editor.commands.toggleList`, `wrapInList`, `indentListItem`, `outdentListItem`. Backspace after a list and Delete before one join into it; Delete at the end of a list item pulls in the next item's text (or what follows the list). Toggling a list off takes the selected items out of every list of that type they are in, leaving unselected items of outer lists; a numbered list split by lifting items goes on counting. Enter over a range across items deletes it, then splits. Each list change is its own undo step. View: Ctrl/Cmd+Shift+digit shortcuts work on every layout; `insertParagraph` and one-character delete inputs (keyboards without keydown) go through the same key bindings. React: toolbar buttons for bulleted and numbered lists (pressed inside one, disabled where no list can be made), decrease and increase indent.
- ef157b2: Document format v2 (`schemaVersion: 2`): bullet and ordered lists (`bulletList`, `orderedList` with `start`, `listItem`), `horizontalRule`, `align` on paragraphs and headings (`start`, `center`, `end`, `justify`; changing a block's type keeps it), and the marks `link` (`href` limited to relative URLs and http, https, mailto, tel: see `isSafeHref`), `textColor` and `highlight` (lowercase `#rrggbb`: see `isColor`). Documents saved by 0.1.0 (v1) load unchanged through a migration; 0.1.0 cannot read v2 documents. Attributes equal to their default are no longer written to JSON. `MARK_TYPES` now lists every mark (attribute-free ones are `SIMPLE_MARK_TYPES`). `setBlockType` no longer applies (or records undo) when nothing changes; `toggleMark` with invalid attributes (a link with an unsafe href) does not apply instead of throwing.
- a034e62: The view renders document format v2: bulleted and numbered lists (nested, rebuilt on each page they are on, numbering continued across pages, no repeated marker on an item continued from the previous page), horizontal rules (a click selects one; shown with the class `foli-selected-node`, outlined by the default theme), links (`<a href>` that does not navigate on click), text color, highlight and alignment. Copy writes real nested lists. List editing commands and keys come in a later release.

### Patch Changes

- Updated dependencies [069f986]
- Updated dependencies [c0290aa]
- Updated dependencies [ed66e43]
- Updated dependencies [ef157b2]
- Updated dependencies [f09aefe]
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
