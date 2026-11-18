import { describe, expect, it } from "vitest";
import type { NodeJSON } from "../model/index.js";
import type { FoliDocument } from "../v3/document.js";
import { parseContent } from "../v3/document.js";
import { createEditor } from "./editor.js";
import { Selection, TextSelection } from "./selection.js";
import {
  CellSelection,
  cellsAsTable,
  extendCellSelection,
  goToCellVertically,
  pasteCells,
} from "./tables.js";
import { setWordAlign } from "./wordformat.js";

/** Editing across a table's edges (10.6, ADR-0006). */

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
    schemaVersion: 5,
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

describe("cells isolate their content", () => {
  it("Backspace at a cell's start and Delete at its end do nothing", () => {
    const editor = editorOf([p("x"), TABLE, p("y")]);
    select(editor, inside(editor, "b2"));
    expect(editor.commands.deleteBackward()).toBe(false);
    select(editor, inside(editor, "a2", 2));
    expect(editor.commands.deleteForward()).toBe(false);
    expect(shape(editor)[1]).toEqual([
      ["a1", "b1"],
      ["a2", "b2"],
      ["a3", "b3"],
    ]);
  });

  it("Enter splits a paragraph in a cell", () => {
    const editor = editorOf([p("x"), TABLE, p("y")]);
    select(editor, inside(editor, "a1", 1));
    editor.commands.splitBlock();
    expect(shape(editor)[1]).toEqual([
      ["a1", "b1"],
      ["a2", "b2"],
      ["a3", "b3"],
    ]);
    let count = 0;
    editor.state.doc
      .child(1)
      .child(0)
      .child(0)
      .forEach(() => {
        count++;
      });
    expect(count).toBe(2);
    valid(editor);
  });
});

describe("next to a table", () => {
  it("Backspace after it goes to its last cell's end; Delete before it to its first cell's start", () => {
    const editor = editorOf([p("x"), TABLE, p("y")]);
    select(editor, inside(editor, "y"));
    editor.commands.deleteBackward();
    expect(editor.state.selection.from).toBe(inside(editor, "b3", 2));
    select(editor, inside(editor, "x", 1));
    editor.commands.deleteForward();
    expect(editor.state.selection.from).toBe(inside(editor, "a1"));
    expect(shape(editor)).toHaveLength(3);
  });
});

describe("a selection across a table's edge", () => {
  it("from before the table into it: the text before goes, and the whole rows it touches", () => {
    const editor = editorOf([p("xx"), TABLE, p("y")]);
    select(editor, inside(editor, "xx", 1), inside(editor, "b2", 1));
    editor.commands.deleteSelection();
    expect(shape(editor)).toEqual(["x", [["a3", "b3"]], "y"]);
    valid(editor);
  });

  it("from a cell to after the table: the rows from there on go, and the text after", () => {
    const editor = editorOf([p("x"), TABLE, p("yy")]);
    select(editor, inside(editor, "a2", 1), inside(editor, "yy", 1));
    editor.commands.deleteSelection();
    expect(shape(editor)).toEqual(["x", [["a1", "b1"]], "y"]);
    valid(editor);
  });

  it("over every row: the whole table goes, and nothing is joined across it", () => {
    const editor = editorOf([p("xx"), TABLE, p("yy")]);
    select(editor, inside(editor, "a1", 1), inside(editor, "yy", 1));
    editor.commands.deleteSelection();
    expect(shape(editor)).toEqual(["xx", "y"]);
    valid(editor);
  });

  it("across cells of one table: those cells are emptied", () => {
    const editor = editorOf([p("x"), TABLE, p("y")]);
    select(editor, inside(editor, "a1", 1), inside(editor, "a2", 1));
    editor.commands.deleteSelection();
    expect(shape(editor)[1]).toEqual([
      ["", ""],
      ["", "b2"],
      ["a3", "b3"],
    ]);
    valid(editor);
  });

  it("typing over it replaces it with the text, outside the table", () => {
    const editor = editorOf([p("xx"), TABLE, p("y")]);
    select(editor, inside(editor, "xx", 1), inside(editor, "b1", 1));
    editor.commands.insertText("Z");
    expect(shape(editor)).toEqual([
      "xZ",
      [
        ["a2", "b2"],
        ["a3", "b3"],
      ],
      "y",
    ]);
  });

  it("between two tables: the paragraph Word needs between them stays", () => {
    const second = table(row(cell("c1")));
    const editor = editorOf([p("x"), TABLE, p("mid"), second, p("y")]);
    // From the end of the first table to the end of the paragraph between them.
    select(editor, inside(editor, "b3", 2), inside(editor, "mid", 3));
    editor.commands.deleteSelection();
    valid(editor);
    expect(shape(editor)).toEqual([
      "x",
      [
        ["a1", "b1"],
        ["a2", "b2"],
      ],
      "",
      [["c1"]],
      "y",
    ]);
  });
});

