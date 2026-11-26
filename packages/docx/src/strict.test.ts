import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importDocx, readPackage } from "./index.js";
import { toStrict, toTransitional } from "./strict.js";
import { docx } from "./testing/package.js";

const TWINS = new URL("../../../corpus/word/strict/", import.meta.url);
const stems = readdirSync(TWINS)
  .filter((n) => n.endsWith(".strict.docx"))
  .map((n) => n.slice(0, -".strict.docx".length));
const bytes = (name: string) => new Uint8Array(readFileSync(new URL(name, TWINS)));

/** What two saves of one document by Word differ in anyway: revision-save and paragraph ids. */
const SAVE_IDS = /^(w14:paraId|w14:textId|w:rsid\w*)$/;
const comparable = (value: unknown) =>
  JSON.parse(JSON.stringify(value, (key, v) => (SAVE_IDS.test(key) ? undefined : v)));

describe("Strict Open XML (ADR-0014)", () => {
  it("has the twins", () => {
    expect(stems).toHaveLength(9);
  });

  for (const stem of stems) {
    it(`${stem}: the Strict file imports as its Transitional twin`, async () => {
      const strict = await importDocx(bytes(`${stem}.strict.docx`));
      const transitional = await importDocx(bytes(`${stem}.transitional.docx`));
      expect(comparable(strict.document)).toEqual(comparable(transitional.document));
      expect(strict.report.opaque).toEqual(transitional.report.opaque);
      expect(strict.report.dropped).toEqual(transitional.report.dropped);
    });

    it(`${stem}: every XML part comes back to Word's Strict text`, async () => {
      const pkg = await readPackage(bytes(`${stem}.strict.docx`));
      expect(pkg.conformance).toBe("strict");
      const decoder = new TextDecoder();
      for (const part of pkg.parts) {
        if (!/xml$/.test(part.contentType) && !part.name.endsWith(".rels")) continue;
        const original = decoder.decode(part.data);
        const transitional = pkg.text(part.name);
        expect(transitional, part.name).not.toMatch(/purl\.oclc\.org\/ooxml/);
        expect(toStrict(transitional), part.name).toBe(original);
      }
    });
  }

  it("reads other units and spellings to the nearest twip", () => {
    const W = "http://purl.oclc.org/ooxml/wordprocessingml/main";
    const out = toTransitional(
      `<w:document xmlns:w="${W}" w:conformance="strict"><w:body><w:p><w:pPr>` +
        '<w:ind w:start="0.5in" w:end="1.27cm" w:hanging="36.0pt"/><w:jc w:val="end"/>' +
        '</w:pPr></w:p><w:tbl><w:tblPr><w:tblW w:w="50%" w:type="pct"/><w:tblCellMar>' +
        '<w:start w:w="5.40pt" w:type="dxa"/></w:tblCellMar></w:tblPr></w:tbl></w:body></w:document>',
    );
    expect(out).toBe(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr>' +
        '<w:ind w:left="720" w:right="720" w:hanging="720"/><w:jc w:val="right"/>' +
        '</w:pPr></w:p><w:tbl><w:tblPr><w:tblW w:w="2500" w:type="pct"/><w:tblCellMar>' +
        '<w:left w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:tbl></w:body></w:document>',
    );
  });

  it("writes what Strict lacks as Strict has it", () => {
    const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    expect(
      toStrict(
        `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr>` +
          '<w:tblLook w:val="04A0" w:firstRow="1"/></w:tblPr></w:tbl></w:body></w:document>',
      ),
    ).toBe(
      '<w:document xmlns:w="http://purl.oclc.org/ooxml/wordprocessingml/main" w:conformance="strict"><w:body><w:tbl><w:tblPr>' +
        '<w:tblLook w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1" w:firstRow="1"/>' +
        "</w:tblPr></w:tbl></w:body></w:document>",
    );
  });

  it("renames an element written with an end tag, and writes w:val in w:'s prefix", () => {
    const W = "http://purl.oclc.org/ooxml/wordprocessingml/main";
    const out = toTransitional(
      `<w:tbl xmlns:w="${W}"><w:tblPr><w:tblBorders><w:start w:val="single"></w:start></w:tblBorders>` +
        '<w:tblLook xmlns:x="urn:x" x:a="1" w:firstRow="1"/></w:tblPr></w:tbl>',
    );
    expect(out).toContain('<w:left w:val="single"></w:left>');
    expect(out).toContain('<w:tblLook xmlns:x="urn:x" w:val="0020" x:a="1" w:firstRow="1"/>');
  });

  it("writes text scale with its percent sign, and keeps a w:val it cannot read", () => {
    const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const out = toStrict(
      `<w:r xmlns:w="${W}"><w:rPr><w:w w:val="90"/></w:rPr><w:tblLook w:val="zz"/></w:r>`,
    );
    expect(out).toContain('<w:w w:val="90%"/>');
    expect(out).toContain('<w:tblLook w:val="zz"/>');
  });

  it("counts a Strict part's nodes against maxNodes once", async () => {
    const strictRels =
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
    const paragraphs = "<w:p/>".repeat(200);
    const bytes = await docx("", {
      root: `<w:document xmlns:w="http://purl.oclc.org/ooxml/wordprocessingml/main" w:conformance="strict"><w:body>${paragraphs}</w:body></w:document>`,
      parts: { "_rels/.rels": strictRels },
    });
    const pkg = await readPackage(bytes, { maxNodes: 100 });
    expect(() => pkg.text("/word/document.xml")).toThrow(/maxNodes/);
    const roomy = await readPackage(bytes, { maxNodes: 1200 });
    expect(roomy.xml("/word/document.xml").root.local).toBe("document");
  });

  it("leaves a Transitional package as it is", async () => {
    const pkg = await readPackage(await docx("<w:p/>"));
    expect(pkg.conformance).toBe("transitional");
  });

  it("refuses to write a Strict package until it writes Strict back", async () => {
    const pkg = await readPackage(bytes(`${stems[0]}.strict.docx`));
    await expect(pkg.write()).rejects.toThrow(/Strict Open XML/);
  });
});
