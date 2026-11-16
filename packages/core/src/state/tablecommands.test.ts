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
  isHeaderRow,
  mergeCells,
  setCellShading,
  setColumnWidth,
  setTableStyle,
  splitCell,
  tableStyleAt,
  tableStyles,
  toggleHeaderRow,
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
    expect(shape(editor)).toEqual(["ab"]);
    valid(editor);
  });

  it("gives the first half a new paragraph mark, the second the original one", () => {
    const marked = {
      type: "paragraph",
      attrs: { section: {}, attributes: { "w14:paraId": "1234ABCD" } },
      content: [text("abcd")],
    } as NodeJSON;
    const editor = editorOf([marked, p("z")]);
    select(editor, 3);
    editor.run(insertTable(1, 1));
    const first = editor.state.doc.child(0);
    const second = editor.state.doc.child(2);
    expect(first.attrs.section).toBe(null);
    expect(first.attrs.attributes).toBe(null);
    expect(second.attrs.section).toEqual({});
    expect(second.attrs.attributes).toEqual({ "w14:paraId": "1234ABCD" });
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

  it("apply from a cell a merge covers, as from the merge", () => {
    const merged = table(row(restart("m"), cell("b1")), row(covered(), cell("b2")));
    const editor = editorOf([p("x"), merged, p("y")]);
    // The covered cell's empty paragraph.
    const coveredPos = inside(editor, "b1") + 8;
    expect(editor.state.doc.resolve(coveredPos).node(-1).attrs.vMerge).toBe("continue");
    select(editor, coveredPos);
    expect(editor.run(insertRow(1))).toBe(true);
    expect(editor.state.doc.child(1).childCount).toBe(3);
  });

  it("keep the caret in the table after deleting its last row", () => {
    const editor = editorOf([p("x"), TABLE, p("y")]);
    select(editor, inside(editor, "a3"));
    editor.run(deleteRows);
    expect(caret(editor)).toBe("a2");
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

  it("stop at Word's 63 columns; a table without a grid keeps none", () => {
    const many = table(row(...Array.from({ length: 63 }, (_v, i) => cell(`c${i}`))));
    const editor = editorOf([p("x"), many, p("y")]);
    select(editor, inside(editor, "c0"));
    expect(editor.run(insertColumn(1))).toBe(false);
    const gridless = editorOf([p("x"), TABLE, p("y")]);
    select(gridless, inside(gridless, "a1"));
    gridless.run(insertColumn(1));
    expect(gridless.state.doc.child(1).attrs.grid).toEqual([]);
    valid(gridless);
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

describe("merging and splitting cells", () => {
  it("merge a rectangle into its first cell, spanning and merging down, with all its text", () => {
    const editor = editorOf([
      p("x"),
      { ...TABLE, attrs: { grid: [1000, 2000] } } as NodeJSON,
      p("y"),
    ]);
    selectCells(editor, "a1", "b2");
    expect(editor.run(mergeCells)).toBe(true);
    const rows = editor.state.doc.child(1);
    const first = rows.child(0).child(0);
    expect(first.attrs.gridSpan).toBe(2);
    expect(first.attrs.vMerge).toBe("restart");
    expect(rows.child(1).child(0).attrs.vMerge).toBe("continue");
    expect(rows.child(0).childCount).toBe(1);
    const texts: string[] = [];
    first.forEach((block) => {
      texts.push(block.textContent);
    });
    expect(texts).toEqual(["a1", "b1", "a2", "b2"]);
    expect(caret(editor)).toBe("a1");
    valid(editor);
  });

  it("split a merged cell back into its grid's cells, its text in the first", () => {
    const editor = editorOf([
      p("x"),
      { ...TABLE, attrs: { grid: [1000, 2000] } } as NodeJSON,
      p("y"),
    ]);
    selectCells(editor, "a1", "b2");
    editor.run(mergeCells);
    expect(editor.run(splitCell)).toBe(true);
    const rows = editor.state.doc.child(1);
    expect(rows.child(0).childCount).toBe(2);
    expect(rows.child(1).childCount).toBe(2);
    expect(rows.child(1).child(0).attrs.vMerge).toBe(null);
    expect(rows.child(0).child(0).childCount).toBe(4);
    expect(shape(editor)[1]).toEqual([
      ["a1b1a2b2", ""],
      ["", ""],
      ["a3", "b3"],
    ]);
    valid(editor);
    expect(editor.run(splitCell)).toBe(false);
  });

  it("do not merge a single cell, a ragged rectangle, or while tracking", () => {
    const editor = editorOf([p("x"), TABLE, p("y")]);
    selectCells(editor, "a1", "a1");
    expect(editor.run(mergeCells)).toBe(false);
    const ragged = editorOf([
      p("x"),
      table(row(cell("p"), cell("q")), {
        type: "tableRow",
        attrs: { gridAfter: 1 },
        content: [cell("r")],
      }),
      p("y"),
    ]);
    selectCells(ragged, "q", "r");
    // The rectangle reaches q's column, where the second row has no cell.
    expect(ragged.run(mergeCells)).toBe(false);
    const tracked = editorOf([p("x"), TABLE, p("y")], true);
    selectCells(tracked, "a1", "b1");
    expect(tracked.run(mergeCells)).toBe(false);
  });
});

describe("table properties", () => {
  it("make header rows from the top, and take them off", () => {
    const editor = editorOf([p("x"), TABLE, p("y")]);
    select(editor, inside(editor, "a2"));
    editor.run(toggleHeaderRow);
    const headers = () => {
      const out: boolean[] = [];
      editor.state.doc.child(1).forEach((r) => {
        out.push(r.attrs.header === true);
      });
      return out;
    };
    expect(headers()).toEqual([true, true, false]);
    expect(isHeaderRow(editor.state)).toBe(true);
    select(editor, inside(editor, "a2"));
    editor.run(toggleHeaderRow);
    expect(headers()).toEqual([true, false, false]);
    valid(editor);
  });

  it("set a table style by name, adding Word's Table Grid, or none", () => {
    const editor = editorOf([p("x"), TABLE, p("y")]);
    expect(tableStyles(editor.state)).toContain("Table Grid");
    select(editor, inside(editor, "a1"));
    expect(editor.run(setTableStyle("Table Grid"))).toBe(true);
    expect(tableStyleAt(editor.state)).toBe("Table Grid");
    expect(editor.run(setTableStyle("No Such Style"))).toBe(false);
    editor.run(setTableStyle(null));
    expect(tableStyleAt(editor.state)).toBe(null);
  });

  it("shade the selected cells and take it off", () => {
    const editor = editorOf([p("x"), TABLE, p("y")]);
    selectCells(editor, "a1", "a2");
    expect(editor.run(setCellShading("ffcc00"))).toBe(true);
    const fills = () => {
      const out: (string | null)[] = [];
      editor.state.doc.child(1).forEach((r) => {
        out.push((r.child(0).attrs.shading as { fill?: string } | null)?.fill ?? null);
      });
      return out;
    };
    expect(fills()).toEqual(["FFCC00", "FFCC00", null]);
    expect(editor.run(setCellShading("red"))).toBe(false);
    editor.run(setCellShading(null));
    expect(fills()).toEqual([null, null, null]);
    valid(editor);
  });

  it("move a column border: the next column gives the difference, cell widths follow", () => {
    const sized: NodeJSON = {
      type: "table",
      attrs: { grid: [2000, 2000] },
      content: [
        row(
          { type: "tableCell", attrs: { width: { value: 2000, type: "dxa" } }, content: [p("a")] },
          { type: "tableCell", attrs: { width: { value: 2000, type: "dxa" } }, content: [p("b")] },
        ),
      ],
    };
    const editor = editorOf([p("x"), sized, p("y")]);
    select(editor, inside(editor, "b", 1));
    const tablePos = editor.state.doc.child(0).nodeSize;
    expect(editor.run(setColumnWidth(tablePos, 0, 2500))).toBe(true);
    const rows = editor.state.doc.child(1);
    expect(rows.attrs.grid).toEqual([2500, 1500]);
    expect(rows.child(0).child(1).attrs.width).toEqual({ value: 1500, type: "dxa" });
    // The selection stays.
    expect(editor.state.selection.head).toBe(inside(editor, "b", 1));
    // Not narrower than 0.1 inch on either side.
    editor.run(setColumnWidth(tablePos, 0, 99999));
    expect(editor.state.doc.child(1).attrs.grid).toEqual([3856, 144]);
    // The last column's border widens the table.
    editor.run(setColumnWidth(tablePos, 1, 3000));
    expect(editor.state.doc.child(1).attrs.grid).toEqual([3856, 3000]);
    valid(editor);
  });
});

describe("cell commands: review findings", () => {
  const nested = table(row(cell("in")));
  it("merge and split cells starting with a nested table", () => {
    const editor = editorOf([
      p("x"),
      table(
        row(cell("a1"), cell("b1")),
        row({ type: "tableCell", content: [nested, p("after")] }, cell("b2")),
      ),
      p("y"),
    ]);
    const $after = editor.state.doc.resolve(inside(editor, "after"));
    editor.dispatch(
      editor.state.tr.setSelection(
        CellSelection.create(
          editor.state.doc,
          cellPos(editor, "a1"),
          $after.before($after.depth - 1),
        ),
      ),
    );
    expect(editor.run(mergeCells)).toBe(true);
    valid(editor);
    const wide = editorOf([
      p("x"),
      table(
        row({ type: "tableCell", attrs: { gridSpan: 2 }, content: [nested, p("after")] }),
        row(cell("a2"), cell("b2")),
      ),
      p("y"),
    ]);
    select(wide, inside(wide, "after"));
    expect(wide.run(splitCell)).toBe(true);
    valid(wide);
  });

  it("give split cells empty paragraphs without the paragraph's identity or revision", () => {
    const marked = {
      type: "paragraph",
      attrs: {
        attributes: { "w14:paraId": "1234ABCD" },
        revision: { insertion: { id: 7, author: "A", date: null } },
      },
      content: [text("w")],
    } as NodeJSON;
    const editor = editorOf([
      p("x"),
      table(
        row({ type: "tableCell", attrs: { gridSpan: 2 }, content: [marked] }),
        row(cell("a2"), cell("b2")),
      ),
      p("y"),
    ]);
    select(editor, inside(editor, "w"));
    editor.run(splitCell);
    const fresh = editor.state.doc.child(1).child(0).child(1).firstChild;
    expect(fresh?.attrs.attributes).toBe(null);
    expect(fresh?.attrs.revision).toBe(null);
  });

  it("keep the text a covered cell holds when merging", () => {
    const editor = editorOf([
      p("x"),
      table(
        row(restart("a1"), cell("b1")),
        row(
          { type: "tableCell", attrs: { vMerge: "continue" }, content: [p("hidden")] },
          cell("b2"),
        ),
      ),
      p("y"),
    ]);
    selectCells(editor, "a1", "b2");
    editor.run(mergeCells);
    const texts: string[] = [];
    editor.state.doc
      .child(1)
      .child(0)
      .child(0)
      .forEach((block) => {
        texts.push(block.textContent);
      });
    expect(texts).toEqual(["a1", "b1", "hidden", "b2"]);
  });

  it("refuse column widths a grid cannot take; never narrow a column asked to widen", () => {
    const tiny = editorOf([p("x"), { ...TABLE, attrs: { grid: [0, 0] } } as NodeJSON, p("y")]);
    const at = tiny.state.doc.child(0).nodeSize;
    expect(tiny.run(setColumnWidth(at, 0, 500))).toBe(false);
    const small = editorOf([p("x"), { ...TABLE, attrs: { grid: [100, 50] } } as NodeJSON, p("y")]);
    expect(small.run(setColumnWidth(at, 0, 500))).toBe(false);
    const last = editorOf([
      p("x"),
      { ...TABLE, attrs: { grid: [1000, 1000] } } as NodeJSON,
      p("y"),
    ]);
    expect(last.run(setColumnWidth(at, 1, 50_000))).toBe(true);
    expect(last.state.doc.child(1).attrs.grid).toEqual([1000, 31_680]);
  });

  it("shade every cell of a vertical merge", () => {
    const editor = editorOf([
      p("x"),
      table(row(restart("m"), cell("b1")), row(covered(), cell("b2"))),
      p("y"),
    ]);
    select(editor, inside(editor, "m"));
    editor.run(setCellShading("ff0000"));
    const rows = editor.state.doc.child(1);
    expect((rows.child(0).child(0).attrs.shading as { fill: string }).fill).toBe("FF0000");
    expect((rows.child(1).child(0).attrs.shading as { fill: string }).fill).toBe("FF0000");
    expect(rows.child(0).child(1).attrs.shading).toBe(null);
  });

  it("refuse a built-in style of another type as a table style", () => {
    const editor = editorOf([p("x"), TABLE, p("y")]);
    select(editor, inside(editor, "a1"));
    expect(editor.run(setTableStyle("heading 1"))).toBe(false);
    expect(editor.getDocument().styles.some((s) => s.id === "Heading1")).toBe(false);
  });

  it("are each their own undo step", () => {
    const editor = editorOf([p("x"), TABLE, p("y")]);
    selectCells(editor, "a1", "b1");
    editor.run(mergeCells);
    editor.run(splitCell);
    editor.commands.undo();
    expect(editor.state.doc.child(1).child(0).childCount).toBe(1);
  });
});
