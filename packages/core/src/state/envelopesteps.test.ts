import { describe, expect, it } from "vitest";
import type { NodeJSON } from "../model/index.js";
import { Step } from "../transform/steps.js";
import {
  createDocument,
  type FoliDocument,
  parseDocument,
  SCHEMA_VERSION,
} from "../v3/document.js";
import { insertControl } from "./controls.js";
import { createEditor, type Editor } from "./editor.js";
import { insertTableOfContents } from "./fieldupdate.js";
import { insertNote } from "./notes.js";
import { insertPicture } from "./pictures.js";
import { type Command, EditorState, type Transaction } from "./state.js";
import { insertTable } from "./tablecommands.js";
import {
  documentJSON,
  EnvelopeStep,
  merge3,
  withEnvelope,
  wordContext,
  wordPlugin,
} from "./word.js";

const p = (text: string, style?: string): NodeJSON => ({
  type: "paragraph",
  ...(style ? { attrs: { style } } : {}),
  ...(text ? { content: [{ type: "text", text }] } : {}),
});

function documentOf(): FoliDocument {
  return {
    ...createDocument(),
    schemaVersion: SCHEMA_VERSION,
    section: { headers: { default: "h1" } },
    content: {
      type: "doc",
      content: [p("Title", "Heading1"), p("Hello world"), p("Second")],
    },
    stories: { h1: { kind: "header", content: { type: "doc", content: [p("head")] } } },
  };
}

/** Runs `edit` on a fresh editor: its steps through JSON on a bare state, and undo. */
function check(edit: (editor: Editor) => unknown): { editor: Editor; replayed: FoliDocument } {
  const editor = createEditor({ document: documentOf(), author: "Ann" });
  const start = editor.state;
  const original = editor.getDocument();
  const steps: unknown[] = [];
  editor.subscribe((_state, transactions: readonly Transaction[]) => {
    for (const tr of transactions)
      for (const step of tr.steps) steps.push(JSON.parse(JSON.stringify(step.toJSON())));
  });
  editor.select(9);
  edit(editor);
  const made = editor.getDocument();
  expect(made).not.toEqual(original);
  const context = wordContext(start);
  if (!context) throw new Error("no word context");
  let state = EditorState.create({ doc: start.doc, plugins: [wordPlugin(context.envelope)] });
  const tr = state.tr;
  for (const json of steps) tr.step(Step.fromJSON(state.schema, json));
  state = state.apply(tr);
  const replayed = documentJSON(wordContext(state)?.envelope ?? context.envelope, state.doc);
  expect(replayed).toEqual(made);
  // Undo takes the envelope back with the edit.
  while (editor.commands.undo()) {}
  expect(editor.getDocument()).toEqual(original);
  return { editor, replayed };
}

const run = (command: Command) => (editor: Editor) => editor.run(command);

describe("envelope changes are steps (22.3)", () => {
  it.each<[string, (editor: Editor) => unknown]>([
    ["a list's numbering (wordformat)", (e) => e.commands.toggleList("bulletList")],
    ["a table's style (tablecommands)", run(insertTable(2, 2))],
    ["a note's styles and story (notes)", run(insertNote("footnote"))],
    [
      "a picture's resource (pictures)",
      run(
        insertPicture({
          contentType: "image/png",
          url: "https://x.test/a.png",
          width: 10,
          height: 10,
          alt: "A",
        }),
      ),
    ],
    ["a control's properties (controls)", run(insertControl("text"))],
    ["a table of contents' styles (fieldupdate)", run(insertTableOfContents())],
    [
      "a story's style (stories)",
      (e) => {
        const head = e.story("h1") as Editor;
        head.select(3);
        head.commands.toggleList("orderedList");
      },
    ],
  ])("%s: travels as JSON, undone with its edit", (_name, edit) => {
    check(edit);
  });

  it("makes one step per changed entry, keeping the order of keys", () => {
    const editor = createEditor({ document: documentOf() });
    const envelope = wordContext(editor.state)?.envelope;
    if (!envelope) throw new Error("no envelope");
    const styles = envelope.styles.map((s) => (s.id === "Heading1" ? { ...s, name: "H" } : s));
    const tr = withEnvelope(editor.state.tr, {
      ...envelope,
      styles: [...styles, { id: "New", type: "paragraph", name: "New" }],
    });
    const steps = tr.steps as EnvelopeStep[];
    expect(steps.map((s) => [s.key, s.path])).toEqual([
      ["styles", ["Heading1"]],
      ["styles", ["New"]],
    ]);
    editor.dispatch(tr);
    const after = editor.getDocument();
    expect(Object.keys(after)).toEqual(Object.keys(documentJSON(envelope, editor.state.doc)));
    expect(after.styles.map((s) => s.id).slice(-1)).toEqual(["New"]);
  });

  it("refuses a transaction whose envelope step no longer finds its before", () => {
    const editor = createEditor({ document: documentOf() });
    const doc = editor.state.doc;
    editor.dispatch(
      editor.state.tr.step(new EnvelopeStep("settings", true, false, ["evenAndOddHeaders"])),
    );
    expect(editor.state.doc).toBe(doc);
    expect(editor.getDocument().settings?.evenAndOddHeaders).toBeUndefined();
  });

  it("merges a change made from a stale value: each side's, mine where both changed", () => {
    const base = { a: 1, b: [{ id: "x", v: 1 }], c: 1 };
    const mine = { a: 2, b: [{ id: "x", v: 2 }], c: 1 };
    const theirs = {
      a: 1,
      b: [
        { id: "x", v: 3 },
        { id: "y", v: 1 },
      ],
      c: 5,
    };
    expect(merge3(base, mine, theirs)).toEqual({
      a: 2,
      b: [
        { id: "x", v: 2 },
        { id: "y", v: 1 },
      ],
      c: 5,
    });
    const step = new EnvelopeStep("settings", false, true, ["evenAndOddHeaders"]);
    const envelope = wordContext(createEditor({ document: documentOf() }).state)?.envelope;
    if (!envelope) throw new Error("no envelope");
    expect(step.rebase(envelope)).toMatchObject({ before: undefined, after: true });
  });
});

describe("the tracking switch is the document's (22.3)", () => {
  it("is a setting, kept out of undo, read when the document is opened again", () => {
    const editor = createEditor({ document: documentOf(), author: "Ann" });
    expect(editor.getDocument().schemaVersion).toBe(5);
    editor.commands.setTrackChanges(true);
    const saved = editor.getDocument();
    expect(saved.settings?.trackRevisions).toBe(true);
    expect(saved.schemaVersion).toBe(7);
    expect(editor.commands.undo()).toBe(false);
    const again = createEditor({ document: parseDocument(saved) });
    expect(again.trackingChanges).toBe(true);
    again.commands.setTrackChanges(false);
    expect(again.trackingChanges).toBe(false);
    expect(again.getDocument().settings?.trackRevisions).toBe(false);
  });

  it("is refused in a document that says it is of an earlier schema", () => {
    const doc = { ...documentOf(), schemaVersion: 6, settings: { trackRevisions: true } };
    expect(() => parseDocument(doc)).toThrow(/trackRevisions: is of schema 7/);
  });
});
