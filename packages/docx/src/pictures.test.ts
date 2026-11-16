import { readFileSync } from "node:fs";
import { createDocument, type FoliDocument, type NodeJSON, parseDocument } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx, readPackage } from "./index.js";

/** Inline pictures in .docx (10.8, ADR-0006). */

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
    const found = pictures(document);
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
    // Anchored (floating) pictures stay opaque until 10.9.
    expect(report.opaque["wp:anchor"] ?? report.opaque["w:drawing"]).toBeGreaterThan(0);
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
