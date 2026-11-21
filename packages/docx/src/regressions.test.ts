/** Bugs found by review, each kept as the test that showed it. */
import type { FoliDocument } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx, readPackage } from "./index.js";
import { docx } from "./testing/package.js";
import { parseXml } from "./xml.js";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const BODY = `<w:p><w:r><w:t>Hi</w:t></w:r></w:p>`;
const rel = (type: string, target: string) =>
  `<Relationship Id="rId9" Type="${REL}/${type}" Target="${target}"/>`;

/** The package with `edit` made to its document, exported and read again. */
async function roundTrip(bytes: Uint8Array, edit: (doc: FoliDocument) => void = () => {}) {
  const first = await importDocx(bytes);
  const document = structuredClone(first.document);
  edit(document);
  const out = await readPackage(await exportDocx(document, first.package));
  return { out, again: (await importDocx(await out.write())).document };
}

type Texts = { content?: { content?: { text?: string }[] }[] };
const setText = (content: unknown, text: string) => {
  const node = (content as Texts).content?.[0]?.content?.[0] as { text?: string };
  node.text = text;
};
const textOf = (content: unknown) => (content as Texts).content?.[0]?.content?.[0]?.text;

describe("parts whose root binds WordprocessingML to a prefix other than w", () => {
  it("styles: an edited style is written well-formed", async () => {
    const { out, again } = await roundTrip(
      await docx(BODY, {
        rels: rel("styles", "styles.xml"),
        parts: {
          "word/styles.xml": `<x:styles xmlns:x="${W_NS}"><x:style x:type="paragraph" x:styleId="A"><x:name x:val="A"/></x:style></x:styles>`,
        },
      }),
      (doc) => {
        (doc.styles[0] as { name: string }).name = "B";
      },
    );
    expect(() => parseXml(out.text("/word/styles.xml"))).not.toThrow();
    expect(again.styles.map((s) => [s.id, s.name])).toEqual([["A", "B"]]);
  });

  it("numbering: an edited level is written well-formed", async () => {
    const { out, again } = await roundTrip(
      await docx(BODY, {
        rels: rel("numbering", "numbering.xml"),
        parts: {
          "word/numbering.xml": `<x:numbering xmlns:x="${W_NS}"><x:abstractNum x:abstractNumId="0"><x:lvl x:ilvl="0"><x:start x:val="1"/><x:numFmt x:val="decimal"/><x:lvlText x:val="%1."/></x:lvl></x:abstractNum><x:num x:numId="1"><x:abstractNumId x:val="0"/></x:num></x:numbering>`,
        },
      }),
      (doc) => {
        (doc.numbering.abstracts[0]?.levels[0] as { start: number }).start = 3;
      },
    );
    expect(() => parseXml(out.text("/word/numbering.xml"))).not.toThrow();
    expect(again.numbering.abstracts[0]?.levels[0]?.start).toBe(3);
    expect(again.numbering.instances).toHaveLength(1);
  });

  for (const [name, comments] of [
    [
      "another prefix",
      `<x:comments xmlns:x="${W_NS}"><x:comment x:id="1" x:author="A"><x:p><x:r><x:t>c</x:t></x:r></x:p></x:comment></x:comments>`,
    ],
    [
      "the default namespace",
      `<comments xmlns="${W_NS}" xmlns:a="${W_NS}"><comment a:id="1" a:author="A"><p><r><t>c</t></r></p></comment></comments>`,
    ],
  ] as const) {
    it(`comments (${name}): an unedited export is well-formed and reads back the same`, async () => {
      const { out, again } = await roundTrip(
        await docx(BODY, {
          rels: rel("comments", "comments.xml"),
          parts: { "word/comments.xml": comments },
        }),
      );
      expect(() => parseXml(out.text("/word/comments.xml"))).not.toThrow();
      expect(again.comments.map((c) => [c.id, c.author, textOf({ content: c.content })])).toEqual([
        [1, "A", "c"],
      ]);
    });
  }

  it("footnotes: an edited note is written well-formed", async () => {
    const { out, again } = await roundTrip(
      await docx(BODY, {
        rels: rel("footnotes", "footnotes.xml"),
        parts: {
          "word/footnotes.xml": `<x:footnotes xmlns:x="${W_NS}"><x:footnote x:id="1"><x:p><x:r><x:t>n</x:t></x:r></x:p></x:footnote></x:footnotes>`,
        },
      }),
      (doc) => setText(doc.stories?.["footnote:1"]?.content, "edited"),
    );
    expect(() => parseXml(out.text("/word/footnotes.xml"))).not.toThrow();
    expect(textOf(again.stories?.["footnote:1"]?.content)).toBe("edited");
  });

  it("a header: an edited one is written well-formed", async () => {
    const { out, again } = await roundTrip(
      await docx(BODY, {
        rels: rel("header", "header1.xml"),
        parts: {
          "word/header1.xml": `<x:hdr xmlns:x="${W_NS}"><x:p><x:r><x:t>h</x:t></x:r></x:p></x:hdr>`,
        },
      }),
      (doc) => setText(doc.stories?.rId9?.content, "edited"),
    );
    expect(() => parseXml(out.text("/word/header1.xml"))).not.toThrow();
    expect(textOf(again.stories?.rId9?.content)).toBe("edited");
  });
});

