# @folijs/mcp

## 0.2.4

### Patch Changes

- Updated dependencies [fbd237f]
- Updated dependencies [70f9683]
- Updated dependencies [74c437a]
- Updated dependencies [42fae0f]
- Updated dependencies [fdd1ea8]
- Updated dependencies [fb9277f]
- Updated dependencies [eb3818a]
  - @folijs/agent@0.3.3
  - @folijs/core@1.6.0
  - @folijs/docx@1.6.0

## 0.2.3

### Patch Changes

- 084bac7: What cost a model retries: find (the editor's and the agent's) looks through soft hyphens and zero-width spaces and takes a non-breaking hyphen as `-`; an agent refusal quotes invisible and look-alike characters escaped (`‑`) and never cuts a surrogate pair; `read` gives a table cell's grid column, the columns a merged cell spans and a vertical merge, and a table's grid columns. In the MCP server: a result over 200 000 characters is cut at a block's end and keeps its `(more: …)` line; `null` for an argument that may be left out is taken as leaving it out; a save the system refuses (a file open in Word) says so; a request that is not JSON-RPC 2.0 is answered with its id; `console.log` goes to stderr, never into the protocol.
- b428204: A save no longer writes over the file another open document came from, or one another document saved since (even after it was closed): a save with a path there is refused, naming the other document, and a save without one takes the next free name. Before, saving a first document beside its file after opening that saved copy as a second document lost the second's saved edits.
- Updated dependencies [084bac7]
- Updated dependencies [d05fc3e]
- Updated dependencies [125371e]
- Updated dependencies [836abd3]
- Updated dependencies [0bc8328]
- Updated dependencies [a73c1e6]
- Updated dependencies [63d7e9a]
- Updated dependencies [5017c9d]
- Updated dependencies [1d7ba63]
- Updated dependencies [bf15217]
- Updated dependencies [7cd3e1e]
- Updated dependencies [4285724]
  - @folijs/core@1.5.0
  - @folijs/agent@0.3.2
  - @folijs/docx@1.5.0

## 0.2.2

### Patch Changes

- 5ed16bc: Code mode: a run's 10 seconds count from when its sandbox is ready, not from when its thread is started. On a busy machine starting the thread and QuickJS alone took seconds, and a short script could fail with "It did not finish in 10 seconds" without having run. The start has a limit of its own, 30 seconds ("The sandbox did not start in 30 seconds.").
- Updated dependencies [249ccb7]
- Updated dependencies [5aa59f0]
- Updated dependencies [06fb3e1]
- Updated dependencies [e13f0ef]
- Updated dependencies [5386935]
- Updated dependencies [989af53]
- Updated dependencies [fce706b]
  - @folijs/core@1.4.0
  - @folijs/docx@1.4.0
  - @folijs/agent@0.3.1

## 0.2.1

### Patch Changes

- 85d54c1: The bugs the earlier sweeps left known and open, each fixed with a regression test.

  **core**
  - Accepting several whole-deleted paragraphs before a table gives the same result in any order: the chain goes after a paragraph that stays, and one paragraph stays where Word's rules need it (at the start, between tables).

  **docx**
  - A document that binds WordprocessingML to another prefix (or none) exports with its `fldSimple` fields and modeled attributes well-formed, instead of being refused.

  **view**
  - With field codes shown, a code holding U+E000 in a header or footer is kept beside a page number.

  **react**
  - A link dialog opened from inside another dialog gives the focus back to the Link button on cancel.
  - A tab removed from `tabs` and added again is not selected by itself.
  - Arrow keys in the toolbar and its tabs follow right-to-left layouts.
  - Mod-K with two toolbars on one editor opens one link dialog: the toolbar holding the focus, else the first mounted.
  - An open menu closes when its item is disabled.

  **mcp**
  - A save's export error is one line, as an open's is.
  - A byte order mark before the first message is ignored, also when it comes split over chunks.
  - The server stops, instead of waiting forever, when its output closes while an answer waits to be taken.
  - Saving a document again under its own file's name in other capitals is allowed.
- Updated dependencies [e722812]
- Updated dependencies [85d54c1]
- Updated dependencies [753b774]
  - @folijs/agent@0.3.0
  - @folijs/core@1.3.0
  - @folijs/docx@1.3.0

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
