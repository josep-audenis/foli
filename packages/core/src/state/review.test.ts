import { describe, expect, it } from "vitest";
import type { MarkJSON, NodeJSON } from "../model/index.js";
import type { FoliDocument, StyleJSON } from "../v3/document.js";
import { createEditor, type Editor } from "./editor.js";
import {
  acceptChangeAndNext,
  nextChangeWrapping,
  previousChangeWrapping,
  rejectChangeAndNext,
  revealSelection,
  trackedChanges,
} from "./review.js";

const STYLES: StyleJSON[] = [
  { id: "Normal", type: "paragraph", name: "Normal", isDefault: true, next: "Normal" },
];
const DATE = "2026-01-02T03:04:05Z";
const text = (value: string, marks?: MarkJSON[]): NodeJSON =>
  marks ? { type: "text", text: value, marks } : { type: "text", text: value };
const p = (attrs: Record<string, unknown>, ...content: NodeJSON[]): NodeJSON => ({
  type: "paragraph",
  ...(Object.keys(attrs).length ? { attrs } : {}),
  ...(content.length ? { content } : {}),
});
const by = (id: number, author = "A") => ({ id, author, date: DATE });
const ins = (id: number, author = "A", move?: string): MarkJSON => ({
  type: "insertion",
  attrs: { ...by(id, author), ...(move ? { move } : {}) },
});
const del = (id: number, author = "A", move?: string): MarkJSON => ({
  type: "deletion",
  attrs: { ...by(id, author), ...(move ? { move } : {}) },
});

function editorOf(...blocks: NodeJSON[]): Editor {
  const document: FoliDocument = {
    schemaVersion: 5,
    section: {},
    defaults: {},
    styles: STYLES,
    numbering: { abstracts: [], instances: [] },
    comments: [],
    content: { type: "doc", content: blocks },
  };
  return createEditor({ document });
}
const blocks = (editor: Editor) => editor.getDocument().content.content ?? [];

