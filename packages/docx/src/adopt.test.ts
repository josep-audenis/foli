import type { FoliDocument } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx, readPackage } from "./index.js";
import { docx } from "./testing/package.js";

/** A document saved before schema 9, exported with its package (32.5's review). */

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const STYLES_REL =
  '<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';

describe("a schema 8 document's kept suppressLineNumbers", () => {
  it("in a style comes back in styles.xml", async () => {
    const styles = `<w:styles xmlns:w="${W_NS}"><w:style w:type="paragraph" w:styleId="X"><w:name w:val="X"/><w:pPr><w:suppressLineNumbers/><w:jc w:val="center"/></w:pPr></w:style></w:styles>`;
    const bytes = await docx('<w:p><w:pPr><w:pStyle w:val="X"/></w:pPr></w:p>', {
      rels: STYLES_REL,
      parts: { "word/styles.xml": styles },
    });
    const read = await importDocx(bytes);
    const old = structuredClone(read.document) as FoliDocument;
    const style = old.styles.find((s) => s.id === "X");
    if (style?.paragraph) delete style.paragraph.suppressLineNumbers;
    const out = await exportDocx({ ...old, schemaVersion: 8 }, read.package);
    const text = (await readPackage(out)).text("/word/styles.xml");
    expect(text).toContain("<w:suppressLineNumbers/>");
  });
});
