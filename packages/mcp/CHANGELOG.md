# @folijs/mcp

## 0.2.0

### Minor Changes

- 4a9f01d: Code mode: started with `--code`, the server has a `run` tool that takes a JavaScript script over an open document, for a task that is the same step on many blocks. The script runs in a sandbox (QuickJS as WebAssembly, in a thread of its own, with limits on time, memory and calls) and sees only `doc`, the operations the other tools have. Every edit is a tracked change; a script that throws or is stopped changes nothing. Off by default.
- cc1527a: An open document may grow about 16 million characters, as it would be saved, past what it was when opened: a tool call or a `run` that would pass it is taken back and refused, so a session cannot make a document too large to save. Before, a document crafted for it could make one `update_fields` call (2,000 cross-references to heavily formatted text) end the server at the next save.

### Patch Changes

- 4895bc9: A bug sweep of the toolbar's app items and of the MCP server, each fix with a regression test.

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
- Updated dependencies [4a9f01d]
- Updated dependencies [4895bc9]
- Updated dependencies [fc6fdb8]
  - @folijs/agent@0.2.0
  - @folijs/core@1.2.0
  - @folijs/docx@1.2.0

## 0.1.0

### Minor Changes

- First release: an MCP server over stdio (`npx @folijs/mcp --root <folder>`) through which an MCP client's model reads and edits `.docx` files in one folder, every edit a tracked change and every note a comment. 14 tools over `@folijs/agent`; saves beside the original, never over it unless started with `--overwrite`. Unstable (0.x).

### Patch Changes

- Updated dependencies [6163844]
  - @folijs/agent@0.1.2
