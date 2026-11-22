---
"@folijs/core": patch
---

Deleting a whole paragraph you inserted yourself while tracking changes now removes it without a trace, at the end of the document or of a cell too. Before, when the deletion ended at that paragraph's end, the paragraph after it took its "inserted" mark, and rejecting every change then joined that paragraph with the next one. `@folijs/agent` met it as an insert followed by `deleteBlock`.
