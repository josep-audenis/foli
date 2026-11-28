/**
 * Word's equations (35.4) through `.docx`: the corpus's Word-made equations (13) come back byte
 * for byte, each `m:oMath` and `m:oMathPara` as Word wrote it, and find sees their characters.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createEditor, findAll } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx } from "./index.js";
import { inflateEntry, readZip } from "./zip.js";

const file = join(import.meta.dirname, "..", "..", "..", "corpus", "word", "13-equations.docx");

const body = async (bytes: Uint8Array) => {
  const entry = readZip(bytes).find((e) => e.name === "word/document.xml");
  return entry ? new TextDecoder().decode(await inflateEntry(entry)) : "";
};
const equations = (xml: string) =>
  xml.match(/<m:oMathPara>.*?<\/m:oMathPara>|<m:oMath>.*?<\/m:oMath>/gs) ?? [];

describe("equations in .docx (35.4)", () => {
  it("writes the corpus's equations back as Word wrote them", async () => {
    const bytes = new Uint8Array(readFileSync(file));
    const { document } = await importDocx(bytes);
    const out = await exportDocx(document);
    const before = equations(await body(bytes));
    expect(before).toHaveLength(11);
    expect(equations(await body(out))).toEqual(before);
  });

  it("finds an equation's characters, never replacing them", async () => {
    const { document } = await importDocx(new Uint8Array(readFileSync(file)));
    const editor = createEditor({ document });
    expect(findAll(editor, "4ac")).toHaveLength(1);
    expect(findAll(editor, "x<0")).toHaveLength(1);
    expect(findAll(editor, "Pythagoras")).toHaveLength(1);
  });
});
