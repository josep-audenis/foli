import { readFileSync } from "node:fs";
import { createDocument, type FoliDocument, type NodeJSON, parseDocument } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx, readPackage } from "./index.js";

/** Inline (10.8) and floating (10.9) pictures in .docx, ADR-0006. */

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const bytesOf = (name: string) => new Uint8Array(readFileSync(new URL(name, CORPUS)));
/** A 1×1 PNG. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const pngBytes = Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0));

function pictures(document: FoliDocument): NodeJSON[] {
  const out: NodeJSON[] = [];
  const walk = (node: NodeJSON) => {
    if (node.type === "picture") out.push(node);
    for (const child of node.content ?? []) walk(child);
  };
  walk(document.content);
  return out;
}
const drawings = (xml: string) => xml.match(/<w:drawing>[\s\S]*?<\/w:drawing>/g) ?? [];
/** `document` with `change` applied to the attrs of its pictures (in order). */
function withPictures(
  document: FoliDocument,
  change: (attrs: Record<string, unknown>, i: number) => Record<string, unknown>,
): FoliDocument {
  let i = 0;
  const walk = (node: NodeJSON): NodeJSON =>
    node.type === "picture"
      ? { ...node, attrs: change({ ...(node.attrs ?? {}) }, i++) }
      : node.content
        ? { ...node, content: node.content.map(walk) }
        : node;
  return { ...document, content: walk(document.content) as FoliDocument["content"] };
}

describe("the picture report (07)", () => {
  it("has its inline pictures as picture nodes, their images as resources", async () => {
    const { document, report } = await importDocx(bytesOf("07-picture-report.docx"));
    const found = pictures(document).filter((p) => !p.attrs?.float);
    expect(found).toHaveLength(2);
    expect(found[0]?.attrs).toMatchObject({
      resource: "word/media/image1.png",
      width: 4572638,
      height: 2667372,
      alt: "Bar chart of monthly readings rising from 120 to 240",
    });
    expect(document.resources?.["word/media/image1.png"]).toMatchObject({
      contentType: "image/png",
      part: "word/media/image1.png",
    });
    // The second has no alt text: allowed, reported.
    expect(found[1]?.attrs?.alt).toBeUndefined();
    expect(report.picturesWithoutAlt).toBe(1);
    expect(report.opaque).toEqual({});
  });

  it("has its floating pictures as picture nodes with their position and wrapping", async () => {
    const { document } = await importDocx(bytesOf("07-picture-report.docx"));
    const floats = Object.fromEntries(
      pictures(document)
        .filter((p) => p.attrs?.float)
        .map((p) => [p.attrs?.alt, p.attrs?.float]),
    );
    const distance = { top: 0, bottom: 0, left: 114300, right: 114300 };
    const flags = { allowOverlap: true, layoutInCell: true };
    expect(floats).toEqual({
      "Northwind logo": {
        horizontal: { relativeTo: "column", offset: 3810000 },
        vertical: { relativeTo: "paragraph", offset: 0 },
        wrap: "square",
        side: "bothSides",
        distance,
        ...flags,
      },
      "Chart of readings, placed between paragraphs": {
        horizontal: { relativeTo: "column", offset: 0 },
        vertical: { relativeTo: "paragraph", offset: 254000 },
        wrap: "topAndBottom",
        distance,
        ...flags,
      },
      "Northwind logo as a watermark": {
        horizontal: { relativeTo: "column", offset: 1270000 },
        vertical: { relativeTo: "paragraph", offset: 127000 },
        wrap: "behind",
        distance,
        ...flags,
      },
    });
  });

  it("writes unchanged pictures back byte for byte", async () => {
    const bytes = bytesOf("07-picture-report.docx");
    const { document, package: pkg } = await importDocx(bytes);
    const before = pkg.text("/word/document.xml");
    const after = (await readPackage(await exportDocx(document, pkg))).text("/word/document.xml");
    expect(drawings(after)).toEqual(drawings(before));
  });

  it("writes a new size and alt text into the drawing, the rest as read", async () => {
    const { document, package: pkg } = await importDocx(bytesOf("07-picture-report.docx"));
    const changed = withPictures(document, (attrs, i) =>
      i === 0 ? { ...attrs, width: 2286319, height: 1333686, alt: "A smaller chart" } : attrs,
    );
    const out = await exportDocx(changed, pkg);
    const [first] = drawings((await readPackage(out)).text("/word/document.xml"));
    expect(first).toContain('<wp:extent cx="2286319" cy="1333686"/>');
    expect(first).toContain('<a:ext cx="2286319" cy="1333686"/>');
    expect(first?.match(/descr="A smaller chart"/g)).toHaveLength(2);
    expect(first).toContain('wp14:anchorId="5506A26C"');
    const again = pictures((await importDocx(out)).document)[0];
    expect(again?.attrs).toMatchObject({ width: 2286319, height: 1333686, alt: "A smaller chart" });
  });

  it("gives a picture moved into another package its image as a new media part", async () => {
    const source = await importDocx(bytesOf("07-picture-report.docx"));
    const target = await importDocx(bytesOf("06-price-schedule.docx"));
    const picture = pictures(source.document)[0] as NodeJSON;
    const content = target.document.content.content ?? [];
    const document = parseDocument({
      ...target.document,
      resources: {
        "word/media/image1.png": source.document.resources?.["word/media/image1.png"],
      },
      content: { type: "doc", content: [{ type: "paragraph", content: [picture] }, ...content] },
    });
    const image = source.package.part("/word/media/image1.png")?.data as Uint8Array;
    const asked: string[] = [];
    const out = await exportDocx(document, target.package, {
      resource: (key) => {
        asked.push(key);
        return image;
      },
    });
    expect(asked).toEqual(["word/media/image1.png"]);
    const pkg = await readPackage(out);
    const media = pkg.parts.filter((p) => p.name.startsWith("/word/media/"));
    expect(media.map((p) => p.name)).toEqual(["/word/media/foli-image1.png"]);
    expect(media[0]?.data).toEqual(image);
    const again = await importDocx(out);
    expect(pictures(again.document)[0]?.attrs).toMatchObject({
      resource: "word/media/foli-image1.png",
      alt: "Bar chart of monthly readings rising from 120 to 240",
    });
  });
});

