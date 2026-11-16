import { describe, expect, it } from "vitest";
import type { NodeJSON } from "../model/index.js";
import type { FoliDocument } from "../v3/document.js";
import { parseContent } from "../v3/document.js";
import { createEditor } from "./editor.js";
import { TextSelection } from "./selection.js";
import {
  deleteColumns,
  deleteRows,
  deleteTable,
  insertColumn,
  insertRow,
  insertTable,
} from "./tablecommands.js";
import { CellSelection } from "./tables.js";

/** Table commands (10.7, ADR-0006). */
const text = (value: string): NodeJSON => ({ type: "text", text: value });
const p = (value = ""): NodeJSON => ({
  type: "paragraph",
  ...(value ? { content: [text(value)] } : {}),
});
const cell = (...values: string[]): NodeJSON => ({
  type: "tableCell",
  content: (values.length ? values : [""]).map((v) => p(v)),
});
const row = (...cells: NodeJSON[]): NodeJSON => ({ type: "tableRow", content: cells });
const table = (...rows: NodeJSON[]): NodeJSON => ({ type: "table", content: rows });

const TABLE = table(
  row(cell("a1"), cell("b1")),
  row(cell("a2"), cell("b2")),
  row(cell("a3"), cell("b3")),
);

function documentOf(...blocks: NodeJSON[]): FoliDocument {
  return {
    schemaVersion: 4,
    section: {},
    defaults: {},
    styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
    numbering: { abstracts: [], instances: [] },
    comments: [],
    content: { type: "doc", content: blocks },
  };
}
const editorOf = (blocks: NodeJSON[], tracking = false) =>
  createEditor({
    document: documentOf(...blocks),
    ...(tracking ? { author: "Me", trackChanges: true } : {}),
  });
type Editor = ReturnType<typeof editorOf>;

/** The position at offset `at` in the paragraph whose text is `value`. */
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
/** Every paragraph's text, depth first, tables' rows as [cells…]. */
function shape(editor: Editor): unknown[] {
  const out: unknown[] = [];
  editor.state.doc.forEach((block) => {
    if (block.type.name !== "table") out.push(block.textContent);
    else {
      const rows: string[][] = [];
      block.forEach((r) => {
        const cells: string[] = [];
        r.forEach((c) => {
          cells.push(c.textContent);
        });
        rows.push(cells);
      });
      out.push(rows);
    }
  });
  return out;
}
const valid = (editor: Editor) => parseContent(editor.state.doc.toJSON());
const cellPos = (editor: Editor, value: string) => inside(editor, value) - 2;
const selectCells = (editor: Editor, from: string, to: string) =>
  editor.dispatch(
    editor.state.tr.setSelection(
      CellSelection.create(editor.state.doc, cellPos(editor, from), cellPos(editor, to)),
    ),
  );
const restart = (value: string): NodeJSON => ({
  type: "tableCell",
  attrs: { vMerge: "restart" },
  content: [p(value)],
});
const covered = (): NodeJSON => ({
  type: "tableCell",
  attrs: { vMerge: "continue" },
  content: [p()],
});
/** The head cell's paragraph text and the table's row and column there. */
const caret = (editor: Editor) => editor.state.selection.$head.parent.textContent;

describe("insertTable", () => {
  it("splits the paragraph at the caret, with Word's Table Grid style and the caret inside", () => {
    const editor = editorOf([p("abcd")]);
    select(editor, 3);
    expect(editor.run(insertTable(2, 3))).toBe(true);
    expect(shape(editor)).toEqual([
      "ab",
      [
        ["", "", ""],
        ["", "", ""],
      ],
      "cd",
    ]);
    const table = editor.state.doc.child(1);
    expect((table.attrs.grid as number[]).length).toBe(3);
    const style = editor.getDocument().styles.find((s) => s.id === table.attrs.style);
    expect(style?.name).toBe("Table Grid");
    expect(editor.state.selection.$head.node(-1).type.name).toBe("tableCell");
    valid(editor);
  });

  it("puts a paragraph after a table inserted at the end of the last paragraph", () => {
    const editor = editorOf([p("end")]);
    select(editor, 4);
    editor.run(insertTable(1, 1));
    expect(shape(editor)).toEqual(["end", [[""]], ""]);
    valid(editor);
  });

  it("refuses sizes past Word's limits", () => {
    const editor = editorOf([p("x")]);
    expect(editor.run(insertTable(0, 2))).toBe(false);
    expect(editor.run(insertTable(2, 64))).toBe(false);
  });

  it("records the inserted rows while tracking; rejecting removes the table", () => {
    const editor = editorOf([p("ab")], true);
    select(editor, 2);
    editor.run(insertTable(2, 2));
    const table = editor.state.doc.child(1);
    expect(table.child(0).attrs.revision).toMatchObject({ insertion: { author: "Me" } });
    editor.commands.rejectAllChanges();
    expect(shape(editor).some((block) => Array.isArray(block))).toBe(false);
    valid(editor);
  });
});