describe("tracked changes in tables", () => {
  it("text in a cell is tracked as everywhere", () => {
    const editor = editorOf([p("x"), TABLE, p("y")], true);
    select(editor, inside(editor, "a2", 2));
    editor.commands.insertText("!");
    select(editor, inside(editor, "b2", 1), inside(editor, "b2", 2));
    editor.commands.deleteSelection();
    const changes = editor.commands;
    expect(changes).toBeDefined();
    const json = JSON.stringify(editor.state.doc.toJSON());
    expect(json).toContain('"insertion"');
    expect(json).toContain('"deletion"');
    // The deleted text stays, marked.
    expect(shape(editor)[1]).toEqual([
      ["a1", "b1"],
      ["a2!", "b2"],
      ["a3", "b3"],
    ]);
  });

  it("whole rows deleted are the rows' deletion; accepting removes them, rejecting keeps them", () => {
    const editor = editorOf([p("xx"), TABLE, p("y")], true);
    select(editor, inside(editor, "xx", 2), inside(editor, "b2", 1));
    editor.commands.deleteSelection();
    // Kept, marked: the rows' revisions.
    const rows = editor.state.doc.child(1);
    expect(rows.child(0).attrs.revision).toMatchObject({ deletion: { author: "Me" } });
    expect(rows.child(1).attrs.revision).toMatchObject({ deletion: { author: "Me" } });
    expect(rows.child(2).attrs.revision).toBeNull();
    valid(editor);
    editor.commands.acceptAllChanges();
    expect(shape(editor)).toEqual(["xx", [["a3", "b3"]], "y"]);
    valid(editor);
    const back = editorOf([p("xx"), TABLE, p("y")], true);
    select(back, inside(back, "xx", 2), inside(back, "b2", 1));
    back.commands.deleteSelection();
    back.commands.rejectAllChanges();
    expect(shape(back)).toEqual([
      "xx",
      [
        ["a1", "b1"],
        ["a2", "b2"],
        ["a3", "b3"],
      ],
      "y",
    ]);
  });

  it("accepting the deletion of every row removes the table", () => {
    const editor = editorOf([p("xx"), TABLE, p("yy")], true);
    select(editor, inside(editor, "a1"), inside(editor, "yy", 1));
    editor.commands.deleteSelection();
    editor.commands.acceptAllChanges();
    expect(shape(editor)).toEqual(["xx", "y"]);
    valid(editor);
  });
});

