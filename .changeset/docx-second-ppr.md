---
"@folijs/docx": patch
---

A paragraph with two `w:pPr` (schema-invalid, but written by some tools) no longer loses the second one silently: it is read into the first, property by property and in order, as Word does when it resaves such a file, and the import report says so.
