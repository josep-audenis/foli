---
"@folijs/core": patch
---

Comments that repeat an id (`1, 1, 2`, as 1.4 imported a damaged `.docx`) are each given an id of their own when a document is read (`parseDocument`, so also `importDocx`, `createEditor` and paste): the first keeps it, each later one gets a fresh id with its anchors. Before, editing or resolving one by id changed the other. A reply to a repeated id stays the first's.
