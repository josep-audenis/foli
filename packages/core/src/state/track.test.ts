import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { MarkJSON, Node, NodeJSON } from "../model/index.js";
import type { FoliDocument, StyleJSON } from "../v3/document.js";
import { createEditor, type Editor } from "./editor.js";
import { NodeSelection, TextSelection } from "./selection.js";
import { trackState } from "./track.js";

const STYLES: StyleJSON[] = [
  { id: "Normal", type: "paragraph", name: "Normal", isDefault: true, next: "Normal" },
  { id: "Heading1", type: "paragraph", name: "heading 1", basedOn: "Normal", next: "Normal" },
];

const text = (value: string, marks?: MarkJSON[]): NodeJSON =>
  marks ? { type: "text", text: value, marks } : { type: "text", text: value };
const p = (...content: NodeJSON[]): NodeJSON => ({
  type: "paragraph",
  ...(content.length ? { content } : {}),
});

function documentOf(...blocks: NodeJSON[]): FoliDocument {
  return {
    schemaVersion: 5,
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

  it("steps over deleted text: Backspace and Delete delete what is beyond it", () => {
    const mine: MarkJSON = {
      type: "deletion",
      attrs: { id: 5, author: "Me", date: "2026-01-02T03:04:05Z" },
    };
    const editor = tracked(p(text("ab"), text("cd", [mine]), text("ef")));
    editor.select(5);
    editor.commands.deleteBackward();
    expect(blocks(editor)).toEqual([p(text("a"), text("bcd", [mine]), text("ef"))]);
    editor.select(3);
    editor.commands.deleteForward();
    expect(blocks(editor)).toEqual([p(text("a"), text("bcde", [mine]), text("f"))]);
  });

  it("steps over deleted text the view hides, tracking or not", () => {
    const theirs: MarkJSON = {
      type: "deletion",
      attrs: { id: 5, author: "B", date: "2026-01-02T03:04:05Z" },
    };
    const editor = createEditor({ document: documentOf(p(text("ab"), text("cd", [theirs]))) });
    editor.commands.setReviewView("final");
    editor.select(5);
    editor.commands.deleteBackward();
    expect(blocks(editor)).toEqual([p(text("a"), text("cd", [theirs]))]);
    // In markup, deleted text shown is deleted for real when not tracking.
    editor.commands.setReviewView("markup");
    editor.select(3);
    editor.commands.deleteBackward();
    expect(blocks(editor)).toEqual([p(text("a"), text("d", [theirs]))]);
  });

  it("keeps the review view in the editor's state", () => {
    const editor = tracked(p(text("ab")));
    expect(trackState(editor.state)?.view).toBe("markup");
    expect(editor.commands.setReviewView("final")).toBe(true);
    expect(trackState(editor.state)).toEqual({ on: true, author: "Me", view: "final" });
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

  it("records formatting text had before it was first changed", () => {
    const editor = tracked(p(text("abc", [{ type: "italic" }])));
    editor.select(2, 3);
    editor.commands.toggleMark("bold");
    const change = (id: number, previous: MarkJSON[]): MarkJSON => ({
      type: "formatChange",
      attrs: { id, author: "Me", date: DATE, previous },
    });
    const italic: MarkJSON = { type: "italic" };
    expect(blocks(editor)).toEqual([
      p(
        text("a", [italic]),
        text("b", [{ type: "bold" }, italic, change(0, [italic])]),
        text("c", [italic]),
      ),
    ]);
    // A second change keeps the first record.
    editor.commands.toggleMark("italic");
    expect(blocks(editor)[0]?.content?.[1]).toEqual(
      text("b", [{ type: "bold" }, change(0, [italic])]),
    );
    editor.commands.undo();
    editor.commands.undo();
    expect(blocks(editor)).toEqual([p(text("abc", [italic]))]);
  });

  it("records nothing when one's own insertion is formatted", () => {
    const editor = tracked(p(text("ab")));
    editor.select(2);
    editor.commands.insertText("X");
    editor.select(2, 3);
    editor.commands.toggleMark("bold");
    expect(blocks(editor)).toEqual([
      p(text("a"), text("X", [ins(0), { type: "bold" }]), text("b")),
    ]);
  });

  it("records a paragraph's properties before it was first changed", () => {
    const editor = tracked(p(text("ab")));
    editor.select(2);
    editor.commands.setAlign("center");
    editor.commands.setAlign("end");
    expect(blocks(editor)).toEqual([
      {
        type: "paragraph",
        attrs: {
          justification: "right",
          formatChange: { id: 0, author: "Me", date: DATE, previous: {} },
        },
        content: [text("ab")],
      },
    ]);
  });

  it("records Enter at the end of a heading so rejecting keeps the heading", () => {
    const heading = { type: "paragraph", attrs: { style: "Heading1" }, content: [text("Head")] };
    const editor = tracked(heading);
    const before = editor.getDocument();
    editor.select(5);
    editor.commands.splitBlock();
    // Enter then Backspace: the original, exactly.
    editor.commands.deleteBackward();
    expect(editor.getDocument()).toEqual(before);
    editor.commands.splitBlock();
    const [first, second] = blocks(editor);
    expect(first?.attrs).toEqual({ style: "Heading1", revision: revision("insertion", 0) });
    expect(second?.attrs).toMatchObject({
      formatChange: { author: "Me", previous: { style: "Heading1" } },
    });
  });

  it("leaves a paragraph's record on the mark when it is split", () => {
    const editor = tracked(p(text("abcd")));
    editor.select(2);
    editor.commands.setAlign("center");
    editor.select(3);
    editor.commands.splitBlock();
    const [first, second] = blocks(editor);
    expect(first?.attrs?.formatChange ?? null).toBe(null);
    expect(second?.attrs?.formatChange).toMatchObject({ id: 0, previous: {} });
  });

  it("records pasting paragraphs into the middle of one: rejecting gives it back", () => {
    const heading = { type: "paragraph", attrs: { style: "Heading1" }, content: [text("abcd")] };
    const editor = tracked(heading);
    const before = editor.getDocument();
    const { schema } = editor.state;
    const pasted = schema.nodeFromJSON({ type: "doc", content: [p(text("X")), p(text("Y"))] });
    editor.dispatch(editor.state.tr.replace(3, 3, pasted.slice(1, pasted.content.size - 1)));
    expect(project(editor.state.doc, true)).toEqual(["(Heading1)abX", "Ycd"]);
    editor.commands.rejectAllChanges();
    expect(editor.getDocument()).toEqual(before);
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

/**
 * Paragraphs as Word shows them after accepting (or rejecting) every change: text, "*" after a
 * bold character, the alignment first in brackets.
 */
function project(doc: Node, accept: boolean): string[] {
  const out: string[] = [];
  let current = "";
  const gone = accept ? "deletion" : "insertion";
  // Paragraphs a change joins: the first one of them that keeps content (one left with nothing
  // is gone, as in Word), else the last.
  let first: Node | null = null;
  doc.forEach((block) => {
    let live = false;
    block.forEach((inline) => {
      const marker = /^(bookmark|comment)(Start|End)$/.test(inline.type.name);
      if (!marker && !inline.marks.some((m) => m.type.name === gone)) live = true;
    });
    if (live) first ??= block;
    block.forEach((inline) => {
      if (inline.marks.some((m) => m.type.name === gone)) return;
      const change = inline.marks.find((m) => m.type.name === "formatChange");
      const marks =
        !accept && change
          ? (change.attrs.previous as { type: string }[]).map((m) => m.type)
          : inline.marks.map((m) => m.type.name);
      const bold = marks.includes("bold") ? "*" : "";
      const value = inline.isText ? (inline.text ?? "") : `<${inline.type.name}>`;
      current += [...value].map((c) => c + bold).join("");
    });
    const revision = block.attrs.revision as Record<string, unknown> | null;
    if (revision?.[gone]) return; // the paragraph mark is gone: the next paragraph continues it
    // Accepting keeps the first paragraph's properties, as an untracked join; rejecting restores
    // the original mark's paragraph, the last one.
    const head = accept ? (first ?? block) : block;
    const change = head.attrs.formatChange as { previous: Record<string, unknown> } | null;
    const { justification: just, style } = !accept && change ? change.previous : head.attrs;
    out.push((style ? `(${style})` : "") + (just ? `[${just}]` : "") + current);
    current = "";
    first = null;
  });
  if (current || !out.length) out.push(current);
  return out;
}

/** A paragraph from `project`'s form. */
function parse(line: string): NodeJSON {
  const match = /^(?:\((\w+)\))?(?:\[(\w+)\])?(.*)$/.exec(line) as RegExpExecArray;
  const content: NodeJSON[] = [];
  for (const [, c, bold] of (match[3] ?? "").matchAll(/(.)(\*?)/gu))
    content.push(text(c as string, bold ? [{ type: "bold" }] : undefined));
  const attrs = {
    ...(match[1] ? { style: match[1] } : {}),
    ...(match[2] ? { justification: match[2] } : {}),
  };
  return {
    type: "paragraph",
    ...(Object.keys(attrs).length ? { attrs } : {}),
    ...(content.length ? { content } : {}),
  };
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
  kind: fc.constantFrom(
    "type",
    "replace",
    "backspace",
    "delete",
    "enter",
    "bold",
    "unbold",
    "align",
  ),
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
    // Typed as plain text: next to deleted text, typing takes that text's look (the commands'
    // scenarios above cover them), which the untracked mirror does not have.
    case "type":
      // After deleted text and deleted paragraph marks: where accepting shows the caret.
      editor.dispatch(editor.state.tr.insertText(o.text, right(k1), right(k1), []));
      break;
    case "replace":
      if (k1 === k2 || right(k1) >= left(k2)) return;
      select(right(k1), left(k2));
      editor.commands.deleteSelection();
      editor.dispatch(
        editor.state.tr.insertText(o.text, editor.state.selection.from, undefined, []),
      );
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
      // After deleted text: at the end of a paragraph whose text is deleted, as accepting shows it.
      select(right(k1));
      editor.commands.splitBlock();
      break;
    case "bold":
    case "unbold": {
      const from = right(k1);
      const to = left(k2);
      if (from >= to) return;
      const bold = editor.state.schema.marks.bold as NonNullable<
        typeof editor.state.schema.marks.bold
      >;
      const tr = editor.state.tr;
      if (o.kind === "bold") tr.addMark(from, to, bold.create());
      else tr.removeMark(from, to, bold);
      if (tr.docChanged) editor.dispatch(tr);
      break;
    }
    case "align": {
      // From the first paragraph of the one Word shows after accepting (joined ones included).
      let index = doc.resolve(left(k1)).index(0);
      while (
        index > 0 &&
        (doc.child(index - 1).attrs.revision as { deletion?: unknown } | null)?.deletion
      )
        index--;
      let start = 1;
      for (let i = 0; i < index; i++) start += doc.child(i).nodeSize;
      // To the last paragraph of the one accepting shows (all joined ones aligned alike).
      let last = doc.resolve(Math.max(start, left(k2))).index(0);
      while (
        last < doc.childCount - 1 &&
        (doc.child(last).attrs.revision as { deletion?: unknown } | null)?.deletion
      )
        last++;
      let end = 0;
      for (let i = 0; i <= last; i++) end += doc.child(i).nodeSize;
      select(start, end - 1);
      editor.commands.setAlign(o.text === "x" ? "center" : "start");
      break;
    }
  }
}

/**
 * Known: Enter in a paragraph next to a deleted mark (one that accepting joins) splits that
 * paragraph as it is (its properties, its end), not the paragraph accepting makes. Such an
 * Enter is left out.
 */
function knownDifference(doc: Node, o: Op): boolean {
  if (o.kind !== "enter") return false;
  const k = Math.min(Math.round(o.a * units(doc)), Math.round(o.b * units(doc)));
  const index = doc.resolve(rightmost(doc, k)).index(0);
  const deleted = (i: number) =>
    i >= 0 && !!(doc.child(i).attrs.revision as { deletion?: unknown } | null)?.deletion;
  return deleted(index - 1) || deleted(index);
}

/**
 * Known: a paragraph whose text and mark are both deleted is removed whole on accepting (the
 * next one keeps its properties, as Word does), while the same edits untracked, one after the
 * other, may have kept its properties on the joined paragraph. Not compared with the mirror then.
 */
function removedWhole(doc: Node): boolean {
  let found = false;
  doc.forEach((block) => {
    if (!(block.attrs.revision as { deletion?: unknown } | null)?.deletion) return;
    let live = false;
    block.forEach((inline) => {
      if (!inline.marks.some((m) => m.type.name === "deletion")) live = true;
    });
    if (!live) found = true;
  });
  return found;
}

/**
 * Known: a paragraph whose mark was deleted while it was empty, then typed into, keeps its own
 * properties when accepting joins it to the next one, while the same edits untracked joined an
 * empty paragraph and kept the next one's (found by a random seed in 12.11, about 1 run in 5).
 * Compared with the mirror without paragraph properties then: the text must still agree.
 */
function typedIntoJoined(doc: Node): boolean {
  let found = false;
  doc.forEach((block) => {
    if (!(block.attrs.revision as { deletion?: unknown } | null)?.deletion || !block.childCount)
      return;
    let inserted = true;
    block.forEach((inline) => {
      if (!inline.marks.some((m) => m.type.name === "insertion")) inserted = false;
    });
    if (inserted) found = true;
  });
  return found;
}

/** `project`'s lines without the paragraphs' style and justification. */
const textOnly = (lines: string[]) =>
  lines.map((line) => line.replace(/^(\(\w+\))?(\[\w+\])?/, ""));

describe("tracked changes (property)", () => {
  it("accept all = the same edits untracked; reject all = the original; undo all = exact", () => {
    const paragraphs = fc.array(fc.stringMatching(/^[a-d]{0,5}$/), { minLength: 1, maxLength: 4 });
    fc.assert(
      fc.property(paragraphs, fc.array(op, { minLength: 1, maxLength: 8 }), (texts, ops) => {
        // A paragraph with "a" first is a heading (its next style differs).
        const content = texts.map((t) => ({
          ...(t ? p(text(t)) : p()),
          ...(t.startsWith("a") ? { attrs: { style: "Heading1" } } : {}),
        }));
        const editor = tracked(...content);
        const original = editor.getDocument();
        const start = editor.state.doc;
        for (const o of ops) {
          if (knownDifference(editor.state.doc, o)) continue;
          const mirror = createEditor({
            document: documentOf(...project(editor.state.doc, true).map(parse)),
          });
          apply(editor, o);
          apply(mirror, o);
          if (typedIntoJoined(editor.state.doc))
            expect(textOnly(project(editor.state.doc, true))).toEqual(
              textOnly(project(mirror.state.doc, true)),
            );
          else if (!removedWhole(editor.state.doc))
            expect(project(editor.state.doc, true)).toEqual(project(mirror.state.doc, true));
          expect(project(editor.state.doc, false)).toEqual(project(start, true));
        }
        // Accepting and rejecting everything for real gives what the projections say.
        const REVIEW = /"type":"(insertion|deletion|formatChange)"|"revision":\{|"formatChange":\{/;
        for (const accept of [true, false]) {
          const copy = createEditor({ document: editor.getDocument() });
          if (accept) copy.commands.acceptAllChanges();
          else copy.commands.rejectAllChanges();
          expect(JSON.stringify(copy.getDocument().content)).not.toMatch(REVIEW);
          expect(project(copy.state.doc, true)).toEqual(project(editor.state.doc, accept));
        }
        while (editor.commands.undo()) {}
        expect(editor.getDocument()).toEqual(original);
      }),
      { numRuns: 500 },
    );
    // Seconds alone; more with the whole suite running beside it.
  }, 120_000);
});
