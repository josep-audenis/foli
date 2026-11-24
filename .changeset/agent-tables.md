---
"@folijs/agent": minor
---

Tables (23.3): `insertTable`, `insertRows`, `deleteRows`, `setCells`, `tableStyles`, `setTableStyle`, `shadeCells` and `setHeaderRows` on a session, a table named by its handle or a cell paragraph's and its rows and columns as `read` numbers them, every edit a tracked change; the `edit_table` tool and their code-mode methods. `read` counts the grid columns a row leaves empty before its first cell (`gridBefore`), and marks a table whose formatting was changed as changed. Columns, merging, splitting and widths are refused: they cannot be recorded as tracked changes.