describe("a new picture", () => {
  const withPicture = (resource: Record<string, unknown>) =>
    parseDocument({
      ...createDocument({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "A " },
              {
                type: "picture",
                attrs: { resource: "img", width: 914400, height: 457200, alt: "A dot" },
              },
            ],
          },
        ],
      }),
      resources: { img: resource },
    });

  it("is written as an inline drawing with its image from a data: URL", async () => {
    const out = await exportDocx(
      withPicture({ contentType: "image/png", data: `data:image/png;base64,${PNG}` }),
    );
    const pkg = await readPackage(out);
    expect(pkg.part("/word/media/foli-image1.png")?.data).toEqual(pngBytes);
    expect(pkg.part("/word/media/foli-image1.png")?.contentType).toBe("image/png");
    const [drawing] = drawings(pkg.text("/word/document.xml"));
    expect(drawing).toContain('<wp:extent cx="914400" cy="457200"/>');
    const again = await importDocx(out);
    expect(pictures(again.document)[0]?.attrs).toMatchObject({
      resource: "word/media/foli-image1.png",
      width: 914400,
      height: 457200,
      alt: "A dot",
    });
    expect(again.report.opaque).toEqual({});
  });

  it("asks the app for an image it only has a URL for, and fails without it", async () => {
    const document = withPicture({ contentType: "image/png", url: "https://example.com/dot.png" });
    await expect(exportDocx(document)).rejects.toMatchObject({
      name: "DocxError",
      message: expect.stringMatching(/No bytes for the picture img/),
    });
    const out = await exportDocx(document, undefined, { resource: async () => pngBytes });
    expect((await readPackage(out)).part("/word/media/foli-image1.png")?.data).toEqual(pngBytes);
  });
});

// ---- review findings ----------------------------------------------------------------------------

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture";

