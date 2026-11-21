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
});
