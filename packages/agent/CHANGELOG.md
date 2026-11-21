# @folijs/agent

## 0.1.1

### Patch Changes

- d58907d: A read keeps every block on one line whatever the document holds: a carriage return, a line or paragraph separator (U+2028, U+2029) and a next-line character (U+0085) show as `↵`, as a line break does, in a block's text and in everything a document names that is shown (a style, a list number, a control's tag, title and items; `styles()` and `controls()` give the names that way, and take them back that way). A document could otherwise start a line that reads as another block. A refusal that quotes a block's text quotes at most 2,000 characters of it.
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
- Updated dependencies [a4945da]
  - @folijs/core@1.1.0

## 0.1.0

### Minor Changes

- First release. An LLM agent reads and edits a document without computing positions: `openSession(document, { author })` gives the body as text with a handle per block (`read`), and operations that take handles (`replaceText`, `insertAfter`, `insertBefore`, `deleteBlock`, `setStyle`, `comment`, `controls`, `fillControl`, `updateFields`). Every edit is a tracked change in the author's name, for a person to accept or reject in Foli or in Word. Results are values: the blocks as they read now, or a refusal with a code and a message written for the model. No DOM and no Node built-ins. Unstable (0.x): outside the 1.0 promise of the other packages.
