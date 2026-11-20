---
"@folijs/docx": minor
---

`readPackage` and `importDocx` take `maxElements` (default 1 000 000, for all the parts read
together) and `parseXml` takes it per document: a `.docx` of a few kilobytes holding millions
of empty paragraphs used to exhaust the memory of a browser tab or a Node server (an uncatchable
crash) before the 512 MiB `maxSize` was reached. `XmlDocument` gives its `elements` count.
