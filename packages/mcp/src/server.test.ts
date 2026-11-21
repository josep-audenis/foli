import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { createEditor, trackedChanges } from "@folijs/core";
import { importDocx } from "@folijs/docx";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_DOCUMENTS } from "./documents.js";
import { MAX_FILE_BYTES } from "./files.js";
import { foliServer, parseArgs } from "./server.js";
import { connect } from "./testing/client.js";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A folder with corpus documents in `root/`, and a file beside the root that must stay out of reach. */
function folder(...names: string[]) {
  const base = mkdtempSync(join(tmpdir(), "foli-mcp-"));
  made.push(base);
  const root = join(base, "root");
  mkdirSync(join(root, "sub"), { recursive: true });
  for (const name of names)
    copyFileSync(new URL(`${name}.docx`, CORPUS), join(root, `${name}.docx`));
  copyFileSync(new URL("05-business-letter.docx", CORPUS), join(base, "outside.docx"));
  return { base, root };
}

async function server(root: string, options: { overwrite?: boolean; author?: string } = {}) {
  const log: string[] = [];
  const client = await connect(
    foliServer({ root, version: "0.0.0", log: (m) => log.push(m), ...options }),
  );
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { text: string }[])[0]?.text ?? "";
    return { text, refused: result.isError === true };
  };
  return { client, call, log };
}

const NDA = "01-mutual-nda";

describe("documents", () => {
  it("opens, reads, edits and saves beside the original, every edit tracked", async () => {
    const { root } = folder(NDA);
    const { call, client } = await server(root);
    const opened = await call("open", { path: `${NDA}.docx` });
    expect(opened.refused).toBe(false);
    expect(opened.text).toMatch(
      /^Opened 01-mutual-nda\.docx as d1\.\n\[b1\] Title: MUTUAL NON-DISCLOSURE/,
    );

    expect((await call("read", { from: "b6", limit: 2 })).text).toBe(
      '[b6] heading 1, 1.: Definitions and interpretation\n[b7] Clause, 1.1: In this Agreement the following definitions apply:\n(more: read from "b8")',
    );
    expect(
      (await call("replace_text", { handle: "b1", find: "MUTUAL", replacement: "BILATERAL" })).text,
    ).toBe("[b1] Title, changed: BILATERAL NON-DISCLOSURE AGREEMENT");
    expect((await call("list_documents")).text).toBe("d1: 01-mutual-nda.docx (changes not saved)");

    const original = readFileSync(join(root, `${NDA}.docx`));
    expect((await call("save")).text).toBe("Saved d1 as 01-mutual-nda.agent.docx.");
    expect(readFileSync(join(root, `${NDA}.docx`)).equals(original)).toBe(true);
    const { document } = await importDocx(readFileSync(join(root, `${NDA}.agent.docx`)));
    const changes = trackedChanges(createEditor({ document }).state.doc);
    expect(changes.map((c) => `${c.kind} ${c.author}`).sort()).toEqual([
      "deletion foli-test",
      "insertion foli-test",
    ]);
    expect((await call("list_documents")).text).toBe("d1: 01-mutual-nda.docx");
    // A second save writes over what the server wrote itself.
    await call("replace_text", { handle: "b1", find: "BILATERAL", replacement: "RECIPROCAL" });
    expect((await call("save")).refused).toBe(false);
    expect((await call("close")).text).toBe("Closed d1.");
    expect((await call("read")).text).toContain("No document is open");
    await client.close();
  });

  it("names the author from --author, else the client, and keeps the name to a line", async () => {
    const { root } = folder(NDA);
    const { call, client } = await server(root, { author: "Maria Lopez" });
    await call("open", { path: `${NDA}.docx` });
    await call("comment", { handle: "b1", text: "Check the title." });
    await call("save", { path: "out.docx" });
    const { document } = await importDocx(readFileSync(join(root, "out.docx")));
    expect(document.comments).toMatchObject([{ author: "Maria Lopez", initials: "ML" }]);
    await client.close();
  });

  it("takes the document's id, which may be left out only while one is open", async () => {
    const { root } = folder(NDA, "05-business-letter");
    const { call, client } = await server(root);
    await call("open", { path: `${NDA}.docx` });
    await call("open", { path: "05-business-letter.docx" });
    const which = await call("read", { limit: 1 });
    expect(which).toEqual({
      text: "Several documents are open: say which with document (d1, d2).",
      refused: true,
    });
    expect((await call("read", { document: "d2", limit: 1 })).text).toContain(
      "[b1] Reference Line: Northwind Traders Limited",
    );
    expect((await call("read", { document: "d9" })).text).toBe(
      'There is no open document "d9". Open: d1, d2.',
    );
    // Handles are a document's own.
    expect(
      (
        await call("replace_text", {
          document: "d2",
          handle: "b1",
          find: "Northwind",
          replacement: "N",
        })
      ).refused,
    ).toBe(false);
    expect((await call("read", { document: "d1", limit: 1 })).text).toContain("MUTUAL");
    expect((await call("close", { document: "d2" })).text).toContain("changes that are not saved");
    expect((await call("close", { document: "d2", discard: true })).text).toBe("Closed d2.");
    expect((await call("read", { limit: 1 })).refused).toBe(false);
    await client.close();
  });

  it("opens no more than its limit", async () => {
    const { root } = folder(NDA);
    const { call, client } = await server(root);
    for (let i = 0; i < MAX_DOCUMENTS; i++)
      expect((await call("open", { path: `${NDA}.docx` })).refused).toBe(false);
    expect((await call("open", { path: `${NDA}.docx` })).text).toBe(
      `${MAX_DOCUMENTS} documents are open already: close one first.`,
    );
    await call("close", { document: "d1" });
    expect((await call("open", { path: `${NDA}.docx` })).text).toContain(
      `as d${MAX_DOCUMENTS + 1}.`,
    );
    await client.close();
  });
});

