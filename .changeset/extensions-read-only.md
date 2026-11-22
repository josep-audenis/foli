---
"@folijs/view": minor
"@folijs/pdf": minor
---

`renderDocument` takes `extensions`: custom nodes and marks draw with their node and mark views
on read-only pages, and so do the editor's headers, footers and notes as the pages show them.
`exportPdf` takes `extensions`, a script of the app's that sets `globalThis.foliPdfExtensions` in
the printing page.
