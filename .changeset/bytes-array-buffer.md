---
"@folijs/docx": patch
"@folijs/pdf": patch
---

`exportDocx` and `DocxPackage.write` return, and `exportPdf`'s `pdf` is, a
`Uint8Array<ArrayBuffer>` (they always were): with TypeScript 5.7 or later the bytes go into a
`Blob` or a `Response` without a cast. The published types now need TypeScript 5.7 or later.
