import { describe, expect, it } from "vitest";
import { FoliDocumentError, Fragment, type NodeJSON, Slice } from "../model/index.js";
import { createEditor, type Editor } from "../state/editor.js";
import { findAll, replaceAll } from "../state/find.js";
import { acceptAllChanges, rejectAllChanges } from "../state/review.js";
import { NodeSelection, TextSelection } from "../state/selection.js";
import { type Command, Plugin, PluginKey } from "../state/state.js";
import { fitPaste } from "../state/wordclip.js";
import { createDocument, type FoliDocument, parseDocument } from "./document.js";
import { type Extension, foreignTextOf, withForeignText } from "./extensions.js";

const id = (v: unknown) => (typeof v === "string" && /^[\w-]{1,64}$/.test(v) ? undefined : "id");
const seen = new PluginKey("acme");
const acme: Extension = {
  name: "acme",
  nodes: {
    "acme:mention": {
      inline: true,
      attrs: { id: { validate: id }, label: { default: "" } },
      text: (attrs) => `@${String(attrs.label)}`,
    },
    "acme:card": { attrs: { id: { validate: id } }, text: (attrs) => `Card ${String(attrs.id)}` },
  },
  marks: { "acme:topic": { attrs: { topic: { validate: id } }, inclusive: false } },
  plugins: [new Plugin({ key: seen, state: { init: () => true, apply: (_tr, v) => v } })],
};

const mention = (label: string, marks?: NodeJSON["marks"]): NodeJSON => ({
  type: "acme:mention",
  attrs: { id: "u-1", label },
  ...(marks ? { marks } : {}),
});
const topic = { type: "acme:topic", attrs: { topic: "finance" } };
const sample = (): FoliDocument =>
  createDocument({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Ask " },
          mention("Ada", [{ type: "bold" }]),
          { type: "text", text: " about the " },
          { type: "text", text: "budget", marks: [topic] },
        ],
      },
      { type: "acme:card", attrs: { id: "c-9" } },
      { type: "paragraph" },
    ],
  });
const editorOf = (document: FoliDocument, extensions?: Extension[]): Editor =>
  createEditor({ document, ...(extensions ? { extensions } : {}) });
const inline = (editor: Editor) => editor.getDocument().content.content?.[0]?.content;

