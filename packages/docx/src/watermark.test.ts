import { createDocument, type FoliDocument, type NodeJSON } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { DEFAULT_NAMESPACES } from "./export/xmlout.js";
import { exportDocx, importDocx, readPackage } from "./index.js";
import { docx } from "./testing/package.js";
import { readWatermark, watermarkXml } from "./watermark.js";
import { parseXml } from "./xml.js";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const NS = `xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"`;
/** Word 16's CONFIDENTIAL 1 (Design ▸ Watermark), as it saved it. */
const CONFIDENTIAL =
  '<w:pict w14:anchorId="04B42E3D"><v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas><v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/><v:textpath on="t" fitshape="t"/><v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles><o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype><v:shape id="PowerPlusWaterMarkObject357476642" o:spid="_x0000_s1025" type="#_x0000_t136" style="position:absolute;margin-left:0;margin-top:0;width:527.85pt;height:131.95pt;rotation:315;z-index:-251657216;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f" fillcolor="silver" stroked="f"><v:fill opacity=".5"/><v:textpath style="font-family:&quot;Calibri&quot;;font-size:1pt" string="CONFIDENTIAL"/><w10:wrap anchorx="margin" anchory="margin"/></v:shape></w:pict>';
const HEADER_REL =
  '<Relationship Id="rIdH" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>';

const withHeader = (pict: string) =>
  docx(
    '<w:p><w:r><w:t>Body</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="rIdH"/></w:sectPr>',
    {
      rels: HEADER_REL,
      parts: {
        "word/header1.xml": `<w:hdr ${NS}><w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr><w:r><w:rPr><w:noProof/></w:rPr>${pict}</w:r></w:p></w:hdr>`,
      },
    },
  );

const runsOf = (doc: FoliDocument) =>
  Object.values(doc.stories ?? {}).flatMap(
    (s) => s.content.content?.[0]?.content ?? [],
  ) as NodeJSON[];

describe("watermarks (32.3)", () => {
  it("reads Word's text watermark", () => {
    const pict = parseXml(`<x ${NS}>${CONFIDENTIAL}</x>`).root.children.find(
      (c) => c.kind === "element",
    );
    expect(
      readWatermark(pict as never, { relationship: () => undefined, partOf: () => undefined }),
    ).toEqual({
      kind: "text",
      text: "CONFIDENTIAL",
      font: "Calibri",
      color: "C0C0C0",
      semitransparent: true,
      rotation: 315,
      width: 10557,
      height: 2639,
    });
  });

  it("imports it as a header's opaque run with its watermark, and writes it back verbatim", async () => {
    const bytes = await withHeader(CONFIDENTIAL);
    const read = await importDocx(bytes);
    expect(read.document.schemaVersion).toBe(9);
    const [run] = runsOf(read.document);
    expect(run?.type).toBe("opaqueInline");
    expect(run?.attrs?.watermark).toMatchObject({ kind: "text", text: "CONFIDENTIAL" });
    const out = await exportDocx(read.document, read.package);
    const header = async (b: Uint8Array) => (await readPackage(b)).text("/word/header1.xml");
    expect(await header(out)).toBe(await header(bytes));
  });

  it("writes a changed one as Word does, and reads it back", async () => {
    const read = await importDocx(await withHeader(CONFIDENTIAL));
    const doc = structuredClone(read.document);
    const run = runsOf(doc)[0] as NodeJSON;
    const attrs = run.attrs as Record<string, unknown>;
    attrs.watermark = {
      kind: "text",
      text: "DRAFT & <b>",
      font: "Arial",
      color: "FF0000",
      width: 9360,
      height: 5616,
    };
    const out = await exportDocx(doc, read.package);
    const header = (await readPackage(out)).text("/word/header1.xml");
    expect(header).toContain('string="DRAFT &#38; &#60;b&#62;"');
    expect(header).toContain('fillcolor="#ff0000"');
    expect(header).not.toContain("rotation:");
    const again = runsOf((await importDocx(out)).document)[0];
    expect(again?.attrs?.watermark).toEqual(attrs.watermark);
  });

  it("keeps a shape it cannot read opaque, and writes VML namespaces a part lacks", () => {
    const other = CONFIDENTIAL.replace("PowerPlusWaterMarkObject357476642", "MyShape");
    const pict = parseXml(`<x ${NS}>${other}</x>`).root.children.find((c) => c.kind === "element");
    expect(
      readWatermark(pict as never, { relationship: () => undefined, partOf: () => undefined }),
    ).toBeUndefined();
    const plain = { declarations: `xmlns:w="${W_NS}"`, prefixes: new Set(["w"]) };
    const xml = watermarkXml({ kind: "text", text: "X", width: 20, height: 20 }, plain, () => "");
    expect(xml).toMatch(
      /^<w:pict xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o=".*" xmlns:w10=".*">/,
    );
    expect(
      watermarkXml(
        { kind: "text", text: "X", width: 20, height: 20 },
        DEFAULT_NAMESPACES,
        () => "",
      ),
    ).toMatch(/^<w:pict>/);
  });

  it("writes and reads a picture watermark in a new package", async () => {
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const blank = createDocument();
    const watermark = {
      kind: "picture" as const,
      picture: "logo",
      washout: true,
      width: 4000,
      height: 2000,
    };
    const doc: FoliDocument = {
      ...blank,
      schemaVersion: 9,
      section: { ...blank.section, headers: { default: "h1" } },
      resources: { logo: { contentType: "image/png", data: png } },
      stories: {
        h1: {
          kind: "header",
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "opaqueInline", attrs: { xml: "<w:pict/>", run: true, watermark } },
                ],
              },
            ],
          },
        },
      },
    };
    const bytes = await exportDocx(doc);
    const read = (await importDocx(bytes)).document;
    const again = runsOf(read)[0]?.attrs?.watermark as Record<string, unknown>;
    expect(again).toMatchObject({ kind: "picture", washout: true, width: 4000, height: 2000 });
    expect(read.resources?.[String(again.picture)]?.contentType).toBe("image/png");
  });
});
