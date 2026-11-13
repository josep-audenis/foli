import { readdirSync, readFileSync } from "node:fs";
import { type FoliDocumentV3, type NodeJSON, parseDocumentV3 } from "@folijs/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx, readPackage } from "../index.js";
import { docx } from "../testing/package.js";
import { deflateEntry, writeZip } from "../zip.js";

const CORPUS = new URL("../../../../corpus/word/", import.meta.url);
const names = readdirSync(CORPUS).filter((n) => n.endsWith(".docx"));
const load = (name: string) => importDocx(new Uint8Array(readFileSync(new URL(name, CORPUS))));
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const source = (bytes: Uint8Array) => readPackage(bytes).then((p) => p.text("/word/document.xml"));
const paragraphs = (d: FoliDocumentV3) =>
  (d.content.content ?? []).filter((b) => b.type === "paragraph");

describe("a new package", () => {
  it("refuses a document that refers to parts of its original package", async () => {
    for (const name of names) {
      const { document } = await load(name);
      await expect(exportDocx(document), name).rejects.toMatchObject({
        name: "DocxError",
        message: expect.stringMatching(/refers to a part of its original package/),
      });
    }
  });

  it("holds imported content that does not: Word's namespaces are declared", async () => {
    const { document } = await load("05-business-letter.docx");
    const own = structuredClone(document);
    delete own.section.headers;
    delete own.section.footers;
    for (const p of paragraphs(own)) {
      const section = p.attrs?.section as { headers?: unknown; footers?: unknown } | undefined;
      if (section) {
        delete section.headers;
        delete section.footers;
      }
    }
    const again = await importDocx(await exportDocx(own));
    expect(paragraphs(again.document).map((p) => p.attrs?.attributes)).toEqual(
      paragraphs(own).map((p) => p.attrs?.attributes),
    );
  });
});

describe("characters", () => {
  const doc = (text: string) =>
    parseDocumentV3({
      schemaVersion: 3,
      section: {},
      defaults: {},
      styles: [],
      numbering: { abstracts: [], instances: [] },
      comments: [],
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
    });

  it("refuses characters XML cannot hold", async () => {
    for (const bad of ["a\u0001b", "￾", "x\uD800", "\uDC00y"]) {
      await expect(exportDocx(doc(bad)), JSON.stringify(bad)).rejects.toMatchObject({
        name: "DocxError",
        message: expect.stringMatching(/cannot be written to a \.docx/),
      });
    }
  });

  it("writes line ends and vertical tabs in text as breaks", async () => {
    const again = await importDocx(await exportDocx(doc("a\nb\u000Bc\r\nd")));
    expect(paragraphs(again.document)[0]?.content?.map((n) => n.text ?? n.type)).toEqual([
      "a",
      "hardBreak",
      "b",
      "hardBreak",
      "c",
      "hardBreak",
      "d",
    ]);
  });
});

describe("recorded formatting changes in rewritten properties", () => {
  const change = '<w:rPrChange w:id="5" w:author="A"><w:rPr/></w:rPrChange>';

  it("keeps a paragraph mark's", async () => {
    const { document, package: pkg } = await importDocx(
      await docx(`<w:p><w:pPr><w:rPr><w:b/>${change}</w:rPr></w:pPr><w:r><w:t>a</w:t></w:r></w:p>`),
    );
    const edited = structuredClone(document);
    const p = paragraphs(edited)[0] as NodeJSON;
    p.attrs = { ...p.attrs, justification: "center" };
    expect(await source(await exportDocx(edited, pkg))).toContain(
      `<w:pPr><w:jc w:val="center"/><w:rPr><w:b/>${change}</w:rPr></w:pPr>`,
    );
  });

  it("keeps a style's, rewritten for another property", async () => {
    const STYLES = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles";
    const pChange = '<w:pPrChange w:id="6" w:author="A"><w:pPr/></w:pPrChange>';
    const { document, package: pkg } = await importDocx(
      await docx("<w:p/>", {
        rels: `<Relationship Id="s" Type="${STYLES}" Target="styles.xml"/>`,
        parts: {
          "word/styles.xml": `<w:styles xmlns:w="${W_NS}"><w:style w:type="paragraph" w:styleId="S"><w:name w:val="s"/><w:pPr><w:jc w:val="left"/>${pChange}</w:pPr><w:rPr><w:b/>${change}</w:rPr></w:style></w:styles>`,
        },
      }),
    );
    const edited = structuredClone(document);
    const style = edited.styles[0] as unknown as {
      name?: string;
      paragraph?: Record<string, unknown>;
    };
    style.name = "renamed";
    style.paragraph = { justification: "center" };
    const out = (await readPackage(await exportDocx(edited, pkg))).text("/word/styles.xml");
    expect(out).toContain('<w:name w:val="renamed"/>');
    expect(out).toContain(`<w:pPr><w:jc w:val="center"/>${pChange}</w:pPr>`);
    expect(out).toContain(`<w:rPr><w:b/>${change}</w:rPr>`);
  });
});

