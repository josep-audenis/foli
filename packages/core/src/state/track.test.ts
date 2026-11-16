import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { MarkJSON, Node, NodeJSON } from "../model/index.js";
import type { FoliDocument, StyleJSON } from "../v3/document.js";
import { createEditor, type Editor } from "./editor.js";
import { NodeSelection, TextSelection } from "./selection.js";

const STYLES: StyleJSON[] = [
  { id: "Normal", type: "paragraph", name: "Normal", isDefault: true, next: "Normal" },
];

const text = (value: string, marks?: MarkJSON[]): NodeJSON =>
  marks ? { type: "text", text: value, marks } : { type: "text", text: value };
const p = (...content: NodeJSON[]): NodeJSON => ({
  type: "paragraph",
  ...(content.length ? { content } : {}),
});

function documentOf(...blocks: NodeJSON[]): FoliDocument {
  return {
    schemaVersion: 3,
    section: {},
    defaults: {},
    styles: STYLES,
    numbering: { abstracts: [], instances: [] },
    comments: [],
    content: { type: "doc", content: blocks },
  };
}

const tracked = (...blocks: NodeJSON[]) =>
  createEditor({ document: documentOf(...blocks), author: "Me", trackChanges: true });
const blocks = (editor: Editor) => editor.getDocument().content.content ?? [];
const DATE = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
const by = (id: number, author = "Me") => ({ id, author, date: DATE });
const ins = (id: number, author = "Me"): MarkJSON => ({ type: "insertion", attrs: by(id, author) });
const del = (id: number, author = "Me"): MarkJSON => ({ type: "deletion", attrs: by(id, author) });
const revision = (kind: "insertion" | "deletion", id: number) => ({
  [kind]: { id, author: "Me", date: DATE },
});

