import { readFileSync } from "node:fs";
import {
  createDocument,
  createEditor,
  type FoliDocument,
  insertTable,
  type NodeJSON,
  parseDocument,
} from "@folijs/core";
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx, readPackage } from "./index.js";
import { docx } from "./testing/package.js";

/** Tables in `.docx` (10.4): read into the model, written back as they were or as edited. */

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const load = (name: string) => importDocx(new Uint8Array(readFileSync(new URL(name, CORPUS))));
const blocksOf = async (body: string) => {
  const result = await importDocx(await docx(body));
  return { ...result, blocks: result.document.content.content ?? [] };
};
const tablesOf = (d: FoliDocument) => (d.content.content ?? []).filter((b) => b.type === "table");
const cells = (table: NodeJSON) => (table.content ?? []).flatMap((r) => r.content ?? []);
const textOf = (node: NodeJSON): string =>
  node.type === "text" ? (node.text ?? "") : (node.content ?? []).map(textOf).join("");

/**
 * Every outermost `<w:tbl>…</w:tbl>` of a part, without what import drops everywhere (reported):
 * runs' editing session ids, spelling marks, Word's last page breaks.
 */
function tableSources(xml: string): string[] {
  const out: string[] = [];
  const re = /<w:tbl>|<\/w:tbl>/g;
  let depth = 0;
  let start = 0;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[0] === "<w:tbl>") {
      if (depth++ === 0) start = m.index;
    } else if (--depth === 0) out.push(xml.slice(start, m.index + m[0].length));
  }
  return out.map((t) =>
    t
      .replace(/(<w:r)( w:rsid\w*="[^"]*")+/g, "$1")
      .replace(/<w:proofErr [^>]*\/>|<w:lastRenderedPageBreak\/>/g, ""),
  );
}

describe("the price schedule (06)", () => {
  it("is a table with Word's rows, merges, header, style and a nested table", async () => {
    const { document, report } = await load("06-price-schedule.docx");
    expect(report.opaque["w:tbl"]).toBeUndefined();
    const [table] = tablesOf(document);
    if (!table) throw new Error("no table");
    expect(table.attrs?.style).toBe("MediumList1-Accent1");
    expect(table.attrs?.look).toMatchObject({ firstRow: true, noHBand: false });
    expect(table.attrs?.grid).toHaveLength(5);
    const rows = table.content ?? [];
    expect(rows.length).toBe(41);
    expect(rows[0]?.attrs?.header).toBe(true);
    expect(rows.filter((r) => r.attrs?.cantSplit).length).toBe(1);
    const all = cells(table);
    expect(all.filter((c) => c.attrs?.gridSpan === 4).length).toBe(4);
    expect(all.filter((c) => c.attrs?.vMerge === "restart").length).toBe(4);
    expect(all.filter((c) => c.attrs?.vMerge === "continue").length).toBe(32);
    // "Volume prices:", then the nested table, then the paragraph Word puts after it.
    const nested = all.find((c) => c.content?.some((b) => b.type === "table"));
    expect(nested?.content?.map((b) => b.type)).toEqual(["paragraph", "table", "paragraph"]);
    expect(nested?.content?.[1]?.content?.length).toBe(2);
    // The table style's parts, with its conditional formats.
    const style = document.styles.find((s) => s.id === "MediumList1-Accent1");
    expect(style?.conditions?.map((c) => c.type)).toEqual(
      expect.arrayContaining(["firstRow", "lastRow", "firstCol", "band1Horz"]),
    );
  });
});

