/**
 * A cover page (35.6) through `.docx`: written as Word's building block is (a block content
 * control of the Cover Pages gallery holding the shapes, the fields as controls and a page
 * break) and read back as the same cover. `FOLI_COVER_OUT` writes the file for Word to open.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { coverPageId, createEditor, insertCoverPage } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx } from "./index.js";
import { inflateEntry, readZip } from "./zip.js";

const file = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "corpus",
  "word",
  "05-business-letter.docx",
);

describe("cover pages in .docx (35.6)", () => {
  it("writes Word's Cover Pages control and reads it back as the cover", async () => {
    const { document } = await importDocx(new Uint8Array(readFileSync(file)));
    const editor = createEditor({ document });
    expect(editor.run(insertCoverPage("Banded"))).toBe(true);
    const out = await exportDocx(editor.getDocument());
    if (process.env.FOLI_COVER_OUT) writeFileSync(process.env.FOLI_COVER_OUT, out);
    const entry = readZip(out).find((e) => e.name === "word/document.xml");
    const xml = entry ? new TextDecoder().decode(await inflateEntry(entry)) : "";
    const body = xml.slice(xml.indexOf("<w:body>"));
    // The cover first: its control around the cover's paragraphs, the page break inside it.
    expect(body).toMatch(
      /^<w:body><w:sdt><w:sdtPr>.*<w:docPartObj><w:docPartGallery w:val="Cover Pages"\/><w:docPartUnique\/><\/w:docPartObj>.*<\/w:sdtPr><w:sdtContent><w:p\b/s,
    );
    // The page break ends the cover: after its date, before the document's own text.
    const first = String(editor.state.doc.child(6).textContent).slice(0, 12);
    const pageBreak = body.indexOf('<w:br w:type="page"/>');
    expect(pageBreak).toBeGreaterThan(body.indexOf("[Date]"));
    expect(pageBreak).toBeLessThan(body.indexOf(first));
    const cover = body.slice(0, pageBreak);
    expect(cover).toContain('<w:alias w:val="Title"/>');
    expect(cover).toContain("[Document title]");
    expect(cover).toMatch(/<wps:wsp>|<wps:wsp /);
    const back = createEditor({ document: (await importDocx(out)).document });
    expect(coverPageId(back.state)).not.toBeNull();
    expect(back.state.doc.child(0).textContent).toBe(editor.state.doc.child(0).textContent);
  });
});
