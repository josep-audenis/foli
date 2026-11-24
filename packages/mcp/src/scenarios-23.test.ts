import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEditor, trackedChanges } from "@folijs/core";
import { importDocx } from "@folijs/docx";
import { afterEach, describe, expect, it } from "vitest";
import { foliServer } from "./server.js";
import { connect } from "./testing/client.js";

/** 23.9: the tasks of `@folijs/agent`'s `scenarios-23.test.ts`, through the server. */
const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function png(): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, 400);
  new DataView(bytes.buffer).setUint32(20, 200);
  return bytes;
}

describe("Phase 23's areas through the MCP server (23.9)", () => {
  it("builds a table, adds a row, formats a heading, makes a list, inserts a picture, edits a header", async () => {
    const root = mkdtempSync(join(tmpdir(), "foli-mcp-"));
    made.push(root);
    copyFileSync(new URL("04-board-report.docx", CORPUS), join(root, "report.docx"));
    writeFileSync(join(root, "chart.png"), png());
    const client = await connect(foliServer({ root, version: "0.0.0", author: "Agent" }));
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      const text = (result.content as { text: string }[])[0]?.text ?? "";
      if (result.isError) throw new Error(`${name}: ${text}`);
      return text;
    };
    const handle = async (text: string) => {
      const read = await call("read", { limit: 2000, headers: true });
      const line = read.split("\n").find((l) => l.includes(text));
      return /^\[([bhf]\d+)\]/.exec(line ?? "")?.[1] as string;
    };
    await call("open", { path: "report.docx" });

    expect(
      await call("edit_table", {
        handle: await handle("The Board is asked to approve"),
        action: "insert_table",
        cells: [
          ["Decision", "Owner"],
          ["Approve the capital plan", "Board"],
        ],
        header: true,
      }),
    ).toMatch(/table, 2 rows, 2 columns, Table Grid, 1 header row, changed/);
    expect(
      await call("edit_table", {
        handle: await handle("table, 4 rows, 6 columns"),
        action: "insert_rows",
        row: 4,
        cells: [["Total", "", "1.8", "2.5", "1.8", "6.1"]],
      }),
    ).toMatch(/r5 c1, Normal, changed: Total/);
    const summary = await handle("heading 1: Executive summary");
    await call("format_text", { handle: summary, format: { color: "1F3864" } });
    await call("format_paragraph", { handles: [summary], format: { align: "center" } });
    const added = [
      ...(
        await call("insert_paragraphs", {
          handle: await handle("The Board is asked to approve"),
          paragraphs: ["Approve the plan.", "Note the risks."],
        })
      ).matchAll(/^\[(b\d+)\]/gm),
    ].map((m) => m[1]);
    expect(await call("format_paragraph", { handles: added, format: { list: "bullet" } })).toMatch(
      /changed: Note the risks\./,
    );
    expect(
      await call("insert", {
        handle: await handle("heading 2: Sales by region"),
        what: "picture",
        path: "chart.png",
        alt: "Revenue by month",
      }),
    ).toMatch(/\[picture: Revenue by month\]/);
    await call("replace_text", {
      handle: await handle("Quarterly Board Report - Q1 2026"),
      find: "Q1 2026",
      replacement: "Q1 2026 (draft)",
    });
    expect(await call("save", {})).toMatch(/report\.agent\.docx/);
    await client.close();

    const { document } = await importDocx(readFileSync(join(root, "report.agent.docx")));
    const text = JSON.stringify(document);
    for (const expected of [
      "Approve the capital plan",
      "6.1",
      "Note the risks.",
      "Revenue by month",
      "(draft)",
    ])
      expect(text).toContain(expected);
    const changes = trackedChanges(createEditor({ document }).state.doc);
    expect(new Set(changes.map((c) => c.author))).toEqual(new Set(["Agent"]));
  });
});
