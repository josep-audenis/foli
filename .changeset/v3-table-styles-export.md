---
"@folijs/docx": patch
---

`exportDocx` no longer refuses a document saved with schema v3 (0.3.0, 0.4.0) from a `.docx`
with "a changed table style cannot be exported yet": v3 kept a table style's properties in its
original XML only, so their absence from the model is now written as read, not taken as a change.
