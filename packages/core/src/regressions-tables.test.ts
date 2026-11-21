/**
 * Regressions (tables, table commands): each test failed before its fix.
 * A cell with `vMerge: "continue"` is covered by the merge above it and is not drawn by the view,
 * so a caret there is invisible and what is typed goes into hidden content.
 */
import { describe, expect, it } from "vitest";
import type { Node, NodeJSON } from "./model/index.js";
import { createEditor } from "./state/editor.js";
import { TextSelection } from "./state/selection.js";
import { deleteRows, insertRow } from "./state/tablecommands.js";
import { goToCell } from "./state/tables.js";
import type { FoliDocument } from "./v3/document.js";

const text = (value: string): NodeJSON => ({ type: "text", text: value });
const p = (value = ""): NodeJSON => ({
  type: "paragraph",
  ...(value ? { content: [text(value)] } : {}),
});
const cell = (value: string, attrs?: Record<string, unknown>): NodeJSON => ({
  type: "tableCell",
  ...(attrs ? { attrs } : {}),
  content: [p(value)],
});
const row = (cells: NodeJSON[], attrs?: Record<string, unknown>): NodeJSON => ({
  type: "tableRow",
  ...(attrs ? { attrs } : {}),
  content: cells,
});
const table = (rows: NodeJSON[], attrs?: Record<string, unknown>): NodeJSON => ({
  type: "table",
  ...(attrs ? { attrs } : {}),
  content: rows,
});

function documentOf(...blocks: NodeJSON[]): FoliDocument {
  return {
    schemaVersion: 5,
    section: {},
    defaults: {},
    styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
    numbering: { abstracts: [], instances: [] },
    comments: [],
    content: { type: "doc", content: blocks },
  };
}
const editorOf = (blocks: NodeJSON[]) => createEditor({ document: documentOf(...blocks) });
type Editor = ReturnType<typeof editorOf>;

function inside(editor: Editor, value: string, at = 0): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isTextblock && node.textContent === value) found = pos + 1 + at;
  });
  if (found < 0) throw new Error(`no paragraph ${value}`);
  return found;
}
const select = (editor: Editor, from: number, to = from) =>
  editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
const tableOf = (editor: Editor): Node => editor.state.doc.child(0);
/** Each row's cells: text, `^` starting a vertical merge, `|` covered by one. */
function shape(t: Node): string[] {
  const out: string[] = [];
  t.forEach((r) => {
    const cells: string[] = [];
    r.forEach((c) => {
      const v = c.attrs.vMerge ? (c.attrs.vMerge === "restart" ? "^" : "|") : "";
      cells.push(`${c.textContent}${v}`);
    });
    out.push(cells.join(" "));
  });
  return out;
}
const merged3 = () =>
  table([
    row([cell("a1", { vMerge: "restart" }), cell("b1")]),
    row([cell("", { vMerge: "continue" }), cell("b2")]),
    row([cell("", { vMerge: "continue" }), cell("b3")]),
  ]);
const headCell = (editor: Editor) => {
  const $head = editor.state.selection.$head;
  for (let d = $head.depth; d > 0; d--)
    if ($head.node(d).type.name === "tableCell") return $head.node(d);
  throw new Error("not in a cell");
};

describe("caret after row commands", () => {
  it("insertRow below does not leave the caret in a cell a merge covers", () => {
    const editor = editorOf([merged3(), p("end")]);
    select(editor, inside(editor, "b1"));
    expect(editor.run(insertRow(1))).toBe(true);
    expect(shape(tableOf(editor))).toEqual(["a1^ b1", "| ", "| b2", "| b3"]);
    expect(headCell(editor).attrs.vMerge).not.toBe("continue");
  });

  it("deleteRows does not leave the caret in a cell a merge covers", () => {
    const editor = editorOf([merged3(), p("end")]);
    select(editor, inside(editor, "b2"));
    expect(editor.run(deleteRows)).toBe(true);
    expect(shape(tableOf(editor))).toEqual(["a1^ b1", "| b3"]);
    expect(headCell(editor).attrs.vMerge).not.toBe("continue");
  });

  it("Tab from a covered cell goes to the next cell, not the table's first", () => {
    const editor = editorOf([merged3(), p("end")]);
    // The covered cell of row 2 (where insertRow / deleteRows put the caret).
    select(editor, inside(editor, "b1") + 5);
    expect(headCell(editor).attrs.vMerge).toBe("continue");
    expect(editor.run(goToCell(1))).toBe(true);
    expect(editor.state.selection.$head.parent.textContent).toBe("b2");
  });
});

describe("header rows", () => {
  it("insertRow above the header row keeps the header rows a run from the table's top", () => {
    const editor = editorOf([
      table([row([cell("h1"), cell("h2")], { header: true }), row([cell("a1"), cell("a2")])]),
      p("end"),
    ]);
    select(editor, inside(editor, "h1"));
    expect(editor.run(insertRow(-1))).toBe(true);
    const headers: boolean[] = [];
    tableOf(editor).forEach((r) => {
      headers.push(r.attrs.header === true);
    });
    // Word repeats only header rows that start at the table's first row: the old header row
    // must not end up under an ordinary row (it would silently stop repeating).
    expect(headers.indexOf(true)).toBe(0);
  });
});
