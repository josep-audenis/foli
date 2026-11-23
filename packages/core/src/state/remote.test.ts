import { describe, expect, it } from "vitest";
import type { NodeJSON } from "../model/index.js";
import { Step } from "../transform/steps.js";
import { createDocument, type FoliDocument, SCHEMA_VERSION } from "../v3/document.js";
import { insertControl, setControlValue } from "./controls.js";
import { createEditor, type Editor } from "./editor.js";
import { undoDepth } from "./history.js";
import { insertNote } from "./notes.js";
import { remote, type Transaction } from "./state.js";

const p = (text: string): NodeJSON => ({
  type: "paragraph",
  ...(text ? { content: [{ type: "text", text }] } : {}),
});

/** A document with a text control (tag `t`), as two editors open it. */
function documentOf(): FoliDocument {
  const seed = createEditor({
    document: {
      ...createDocument(),
      schemaVersion: SCHEMA_VERSION,
      content: { type: "doc", content: [p("Hello world, and more"), p("Second")] },
    },
  });
  seed.select(24);
  seed.run(insertControl("text", { tag: "t" }));
  seed.select(seed.state.doc.content.size - 1);
  seed.run(insertControl("checkbox", { tag: "c" }));
  return seed.getDocument();
}

/** What `editor` dispatches from now on: each batch's steps (root and appended) as JSON, and the document after it. */
function record(editor: Editor): { steps: unknown[][]; document: FoliDocument }[] {
  const out: { steps: unknown[][]; document: FoliDocument }[] = [];
  editor.subscribe((_state, transactions: readonly Transaction[]) => {
    const steps = transactions
      .map((tr) => tr.steps.map((s) => JSON.parse(JSON.stringify(s.toJSON()))))
      .filter((list) => list.length);
    if (steps.length) out.push({ steps, document: editor.getDocument() });
  });
  return out;
}

describe("received transactions are applied as they are (22.6)", () => {
  it("two editors stay identical after edits each plugin and filter reacts to, tracking on", () => {
    const document = documentOf();
    const a = createEditor({ document, author: "Ann", trackChanges: true });
    const b = createEditor({ document, author: "Bob", trackChanges: true });
    const sent = record(a);
    // The comments plugin removes a comment whose text is deleted (untracked, so it goes).
    a.commands.setTrackChanges(false);
    a.select(7, 12);
    a.commands.addComment("note");
    a.select(6, 14);
    a.commands.deleteSelection();
    a.commands.setTrackChanges(true);
    // The notes plugin follows a note's reference, tracked.
    a.select(3);
    a.run(insertNote("footnote"));
    // Deleting the reference, tracked: the notes plugin marks the note deleted with it.
    a.select(3, 5);
    a.commands.deleteSelection();
    // A control's value: its placeholder replaced, which the filter lets only its command do;
    // a check box's glyph, which no other edit may change.
    expect(a.run(setControlValue("t", "Filled"))).toBe(true);
    expect(a.run(setControlValue("c", true))).toBe(true);
    a.select(2, 4);
    a.commands.insertText("Z");
    expect(sent.length).toBeGreaterThan(5);

    const depth = undoDepth(b.state);
    for (const { steps: transactions, document: expected } of sent) {
      // Each of Ann's transactions apart, her plugins' appended ones too: Bob's plugins, had they
      // appended their own, would make hers no longer apply.
      for (const steps of transactions) {
        const before = b.state;
        const tr = b.state.tr.setMeta(remote, true);
        for (const json of steps) tr.step(Step.fromJSON(b.state.schema, json));
        b.dispatch(tr);
        expect(b.state).not.toBe(before);
      }
      expect(b.getDocument()).toEqual(expected);
    }
    expect(b.getDocument()).toEqual(a.getDocument());
    // Nothing of it is Bob's to undo, nor tracked again in his name.
    expect(undoDepth(b.state)).toBe(depth);
    expect(JSON.stringify(b.getDocument().content)).not.toContain("Bob");
  });
});
