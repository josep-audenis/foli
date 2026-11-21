# @folijs/agent

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
