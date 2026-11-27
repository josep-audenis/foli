import { readFileSync } from "node:fs";
import { createDocument, type FoliDocument, type NodeJSON, parseDocument } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx, readPackage } from "./index.js";
import { docx } from "./testing/package.js";

const corpus = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../../corpus/word/${name}`, import.meta.url)));

type Attrs = Record<string, unknown>;

/** The `shape` nodes of a document (body, then stories), in order. */
function shapes(doc: FoliDocument): Attrs[] {
  const out: Attrs[] = [];
  const visit = (nodes: readonly NodeJSON[] | undefined) => {
    for (const node of nodes ?? []) {
      if (node.type === "shape") out.push({ geometry: "rect", ...node.attrs });
      visit(node.content);
    }
  };
  visit(doc.content.content);
  for (const story of Object.values(doc.stories ?? {})) visit(story.content.content);
  return out;
}

const byAlt = (doc: FoliDocument, alt: string) => {
  const found = shapes(doc).find((s) => s.alt === alt);
  if (!found) throw new Error(`no shape ${alt}`);
  return found;
};

/** The document with the shape whose alt text is `alt` patched. */
function patched(doc: FoliDocument, alt: string, patch: Attrs): FoliDocument {
  const copy = structuredClone(doc);
  const visit = (nodes: NodeJSON[] | undefined) => {
    for (const node of nodes ?? []) {
      if (node.type === "shape" && node.attrs?.alt === alt)
        (node as { attrs: Attrs }).attrs = { ...node.attrs, ...patch };
      visit(node.content as NodeJSON[] | undefined);
    }
  };
  visit(copy.content.content as NodeJSON[]);
  return parseDocument(copy);
}

/** A shape's look: what the model says it is drawn with (no `ext`, no story id). */
const look = ({ ext: _e, story: _s, ...rest }: Attrs) => rest;

const textOf = (node: NodeJSON): string =>
  node.text ?? (node.content ?? []).map(textOf).join(node.type === "doc" ? "\n" : "");

describe("shapes (Phase 34)", () => {
  it("reads the corpus's shapes with their geometry and look (12)", async () => {
    const { document, report } = await importDocx(corpus("12-shapes-poster.docx"));
    expect(document.schemaVersion).toBe(11);
    expect(report.opaque).toEqual({});
    const found = shapes(document);
    expect(found).toHaveLength(43);
    expect(found.filter((s) => String(s.alt).startsWith("Preset ")).map((s) => s.geometry)).toEqual(
      expect.arrayContaining([
        "rect",
        "roundRect",
        "ellipse",
        "triangle",
        "rtTriangle",
        "parallelogram",
        "trapezoid",
        "diamond",
        "pentagon",
        "hexagon",
        "octagon",
        "plus",
        "can",
        "cube",
        "donut",
        "plaque",
        "rightArrow",
        "leftArrow",
        "upArrow",
        "downArrow",
        "leftRightArrow",
        "quadArrow",
        "homePlate",
        "chevron",
        "star5",
        "star4",
        "heart",
        "lightningBolt",
        "wedgeRectCallout",
        "wedgeRoundRectCallout",
        "wedgeEllipseCallout",
        "foldedCorner",
      ]),
    );
    // The theme's style (fillRef, lnRef) resolved: Word's accent 1 and its shade.
    const rect = byAlt(document, "Preset 1");
    expect(rect.fill).toBe("156082");
    expect(rect.outline).toEqual({ color: "030E13", width: 12700 });
    expect(rect.float).toMatchObject({ wrap: "inFront", horizontal: { relativeTo: "page" } });
    expect(byAlt(document, "Rounded rectangle, adjusted").adjust).toEqual({ adj: 35000 });
    expect(byAlt(document, "Right triangle flipped")).toMatchObject({ flipH: true, flipV: true });
    const gradient = byAlt(document, "Gradient rectangle").gradient as Attrs;
    expect((gradient.stops as Attrs[]).length).toBeGreaterThanOrEqual(2);
    const dashed = byAlt(document, "Dashed oval, no fill");
    expect(dashed.fill ?? null).toBeNull();
    expect(dashed.outline).toEqual({ color: "FF0000", width: 25400, dash: "dash" });
    expect(byAlt(document, "Line with an arrow")).toMatchObject({
      geometry: "line",
      outline: { tail: { type: "triangle" } },
    });
    const both = byAlt(document, "Line with two ends").outline as Attrs;
    expect(both.head).toBeTruthy();
    expect(both.tail).toBeTruthy();
    expect(both.dash).toBe("dot");
    const free = byAlt(document, "Freeform");
    expect(free.geometry).toBe("custom");
    const custom = free.custom as { guides: Attrs[]; paths: { commands: Attrs[] }[] };
    expect(custom.guides.length).toBeGreaterThan(0);
    expect(custom.paths[0]?.commands.map((c) => c.op)).toContain("C");
    // Text in a shape: a story of kind textBox, drawn in the style's font color.
    const text = byAlt(document, "Rounded rectangle with text");
    expect(text.textColor).toBe("FFFFFF");
    expect(text.verticalAlign).toBe("center");
    const story = document.stories?.[String(text.story)];
    expect(story?.kind).toBe("textBox");
    expect(textOf(story?.content as NodeJSON)).toBe("Open day");
    // The header's line, and the hexagon wrapped square beside the text.
    expect(byAlt(document, "Header rule").geometry).toBe("line");
    expect(byAlt(document, "Hexagon wrapped square").float).toMatchObject({ wrap: "square" });
  });

  it("writes the corpus file back unchanged, shapes included (12)", async () => {
    const bytes = corpus("12-shapes-poster.docx");
    const { document, package: pkg } = await importDocx(bytes);
    const out = await readPackage(await exportDocx(document, pkg));
    const original = await readPackage(bytes);
    const written = out.text("/word/document.xml");
    const read =
      original
        .text("/word/document.xml")
        .match(/<mc:AlternateContent>.*?<\/mc:AlternateContent>/gs) ?? [];
    expect(read.length).toBe(42);
    for (const shape of read) expect(written).toContain(shape);
    for (const part of original.parts)
      if (part.name !== "/word/document.xml")
        expect(out.part(part.name)?.data, part.name).toEqual(part.data);
  });

  it("writes what the model changed into the shape, the rest kept", async () => {
    const { document, package: pkg } = await importDocx(corpus("12-shapes-poster.docx"));
    const changes: [string, Attrs][] = [
      ["Preset 1", { rotation: 1_800_000, flipH: true, fill: "FFC000" }],
      ["Preset 5", { geometry: "ellipse", adjust: null }],
      ["Rounded rectangle, adjusted", { adjust: { adj: 10000 }, width: 1_500_000 }],
      [
        "Dashed oval, no fill",
        {
          outline: {
            color: "00B050",
            width: 38100,
            dash: "sysDot",
            head: { type: "oval" },
            tail: { type: "stealth", width: "lg", length: "sm" },
          },
        },
      ],
      [
        "Gradient rectangle",
        {
          // With a gradient, `fill` is its first stop (what a reader without gradients shows).
          fill: "FF0000",
          gradient: {
            stops: [
              { position: 0, color: "FF0000" },
              { position: 100_000, color: "0000FF" },
            ],
            angle: 2_700_000,
          },
        },
      ],
      ["Preset 9", { fill: null, outline: null }],
      ["Rounded rectangle with text", { textColor: "FFC000", fill: "002060" }],
      [
        "Freeform",
        {
          custom: {
            paths: [
              {
                width: 100,
                height: 100,
                commands: [
                  { op: "M", args: ["0", "0"] },
                  { op: "L", args: ["100", "0"] },
                  { op: "A", args: ["50", "50", "0", "10800000"] },
                  { op: "Z" },
                ],
              },
            ],
          },
        },
      ],
    ];
    let edited = document;
    for (const [alt, patch] of changes) edited = patched(edited, alt, patch);
    const out = await exportDocx(edited, pkg);
    const again = (await importDocx(out)).document;
    for (const [alt] of changes)
      expect(look(byAlt(again, alt)), alt).toEqual(look(byAlt(edited, alt)));
    // An unchanged shape is written as it was, its VML copy too; a changed one without it.
    const xml = (await readPackage(out)).text("/word/document.xml");
    const original = (await readPackage(corpus("12-shapes-poster.docx"))).text(
      "/word/document.xml",
    );
    const block = (alt: string, source: string) =>
      source.match(
        new RegExp(
          `<mc:AlternateContent>(?:(?!</mc:AlternateContent>).)*?descr="${alt}".*?</mc:AlternateContent>`,
          "s",
        ),
      )?.[0];
    expect(xml).toContain(block("Preset 2", original));
    expect(block("Preset 1", xml) ?? "").not.toContain("mc:Fallback");
    expect(xml).toContain('rot="1800000"');
  });

  it("writes a new shape, with text, as DrawingML Word reads", async () => {
    const doc = createDocument({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "shape",
              attrs: {
                geometry: "rightArrow",
                adjust: { adj1: 40000, adj2: 60000 },
                width: 1_828_800,
                height: 914_400,
                float: {
                  horizontal: { relativeTo: "column", offset: 0 },
                  vertical: { relativeTo: "paragraph", offset: 0 },
                  wrap: "square",
                  side: "bothSides",
                  distance: { top: 0, bottom: 0, left: 114_300, right: 114_300 },
                  allowOverlap: true,
                  layoutInCell: true,
                },
                rotation: 5_400_000,
                fill: "4472C4",
                outline: { color: "2F528F", width: 12700, dash: "dash" },
                story: "textbox:1",
                verticalAlign: "center",
                textColor: "FFFFFF",
              },
            },
            { type: "text", text: "Beside" },
          ],
        },
      ],
    });
    doc.stories = {
      "textbox:1": {
        kind: "textBox",
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Go" }] }],
        },
      },
    };
    const parsed = parseDocument({ ...doc, schemaVersion: 11 });
    const { document } = await importDocx(await exportDocx(parsed));
    const [shape] = shapes(document);
    expect(look(shape as Attrs)).toEqual(look(shapes(parsed)[0] as Attrs));
    expect(textOf(document.stories?.[String(shape?.story)]?.content as NodeJSON)).toBe("Go");
  });

  it("keeps a group and a picture-filled shape opaque, and refuses a shape in a note", async () => {
    const wps = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape";
    const drawing = (data: string) =>
      `<w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="x"/>` +
      `<a:graphic><a:graphicData uri="${data.includes("wpg:") ? "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" : wps}">${data}</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    const filled = drawing(
      `<wps:wsp><wps:cNvSpPr/><wps:spPr><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:blipFill><a:blip r:embed="rId9"/></a:blipFill></wps:spPr><wps:bodyPr/></wps:wsp>`,
    );
    const group = drawing(
      `<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr/><wps:wsp><wps:cNvSpPr/><wps:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr><wps:bodyPr/></wps:wsp></wpg:wgp>`,
    );
    const plain = drawing(
      `<wps:wsp><wps:cNvSpPr/><wps:spPr><a:prstGeom prst="star5"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFC000"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:custDash><a:ds d="300000" sp="100000"/></a:custDash></a:ln></wps:spPr><wps:bodyPr/></wps:wsp>`,
    );
    const ns =
      `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
      `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
      `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wps="${wps}" ` +
      `xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
    const body = `<w:p>${filled}${group}${plain}</w:p>`;
    const { document, package: pkg } = await importDocx(
      await docx(body, {
        root: `<w:document ${ns}><w:body>${body}<w:sectPr/></w:body></w:document>`,
      }),
    );
    const types = (document.content.content?.[0]?.content ?? []).map((n) => n.type);
    expect(types).toEqual(["opaqueInline", "opaqueInline", "shape"]);
    expect(shapes(document)[0]).toMatchObject({
      geometry: "star5",
      fill: "FFC000",
      outline: { color: "000000", width: 12_700, dash: "custom" },
    });
    // A custom dash is written back while it stays; made solid, it goes.
    const kept = (await readPackage(await exportDocx(document, pkg))).text("/word/document.xml");
    expect(kept).toContain("<a:custDash>");
    const solid = structuredClone(document);
    const node = (solid.content.content?.[0]?.content ?? []).find((n) => n.type === "shape") as {
      attrs: Attrs;
    };
    node.attrs = { ...node.attrs, outline: { color: "000000", width: 12_700 } };
    const written = (await readPackage(await exportDocx(parseDocument(solid), pkg))).text(
      "/word/document.xml",
    );
    expect(written).not.toContain("custDash");
    expect(written).toContain('<a:prstDash val="solid"/>');
    const note = structuredClone(document);
    note.stories = {
      "footnote:9": {
        kind: "footnote",
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "shape", attrs: { width: 1, height: 1 } }],
            },
          ],
        },
      },
    };
    expect(() => parseDocument(note)).toThrow(/a footnote cannot hold a shape/);
  });
});
