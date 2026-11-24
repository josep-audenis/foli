import { readFileSync } from "node:fs";
import { createEditor, trackedChanges } from "@folijs/core";
import { exportDocx, importDocx } from "@folijs/docx";
import { describe, expect, it } from "vitest";
import { agentTools, openSession } from "./index.js";

/**
 * 23.9: a scenario per area, with a model's kind of calls (names and JSON arguments) through
 * `agentTools` on a session alone, no MCP; the same tasks run through the server in
 * `@folijs/mcp`'s `scenarios-23.test.ts`. Each result is exported and opened again.
 */
const CORPUS = new URL("../../../corpus/word/", import.meta.url);

/** A PNG's header: what `insert` reads of a picture (a 400 × 200 pixel image). */
function png(): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, 400);
  new DataView(bytes.buffer).setUint32(20, 200);
  return bytes;
}

describe("Phase 23's areas through agentTools alone (23.9)", () => {
  it("builds a table, adds a row, formats a heading, makes a list, inserts a picture, edits a header", async () => {
    const { document, package: pkg } = await importDocx(
      new Uint8Array(readFileSync(new URL("04-board-report.docx", CORPUS))),
    );
    const session = openSession(document, { author: "Agent" });
    const tools = new Map(
      agentTools(session, {
        picture: (path) =>
          path === "chart.png"
            ? { ok: true, data: png() }
            : { ok: false, code: "invalid", message: `No file ${path}.` },
      }).map((t) => [t.name, t]),
    );
    /** A call as a model makes it: the tool's name and its JSON arguments. */
    const call = (name: string, args: Record<string, unknown>) => {
      const answer = tools.get(name)?.run(JSON.parse(JSON.stringify(args)));
      if (!answer || answer.isError) throw new Error(`${name}: ${answer?.text}`);
      return answer.text;
    };
    const handle = (text: string, read = call("read", { limit: 2000, headers: true })) => {
      const line = read.split("\n").find((l) => l.includes(text));
      return /^\[([bhf]\d+)\]/.exec(line ?? "")?.[1] as string;
    };

    // A table from data, after the paragraph that asks for the decision.
    const table = call("edit_table", {
      handle: handle("The Board is asked to approve"),
      action: "insert_table",
      cells: [
        ["Decision", "Owner"],
        ["Approve the capital plan", "Board"],
        ["Note the risk register", "Audit committee"],
      ],
      header: true,
    });
    expect(table).toMatch(/table, 3 rows, 2 columns, Table Grid, 1 header row, changed/);
    // A row added to the appendix's table.
    const capex = handle("table, 4 rows, 6 columns");
    expect(
      call("edit_table", {
        handle: capex,
        action: "insert_rows",
        row: 4,
        cells: [["Total", "", "1.8", "2.5", "1.8", "6.1"]],
      }),
    ).toMatch(/r5 c1, Normal, changed: Total/);
    // A heading formatted: its color, centered.
    const summary = handle("heading 1: Executive summary");
    expect(call("format_text", { handle: summary, format: { color: "1F3864" } })).not.toMatch(
      /^Nothing changed/,
    );
    expect(
      call("format_paragraph", { handles: [summary], format: { align: "center" } }),
    ).not.toMatch(/^Nothing changed/);
    // A list: three new paragraphs, numbered.
    const made = call("insert_paragraphs", {
      handle: handle("The Board is asked to approve"),
      paragraphs: ["Approve the plan.", "Note the risks.", "Set the next meeting."],
    });
    const added = [...made.matchAll(/^\[(b\d+)\]/gm)].map((m) => m[1]);
    expect(added).toHaveLength(3);
    const list = call("format_paragraph", { handles: added, format: { list: "numbered" } });
    expect(list).toMatch(
      /1\., changed: Approve the plan\.[\s\S]*3\., changed: Set the next meeting\./,
    );
    // A picture after the sales heading, and the header edited.
    expect(
      call("insert", {
        handle: handle("heading 2: Sales by region"),
        what: "picture",
        path: "chart.png",
        alt: "Revenue by month",
      }),
    ).toMatch(/changed: \[picture: Revenue by month\]/);
    expect(
      call("replace_text", {
        handle: handle("Quarterly Board Report - Q1 2026"),
        find: "Q1 2026",
        replacement: "Q1 2026 (draft)",
      }),
    ).toContain("(draft)");

    // Exported and opened again: all of it there, every change the agent's.
    const { document: saved } = await importDocx(await exportDocx(session.document(), pkg));
    const again = openSession(saved, { author: "Check" });
    const text = (again.read({ limit: 2000, headers: true }) as { text: string }).text;
    for (const expected of [
      "table, 3 rows, 2 columns",
      "Audit committee",
      "table, 5 rows, 6 columns",
      "r5 c6, Normal, changed: 6.1",
      "Set the next meeting.",
      "[picture: Revenue by month]",
      "Q1 2026 (draft)",
    ])
      expect(text).toContain(expected);
    // The heading's color and alignment, as saved.
    expect((again.read({ limit: 2000, formatting: true }) as { text: string }).text).toMatch(
      /Executive summary\n +formatting: paragraph centered; color 1F3864: "Executive summary"/,
    );
    const changes = trackedChanges(createEditor({ document: saved }).state.doc);
    expect(changes.length).toBeGreaterThan(10);
    expect(new Set(changes.map((c) => c.author))).toEqual(new Set(["Agent"]));
  });
});
