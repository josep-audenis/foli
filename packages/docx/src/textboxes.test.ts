import { readFileSync } from "node:fs";
import { type FoliDocument, type NodeJSON, parseDocument } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx, readPackage } from "./index.js";
import { docx } from "./testing/package.js";

const corpus = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../../corpus/word/${name}`, import.meta.url)));

/** The `textBox` nodes of a document (body and stories), in order. */
function boxes(doc: FoliDocument): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const visit = (nodes: readonly NodeJSON[] | undefined) => {
    for (const node of nodes ?? []) {
      if (node.type === "textBox") out.push(node.attrs ?? {});
      visit(node.content);
    }
  };
  visit(doc.content.content);
  for (const story of Object.values(doc.stories ?? {})) visit(story.content.content);
  return out;
}

const textOf = (node: NodeJSON): string =>
  node.text ?? (node.content ?? []).map(textOf).join(node.type === "doc" ? "\n" : "");

const storyText = (doc: FoliDocument, id: string) => textOf(doc.stories?.[id]?.content as NodeJSON);

/** The document with `edit` made to text box story `id`'s first text node. */
function withStoryText(doc: FoliDocument, id: string, text: string): FoliDocument {
  const copy = structuredClone(doc);
  const story = copy.stories?.[id] as NonNullable<FoliDocument["stories"]>[string];
  const first = story.content.content?.[0] as NodeJSON;
  first.content = [{ type: "text", text }];
  return parseDocument(copy);
}

/** Every box's attributes but `ext`, `float` of a box found by story id replaced by `patch`. */
function patched(doc: FoliDocument, id: string, patch: Record<string, unknown>): FoliDocument {
  const copy = structuredClone(doc);
  const visit = (nodes: NodeJSON[] | undefined) => {
    for (const node of nodes ?? []) {
      if (node.type === "textBox" && node.attrs?.story === id)
        (node as { attrs: Record<string, unknown> }).attrs = { ...node.attrs, ...patch };
      visit(node.content as NodeJSON[] | undefined);
    }
  };
  visit(copy.content.content as NodeJSON[]);
  for (const story of Object.values(copy.stories ?? {})) visit(story.content.content as NodeJSON[]);
  return parseDocument(copy);
}

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const VML = `<w:pict><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"/><v:shape id="Text Box 2" o:spid="_x0000_s1026" type="#_x0000_t202" alt="Old box" style="position:absolute;margin-left:36pt;margin-top:12pt;width:144pt;height:1in;z-index:251659264;mso-position-horizontal-relative:margin;mso-position-vertical-relative:paragraph;v-text-anchor:middle" fillcolor="#ffc" strokecolor="navy" strokeweight="2pt"><v:textbox inset="0,0,0,0"><w:txbxContent><w:p><w:r><w:t>In VML</w:t></w:r></w:p></w:txbxContent></v:textbox><w10:wrap type="square"/></v:shape></w:pict>`;
const vmlDocx = () =>
  docx(`<w:p><w:r>${VML}</w:r><w:r><w:t>Body</w:t></w:r></w:p>`, {
    root: `<w:document xmlns:w="${W_NS}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w10="urn:schemas-microsoft-com:office:word"><w:body><w:p><w:r>${VML}</w:r><w:r><w:t>Body</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`,
  });