describe("tracked changes", () => {
  it("is off unless asked for, and toggles", () => {
    const editor = createEditor({ document: documentOf(p(text("ab"))) });
    expect(editor.trackingChanges).toBe(false);
    editor.select(2);
    editor.commands.insertText("X");
    expect(blocks(editor)).toEqual([p(text("aXb"))]);
    expect(editor.commands.setTrackChanges(true, "Me")).toBe(true);
    expect(editor.trackingChanges).toBe(true);
    editor.commands.insertText("Y");
    expect(blocks(editor)).toEqual([p(text("aX"), text("Y", [ins(0)]), text("b"))]);
  });

  it("marks typed text inserted, one change while typing goes on", () => {
    const editor = tracked(p(text("ab")));
    editor.select(2);
    editor.commands.insertText("X");
    editor.commands.insertText("Y");
    expect(blocks(editor)).toEqual([p(text("a"), text("XY", [ins(0)]), text("b"))]);
    expect(editor.state.selection.head).toBe(4);
  });

  it("keeps deleted text, marked, and puts the caret before it on Backspace", () => {
    const editor = tracked(p(text("abc")));
    editor.select(4);
    editor.commands.deleteBackward();
    expect(blocks(editor)).toEqual([p(text("ab"), text("c", [del(0)]))]);
    expect(editor.state.selection.head).toBe(3);
    editor.commands.deleteBackward();
    expect(blocks(editor)).toEqual([p(text("a"), text("bc", [del(0)]))]);
    expect(editor.state.selection.head).toBe(2);
  });

  it("puts the caret after what Delete deleted", () => {
    const editor = tracked(p(text("abc")));
    editor.select(1);
    editor.commands.deleteForward();
    expect(blocks(editor)).toEqual([p(text("a", [del(0)]), text("bc"))]);
    expect(editor.state.selection.head).toBe(2);
  });

  it("removes one's own insertion for real", () => {
    const editor = tracked(p(text("ab")));
    editor.select(2);
    editor.commands.insertText("X");
    editor.commands.deleteBackward();
    expect(blocks(editor)).toEqual([p(text("ab"))]);
  });

  it("marks another author's insertion deleted", () => {
    const other = {
      type: "insertion",
      attrs: { id: 7, author: "Other", date: "2026-01-02T03:04:05Z" },
    };
    const editor = tracked(p(text("a"), text("X", [other]), text("b")));
    editor.select(2, 3);
    editor.commands.deleteSelection();
    expect(blocks(editor)).toEqual([p(text("a"), text("X", [other, del(8)]), text("b"))]);
  });

  it("records Enter as an inserted paragraph mark, and Backspace takes it back", () => {
    const editor = tracked(p(text("abcd")));
    editor.select(3);
    editor.commands.splitBlock();
    expect(blocks(editor)).toEqual([
      { type: "paragraph", attrs: { revision: revision("insertion", 0) }, content: [text("ab")] },
      p(text("cd")),
    ]);
    editor.commands.deleteBackward();
    expect(blocks(editor)).toEqual([p(text("abcd"))]);
  });

  it("records joining paragraphs as a deleted paragraph mark", () => {
    const editor = tracked(p(text("ab")), p(text("cd")));
    editor.select(5);
    editor.commands.deleteBackward();
    expect(blocks(editor)).toEqual([
      { type: "paragraph", attrs: { revision: revision("deletion", 0) }, content: [text("ab")] },
      p(text("cd")),
    ]);
  });

  it("records typing over a selection across paragraphs: the old text deleted, the new after it", () => {
    const editor = tracked(p(text("abc")), p(text("def")));
    editor.select(2, 7);
    editor.commands.insertText("X");
    expect(blocks(editor)).toEqual([
      {
        type: "paragraph",
        attrs: { revision: revision("deletion", 0) },
        content: [text("a"), text("bc", [del(0)])],
      },
      p(text("d", [del(0)]), text("X", [ins(1)]), text("ef")),
    ]);
    expect(editor.state.selection.head).toBe(8);
  });

  it("undoes a tracked edit exactly, and does not track undo", () => {
    const editor = tracked(p(text("abc")), p(text("def")));
    const before = editor.getDocument();
    editor.select(2, 7);
    editor.commands.insertText("X");
    editor.commands.undo();
    expect(editor.getDocument()).toEqual(before);
    editor.commands.redo();
    expect(blocks(editor)[1]).toEqual(p(text("d", [del(0)]), text("X", [ins(1)]), text("ef")));
  });

  it("inserts the paragraph Enter makes beside a selected table", () => {
    const table: NodeJSON = { type: "opaqueBlock", attrs: { xml: "<w:tbl/>" } };
    const editor = tracked(p(text("ab")), table, p(text("cd")));
    editor.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 4)));
    expect(editor.commands.splitBlock()).toBe(true);
    const content = blocks(editor);
    expect(content).toHaveLength(4);
    expect(JSON.stringify(content)).not.toContain('"deletion"');
    expect(editor.state.selection.$head.parent.isTextblock).toBe(true);
    expect(editor.state.selection.empty).toBe(true);
  });

  it("does not delete or insert a table while tracking (Phase 10)", () => {
    const table: NodeJSON = { type: "opaqueBlock", attrs: { xml: "<w:tbl/>" } };
    const editor = tracked(p(text("ab")), table, p(text("cd")));
    const before = editor.getDocument();
    editor.select(2, 7);
    editor.commands.deleteSelection();
    expect(editor.getDocument()).toEqual(before);
    const { schema } = editor.state;
    editor.dispatch(editor.state.tr.insert(0, schema.nodeFromJSON(table)));
    expect(editor.getDocument()).toEqual(before);
  });

  it("records the mark of a paragraph a range replaces whole", () => {
    const editor = tracked(p(), p(text("cd")));
    const { schema } = editor.state;
    // The view's paste into an empty paragraph: the paragraph replaced by the pasted blocks.
    const pasted = schema.nodeFromJSON(p(text("x")));
    editor.dispatch(editor.state.tr.delete(0, 2).insert(0, pasted));
    expect(project(editor.state.doc, true)).toEqual(["x", "cd"]);
    expect(project(editor.state.doc, false)).toEqual(["", "cd"]);
  });

  it("records the mark of an empty last paragraph pasted into", () => {
    const editor = tracked(p(text("ab")), p());
    const { schema } = editor.state;
    const pasted = [p(text("Q")), p(text("R"))].map((b) => schema.nodeFromJSON(b));
    editor.dispatch(editor.state.tr.delete(4, 6).insert(4, pasted));
    expect(project(editor.state.doc, true)).toEqual(["ab", "Q", "R"]);
    expect(project(editor.state.doc, false)).toEqual(["ab", ""]);
  });

  it("gives a change an id no comment's change has", () => {
    const comment = {
      id: 0,
      author: "A",
      content: [p(text("n", [{ type: "insertion", attrs: { id: 9, author: "A" } }]))],
    };
    const editor = createEditor({
      document: { ...documentOf(p(text("ab"))), comments: [comment] },
      author: "Me",
      trackChanges: true,
    });
    editor.select(2);
    editor.commands.insertText("X");
    expect(blocks(editor)).toEqual([p(text("a"), text("X", [ins(10)]), text("b"))]);
  });

  it("deletes everything as deleted text, keeping the last paragraph", () => {
    const editor = tracked(p(text("ab")), p(text("cd")));
    editor.commands.selectAll();
    editor.commands.deleteSelection();
    expect(blocks(editor)).toEqual([
      {
        type: "paragraph",
        attrs: { revision: revision("deletion", 0) },
        content: [text("ab", [del(0)])],
      },
      p(text("cd", [del(0)])),
    ]);
  });
});