/** A drawing as Word writes one, with `docPr`, `cNvPr` and `spPr` given. */
const drawingOf = (docPr: string, cNvPr: string, spPr: string, blip = "") =>
  `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="100" cy="50"/><wp:docPr ${docPr}/><a:graphic xmlns:a="${A_NS}"><a:graphicData uri="${PIC_NS}"><pic:pic xmlns:pic="${PIC_NS}"><pic:nvPicPr><pic:cNvPr ${cNvPr}/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId9">${blip}</a:blip></pic:blipFill><pic:spPr>${spPr}</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;

/** A package with `drawings` in a paragraph each and `image` at `/word/media/image1.png`. */
async function packageWith(
  drawings: string[],
  options: { target?: string; image?: Uint8Array } = {},
): Promise<Uint8Array> {
  const { deflateEntry, writeZip } = await import("./zip.js");
  const body = drawings.map((d) => `<w:p><w:r>${d}</w:r></w:p>`).join("");
  const files: [string, string | Uint8Array][] = [
    [
      "[Content_Types].xml",
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    ],
    [
      "_rels/.rels",
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ],
    [
      "word/document.xml",
      `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:wp="${WP_NS}" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"><w:body>${body}<w:p/></w:body></w:document>`,
    ],
    [
      "word/_rels/document.xml.rels",
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${options.target ?? "media/image1.png"}"/></Relationships>`,
    ],
    ["word/media/image1.png", options.image ?? pngBytes],
  ];
  const entries = [];
  for (const [name, data] of files)
    entries.push(
      await deflateEntry(name, typeof data === "string" ? new TextEncoder().encode(data) : data),
    );
  return writeZip(entries);
}

describe("pictures written back as read", () => {
  it("keeps values the file holds twice as they are, and an absolute image target", async () => {
    const written = [
      // cNvPr without the description; its own title.
      drawingOf('id="1" name="a" descr="Dot"', 'id="1" name="a" title="Own"', ""),
      // An empty description.
      drawingOf('id="2" name="b" descr=""', 'id="2" name="b" descr=""', ""),
      // The picture's own size differs from the extent.
      drawingOf('id="3" name="c"', 'id="3" name="c"', '<a:xfrm><a:ext cx="99" cy="49"/></a:xfrm>'),
      // No transform, an extension list: nothing to write a size into.
      drawingOf('id="4" name="d"', 'id="4" name="d"', '<a:extLst><a:ext uri="{X}"/></a:extLst>'),
    ];
    const bytes = await packageWith(written, { target: "/word/media/image1.png" });
    const { document, package: pkg } = await importDocx(bytes);
    expect(pictures(document)).toHaveLength(4);
    expect(pictures(document)[1]?.attrs?.alt).toBe("");
    const out = await readPackage(await exportDocx(document, pkg));
    expect(drawings(out.text("/word/document.xml"))).toEqual(
      drawings(pkg.text("/word/document.xml")),
    );
    // No duplicate relationship for the absolute target.
    expect(out.text("/word/_rels/document.xml.rels")).toBe(
      pkg.text("/word/_rels/document.xml.rels"),
    );
  });

  it("gives a copied picture its own ids, above every drawing's in the document", async () => {
    const { document, package: pkg } = await importDocx(bytesOf("07-picture-report.docx"));
    const first = pictures(document)[0] as NodeJSON;
    const copy = {
      ...document,
      content: {
        ...document.content,
        content: [{ type: "paragraph", content: [first] }, ...(document.content.content ?? [])],
      },
    } as FoliDocument;
    const xml = (await readPackage(await exportDocx(copy, pkg))).text("/word/document.xml");
    const ids = [...xml.matchAll(/<wp:docPr\b[^>]*?\bid="(\d+)"/g)].map((m) => Number(m[1]));
    expect(new Set(ids).size).toBe(ids.length);
    // The copy (written first) keeps its ids; the second one is new, above the anchored ones.
    const anchored = [673736481, 1577375862, 1971169500];
    expect(ids).toContain(1632391068);
    expect(Math.max(...ids)).toBeGreaterThan(Math.max(1632391068, ...anchored));
    expect(xml.match(/wp14:anchorId="5506A26C"/g)).toHaveLength(1);
  });
});

