/**
 * Regressions (tables, second sweep): each test failed before its fix.
 */
import { describe, expect, it } from "vitest";
import type { Node, NodeJSON } from "./model/index.js";
import { deleteSelection } from "./state/commands.js";
import { createEditor } from "./state/editor.js";
import { TextSelection } from "./state/selection.js";
import { deleteRows } from "./state/tablecommands.js";
import { CellSelection } from "./state/tables.js";
import { fitPaste } from "./state/wordclip.js";
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

function editorOf(blocks: NodeJSON[], over: Partial<FoliDocument> = {}, tracking = false) {
  return createEditor({
    document: {
      schemaVersion: 5,
      section: {},
      defaults: {},
      styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
      numbering: { abstracts: [], instances: [] },
      comments: [],
      content: { type: "doc", content: blocks },
      ...over,
    },
    ...(tracking ? { author: "Me", trackChanges: true } : {}),
  });
}
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
const tableOf = (editor: Editor): Node => {
  let found: Node | undefined;
  editor.state.doc.forEach((block) => {
    if (block.type.name === "table") found ??= block;
  });
  if (!found) throw new Error("no table");
  return found;
};
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
    row([
      cell("a1", { vMerge: "restart", shading: { pattern: "clear", fill: "FF0000" } }),
      cell("b1"),
    ]),
    row([cell("", { vMerge: "continue" }), cell("b2")]),
    row([cell("", { vMerge: "continue" }), cell("b3")]),
  ]);
const plain3 = () =>
  table([
    row([cell("a1"), cell("b1")]),
    row([cell("a2"), cell("b2")]),
    row([cell("a3"), cell("b3")]),
  ]);
/** The row index (and cell) holding the caret. */
const caretRow = (editor: Editor) => {
  const $head = editor.state.selection.$head;
  for (let d = $head.depth; d > 0; d--)
    if ($head.node(d).type.name === "tableRow") return $head.index(d - 1);
  throw new Error("not in a row");
};

describe("range delete into a table", () => {
  it("restarts a merge whose first row it takes", () => {
    const editor = editorOf([p("x"), merged3(), p("end")]);
    select(editor, inside(editor, "x"), inside(editor, "b1", 1));
    expect(editor.run(deleteSelection)).toBe(true);
    const t = tableOf(editor);
    expect(shape(t)).toEqual(["a1^ b2", "| b3"]);
    expect(t.child(0).child(0).attrs.shading).toMatchObject({ fill: "FF0000" });
  });

  it("while tracking, can be accepted and rejected as a whole", () => {
    const run = () => {
      const editor = editorOf([p("x"), merged3(), p("end")], {}, true);
      select(editor, inside(editor, "x"), inside(editor, "b1", 1));
      expect(editor.run(deleteSelection)).toBe(true);
      return editor;
    };
    const accepted = run();
    accepted.commands.acceptAllChanges();
    expect(shape(tableOf(accepted))).toEqual(["a1^ b2", "| b3"]);
    const rejected = run();
    rejected.commands.rejectAllChanges();
    expect(shape(tableOf(rejected))).toEqual(["a1^ b1", "| b2", "| b3"]);
  });
});

describe("tracked deleteRows", () => {
  it("moves the caret to the next row not marked deleted", () => {
    const editor = editorOf([plain3(), p("end")], {}, true);
    select(editor, inside(editor, "a2"));
    expect(editor.run(deleteRows)).toBe(true);
    expect(tableOf(editor).childCount).toBe(3);
    expect(caretRow(editor)).toBe(2);
    // The last row: back to the first one not marked deleted.
    expect(editor.run(deleteRows)).toBe(true);
    expect(caretRow(editor)).toBe(0);
  });

  it("skips rows already marked deleted", () => {
    const editor = editorOf([plain3(), p("end")], {}, true);
    select(editor, inside(editor, "a2"));
    editor.run(deleteRows);
    select(editor, inside(editor, "a1"));
    expect(editor.run(deleteRows)).toBe(true);
    expect(caretRow(editor)).toBe(2);
  });

  it("of a merge's first row leaves no orphan merge, accepted or rejected", () => {
    const run = () => {
      const editor = editorOf([merged3(), p("end")], {}, true);
      select(editor, inside(editor, "b1"));
      expect(editor.run(deleteRows)).toBe(true);
      return editor;
    };
    const accepted = run();
    accepted.commands.acceptAllChanges();
    expect(shape(tableOf(accepted))).toEqual(["a1^ b2", "| b3"]);
    const rejected = run();
    rejected.commands.rejectAllChanges();
    expect(shape(tableOf(rejected))).toEqual(["a1^ b1", "| b2", "| b3"]);
  });
});

describe("paste over cells of one row", () => {
  it("does not put the pasted paragraphs in the row's content control", () => {
    const editor = editorOf(
      [table([row([cell("a1"), cell("b1")], { controls: ["r"] })]), p("end")],
      { controls: { r: { kind: "richText" } } },
    );
    const a = inside(editor, "a1") - 2;
    const b = inside(editor, "b1") - 2;
    editor.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, a, b)));
    const fitted = fitPaste(editor.state, { type: "doc", content: [p("new")] });
    expect(fitted.doc.toJSON()).toEqual({ type: "doc", content: [p("new")] });
  });
});