describe("a namespace declared on an element's start tag, not on the root, reaches its content", () => {
  const FOO = `xmlns:foo="urn:foo"`;
  const RUN = `<w:r><w:t>x</w:t></w:r>`;
  for (const [name, body] of [
    ["a hyperlink", `<w:hyperlink ${FOO} w:anchor="a"><foo:bar/>${RUN}</w:hyperlink>`],
    ["an insertion", `<w:ins ${FOO} w:id="1" w:author="A"><foo:bar/>${RUN}</w:ins>`],
    [
      "a deletion",
      `<w:del ${FOO} w:id="1" w:author="A"><foo:bar/><w:r><w:delText>x</w:delText></w:r></w:del>`,
    ],
    [
      "a hyperlink around a content control",
      `<w:hyperlink ${FOO} w:anchor="a"><w:sdt><w:sdtPr><w:text/></w:sdtPr><w:sdtContent><foo:bar/>${RUN}</w:sdtContent></w:sdt></w:hyperlink>`,
    ],
  ] as const) {
    it(`${name}: an unedited export keeps it`, async () => {
      const { out } = await roundTrip(await docx(`<w:p>${body}</w:p>`));
      expect(() => parseXml(out.text("/word/document.xml"))).not.toThrow();
      expect(out.text("/word/document.xml")).toContain("<foo:bar/>");
    });
  }

  const commented = (start: string) =>
    docx(BODY, {
      rels: rel("comments", "comments.xml"),
      parts: {
        "word/comments.xml": `<w:comments xmlns:w="${W_NS}">${start}<w:p><foo:bar/>${RUN}</w:p></w:comment></w:comments>`,
      },
    });

  it("a comment: an unedited export keeps it", async () => {
    const { out } = await roundTrip(await commented(`<w:comment ${FOO} w:id="1" w:author="A">`));
    expect(() => parseXml(out.text("/word/comments.xml"))).not.toThrow();
    expect(out.text("/word/comments.xml")).toContain("<foo:bar/>");
  });

  it("a comment whose start tag is written again (another author) still declares it", async () => {
    const { out } = await roundTrip(
      await commented(`<w:comment ${FOO} w:id="1" w:author="A">`),
      (doc) => {
        (doc.comments[0] as { author: string }).author = "B";
      },
    );
    expect(() => parseXml(out.text("/word/comments.xml"))).not.toThrow();
    expect(out.text("/word/comments.xml")).toContain("<foo:bar/>");
    expect(out.text("/word/comments.xml")).toContain('w:author="B"');
  });

  it("a note: an edited one keeps it", async () => {
    const { out, again } = await roundTrip(
      await docx(BODY, {
        rels: rel("footnotes", "footnotes.xml"),
        parts: {
          "word/footnotes.xml": `<w:footnotes xmlns:w="${W_NS}"><w:footnote ${FOO} w:id="1"><w:p>${RUN}<foo:bar/></w:p></w:footnote></w:footnotes>`,
        },
      }),
      (doc) => setText(doc.stories?.["footnote:1"]?.content, "edited"),
    );
    expect(() => parseXml(out.text("/word/footnotes.xml"))).not.toThrow();
    expect(out.text("/word/footnotes.xml")).toContain("<foo:bar/>");
    expect(textOf(again.stories?.["footnote:1"]?.content)).toBe("edited");
  });
});

describe("unedited round trip of tracked changes", () => {
  for (const name of ["ins", "del"]) {
    it(`keeps a w:${name}'s date the model does not hold (no time)`, async () => {
      const text = name === "del" ? "w:delText" : "w:t";
      const change = `<w:${name} w:id="1" w:author="A" w:date="2024-05-06"><w:r><${text}>x</${text}></w:r></w:${name}>`;
      const { out } = await roundTrip(await docx(`<w:p>${change}</w:p>`));
      expect(out.text("/word/document.xml")).toContain(change);
    });
  }
});
