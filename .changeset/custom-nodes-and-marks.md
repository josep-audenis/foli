---
"@folijs/core": minor
"@folijs/view": minor
"@folijs/docx": minor
---

Custom nodes and marks (ADR-0008). An app declares its own types as an `Extension`
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
  text control, and reads them back with or without the extension. A tag over 255 characters
  throws a `DocxError`. Checked through Word 16 (open, edit, save, read back).
- `NodeSpec` takes an optional `text(attrs)`; `parseContent` takes the schema to parse with.
