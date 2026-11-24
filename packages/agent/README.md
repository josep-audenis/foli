# @folijs/agent

Agent editing for [Foli](https://github.com/josep-audenis/foli): a session over a document whose
edits are tracked changes in the agent's name, for a person to accept or reject in Foli or in
Word. No DOM and no Node built-ins: runs in Node, browsers, workers and sandboxes. Its only
dependency is `@folijs/core`, a peer at an exact version.

> **Unstable (0.x).** Outside the 1.0 promise of the other packages: its API may change in any
> 0.x release. Changes in `CHANGELOG.md`. `npm install @folijs/agent @folijs/core`
> (and `@folijs/docx` to read and write `.docx`, as below).

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
- Then: where the block is in a table (`r1 c1`: row and grid column; `c1-2` a cell spanning two
  grid columns; `merged down` / `merged up` a vertical merge, its text in the top cell), its
  paragraph style, its list number, `changed`
  when it holds tracked changes, how many comments are anchored in it.
- After the colon, the text. A line break inside a paragraph shows as `↵`. What is not text
  stands in brackets: `[picture]`, `[note]`, `[page break]`, `[empty: Offer date]` (a content
  control not filled in yet). Deleted text, hidden text and field codes are left out.
- `read({ from: "b40", limit: 50 })` reads a long document in parts; `next` is the handle to go
  on from. `session.block("b7")` gives one block. `blocks` has the same as data.

`read`, `block` and every operation return a value: `{ ok: true, … }`, or
`{ ok: false, code, message }` with a message written for the model (`There is no block b99.
Handles come from read: [b1], [b2]…`). `styles()`, `controls()` and `document()` return theirs
bare. Only `openSession` throws: on a document that does not validate, or an empty author.

Headers and footers are read with `read({ headers: true })` (below); the text of footnotes and endnotes is not read.

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
  is a line break. What `read` shows in brackets is not text and cannot be in `find`. Find
  looks through soft hyphens and zero-width spaces and takes a non-breaking hyphen as `-`; a
  refusal quotes invisible and look-alike characters escaped (`\u2011`).
- **`insertAfter` / `insertBefore(handle, paragraphs)`**: one paragraph or a list, next to a
  paragraph, a table or anything else read. A new paragraph is formatted as Enter there gives
  in Word: as the paragraph next to it (style, numbering, indentation), or after a heading as
  body text. One that names a `style` (by the name `read` shows) has that style only. The block
  keeps its handle; the new ones come back with theirs.
- **`deleteBlock(handle)`**: a paragraph, or a table with all its cells. It returns a sentence,
  not blocks. A paragraph that must stay is emptied instead, and the result says why: the last
  one of the document or of a cell, one before a table or other block that is not a paragraph,
  one that ends a section. Already empty, it is refused. A paragraph the session inserted
  itself goes for real.

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
the wrong kind), `refused` (the document would not take the change). No method of a session
throws.

## Formatting

`formatText` changes a paragraph's text, or `on` text in it (`all`: every place it is), as a
tracked formatting change; what `format` leaves out stays. `read({ formatting: true })` adds a
line under each paragraph with the formatting its text has of its own.

```ts
session.formatText("b7", { bold: true, color: "1F3864" }, { on: "Total due" });
session.formatText("b7", { size: 14, font: "Arial" }); // the whole paragraph
session.formatText("b7", { link: "https://example.com" }, { on: "our site" }); // null: off
session.formatText("b7", { highlight: "yellow" }, { on: "TBD", all: true });
// [b7] Normal, changed: Total due: 40.
//        formatting: bold, color 1F3864: "Total due"
```

`formatParagraphs` formats paragraphs: one handle, or several (those next to each other become
one list). `read({ formatting: true })` starts a paragraph's line with its own properties.

```ts
session.formatParagraphs("b2", { align: "center", spaceAfter: 12 });
session.formatParagraphs(["b5", "b6", "b7"], { list: "numbered" }); // null: no numbering
session.formatParagraphs("b6", { indent: "more" }); // in a list: a level deeper
// [b2] Title, changed: Prices
//        formatting: paragraph centered, space after 12 pt
```

