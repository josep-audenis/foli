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
  return seed.getDocument();
}

/** Each transaction `editor` makes from now on, its steps as JSON. */
function record(editor: Editor): unknown[][] {
  const out: unknown[][] = [];
  editor.subscribe((_state, transactions: readonly Transaction[]) => {
    for (const tr of transactions)
      if (tr.steps.length) out.push(tr.steps.map((s) => JSON.parse(JSON.stringify(s.toJSON()))));
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
    // A control's value: its placeholder replaced, which the filter lets only its command do.
    expect(a.run(setControlValue("t", "Filled"))).toBe(true);
    a.select(2, 4);
    a.commands.insertText("Z");
    expect(sent.length).toBeGreaterThan(5);

    const depth = undoDepth(b.state);
    for (const steps of sent) {
      const tr = b.state.tr.setMeta(remote, true);
      for (const json of steps) tr.step(Step.fromJSON(b.state.schema, json));
      b.dispatch(tr);
    }
    expect(b.getDocument()).toEqual(a.getDocument());
    // Nothing of it is Bob's to undo, nor tracked again in his name.
    expect(undoDepth(b.state)).toBe(depth);
    expect(JSON.stringify(b.getDocument().content)).not.toContain("Bob");
  });
});
