/**
 * Parts whose namespace prefixes are not the usual ones, and other edges of an unedited round trip.
 */
import type { FoliDocument } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx, readPackage } from "./index.js";
import { docx } from "./testing/package.js";
import { parseXml, type XmlElement } from "./xml.js";
import { inflateEntry, readZip } from "./zip.js";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const BODY = `<w:p><w:r><w:t>Hi</w:t></w:r></w:p>`;

/** The document with its first text node made a link (what the editor's link command leaves). */
function linked(document: FoliDocument): FoliDocument {
  const doc = structuredClone(document) as unknown as {
    content: { content: { content: { marks?: unknown[] }[] }[] };
  };
  const text = doc.content.content[0]?.content[0] as { marks?: unknown[] };
  text.marks = [{ type: "link", attrs: { href: "https://example.com/" } }];
  return doc as unknown as FoliDocument;
}

const firstText = (d: FoliDocument) => d.content.content?.[0]?.content?.[0]?.text;

describe("export writes w:/r: prefixes the part never declared (ill-formed document.xml)", () => {
  for (const [name, root] of [
    [
      "another prefix for WordprocessingML",
      `<x:document xmlns:x="${W_NS}"><x:body><x:p><x:r><x:t>Hi</x:t></x:r></x:p></x:body></x:document>`,
    ],
    [
      "WordprocessingML as the default namespace",
      `<document xmlns="${W_NS}"><body><p><r><t>Hi</t></r></p></body></document>`,
    ],
  ] as const) {
    it(`${name}: an unedited export is well-formed and reads back the same`, async () => {
      const first = await importDocx(await docx("", { root }));
      expect(firstText(first.document)).toBe("Hi");
      const out = await readPackage(await exportDocx(first.document, first.package));
      expect(() => parseXml(out.text("/word/document.xml"))).not.toThrow();
      expect(firstText((await importDocx(await out.write())).document)).toBe("Hi");
    });
  }

  it("a link added to a document whose root does not declare xmlns:r is well-formed", async () => {
    const root = `<w:document xmlns:w="${W_NS}"><w:body>${BODY}</w:body></w:document>`;
    const first = await importDocx(await docx("", { root }));
    const out = await readPackage(await exportDocx(linked(first.document), first.package));
    expect(() => parseXml(out.text("/word/document.xml"))).not.toThrow();
  });
});

describe("package parts written by text splicing ignore the part's own prefix", () => {
  it("a new hyperlink's relationship reaches a relationships part with a prefixed root", async () => {
    const first = await importDocx(
      await docx(BODY, {
        parts: {
          "word/_rels/document.xml.rels": `<rel:Relationships xmlns:rel="${REL_NS}"><rel:Relationship Id="rId1" Type="http://example.com/other" Target="foo.xml"/></rel:Relationships>`,
        },
      }),
    );
    const out = await readPackage(await exportDocx(linked(first.document), first.package));
    const id = /<w:hyperlink r:id="([^"]+)"/.exec(out.text("/word/document.xml"))?.[1];
    expect(id).toBeDefined();
    expect(out.relationships("/word/document.xml").find((r) => r.id === id)?.target).toBe(
      "https://example.com/",
    );
  });

  it("an added part's Override is in the content-types namespace when Types is prefixed", async () => {
    const first = await importDocx(
      await docx(BODY, {
        parts: {
          "[Content_Types].xml": `<?xml version="1.0"?><ct:Types xmlns:ct="${CT_NS}"><ct:Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><ct:Default Extension="xml" ContentType="application/xml"/><ct:Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></ct:Types>`,
        },
      }),
    );
    // Adds /word/settings.xml.
    const bytes = await exportDocx(first.document, first.package, { trackRevisions: true });
    const entry = readZip(bytes).find((e) => e.name === "[Content_Types].xml");
    const types = parseXml(new TextDecoder().decode(await inflateEntry(entry as never))).root;
    const override = types.children.find(
      (c): c is XmlElement =>
        c.kind === "element" &&
        c.local === "Override" &&
        c.attributes.some((a) => a.value === "/word/settings.xml"),
    );
    expect(override).toBeDefined();
    expect(override?.ns).toBe(CT_NS);
  });
});

describe("import", () => {
  it("keeps no-break spaces at the ends of a w:t without xml:space (not XML whitespace)", async () => {
    const { document } = await importDocx(
      await docx(`<w:p><w:r><w:t>\u00A0a\u00A0</w:t></w:r></w:p>`),
    );
    expect(firstText(document)).toBe("\u00A0a\u00A0");
  });
});

describe("unedited round trip", () => {
  it("keeps a comment's start tag whose date the model does not hold (date, unknown attributes)", async () => {
    const comment = `<w:comment w:id="1" w:author="A" w:date="2024-05-06T10:00:00+0200" w:foo="bar">`;
    const first = await importDocx(
      await docx(BODY, {
        rels: `<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>`,
        parts: {
          "word/comments.xml": `<w:comments xmlns:w="${W_NS}">${comment}<w:p><w:r><w:t>c</w:t></w:r></w:p></w:comment></w:comments>`,
        },
      }),
    );
    const out = await readPackage(await exportDocx(first.document, first.package));
    expect(out.text("/word/comments.xml")).toContain(comment);
  });

  it("exports content whose prefix is declared on its paragraph, not on the root", async () => {
    const first = await importDocx(
      await docx(`<w:p xmlns:foo="urn:foo"><foo:bar/><w:r><w:t>x</w:t></w:r></w:p>`),
    );
    const out = await readPackage(await exportDocx(first.document, first.package));
    expect(() => parseXml(out.text("/word/document.xml"))).not.toThrow();
    expect(out.text("/word/document.xml")).toContain("<foo:bar/>");
  });

  it("does not turn a line end inside a w:t into a line break", async () => {
    const first = await importDocx(
      await docx(`<w:p><w:r><w:t xml:space="preserve">a\nb</w:t></w:r></w:p>`),
    );
    const again = await importDocx(await exportDocx(first.document, first.package));
    expect(again.document.content).toEqual(first.document.content);
  });
});
