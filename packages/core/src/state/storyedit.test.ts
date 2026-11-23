import { describe, expect, it } from "vitest";
import { FoliDocumentError, type NodeJSON } from "../model/index.js";
import { Step } from "../transform/steps.js";
import { createDocument, type FoliDocument, SCHEMA_VERSION } from "../v3/document.js";
import { createEditor, type Editor } from "./editor.js";
import { EditorState, type Transaction } from "./state.js";
import { StoryEditStep, wordContext, wordPlugin } from "./word.js";

const p = (text: string): NodeJSON => ({
  type: "paragraph",
  ...(text ? { content: [{ type: "text", text }] } : {}),
});

function documentOf(): FoliDocument {
  return {
    ...createDocument(),
    schemaVersion: SCHEMA_VERSION,
    section: { footers: { default: "f1" } },
    content: { type: "doc", content: [p("body")] },
    stories: { f1: { kind: "footer", content: { type: "doc", content: [p("foot")] } } },
  };
}

/** The steps `edit` makes in an editor of the document, as JSON. */
function stepsOf(edit: (editor: Editor) => void): unknown[] {
  const editor = createEditor({ document: documentOf() });
  const out: unknown[] = [];
  editor.subscribe((_state, transactions: readonly Transaction[]) => {
    for (const tr of transactions)
      for (const step of tr.steps) out.push(JSON.parse(JSON.stringify(step.toJSON())));
  });
  edit(editor);
  return out;
}

const footer = (state: EditorState) => wordContext(state)?.stories.get("f1")?.doc.textContent;

/** `first`'s steps, then `second`'s mapped over them, on a bare state of the document. */
function both(first: unknown[], second: unknown[]): string | undefined {
  const start = createEditor({ document: documentOf() }).state;
  const context = wordContext(start);
  if (!context) throw new Error("no word context");
  let state = EditorState.create({ doc: start.doc, plugins: [wordPlugin(context.envelope)] });
  const a = state.tr;
  for (const json of first) a.step(Step.fromJSON(state.schema, json));
  state = state.apply(a);
  const b = state.tr;
  for (const json of second) {
    const mapped = Step.fromJSON(state.schema, json).map(a.mapping);
    if (mapped) b.step(mapped);
  }
  state = state.apply(b);
  return footer(state);
}

describe("stories that merge (22.4)", () => {
  it("two edits in one footer, applied in either order, give the same footer", () => {
    const one = stepsOf((editor) => {
      const foot = editor.story("f1") as Editor;
      foot.select(1);
      foot.commands.insertText("AB");
    });
    const two = stepsOf((editor) => {
      const foot = editor.story("f1") as Editor;
      foot.select(5);
      foot.commands.insertText("Z");
      foot.select(3, 4);
      foot.commands.toggleMark("bold");
    });
    expect(one.map((s) => (s as { stepType: string }).stepType)).toEqual(["storyEdit"]);
    expect(both(one, two)).toBe("ABfootZ");
    expect(both(two, one)).toBe("ABfootZ");
  });

  it("maps the open story's caret over another editor's edit of it", () => {
    const editor = createEditor({ document: documentOf() });
    const foot = editor.story("f1") as Editor;
    foot.select(3);
    const remote = stepsOf((other) => {
      const f = other.story("f1") as Editor;
      f.select(1);
      f.commands.insertText("XY");
    });
    const tr = editor.state.tr.setMeta("addToHistory", false);
    for (const json of remote) tr.step(Step.fromJSON(editor.state.schema, json));
    editor.dispatch(tr);
    expect(foot.state.doc.textContent).toBe("XYfoot");
    expect(foot.state.selection.from).toBe(5);
    // Undo takes only this editor's change (none here) back.
    expect(editor.commands.undo()).toBe(false);
  });

  it("is refused when its steps do not apply to the story, and reads only a tree's steps", () => {
    const editor = createEditor({ document: documentOf() });
    const { schema } = editor.state;
    const doc = editor.state.doc;
    const bad = new StoryEditStep("f1", [
      Step.fromJSON(schema, { stepType: "replace", from: 90, to: 99 }),
    ]);
    editor.dispatch(editor.state.tr.step(bad));
    expect(editor.state.doc).toBe(doc);
    expect(footer(editor.state)).toBe("foot");
    for (const json of [
      { stepType: "storyEdit", id: "f1", steps: [] },
      { stepType: "storyEdit", id: "__proto__", steps: [{ stepType: "replace", from: 1, to: 1 }] },
      {
        stepType: "storyEdit",
        id: "f1",
        steps: [{ stepType: "envelope", key: "section", before: {}, after: {} }],
      },
    ])
      expect(() => Step.fromJSON(schema, json), JSON.stringify(json)).toThrow(FoliDocumentError);
  });
});
