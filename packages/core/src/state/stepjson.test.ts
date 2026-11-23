import { describe, expect, it } from "vitest";
import { FoliDocumentError, type NodeJSON } from "../model/index.js";
import { Step } from "../transform/steps.js";
import { createDocument, type FoliDocument, SCHEMA_VERSION } from "../v3/document.js";
import { addComment } from "./comments.js";
import { createEditor, type Editor } from "./editor.js";
import { setDifferentFirstPage } from "./sections.js";
import { EditorState, type Transaction } from "./state.js";
import { insertTable } from "./tablecommands.js";
import { documentJSON, wordContext, wordPlugin } from "./word.js";
import { setParagraphStyle } from "./wordformat.js";

const p = (text: string): NodeJSON => ({
  type: "paragraph",
  ...(text ? { content: [{ type: "text", text }] } : {}),
});

function documentOf(): FoliDocument {
  return {
    ...createDocument(),
    schemaVersion: SCHEMA_VERSION,
    section: { headers: { default: "h1" } },
    content: { type: "doc", content: [p("Hello world"), p("Second")] },
    stories: { h1: { kind: "header", content: { type: "doc", content: [p("head")] } } },
  };
}

/** Every step `editor` makes from now on, as JSON (through a string: what a network gives). */
function record(editor: Editor): unknown[] {
  const out: unknown[] = [];
  editor.subscribe((_state, transactions: readonly Transaction[]) => {
    for (const tr of transactions)
      for (const step of tr.steps) out.push(JSON.parse(JSON.stringify(step.toJSON())));
  });
  return out;
}

