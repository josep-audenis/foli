import { createDocument, type NodeJSON, trackedChanges } from "@folijs/core";
import { exportDocx, importDocx } from "@folijs/docx";
import { describe, expect, it } from "vitest";
import { openSession, type Session } from "./index.js";

const p = (text: string): NodeJSON => ({
  type: "paragraph",
  ...(text ? { content: [{ type: "text", text }] } : {}),
});
const open = (...texts: string[]) =>
  openSession(createDocument({ type: "doc", content: texts.map(p) }), { author: "Agent" });
const handleOf = (session: Session, text: string) => {
  const read = session.read();
  if (!read.ok) throw new Error(read.message);
  const block = read.blocks.find((b) => b.text === text);
  if (!block) throw new Error(`no block ${text}`);
  return block.handle;
};
const ok = <T>(result: ({ ok: true } & T) | { ok: false; message: string }): T => {
  if (!result.ok) throw new Error(result.message);
  return result;
};
const lines = (session: Session) => ok(session.read()).text;

describe("tables (23.3)", () => {
  it("inserts a table from data after a paragraph, with a header row, as a tracked insertion", async () => {
    const session = open("Prices", "After");
    const made = ok(
      session.insertTable(
        handleOf(session, "Prices"),
        [["Item", "Price"], ["Tea", "3.50"], ["Cake"]],
        {
          header: true,
        },
      ),
    );
    expect(made.text).toMatch(/^\[b\d+\] table, 3 rows, 2 columns, [^\n]*changed$/m);
    expect(made.text).toMatch(/r1 c1, Normal, changed: Item/);
    expect(made.text).toMatch(/r3 c2, Normal, changed: $/m);
    expect(lines(session).split("\n")[0]).toMatch(/Prices$/);
    const table = session.document().content.content?.[1];
    expect(table?.type).toBe("table");
    expect(table?.content?.[0]?.attrs?.header).toBe(true);
    expect(trackedChanges(session.editor.state.doc).some((c) => c.kind === "rowInsertion")).toBe(
      true,
    );
    // Through .docx and back: the same text.
    const again = openSession((await importDocx(await exportDocx(session.document()))).document, {
      author: "Agent",
    });
    const plain = (text: string) => text.replace(/\[b\d+\]/g, "[]");
    expect(plain(lines(again))).toBe(plain(lines(session)));
  });

  it("inserts before a paragraph, and after an empty one", () => {
    const session = open("", "Last");
    ok(session.insertTable(handleOf(session, "Last"), [["a"]], { where: "before" }));
    const types = session.document().content.content?.map((b) => b.type);
    expect(types).toEqual(["paragraph", "table", "paragraph"]);
  });

  it("adds rows to an existing table and fills them; deletes rows", () => {
    const session = open("Prices", "After");
    const table = ok(
      session.insertTable(handleOf(session, "Prices"), [
        ["Item", "Price"],
        ["Tea", "3.50"],
      ]),
    );
    const handle = table.blocks[0]?.handle as string;
    session.editor.commands.acceptAllChanges();
    const added = ok(
      session.insertRows(handle, 2, [
        ["Cake", "2.00"],
        ["Pie", "4.00"],
      ]),
    );
    expect(added.text).toMatch(/r3 c1, Normal, changed: Cake/);
    expect(added.text).toMatch(/r4 c2, Normal, changed: 4\.00/);
    const above = ok(session.insertRows(handle, 1, [["Header?"]], "before"));
    expect(above.text).toMatch(/r1 c1, Normal, changed: Header\?/);
    expect(above.text).toMatch(/r2 c1, Normal: Item/);

    const deleted = ok(session.deleteRows(handle, [1, 3]));
    expect(deleted.text).toMatch(/^Deleted rows 1, 3 of table/);
    expect(lines(session)).not.toMatch(/Header\?|Tea/);
    expect(lines(session)).toMatch(/table, 3 rows/);
  });

  it("names a table by a cell's paragraph too, and refuses rows and columns it does not have", () => {
    const session = open("Prices", "After");
    ok(session.insertTable(handleOf(session, "Prices"), [["Item", "Price"]]));
    const cell = handleOf(session, "Price");
    expect(ok(session.insertRows(cell, 1, [["Tea", "3.50"]])).text).toMatch(
      /r2 c2, Normal, changed: 3\.50/,
    );
    const wrong = session.insertRows(cell, 9, [["x"]]);
    expect(wrong.ok || wrong.message).toBe(
      "Table b3 has 2 rows: row is 1 to 2.".replace(
        "b3",
        (wrong as { message: string }).message.match(/b\d+/)?.[0] ?? "",
      ),
    );
    const wide = session.insertRows(cell, 1, [["a", "b", "c"]]);
    expect(wide.ok).toBe(false);
    const notTable = session.insertRows(handleOf(session, "After"), 1, [["x"]]);
    expect(notTable.ok || notTable.message).toMatch(/is not a table or in one/);
  });

  it("sets cells' text, styles, shades and makes header rows, each tracked", () => {
    const session = open("Prices", "After");
    const handle = ok(
      session.insertTable(handleOf(session, "Prices"), [
        ["Item", "Price"],
        ["Tea", "3.50"],
      ]),
    ).blocks[0]?.handle as string;
    session.editor.commands.acceptAllChanges();

    const set = ok(session.setCells(handle, [{ row: 2, column: 2, text: "4.00" }]));
    expect(set.text).toMatch(/r2 c2, Normal, changed: 4\.00/);
    expect(session.setCells(handle, [{ row: 2, column: 5, text: "x" }]).ok).toBe(false);

    ok(session.shadeCells(handle, "#D9E2F3", { row: 1 }));
    const kinds = () => trackedChanges(session.editor.state.doc).map((c) => c.kind);
    expect(kinds().filter((k) => k === "tableFormatting")).toHaveLength(2);
    expect(session.shadeCells(handle, "blue").ok).toBe(false);

    ok(session.setHeaderRows(handle, 1));
    const rows = session.document().content.content?.[1]?.content ?? [];
    expect(rows.map((r) => r.attrs?.header ?? false)).toEqual([true, false]);
    ok(session.setHeaderRows(handle, 0));
    expect(
      (session.document().content.content?.[1]?.content ?? []).map((r) => r.attrs?.header ?? false),
    ).toEqual([false, false]);

    expect(session.tableStyles()).toContain("Table Grid");
    ok(session.setTableStyle(handle, null));
    expect(session.document().content.content?.[1]?.attrs?.style).toBeUndefined();
    const unknown = session.setTableStyle(handle, "Fancy");
    expect(unknown.ok || unknown.message).toMatch(
      /There is no table style "Fancy"\. The table styles are: "Table Grid"/,
    );
    session.editor.commands.rejectAllChanges();
    expect(lines(session)).toMatch(/r2 c2, Normal: 3\.50/);
    expect(session.document().content.content?.[1]?.attrs?.style).toBe("TableGrid");
  });
});
