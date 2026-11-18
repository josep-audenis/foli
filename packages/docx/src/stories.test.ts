import { readdirSync, readFileSync } from "node:fs";
import { createDocument, type FoliDocument, type NodeJSON, parseDocument } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx, readPackage } from "./index.js";

/** Headers, footers and notes as stories (11.4, ADR-0007). */

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const names = readdirSync(CORPUS).filter((n) => n.endsWith(".docx"));
const bytes = (name: string) => new Uint8Array(readFileSync(new URL(name, CORPUS)));
const load = (name: string) => importDocx(bytes(name));

const textOf = (node: NodeJSON): string => node.text ?? (node.content ?? []).map(textOf).join("");
const paragraph = (text: string): NodeJSON => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const doc = (...content: NodeJSON[]): NodeJSON => ({ type: "doc", content });
/** The first section's default header. */
const headerId = (document: FoliDocument): string => {
  for (const block of document.content.content ?? []) {
    const section = block.attrs?.section as { headers?: { default?: string } } | undefined;
    if (section?.headers?.default) return section.headers.default;
  }
  throw new Error("no header");
};
const STORY_PART = /^\/word\/(header|footer)\d*\.xml$|^\/word\/(foot|end)notes\.xml$/;

/** The story parts of an exported package, by name, as text. */
async function storyParts(data: Uint8Array) {
  const pkg = await readPackage(data);
  return new Map(
    pkg.parts.filter((p) => STORY_PART.test(p.name)).map((p) => [p.name, pkg.text(p.name)]),
  );
}

describe("reading stories", () => {
  it("reads headers and footers by relationship id, as sections refer to them", async () => {
    const { document, package: pkg } = await load("08-newsletter.docx");
    const stories = document.stories ?? {};
    expect(stories[headerId(document)]?.kind).toBe("header");
    const relationships = pkg.relationships(pkg.mainDocument);
    for (const [id, story] of Object.entries(stories))
      if (story.kind === "header" || story.kind === "footer")
        expect(relationships.find((r) => r.id === id)?.type).toContain(story.kind);
    const texts = Object.values(stories).map((s) => textOf(s.content));
    expect(texts).toContain("Around the fleet");
  });

  it("reads notes with their types, and references as nodes", async () => {
    const { document, report } = await load("09-pump-test-memo.docx");
    const stories = document.stories ?? {};
    expect(stories["footnote:-1"]).toMatchObject({ kind: "footnote", noteType: "separator" });
    expect(stories["footnote:0"]?.noteType).toBe("continuationSeparator");
    expect(textOf((stories["footnote:1"] as { content: NodeJSON }).content)).toContain("P-14");
    expect(JSON.stringify(stories["footnote:1"]?.content)).toContain('"noteMark"');
    expect(stories["endnote:1"]?.kind).toBe("endnote");
    const references: unknown[] = [];
    const walk = (node: NodeJSON) => {
      if (node.type === "noteReference") references.push(node.attrs?.story);
      node.content?.forEach(walk);
    };
    walk(document.content);
    expect(references.sort()).toEqual(["endnote:1", "endnote:2", "footnote:1", "footnote:2"]);
    expect(report.opaque["w:footnoteReference"]).toBeUndefined();
  });

  it("keeps verbatim what a story may not hold", async () => {
    const { document, package: pkg } = await load("08-newsletter.docx");
    const id = headerId(document);
    const name = pkg.relationships(pkg.mainDocument).find((r) => r.id === id)?.partName as string;
    const source = pkg.text(name);
    const withBreak = source.replace(
      /<\/w:hdr>$/,
      '<w:p><w:commentRangeStart w:id="7"/><w:r><w:commentReference w:id="7"/></w:r>' +
        '<w:r><w:footnoteReference w:id="1"/></w:r></w:p>' +
        "<w:p><w:pPr><w:sectPr/></w:pPr></w:p></w:hdr>",
    );
    const changed = await pkg.write(new Map([[name, new TextEncoder().encode(withBreak)]]));
    const again = await importDocx(changed);
    const blocks = again.document.stories?.[id]?.content.content ?? [];
    expect(blocks.at(-1)?.type).toBe("opaqueBlock");
    expect(() => parseDocument(again.document)).not.toThrow();
  });
});

