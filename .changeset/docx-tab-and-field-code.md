---
"@folijs/docx": patch
---

A tab character inside `w:t` is read as a tab (as the export writes it), so a document reads the same after a round trip. A `w:instrText` holding elements (a `w:br` in it) is kept verbatim instead of read as a field code the export could not place.