describe("files", () => {
  it("reads only .docx files under the root, and does not say what lies outside", async () => {
    const { root, base } = folder(NDA);
    const { call, client, log } = await server(root);
    const missing = 'There is no file "nope.docx" in the server\'s folder.';
    expect(await call("open", { path: "nope.docx" })).toEqual({ text: missing, refused: true });
    // An absolute path, and a stream of a file (Windows): not relative names.
    for (const path of [join(base, "outside.docx"), "/outside.docx", `${NDA}.docx:x.docx`])
      expect((await call("open", { path })).text).toMatch(
        /^A path is relative to the server's folder/,
      );
    for (const path of ["../outside.docx", "sub/../../outside.docx"]) {
      const result = await call("open", { path });
      expect(result.refused).toBe(true);
      expect(result.text).toMatch(/^There is no file /);
    }
    // A link in the root to a file outside it, where the system lets a test make one; a folder
    // linked from inside (a junction on Windows) always.
    symlinkSync(base, join(root, "up"), "junction");
    expect((await call("open", { path: "up/outside.docx" })).text).toMatch(/^There is no file /);
    try {
      symlinkSync(join(base, "outside.docx"), join(root, "link.docx"), "file");
      expect((await call("open", { path: "link.docx" })).text).toMatch(/^There is no file /);
    } catch {}

    writeFileSync(join(root, "notes.txt"), "text");
    expect((await call("open", { path: "notes.txt" })).text).toBe(
      "Only .docx files are read and written.",
    );
    expect((await call("open", { path: "sub" })).refused).toBe(true);
    mkdirSync(join(root, "folder.docx"));
    expect((await call("open", { path: "folder.docx" })).text).toBe('"folder.docx" is not a file.');
    for (const path of ["", "   ", "a\0.docx"])
      expect((await call("open", { path })).refused).toBe(true);
    expect(log).toEqual([]);
    await client.close();
  });

  it("refuses what is not a Word document, or too large, without stopping", async () => {
    const { root } = folder(NDA);
    const { call, client, log } = await server(root);
    writeFileSync(join(root, "text.docx"), "not a zip at all");
    writeFileSync(join(root, "empty.docx"), "");
    const zip = readFileSync(join(root, `${NDA}.docx`));
    writeFileSync(join(root, "cut.docx"), zip.subarray(0, zip.length / 2));
    for (const name of ["text", "empty", "cut"]) {
      const result = await call("open", { path: `${name}.docx` });
      expect(result.refused).toBe(true);
      expect(result.text).toMatch(new RegExp(`^${name}\\.docx could not be opened as a \\.docx: `));
    }
    writeFileSync(join(root, "huge.docx"), "");
    truncateSync(join(root, "huge.docx"), MAX_FILE_BYTES + 1);
    expect((await call("open", { path: "huge.docx" })).text).toBe(
      '"huge.docx" is over 64 MB: too large.',
    );
    expect((await call("open", { path: `${NDA}.docx` })).refused).toBe(false);
    expect((await call("list_documents")).text).toBe("d1: 01-mutual-nda.docx");
    expect(log).toEqual([]);
    await client.close();
  });

  it("writes only .docx files under the root, and never over a file it did not write", async () => {
    const { root, base } = folder(NDA, "05-business-letter");
    const { call, client } = await server(root);
    await call("open", { path: `${NDA}.docx` });
    await call("replace_text", { handle: "b1", find: "MUTUAL", replacement: "X" });
    const before = readFileSync(join(root, `${NDA}.docx`));
    const letter = readFileSync(join(root, "05-business-letter.docx"));

    const exists = (name: string) =>
      `"${name}" exists, and the server was not started to write over files. Save under another name.`;
    expect((await call("save", { path: `${NDA}.docx` })).text).toBe(exists(`${NDA}.docx`));
    expect((await call("save", { path: "05-business-letter.docx" })).text).toBe(
      exists("05-business-letter.docx"),
    );
    expect((await call("save", { path: join(base, "out.docx") })).text).toMatch(
      /^A path is relative to the server's folder/,
    );
    for (const path of ["../out.docx", "up/out.docx", "missing/out.docx"]) {
      if (path.startsWith("up")) symlinkSync(base, join(root, "up"), "junction");
      const result = await call("save", { path });
      expect(result.refused).toBe(true);
      expect(result.text).toMatch(/^The folder of /);
    }
    expect((await call("save", { path: "out.txt" })).text).toBe(
      "Only .docx files are read and written.",
    );
    mkdirSync(join(root, "dir.docx"));
    expect((await call("save", { path: "dir.docx" })).refused).toBe(true);

    expect(existsSync(join(base, "out.docx"))).toBe(false);
    expect(readFileSync(join(root, `${NDA}.docx`)).equals(before)).toBe(true);
    expect(readFileSync(join(root, "05-business-letter.docx")).equals(letter)).toBe(true);
    expect((await call("list_documents")).text).toContain("changes not saved");

    expect((await call("save", { path: "sub/out.docx" })).text).toBe("Saved d1 as sub/out.docx.");
    expect(existsSync(join(root, "sub", "out.docx"))).toBe(true);
    await client.close();
  });

  it("saves beside the original under the first free name, and leaves no other file", async () => {
    const { root } = folder(NDA);
    // Someone else's file where the first save would go.
    writeFileSync(join(root, `${NDA}.agent.docx`), "theirs");
    const { call, client } = await server(root);
    await call("open", { path: `${NDA}.docx` });
    await call("replace_text", { handle: "b1", find: "MUTUAL", replacement: "X" });
    expect((await call("save")).text).toBe("Saved d1 as 01-mutual-nda.agent-2.docx.");
    // Its own, the next time.
    expect((await call("save")).text).toBe("Saved d1 as 01-mutual-nda.agent-2.docx.");
    expect(readFileSync(join(root, `${NDA}.agent.docx`), "utf8")).toBe("theirs");
    // A document opened from a saved copy is saved beside the first original's names.
    await call("open", { path: `${NDA}.agent-2.docx` });
    expect((await call("save", { document: "d2" })).text).toBe(
      "Saved d2 as 01-mutual-nda.agent-2.docx.",
    );
    expect(readdirSync(root).sort()).toEqual([
      "01-mutual-nda.agent-2.docx",
      "01-mutual-nda.agent.docx",
      "01-mutual-nda.docx",
      "sub",
    ]);
    await client.close();
  });

  it("never writes through a link, though started to overwrite", async () => {
    const { root, base } = folder(NDA);
    const { call, client } = await server(root, { overwrite: true });
    await call("open", { path: `${NDA}.docx` });
    const outside = readFileSync(join(base, "outside.docx"));
    let linked = 0;
    for (const [name, to] of [
      ["planted.docx", join(base, "outside.docx")],
      // A link to nothing: a write that followed it would make the file outside the root.
      ["dangling.docx", join(base, "made.docx")],
    ] as const) {
      try {
        symlinkSync(to, join(root, name), "file");
      } catch {
        // No right to make links here (Windows without developer mode): nothing to test.
        continue;
      }
      linked++;
      expect((await call("save", { path: name })).text).toBe(
        `"${name}" is not a file that can be written.`,
      );
    }
    // A folder link named as a file (a junction, which Windows lets anyone make): the same.
    symlinkSync(base, join(root, "junction.docx"), "junction");
    expect((await call("save", { path: "junction.docx" })).text).toBe(
      '"junction.docx" is not a file that can be written.',
    );
    expect(existsSync(join(base, "made.docx"))).toBe(false);
    expect(readFileSync(join(base, "outside.docx")).equals(outside)).toBe(true);
    expect(linked === 0 || linked === 2).toBe(true);
    await client.close();
  });

  it("refuses a whole drive as its root", () => {
    expect(() => foliServer({ root: parse(process.cwd()).root, version: "0" })).toThrow(
      /whole drive/,
    );
  });

  it("writes over the original when started to", async () => {
    const { root } = folder(NDA);
    const { call, client } = await server(root, { overwrite: true });
    await call("open", { path: `${NDA}.docx` });
    await call("replace_text", { handle: "b1", find: "MUTUAL", replacement: "X" });
    expect((await call("save", { path: `${NDA}.docx` })).text).toBe(
      "Saved d1 as 01-mutual-nda.docx.",
    );
    const { document } = await importDocx(readFileSync(join(root, `${NDA}.docx`)));
    expect(JSON.stringify(document.content)).toContain("X");
    await client.close();
  });
});

describe("the command line", () => {
  it("reads its options, and says what it does not know", () => {
    expect(parseArgs([])).toEqual({ root: ".", overwrite: false });
    expect(parseArgs(["--root", "docs", "--author", "Ada", "--overwrite"])).toEqual({
      root: "docs",
      author: "Ada",
      overwrite: true,
    });
    expect(parseArgs(["--help"])).toMatchObject({ code: 0 });
    expect(parseArgs(["--version"])).toEqual({ print: "", code: 0 });
    expect(parseArgs(["--root"])).toMatchObject({ code: 2 });
    expect(parseArgs(["--port", "1"])).toMatchObject({ code: 2 });
    expect(() => foliServer({ root: "no/such/folder", version: "0" })).toThrow();
  });
});