describe("tables written back", () => {
  for (const name of [
    "01-mutual-nda.docx",
    "02-services-agreement-redlined.docx",
    "04-board-report.docx",
    "06-price-schedule.docx",
  ]) {
    it(`${name}: unchanged tables come back as written`, async () => {
      const original = await load(name);
      const bytes = await exportDocx(original.document, original.package);
      const out = await readPackage(bytes);
      const before = tableSources(original.package.text("/word/document.xml"));
      expect(before.length).toBeGreaterThan(0);
      expect(tableSources(out.text("/word/document.xml"))).toEqual(before);
    });
  }

  it("rewrites what an edit changed, keeping what Foli does not model", async () => {
    const original = await load("06-price-schedule.docx");
    const edited = structuredClone(original.document);
    const table = tablesOf(edited)[0] as NodeJSON;
    const row = (table.content ?? [])[1] as NodeJSON;
    const cell = (row.content ?? [])[1] as NodeJSON;
    cell.attrs = { ...cell.attrs, shading: { pattern: "clear", fill: "FFFF00" } };
    const paragraph = (cell.content ?? [])[0] as NodeJSON;
    paragraph.content = [{ type: "text", text: "Edited item" }];
    table.attrs = { ...table.attrs, justification: "center" };
    row.attrs = { ...row.attrs, cantSplit: true };
    const bytes = await exportDocx(parseDocument(edited), original.package);
    const again = await importDocx(bytes);
    const t = tablesOf(again.document)[0] as NodeJSON;
    const r = (t.content ?? [])[1] as NodeJSON;
    const c = (r.content ?? [])[1] as NodeJSON;
    expect(textOf(c)).toBe("Edited item");
    expect(c.attrs?.shading).toEqual({ pattern: "clear", fill: "FFFF00" });
    expect(t.attrs?.justification).toBe("center");
    expect(r.attrs?.cantSplit).toBe(true);
    // The table style and look stay as written; unknown children (w:cnfStyle…) kept.
    expect(t.attrs?.style).toBe("MediumList1-Accent1");
    expect(String(t.attrs?.ext)).toContain("w:tblLook");
    expect(String(c.attrs?.ext)).toContain("<w:tcW");
    // The other rows' and cells' properties are as written.
    const xml = (await readPackage(bytes)).text("/word/document.xml");
    for (const other of [(table.content ?? [])[0], (table.content ?? [])[20]]) {
      if (other?.attrs?.ext) expect(xml).toContain(String(other.attrs.ext));
      for (const c of other?.content ?? []) expect(xml).toContain(String(c.attrs?.ext));
    }
  });

  it("writes rows inserted and deleted as tracked changes", async () => {
    const { blocks } = await blocksOf(
      '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:trPr><w:ins w:id="5" w:author="A" w:date="2026-01-01T00:00:00Z"/></w:trPr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl><w:p/>',
    );
    const table = blocks[0] as NodeJSON;
    expect(table.content?.[0]?.attrs?.revision).toEqual({
      insertion: { id: 5, author: "A", date: "2026-01-01T00:00:00Z" },
    });
    const doc = parseDocument({
      schemaVersion: 4,
      section: {},
      defaults: {},
      styles: [],
      numbering: { abstracts: [], instances: [] },
      comments: [],
      content: {
        type: "doc",
        content: [
          {
            ...table,
            content: [
              table.content?.[0] as NodeJSON,
              {
                ...(table.content?.[1] as NodeJSON),
                attrs: { revision: { deletion: { id: 6, author: "B" } } },
              },
            ],
          },
          { type: "paragraph" },
        ],
      },
    });
    const xml = (await readPackage(await exportDocx(doc))).text("/word/document.xml");
    expect(xml).toContain('<w:ins w:id="5" w:author="A" w:date="2026-01-01T00:00:00Z"/>');
    expect(xml).toContain('<w:trPr><w:del w:id="6" w:author="B"/></w:trPr>');
    const again = await importDocx(await exportDocx(doc));
    expect(tablesOf(again.document)[0]?.content?.[1]?.attrs?.revision).toEqual({
      deletion: { id: 6, author: "B" },
    });
  });
});

describe("a table the editor inserts", () => {
  it("is written with Word's Table Grid style and read back the same", async () => {
    const editor = createEditor({
      document: createDocument({ type: "doc", content: [{ type: "paragraph" }] }),
    });
    expect(editor.run(insertTable(2, 3))).toBe(true);
    const document = editor.getDocument();
    const again = (await importDocx(await exportDocx(document))).document;
    const [table] = tablesOf(again);
    expect(table?.content).toHaveLength(2);
    expect(cells(table as NodeJSON)).toHaveLength(6);
    const style = again.styles.find((s) => s.id === table?.attrs?.style);
    expect(style?.name).toBe("Table Grid");
    expect(style?.table?.borders?.insideH).toMatchObject({ style: "single", size: 4 });
  });
});

