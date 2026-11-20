---
"@folijs/docx": minor
---

`readPackage` and `importDocx` take `maxNodes` (default 4 000 000, for all the parts read
together; every element, attribute, text, comment and processing instruction counts one, a
paragraph four), and `parseXml` takes it per document (no limit by default): a `.docx` of a few
kilobytes holding millions of empty paragraphs used to exhaust the memory of a browser tab or a
Node server (an uncatchable crash) before the 512 MiB `maxSize` was reached. Past the limit the
`DocxError` names it. `XmlDocument` gives its `nodes` count. A long paragraph of many runs
imports in linear time (200 000 line breaks took 18 s, now under a second).
