import { createDocument, type NodeJSON } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { openSession, type Session } from "./index.js";

/** 23.3 review: a table whose first column is merged down over rows 1 to 3. */
const p = (text: string): NodeJSON => ({
  type: "paragraph",
  ...(text ? { content: [{ type: "text", text }] } : {}),
});
const cell = (text: string, vMerge?: "restart" | "continue"): NodeJSON => ({
  type: "tableCell",
  ...(vMerge ? { attrs: { vMerge } } : {}),
  content: [p(text)],
});
const row = (...cells: NodeJSON[]): NodeJSON => ({ type: "tableRow", content: cells });
const merged = (): Session =>
  openSession(
    createDocument({
      type: "doc",
      content: [
        p("Produce"),
        {
          type: "table",
          content: [
            row(cell("Fruit", "restart"), cell("Apple")),
            row(cell("", "continue"), cell("Pear")),
            row(cell("", "continue"), cell("Plum")),
            row(cell("Veg"), cell("Leek")),
          ],
        },
        p("After"),
      ],
    }),
    { author: "Agent" },
  );
const tableOf = (session: Session) => {
  const read = session.read();
  if (!read.ok) throw new Error(read.message);
  return read.blocks.find((b) => b.kind === "table")?.handle as string;
};
const texts = (session: Session) =>
  (session.read() as { blocks: { cell?: { row: number }; text: string }[] }).blocks
    .filter((b) => b.cell)
    .map((b) => `${b.cell?.row}:${b.text}`);

describe("tables with a vertical merge (23.3 review)", () => {
  it("deletes only the row named", () => {
    const session = merged();
    const done = session.deleteRows(tableOf(session), [2]);
    expect(done.ok).toBe(true);
    expect(texts(session)).toEqual(["1:Fruit", "1:Apple", "2:", "2:Plum", "3:Veg", "3:Leek"]);
  });

  it("inserts after the row named, the merge going on through it", () => {
    const session = merged();
    const done = session.insertRows(tableOf(session), 1, [
      ["x", "Quince"],
      ["y", "Fig"],
    ]);
    expect(done.ok).toBe(true);
    // The new rows' text in the merged column is the merge's: only the other cells take text.
    expect(texts(session).filter((t) => /Quince|Fig|Apple|Pear/.test(t))).toEqual([
      "1:Apple",
      "2:Quince",
      "3:Fig",
      "4:Pear",
    ]);
    // Code mode counts the new rows' blocks, not the table's.
    expect(done.ok && done.blocks.length).toBe(4);
  });

  it("sets header rows on exactly the rows asked", () => {
    const session = merged();
    expect(session.setHeaderRows(tableOf(session), 1).ok).toBe(true);
    const rows = session.document().content.content?.[1]?.content ?? [];
    expect(rows.map((r) => r.attrs?.header === true)).toEqual([true, false, false, false]);
  });

  it("refuses a row whose every cell is merged, changing nothing", () => {
    const session = openSession(
      createDocument({
        type: "doc",
        content: [
          p("x"),
          {
            type: "table",
            content: [row(cell("a", "restart")), row(cell("", "continue"))],
          },
          p("y"),
        ],
      }),
      { author: "Agent" },
    );
    const before = session.editor.state.doc;
    const refused = session.insertRows(tableOf(session), 2, [["z"]]);
    expect(refused.ok || refused.message).toMatch(/part of a vertical merge.*Nothing was changed/);
    expect(session.editor.state.doc).toBe(before);
  });
});
