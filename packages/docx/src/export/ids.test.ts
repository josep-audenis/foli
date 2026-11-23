import {
  createDocument,
  createEditor,
  type Editor,
  EditorState,
  type FoliDocument,
  type NodeJSON,
  SCHEMA_VERSION,
  Step,
  type Transaction,
} from "@folijs/core";
import { documentJSON, idSlotPlugin, wordContext } from "@folijs/core/internal";
import { describe, expect, it } from "vitest";
import { exportDocx, readPackage } from "../index.js";

const p = (text: string): NodeJSON => ({
  type: "paragraph",
  ...(text ? { content: [{ type: "text", text }] } : {}),
});

function documentOf(): FoliDocument {
  return {
    ...createDocument(),
    schemaVersion: SCHEMA_VERSION,
    content: { type: "doc", content: [p("One two three"), p("Four five six")] },
  };
}

/** An editor in `clientID`'s id class, tracking changes, and the steps it makes (as JSON). */
function client(clientID: number): { editor: Editor; steps: unknown[] } {
  const editor = createEditor({
    document: documentOf(),
    author: `Client ${clientID}`,
    trackChanges: true,
    plugins: [idSlotPlugin(clientID)],
  });
  const steps: unknown[] = [];
  editor.subscribe((_state, transactions: readonly Transaction[]) => {
    for (const tr of transactions)
      for (const step of tr.steps) steps.push(JSON.parse(JSON.stringify(step.toJSON())));
  });
  return { editor, steps };
}

const ids = (xml: string, element: string) =>
  [...xml.matchAll(new RegExp(`<w:${element} w:id="([0-9]+)"`, "g"))].map((m) => m[1]);

describe("ids unique across clients (22.5)", () => {
  it("two editors tracking changes at once, exported, have unique w:ids", async () => {
    const a = client(1);
    const b = client(2);
    for (const { editor } of [a, b]) {
      editor.select(5, 8);
      editor.commands.insertText("X");
      editor.select(18);
      editor.commands.insertText("Y");
      editor.select(2, 4);
      editor.commands.addComment("Why?");
    }
    // A's steps, then B's mapped over them: what an authority would order.
    const start = createEditor({ document: documentOf() }).state;
    const context = wordContext(start);
    if (!context) throw new Error("no word context");
    let state = EditorState.create({ doc: start.doc, plugins: start.plugins });
    const first = state.tr.setMeta("addToHistory", false);
    for (const json of a.steps) first.step(Step.fromJSON(state.schema, json));
    state = state.apply(first);
    const second = state.tr.setMeta("addToHistory", false);
    for (const json of b.steps) {
      const step = Step.fromJSON(state.schema, json).map(first.mapping);
      if (step) second.step(step);
    }
    state = state.apply(second);
    const document = documentJSON(wordContext(state)?.envelope ?? context.envelope, state.doc);
    const bytes = await exportDocx(document);
    const xml = (await readPackage(bytes)).text("/word/document.xml");
    const revisions = [...ids(xml, "ins"), ...ids(xml, "del")];
    expect(revisions.length).toBeGreaterThanOrEqual(5);
    expect(new Set(revisions).size).toBe(revisions.length);
    const comments = document.comments.map((c) => c.id);
    expect(comments).toHaveLength(2);
    expect(new Set(comments).size).toBe(2);
  });

  it("leaves a single editor's ids as they were", () => {
    const editor = createEditor({ document: documentOf(), trackChanges: true, author: "A" });
    editor.select(5);
    editor.commands.insertText("X");
    editor.select(7);
    editor.commands.addComment("c");
    expect(JSON.stringify(editor.getDocument().content)).toContain('"id":0');
    expect(editor.getDocument().comments[0]?.id).toBe(0);
  });
});