describe("accepting and rejecting changes", () => {
  const redline = () =>
    editorOf(p({}, text("a"), text("X", [ins(1)]), text("b"), text("Y", [del(2, "B")]), text("c")));

  it("lists the document's changes in order", () => {
    const editor = redline();
    expect(
      trackedChanges(editor.state.doc).map((c) => [c.kind, c.id, c.author, c.from, c.to]),
    ).toEqual([
      ["insertion", 1, "A", 2, 3],
      ["deletion", 2, "B", 4, 5],
    ]);
  });

  it("accepts and rejects everything", () => {
    const editor = redline();
    expect(editor.commands.acceptAllChanges()).toBe(true);
    expect(blocks(editor)).toEqual([p({}, text("aXbc"))]);
    editor.commands.undo();
    expect(editor.commands.rejectAllChanges()).toBe(true);
    expect(blocks(editor)).toEqual([p({}, text("abYc"))]);
    expect(editor.commands.rejectAllChanges()).toBe(false);
  });

  it("accepts one author's changes", () => {
    const editor = redline();
    editor.commands.acceptAllChanges("B");
    expect(blocks(editor)).toEqual([p({}, text("a"), text("X", [ins(1)]), text("bc"))]);
  });

  it("accepts the change at the caret, and moves between changes", () => {
    const editor = redline();
    editor.select(0);
    expect(editor.commands.nextChange()).toBe(true);
    expect([editor.state.selection.from, editor.state.selection.to]).toEqual([2, 3]);
    expect(editor.commands.nextChange()).toBe(true);
    expect([editor.state.selection.from, editor.state.selection.to]).toEqual([4, 5]);
    expect(editor.commands.nextChange()).toBe(false);
    expect(editor.commands.previousChange()).toBe(true);
    expect([editor.state.selection.from, editor.state.selection.to]).toEqual([2, 3]);
    editor.select(5);
    editor.commands.rejectChange();
    expect(blocks(editor)).toEqual([p({}, text("a"), text("X", [ins(1)]), text("bYc"))]);
  });

  it("joins paragraphs for a deleted mark (the first one's properties) and an inserted one (the last one's)", () => {
    const deleted = { revision: { deletion: by(3) } };
    const accepting = editorOf(
      p({ ...deleted, justification: "center" }, text("ab")),
      p({ justification: "right" }, text("cd")),
    );
    accepting.commands.acceptAllChanges();
    expect(blocks(accepting)).toEqual([p({ justification: "center" }, text("abcd"))]);
    const inserted = { revision: { insertion: by(4) } };
    const rejecting = editorOf(
      p({ ...inserted, justification: "center" }, text("ab")),
      p({ justification: "right" }, text("cd")),
    );
    rejecting.commands.rejectAllChanges();
    expect(blocks(rejecting)).toEqual([p({ justification: "right" }, text("abcd"))]);
    // The other way round, the record goes and the paragraphs stay.
    rejecting.commands.undo();
    rejecting.commands.acceptAllChanges();
    expect(blocks(rejecting)).toEqual([
      p({ justification: "center" }, text("ab")),
      p({ justification: "right" }, text("cd")),
    ]);
  });

  it("restores recorded formatting on reject, drops the record on accept", () => {
    const change = (previous: MarkJSON[]): MarkJSON => ({
      type: "formatChange",
      attrs: { ...by(5), previous },
    });
    const formatted = () =>
      editorOf(
        p(
          {
            justification: "center",
            formatChange: { ...by(6), previous: { justification: "left" } },
          },
          text("ab", [{ type: "bold" }, change([{ type: "italic" }])]),
        ),
      );
    const accepting = formatted();
    accepting.commands.acceptAllChanges();
    expect(blocks(accepting)).toEqual([
      p({ justification: "center" }, text("ab", [{ type: "bold" }])),
    ]);
    const rejecting = formatted();
    rejecting.commands.rejectAllChanges();
    expect(blocks(rejecting)).toEqual([
      p({ justification: "left" }, text("ab", [{ type: "italic" }])),
    ]);
  });

  it("takes both ends of a move together", () => {
    const editor = editorOf(
      p({}, text("x", [del(7, "A", "m1")]), text("a")),
      p({}, text("b"), text("x", [ins(8, "A", "m1")])),
    );
    editor.select(1);
    editor.commands.acceptChange();
    expect(blocks(editor)).toEqual([p({}, text("a")), p({}, text("bx"))]);
  });

  it("removes a paragraph deleted whole, leaving the next one as it is", () => {
    const editor = editorOf(
      p({ style: "Heading1", revision: { deletion: by(3) } }, text("Head", [del(2)])),
      p({ justification: "right" }, text("body")),
    );
    editor.commands.acceptAllChanges();
    expect(blocks(editor)).toEqual([p({ justification: "right" }, text("body"))]);
  });

  it("goes to changes inside a paragraph with recorded formatting, at the caret those first", () => {
    const fc = { ...by(9), previous: { justification: "left" } };
    const editor = editorOf(
      p({}, text("start")),
      p({ justification: "center", formatChange: fc }, text("ab"), text("X", [ins(1)]), text("cd")),
      p({}, text("e"), text("Y", [ins(2)])),
    );
    editor.select(1);
    const stops: number[][] = [];
    while (editor.commands.nextChange())
      stops.push([editor.state.selection.from, editor.state.selection.to]);
    expect(stops).toEqual([
      [8, 13],
      [10, 11],
      [16, 17],
    ]);
    // At the caret in the insertion: the insertion, not the paragraph's formatting.
    editor.select(10);
    editor.commands.rejectChange();
    expect(blocks(editor)[1]).toEqual(
      p({ justification: "center", formatChange: fc }, text("abcd")),
    );
  });

  it("does not go to deleted content the view hides", () => {
    const editor = redline();
    editor.commands.setReviewView("final");
    editor.select(0);
    expect(editor.commands.nextChange()).toBe(true);
    expect([editor.state.selection.from, editor.state.selection.to]).toEqual([2, 3]);
    expect(editor.commands.nextChange()).toBe(false);
  });

  it("goes past an inserted paragraph mark to the change after it, and back", () => {
    // "ab" ends with an inserted mark (caret at 3), then "X" is inserted in the next paragraph.
    const editor = editorOf(
      p({ revision: { insertion: by(3) } }, text("ab")),
      p({}, text("X", [ins(4)]), text("c")),
    );
    editor.select(1);
    const sel = () => [editor.state.selection.from, editor.state.selection.to];
    expect(editor.commands.nextChange()).toBe(true);
    expect(sel()).toEqual([3, 3]);
    expect(editor.commands.nextChange()).toBe(true);
    expect(sel()).toEqual([5, 6]);
    expect(editor.commands.nextChange()).toBe(false);
    expect(editor.commands.previousChange()).toBe(true);
    expect(sel()).toEqual([3, 3]);
    expect(editor.commands.previousChange()).toBe(false);
  });

  it("wraps around with the wrapping commands, and marks the step to be revealed", () => {
    const editor = redline();
    const revealed: boolean[] = [];
    editor.subscribe((_state, trs) =>
      revealed.push(trs.some((tr) => !!tr.getMeta(revealSelection))),
    );
    const sel = () => [editor.state.selection.from, editor.state.selection.to];
    editor.select(5);
    expect(editor.run(nextChangeWrapping)).toBe(true);
    expect(sel()).toEqual([2, 3]);
    expect(editor.run(previousChangeWrapping)).toBe(true);
    expect(sel()).toEqual([4, 5]);
    expect(revealed).toEqual([false, true, true]);
    editor.commands.acceptAllChanges();
    expect(editor.run(nextChangeWrapping)).toBe(false);
  });

  it("accepts or rejects and goes on to the next change, in one undo step", () => {
    const editor = redline();
    const sel = () => [editor.state.selection.from, editor.state.selection.to];
    // Nothing at the caret: it goes to the first change.
    editor.select(1);
    expect(editor.run(acceptChangeAndNext)).toBe(true);
    expect(sel()).toEqual([2, 3]);
    expect(trackedChanges(editor.state.doc)).toHaveLength(2);
    expect(editor.run(acceptChangeAndNext)).toBe(true);
    expect(blocks(editor)).toEqual([p({}, text("aXb"), text("Y", [del(2, "B")]), text("c"))]);
    expect(sel()).toEqual([4, 5]);
    editor.commands.undo();
    expect(trackedChanges(editor.state.doc)).toHaveLength(2);
    expect(sel()).toEqual([2, 3]);
    editor.run(acceptChangeAndNext);
    // The last one: resolved, and nothing left to go to.
    expect(editor.run(rejectChangeAndNext)).toBe(true);
    expect(blocks(editor)).toEqual([p({}, text("aXbYc"))]);
    expect(editor.run(rejectChangeAndNext)).toBe(false);
  });

  it("goes on to a change right where a rejected insertion was", () => {
    const editor = editorOf(p({}, text("a"), text("X", [ins(1)]), text("Y", [del(2)]), text("b")));
    editor.select(2, 3);
    editor.run(rejectChangeAndNext);
    expect(blocks(editor)).toEqual([p({}, text("a"), text("Y", [del(2)]), text("b"))]);
    expect([editor.state.selection.from, editor.state.selection.to]).toEqual([2, 3]);
  });

  it("selects the next change where it is after a plugin's own steps (a comment going)", () => {
    // Deleting "Y" takes the comment's reference with it: the comments plugin removes the
    // anchors before it too, so the change after it moves back two places.
    const anchor = (type: string): NodeJSON => ({ type, attrs: { id: 0 } });
    const reference: NodeJSON = { type: "commentReference", attrs: { id: 0 }, marks: [del(2)] };
    const editor = createEditor({
      document: {
        schemaVersion: 5,
        section: {},
        defaults: {},
        styles: STYLES,
        numbering: { abstracts: [], instances: [] },
        comments: [{ id: 0, author: "A", content: [p({}, text("note"))] }],
        content: {
          type: "doc",
          content: [
            p(
              {},
              anchor("commentStart"),
              text("a"),
              anchor("commentEnd"),
              text("Y", [del(2)]),
              reference,
              text("b"),
              text("X", [ins(1)]),
            ),
          ],
        },
      },
    });
    const y = trackedChanges(editor.state.doc).find((c) => c.kind === "deletion");
    editor.select(y?.from ?? 0, y?.to ?? 0);
    expect(editor.run(acceptChangeAndNext)).toBe(true);
    expect(editor.getDocument().comments).toEqual([]);
    const { from, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(from, to)).toBe("X");
  });

  it("accepts only the selected part of a change", () => {
    const editor = editorOf(p({}, text("XXXXXX", [ins(1)])));
    editor.select(3, 5);
    editor.commands.acceptChange();
    expect(blocks(editor)).toEqual([p({}, text("XX", [ins(1)]), text("XX"), text("XX", [ins(1)]))]);
  });

  it("keeps a table after a paragraph whose deleted mark is accepted", () => {
    const table: NodeJSON = { type: "opaqueBlock", attrs: { xml: "<w:tbl/>" } };
    const editor = editorOf(p({ revision: { deletion: by(3) } }, text("a")), table);
    editor.commands.acceptAllChanges();
    expect(blocks(editor)).toEqual([p({}, text("a")), table]);
  });

  it("records nothing while tracking, and undo takes it back", () => {
    const editor = createEditor({
      document: {
        schemaVersion: 5,
        section: {},
        defaults: {},
        styles: STYLES,
        numbering: { abstracts: [], instances: [] },
        comments: [],
        content: { type: "doc", content: [p({}, text("a"), text("X", [ins(1)]))] },
      },
      trackChanges: true,
    });
    editor.commands.rejectAllChanges();
    expect(blocks(editor)).toEqual([p({}, text("a"))]);
    editor.commands.undo();
    expect(blocks(editor)).toEqual([p({}, text("a"), text("X", [ins(1)]))]);
  });
});
