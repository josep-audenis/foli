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
    const out = await readPackage(await exportDocx({ ...document, stories }, pkg));
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

  it("refuses a section whose story is missing without the package", async () => {
    const blank = createDocument();
    await expect(
      exportDocx({ ...blank, section: { ...blank.section, headers: { default: "rId9" } } }),
    ).rejects.toThrow(/a header or footer/);
  });
});