## Headers and footers

`read({ headers: true })` adds the headers and footers after the body, each under a line saying
where it is used. Their blocks' handles are `h1`…, `f1`…, and every operation takes them (but
`comment`: Word keeps no comments there).

```ts
session.read({ headers: true });
// …
// header of sections 1–2:
// [h1] header: Quarterly Board Report - Q1 2026
// footer of sections 1–2:
// [f1] footer: Page 1 of 3
session.replaceText("h1", "Q1 2026", "Q2 2026");
```

## Review

A session opened with `review: true` may decide the document's tracked changes, its own and
others', as a person does in Word; without it, these refuse (an agent's edits are proposals).

```ts
const session = openSession(document, { author: "Reviewer", review: true });
session.changes();
// [c12] inserted, Bob (2026-11-20), in [b7]: "net 30 days"
// [c13] deleted, Bob (2026-11-20), in [b7]: "net 60 days"
session.acceptChanges([12, 13]);
session.rejectChanges("all", { author: "Bob" }); // every story too
```

## Pictures, breaks and notes

`insertItem` inserts what is not text next to or in a paragraph, as tracked insertions: a
picture or a horizontal line as a paragraph of its own, a page or section break at the
paragraph's end (or start), a footnote or endnote at its end or after `on` text.

```ts
session.insertItem("b4", { kind: "picture", data: bytes, alt: "Sales by region" }); // fitted to the page
session.insertItem("b4", { kind: "pageBreak" });
session.insertItem("b9", { kind: "sectionBreak", start: "continuous" });
session.insertItem("b9", { kind: "footnote", text: "Source: 2025 accounts.", on: "revenue" });
```

The tools take a picture by path: `agentTools(session, { picture(path) { … } })` gives them its
bytes (the MCP server reads it under its root); without it, pictures are refused.

## Tables

A table is named by its handle (its `table, 3 rows, 2 columns` line), or by a paragraph's in one
of its cells; rows and columns are numbered as `read` prints them (`r2 c1`: rows as with every
change accepted, grid columns; a merged cell by its top cell). Each returns the table as it
reads now.

```ts
session.insertTable(
  "b4",
  [
    ["Item", "Price"],
    ["Tea", "3.50"],
  ],
  { header: true },
); // after b4
session.insertRows("b9", 2, [["Cake", "2.00"]]); // after row 2; "before" as a 4th argument
session.deleteRows("b9", [3]);
session.setCells("b9", [{ row: 2, column: 2, text: "4.00" }]);
session.setTableStyle("b9", "Light List"); // session.tableStyles() lists them; null: none
session.shadeCells("b9", "D9E2F3", { row: 1 }); // a row, a column, a cell, or the table
session.setHeaderRows("b9", 1);
```

An operation of several edits (rows, cells, a new table) is all or nothing: one that is
refused partway takes back what it did. In a vertical merge, a new row's cell the merge goes on
through takes no text (give `""`: the text is the merge's top cell's); a row whose every cell is
merged, and a merge's first row without the rows it covers, are refused.
Adding or deleting columns, merging or splitting cells and column widths are not offered: they
cannot be recorded as tracked changes. The `edit_table` tool says so, with what to do instead.

## Templates

A template's blanks are Word's content controls and merge fields. A read shows an unfilled
control as `[empty: Offer date]` and a merge field as `«CandidateFirstName»`.

```ts
session.controls();
// [{ id: "/word/document.xml#0", name: "offer_date", tag: "offer_date", title: "Offer date",
//    kind: "date", value: null, empty: true, readOnly: false, block: "b2" },
//  { name: "position", kind: "dropDown", items: ["Data Engineer", "Senior Data Engineer"], … }]
session.fillControl("offer_date", "2026-12-01");
session.fillControl("position", "Senior Data Engineer");
session.fillControl("remote", true);
session.updateFields({ data: { CandidateFirstName: "Ada" } });
```

