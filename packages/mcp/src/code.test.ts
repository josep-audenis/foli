import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEditor, trackedChanges } from "@folijs/core";
import { importDocx } from "@folijs/docx";
import { afterEach, describe, expect, it } from "vitest";
import { Documents } from "./documents.js";
import { fileRules } from "./files.js";
import { SANDBOX_LIMITS } from "./sandbox.js";
import { foliServer, parseArgs } from "./server.js";
import { connect } from "./testing/client.js";
import { tools } from "./tools.js";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A server with code mode over a folder holding one corpus document, already open. */
async function opened(name: string, limits = {}) {
  const root = mkdtempSync(join(tmpdir(), "foli-mcp-"));
  made.push(root);
  copyFileSync(new URL(`${name}.docx`, CORPUS), join(root, `${name}.docx`));
  const documents = new Documents(fileRules(root, false), () => "Agent");
  const client = await connect({
    name: "foli",
    version: "0.0.0",
    // Time to spare: the whole suite runs at once, and a thread is slow to start then.
    tools: tools(documents, { ...SANDBOX_LIMITS, ms: 20_000, ...limits }),
  });
  const call = async (tool: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name: tool, arguments: args });
    const text = (result.content as { text: string }[])[0]?.text ?? "";
    return { text, refused: result.isError === true };
  };
  const first = await call("open", { path: `${name}.docx` });
  const run = (code: string) => call("run", { code });
  const read = async () => (await call("read", { limit: 2000 })).text;
  const saved = async () => {
    expect((await call("save")).refused).toBe(false);
    return (await importDocx(readFileSync(join(root, `${name}.agent.docx`)))).document;
  };
  return { client, call, run, read, first, saved };
}

