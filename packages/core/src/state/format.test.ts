import { describe, expect, it } from "vitest";
import { createDocument } from "../document.js";
import type { NodeJSON } from "../model/index.js";
import type { DocJSON } from "../schema.js";
import {
  alignAt,
  colorAt,
  createEditor,
  type Editor,
  NodeSelection,
  TextSelection,
} from "./index.js";

const t = (text: string, ...marks: object[]): NodeJSON =>
  (marks.length ? { type: "text", text, marks } : { type: "text", text }) as NodeJSON;
const p = (text?: string, attrs?: object): NodeJSON =>
  ({
    type: "paragraph",
    ...(attrs ? { attrs } : {}),
    ...(text ? { content: [t(text)] } : {}),
  }) as NodeJSON;
const h1 = (text: string, attrs: object = {}): NodeJSON =>
  ({ type: "heading", attrs: { level: 1, ...attrs }, content: [t(text)] }) as NodeJSON;
const hr: NodeJSON = { type: "horizontalRule" };
const item = (...content: NodeJSON[]): NodeJSON => ({ type: "listItem", content });
const ul = (...items: NodeJSON[]): NodeJSON => ({ type: "bulletList", content: items });
const color = (type: string, value: string) => ({ type, attrs: { color: value } });

function editorWith(...blocks: NodeJSON[]): Editor {
  return createEditor({ document: createDocument({ type: "doc", content: blocks } as DocJSON) });
}
const json = (editor: Editor) => editor.getDocument().content.content;
const selectNode = (editor: Editor, pos: number) =>
  editor.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));

/** Runs `act`, checks the result, then undo restores the exact document and selection. */
function expectUndoable(editor: Editor, act: () => boolean, after: NodeJSON[]): void {
  const before = editor.state.doc;
  const selection = editor.state.selection;
  expect(act()).toBe(true);
  expect(json(editor)).toEqual(after);
  editor.state.doc.check();
  expect(editor.commands.undo()).toBe(true);
  expect(editor.state.doc.eq(before)).toBe(true);
  expect(editor.state.selection.eq(selection)).toBe(true);
}

describe("alignment", () => {
  it("setAlign aligns the selected paragraphs and headings; start removes it", () => {
    const editor = editorWith(h1("title"), p("a"), hr, p("b"));
    editor.commands.selectAll();
    expectUndoable(editor, () => editor.commands.setAlign("center"), [
      h1("title", { align: "center" }),
      p("a", { align: "center" }),
      hr,
      p("b", { align: "center" }),
    ]);
    editor.commands.setAlign("justify");
    expect(alignAt(editor.state)).toBe("justify");
    editor.select(9);
    editor.commands.setAlign("start");
    expect(json(editor)[1]).toEqual(p("a")); // the default is not written
    editor.commands.selectAll();
    expect(alignAt(editor.state)).toBeNull(); // mixed
    editor.select(2);
    expect(alignAt(editor.state)).toBe("justify");
    // Already aligned: nothing to do; an unknown value never applies.
    expect(editor.commands.setAlign("justify")).toBe(false);
    expect(editor.commands.setAlign("left" as never)).toBe(false);
  });

  it("aligns paragraphs inside list items, not the list", () => {
    const editor = editorWith(ul(item(p("a")), item(p("b"))));
    editor.commands.selectAll();
    expect(editor.commands.setAlign("end")).toBe(true);
    expect(json(editor)).toEqual([
      ul(item(p("a", { align: "end" })), item(p("b", { align: "end" }))),
    ]);
  });
});

describe("colors", () => {
  it("setTextColor and setHighlight color a range, replace a color, and remove it", () => {
    const editor = editorWith(p("abcd"));
    editor.select(1, 3);
    expectUndoable(editor, () => editor.commands.setTextColor("#c00000"), [
      { type: "paragraph", content: [t("ab", color("textColor", "#c00000")), t("cd")] },
    ]);
    editor.commands.setTextColor("#C00000"); // uppercase is lowered
    expect(colorAt(editor.state, "textColor")).toBe("#c00000");
    editor.select(1, 5);
    expect(colorAt(editor.state, "textColor")).toBeNull(); // mixed
    expect(editor.commands.setTextColor("#1f5fbf")).toBe(true);
    expect(editor.commands.setHighlight("#fff59d")).toBe(true);
    expect(json(editor)).toEqual([
      {
        type: "paragraph",
        content: [t("abcd", color("textColor", "#1f5fbf"), color("highlight", "#fff59d"))],
      },
    ]);
    expect(colorAt(editor.state, "highlight")).toBe("#fff59d");
    expect(editor.commands.setTextColor(null)).toBe(true);
    expect(editor.commands.setHighlight(null)).toBe(true);
    expect(json(editor)).toEqual([p("abcd")]);
    expect(editor.commands.setHighlight(null)).toBe(false);
  });

  it("rejects colors that are not #rrggbb", () => {
    const editor = editorWith(p("ab"));
    editor.select(1, 3);
    for (const bad of ["red", "#fff", "#12345g", "rgb(0,0,0)", "", "#0000001"]) {
      expect(editor.commands.setTextColor(bad)).toBe(false);
      expect(editor.commands.setHighlight(bad)).toBe(false);
    }
    expect(json(editor)).toEqual([p("ab")]);
  });

  it("at a caret, colors the text typed next", () => {
    const editor = editorWith(p("ab"));
    editor.select(2);
    expect(editor.commands.setTextColor("#c00000")).toBe(true);
    expect(colorAt(editor.state, "textColor")).toBe("#c00000");
    expect(editor.commands.setTextColor("#c00000")).toBe(false); // already
    editor.commands.insertText("x");
    expect(json(editor)).toEqual([
      { type: "paragraph", content: [t("a"), t("x", color("textColor", "#c00000")), t("b")] },
    ]);
  });
});

