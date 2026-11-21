---
"@folijs/core": patch
"@folijs/view": patch
"@folijs/react": patch
"@folijs/docx": patch
"@folijs/agent": patch
---

A second round of the bug sweep: the suspects the first could not prove, each now shown by a test and fixed (or dismissed).

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