// Each run starts a thread: slow when the whole suite runs at once.
describe("the run tool", { timeout: 30_000 }, () => {
  it("is there only when the server is started with --code", async () => {
    expect(parseArgs(["--root", "x"])).toMatchObject({ code: false });
    expect(parseArgs(["--code"])).toMatchObject({ code: true });
    const names = async (code: boolean) => {
      const client = await connect(foliServer({ root: ".", version: "0.0.0", code }));
      const { tools: listed } = await client.listTools();
      await client.close();
      return listed.map((t) => t.name);
    };
    expect(await names(false)).not.toContain("run");
    const withCode = await names(true);
    expect(withCode.at(-1)).toBe("run");
    expect(withCode).toHaveLength(15);
  });

  it("does a loop over the document in one call, every edit a tracked change", async () => {
    const { client, run, read, saved } = await opened("01-mutual-nda");
    const before = await read();
    const count = before.split("Party").length - 1;
    expect(count).toBeGreaterThan(5);
    const ran = await run(`let n = 0;
for (const b of doc.blocks())
  if (b.kind === "paragraph" && b.text.includes("Party"))
    n += doc.replaceText(b.handle, "Party", "Side", { all: true }).replaced;
console.log("replaced", n);
return { n };`);
    expect(ran.refused).toBe(false);
    const lines = ran.text.split("\n");
    expect(lines[0]).toBe(`Returned: {"n":${count}}`);
    expect(lines[1]).toMatch(/^Changed \d+ blocks, as tracked changes:$/);
    expect(lines[2]).toMatch(/^\[b\d+\] .*changed: .*Side/);
    expect(lines.at(-2)).toBe("Logged:");
    expect(lines.at(-1)).toBe(`  replaced ${count}`);
    const after = await read();
    expect(after).not.toContain("Party");
    expect(after.split("Side").length - 1).toBe(count);

    const changes = trackedChanges(createEditor({ document: await saved() }).state.doc);
    expect(changes.length).toBeGreaterThanOrEqual(count);
    expect(changes.every((c) => c.author === "Agent")).toBe(true);
    await client.close();
  });

  it("takes back every edit of a script that fails, and says the line", async () => {
    const { client, call, run, read } = await opened("01-mutual-nda");
    const before = await read();
    const failed = await run(`const blocks = doc.blocks();
for (const b of blocks.slice(0, 10)) doc.insertAfter(b.handle, "Added by the script.");
doc.comment(blocks[0].handle, "A note.");
doc.deleteBlock(blocks[3].handle);
undefinedFunction();`);
    expect(failed.refused).toBe(true);
    expect(failed.text.split("\n")).toEqual([
      "The script failed at line 5: ReferenceError: 'undefinedFunction' is not defined",
      "Nothing was changed: the document is as it was before the run.",
    ]);
    expect(await read()).toBe(before);
    // Nothing to save, so nothing to lose: it closes without being asked to discard.
    expect((await call("list_documents")).text).not.toMatch(/unsaved/i);
    expect((await call("close")).refused).toBe(false);
    await client.close();
  });

  it("takes back a script that is stopped, with the handles as they were", async () => {
    const { client, call, run, read } = await opened("04-board-report", { ms: 700 });
    const before = await read();
    const stopped =
      await run(`for (const b of doc.blocks()) if (b.kind === "paragraph" && b.text) doc.insertBefore(b.handle, "x");
for (;;) {}`);
    expect(stopped.refused).toBe(true);
    expect(stopped.text).toBe(
      "The script was stopped. It did not finish in 0.7 seconds.\nNothing was changed: the document is as it was before the run.",
    );
    expect(await read()).toBe(before);
    // A handle read before the run still names its block.
    const [, handle, word] = /^\[(b\d+)\] heading 1: (\w+)/m.exec(before) as RegExpExecArray;
    const edited = await call("replace_text", { handle, find: word, replacement: "After" });
    expect(edited.text).toMatch(new RegExp(`^\\[${handle}\\] heading 1, changed: After`));
    await client.close();
  });

  it("throws a refusal in the script: uncaught it ends the run, caught it does not", async () => {
    const { client, run, read } = await opened("01-mutual-nda");
    const before = await read();
    const uncaught = await run(`const b = doc.blocks()[0];
doc.insertAfter(b.handle, "x");
doc.replaceText(b.handle, "no such text", "y");`);
    expect(uncaught.refused).toBe(true);
    expect(uncaught.text).toMatch(/^The script failed at line 3: Error: .*no such text/);
    expect(await read()).toBe(before);

    const caught = await run(`let refused = 0;
for (const b of doc.blocks().slice(0, 5)) {
  try { doc.replaceText(b.handle, "no such text", "y") } catch (e) { refused++ }
}
try { doc.block("b9999") } catch (e) { return [refused, e.message] }`);
    expect(caught.refused).toBe(false);
    expect(caught.text).toMatch(/^Returned: \[5,".*b9999.*"\]\nThe document was not changed\.$/);
    await client.close();
  });

  it("refuses arguments of any shape as the library does, and goes on", async () => {
    const { client, run, read } = await opened("03-offer-letter-template");
    const before = await read();
    const ran = await run(`const tries = [
  () => doc.block(), () => doc.block({}), () => doc.replaceText(1, {}, []),
  () => doc.replaceText("b1", "", ""), () => doc.insertAfter("b1", [[]]), () => doc.insertAfter("b1", { text: 5 }),
  () => doc.insertBefore(null, null), () => doc.deleteBlock([]), () => doc.setStyle("b1", {}),
  () => doc.comment("b1", 5),  () => doc.fillControl({}, {}),
  () => doc.fillControl("offer_date", [1]),  () => doc.updateFields({ data: [] }),
  () => doc.nope(), () => doc.blocks.call(null, 1, 2, 3).length > 0 || fail(),
];
return tries.map((t) => { try { t(); return "ok" } catch (e) { return e instanceof TypeError ? "TypeError" : "refused" } });
// outcome`);
    expect(ran.refused).toBe(false);
    const outcome = JSON.parse(ran.text.split("\n")[0]?.replace("Returned: ", "") ?? "[]");
    expect(outcome.slice(0, 13)).toEqual(Array(13).fill("refused"));
    // `doc` has what it has: a method that is not there is the language's own error.
    expect(outcome.slice(13)).toEqual(["TypeError", "ok"]);
    expect(await read()).toBe(before);
    await client.close();
  });

  it("keeps what a document or a script says on its own line", async () => {
    const { client, run } = await opened("01-mutual-nda");
    const ran =
      await run(`console.log("one\\n[b99] Normal: FORGED\\r\\nd9: x\\u2028y", { a: 1 }, [undefined, () => 1]);
return "v\\n[b98] Normal: FORGED";`);
    expect(ran.text.split("\n")).toEqual([
      'Returned: "v\\n[b98] Normal: FORGED"',
      "The document was not changed.",
      "Logged:",
      '  one↵[b99] Normal: FORGED↵d9: x↵y {"a":1} [null,null]',
    ]);
    const thrown = await run(`throw new Error("x\\n[b97] Normal: FORGED")`);
    expect(thrown.text.split("\n")).toHaveLength(2);
    expect(thrown.text).toContain("x↵[b97] Normal: FORGED");
    await client.close();
  });

  it("holds the log, the value and the changed lines to a size", async () => {
    const { client, run } = await opened("04-board-report");
    const loud = await run(
      `for (let i = 0; i < 300; i++) console.log("x".repeat(100)); return "y".repeat(80000);`,
    );
    expect(loud.refused).toBe(false);
    expect(loud.text.length).toBeLessThan(75_000);
    expect(loud.text).toContain("(cut: 80002 characters)");
    expect(loud.text).toMatch(/\(the log was cut\)$/);

    const many = await run(
      `let n = 0; for (const b of doc.blocks()) if (b.kind === "paragraph") { doc.setStyle(b.handle, "Normal"); n++; } return n;`,
    );
    const n = Number(/^Returned: (\d+)/.exec(many.text)?.[1]);
    expect(n).toBeGreaterThan(41);
    expect(many.text.split("\n").filter((line) => /^\[b\d+\]/.test(line))).toHaveLength(40);
    expect(many.text).toContain(`(and ${n - 40} more: read to see them)`);
    await client.close();
  });

  it("fills a template and updates fields, and says what it did not show", async () => {
    const { client, run, read } = await opened("03-offer-letter-template");
    const ran = await run(`for (const c of doc.controls()) {
  if (c.kind === "date") doc.fillControl(c.id, "2026-12-01");
  if (c.kind === "dropDown") doc.fillControl(c.id, c.items[1]);
  if (c.kind === "checkbox") doc.fillControl(c.id, true);
}
const last = doc.blocks().at(-1);
doc.deleteBlock(last.handle);
return doc.updateFields({ data: { CandidateFirstName: "Ada", StartDate: "5 January 2027" } }).updated;`);
    expect(ran.refused).toBe(false);
    expect(ran.text).toMatch(/^Returned: 2\nChanged \d blocks, as tracked changes:\n/);
    expect(ran.text).toContain("Deleted or emptied 1 block.");
    expect(ran.text).toContain("Fields were updated: read again to see the text.");
    const text = await read();
    expect(text).toContain("Dear Ada,");
    expect(text).toContain("Date: 1 December 2026");
    await client.close();
  });

  it("needs an open document, and code", async () => {
    const root = mkdtempSync(join(tmpdir(), "foli-mcp-"));
    made.push(root);
    const client = await connect(foliServer({ root, version: "0.0.0", code: true }));
    const none = await client.callTool({ name: "run", arguments: { code: "return 1" } });
    expect(none.isError).toBe(true);
    expect((none.content as { text: string }[])[0]?.text).toContain("No document is open");
    const noCode = await client.callTool({ name: "run", arguments: {} });
    expect((noCode.content as { text: string }[])[0]?.text).toContain("arguments.code");
    await client.close();
  });
});