- **`controls()`**: the body's content controls with their values, and the handle of the block
  each is in. Not those in a block deleted as a tracked change.
- **`fillControl(name, value)`**: the control with that `id`, else every control with that tag,
  else with that title. Text for a text control, one of its items for a drop-down list, a day
  as `yyyy-mm-dd` for a date (any other text is kept as typed, as Word does), true or false for
  a check box; `null` empties it (not a check box). Refused with what would work: the controls there are, a
  list's items, `read-only` for a locked control. When controls share the name and only some
  take the value, the result is ok and `unfilled` says which did not and why.
- **`updateFields({ data, contents })`**: updates the document's fields (dates,
  cross-references) and fills its merge fields from `data`, by name, capitals not counting.
  `text` says what was left as it was: merge fields without data, and page numbers, which need
  a page layout the session does not have. A table of contents is left as it is unless
  `contents` is true: built here, its entries follow the headings and their page numbers are
  empty until Word updates the field. It returns no blocks: read again.
- **`target(handle)`**: where a block's content is in `session.editor`, as a `DocumentTarget`:
  what core's `hint` and `goTo` take, to show an agent's change in a view of that editor.
- **`checkpoint()`**: marks the document as it is. `rollback()` on what it returns takes back
  every edit made since, as if none had been: no tracked change is left of them and every
  handle names the block it named; a style they added to the document is gone, and undo is
  as it was at the checkpoint. `release()` keeps them. One or the other, once. For a batch of
  operations that must all be done or none.
- One `insertAfter` or `insertBefore` takes 500 paragraphs at most, and one `replaceText` with
  `all` 500 places; one replace, fill or `updateFields` writes 300,000 characters at
  most, its places together (for `updateFields`, what the fields' results hold, counted as they
  are worked out): more is refused, to be done in parts.

## For the model

The session is a library: an app gives its operations to a model as tools. The tools come with
the package, with the words a model reads (names, descriptions, JSON Schemas): an app that runs
its own model loop writes no schema of its own (ADR-0013).

```ts
import { agentTools, INSTRUCTIONS, openSession } from "@folijs/agent";

const session = openSession(document, { author: "Agent" });
const tools = agentTools(session);
// Give the model INSTRUCTIONS (a system prompt's part) and, for each tool, its name,
// description and inputSchema. Pass each call it makes to the tool's run:
const answer = tools.find((t) => t.name === call.name)?.run(call.arguments);
// answer.text goes back to the model; answer.isError marks a refusal it can act on.
```

`run` checks the arguments against the schema and answers in words when they do not fit.
`AGENT_TOOLS` are the same tools over any session (`run(session, args)`), for an app that holds
several: check a call's arguments with `invalid(args, tool.inputSchema)` first, as `agentTools`
does. Limits on how much a model may add are the app's (the MCP server has its own). `@folijs/mcp` serves these tools to MCP clients, over `.docx` files in a folder, and
its code mode gives a script the same operations.

## Showing what changed

In an app, the person sees the session's editor: give `session.editor` to `FoliCanvas` (or to
an `EditorView`). Once it is shown, core's `hint` marks a block the agent changed for a few
seconds, without moving the caret, from the handles the operations return. A new hint
replaces the one showing, so several changes are shown one after the other:

```tsx
import { hint } from "@folijs/core";
import { FoliCanvas } from "@folijs/react";

<FoliCanvas editor={session.editor} />;

// Later, once the canvas is on the page (before that, `hint` is false):
const result = session.replaceText("b12", "30 days", "45 days");
if (result.ok)
  result.blocks.forEach((block, i) => {
    const where = session.target(block.handle);
    if (where.ok) setTimeout(() => hint(session.editor, where.target, { ms: 2500 }), i * 3000);
  });
```

## Limits

Unstable: the API may change in any 0.x release. What is not there yet, and what rejecting the
agent's changes does not bring back exactly:
[limitations](https://github.com/josep-audenis/foli/blob/main/docs/limitations.md#agent-editing-folijsagent).