describe("review findings", () => {
  const nested = table(row(cell("in1"), cell("in2")));
  const outer = (): NodeJSON =>
    table(
      row(
        { type: "tableCell", content: [p("A"), nested, p("A2")] },
        { type: "tableCell", content: [p("B")] },
      ),
    );

  it("across cells of a table holding a nested one: only those cells are emptied", () => {
    const editor = editorOf([p("before"), outer(), p("after")]);
    select(editor, inside(editor, "in2", 1), inside(editor, "B", 1));
    editor.commands.deleteSelection();
    valid(editor);
    const json = JSON.stringify(editor.state.doc.toJSON());
    expect(json).toContain('"after"');
    // Still one row of two cells.
    expect(editor.state.doc.child(1).child(0).childCount).toBe(2);
    const other = editorOf([p("before"), outer(), p("after")]);
    select(other, inside(other, "A", 1), inside(other, "B", 1));
    other.commands.deleteSelection();
    valid(other);
    expect(other.state.doc.child(1).child(0).childCount).toBe(2);
    expect(JSON.stringify(other.state.doc.toJSON())).toContain('"after"');
  });

  it("a row inserted while tracking is the row's insertion; rejecting it removes it", () => {
    const editor = editorOf([p("x"), TABLE, p("y")], true);
    const schema = editor.state.schema;
    const first = editor.state.doc.child(1).child(0);
    const at = editor.state.doc.child(0).nodeSize + 1 + first.nodeSize;
    editor.dispatch(editor.state.tr.insert(at, first.copy(first.content)));
    const rows = editor.state.doc.child(1);
    expect(rows.childCount).toBe(4);
    expect(rows.child(1).attrs.revision).toMatchObject({ insertion: { author: "Me" } });
    expect(schema).toBeDefined();
    editor.commands.rejectAllChanges();
    expect(editor.state.doc.child(1).childCount).toBe(3);
    valid(editor);
  });

  it("deleting a table of one's own inserted rows removes it", () => {
    const editor = editorOf([p("x"), p("y")], true);
    const t = editor.state.schema.nodeFromJSON(table(row(cell("n"))));
    editor.dispatch(editor.state.tr.insert(editor.state.doc.child(0).nodeSize, t));
    expect(editor.state.doc.childCount).toBe(3);
    select(editor, inside(editor, "x", 1), inside(editor, "y"));
    editor.commands.deleteSelection();
    expect(editor.state.doc.child(1).type.name).not.toBe("table");
    valid(editor);
  });

  it("rejecting a tracked clear of cells gives them back", () => {
    const editor = editorOf([p("x"), TABLE, p("y")], true);
    select(editor, inside(editor, "a1", 1), inside(editor, "a2", 1));
    editor.commands.deleteSelection();
    editor.commands.rejectAllChanges();
    expect(shape(editor)[1]).toEqual([
      ["a1", "b1"],
      ["a2", "b2"],
      ["a3", "b3"],
    ]);
  });

  it("rejecting a tracked delete between two tables leaves the document as it was", () => {
    const second = table(row(cell("c1")));
    const editor = editorOf([p("x"), TABLE, p("mid"), second, p("y")], true);
    select(editor, inside(editor, "b3", 2), inside(editor, "mid", 3));
    editor.commands.deleteSelection();
    editor.commands.rejectAllChanges();
    valid(editor);
    expect(shape(editor)).toEqual([
      "x",
      [
        ["a1", "b1"],
        ["a2", "b2"],
        ["a3", "b3"],
      ],
      "mid",
      [["c1"]],
      "y",
    ]);
  });
});
describe("cells of a nested table", () => {
  it("a selection across them empties those cells only", () => {
    const nested = table(row(cell("in1"), cell("in2")));
    const editor = editorOf([
      p("before"),
      table(row({ type: "tableCell", content: [p("A"), nested, p("A2")] }, cell("B"))),
      p("after"),
    ]);
    select(editor, inside(editor, "in1", 1), inside(editor, "in2", 1));
    editor.commands.deleteSelection();
    valid(editor);
    const json = JSON.stringify(editor.state.doc.toJSON());
    for (const kept of ['"A"', '"A2"', '"B"', '"after"']) expect(json).toContain(kept);
    // Both nested cells emptied, the outer table's cells kept.
    expect(json).not.toContain("in1");
    expect(json).not.toContain("n2");
    expect(editor.state.doc.child(1).child(0).childCount).toBe(2);
  });
});

