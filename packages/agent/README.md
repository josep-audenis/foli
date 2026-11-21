# @folijs/agent

Agent editing for [Foli](https://github.com/josep-audenis/foli): a session over a document whose
edits are tracked changes in the agent's name, for a person to accept or reject in Foli or in
Word. No DOM and no Node built-ins: runs in Node, browsers, workers and sandboxes. Its only
dependency is `@folijs/core`, a peer at an exact version.

> **Unstable (0.x), unreleased.** In development (roadmap, Phase 13): reading, text editing, styles and
> comments are built; templates are not yet. Outside the 1.0 promise of the other packages.

```ts
import { openSession } from "@folijs/agent";
import { exportDocx, importDocx } from "@folijs/docx";

const { document, package: pkg } = await importDocx(bytes);
const session = openSession(document, { author: "Agent" });
const read = session.read(); // { ok: true, text, blocks, next }
const out = await exportDocx(session.document(), pkg);
```

## Reading

`session.read()` gives the document's body as text, one block per line, as it would be with
every tracked change accepted:

```
[b1] Title: MUTUAL NON-DISCLOSURE AGREEMENT
[b6] heading 1, 1.: Definitions and interpretation
[b7] Clause, 1.1, changed, 2 comments: In this Agreement the following definitions apply:
[b11] table, 3 rows, 2 columns
[b12]   r1 c1, Normal: Item
[b20] not editable: w:sdt
```

- `[b7]` is the block's **handle**: what every operation takes. It names the same block for the
  whole session, whatever is edited around it. A new block gets a new handle; a block that is
  removed, or joined into the one after it, loses its own. (A paragraph is its paragraph mark,
  as in Word: Enter in the middle of one leaves the handle on the text after the caret.) Undo
  does not bring a lost handle back: read again.
- Then: where the block is in a table (`r1 c1`), its paragraph style, its list number, `changed`
  when it holds tracked changes, how many comments are anchored in it.
- After the colon, the text. A line break inside a paragraph shows as `↵`. What is not text
  stands in brackets: `[picture]`, `[note]`, `[page break]`, `[empty: Offer date]` (a content
  control not filled in yet). Deleted text, hidden text and field codes are left out.
- `read({ from: "b40", limit: 50 })` reads a long document in parts; `next` is the handle to go
  on from. `session.block("b7")` gives one block. `blocks` has the same as data.

Every call returns a value: `{ ok: true, … }`, or `{ ok: false, code, message }` with a message
written for the model (`There is no block b99. Handles come from read: [b1], [b2]…`).

Not read: headers, footers, footnotes and endnotes.

## Editing

Every edit is a tracked change by the session's author. Each operation returns the blocks it
changed as they read now (`blocks`, and `text` in the read format), so there is no need to read
again.

```ts
session.replaceText("b25", "three (3) years", "five (5) years");
session.replaceText("b5", "Party", "Side", { all: true });
session.insertAfter("b11", ["A new clause.", { text: "Schedule", style: "Heading 1" }]);
session.insertBefore("b6", ["Recitals"]);
session.deleteBlock("b17");
session.setStyle("b21", "Heading 2");
session.comment("b25", "Why three years?", { on: "three (3) years" });
```

- **`replaceText(handle, find, replacement, { all })`**: `find` is text as `read` shows it,
  capitals and spaces included. It must be in the block exactly once, or `all` replaces every
  place. The replacement takes the formatting of what it replaces; `""` deletes. `↵` or `\n`
  is a line break. What `read` shows in brackets is not text and cannot be in `find`.
- **`insertAfter` / `insertBefore(handle, paragraphs)`**: one paragraph or a list, next to a
  paragraph, a table or anything else read. A new paragraph is formatted as Enter there gives
  in Word: as the paragraph next to it (style, numbering, indentation), or after a heading as
  body text. One that names a `style` (by the name `read` shows) has that style only. The block
  keeps its handle; the new ones come back with theirs.
- **`deleteBlock(handle)`**: a paragraph, or a table with all its cells. A paragraph that must
  stay is emptied instead, and the result says why: the last one of the document or of a cell,
  one before a table, one that ends a section.

- **`styles()`** lists the paragraph styles by the names `read` shows. **`setStyle(handle,
  style)`** puts a paragraph in one (by name or id, capitals do not count): a tracked
  formatting change, the paragraph's direct formatting kept.
- **`comment(handle, text, { on })`** comments a paragraph in the author's name: the whole
  block, or `on`, text that is in it once. A line break in `text` starts a new paragraph of the
  comment. Comments are not tracked changes: rejecting the session's changes leaves them.
  A locked content control takes comments, as in Word, and nothing else.

Refusals a model can act on: `no-match` (with the block's text), `several-matches` (with how
many), `unknown-style` (with the styles there are), `gone`, `unknown-handle`, `not-a-paragraph`,
`read-only` (a locked content control, content Foli does not edit), `invalid` (an argument of
the wrong kind), `refused` (the document would not take the change). No operation throws.