describe("steps as JSON", () => {
  it("replays an editor's edits on a second state: the same document", () => {
    const editor = createEditor({ document: documentOf(), author: "Ann" });
    const start = editor.state;
    const steps = record(editor);
    editor.select(7, 12);
    editor.commands.toggleMark("bold");
    editor.run(addComment("A note"));
    editor.select(3);
    editor.commands.insertText("XY");
    editor.run(setParagraphStyle("Heading1"));
    editor.select(editor.state.doc.content.size - 1);
    editor.run(insertTable(2, 2));
    const head = editor.story("h1") as Editor;
    head.select(3);
    head.commands.insertText("er");
    editor.run(setDifferentFirstPage(true));
    editor.commands.undo();
    editor.commands.redo();
    expect(steps.length).toBeGreaterThan(5);

    const context = wordContext(start);
    if (!context) throw new Error("no word context");
    let state = EditorState.create({ doc: start.doc, plugins: [wordPlugin(context.envelope)] });
    const tr = state.tr;
    for (const json of steps) {
      const step = Step.fromJSON(state.schema, json);
      const again = JSON.parse(JSON.stringify(step.toJSON()));
      expect(Step.fromJSON(state.schema, again).toJSON()).toEqual(again);
      tr.step(step);
    }
    state = state.apply(tr);
    const replayed = documentJSON(wordContext(state)?.envelope ?? context.envelope, state.doc);
    const made = editor.getDocument();
    // shortcut: styles and numbering change through `withEnvelope`, not steps, until 22.3.
    for (const key of ["content", "comments", "stories", "section", "settings"] as const)
      expect(replayed[key], key).toEqual(made[key]);
  });

  it("refuses what is not a step of this schema", () => {
    const { schema } = createEditor().state;
    const bad: unknown[] = [
      null,
      [],
      { stepType: "nope" },
      { stepType: "replace", from: -1, to: 0 },
      { stepType: "replace", from: 2, to: 1 },
      { stepType: "replace", from: 0, to: 0, extra: 1 },
      { stepType: "replace", from: 0, to: 0, slice: { content: [{ type: "nope" }] } },
      { stepType: "replace", from: 0.5, to: 1 },
      { stepType: "replace", from: 0, to: 0, structure: "yes" },
      { stepType: "addMark", from: 0, to: 1, mark: { type: "nope" } },
      { stepType: "addMark", from: 1, to: 1, mark: { type: "bold" } },
      { stepType: "nodeMarkup", pos: 0, type: "paragraph", attrs: { nope: 1 } },
      { stepType: "nodeMarkup", pos: 0, type: "text", attrs: null },
      { stepType: "nodeMarkupBatch", steps: [] },
      { stepType: "replaceAround", from: 0, to: 2, gapFrom: 1, gapTo: 1, insert: 3 },
      { stepType: "comment", id: 1, comment: null, previous: null, index: 0 },
      {
        stepType: "comment",
        id: 1,
        comment: { id: 2, author: "a", content: [] },
        previous: null,
        index: 0,
      },
      { stepType: "comment", id: 1, comment: { id: 1, author: "a" }, previous: null, index: 0 },
      { stepType: "envelope", key: "styles", before: [], after: [] },
      { stepType: "envelope", key: "section", before: {}, after: { nope: 1 } },
      { stepType: "story", id: "h", before: null, after: null },
      {
        stepType: "story",
        id: "__proto__",
        before: null,
        after: { kind: "header", content: { type: "doc", content: [p("x")] } },
      },
      { stepType: "story", id: "h", before: null, after: { kind: "header", content: {} } },
      {
        stepType: "story",
        id: "h",
        before: null,
        after: { kind: "header", content: { type: "doc", content: [p("x")] } },
        selectionAfter: { type: "text", anchor: -1, head: 0 },
      },
    ];
    for (const json of bad)
      expect(() => Step.fromJSON(schema, json), JSON.stringify(json)).toThrow(FoliDocumentError);
  });

  it("reads a gap replace's unfilled wrapper, checking everything else", () => {
    const editor = createEditor({ document: documentOf() });
    const { schema, doc } = editor.state;
    const around = (content: NodeJSON[]) => ({
      stepType: "replaceAround",
      from: 0,
      to: doc.firstChild?.nodeSize,
      gapFrom: 0,
      gapTo: doc.firstChild?.nodeSize,
      insert: 1,
      slice: { content, openStart: 0, openEnd: 0 },
    });
    // A table around a paragraph: read (the gap is the table's), refused when applied.
    const table = Step.fromJSON(schema, around([{ type: "table" }]));
    expect(table.apply(doc).failed).toBeTruthy();
    // An empty table beside the gap's holder is no slice of this schema.
    expect(() => Step.fromJSON(schema, around([{ type: "table" }, { type: "table" }]))).toThrow(
      FoliDocumentError,
    );
  });

  it("keeps what Foli does not model: verbatim XML, attributes, opaque and foreign content", () => {
    const { schema } = createEditor().state;
    const json = {
      stepType: "replace",
      from: 1,
      to: 1,
      slice: {
        content: [
          {
            type: "paragraph",
            attrs: { ext: "<w:pPr><w:kinsoku/></w:pPr>" },
            content: [
              {
                type: "text",
                text: "x",
                marks: [{ type: "foreign", attrs: { type: "acme:tag", attrs: { a: 1 } } }],
              },
            ],
          },
          { type: "opaqueBlock", attrs: { xml: "<w:customXml/>" } },
        ],
        openStart: 0,
        openEnd: 0,
      },
    };
    const step = Step.fromJSON(schema, json);
    expect(JSON.parse(JSON.stringify(step.toJSON()))).toEqual(
      JSON.parse(JSON.stringify(Step.fromJSON(schema, step.toJSON()).toJSON())),
    );
    expect(JSON.stringify(step.toJSON())).toContain("w:kinsoku");
    expect(JSON.stringify(step.toJSON())).toContain("acme:tag");
    expect(JSON.stringify(step.toJSON())).toContain("w:customXml");
    // A slice of size 0 that holds content (two open ends) keeps it.
    const closed = Step.fromJSON(schema, {
      stepType: "replace",
      from: 1,
      to: 1,
      slice: { content: [{ type: "paragraph" }, { type: "paragraph" }], openStart: 1, openEnd: 1 },
    });
    expect(closed.toJSON().slice).toBeDefined();
  });

  it("refuses a step type registered twice", () => {
    expect(() => Step.jsonID("replace", () => Step.fromJSON(null as never, null))).toThrow(
      RangeError,
    );
  });
});