describe("an inserted paragraph that is a cell's only one", () => {
  it("rejecting its insertion keeps it (a cell ends with a paragraph)", () => {
    const marked: NodeJSON = {
      type: "paragraph",
      attrs: { revision: { insertion: { id: 90, author: "Other" } } },
    };
    const editor = editorOf([
      p("x"),
      table(row({ type: "tableCell", content: [marked] }, cell("b"))),
      p("y"),
    ]);
    expect(editor.commands.rejectAllChanges()).toBe(true);
    valid(editor);
    expect(editor.state.doc.child(1).child(0).child(0).childCount).toBe(1);
  });
});

describe("moving between cells", () => {
  const selected = (editor: Editor) =>
    editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to);

  it("Tab and Shift+Tab go to the next and previous cell, its content selected", () => {
    const editor = editorOf([p("x"), TABLE, p("y")]);
    select(editor, inside(editor, "a1", 1));
    expect(editor.handleKey("Tab")).toBe(true);
    expect(selected(editor)).toBe("b1");
    editor.handleKey("Tab");
    expect(selected(editor)).toBe("a2");
    editor.handleKey("Shift-Tab");
    expect(selected(editor)).toBe("b1");
    // Outside a table Tab types a tab.
    select(editor, inside(editor, "x", 1));
    editor.handleKey("Tab");
    // "x" then the tab.
    expect(editor.state.doc.child(0).childCount).toBe(2);
  });

  it("Tab in the last cell adds a row like the last one, with empty cells", () => {
    const editor = editorOf([p("x"), TABLE, p("y")]);
    select(editor, inside(editor, "b3", 2));
    editor.handleKey("Tab");
    expect(shape(editor)[1]).toEqual([
      ["a1", "b1"],
      ["a2", "b2"],
      ["a3", "b3"],
      ["", ""],
    ]);
    const $head = editor.state.selection.$head;
    expect($head.index($head.depth - 3)).toBe(3);
    valid(editor);
  });

  it("Up and Down from a cell's edge go to the cell above or below, and out of the table", () => {
    const editor = editorOf([p("x"), TABLE, p("y")]);
    select(editor, inside(editor, "b2", 1));
    expect(editor.run(goToCellVertically(-1))).toBe(true);
    expect(editor.state.selection.from).toBe(inside(editor, "b1", 2));
    editor.run(goToCellVertically(-1));
    expect(editor.state.selection.from).toBe(inside(editor, "x", 1));
    select(editor, inside(editor, "a3", 0));
    editor.run(goToCellVertically(1));
    expect(editor.state.selection.from).toBe(inside(editor, "y"));
  });
});

describe("moving between cells: merges and edges", () => {
  const merged = table(
    row(cell("a1"), { type: "tableCell", attrs: { vMerge: "restart" }, content: [p("m")] }),
    row(cell("a2"), { type: "tableCell", attrs: { vMerge: "continue" }, content: [p()] }),
    row(cell("a3"), cell("b3")),
  );
  const selected = (editor: Editor) =>
    editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to);

  it("Tab skips a cell a merge covers", () => {
    const editor = editorOf([p("x"), merged, p("y")]);
    select(editor, inside(editor, "a2", 1));
    editor.handleKey("Tab");
    expect(selected(editor)).toBe("a3");
  });

  it("the row Tab adds has none of the last row's ids or revisions", () => {
    const withIds = table(row(cell("a1")), {
      type: "tableRow",
      attrs: { attributes: { "w14:paraId": "1A2B3C4D" } },
      content: [
        {
          type: "tableCell",
          content: [
            {
              type: "paragraph",
              attrs: {
                attributes: { "w14:paraId": "5E6F7A8B" },
                revision: { insertion: { id: 3, author: "Other" } },
                justification: "center",
              },
              content: [text("z")],
            },
          ],
        },
      ],
    });
    const editor = editorOf([p("x"), withIds, p("y")]);
    select(editor, inside(editor, "z", 1));
    editor.handleKey("Tab");
    const added = editor.state.doc.child(1).child(2);
    expect(added.attrs.attributes).toBeNull();
    const para = added.child(0).child(0);
    expect(para.attrs.attributes).toBeNull();
    expect(para.attrs.revision).toBeNull();
    // Its properties are kept.
    expect(para.attrs.justification).toBe("center");
  });

  it("Up from a table that starts the document, and Down with a word selected, are the browser's", () => {
    const editor = editorOf([TABLE, p("y")]);
    select(editor, inside(editor, "a1", 1));
    expect(editor.run(goToCellVertically(-1))).toBe(false);
    select(editor, inside(editor, "a1", 0), inside(editor, "a1", 1));
    expect(editor.run(goToCellVertically(1))).toBe(false);
    // The whole content selected (Tab's): it moves as the cell.
    select(editor, inside(editor, "a1", 0), inside(editor, "a1", 2));
    expect(editor.run(goToCellVertically(1))).toBe(true);
  });
});

