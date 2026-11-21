---
"@folijs/core": patch
"@folijs/react": patch
"@folijs/mcp": patch
---

A bug sweep of the toolbar's app items and of the MCP server, each fix with a regression test.

**core**

- Accepting a paragraph deleted whole before a table no longer removes it when the paragraphs before join into it, or when it is what keeps the table from another: it stays, as the same paragraph.

**react**

- A toolbar box's `options(state)` follow the document: they run after every transaction, not only when the toolbar renders again (the Style and Table style boxes kept an old list after `setDocument`).
- An app dialog's `close` called twice runs once; closing gives the focus back to the item's button as it is now, when the items changed while the dialog was open.
- A menu whose item left the toolbar does not come back open with it.
- A color menu without colors is disabled instead of opening empty.

**mcp**

- A file is open once whatever capitals or link names it: the second `open` is refused, where two sessions could save over each other.
- A name that only starts with two dots (`..draft.docx`) is inside its folder, not refused as outside.
- A change in a header or footer (a field updated, a control filled) counts as unsaved: `close` no longer drops it.
