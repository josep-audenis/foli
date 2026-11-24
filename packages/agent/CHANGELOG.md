# @folijs/agent

## 0.4.1

### Patch Changes

- Updated dependencies [27ff32e]
- Updated dependencies [04bf62f]
  - @folijs/core@1.8.0

## 0.4.0

### Minor Changes

- 8d93bda: Text formatting (23.4): `formatText(handle, format, { on?, all? })` sets bold, italic, underline, strike, font, size, color, highlight and links on a paragraph or text in it, as tracked changes; `read({ formatting: true })` shows each paragraph's own run formatting (`Block.formatting`). The `format_text` tool, `read`'s `formatting` argument and `doc.formatText` in code mode. Table operations of several edits are all or nothing, and act on the row named in a vertically merged table.
- 7aa04b3: Inserting (23.6): `insertItem(handle, item, { where? })` inserts a picture (bytes, alt text, size read from PNG, JPEG or GIF and fitted to the page), a page or section break, a horizontal line, a footnote or an endnote, as tracked insertions; `imageInfo(bytes)`; the `insert` tool and `doc.insert`. `agentTools(session, host)` takes a `ToolHost` whose `picture(path)` gives the tools an image's bytes.
- a49809d: Paragraph formatting and lists (23.5): `formatParagraphs(handles, format)` sets alignment, line spacing, space before and after, indentation and bullet or numbered lists, as tracked formatting changes; `read({ formatting: true })` shows a paragraph's own properties; the `format_paragraph` tool and `doc.formatParagraphs`.
- b10816a: From a fresh model's trial (23.9): `read` shows a picture's alt text (`[picture: Revenue by month]`) and a table's style and header rows on its line (`Block.tableStyle`, `Block.headerRows`); `deleteBlock` says whether it made a tracked deletion or removed one's own insertion; the tools say what `insert_table`'s `header` does and what a new paragraph takes from its neighbour.
- aaae3e0: Review (23.8): `openSession(document, { review: true })` lets a session list (`changes()`), accept and reject (`acceptChanges`, `rejectChanges`, by id or "all") tracked changes, anyone's; `session.reviewing`; the `review` tool, offered only to a reviewing session (`toolsFor`).
- 230f4f4: Headers and footers (23.7): `read({ headers: true })` reads them after the body, each under the sections that use it, with handles `h1`…, `f1`… that the operations take (but `comment`, breaks and notes; their content controls are not filled); the read tool's `headers` argument. The instructions say so.
- 638c7c5: Tables (23.3): `insertTable`, `insertRows`, `deleteRows`, `setCells`, `tableStyles`, `setTableStyle`, `shadeCells` and `setHeaderRows` on a session, a table named by its handle or a cell paragraph's and its rows and columns as `read` numbers them, every edit a tracked change; the `edit_table` tool and their code-mode methods. `read` counts the grid columns a row leaves empty before its first cell (`gridBefore`), and marks a table whose formatting was changed as changed. Columns, merging, splitting and widths are refused: they cannot be recorded as tracked changes.
- f4f6e0b: The tools come with the package (23.1, ADR-0013): `agentTools(session)` gives a model loop each tool's name, description and JSON Schema, and a `run` that checks the arguments and answers in words; `AGENT_TOOLS` are the same over any session, `INSTRUCTIONS` what to tell the model once, `READ_LIMIT` the blocks `read` gives by default. `invalid` and the `JsonSchema` types moved here from `@folijs/mcp`, which re-exports the types.

### Patch Changes

- Updated dependencies [aaae3e0]
- Updated dependencies [d4b4d41]
  - @folijs/core@1.7.0

## 0.3.3

### Patch Changes

- fbd237f: A session tracks its edits whatever the document's own tracking switch says (`settings.trackRevisions`, new in `@folijs/core` 1.6), without changing that setting: a document saved with tracking off still gets the agent's edits as tracked changes, and is saved with tracking off. Works with `@folijs/core` 1.6 (a style or list the session adds is now undone with its edit, as in the editor).
- Updated dependencies [70f9683]
- Updated dependencies [74c437a]
- Updated dependencies [42fae0f]
- Updated dependencies [fdd1ea8]
- Updated dependencies [fb9277f]
- Updated dependencies [eb3818a]
  - @folijs/core@1.6.0