// Property: with tracking on, the document Word shows after "accept all" is what the same edits
// make with tracking off, and after "reject all" it is the original.

/** Paragraph texts as Word shows them after accepting (or rejecting) every change. */
function project(doc: Node, accept: boolean): string[] {
  const out: string[] = [];
  let current = "";
  const gone = accept ? "deletion" : "insertion";
  doc.forEach((block) => {
    block.forEach((inline) => {
      if (inline.marks.some((m) => m.type.name === gone)) return;
      current += inline.isText ? inline.text : `<${inline.type.name}>`;
    });
    const revision = block.attrs.revision as Record<string, unknown> | null;
    if (revision?.[gone]) return; // the paragraph mark is gone: the next paragraph continues it
    out.push(current);
    current = "";
  });
  if (current || !out.length) out.push(current);
  return out;
}

/**
 * Caret positions in order with how many units (characters, paragraph marks) Word shows after
 * accepting come before each: text positions and paragraph boundaries.
 */
function slots(doc: Node): { pos: number; count: number }[] {
  const out: { pos: number; count: number }[] = [];
  let count = 0;
  doc.forEach((block, offset) => {
    let pos = offset + 1;
    out.push({ pos, count });
    block.forEach((inline) => {
      const deleted = inline.marks.some((m) => m.type.name === "deletion");
      for (let i = 0; i < inline.nodeSize; i++) {
        pos++;
        if (!deleted) count++;
        out.push({ pos, count });
      }
    });
    const revision = block.attrs.revision as Record<string, unknown> | null;
    if (!revision?.deletion) count++;
  });
  return out;
}
const leftmost = (doc: Node, k: number) =>
  slots(doc).find((s) => s.count >= k)?.pos ?? doc.content.size - 1;
const rightmost = (doc: Node, k: number) =>
  [...slots(doc)].reverse().find((s) => s.count <= k)?.pos ?? 1;
const units = (doc: Node) => slots(doc).at(-1)?.count ?? 0;

const fraction = fc.noBias(fc.integer({ min: 0, max: 1000 })).map((n) => n / 1000);
const op = fc.record({
  kind: fc.constantFrom("type", "replace", "backspace", "delete", "enter"),
  a: fraction,
  b: fraction,
  text: fc.constantFrom("x", "yz"),
});
type Op = typeof op extends fc.Arbitrary<infer T> ? T : never;

function apply(editor: Editor, o: Op): void {
  const doc = editor.state.doc;
  const n = units(doc);
  const a = Math.round(o.a * n);
  const b = Math.round(o.b * n);
  const [k1, k2] = a <= b ? [a, b] : [b, a];
  // Units before a caret: left of deleted text for Backspace, right of it for Delete.
  const left = (k: number) => leftmost(doc, k);
  const right = (k: number) => rightmost(doc, k);
  const select = (anchor: number, head = anchor) =>
    editor.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, anchor, head)),
    );
  switch (o.kind) {
    case "type":
      select(left(k1));
      editor.commands.insertText(o.text);
      break;
    case "replace":
      if (k1 === k2) return;
      select(right(k1), left(k2));
      editor.commands.insertText(o.text);
      break;
    case "backspace":
      select(left(k1));
      editor.commands.deleteBackward();
      break;
    case "delete":
      select(right(k1));
      editor.commands.deleteForward();
      break;
    case "enter":
      select(left(k1));
      editor.commands.splitBlock();
      break;
  }
}

describe("tracked changes (property)", () => {
  it("accept all = the same edits untracked; reject all = the original; undo all = exact", () => {
    const paragraphs = fc.array(fc.stringMatching(/^[a-d]{0,5}$/), { minLength: 1, maxLength: 4 });
    fc.assert(
      fc.property(paragraphs, fc.array(op, { minLength: 1, maxLength: 8 }), (texts, ops) => {
        const content = texts.map((t) => (t ? p(text(t)) : p()));
        const editor = tracked(...content);
        const original = editor.getDocument();
        for (const o of ops) {
          const mirror = createEditor({
            document: documentOf(
              ...project(editor.state.doc, true).map((t) => (t ? p(text(t)) : p())),
            ),
          });
          apply(editor, o);
          apply(mirror, o);
          expect(project(editor.state.doc, true)).toEqual(project(mirror.state.doc, true));
          expect(project(editor.state.doc, false)).toEqual(texts);
        }
        while (editor.commands.undo()) {}
        expect(editor.getDocument()).toEqual(original);
      }),
      { numRuns: 500 },
    );
  });
});
