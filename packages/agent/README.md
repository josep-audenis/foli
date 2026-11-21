# @folijs/agent

Agent editing for [Foli](https://github.com/josep-audenis/foli): a session over a document whose
edits are tracked changes in the agent's name, for a person to accept or reject in Foli or in
Word. No DOM and no Node built-ins: runs in Node, browsers, workers and sandboxes. Its only
dependency is `@folijs/core`, a peer at an exact version.

> **Unstable (0.x), unreleased.** In development (roadmap, Phase 13): reading is built, the
> editing operations are not yet. Outside the 1.0 promise of the other packages.

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
