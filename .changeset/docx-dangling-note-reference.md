---
"@folijs/docx": patch
---

A footnote or endnote reference to a note the package does not hold no longer makes the export fail with "A note reference has no note": the import keeps such a reference verbatim (reported as opaque) instead of as a note reference, and the export writes it back as it was.