describe("comment threads", () => {
  const thread = (doc: FoliDocumentV3): FoliDocumentV3 => {
    const edited = structuredClone(doc);
    const content = [{ type: "paragraph", content: [{ type: "text", text: "Note" }] }];
    edited.comments = [
      { id: 10, author: "A", content },
      { id: 11, author: "B", content, parent: 10, done: true },
    ];
    return edited;
  };
  const states = (d: FoliDocumentV3) => d.comments.map((c) => [c.id, c.parent, c.done]);

  it("keeps replies and resolved state of comments made in the editor", async () => {
    const { document, package: pkg } = await load("05-business-letter.docx");
    const again = await importDocx(await exportDocx(thread(document), pkg));
    expect(states(again.document)).toEqual([
      // Word writes `w15:done` for every comment in a thread: not resolved reads as false.
      [10, undefined, false],
      [11, 10, true],
    ]);
  });

  it("and in a new package", async () => {
    const fresh = parseDocumentV3({
      schemaVersion: 3,
      section: {},
      defaults: {},
      styles: [],
      numbering: { abstracts: [], instances: [] },
      comments: [],
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    const again = await importDocx(await exportDocx(thread(fresh)));
    expect(states(again.document)).toEqual([
      // Word writes `w15:done` for every comment in a thread: not resolved reads as false.
      [10, undefined, false],
      [11, 10, true],
    ]);
  });
});

describe("verbatim content must fit the part", () => {
  const plain = (content: NodeJSON[]) =>
    parseDocumentV3({
      schemaVersion: 3,
      section: {},
      defaults: {},
      styles: [],
      numbering: { abstracts: [], instances: [] },
      comments: [],
      content: { type: "doc", content },
    });
  const cases: [NodeJSON[], RegExp][] = [
    [[{ type: "opaqueBlock", attrs: { xml: "<w:p>" } }], /does not fit the part/],
    [[{ type: "opaqueBlock", attrs: { xml: "<w:p/><w:p/>" } }], /exactly one element/],
    [[{ type: "paragraph", attrs: { ext: "<w:rPr/>" } }], /must be a w:pPr, not w:rPr/],
    [
      [
        {
          type: "paragraph",
          content: [
            { type: "bookmarkStart", attrs: { id: 1, name: "b", attributes: { "w:id": "2" } } },
          ],
        },
      ],
      /w:id is written from the model/,
    ],
    [
      [{ type: "paragraph", attrs: { attributes: { "foo:bar": "1" } } }],
      /prefix foo is not declared/,
    ],
  ];
  for (const [content, message] of cases) {
    it(`refuses ${JSON.stringify(content).slice(0, 80)}`, async () => {
      await expect(exportDocx(plain(content))).rejects.toMatchObject({
        name: "DocxError",
        message: expect.stringMatching(message),
      });
    });
  }

  it("accepts a bag that declares its own prefix", async () => {
    const doc = plain([
      { type: "paragraph", attrs: { attributes: { "xmlns:foo": "urn:foo", "foo:bar": "1" } } },
    ]);
    const again = await importDocx(await exportDocx(doc));
    expect(paragraphs(again.document)[0]?.attrs?.attributes).toEqual({
      "xmlns:foo": "urn:foo",
      "foo:bar": "1",
    });
  });
});

describe("packages Word did not write", () => {
  it("writes a UTF-16 part back as UTF-8, declared so", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-16"?><w:document xmlns:w="${W_NS}"><w:body><w:p><w:r><w:t>ü</w:t></w:r></w:p></w:body></w:document>`;
    const utf16 = new Uint8Array([
      0xff,
      0xfe,
      ...[...xml].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8]),
    ]);
    const files: [string, Uint8Array][] = [
      [
        "[Content_Types].xml",
        new TextEncoder().encode(
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
        ),
      ],
      [
        "_rels/.rels",
        new TextEncoder().encode(
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
        ),
      ],
      ["word/document.xml", utf16],
    ];
    const entries = [];
    for (const [name, data] of files) entries.push(await deflateEntry(name, data));
    const { document, package: pkg } = await importDocx(writeZip(entries));
    const edited = structuredClone(document);
    (paragraphs(edited)[0]?.content?.[0] as NodeJSON).text = "ü edited";
    const bytes = await exportDocx(edited, pkg);
    const out = await readPackage(bytes);
    expect(out.text("/word/document.xml")).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(paragraphs((await importDocx(bytes)).document)[0]?.content?.[0]?.text).toBe("ü edited");
  });

  it("puts new numbering definitions before w:numIdMacAtCleanup", async () => {
    const NUMBERING =
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering";
    const { document, package: pkg } = await importDocx(
      await docx("<w:p/>", {
        rels: `<Relationship Id="n" Type="${NUMBERING}" Target="numbering.xml"/>`,
        parts: {
          "word/numbering.xml": `<w:numbering xmlns:w="${W_NS}"><w:numIdMacAtCleanup w:val="0"/></w:numbering>`,
        },
      }),
    );
    const edited = structuredClone(document);
    edited.numbering = {
      abstracts: [{ id: 0, levels: [{ level: 0, format: "decimal" }] }],
      instances: [{ id: 1, abstract: 0 }],
    };
    const out = (await readPackage(await exportDocx(edited, pkg))).text("/word/numbering.xml");
    expect(out.indexOf("<w:abstractNum ")).toBeLessThan(out.indexOf("<w:num "));
    expect(out.indexOf("<w:num ")).toBeLessThan(out.indexOf("<w:numIdMacAtCleanup"));
  });

  it("relates a numbering part that is there without a relationship, once", async () => {
    const { document, package: pkg } = await importDocx(
      await docx("<w:p/>", {
        parts: { "word/numbering.xml": `<w:numbering xmlns:w="${W_NS}"/>` },
      }),
    );
    const edited = structuredClone(document);
    edited.numbering = {
      abstracts: [{ id: 0, levels: [{ level: 0 }] }],
      instances: [{ id: 1, abstract: 0 }],
    };
    const out = await readPackage(await exportDocx(edited, pkg));
    expect(
      out.relationships("/word/document.xml").filter((r) => r.partName === "/word/numbering.xml"),
    ).toHaveLength(1);
    expect(out.text("/word/numbering.xml")).toContain('<w:num w:numId="1">');
  });

  it("keeps a hyperlink's reference when the package has no relationship for it", async () => {
    const { document, package: pkg } = await importDocx(
      await docx(
        '<w:p><w:hyperlink r:id="rId9" w:tooltip="t"><w:r><w:t>x</w:t></w:r></w:hyperlink></w:p>',
      ),
    );
    expect(await source(await exportDocx(document, pkg))).toContain(
      '<w:hyperlink r:id="rId9" w:tooltip="t">',
    );
  });

  it("writes no body section where the document had none", async () => {
    const { document, package: pkg } = await importDocx(await docx("<w:p/>"));
    expect(await source(await exportDocx(document, pkg))).not.toContain("sectPr");
  });
});

