import { readFileSync } from "node:fs";
import { importDocx } from "@folijs/docx";
import { describe, expect, it } from "vitest";
import { AGENT_TOOLS, agentTools, openSession } from "./index.js";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);

describe("agentTools (ADR-0013)", () => {
  it("edits a session with the model's kind of calls, no server between", async () => {
    const { document } = await importDocx(readFileSync(new URL("01-mutual-nda.docx", CORPUS)));
    const tools = new Map(
      agentTools(openSession(document, { author: "Agent" })).map((t) => [t.name, t]),
    );
    const read = tools.get("read")?.run({ limit: 3 });
    expect(read?.isError).toBeUndefined();
    const handle = /^\[(b\d+)\]/m.exec(read?.text ?? "")?.[1] as string;

    const done = tools
      .get("insert_paragraphs")
      ?.run({ handle, paragraphs: ["Added by the tool."] });
    expect(done?.isError).toBeUndefined();
    expect(done?.text).toContain("Added by the tool.");
  });

  it("refuses arguments that do not fit the schema, in words, and does nothing", async () => {
    const { document } = await importDocx(readFileSync(new URL("01-mutual-nda.docx", CORPUS)));
    const session = openSession(document, { author: "Agent" });
    const before = session.editor.state.doc;
    const replace = agentTools(session).find((t) => t.name === "replace_text");
    expect(replace?.run({ handle: "b1", find: 3, replacement: "" })).toEqual({
      text: "Wrong arguments for replace_text: arguments.find must be string, not number.",
      isError: true,
    });
    expect(
      replace?.run({ handle: "b1", find: "a", replacement: "b", document: "d1" }).text,
    ).toMatch(/document is not an argument/);
    expect(session.editor.state.doc).toBe(before);
  });

  it("names every code-mode method once", () => {
    const names = AGENT_TOOLS.flatMap((t) => t.methods.map((m) => m.name));
    expect(new Set(names).size).toBe(names.length);
    for (const tool of AGENT_TOOLS) expect(tool.inputSchema.additionalProperties).toBe(false);
  });
});