describe("pictures moved between packages", () => {
  it("never take a target package's image of the same name", async () => {
    const source = await importDocx(bytesOf("07-picture-report.docx"));
    const target = await importDocx(await packageWith([], { image: new Uint8Array([1, 2, 3]) }));
    const picture = pictures(source.document)[0] as NodeJSON;
    const image = source.package.part("/word/media/image1.png")?.data as Uint8Array;
    const document = parseDocument({
      ...target.document,
      resources: { "word/media/image1.png": source.document.resources?.["word/media/image1.png"] },
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [picture] }, { type: "paragraph" }],
      },
    });
    const asked: string[] = [];
    const out = await readPackage(
      await exportDocx(document, target.package, {
        resource: (key) => {
          asked.push(key);
          return image;
        },
      }),
    );
    expect(asked).toEqual(["word/media/image1.png"]);
    expect(out.part("/word/media/foli-image1.png")?.data).toEqual(image);
    expect(out.part("/word/media/image1.png")?.data).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("write a drawing that refers to other relationships fresh", async () => {
    const linked = drawingOf(
      'id="1" name="a" descr="Dot"',
      'id="1" name="a"',
      "",
      '<a:extLst><a:ext uri="{X}"><x:thing xmlns:x="urn:x" r:embed="rId1"/></a:ext></a:extLst>',
    );
    const source = await importDocx(await packageWith([linked]));
    const target = await importDocx(bytesOf("06-price-schedule.docx"));
    const picture = pictures(source.document)[0] as NodeJSON;
    const document = parseDocument({
      ...target.document,
      resources: source.document.resources,
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [picture] },
          ...(target.document.content.content ?? []),
        ],
      },
    });
    const xml = (
      await readPackage(await exportDocx(document, target.package, { resource: () => pngBytes }))
    ).text("/word/document.xml");
    const [drawing] = drawings(xml);
    expect(drawing).not.toContain("urn:x");
    expect(drawing).toContain('descr="Dot"');
  });
});

describe("data: URLs", () => {
  const withData = (data: string) =>
    parseDocument({
      ...createDocument({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "picture", attrs: { resource: "img", width: 10, height: 10, alt: "x" } },
            ],
          },
        ],
      }),
      resources: { img: { contentType: "image/svg+xml", data } },
    });

  it("are read percent-encoded too, and refused when they cannot be read", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const out = await readPackage(
      await exportDocx(withData(`data:image/svg+xml,${encodeURIComponent(svg)}`)),
    );
    expect(new TextDecoder().decode(out.part("/word/media/foli-image1.svg")?.data)).toBe(svg);
    await expect(exportDocx(withData("data:image/svg+xml;base64,a"))).rejects.toMatchObject({
      name: "DocxError",
      message: expect.stringMatching(/cannot be read/),
    });
  });
});

describe("tracked pictures", () => {
  it("are written inside w:ins and w:del and read back as tracked", async () => {
    const tracked = (type: "insertion" | "deletion", alt: string): NodeJSON => ({
      type: "picture",
      attrs: { resource: "img", width: 914400, height: 457200, alt },
      marks: [{ type, attrs: { id: type === "insertion" ? 1 : 2, author: "Me" } }],
    });
    const document = parseDocument({
      ...createDocument({
        type: "doc",
        content: [
          { type: "paragraph", content: [tracked("insertion", "In"), tracked("deletion", "Out")] },
        ],
      }),
      resources: { img: { contentType: "image/png", data: `data:image/png;base64,${PNG}` } },
    });
    const out = await exportDocx(document);
    const xml = (await readPackage(out)).text("/word/document.xml");
    expect(xml).toMatch(/<w:ins [^>]*><w:r>(<w:rPr\/>)?<w:drawing>/);
    expect(xml).toMatch(/<w:del [^>]*><w:r>(<w:rPr\/>)?<w:drawing>/);
    const again = pictures((await importDocx(out)).document);
    expect(again.map((n) => n.marks?.[0]?.type)).toEqual(["insertion", "deletion"]);
    expect(again.map((n) => n.attrs?.alt)).toEqual(["In", "Out"]);
  });
});

