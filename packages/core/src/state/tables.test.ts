import { describe, expect, it } from "vitest";
import type { NodeJSON } from "../model/index.js";
import type { FoliDocument } from "../v3/document.js";
import { parseContent } from "../v3/document.js";
import { createEditor } from "./editor.js";
import { TextSelection } from "./selection.js";

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