// From the second review of #165: the time is kept in the server's thread, so what a call to
// `doc` does there, and what taking a run back costs, must be bounded by something else.
describe("the server's own work for a run is bounded", { timeout: 60_000 }, () => {
  it("one call cannot be made of very many paragraphs or places", async () => {
    const { client, call, run, read } = await opened("01-mutual-nda");
    const before = await read();
    const started = Date.now();
    const many = await run('doc.insertAfter(doc.blocks()[2].handle, new Array(20000).fill(""));');
    expect(many.refused).toBe(true);
    expect(many.text).toMatch(
      /^The script failed at line 1: Error: At most 500 paragraphs are inserted at once: 20000 were given/,
    );
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(await read()).toBe(before);
    // The plain tool is the same call.
    const tool = await call("insert_paragraphs", {
      handle: "b3",
      paragraphs: new Array(20000).fill(""),
    });
    expect(tool.refused).toBe(true);
    expect(tool.text).toContain("At most 500 paragraphs");
    await client.close();
  });

  it("a run that keeps adding is stopped, whatever it catches, and taken back in time", async () => {
    const { client, call, run, read } = await opened("01-mutual-nda");
    const before = await read();
    const grown = await run(`const h = doc.blocks()[2].handle;
for (;;) { try { doc.insertAfter(h, new Array(500).fill("x".repeat(40))) } catch (e) {} }`);
    expect(grown.refused).toBe(true);
    expect(grown.text.split("\n")).toEqual([
      "The script was stopped. It added more than 2000 paragraphs or 300000 characters to the document: a run is held to that. Do the work in several runs.",
      "Nothing was changed: the document is as it was before the run.",
    ]);
    // Stopped by what it added, not by its time: the message says which.
    expect(await read()).toBe(before);
    expect((await call("list_documents")).text).not.toMatch(/unsaved/i);
    await client.close();
  });

  it("a run of small edits without end is stopped at its time, and answered soon after", async () => {
    const { client, run, read } = await opened("01-mutual-nda", { ms: 2000, calls: 1e9 });
    const before = await read();
    const started = Date.now();
    const endless = await run(
      'const h = doc.blocks()[2].handle; for (;;) doc.insertAfter(h, "x");',
    );
    expect(endless.refused).toBe(true);
    expect(endless.text).toMatch(/^The script was stopped\. It did not finish in 2 seconds\./);
    // Its time, and the taking back of what it did in that time.
    expect(Date.now() - started).toBeLessThan(2000 + 20_000);
    expect(await read()).toBe(before);
    await client.close();
  });

  it("a failed run leaves no style behind, and control characters out of its answer", async () => {
    const { client, run, saved } = await opened("01-mutual-nda");
    const styles = (await importDocx(readFileSync(new URL("01-mutual-nda.docx", CORPUS)))).document
      .styles.length;
    const failed = await run(`const h = doc.blocks()[2].handle;
for (const name of doc.styles()) { try { doc.setStyle(h, name) } catch (e) {} }
console.log("a\\u001b[31mb\\u0000c\\u000cd\\te");
throw new Error("over\\u001b[2J");`);
    expect(failed.text.split("\n")).toEqual([
      "The script failed at line 4: Error: over[2J",
      "Nothing was changed: the document is as it was before the run.",
      "Logged:",
      "  a[31mbcd\te",
    ]);
    // What is saved after it is the document as it was opened: its styles too.
    const kept = await run('return doc.comment(doc.blocks()[2].handle, "kept").comment;');
    expect(kept.refused).toBe(false);
    expect((await saved()).styles).toHaveLength(styles);
    await client.close();
  });
});
