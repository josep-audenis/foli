/**
 * Word's equations (35.4) through `.docx`: the corpus's Word-made equations (13) come back byte
 * for byte, each `m:oMath` and `m:oMathPara` as Word wrote it, and find sees their characters.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createDocument,
  createEditor,
  findAll,
  insertEquation,
  SCHEMA_VERSION,
} from "@folijs/core";
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx } from "./index.js";
import { deflateEntry, inflateEntry, readZip, writeZip } from "./zip.js";

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

describe("new equations in .docx (35.5)", () => {
  it("declare the math namespace where the file's part does not", async () => {
    // The corpus's 05 with its document part declaring no `m:`, as some producers write it.
    const letter = join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "corpus",
      "word",
      "05-business-letter.docx",
    );
    const entries = await Promise.all(
      readZip(new Uint8Array(readFileSync(letter))).map(async (entry) => {
        if (entry.name !== "word/document.xml") return entry;
        const text = new TextDecoder().decode(await inflateEntry(entry));
        const without = text.replace(/ xmlns:m="[^"]*"/, "");
        return deflateEntry(entry.name, new TextEncoder().encode(without), entry);
      }),
    );
    const { document, package: pkg } = await importDocx(writeZip(entries));
    const editor = createEditor({ document });
    editor.select(1);
    expect(editor.run(insertEquation("<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>"))).toBe(true);
    const out = await exportDocx(editor.getDocument(), pkg);
    expect(await body(out)).toContain(
      '<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">',
    );
    const back = createEditor({ document: (await importDocx(out)).document });
    let found = 0;
    back.state.doc.descendants((n) => {
      if (n.type.name === "equation") found++;
    });
    expect(found).toBe(1);
  });
});
