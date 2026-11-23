---
"@folijs/docx": patch
---

A package with two zip entries that name one part once percent-decoded (`word/document.xml` and `word/%64ocument.xml`, or `[Content_Types].xml` encoded) is refused as damaged: before, the later entry silently stood in for the other part.