describe("cell selections", () => {
  const cellPos = (editor: Editor, value: string) => inside(editor, value) - 2;

  it("cover the rectangle between two cells, widened by a merge, and round-trip as JSON", () => {
    const merged = table(
      row(
        cell("a1"),
        { type: "tableCell", attrs: { vMerge: "restart" }, content: [p("m")] },
        cell("c1"),
      ),
      row(
        cell("a2"),
        { type: "tableCell", attrs: { vMerge: "continue" }, content: [p()] },
        cell("c2"),
      ),
      row(cell("a3"), cell("b3"), cell("c3")),
    );
    const editor = editorOf([p("x"), merged, p("y")]);
    // From c2 to b3: the merged cell (rows 1-2) widens the rectangle to row 1.
    const selection = CellSelection.create(
      editor.state.doc,
      cellPos(editor, "c2"),
      cellPos(editor, "b3"),
    );
    const texts = selection.cells.map((pos) => editor.state.doc.nodeAt(pos)?.textContent);
    expect(texts).toEqual(["m", "c1", "c2", "b3", "c3"]);
    const json = selection.toJSON();
    expect(json.type).toBe("cell");
    expect(Selection.fromJSON(editor.state.doc, json)).toBeInstanceOf(CellSelection);
  });

  it("map through edits elsewhere and fall back to text when a cell goes", () => {
    const editor = editorOf([p("x"), TABLE, p("y")]);
    editor.dispatch(
      editor.state.tr.setSelection(
        CellSelection.create(editor.state.doc, cellPos(editor, "a1"), cellPos(editor, "b2")),
      ),
    );
    editor.dispatch(editor.state.tr.insertText("more ", 1));
    expect(editor.state.selection).toBeInstanceOf(CellSelection);
    expect((editor.state.selection as CellSelection).cells).toHaveLength(4);
  });

  it("Delete empties the selected cells; typing replaces the anchor cell's content", () => {
    const editor = editorOf([p("x"), TABLE, p("y")]);
    const select4 = () =>
      editor.dispatch(
        editor.state.tr.setSelection(
          CellSelection.create(editor.state.doc, cellPos(editor, "a1"), cellPos(editor, "b2")),
        ),
      );
    select4();
    editor.commands.deleteSelection();
    expect(shape(editor)[1]).toEqual([
      ["", ""],
      ["", ""],
      ["a3", "b3"],
    ]);
    valid(editor);
    const typing = editorOf([p("x"), TABLE, p("y")]);
    typing.dispatch(
      typing.state.tr.setSelection(
        CellSelection.create(typing.state.doc, cellPos(typing, "a2"), cellPos(typing, "b3")),
      ),
    );
    typing.commands.insertText("Z");
    expect(shape(typing)[1]).toEqual([
      ["a1", "b1"],
      ["Z", "b2"],
      ["a3", "b3"],
    ]);
  });

  it("grow with Shift+arrows from a caret leaving its cell, then from the head", () => {
    const editor = editorOf([p("x"), TABLE, p("y")]);
    select(editor, inside(editor, "a1", 1));
    expect(editor.run(extendCellSelection("row", 1))).toBe(true);
    let selection = editor.state.selection as CellSelection;
    expect(selection.cells.map((pos) => editor.state.doc.nodeAt(pos)?.textContent)).toEqual([
      "a1",
      "a2",
    ]);
    editor.run(extendCellSelection("column", 1));
    selection = editor.state.selection as CellSelection;
    expect(selection.cells).toHaveLength(4);
    // No row above the first: not taken.
    select(editor, inside(editor, "b1", 1));
    expect(editor.run(extendCellSelection("row", -1))).toBe(false);
  });
});

