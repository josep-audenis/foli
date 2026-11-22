---
"@folijs/docx": patch
---

A run property written twice in one `w:rPr` (two `w:rFonts`, say, as some tools write in styles and numbering levels) no longer makes the import fail with "duplicate mark": the two are read in order as one property, and the import report says so. The original `w:rPr` is still written back on export.