describe("edits keep everything else", () => {
  it("leaves untouched paragraphs identical and the edited one's unknown properties", async () => {
    const imported = await Promise.all(names.map(async (n) => ({ n, ...(await load(n)) })));
    const edit = fc.record({
      doc: fc.nat(imported.length - 1),
      paragraph: fc.nat(200),
      change: fc.constantFrom("justify", "keepNext", "indent", "text", "bold"),
    });
    await fc.assert(
      fc.asyncProperty(edit, async ({ doc: d, paragraph: index, change }) => {
        const { document, package: pkg } = imported[d] as (typeof imported)[number];
        const edited = structuredClone(document);
        const list = paragraphs(edited);
        const p = list[index % list.length] as NodeJSON;
        const attrs = (p.attrs ?? {}) as Record<string, unknown>;
        if (change === "justify")
          p.attrs = {
            ...attrs,
            justification: attrs.justification === "center" ? "right" : "center",
          };
        if (change === "keepNext") p.attrs = { ...attrs, keepNext: !attrs.keepNext };
        if (change === "indent") p.attrs = { ...attrs, indent: { left: 1234 } };
        const text = (p.content ?? []).find((n) => n.type === "text");
        if (change === "text" && text) text.text = `${text.text} edited`;
        if (change === "bold" && text)
          text.marks = [
            ...(text.marks ?? []).filter((m) => m.type !== "bold"),
            { type: "bold", attrs: { value: false } },
          ];
        const again = await importDocx(await exportDocx(edited, pkg));
        const before = paragraphs(parseDocumentV3(edited));
        const after = paragraphs(again.document);
        expect(after.length).toBe(before.length);
        before.forEach((b, i) => {
          if (b === before[index % before.length]) return;
          expect(after[i], `paragraph ${i}`).toEqual(b);
        });
        // The edited paragraph: its properties' unknown children are all still there.
        const originalExt = String(
          document.content.content?.[0] &&
            (paragraphs(document)[index % list.length]?.attrs?.ext ?? ""),
        );
        const newExt = String(after[index % list.length]?.attrs?.ext ?? "");
        for (const local of originalExt.match(
          /<w:(?:suppressAutoHyphens|snapToGrid|bidi|textAlignment|kinsoku|wordWrap|autoSpaceDE|autoSpaceDN|adjustRightInd|mirrorIndents|divId|cnfStyle)\b[^>]*>/g,
        ) ?? []) {
          expect(newExt).toContain(local);
        }
      }),
      { numRuns: 40 },
    );
    // Forty export and import round trips of corpus documents: slow when everything runs at once.
  }, 120_000);
});