describe("text boxes (Phase 33)", () => {
  it("reads the corpus's text boxes as stories in floating anchors (11)", async () => {
    const { document, report } = await importDocx(corpus("11-text-box-flyer.docx"));
    expect(document.schemaVersion).toBe(10);
    const found = boxes(document);
    expect(found.map((b) => b.alt)).toEqual([
      "Programme box",
      "Pull quote",
      "Free entry badge",
      "Date box",
    ]);
    const [programme, quote, badge, date] = found as Record<string, Record<string, unknown>>[];
    expect(programme?.story).toBe("textbox:1");
    expect(storyText(document, "textbox:1")).toBe(
      "Programme\nWorkshops, talks and a lunch for every visitor.",
    );
    expect(programme?.float?.wrap).toBe("square");
    expect(programme?.fill).toBe("F2F2F2");
    expect(programme?.outline).toEqual({ color: "002060", width: 19050 });
    expect(quote?.float?.wrap).toBe("topAndBottom");
    expect(quote?.fill ?? null).toBeNull();
    expect(quote?.outline ?? null).toBeNull();
    expect(badge?.float?.horizontal).toEqual({ relativeTo: "page", offset: 5_080_000 });
    expect(badge?.float?.wrap).toBe("inFront");
    // The header's box: its id says whose it is.
    expect(String(date?.story)).toMatch(/^textbox:rId\d+\/1$/);
    expect(storyText(document, String(date?.story))).toBe("Saturday 14 March");
    expect(Object.values(document.stories ?? {}).filter((s) => s.kind === "textBox")).toHaveLength(
      4,
    );
    expect(report.opaque).toEqual({});
  });

  it("writes the corpus file back unchanged, text boxes included (11)", async () => {
    const bytes = corpus("11-text-box-flyer.docx");
    const { document, package: pkg } = await importDocx(bytes);
    const out = await readPackage(await exportDocx(document, pkg));
    const original = await readPackage(bytes);
    // The body is written from the model; each box as the file has it.
    const written = out.text("/word/document.xml");
    const read =
      original
        .text("/word/document.xml")
        .match(/<mc:AlternateContent>.*?<\/mc:AlternateContent>/gs) ?? [];
    expect(read.length).toBeGreaterThan(0);
    for (const box of read) expect(written).toContain(box);
    for (const part of original.parts)
      if (part.name !== "/word/document.xml")
        expect(out.part(part.name)?.data, part.name).toEqual(part.data);
  });

  it("writes a box's edited text into the DrawingML and its VML copy", async () => {
    const { document, package: pkg } = await importDocx(corpus("11-text-box-flyer.docx"));
    const edited = withStoryText(document, "textbox:1", "Timetable");
    const out = await exportDocx(edited, pkg);
    const xml = (await readPackage(out)).text("/word/document.xml");
    // Both copies say it; Word 2007's cached drawing of the old text is gone.
    expect(xml.match(/Timetable/g)).toHaveLength(2);
    expect(xml).not.toContain(">Programme<");
    const again = await importDocx(out);
    expect(storyText(again.document, "textbox:1")).toBe(
      "Timetable\nWorkshops, talks and a lunch for every visitor.",
    );
    expect(boxes(again.document)).toHaveLength(4);
  });

  it("rewrites a header holding an edited box, the other parts as they were", async () => {
    const bytes = corpus("11-text-box-flyer.docx");
    const { document, package: pkg } = await importDocx(bytes);
    const id = Object.keys(document.stories ?? {}).find((k) => /^textbox:rId/.test(k)) as string;
    const out = await exportDocx(withStoryText(document, id, "Sunday 15 March"), pkg);
    const again = await importDocx(out);
    expect(storyText(again.document, id)).toBe("Sunday 15 March");
    const original = await readPackage(bytes);
    const written = await readPackage(out);
    const box = original
      .text("/word/document.xml")
      .match(/<mc:AlternateContent>.*?<\/mc:AlternateContent>/s)?.[0];
    expect(written.text("/word/document.xml")).toContain(box);
    // Only the header holding the box is written again.
    const header = Object.entries(document.stories ?? {}).find(
      ([, s]) => s.kind === "header" && JSON.stringify(s).includes(id),
    )?.[0];
    expect(header).toBeDefined();
    for (const part of original.parts.filter((p) => /footer|header/.test(p.name))) {
      const same = written.part(part.name)?.data.join() === part.data.join();
      expect(same, part.name).toBe(!written.text(part.name).includes("Sunday"));
    }
  });

  it("writes a moved, resized and rewrapped box into its frame, without the stale copy", async () => {
    const { document, package: pkg } = await importDocx(corpus("11-text-box-flyer.docx"));
    const programme = boxes(document)[0] as Record<string, Record<string, unknown>>;
    const float = {
      ...programme.float,
      horizontal: { relativeTo: "margin", align: "right" },
      wrap: "tight",
    };
    const changed = patched(document, "textbox:1", {
      float,
      width: 1_800_000,
      fill: "FFFFFF",
      outline: null,
    });
    const out = await exportDocx(changed, pkg);
    const again = await importDocx(out);
    const box = boxes(again.document)[0] as Record<string, unknown>;
    expect(box.float).toEqual(float);
    expect(box.width).toBe(1_800_000);
    expect(box.fill).toBe("FFFFFF");
    expect(box.outline ?? null).toBeNull();
    const xml = (await readPackage(out)).text("/word/document.xml");
    // The box's own VML copy went with the change; the others keep theirs.
    expect(xml.match(/<mc:Fallback>/g)).toHaveLength(2);
    expect(xml).toContain('<wp:positionH relativeFrom="margin"><wp:align>right</wp:align>');
    expect(xml).toContain('<wp:wrapTight wrapText="bothSides">');
    expect(xml).toContain('<a:ext cx="1800000" cy="1397000"/>');
  });

  it("puts a floating box in line and back", async () => {
    const { document, package: pkg } = await importDocx(corpus("11-text-box-flyer.docx"));
    const inline = await importDocx(
      await exportDocx(patched(document, "textbox:2", { float: null }), pkg),
    );
    const box = boxes(inline.document)[1] as Record<string, unknown>;
    expect(box.float ?? null).toBeNull();
    expect(storyText(inline.document, "textbox:2")).toBe("Everyone is welcome: bring a friend.");
    const float = {
      horizontal: { relativeTo: "column", offset: 0 },
      vertical: { relativeTo: "paragraph", offset: 0 },
      wrap: "square",
      distance: { top: 0, bottom: 0, left: 0, right: 0 },
    };
    const back = await importDocx(
      await exportDocx(patched(inline.document, "textbox:2", { float }), inline.package),
    );
    expect((boxes(back.document)[1] as Record<string, unknown>).float).toEqual({
      ...float,
      side: "bothSides",
      allowOverlap: true,
      layoutInCell: true,
    });
  });

  it("reads a VML-only text box and writes its text back into it", async () => {
    const { document, package: pkg } = await importDocx(await vmlDocx());
    const [box] = boxes(document) as Record<string, unknown>[];
    expect(box).toMatchObject({
      story: "textbox:1",
      width: 1_828_800,
      height: 914_400,
      float: {
        horizontal: { relativeTo: "margin", offset: 457_200 },
        vertical: { relativeTo: "paragraph", offset: 152_400 },
        wrap: "square",
      },
      fill: "FFFFCC",
      outline: { color: "000080", width: 25_400 },
      inset: { left: 0, top: 0, right: 0, bottom: 0 },
      verticalAlign: "center",
      alt: "Old box",
    });
    const out = await exportDocx(withStoryText(document, "textbox:1", "Changed"), pkg);
    const xml = (await readPackage(out)).text("/word/document.xml");
    expect(xml).toContain('<v:textbox inset="0,0,0,0"><w:txbxContent>');
    expect(xml).toContain(">Changed<");
    // Resized: written as DrawingML.
    const resized = await exportDocx(patched(document, "textbox:1", { width: 914_400 }), pkg);
    const again = await importDocx(resized);
    expect((boxes(again.document)[0] as Record<string, unknown>).width).toBe(914_400);
    expect((await readPackage(resized)).text("/word/document.xml")).toContain("<wps:wsp");
  });

  it("keeps what Foli does not model opaque: a box in a note, a box in a box, a shape", async () => {
    const shape = (prst: string, inner = "<w:p><w:r><w:t>x</w:t></w:r></w:p>") =>
      `<w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="100" cy="100"/><wp:docPr id="1" name="s"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:spPr><a:prstGeom prst="${prst}"/></wps:spPr><wps:txbx><w:txbxContent>${inner}</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing>`;
    const { document, report } = await importDocx(
      await docx(
        `<w:p><w:r>${shape("ellipse")}</w:r><w:r>${shape("rect", `<w:p><w:r>${shape("rect")}</w:r></w:p>`)}</w:r></w:p>`,
      ),
    );
    const found = boxes(document);
    expect(found).toHaveLength(1);
    const inner = document.stories?.[String(found[0]?.story)]?.content.content?.[0];
    expect(inner?.content?.[0]?.type).toBe("opaqueInline");
    expect(Object.keys(report.opaque).length).toBeGreaterThan(0);
  });

  it("writes a new text box as DrawingML Word reads", async () => {
    const { document } = await importDocx(await docx("<w:p><w:r><w:t>Body</w:t></w:r></w:p>"));
    const copy = structuredClone(document) as FoliDocument & { schemaVersion: number };
    copy.schemaVersion = 10;
    copy.stories = {
      "textbox:1": {
        kind: "textBox",
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "New" }] }],
        },
      },
    };
    const first = (copy.content.content ?? [])[0] as NodeJSON & { content: NodeJSON[] };
    first.content.push({
      type: "textBox",
      attrs: {
        story: "textbox:1",
        width: 914_400,
        height: 457_200,
        fill: "FFFFFF",
        outline: { color: "000000", width: 6350 },
        float: {
          horizontal: { relativeTo: "column", offset: 0 },
          vertical: { relativeTo: "paragraph", offset: 0 },
          wrap: "square",
        },
      },
    });
    const out = await exportDocx(parseDocument(copy));
    const again = await importDocx(out);
    expect(storyText(again.document, "textbox:1")).toBe("New");
    expect(boxes(again.document)[0]).toMatchObject({
      width: 914_400,
      fill: "FFFFFF",
      outline: { color: "000000", width: 6350 },
    });
  });
});