describe("horizontal rules", () => {
  it("inserts a rule at a textblock's end (with a paragraph after), start, or middle", () => {
    const end = editorWith(p("ab"), p("c"));
    end.select(3);
    expectUndoable(end, () => end.commands.insertHorizontalRule(), [p("ab"), hr, p(), p("c")]);
    end.commands.insertHorizontalRule();
    expect(end.state.selection.$from.parent.content.size).toBe(0); // in the new paragraph
    end.commands.insertText("x");
    expect(json(end)).toEqual([p("ab"), hr, p("x"), p("c")]);

    const start = editorWith(p("ab"));
    start.select(1);
    expectUndoable(start, () => start.commands.insertHorizontalRule(), [hr, p("ab")]);

    const middle = editorWith(p("ab"));
    middle.select(2);
    expectUndoable(middle, () => middle.commands.insertHorizontalRule(), [p("a"), hr, p("b")]);
    middle.commands.insertHorizontalRule();
    expect(middle.state.selection.$from.parent.textContent).toBe("b");
  });

  it("replaces a range; with a rule selected, inserts after it; inside list items too", () => {
    const range = editorWith(p("abcd"));
    range.select(2, 4);
    expect(range.commands.insertHorizontalRule()).toBe(true);
    expect(json(range)).toEqual([p("a"), hr, p("d")]);

    const selected = editorWith(p("a"), hr, p("b"));
    selectNode(selected, 3);
    expect(selected.commands.insertHorizontalRule()).toBe(true);
    expect(json(selected)).toEqual([p("a"), hr, hr, p("b")]);

    const list = editorWith(ul(item(p("ab"))));
    list.select(5); // end of "ab"
    expectUndoable(list, () => list.commands.insertHorizontalRule(), [ul(item(p("ab"), hr, p()))]);
    // A list item starts with a paragraph: no rule before its first one.
    list.select(3);
    expect(list.commands.insertHorizontalRule()).toBe(false);
    list.state.doc.check();
  });

  it("typing over a selected rule replaces it with a paragraph; Enter adds one after it", () => {
    const editor = editorWith(p("a"), hr, p("b"));
    selectNode(editor, 3);
    expectUndoable(editor, () => editor.commands.insertText("x"), [p("a"), p("x"), p("b")]);
    editor.commands.insertText("x");
    expect(editor.state.selection.from).toBe(5); // after the x
    editor.commands.undo();
    selectNode(editor, 3);
    expectUndoable(editor, () => editor.handleKey("Enter"), [p("a"), hr, p(), p("b")]);
    // Backspace and Delete on a selected rule delete it.
    selectNode(editor, 3);
    expect(editor.handleKey("Backspace")).toBe(true);
    expect(json(editor)).toEqual([p("a"), p("b")]);
  });

  it("arrows select a rule from the text beside it, and leave it to the text beyond", () => {
    const editor = editorWith(p("ab"), hr, p("cd"));
    const at = (pos: number) => editor.select(pos);
    const selected = () => editor.state.selection instanceof NodeSelection;
    at(3); // end of "ab"
    expect(editor.handleKey("ArrowRight")).toBe(true);
    expect(selected() && editor.state.selection.from).toBe(4);
    expect(editor.handleKey("ArrowRight")).toBe(true);
    expect(editor.state.selection.eq(TextSelection.create(editor.state.doc, 6))).toBe(true);
    expect(editor.handleKey("ArrowLeft")).toBe(true); // start of "cd": back onto the rule
    expect(selected()).toBe(true);
    expect(editor.handleKey("ArrowUp")).toBe(true);
    expect(editor.state.selection.eq(TextSelection.create(editor.state.doc, 3))).toBe(true);
    // Not at the textblock's edge, or a textblock beside: the browser moves the caret.
    at(2);
    expect(editor.handleKey("ArrowRight")).toBe(false);
    at(1);
    expect(editor.handleKey("ArrowLeft")).toBe(false);
    // Up/Down from a caret need the view's line check; from a rule they move.
    at(3);
    expect(editor.handleKey("ArrowDown")).toBe(false);
    selectNode(editor, 4);
    expect(editor.handleKey("ArrowDown")).toBe(true);
    expect(editor.state.selection.from).toBe(6);
  });

  it("arrows cross list boundaries, stop at the document's edge, and step rule to rule", () => {
    const editor = editorWith(ul(item(p("a"), hr)), p("b"));
    editor.select(9); // start of "b"
    expect(editor.handleKey("ArrowLeft")).toBe(true);
    expect(editor.state.selection.from).toBe(5); // the rule, inside the list item
    expect(editor.handleKey("ArrowLeft")).toBe(true);
    expect(editor.state.selection.eq(TextSelection.create(editor.state.doc, 4))).toBe(true);

    const edges = editorWith(hr, hr);
    selectNode(edges, 0);
    expect(edges.handleKey("ArrowUp")).toBe(true); // stays
    expect(edges.state.selection.from).toBe(0);
    expect(edges.handleKey("ArrowRight")).toBe(true);
    expect(edges.state.selection instanceof NodeSelection && edges.state.selection.from).toBe(1);
  });
});