describe("writing stories", () => {
  it.each(names)("%s: unchanged stories keep their parts byte for byte", async (name) => {
    const { document, package: pkg } = await load(name);
    const out = await storyParts(await exportDocx(document, pkg));
    expect(out).toEqual(await storyParts(bytes(name)));
  });

  it("rewrites only the header that changed", async () => {
    const { document, package: pkg } = await load("08-newsletter.docx");
    const id = headerId(document);
    const stories = structuredClone(document.stories ?? {});
    (stories[id] as { content: NodeJSON }).content = doc(paragraph("A new header"));
    const data = await exportDocx({ ...document, stories }, pkg);
    const before = await storyParts(bytes("08-newsletter.docx"));
    const after = await storyParts(data);
    const name = pkg.relationships(pkg.mainDocument).find((r) => r.id === id)?.partName as string;
    for (const [part, text] of after) {
      if (part === name) expect(text).toContain("A new header");
      else expect(text).toBe(before.get(part));
    }
    const again = await importDocx(data);
    expect(textOf(again.document.stories?.[id]?.content as NodeJSON)).toBe("A new header");
  });

  it("changes, removes and adds notes, keeping the others' bytes", async () => {
    const { document, package: pkg } = await load("09-pump-test-memo.docx");
    const source = pkg.text("/word/footnotes.xml");
    const separator = /<w:footnote [^>]*w:id="-1".*?<\/w:footnote>/s.exec(source)?.[0] as string;
    const long = /<w:footnote [^>]*w:id="2".*?<\/w:footnote>/s.exec(source)?.[0] as string;
    const stories = structuredClone(document.stories ?? {});
    (stories["footnote:1"] as { content: NodeJSON }).content = doc(paragraph("Changed note"));
    delete stories["endnote:2"];
    stories["footnote:9"] = { kind: "footnote", content: doc(paragraph("Added note")) };
    const without = (node: NodeJSON): NodeJSON => ({
      ...node,
      ...(node.content
        ? {
            content: node.content.filter((n) => n.attrs?.story !== "endnote:2").map(without),
          }
        : {}),
    });
    // The added note needs a reference, or nothing would show it.
    const content = without(document.content);
    (content.content?.[0] as NodeJSON).content = [
      ...(content.content?.[0]?.content ?? []),
      { type: "noteReference", attrs: { story: "footnote:9" } },
    ];
    const out = await readPackage(await exportDocx({ ...document, stories, content }, pkg));
    const footnotes = out.text("/word/footnotes.xml");
    expect(footnotes).toContain(separator);
    expect(footnotes).toContain(long);
    expect(footnotes).toContain("Changed note");
    expect(footnotes).toContain('<w:footnote w:id="9">');
    expect(out.text("/word/endnotes.xml")).not.toContain('w:id="2"');
  });

  it("makes parts for stories in a new package and in an existing one", async () => {
    const blank = createDocument(
      doc({
        type: "paragraph",
        content: [
          { type: "text", text: "Body" },
          { type: "noteReference", attrs: { story: "footnote:1" } },
          { type: "noteReference", attrs: { story: "endnote:1" } },
        ],
      }),
    );
    const made: FoliDocument = {
      ...blank,
      section: { ...blank.section, headers: { default: "h1" }, footers: { default: "f1" } },
      stories: {
        h1: { kind: "header", content: doc(paragraph("Head")) },
        f1: { kind: "footer", content: doc(paragraph("Foot")) },
        "footnote:1": {
          kind: "footnote",
          content: doc({ type: "paragraph", content: [{ type: "noteMark" }] }),
        },
        "endnote:1": { kind: "endnote", content: doc(paragraph("End")) },
      },
    };
    const again = await importDocx(await exportDocx(made));
    const stories = again.document.stories ?? {};
    expect(textOf(stories.h1?.content as NodeJSON)).toBe("Head");
    expect(textOf(stories.f1?.content as NodeJSON)).toBe("Foot");
    expect(stories["footnote:-1"]?.noteType).toBe("separator");
    expect(JSON.stringify(stories["footnote:1"]?.content)).toContain("noteMark");
    expect(textOf(stories["endnote:1"]?.content as NodeJSON)).toBe("End");

    const { document, package: pkg } = await load("05-business-letter.docx");
    const added = await importDocx(
      await exportDocx(
        {
          ...document,
          section: { ...document.section, footers: { default: "newFooter" } },
          stories: {
            ...document.stories,
            newFooter: { kind: "footer", content: doc(paragraph("Added footer")) },
          },
        },
        pkg,
      ),
    );
    expect(textOf(added.document.stories?.newFooter?.content as NodeJSON)).toBe("Added footer");
    expect(added.document.section.footers?.default).toBe("newFooter");
  });

  it("keeps what Word needs when stories are left out", async () => {
    const { document, package: pkg } = await load("09-pump-test-memo.docx");
    const { "footnote:1": _used, "footnote:-1": _separator, ...stories } = document.stories ?? {};
    const out = await readPackage(await exportDocx({ ...document, stories }, pkg));
    const footnotes = out.text("/word/footnotes.xml");
    expect(footnotes).toContain('w:id="1"');
    expect(footnotes).toContain('w:id="-1"');
  });

  it("keeps notes referred to only from verbatim XML, however it writes the id", async () => {
    const { document, package: pkg } = await load("09-pump-test-memo.docx");
    for (const reference of [
      "<w:footnoteReference w:id='1'/>",
      '<w:footnoteReference w:id = "1"/>',
      '<w:footnoteReference w:id="01"/>',
    ]) {
      const { "footnote:1": _gone, ...stories } = document.stories ?? {};
      const strip = (node: NodeJSON): NodeJSON => ({
        ...node,
        ...(node.content
          ? {
              content: node.content.filter((n) => n.attrs?.story !== "footnote:1").map(strip),
            }
          : {}),
      });
      const content = strip(document.content);
      content.content?.push({
        type: "paragraph",
        content: [{ type: "opaqueInline", attrs: { xml: reference, run: true } }],
      });
      const out = await readPackage(await exportDocx({ ...document, stories, content }, pkg));
      expect(out.text("/word/footnotes.xml"), reference).toContain("P-14");
    }
  });

  it("accepts a reference to a note of a type the model does not hold", async () => {
    const { package: pkg } = await load("09-pump-test-memo.docx");
    const name = "/word/footnotes.xml";
    const source = pkg
      .text(name)
      .replace(/<w:footnote w:id="1">/, '<w:footnote w:type="custom" w:id="1">');
    expect(source).toContain('w:type="custom"');
    const changed = await pkg.write(new Map([[name, new TextEncoder().encode(source)]]));
    const { document, package: again } = await importDocx(changed);
    expect(document.stories?.["footnote:1"]).toBeUndefined();
    const out = await readPackage(await exportDocx(document, again));
    expect(out.text(name)).toContain('w:type="custom"');
  });

  it("refuses a note holding another note's start tag", async () => {
    const { document, package: pkg } = await load("09-pump-test-memo.docx");
    const stories = structuredClone(document.stories ?? {});
    stories["footnote:9"] = { ...(stories["footnote:1"] as NonNullable<(typeof stories)[string]>) };
    await expect(exportDocx({ ...document, stories }, pkg)).rejects.toThrow(/another note's/);
  });

  it("reads past a header relationship that points at no XML", async () => {
    const pkg = (await load("05-business-letter.docx")).package;
    const header = pkg.relationships(pkg.mainDocument).find((r) => r.type.endsWith("/header"));
    const name = header?.partName as string;
    const changed = await pkg.write(new Map([[name, new Uint8Array([0x89, 0x50, 0x4e, 0x47])]]));
    const { document } = await importDocx(changed);
    expect(document.stories?.[header?.id as string]).toBeUndefined();
  });

  it("refuses a reference without a note, and ids that would break the package", async () => {
    const { document, package: pkg } = await load("09-pump-test-memo.docx");
    const note = (extra: NodeJSON): FoliDocument => ({
      ...document,
      content: { ...document.content, content: [...(document.content.content ?? []), extra] },
    });
    await expect(
      exportDocx(
        note({
          type: "paragraph",
          content: [{ type: "noteReference", attrs: { story: "footnote:77" } }],
        }),
        pkg,
      ),
    ).rejects.toThrow(/has no note/);
    const styles = pkg.relationships(pkg.mainDocument).find((r) => r.type.endsWith("/styles"));
    const story = { kind: "header" as const, content: doc(paragraph("x")) };
    await expect(
      exportDocx({ ...document, stories: { [styles?.id as string]: story } }, pkg),
    ).rejects.toThrow(/another relationship/);
    await expect(
      exportDocx({ ...document, stories: { ...document.stories, 'a"b': story } }, pkg),
    ).rejects.toThrow(/Not a relationship id/);
    await expect(
      exportDocx(
        {
          ...document,
          stories: {
            ...document.stories,
            "footnote:x": { kind: "footnote", content: doc(paragraph("x")) },
          },
        },
        pkg,
      ),
    ).rejects.toThrow(/Not the id of a footnote/);
    await expect(
      exportDocx(
        {
          ...document,
          stories: {
            ...document.stories,
            "footnote:8": { kind: "footnote", ext: "<w:p>", content: doc(paragraph("x")) },
          },
        },
        pkg,
      ),
    ).rejects.toThrow(/must be a w:footnote/);
  });

  it("refuses a header part that cannot hold what is written", async () => {
    const { document, package: pkg } = await load("08-newsletter.docx");
    const id = headerId(document);
    const name = pkg.relationships(pkg.mainDocument).find((r) => r.id === id)?.partName as string;
    const foreign = pkg
      .text(name)
      .replace(/\bw:/g, "x:")
      .replace(/xmlns:w=/, "xmlns:x=");
    const changed = await readPackage(
      await pkg.write(new Map([[name, new TextEncoder().encode(foreign)]])),
    );
    const stories = structuredClone(document.stories ?? {});
    (stories[id] as { content: NodeJSON }).content = doc(paragraph("New"));
    await expect(exportDocx({ ...document, stories }, changed)).rejects.toThrow(/namespaces/);
  });

  it("keeps references in comments verbatim, so the import succeeds", async () => {
    const { package: pkg } = await load("02-services-agreement-redlined.docx");
    const name = "/word/comments.xml";
    const source = pkg
      .text(name)
      .replace(
        /<\/w:p><\/w:comment>/,
        '<w:r><w:footnoteReference w:id="1"/></w:r></w:p></w:comment>',
      );
    const again = await importDocx(
      await pkg.write(new Map([[name, new TextEncoder().encode(source)]])),
    );
    expect(JSON.stringify(again.document.comments)).toContain("footnoteReference w:id");
  });

  it("round-trips tables and tracked changes in stories", async () => {
    const { document, package: pkg } = await load("09-pump-test-memo.docx");
    const stories = structuredClone(document.stories ?? {});
    const header = Object.keys(stories).find((id) => stories[id]?.kind === "header") as string;
    const table: NodeJSON = {
      type: "table",
      attrs: { grid: [2000] },
      content: [
        {
          type: "tableRow",
          content: [{ type: "tableCell", content: [paragraph("Cell in a header")] }],
        },
      ],
    };
    (stories[header] as { content: NodeJSON }).content = doc(table, paragraph("After"));
    const insertion = { type: "insertion", attrs: { id: 901, author: "A" } };
    (stories["footnote:1"] as { content: NodeJSON }).content = doc({
      type: "paragraph",
      content: [{ type: "noteMark" }, { type: "text", text: " tracked", marks: [insertion] }],
    });
    const again = await importDocx(await exportDocx({ ...document, stories }, pkg));
    const read = again.document.stories ?? {};
    expect(read[header]?.content.content?.[0]?.type).toBe("table");
    expect(textOf(read[header]?.content as NodeJSON)).toContain("Cell in a header");
    expect(JSON.stringify(read["footnote:1"]?.content)).toContain('"insertion"');
  });

  it("refuses a section whose story is missing without the package", async () => {
    const blank = createDocument();
    await expect(
      exportDocx({ ...blank, section: { ...blank.section, headers: { default: "rId9" } } }),
    ).rejects.toThrow(/a header or footer/);
  });
});
