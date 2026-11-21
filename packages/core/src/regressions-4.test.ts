/**
 * Regressions (fourth sweep): each test failed before its fix.
 */
import { describe, expect, it } from "vitest";
import type { MarkJSON, NodeJSON } from "./model/index.js";
import { createEditor, type Editor } from "./state/editor.js";

const DATE = "2026-01-02T03:04:05Z";
const by = (id: number) => ({ id, author: "A", date: DATE });
const del = (id: number): MarkJSON => ({ type: "deletion", attrs: by(id) });
const p = (value = "", deleted?: number): NodeJSON => ({
  type: "paragraph",
  ...(deleted ? { attrs: { revision: { deletion: by(deleted) } } } : {}),
  ...(value
    ? {
        content: [
          { type: "text", text: value, ...(deleted ? { marks: [del(deleted + 100)] } : {}) },
        ],
      }
    : {}),
});
const table: NodeJSON = {
  type: "table",
  content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p("cell")] }] }],
};

function editorOf(blocks: NodeJSON[]): Editor {
  return createEditor({
    document: {
      schemaVersion: 5,
      section: {},
      defaults: {},
      styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
      numbering: { abstracts: [], instances: [] },
      comments: [],
      content: { type: "doc", content: blocks },
    },
  });
}
const shape = (editor: Editor) =>
  (editor.getDocument().content.content ?? []).map((b) =>
    b.type === "paragraph" ? `p(${(b.content ?? []).map((t) => t.text).join("")})` : b.type,
  );

/** Accepts every change at once, one by one from the start, or one by one from the end. */
function accepted(blocks: NodeJSON[], order: "all" | "forward" | "reverse"): string[] {
  const editor = editorOf(blocks);
  if (order === "all") editor.commands.acceptAllChanges();
  else
    for (let guard = 0; guard < 20; guard++) {
      const positions: number[] = [];
      editor.state.doc.forEach((node, offset) => {
        if (node.type.name !== "paragraph") return;
        const marked =
          !!(node.attrs.revision as { deletion?: unknown } | null)?.deletion ||
          node.content.content.some((t) => t.marks.some((m) => m.type.name === "deletion"));
        if (marked) positions.push(offset + 1);
      });
      if (!positions.length) break;
      const at = (order === "forward" ? positions[0] : positions.at(-1)) as number;
      editor.select(at, at + (editor.state.doc.resolve(at).parent.content.size || 0));
      editor.commands.acceptChange();
    }
  return shape(editor);
}

describe("accepting whole-deleted paragraphs before a table", () => {
  const orders = ["all", "forward", "reverse"] as const;
  const deleted = [p("B", 1), p("C", 2), p("D", 3)];
  it.each(orders)("after a kept paragraph leaves none (%s)", (order) => {
    expect(accepted([p("A"), ...deleted, table, p("E")], order)).toEqual(["p(A)", "table", "p(E)"]);
  });
  it.each(orders)("at the start leaves one empty paragraph (%s)", (order) => {
    expect(accepted([...deleted, table, p("E")], order)).toEqual(["p()", "table", "p(E)"]);
  });
  it.each(orders)("between tables leaves one empty paragraph (%s)", (order) => {
    expect(accepted([p("A"), table, ...deleted, table, p("E")], order)).toEqual([
      "p(A)",
      "table",
      "p()",
      "table",
      "p(E)",
    ]);
  });
});