describe("custom nodes and marks (ADR-0008)", () => {
  it("are validated by their extension and saved as they were", () => {
    expect(parseDocument(sample(), { extensions: [acme] }).content).toEqual(sample().content);
    const editor = editorOf(sample(), [acme]);
    expect(editor.getDocument().content).toEqual(sample().content);
    expect(seen.getState(editor.state)).toBe(true);
    const bad = createDocument({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "acme:mention", attrs: { id: "a b" } }] }],
    });
    expect(() => parseDocument(bad, { extensions: [acme] })).toThrow(FoliDocumentError);
    expect(() => editorOf(bad, [acme])).toThrow(/content\.content\[0\]\.content\[0\]\.attrs\.id/);
  });

  it("refuses names that are not namespaced, taken twice, or containers", () => {
    const text = () => "";
    expect(() =>
      createEditor({ extensions: [{ name: "x", nodes: { mention: { text } } }] }),
    ).toThrow(/not a namespaced type/);
    expect(() => createEditor({ extensions: [{ name: "x", marks: { "Acme:x": {} } }] })).toThrow(
      /not a namespaced type/,
    );
    expect(() => createEditor({ extensions: [acme, { ...acme, plugins: [] }] })).toThrow(
      /declared twice/,
    );
    const container = { content: "inline*", text } as never;
    expect(() =>
      createEditor({ extensions: [{ name: "x", nodes: { "x:box": container } }] }),
    ).toThrow(/must be a leaf/);
  });

  it("are kept as foreign nodes and marks without their extension, and saved back unchanged", () => {
    const parsed = parseDocument(sample());
    expect(parsed.content).toEqual(sample().content);
    const editor = editorOf(sample());
    expect(editor.getDocument().content).toEqual(sample().content);
    // In the model: foreign, one position, with the custom type in their attributes.
    const node = editor.state.doc.nodeAt(5);
    expect(node?.type.name).toBe("foreignInline");
    expect(node?.attrs.type).toBe("acme:mention");
    expect(editor.state.doc.child(1).type.name).toBe("foreignBlock");
    expect(JSON.stringify(editor.getDocument())).not.toContain("foreign");
    // Through a string, as an app stores it.
    const stored = JSON.parse(JSON.stringify(editor.getDocument()));
    expect(editorOf(stored).getDocument()).toEqual(editor.getDocument());
    expect(editorOf(stored, [acme]).getDocument().content).toEqual(sample().content);
  });

  it("refuses foreign attributes that are not plain JSON or too large", () => {
    const doc = (attrs: unknown) =>
      createDocument({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "x:y", attrs } as NodeJSON] }],
      });
    expect(() => parseDocument(doc([1]))).toThrow(FoliDocumentError);
    expect(() => parseDocument(doc({ big: "x".repeat(70_000) }))).toThrow(/at most 65536/);
    expect(() => parseDocument(doc({ when: new Date() }))).toThrow(/plain JSON/);
    expect(parseDocument(doc({ a: [1, { b: null }] })).content).toEqual(
      doc({ a: [1, { b: null }] }).content,
    );
  });

  it("deletes a foreign node whole: selected first, as opaque content", () => {
    const editor = editorOf(sample());
    editor.run((state, dispatch) => {
      dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, 6)));
      return true;
    });
    editor.commands.deleteBackward();
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    editor.commands.deleteBackward();
    expect(inline(editor)).toEqual([
      { type: "text", text: "Ask  about the " },
      { type: "text", text: "budget", marks: [topic] },
    ]);
  });

  it("carry a .docx control's text in memory only", () => {
    const json = withForeignText(mention("Ada"), "@Ada (from Word)");
    expect(JSON.stringify(json)).not.toContain("from Word");
    const document = sample();
    (document.content.content?.[0]?.content as NodeJSON[])[1] = json;
    const editor = editorOf(document);
    expect(editor.state.doc.nodeAt(5)?.attrs.text).toBe("@Ada (from Word)");
    const out = editor.getDocument().content.content?.[0]?.content?.[1] as NodeJSON;
    expect(out).toEqual(mention("Ada"));
    expect(foreignTextOf(out)).toBe("@Ada (from Word)");
    expect(
      foreignTextOf(
        parseDocument(editor.getDocument()).content.content?.[0]?.content?.[1] as NodeJSON,
      ),
    ).toBe("@Ada (from Word)");
  });

  it("paste between editors with and without the extension: foreign in one, themselves in the other", () => {
    const without = editorOf(sample());
    const copied = without.state.doc.slice(0, without.state.doc.content.size).content.toJSON();
    const withExt = editorOf(createDocument(), [acme]);
    const pasted = fitPaste(withExt.state, { type: "doc", content: copied }).doc;
    expect(pasted.firstChild?.child(1).type.name).toBe("acme:mention");
    expect(pasted.child(1).type.name).toBe("acme:card");
    const back = fitPaste(without.state, pasted.toJSON()).doc;
    expect(back.firstChild?.child(1).type.name).toBe("foreignInline");
    expect(back.firstChild?.child(3).marks.map((m) => m.type.name)).toEqual(["foreign"]);
  });

  it("find matches a node's text as one position; replace leaves it", () => {
    for (const editor of [editorOf(sample(), [acme]), editorOf(sample())]) {
      const label =
        editor.state.doc.nodeAt(5)?.type.name === "foreignInline" ? "[acme:mention]" : "@Ada";
      const found = findAll(editor, label.slice(0, 3));
      expect(found).toEqual([{ story: null, from: 5, to: 6, text: label.slice(0, 3) }]);
      expect(findAll(editor, "Ask ")).toHaveLength(1);
      expect(replaceAll(editor, label.slice(0, 3), "x").refused.map((r) => r.reason)).toEqual([
        "locked",
      ]);
      expect(editor.getDocument().content).toEqual(sample().content);
    }
    expect(findAll(sample(), "Card c-9")).toEqual([]); // a block leaf has no line to search
  });

  it("are tracked when inserted or deleted, and accepted or rejected", () => {
    const insert: Command = (state, dispatch) => {
      const node = state.schema.nodes["acme:mention"]?.create({ id: "u-2", label: "Bo" });
      if (!node) return false;
      dispatch?.(state.tr.replaceSelection(new Slice(Fragment.from(node), 0, 0)));
      return true;
    };
    const at = (editor: Editor, pos: number) =>
      editor.run((state, dispatch) => {
        dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, pos)));
        return true;
      });
    const tracked = () => {
      const editor = editorOf(sample(), [acme]);
      editor.commands.setTrackChanges(true, "Me");
      at(editor, 1);
      editor.run(insert);
      return editor;
    };
    let editor = tracked();
    const inserted = inline(editor)?.[0] as NodeJSON;
    expect(inserted.type).toBe("acme:mention");
    expect(inserted.marks?.map((m) => m.type)).toEqual(["insertion"]);
    editor.run(rejectAllChanges());
    expect(editor.getDocument().content).toEqual(sample().content);
    editor = tracked();
    editor.run(acceptAllChanges());
    expect(inline(editor)?.[0]).toEqual({
      type: "acme:mention",
      attrs: { id: "u-2", label: "Bo" },
    });

    // Deleted while tracking: kept, marked deleted; accepted, gone.
    for (const extensions of [[acme], undefined]) {
      editor = editorOf(sample(), extensions);
      editor.commands.setTrackChanges(true, "Me");
      editor.run((state, dispatch) => {
        dispatch?.(state.tr.setSelection(NodeSelection.create(state.doc, 5)));
        return true;
      });
      editor.commands.deleteBackward();
      const deleted = inline(editor)?.[1] as NodeJSON;
      expect(deleted.type).toBe("acme:mention");
      expect(deleted.marks?.map((m) => m.type)).toEqual(["deletion", "bold"]);
      editor.run(acceptAllChanges());
      expect(JSON.stringify(editor.getDocument().content)).not.toContain("acme:mention");
    }
  });
});