describe("what the model cannot hold as a table", () => {
  const cell = "<w:tc><w:p/></w:tc>";
  const table = (rows: string, props = "<w:tblPr/>") =>
    `<w:tbl>${props}<w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>${rows}</w:tbl>`;

  it("keeps it verbatim: a cell ending with a table, markers between rows", async () => {
    for (const body of [
      `${table(`<w:tr><w:tc>${table(`<w:tr>${cell}</w:tr>`)}</w:tc></w:tr>`)}<w:p/>`,
      `${table(`<w:tr>${cell}</w:tr><w:bookmarkStart w:id="1" w:name="b"/><w:tr>${cell}</w:tr>`)}<w:p/>`,
      `${table("")}<w:p/>`,
    ]) {
      const { blocks, report } = await blocksOf(body);
      expect(blocks[0]?.type, body).toBe("opaqueBlock");
      // (A table inside one kept verbatim is counted too.)
      expect(report.opaque["w:tbl"], body).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps a table right after a table, or ending the body, verbatim (Word merges or fixes them)", async () => {
    const t = table(`<w:tr>${cell}</w:tr>`);
    const { blocks } = await blocksOf(`${t}${t}<w:p/>${t}`);
    expect(blocks.map((b) => b.type)).toEqual(["table", "opaqueBlock", "paragraph", "opaqueBlock"]);
  });

  it("keeps a table with a page, column or section break in a cell verbatim", async () => {
    for (const inside of [
      '<w:r><w:t>a</w:t><w:br w:type="page"/></w:r>',
      '<w:r><w:br w:type="column"/></w:r>',
      '<w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>',
    ]) {
      const { blocks } = await blocksOf(
        `${table(`<w:tr><w:tc><w:p>${inside}</w:p></w:tc></w:tr>`)}<w:p/>`,
      );
      expect(blocks[0]?.type, inside).toBe("opaqueBlock");
      expect(String(blocks[0]?.attrs?.xml)).toContain(inside);
    }
  });

  it("leaves what a row may not override out of its exceptions, in the element", async () => {
    const row = `<w:tr><w:tblPrEx><w:tblStyle w:val="X"/><w:jc w:val="center"/></w:tblPrEx>${cell}</w:tr>`;
    const { blocks, report } = await blocksOf(`${table(row)}<w:p/>`);
    const exceptions = blocks[0]?.content?.[0]?.attrs?.exceptions as Record<string, unknown>;
    expect(exceptions.justification).toBe("center");
    expect(exceptions.style).toBeUndefined();
    expect(String(exceptions.ext)).toContain("w:tblStyle");
    expect(report.unmodeled.join("\n")).toMatch(/style is not an exception/);
  });

  it("reads Word 2007's tblLook bit mask and a Strict percentage", async () => {
    const { blocks } = await blocksOf(
      `${table(`<w:tr>${cell}</w:tr>`, '<w:tblPr><w:tblW w:w="50%" w:type="pct"/><w:tblLook w:val="04A0"/></w:tblPr>')}<w:p/>`,
    );
    expect(blocks[0]?.attrs?.width).toEqual({ value: 2500, type: "pct" });
    expect(blocks[0]?.attrs?.look).toEqual({
      firstRow: true,
      lastRow: false,
      firstColumn: true,
      lastColumn: false,
      noHBand: false,
      noVBand: true,
    });
  });
});

describe("a table made in the model", () => {
  it("is written as Word requires and read back the same", async () => {
    const cellOf = (text: string, attrs?: Record<string, unknown>): NodeJSON => ({
      type: "tableCell",
      ...(attrs ? { attrs } : {}),
      content: [{ type: "paragraph", ...(text ? { content: [{ type: "text", text }] } : {}) }],
    });
    const doc = parseDocument({
      schemaVersion: 4,
      section: {},
      defaults: {},
      styles: [],
      numbering: { abstracts: [], instances: [] },
      comments: [],
      content: {
        type: "doc",
        content: [
          {
            type: "table",
            attrs: {
              grid: [3000, 3000],
              width: { value: 0, type: "auto" },
              borders: { top: { style: "single", size: 4 }, insideH: { style: "single", size: 4 } },
              look: { firstRow: true, noVBand: true },
            },
            content: [
              {
                type: "tableRow",
                attrs: { header: true },
                content: [cellOf("a", { vMerge: "restart" }), cellOf("b", { gridSpan: 1 })],
              },
              { type: "tableRow", content: [cellOf("", { vMerge: "continue" }), cellOf("c")] },
            ],
          },
          { type: "paragraph" },
        ],
      },
    });
    const xml = (await readPackage(await exportDocx(doc))).text("/word/document.xml");
    expect(xml).toContain(
      '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/></w:tblBorders><w:tblLook w:val="0420" w:firstRow="1" w:noVBand="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>',
    );
    expect(xml).toContain("<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>");
    const again = await importDocx(await exportDocx(doc));
    const strip = (json: unknown) =>
      JSON.parse(JSON.stringify(json), (key, value) =>
        key === "ext" || key === "gridExt" ? undefined : value,
      );
    expect(strip(again.document.content)).toEqual(strip(doc.content));
  });
});

describe("table styles", () => {
  it("are written back as read, and a changed one is refused rather than lost", async () => {
    const original = await load("06-price-schedule.docx");
    const edited = structuredClone(original.document);
    const style = edited.styles.find((s) => s.id === "MediumList1-Accent1");
    if (!style) throw new Error("no style");
    style.cell = { shading: { pattern: "clear", fill: "FF0000" } };
    await expect(exportDocx(parseDocument(edited), original.package)).rejects.toThrow(
      /changed table style \(cell\) cannot be exported yet/,
    );
  });

  it("from a schema 3 document (no parts in the model) are written as read; a change still refused", async () => {
    const original = await load("06-price-schedule.docx");
    // MediumList1-Accent1 has conditional formats (banding, first row): v3 kept them in `ext`.
    const v3 = structuredClone(original.document);
    const style = v3.styles.find((s) => s.id === "MediumList1-Accent1");
    if (!style?.conditions?.length) throw new Error("no conditional formats");
    for (const s of v3.styles) {
      if (s.type !== "table") continue;
      delete s.table;
      delete s.row;
      delete s.cell;
      delete s.conditions;
    }
    const written = await readPackage(await exportDocx(parseDocument(v3), original.package));
    expect(written.text("/word/styles.xml")).toBe(original.package.text("/word/styles.xml"));
    // One part given (even changed) means the model holds the style: compared, and refused.
    const changed = structuredClone(v3);
    const target = changed.styles.find((s) => s.id === "MediumList1-Accent1");
    if (!target) throw new Error("no style");
    target.conditions = (style.conditions ?? []).slice(1);
    await expect(exportDocx(parseDocument(changed), original.package)).rejects.toThrow(
      /changed table style \(\w+\) cannot be exported yet/,
    );
  });
});
