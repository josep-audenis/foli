import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSession } from "@folijs/agent";
import { createDocument, SCHEMA_VERSION } from "@folijs/core";
import { afterEach, describe, expect, it } from "vitest";
import { Documents } from "./documents.js";
import { fileRules } from "./files.js";
import { SANDBOX_LIMITS } from "./sandbox.js";
import { connect } from "./testing/client.js";
import { tools } from "./tools.js";
import { weight } from "./weight.js";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("a document's weight", () => {
  it("counts an inserted picture's bytes (23.6 review)", () => {
    const session = openSession(
      createDocument({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
      }),
      { author: "A" },
    );
    const handle = (session.read() as { blocks: { handle: string }[] }).blocks[0]?.handle as string;
    const png = new Uint8Array(300_000);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, 10);
    new DataView(png.buffer).setUint32(20, 10);
    const before = weight(session);
    expect(session.insertItem(handle, { kind: "picture", data: png, alt: "x" }).ok).toBe(true);
    // The data URL: base64 of the bytes, four characters for three.
    expect(weight(session) - before).toBeGreaterThan(400_000);
  });

  it("counts what positions do not: formatting, and the same formatting many times", () => {
    const heavy = { type: "runExt", attrs: { xml: `<w:rPr>${"x".repeat(10_000)}</w:rPr>` } };
    const doc = (runs: number) =>
      openSession(
        {
          ...createDocument(),
          schemaVersion: SCHEMA_VERSION,
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: Array.from({ length: runs }, (_, i) => ({
                  type: "text",
                  text: String(i % 10),
                  marks: [{ ...heavy, attrs: { xml: `${heavy.attrs.xml}${i}` } }],
                })),
              },
            ],
          },
        } as never,
        { author: "Agent" },
      );
    const one = weight(doc(1));
    const hundred = weight(doc(100));
    expect(hundred - one).toBeGreaterThan(99 * 10_000);
    // Weighing again what did not change costs nothing: the same answer, from the cache.
    const session = doc(100);
    const started = performance.now();
    for (let i = 0; i < 1000; i++) weight(session);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

/** A server with code mode over a folder holding one corpus document, already open. */
async function opened(name: string) {
  const root = mkdtempSync(join(tmpdir(), "foli-mcp-"));
  made.push(root);
  copyFileSync(new URL(`${name}.docx`, CORPUS), join(root, `${name}.docx`));
  const documents = new Documents(fileRules(root, false), () => "Agent");
  const client = await connect({
    name: "foli",
    version: "0.0.0",
    tools: tools(documents, { ...SANDBOX_LIMITS, ms: 30_000 }),
  });
  const call = async (tool: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name: tool, arguments: args });
    const text = (result.content as { text: string }[])[0]?.text ?? "";
    return { text, refused: result.isError === true };
  };
  await call("open", { path: `${name}.docx` });
  return { client, call, read: async () => (await call("read", { limit: 2000 })).text };
}

describe("the server holds a document to its weight", { timeout: 120_000 }, () => {
  it("a plain tool's edit that passes it is taken back, nothing changed", async () => {
    const { client, call, read } = await opened("01-mutual-nda");
    // Under every limit of a call: 300,000 characters a comment, again and again.
    let refused: { text: string; refused: boolean } | undefined;
    for (let i = 0; i < 100 && !refused; i++) {
      const done = await call("comment", { handle: "b3", text: "c".repeat(290_000) + i });
      if (done.refused) refused = done;
    }
    expect(refused?.text).toMatch(
      /^That would make the document more than 16 million characters larger/,
    );
    // What was done before stays; the call that passed the limit left nothing.
    const kept = (await call("list_documents")).text;
    expect(kept).toContain("changes not saved");
    expect(await read()).not.toBe("");
    expect((await call("save")).refused).toBe(false);
    await client.close();
  });

  it("a run that passes it is stopped and taken back", async () => {
    const { client, call } = await opened("01-mutual-nda");
    // Many runs each under their own limits, until the document's is met.
    let stopped: { text: string; refused: boolean } | undefined;
    for (let i = 0; i < 40 && !stopped; i++) {
      const ran = await call("run", {
        code: `for (let i = 0; i < 5; i++) doc.comment("b3", "c".repeat(190000) + i);`,
      });
      if (ran.refused) stopped = ran;
    }
    expect(stopped?.text).toMatch(/^The script was stopped\. That would make the document/);
    expect(stopped?.text).toContain("Nothing was changed");
    await client.close();
  });
});
