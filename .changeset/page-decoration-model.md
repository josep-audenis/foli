---
"@folijs/core": minor
"@folijs/docx": minor
"@folijs/view": minor
---

Page decoration (schema 9): the page color (`settings.background`, Word's `w:background`) and a
section's page borders and line numbers (`pageBorders`, `lineNumbers`) in the model, read from
and written to `.docx` (unchanged parts byte for byte), drawn on the pages, in print and in
`exportPdf`.