describe("commands over a cell selection", () => {
  const cellPos = (editor: Editor, value: string) => inside(editor, value) - 2;
  /** a1..a3: one column, the cells of column b between them in document order. */
  const column = () => {
    const editor = editorOf([p("x"), TABLE, p("y")]);
    editor.dispatch(
      editor.state.tr.setSelection(
        CellSelection.create(editor.state.doc, cellPos(editor, "a1"), cellPos(editor, "a3")),
      ),
    );
    return editor;
  };
  /** The texts of the paragraphs `test` holds for. */
  const where = (editor: Editor, test: (node: import("../model/index.js").Node) => boolean) => {
    const found: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "paragraph" && test(node)) found.push(node.textContent);
    });
    return found;
  };

  it("marks only the selected cells' text", () => {
    const editor = column();
    expect(editor.commands.toggleMark("bold")).toBe(true);
    const bold = where(
      editor,
      (n) => n.firstChild?.marks.some((m) => m.type.name === "bold") ?? false,
    );
    expect(bold).toEqual(["a1", "a2", "a3"]);
    editor.commands.toggleMark("bold");
    expect(where(editor, (n) => n.firstChild?.marks.length !== 0 && !!n.firstChild)).toEqual([]);
  });

  it("formats only the selected cells' paragraphs", () => {
    const editor = column();
    expect(editor.run(setWordAlign("center"))).toBe(true);
    expect(where(editor, (n) => n.attrs.justification === "center")).toEqual(["a1", "a2", "a3"]);
  });

  it("types into the anchor cell with its text's marks", () => {
    const editor = column();
    editor.commands.toggleMark("bold");
    editor.commands.insertText("Z");
    const z = where(editor, (n) => n.textContent === "Z");
    expect(z).toEqual(["Z"]);
    expect(
      where(
        editor,
        (n) => n.textContent === "Z" && !!n.firstChild?.marks.some((m) => m.type.name === "bold"),
      ),
    ).toEqual(["Z"]);
  });

  it("do not extend a merge past a row that skips its column", () => {
    // Row 2 starts after the first column (gridBefore): the restart above ends there.
    const skipped = table(
      row({ type: "tableCell", attrs: { vMerge: "restart" }, content: [p("m")] }, cell("b1")),
      { type: "tableRow", attrs: { gridBefore: 1 }, content: [cell("b2")] },
      row({ type: "tableCell", attrs: { vMerge: "continue" }, content: [p("c")] }, cell("b3")),
    );
    const editor = editorOf([p("x"), skipped, p("y")]);
    const selection = CellSelection.create(
      editor.state.doc,
      cellPos(editor, "m"),
      cellPos(editor, "b1"),
    );
    // A merge reaching row 2 would widen the rectangle to b2.
    expect(selection.cells.map((pos) => editor.state.doc.nodeAt(pos)?.textContent)).toEqual([
      "m",
      "b1",
    ]);
  });
});

