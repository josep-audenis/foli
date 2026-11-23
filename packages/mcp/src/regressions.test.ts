import { EventEmitter } from "node:events";
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportDocx, importDocx } from "@folijs/docx";
import { afterEach, describe, expect, it } from "vitest";
import { Documents } from "./documents.js";
import { fileRules } from "./files.js";
import { cutResult, MAX_RESULT_CHARS, serve } from "./protocol.js";
import { foliServer } from "./server.js";
import { connect } from "./testing/client.js";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const NDA = "01-mutual-nda.docx";
const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A root holding the corpus NDA, with a `sub` folder. */
function folder() {
  const root = mkdtempSync(join(tmpdir(), "foli-mcp-"));
  made.push(root);
  mkdirSync(join(root, "sub"));
  copyFileSync(new URL(NDA, CORPUS), join(root, NDA));
  return root;
}

async function server(root: string) {
  const log: string[] = [];
  const client = await connect(foliServer({ root, version: "0.0.0", log: (m) => log.push(m) }));
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { text: string }[])[0]?.text ?? "";
    return { text, refused: result.isError === true };
  };
  return { client, call, log };
}

describe("regressions", () => {
  it("opens a file once, whatever capitals or link name it by", async () => {
    const root = folder();
    linkSync(join(root, NDA), join(root, "sub", "linked.docx"));
    const { client, call } = await server(root);
    expect((await call("open", { path: NDA })).refused).toBe(false);
    // Where capitals do not count (Windows, macOS) the name in capitals is the same file.
    if (existsSync(join(root, NDA.toUpperCase()))) {
      const again = await call("open", { path: NDA.toUpperCase() });
      expect(again.refused).toBe(true);
      expect(again.text).toContain("is open already, as d1");
    }
    expect((await call("open", { path: "sub/linked.docx" })).text).toContain("open already, as d1");
    expect((await call("list_documents")).text).toBe(`d1: ${NDA}`);
    await client.close();
  });

  it("reads and writes names that only start with two dots", async () => {
    const root = folder();
    copyFileSync(join(root, NDA), join(root, "..draft.docx"));
    mkdirSync(join(root, "..drafts"));
    const { client, call } = await server(root);
    expect((await call("open", { path: "..draft.docx" })).text).toMatch(/^Opened \.\.draft\.docx/);
    expect((await call("save", { path: "..drafts/out.docx" })).text).toBe(
      "Saved d1 as ..drafts/out.docx.",
    );
    expect(existsSync(join(root, "..drafts", "out.docx"))).toBe(true);
    await client.close();
  });

  it("counts a field updated in a header as a change to save", async () => {
    const root = folder();
    // The letter's only field, the header's page number, made a date: the body has none.
    const letter = await importDocx(readFileSync(new URL("05-business-letter.docx", CORPUS)));
    const dated = JSON.parse(JSON.stringify(letter.document).replace(/ PAGE /g, " DATE "));
    writeFileSync(join(root, "letter.docx"), await exportDocx(dated, letter.package));
    const { client, call } = await server(root);
    await call("open", { path: "letter.docx" });
    // Reading, and an edit refused, change nothing.
    await call("read");
    expect((await call("replace_text", { handle: "b1", find: "", replacement: "x" })).refused).toBe(
      true,
    );
    expect((await call("list_documents")).text).toBe("d1: letter.docx");
    expect((await call("update_fields")).text).toMatch(/^1 field updated/);
    expect((await call("list_documents")).text).toBe("d1: letter.docx (changes not saved)");
    const closed = await call("close");
    expect(closed.refused).toBe(true);
    expect(closed.text).toContain("changes that are not saved");
    await client.close();
  });

  it("says a save's failure on one line, as an open's", async () => {
    const root = folder();
    const documents = new Documents(fileRules(root, false), () => "Agent");
    const document = await documents.open(NDA);
    if (!("session" in document)) throw new Error(document.text);
    document.session.document = () => {
      throw new Error(`first line\nsecond line\u2028${"x".repeat(1000)}`);
    };
    const saved = await documents.save(document, "out.docx");
    expect(saved.isError).toBe(true);
    expect(saved.text).not.toMatch(/[\r\n\u2028]/);
    expect(saved.text).toContain("first line second line");
    expect(saved.text.length).toBeLessThan(400);
  });

  it("ignores a byte order mark before the first message", async () => {
    const lines: string[] = [];
    const input = (async function* () {
      yield Buffer.from(`﻿${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })}\n`);
    })();
    await serve(input, { write: (t) => lines.push(t) }, { name: "t", version: "0", tools: [] });
    expect(JSON.parse(lines[0] ?? "")).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });

  it("ignores a byte order mark that comes split over chunks", async () => {
    const lines: string[] = [];
    const message = Buffer.from(`﻿${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })}\n`);
    const input = (async function* () {
      yield message.subarray(0, 1);
      yield message.subarray(1, 2);
      yield message.subarray(2);
    })();
    await serve(input, { write: (t) => lines.push(t) }, { name: "t", version: "0", tools: [] });
    expect(JSON.parse(lines[0] ?? "")).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });

  it("stops when the output closes while an answer waits to be taken", async () => {
    const output = Object.assign(new EventEmitter(), { write: () => false });
    const input = (async function* () {
      yield `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })}\n`;
      yield `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" })}\n`;
    })();
    const done = serve(input, output, { name: "t", version: "0", tools: [] });
    await new Promise((resolve) => setImmediate(resolve));
    output.emit("close");
    await expect(done).rejects.toThrow(/closed/);
    expect(output.listenerCount("drain") + output.listenerCount("error")).toBe(0);
  });

  it("saves again over its own file named in other capitals", async () => {
    const root = folder();
    const { client, call } = await server(root);
    await call("open", { path: NDA });
    expect((await call("save", { path: "out.docx" })).refused).toBe(false);
    // Only where capitals do not count (Windows, macOS): elsewhere OUT.DOCX is another file.
    if (existsSync(join(root, "OUT.DOCX")))
      expect((await call("save", { path: "OUT.DOCX" })).text).toBe("Saved d1 as OUT.DOCX.");
    // Someone else's file is still not written over.
    expect((await call("save", { path: NDA })).refused).toBe(true);
    await client.close();
  });

  it("never saves over the file another open document came from", async () => {
    const root = folder();
    const { client, call } = await server(root);
    await call("open", { path: NDA });
    expect((await call("save")).text).toBe("Saved d1 as 01-mutual-nda.agent.docx.");
    await call("open", { path: "01-mutual-nda.agent.docx" });
    await call("replace_text", {
      document: "d2",
      handle: "b1",
      find: "MUTUAL",
      replacement: "BILATERAL",
    });
    expect((await call("save", { document: "d2" })).refused).toBe(false);
    const again = await call("save", { document: "d1", path: "01-mutual-nda.agent.docx" });
    expect(again.refused).toBe(true);
    expect(again.text).toContain("open as d2");
    // With no path, the next name; closed, d2's saved file is still not d1's to write over.
    expect((await call("save", { document: "d1" })).text).toBe(
      "Saved d1 as 01-mutual-nda.agent-2.docx.",
    );
    await call("close", { document: "d2" });
    expect((await call("save", { document: "d1" })).text).toBe(
      "Saved d1 as 01-mutual-nda.agent-2.docx.",
    );
    expect((await call("save", { document: "d1", path: "01-mutual-nda.agent.docx" })).refused).toBe(
      true,
    );
    const { document } = await importDocx(readFileSync(join(root, "01-mutual-nda.agent.docx")));
    expect(JSON.stringify(document)).toContain("BILATERAL");
    await client.close();
  });

  it("takes null for an argument that may be left out as leaving it out (21.11)", async () => {
    const root = folder();
    const { client, call } = await server(root);
    await call("open", { path: NDA });
    const read = await call("read", { document: null, from: null });
    expect(read.refused).toBe(false);
    expect(read.text).toContain("[b1]");
    await client.close();
  });

  it("cuts a long result at a block's end and keeps where to read on (21.11)", () => {
    const line = (n: number) => `[b${String(n).padStart(3, "0")}] ${"x".repeat(990)}`;
    const lines = Array.from({ length: 400 }, (_, n) => line(n));
    const text = `${lines.join("\n")}\n(more: read from "b400")`;
    const cut = cutResult(text);
    expect(cut.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(cut.endsWith('\n(more: read from "b400")')).toBe(true);
    const kept = cut.split("\n").filter((l) => l.startsWith("[b"));
    expect(kept.every((l) => l.length === line(0).length)).toBe(true);
    // One line longer than all the room: never half a surrogate pair.
    const emoji = cutResult("😀".repeat(MAX_RESULT_CHARS));
    expect(emoji).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });
});