describe("floating pictures", () => {
  it("read an alignment instead of an offset (board report)", async () => {
    const { document } = await importDocx(bytesOf("04-board-report.docx"));
    expect(pictures(document)[0]?.attrs?.float).toMatchObject({
      horizontal: { relativeTo: "margin", align: "right" },
      vertical: { relativeTo: "paragraph", offset: 3810 },
      wrap: "square",
    });
  });

  it("are written back byte for byte when unchanged, as wp:anchor", async () => {
    const bytes = bytesOf("07-picture-report.docx");
    const { document, package: pkg } = await importDocx(bytes);
    const after = (await readPackage(await exportDocx(document, pkg))).text("/word/document.xml");
    const anchored = drawings(after).filter((d) => d.includes("<wp:anchor"));
    expect(anchored).toHaveLength(3);
    expect(anchored).toEqual(
      drawings(pkg.text("/word/document.xml")).filter((d) => d.includes("<wp:anchor")),
    );
  });

  it("are written fresh with a changed position or wrapping, and read back so", async () => {
    const { document, package: pkg } = await importDocx(bytesOf("07-picture-report.docx"));
    const moved = {
      horizontal: { relativeTo: "page", align: "center" },
      vertical: { relativeTo: "margin", offset: -12700 },
      wrap: "inFront",
      distance: { top: 0, bottom: 0, left: 0, right: 0 },
      allowOverlap: false,
      layoutInCell: true,
    };
    const changed = withPictures(document, (attrs) =>
      attrs.alt === "Northwind logo" ? { ...attrs, float: moved } : attrs,
    );
    const out = await exportDocx(changed, pkg);
    const again = pictures((await importDocx(out)).document);
    expect(again.find((p) => p.attrs?.alt === "Northwind logo")?.attrs?.float).toEqual(moved);
    // The others as read; an inline picture made floating, and a floating one inline, too.
    expect(again.filter((p) => p.attrs?.float)).toHaveLength(3);
    const swapped = withPictures(document, (attrs, i) =>
      i === 0
        ? { ...attrs, float: moved }
        : attrs.alt === "Northwind logo"
          ? { ...attrs, float: null }
          : attrs,
    );
    const back = pictures((await importDocx(await exportDocx(swapped, pkg))).document);
    expect(back[0]?.attrs?.float).toEqual(moved);
    expect(back.find((p) => p.attrs?.alt === "Northwind logo")?.attrs?.float).toBeUndefined();
  });

  it("are written new as wp:anchor, values Word cannot read replaced", async () => {
    const float = (horizontal: unknown, wrap: string) =>
      parseDocument({
        ...createDocument({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "picture",
                  attrs: {
                    resource: "img",
                    width: 914400,
                    height: 457200,
                    alt: "A dot",
                    float: { horizontal, vertical: { relativeTo: "paragraph" }, wrap },
                  },
                },
              ],
            },
          ],
        }),
        resources: { img: { contentType: "image/png", data: `data:image/png;base64,${PNG}` } },
      });
    const read = async (document: FoliDocument) => {
      const out = await exportDocx(document);
      const xml = (await readPackage(out)).text("/word/document.xml");
      const { document: again, report } = await importDocx(out);
      expect(report.opaque).toEqual({});
      return { xml, float: pictures(again)[0]?.attrs?.float };
    };
    const tight = await read(float({ relativeTo: "nowhere", align: "middle" }, "tight"));
    expect(tight.xml).toContain("<wp:wrapPolygon");
    expect(tight.float).toMatchObject({
      horizontal: { relativeTo: "column", offset: 0 },
      vertical: { relativeTo: "paragraph", offset: 0 },
      wrap: "tight",
      side: "bothSides",
    });
    const behind = await read(float({ relativeTo: "margin", align: "right" }, "behind"));
    expect(behind.xml).toContain('behindDoc="1"');
    expect(behind.float).toMatchObject({
      horizontal: { relativeTo: "margin", align: "right" },
      wrap: "behind",
    });
  });
});

describe("floating pictures the model cannot hold", () => {
  const anchorOf = (attrs: string, inside: string) =>
    `<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1" ${attrs}>${inside}<wp:extent cx="100" cy="50"/><wp:docPr id="7" name="P"/><a:graphic xmlns:a="${A_NS}"><a:graphicData uri="${PIC_NS}"><pic:pic xmlns:pic="${PIC_NS}"><pic:nvPicPr><pic:cNvPr id="7" name="P"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing>`;
  const at = (h: string, v = "<wp:posOffset>0</wp:posOffset>") =>
    `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column">${h}</wp:positionH><wp:positionV relativeFrom="paragraph">${v}</wp:positionV>`;
  const square = '<wp:wrapSquare wrapText="bothSides"/>';
  const offset = "<wp:posOffset>0</wp:posOffset>";

  it("stay opaque and are written back as read", async () => {
    const cases = [
      anchorOf("", at(offset) + square).replace('simplePos="0"', 'simplePos="1"'),
      anchorOf("", at(offset)),
      anchorOf("", at("<wp:posOffset>1.5</wp:posOffset>") + square),
      anchorOf("", at("<wp:align/>") + square),
      anchorOf('hidden="1"', at(offset) + square),
      anchorOf("", `${at(offset)}${square}`).replace(
        "</a:graphic>",
        '</a:graphic><wp14:sizeRelH relativeFrom="page"><wp14:pctWidth>50000</wp14:pctWidth></wp14:sizeRelH>',
      ),
    ];
    // The control: one the model holds.
    const control = await importDocx(await packageWith([anchorOf("", at(offset) + square)]));
    expect(pictures(control.document)[0]?.attrs?.float).toMatchObject({ wrap: "square" });
    for (const drawing of cases) {
      const { document, report, package: pkg } = await importDocx(await packageWith([drawing]));
      expect(pictures(document)).toEqual([]);
      expect(report.opaque["w:drawing"]).toBe(1);
      const out = (await readPackage(await exportDocx(document, pkg))).text("/word/document.xml");
      expect(drawings(out)).toEqual([drawing]);
    }
  });
});

