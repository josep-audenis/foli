---
"@folijs/core": minor
---

While tracking, a table's style, header rows and cells' shading are tracked formatting changes (23.2), as Word records them (`w:tblPrChange`, `w:trPrChange`, `w:tcPrChange`): a `formatChange` on tables, rows and cells (schema 8), listed by `trackedChanges` as `tableFormatting` and accepted or rejected like the others. `setTableStyle`, `setCellShading` and `toggleHeaderRow` now apply while tracking. A link added, changed or taken off while tracking (`setLink`, `removeLink`) is the text deleted and inserted again with the link, so rejecting it takes the link back too (before, the link itself was not tracked). Column commands, merging and splitting cells and column widths are still refused while tracking.
