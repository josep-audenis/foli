import { createDocument, type FoliDocument } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx, readPackage } from "./index.js";
import { docx } from "./testing/package.js";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const SETTINGS_REL =
  '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>';

/** Page borders and line numbers as Word 16 writes them (Design ▸ Page Borders, Layout ▸ Line Numbers). */
const SECT =
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>' +
  '<w:pgBorders w:offsetFrom="page"><w:top w:val="double" w:sz="4" w:space="24" w:color="2F5496" w:themeColor="accent1" w:themeShade="BF" w:shadow="1"/><w:left w:val="double" w:sz="4" w:space="24" w:color="2F5496"/><w:bottom w:val="double" w:sz="4" w:space="24" w:color="2F5496"/><w:right w:val="double" w:sz="4" w:space="24" w:color="2F5496"/></w:pgBorders>' +
  '<w:lnNumType w:countBy="5" w:restart="continuous"/><w:cols w:space="708"/><w:docGrid w:linePitch="360"/></w:sectPr>';
const BACKGROUND =
  '<w:background w:color="FFF2CC" w:themeColor="accent4" w:themeTint="33"><v:background id="_x0000_s1025" o:bwmode="white" fillcolor="#fff2cc"><v:fill r:id="rId5" type="tile"/></v:background></w:background>';

const decorated = () =>
  docx("", {
    root: `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">${BACKGROUND}<w:body><w:p><w:r><w:t>Decorated</w:t></w:r></w:p>${SECT}</w:body></w:document>`,
    rels: SETTINGS_REL,
    parts: {
      "word/settings.xml": `<w:settings xmlns:w="${W_NS}"><w:zoom w:percent="100"/><w:displayBackgroundShape/><w:defaultTabStop w:val="720"/></w:settings>`,
    },
  });

const main = async (bytes: Uint8Array) => (await readPackage(bytes)).text("/word/document.xml");
const settingsPart = async (bytes: Uint8Array) =>
  (await readPackage(bytes)).text("/word/settings.xml");

