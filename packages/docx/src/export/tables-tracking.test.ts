import { readFileSync } from "node:fs";
import { createEditor, parseDocument, trackedChanges } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx, readPackage } from "../index.js";
import { docx } from "../testing/package.js";

const fixture = new URL("../../../core/fixtures/formats/v8.json", import.meta.url);
const v8 = () => parseDocument(JSON.parse(readFileSync(fixture, "utf8")));

/** The table's, its first row's and its first cell's recorded formatting. */
const records = (document: ReturnType<typeof v8>) => {
  const table = document.content.content?.find((b) => b.type === "table");
  const row = table?.content?.[0];
  const cell = row?.content?.[0];
  return [table, row, cell].map((n) => n?.attrs?.formatChange ?? null);
};

describe("a table's tracked formatting through .docx (23.2)", () => {
  it("is written as Word records it and read back the same", async () => {
    const bytes = await exportDocx(v8());
    const xml = (await readPackage(bytes)).text("/word/document.xml");
    expect(xml).toMatch(
      /<w:tblPrChange w:id="\d+" w:author="Ada Lovelace" w:date="2026-11-23T12:00:00Z"><w:tblPr>.*?<w:tblStyle w:val="TableGrid"\/>.*?<\/w:tblPr><\/w:tblPrChange>/,
    );
    expect(xml).toMatch(/<w:trPrChange [^>]*><w:trPr\/?>(<\/w:trPr>)?<\/w:trPrChange>/);
    expect(xml).toMatch(/<w:tcPrChange [^>]*><w:tcPr><w:tcW [^>]*\/><\/w:tcPr><\/w:tcPrChange>/);
    // The row's header and the cell's shading are the new look; the previous holds neither.
    expect(xml).toContain("<w:tblHeader/>");

    const { document } = await importDocx(bytes);
    expect(document.schemaVersion).toBe(8);
    expect(records(document)).toEqual(records(v8()));
    // Untouched, a read file is written back as it was.
    const imported = await importDocx(bytes);
    const again = await exportDocx(imported.document, imported.package);
    expect((await readPackage(again)).text("/word/document.xml")).toBe(xml);
  });

  it("is accepted and rejected in the editor after a round trip", async () => {
    const { document } = await importDocx(await exportDocx(v8()));
    const rejected = createEditor({ document });
    expect(trackedChanges(rejected.state.doc).map((c) => c.kind)).toEqual([
      "tableFormatting",
      "tableFormatting",
      "tableFormatting",
    ]);
    rejected.commands.rejectAllChanges();
    const table = rejected.getDocument().content.content?.find((b) => b.type === "table");
    expect(table?.attrs?.style).toBe("TableGrid");
    expect(table?.content?.[0]?.attrs?.header).toBeUndefined();
    expect(table?.content?.[0]?.content?.[0]?.attrs?.shading).toBeUndefined();
    expect(rejected.getDocument().schemaVersion).toBe(7);

    const accepted = createEditor({ document });
    accepted.commands.acceptAllChanges();
    const kept = accepted.getDocument().content.content?.find((b) => b.type === "table");
    expect(kept?.attrs?.style).toBeUndefined();
    expect(kept?.content?.[0]?.attrs?.header).toBe(true);
    expect(trackedChanges(accepted.state.doc)).toEqual([]);
  });
});

describe("a table style's own recorded change (23.2 review)", () => {
  it("stays in the style's ext: the import does not fail", async () => {
    const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const STYLES = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles";
    const { document } = await importDocx(
      await docx("<w:p/>", {
        rels: `<Relationship Id="s" Type="${STYLES}" Target="styles.xml"/>`,
        parts: {
          "word/styles.xml": `<w:styles xmlns:w="${W}"><w:style w:type="table" w:styleId="T"><w:name w:val="T"/><w:tblPr><w:tblPrChange w:id="8" w:author="Bob"><w:tblPr/></w:tblPrChange></w:tblPr><w:tcPr><w:shd w:val="clear" w:fill="FF0000"/><w:tcPrChange w:id="9" w:author="Bob"><w:tcPr/></w:tcPrChange></w:tcPr></w:style></w:styles>`,
        },
      }),
    );
    const style = document.styles.find((s) => s.id === "T");
    expect(style?.cell).toMatchObject({ shading: { fill: "FF0000" } });
    expect(JSON.stringify(style)).not.toContain('"formatChange"');
  });
});