describe("rotation and crop (19.5)", () => {
  const crop = { left: 10000, top: 5000, right: 12500, bottom: 2500 };

  it("are written into a drawing read from the file, and taken off again", async () => {
    const { document, package: pkg } = await importDocx(bytesOf("07-picture-report.docx"));
    const turned = withPictures(document, (attrs, i) =>
      i === 0 ? { ...attrs, rotation: 5_400_000, crop } : attrs,
    );
    // JSON edited by hand says the schema it needs (the editor's `getDocument` does it itself).
    const out = await exportDocx({ ...turned, schemaVersion: 6 }, pkg);
    const [first] = drawings((await readPackage(out)).text("/word/document.xml"));
    expect(first).toMatch(/<a:xfrm[^>]* rot="5400000"/);
    expect(first).toContain('<a:srcRect l="10000" t="5000" r="12500" b="2500"/>');
    // What else the file held stays.
    expect(first).toContain('wp14:anchorId="5506A26C"');
    const again = (await importDocx(out)).document;
    expect(again.schemaVersion).toBe(6);
    expect(pictures(again)[0]?.attrs).toMatchObject({ rotation: 5_400_000, crop });
    // Left out (as 1.0 to 1.3 kept them, in `ext` only): the file's stay.
    const older = withPictures(again, ({ rotation: _r, crop: _c, ...attrs }) => attrs);
    const [kept] = drawings(
      (
        await readPackage(
          await exportDocx({ ...older, schemaVersion: 5 }, (await importDocx(out)).package),
        )
      ).text("/word/document.xml"),
    );
    expect(kept).toMatch(/<a:xfrm[^>]* rot="5400000"/);
    expect(kept).toContain('<a:srcRect l="10000" t="5000" r="12500" b="2500"/>');
    // Back to none, said so (0, no sides): the attribute and the element go.
    const plain = withPictures(again, (attrs, i) =>
      i === 0 ? { ...attrs, rotation: 0, crop: {} } : attrs,
    );
    const [back] = drawings(
      (await readPackage(await exportDocx(plain, (await importDocx(out)).package))).text(
        "/word/document.xml",
      ),
    );
    expect(back).not.toContain("srcRect");
    expect(back).not.toMatch(/<a:xfrm[^>]* rot=/);
  });

  it("are written in a new drawing", async () => {
    const document = parseDocument({
      ...createDocument({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "picture",
                attrs: {
                  resource: "img",
                  width: 914400,
                  height: 457200,
                  alt: "A dot",
                  rotation: 10_800_000,
                  crop: { left: 25000 },
                },
              },
            ],
          },
        ],
      }),
      resources: { img: { contentType: "image/png", data: `data:image/png;base64,${PNG}` } },
    });
    const out = await exportDocx(document);
    const [drawing] = drawings((await readPackage(out)).text("/word/document.xml"));
    expect(drawing).toContain('<a:srcRect l="25000"/>');
    expect(pictures((await importDocx(out)).document)[0]?.attrs).toMatchObject({
      rotation: 10_800_000,
      crop: { left: 25000 },
    });
  });

  it("are refused in a document that says schema 5", () => {
    const v5 = {
      ...createDocument({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "picture",
                attrs: { resource: "img", width: 1, height: 1, rotation: 60000 },
              },
            ],
          },
        ],
      }),
      schemaVersion: 5,
    };
    expect(() => parseDocument(v5)).toThrow(/schema 6/);
  });
});