describe("rows", () => {
  it("insert above and below the selection, like its row, empty", () => {
    const editor = editorOf([p("x"), TABLE, p("y")]);
    select(editor, inside(editor, "a2"));
    editor.run(insertRow(1));
    select(editor, inside(editor, "a1"));
    editor.run(insertRow(-1));
    expect(shape(editor)[1]).toEqual([
      ["", ""],
      ["a1", "b1"],
      ["a2", "b2"],
      ["", ""],
      ["a3", "b3"],
    ]);
    valid(editor);
  });

  it("continue a vertical merge the new row is inside", () => {
    const merged = table(row(restart("m"), cell("b1")), row(covered(), cell("b2")));
    const editor = editorOf([p("x"), merged, p("y")]);
    select(editor, inside(editor, "b1"));
    editor.run(insertRow(1));
    const rows = editor.state.doc.child(1);
    expect(rows.child(1).child(0).attrs.vMerge).toBe("continue");
    expect(rows.child(2).child(0).attrs.vMerge).toBe("continue");
    valid(editor);
  });

  it("delete the selected rows; a merge starting in one goes on from the next, with its text", () => {
    const merged = table(
      row(cell("a1"), cell("b1")),
      row(restart("m"), cell("b2")),
      row(covered(), cell("b3")),
    );
    const editor = editorOf([p("x"), merged, p("y")]);
    select(editor, inside(editor, "b2"));
    expect(editor.run(deleteRows)).toBe(true);
    expect(shape(editor)[1]).toEqual([
      ["a1", "b1"],
      ["m", "b3"],
    ]);
    expect(editor.state.doc.child(1).child(1).child(0).attrs.vMerge).toBe("restart");
    valid(editor);
  });

  it("deleting every row deletes the table", () => {
    const editor = editorOf([p("x"), TABLE, p("y")]);
    selectCells(editor, "a1", "a3");
    editor.run(deleteRows);
    expect(shape(editor)).toEqual(["x", "y"]);
    valid(editor);
  });

  it("are tracked deletions while tracking", () => {
    const editor = editorOf([p("x"), TABLE, p("y")], true);
    selectCells(editor, "a2", "b2");
    editor.run(deleteRows);
    const rows = editor.state.doc.child(1);
    expect(rows.childCount).toBe(3);
    expect(rows.child(1).attrs.revision).toMatchObject({ deletion: { author: "Me" } });
    editor.commands.acceptAllChanges();
    expect(shape(editor)[1]).toEqual([
      ["a1", "b1"],
      ["a3", "b3"],
    ]);
  });
});

describe("columns", () => {
  const wide = () => ({ ...TABLE, attrs: { grid: [1000, 2000] } }) as NodeJSON;

  it("insert left and right of the selection, as wide as its column", () => {
    const editor = editorOf([p("x"), wide(), p("y")]);
    select(editor, inside(editor, "a1"));
    expect(editor.run(insertColumn(1))).toBe(true);
    expect(shape(editor)[1]).toEqual([
      ["a1", "", "b1"],
      ["a2", "", "b2"],
      ["a3", "", "b3"],
    ]);
    expect(editor.state.doc.child(1).attrs.grid).toEqual([1000, 1000, 2000]);
    select(editor, inside(editor, "a1"));
    editor.run(insertColumn(-1));
    expect(shape(editor)[1]).toEqual([
      ["", "a1", "", "b1"],
      ["", "a2", "", "b2"],
      ["", "a3", "", "b3"],
    ]);
    valid(editor);
  });

  it("widen a cell spanning the new column's place", () => {
    const spanning = table(
      row({ type: "tableCell", attrs: { gridSpan: 2 }, content: [p("wide")] }),
      row(cell("a2"), cell("b2")),
    );
    const editor = editorOf([p("x"), { ...spanning, attrs: { grid: [1000, 1000] } }, p("y")]);
    select(editor, inside(editor, "a2"));
    editor.run(insertColumn(1));
    const rows = editor.state.doc.child(1);
    expect(rows.child(0).child(0).attrs.gridSpan).toBe(3);
    expect(shape(editor)[1]).toEqual([["wide"], ["a2", "", "b2"]]);
    valid(editor);
  });

  it("delete the selected columns; a spanning cell narrows; all of them delete the table", () => {
    const spanning = table(
      row({ type: "tableCell", attrs: { gridSpan: 2 }, content: [p("wide")] }),
      row(cell("a2"), cell("b2")),
    );
    const editor = editorOf([p("x"), { ...spanning, attrs: { grid: [1000, 2000] } }, p("y")]);
    select(editor, inside(editor, "a2"));
    expect(editor.run(deleteColumns)).toBe(true);
    expect(shape(editor)[1]).toEqual([["wide"], ["b2"]]);
    const rows = editor.state.doc.child(1);
    expect(rows.attrs.grid).toEqual([2000]);
    expect(rows.child(0).child(0).attrs.gridSpan).toBe(null);
    valid(editor);
    select(editor, inside(editor, "b2"));
    editor.run(deleteColumns);
    expect(shape(editor)).toEqual(["x", "y"]);
  });

  it("do not apply while tracking", () => {
    const editor = editorOf([p("x"), TABLE, p("y")], true);
    select(editor, inside(editor, "a1"));
    expect(editor.run(insertColumn(1))).toBe(false);
    expect(editor.run(deleteColumns)).toBe(false);
  });
});

describe("deleteTable", () => {
  it("deletes the table around the caret, the caret after it", () => {
    const editor = editorOf([p("x"), TABLE, p("y")]);
    select(editor, inside(editor, "b2", 1));
    expect(editor.run(deleteTable)).toBe(true);
    expect(shape(editor)).toEqual(["x", "y"]);
    expect(caret(editor)).toBe("y");
    expect(editor.run(deleteTable)).toBe(false);
  });
});