describe("review over a cell selection", () => {
  const cellPos = (editor: Editor, value: string) => inside(editor, value) - 2;
  for (const [name, revision, run] of [
    ["rejecting", { insertion: { id: 7, author: "A", date: null } }, "rejectChange"],
    ["accepting", { deletion: { id: 7, author: "A", date: null } }, "acceptChange"],
  ] as const)
    it(`${name} a row's revision from two of its cells removes that row only`, () => {
      const tracked = table(
        row(cell("a1"), cell("b1")),
        { type: "tableRow", attrs: { revision }, content: [cell("a2"), cell("b2")] },
        row(cell("a3"), cell("b3")),
      );
      const editor = editorOf([p("x"), tracked, p("y")]);
      editor.dispatch(
        editor.state.tr.setSelection(
          CellSelection.create(editor.state.doc, cellPos(editor, "a2"), cellPos(editor, "b2")),
        ),
      );
      expect(editor.commands[run]()).toBe(true);
      expect(shape(editor)[1]).toEqual([
        ["a1", "b1"],
        ["a3", "b3"],
      ]);
      valid(editor);
    });
});

describe("copying and pasting cells", () => {
  const cellPos = (editor: Editor, value: string) => inside(editor, value) - 2;
  const cellsOfTable = (editor: Editor, from: string, to: string) =>
    CellSelection.create(editor.state.doc, cellPos(editor, from), cellPos(editor, to));
  /** A table's rows as [cells' text…]. */
  const rowsOf = (node: import("../model/index.js").Node) => {
    const rows: string[][] = [];
    node.forEach((r) => {
      const cells: string[] = [];
      r.forEach((c) => {
        cells.push(c.textContent);
      });
      rows.push(cells);
    });
    return rows;
  };

  it("copy the rectangle as a table of its own, its grid cut to its columns", () => {
    const wide = { ...TABLE, attrs: { grid: [1000, 2000] } };
    const editor = editorOf([p("x"), wide, p("y")]);
    const copied = cellsAsTable(cellsOfTable(editor, "b1", "b2"));
    expect(rowsOf(copied)).toEqual([["b1"], ["b2"]]);
    expect(copied.attrs.grid).toEqual([2000]);
    const all = cellsAsTable(cellsOfTable(editor, "a1", "b3"));
    expect(all.attrs.grid).toEqual([1000, 2000]);
    expect(rowsOf(all)).toHaveLength(3);
  });

  it("paste rows into a cell: filled from there, rows added, extra columns dropped", () => {
    const source = editorOf([p("x"), TABLE, p("y")]);
    const copied = cellsAsTable(cellsOfTable(source, "a2", "b3"));
    const editor = editorOf([p("x"), TABLE, p("y")]);
    select(editor, inside(editor, "b3", 1));
    const tr = editor.state.tr;
    expect(pasteCells(tr, copied)).toBe(true);
    editor.dispatch(tr);
    // From b3: a2 → b3, b2 → past the last column (dropped); a3 → a new row's b cell.
    expect(shape(editor)[1]).toEqual([
      ["a1", "b1"],
      ["a2", "b2"],
      ["a3", "a2"],
      ["", "a3"],
    ]);
    expect(editor.state.selection).toBeInstanceOf(CellSelection);
    valid(editor);
  });

  it("paste rows over selected cells from their first cell, a tracked new row", () => {
    const source = editorOf([p("x"), TABLE, p("y")]);
    const copied = cellsAsTable(cellsOfTable(source, "a1", "b2"));
    const editor = editorOf([p("x"), TABLE, p("y")], true);
    editor.dispatch(editor.state.tr.setSelection(cellsOfTable(editor, "b3", "a3")));
    const tr = editor.state.tr;
    expect(pasteCells(tr, copied)).toBe(true);
    editor.dispatch(tr);
    const table = editor.state.doc.child(1);
    expect(table.childCount).toBe(4);
    expect(table.child(3).attrs.revision).toMatchObject({ insertion: { author: "Me" } });
    expect(table.child(3).textContent).toBe("a2b2");
    // The pasted cells stay selected through the tracking rebuild.
    expect(editor.state.selection).toBeInstanceOf(CellSelection);
    expect((editor.state.selection as CellSelection).cells).toHaveLength(4);
    editor.commands.rejectAllChanges();
    expect(shape(editor)[1]).toEqual([
      ["a1", "b1"],
      ["a2", "b2"],
      ["a3", "b3"],
    ]);
    valid(editor);
  });

  it("select the rectangle of the cells filled; add no row when nothing lands", () => {
    const source = editorOf([
      p("x"),
      table(row(cell("p"), cell("q")), {
        type: "tableRow",
        attrs: { gridBefore: 1 },
        content: [cell("r")],
      }),
      p("y"),
    ]);
    const copied = cellsAsTable(cellsOfTable(source, "p", "r"));
    const editor = editorOf([p("x"), TABLE, p("y")]);
    select(editor, inside(editor, "a1"));
    const tr = editor.state.tr;
    expect(pasteCells(tr, copied)).toBe(true);
    editor.dispatch(tr);
    expect(shape(editor)[1]).toEqual([
      ["p", "q"],
      ["a2", "r"],
      ["a3", "b3"],
    ]);
    // a1 to b2: both columns, though the first and last cells filled are p and r.
    expect((editor.state.selection as CellSelection).cells).toHaveLength(4);
    // From b3: q fills b3, r a new row's b cell.
    const narrow = editorOf([p("x"), TABLE, p("y")]);
    select(narrow, inside(narrow, "b3"));
    const offTable = cellsAsTable(
      CellSelection.create(source.state.doc, cellPos(source, "q"), cellPos(source, "r")),
    );
    const tr2 = narrow.state.tr;
    expect(pasteCells(tr2, offTable)).toBe(true);
    narrow.dispatch(tr2);
    expect(narrow.state.doc.child(1).childCount).toBe(4);
    const none = editorOf([p("x"), TABLE, p("y")]);
    select(none, inside(none, "b3"));
    const gridded = cellsAsTable(
      CellSelection.create(source.state.doc, cellPos(source, "r"), cellPos(source, "r")),
    );
    // r alone has no gridBefore in its copy: it lands in b3. A copy starting past the table:
    const shifted = gridded.type.create(gridded.attrs, [
      gridded.child(0).type.create({ gridBefore: 2 }, gridded.child(0).content),
    ]);
    expect(pasteCells(none.state.tr, shifted)).toBe(false);
  });

  it("do not paste into cells a selection reaching out of its cell", () => {
    const source = editorOf([p("x"), TABLE, p("y")]);
    const copied = cellsAsTable(cellsOfTable(source, "a1", "a1"));
    const editor = editorOf([p("x"), TABLE, p("y")]);
    select(editor, inside(editor, "b3", 1), inside(editor, "y", 1));
    expect(pasteCells(editor.state.tr, copied)).toBe(false);
  });

  it("copy from a cell a merge covers as from the merge", () => {
    const merged = table(
      row({ type: "tableCell", attrs: { vMerge: "restart" }, content: [p("m")] }, cell("b1")),
      row({ type: "tableCell", attrs: { vMerge: "continue" }, content: [p()] }, cell("b2")),
    );
    const editor = editorOf([p("x"), merged, p("y")]);
    const covered =
      editor.state.doc.child(1).child(0).nodeSize + editor.state.doc.child(0).nodeSize + 2;
    expect(editor.state.doc.nodeAt(covered)?.attrs.vMerge).toBe("continue");
    const selection = CellSelection.create(editor.state.doc, covered, cellPos(editor, "b2"));
    expect(selection.cells.map((pos) => editor.state.doc.nodeAt(pos)?.textContent)).toEqual([
      "m",
      "b1",
      "b2",
    ]);
    expect(cellsAsTable(selection).childCount).toBe(2);
  });

  it("do nothing outside a table", () => {
    const source = editorOf([p("x"), TABLE, p("y")]);
    const copied = cellsAsTable(cellsOfTable(source, "a1", "a1"));
    const editor = editorOf([p("x"), TABLE, p("y")]);
    select(editor, 1);
    expect(pasteCells(editor.state.tr, copied)).toBe(false);
  });
});
