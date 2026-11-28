/**
 * Captions and tables of figures (35.3) through `.docx`: written as Word writes them (the
 * Caption style, `SEQ Figure \* ARABIC`, `TOC \h \z \c "Figure"` in the Table of Figures style)
 * and read back unchanged. `FOLI_CAPTIONS_OUT` writes the file for Word to open.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createEditor,
  type FieldLayout,
  fieldsIn,
  insertCaption,
  insertTableOfFigures,
} from "@folijs/core";
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx } from "./index.js";
import { inflateEntry, readZip } from "./zip.js";

const root = join(import.meta.dirname, "..", "..", "..", "corpus");
const pages: FieldLayout = { pages: 1, pageAt: () => ({ number: 1, sectionPages: 1 }) };

describe("captions in .docx (35.3)", () => {
  it("writes Word's caption and table of figures, read back the same", async () => {
    const bytes = new Uint8Array(readFileSync(join(root, "word", "05-business-letter.docx")));
    const { document } = await importDocx(bytes);
    const editor = createEditor({ document });
    editor.select(1);
    expect(editor.run(insertCaption({ text: ": First figure" }))).toBe(true);
    expect(editor.run(insertCaption({ label: "Table", text: ": A table" }))).toBe(true);
    editor.select(1);
    expect(editor.run(insertTableOfFigures({ layout: pages }))).toBe(true);
    const out = await exportDocx(editor.getDocument());
    if (process.env.FOLI_CAPTIONS_OUT) writeFileSync(process.env.FOLI_CAPTIONS_OUT, out);
    const part = async (name: string) => {
      const entry = readZip(out).find((e) => e.name === name);
      return entry ? new TextDecoder().decode(await inflateEntry(entry)) : "";
    };
    const xml = await part("word/document.xml");
    expect(xml).toContain('<w:pStyle w:val="Caption"/>');
    expect(xml).toContain(" SEQ Figure \\* ARABIC ");
    expect(xml).toContain(" SEQ Table \\* ARABIC ");
    expect(xml).toContain(' TOC \\h \\z \\c "Figure" ');
    expect(xml).toContain('<w:pStyle w:val="TableofFigures"/>');
    const styles = await part("word/styles.xml");
    expect(styles).toMatch(/w:styleId="Caption"[^]*?<w:name w:val="caption"\/>/);
    expect(styles).toMatch(/w:styleId="TableofFigures"[^]*?<w:name w:val="table of figures"\/>/);
    const back = await importDocx(out);
    const again = createEditor({ document: back.document });
    const codes = (e: typeof editor) => fieldsIn(e.state.doc).map((f) => [f.instruction, f.result]);
    expect(codes(again)).toEqual(codes(editor));
  });
});