describe("page decoration (schema 9)", () => {
  it("reads the page color, page borders and line numbers", async () => {
    const { document } = await importDocx(await decorated());
    expect(document.schemaVersion).toBe(9);
    const { ext, ...background } = document.settings?.background ?? {};
    expect(background).toEqual({ color: "FFF2CC", themeColor: "accent4", themeTint: "33" });
    expect(ext).toBe(BACKGROUND);
    expect(document.section.pageBorders).toEqual({
      offsetFrom: "page",
      top: { style: "double", size: 4, space: 24, color: "2F5496", themeColor: "accent1" },
      left: { style: "double", size: 4, space: 24, color: "2F5496" },
      bottom: { style: "double", size: 4, space: 24, color: "2F5496" },
      right: { style: "double", size: 4, space: 24, color: "2F5496" },
    });
    expect(document.section.lineNumbers).toEqual({ countBy: 5, restart: "continuous" });
  });

  it("writes them back byte for byte when unchanged", async () => {
    const bytes = await decorated();
    const read = await importDocx(bytes);
    const out = await exportDocx(read.document, read.package);
    expect(await main(out)).toBe(await main(bytes));
    expect(await settingsPart(out)).toBe(await settingsPart(bytes));
    // A file that hides its background (no displayBackgroundShape) keeps its settings so.
    const hidden = await docx("<w:p/>", {
      root: `<w:document xmlns:w="${W_NS}"><w:background w:color="FF0000"/><w:body><w:p/></w:body></w:document>`,
      rels: SETTINGS_REL,
      parts: {
        "word/settings.xml": `<w:settings xmlns:w="${W_NS}"><w:zoom w:percent="90"/></w:settings>`,
      },
    });
    const again = await importDocx(hidden);
    expect(await settingsPart(await exportDocx(again.document, again.package))).toBe(
      await settingsPart(hidden),
    );
  });

  it("writes a changed page color as Word's Page Color does, Fill Effects gone", async () => {
    const read = await importDocx(await decorated());
    const doc: FoliDocument = {
      ...read.document,
      settings: { ...read.document.settings, background: { color: "DEEAF6" } },
    };
    const out = await main(await exportDocx(doc, read.package));
    expect(out).toContain('<w:background w:color="DEEAF6"/><w:body>');
    expect(out).not.toContain("v:background");
    // No color: the element goes, the rest of the part stays.
    const { background: _b, ...rest } = read.document.settings ?? {};
    const none = await main(await exportDocx({ ...read.document, settings: rest }, read.package));
    expect(none).toBe((await main(await decorated())).replace(BACKGROUND, ""));
  });

  it("adds a page color where there was none, and Word's switch to show it", async () => {
    const bytes = await docx("<w:p/>", {
      rels: SETTINGS_REL,
      parts: {
        "word/settings.xml": `<w:settings xmlns:w="${W_NS}"><w:zoom w:percent="90"/></w:settings>`,
      },
    });
    const read = await importDocx(bytes);
    expect(read.document.schemaVersion).toBe(5);
    const doc = {
      ...read.document,
      schemaVersion: 9 as const,
      settings: { background: { color: "FF0000" } },
    };
    const out = await exportDocx(doc, read.package);
    expect(await main(out)).toContain('<w:background w:color="FF0000"/><w:body>');
    expect(await settingsPart(out)).toBe(
      `<w:settings xmlns:w="${W_NS}"><w:zoom w:percent="90"/><w:displayBackgroundShape/></w:settings>`,
    );
    expect((await importDocx(out)).document.settings?.background?.color).toBe("FF0000");
  });

  it("rewrites changed page borders and line numbers in their place, the rest kept", async () => {
    const read = await importDocx(await decorated());
    const section = {
      ...read.document.section,
      pageBorders: {
        display: "firstPage" as const,
        top: { style: "single", size: 12, space: 1, color: "FF0000" },
        bottom: { style: "single", size: 12, space: 1, color: "FF0000" },
      },
      lineNumbers: { countBy: 1, start: 9, distance: 360, restart: "newPage" as const },
    };
    const out = await main(await exportDocx({ ...read.document, section }, read.package));
    expect(out).toContain(
      '<w:pgBorders w:display="firstPage"><w:top w:val="single" w:sz="12" w:space="1" w:color="FF0000"/><w:bottom w:val="single" w:sz="12" w:space="1" w:color="FF0000"/></w:pgBorders><w:lnNumType w:countBy="1" w:start="9" w:distance="360" w:restart="newPage"/><w:cols w:space="708"/>',
    );
    // Removed: the elements go.
    const { pageBorders: _p, lineNumbers: _l, ...plain } = read.document.section;
    const bare = await main(await exportDocx({ ...read.document, section: plain }, read.package));
    expect(bare).not.toContain("pgBorders");
    expect(bare).not.toContain("lnNumType");
    expect(bare).toContain('w:gutter="0"/><w:cols w:space="708"/>');
  });

  it("makes them in a new package, and reads them back", async () => {
    const doc = { ...createDocument(), schemaVersion: 9 as const };
    doc.section.pageBorders = {
      offsetFrom: "page",
      zOrder: "back",
      left: { style: "dotted", size: 8, space: 24, color: "00B050" },
    };
    doc.section.lineNumbers = { countBy: 2 };
    doc.settings = { background: { color: "E2EFD9", themeColor: "accent6", themeTint: "33" } };
    const bytes = await exportDocx(doc);
    expect(await main(bytes)).toContain(
      '<w:background w:color="E2EFD9" w:themeColor="accent6" w:themeTint="33"/><w:body>',
    );
    expect(await settingsPart(bytes)).toContain("<w:displayBackgroundShape/>");
    const back = (await importDocx(bytes)).document;
    expect(back.schemaVersion).toBe(9);
    expect(back.section.pageBorders).toEqual(doc.section.pageBorders);
    expect(back.section.lineNumbers).toEqual({ countBy: 2 });
    const { ext: _e, ...color } = back.settings?.background ?? {};
    expect(color).toEqual(doc.settings.background);
  });

  it("keeps what the model cannot hold verbatim: an lnNumType without countBy, an unknown offset", async () => {
    const sect = SECT.replace(
      '<w:lnNumType w:countBy="5" w:restart="continuous"/>',
      "<w:lnNumType/>",
    ).replace('w:offsetFrom="page"', 'w:offsetFrom="sideways"');
    const bytes = await docx(`<w:p/>${sect}`);
    const read = await importDocx(bytes);
    expect(read.document.section.lineNumbers).toBeUndefined();
    // An offset the schema does not know: the borders stay in the section's verbatim XML.
    expect(read.document.section.pageBorders).toBeUndefined();
    expect(read.report.unmodeled.some((u) => u.includes("sectPr"))).toBe(true);
    expect(await main(await exportDocx(read.document, read.package))).toBe(await main(bytes));
  });
});

describe("suppressed line numbers (32.5)", () => {
  it("reads and writes w:suppressLineNumbers, the rest of the paragraph as it was", async () => {
    const bytes = await docx(
      '<w:p><w:pPr><w:suppressLineNumbers/><w:jc w:val="center"/></w:pPr><w:r><w:t>A</w:t></w:r></w:p><w:sectPr><w:lnNumType w:countBy="1"/></w:sectPr>',
    );
    const read = await importDocx(bytes);
    expect(read.document.schemaVersion).toBe(9);
    expect(read.document.content.content?.[0]?.attrs?.suppressLineNumbers).toBe(true);
    expect(await main(await exportDocx(read.document, read.package))).toBe(await main(bytes));
    const doc = structuredClone(read.document);
    (doc.content.content?.[0]?.attrs as Record<string, unknown>).suppressLineNumbers = null;
    const out = await main(await exportDocx(doc, read.package));
    expect(out).not.toContain("suppressLineNumbers");
    expect(out).toContain('<w:jc w:val="center"/>');
  });
});