## 0.3.2

### Patch Changes

- 084bac7: What cost a model retries: find (the editor's and the agent's) looks through soft hyphens and zero-width spaces and takes a non-breaking hyphen as `-`; an agent refusal quotes invisible and look-alike characters escaped (`‑`) and never cuts a surrogate pair; `read` gives a table cell's grid column, the columns a merged cell spans and a vertical merge, and a table's grid columns. In the MCP server: a result over 200 000 characters is cut at a block's end and keeps its `(more: …)` line; `null` for an argument that may be left out is taken as leaving it out; a save the system refuses (a file open in Word) says so; a request that is not JSON-RPC 2.0 is answered with its id; `console.log` goes to stderr, never into the protocol.
- Updated dependencies [084bac7]
- Updated dependencies [d05fc3e]
- Updated dependencies [125371e]
- Updated dependencies [836abd3]
- Updated dependencies [7cd3e1e]
  - @folijs/core@1.5.0

## 0.3.1

### Patch Changes

- Updated dependencies [249ccb7]
- Updated dependencies [5aa59f0]
- Updated dependencies [06fb3e1]
- Updated dependencies [e13f0ef]
- Updated dependencies [5386935]
- Updated dependencies [989af53]
- Updated dependencies [fce706b]
  - @folijs/core@1.4.0

## 0.3.0

### Minor Changes

- e722812: `session.target(handle)`: where a block's content is in `session.editor`, as a `DocumentTarget` for core's `hint` or `goTo`, so an app can show an agent's change.

### Patch Changes

- Updated dependencies [85d54c1]
- Updated dependencies [753b774]
  - @folijs/core@1.3.0

## 0.2.0

### Minor Changes

- 4a9f01d: `session.checkpoint()`: marks the document as it is; `rollback()` takes back every edit made since (no tracked change left of them, every handle naming the block it named), `release()` keeps them. For a batch of operations that must all be done or none. One insert now takes 500 paragraphs at most, and one `replaceText` with `all` 500 places, and one replace, `fillControl` or `updateFields` writes 300,000 characters at most, its places together (for `updateFields`, what the fields' results hold: a document's own pictures and references count too): more is refused.

### Patch Changes

- Updated dependencies [4895bc9]
- Updated dependencies [fc6fdb8]
  - @folijs/core@1.2.0

## 0.1.2

### Patch Changes

- 6163844: `updateFields` leaves a table of contents as it is unless `contents: true` is passed. Built without pages, its entries came back with their page numbers empty, and nothing said so; now `text` says a table was left and how to build it, and when one is built, that its entries are new blocks whose page numbers are empty until Word updates the field. A comment's initials are each word's first letter or digit: "Claude (trial)" is `Ct`, not `C(`.

## 0.1.1

### Patch Changes

- d58907d: A read keeps every block on one line whatever the document holds: a carriage return, a line or paragraph separator (U+2028, U+2029) and a next-line character (U+0085) show as `↵`, as a line break does, in a block's text and in everything a document names that is shown (a style, a list number, a control's tag, title, items and value, a field's instruction and a merge field's name in what `updateFields` says; `styles()` and `controls()` give the names that way, and take them back that way). A document could otherwise start a line that reads as another block. A refusal that quotes a block's text quotes at most 2,000 characters of it.
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

## 0.1.0

### Minor Changes

- First release. An LLM agent reads and edits a document without computing positions: `openSession(document, { author })` gives the body as text with a handle per block (`read`), and operations that take handles (`replaceText`, `insertAfter`, `insertBefore`, `deleteBlock`, `setStyle`, `comment`, `controls`, `fillControl`, `updateFields`). Every edit is a tracked change in the author's name, for a person to accept or reject in Foli or in Word. Results are values: the blocks as they read now, or a refusal with a code and a message written for the model. No DOM and no Node built-ins. Unstable (0.x): outside the 1.0 promise of the other packages.
