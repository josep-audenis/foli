import { readdirSync, readFileSync } from "node:fs";
import {
  createDocument,
  type FoliDocumentV3,
  type MarkJSON,
  type NodeJSON,
  parseDocumentV3,
} from "@folijs/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx, readPackage } from "../index.js";
import { canonical } from "../testing/canonical.js";
import { docx } from "../testing/package.js";
import { readZip } from "../zip.js";

const CORPUS = new URL("../../../../corpus/word/", import.meta.url);
const names = readdirSync(CORPUS).filter((n) => n.endsWith(".docx"));
const load = (name: string) => importDocx(new Uint8Array(readFileSync(new URL(name, CORPUS))));
const OWNED = [
  "/word/document.xml",
  "/word/styles.xml",
  "/word/numbering.xml",
  "/word/comments.xml",
  "/word/commentsExtended.xml",
];

/** The document without what import keeps verbatim (ext, runExt, attribute bags): the model's values. */
function values(json: unknown): unknown {
  return JSON.parse(JSON.stringify(json), (key, value) => {
    if (key === "ext" || key === "attributes") return undefined;
    if (Array.isArray(value))
      return value.filter((m) => !(m && typeof m === "object" && m.type === "runExt"));
    return value;
  });
}

const paragraphs = (d: FoliDocumentV3) =>
  (d.content.content ?? []).filter((b) => b.type === "paragraph");

describe("exporting the corpus without edits", () => {
  for (const name of names) {
    it(`${name}: equals the original after canonicalization; other parts byte for byte`, async () => {
      const original = await load(name);
      const bytes = await exportDocx(original.document, original.package);
      const out = await readPackage(bytes);
      expect(out.parts.map((p) => p.name)).toEqual(original.package.parts.map((p) => p.name));
      for (const part of original.package.parts) {
        const exported = out.part(part.name)?.data as Uint8Array;
        if (OWNED.includes(part.name))
          expect(canonical(new TextDecoder().decode(exported)), part.name).toBe(
            canonical(original.package.text(part.name)),
          );
        else expect(exported, part.name).toEqual(part.data);
      }
      // Styles, numbering and comments untouched: the same bytes.
      for (const part of OWNED.slice(1)) {
        if (original.package.part(part))
          expect(out.text(part), part).toBe(original.package.text(part));
      }
      const again = await importDocx(bytes);
      expect(again.document).toEqual(original.document);
      // Unchanged properties and opaque content come back as written, byte for byte.
      const xml = out.text("/word/document.xml");
      const walk = (node: NodeJSON) => {
        const attrs = (node.attrs ?? {}) as Record<string, unknown>;
        if (typeof attrs.ext === "string") expect(xml).toContain(attrs.ext);
        if (typeof attrs.xml === "string") expect(xml).toContain(attrs.xml);
        for (const m of node.marks ?? [])
          if (m.type === "runExt") expect(xml).toContain(m.attrs?.xml as string);
        for (const c of node.content ?? []) walk(c);
      };
      walk(original.document.content);
      // Entries of parts that did not change keep their compressed bytes.
      const before = readZip(new Uint8Array(readFileSync(new URL(name, CORPUS))));
      const after = readZip(bytes);
      for (const entry of before) {
        if (entry.name === "word/document.xml") continue;
        expect(after.find((e) => e.name === entry.name)?.raw, entry.name).toEqual(entry.raw);
      }
    });
  }
});

describe("the canonical comparison", () => {
  const p = (inner: string) =>
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="urn:w14"><w:body><w:p>${inner}</w:p></w:body></w:document>`;
  it("allows what import does not keep exactly", () => {
    const a = p(
      '<w:r w:rsidR="1"><w:t>a</w:t></w:r><w:proofErr w:type="spellStart"/><w:r><w:t xml:space="preserve"> b</w:t><w:noBreakHyphen/><w:cr/></w:r><!-- x -->',
    );
    const b = p('<w:r><w:t xml:space="preserve">a </w:t></w:r><w:r><w:t>b‑</w:t><w:br/></w:r>');
    expect(canonical(a)).toBe(canonical(b));
    // Without `preserve`, Word drops the ends' whitespace: so does the comparison.
    expect(canonical(p("<w:r><w:t> a </w:t></w:r>"))).toBe(canonical(p("<w:r><w:t>a</w:t></w:r>")));
    const nested = p(
      '<w:hyperlink w:anchor="x"><w:ins w:id="1" w:author="A"><w:r><w:t>t</w:t></w:r></w:ins></w:hyperlink>',
    );
    const reversed = p(
      '<w:ins w:id="1" w:author="A"><w:hyperlink w:anchor="x"><w:r><w:t>t</w:t></w:r></w:hyperlink></w:ins>',
    );
    expect(canonical(nested)).toBe(canonical(reversed));
  });

  it("does not allow anything else", () => {
    const base = p(
      '<w:r><w:rPr><w:b/></w:rPr><w:t>ab</w:t></w:r><w:bookmarkStart w:id="0" w:name="n"/>',
    );
    // Whitespace Word keeps is text; deleted text is not inserted text.
    expect(canonical(p('<w:r><w:t xml:space="preserve"> a</w:t></w:r>'))).not.toBe(
      canonical(p("<w:r><w:t> a</w:t></w:r>")),
    );
    expect(
      canonical(p('<w:del w:id="1" w:author="A"><w:r><w:delText>a</w:delText></w:r></w:del>')),
    ).not.toBe(canonical(p('<w:del w:id="1" w:author="A"><w:r><w:t>a</w:t></w:r></w:del>')));
    for (const other of [
      p('<w:r><w:rPr><w:b/></w:rPr><w:t>ac</w:t></w:r><w:bookmarkStart w:id="0" w:name="n"/>'),
      p('<w:r><w:rPr><w:i/></w:rPr><w:t>ab</w:t></w:r><w:bookmarkStart w:id="0" w:name="n"/>'),
      p('<w:r><w:rPr><w:b/></w:rPr><w:t>ab</w:t></w:r><w:bookmarkStart w:id="0" w:name="m"/>'),
      p(
        '<w:r><w:rPr><w:b/></w:rPr><w:t>ab</w:t></w:r><w:bookmarkStart w:id="0" w:name="n" w14:x="1"/>',
      ),
      p(
        '<w:r><w:rPr><w:b/></w:rPr><w:t>a</w:t></w:r><w:r><w:t>b</w:t></w:r><w:bookmarkStart w:id="0" w:name="n"/>',
      ),
      p('<w:bookmarkStart w:id="0" w:name="n"/><w:r><w:rPr><w:b/></w:rPr><w:t>ab</w:t></w:r>'),
      p(
        '<w:r w:x="1"><w:rPr><w:b/></w:rPr><w:t>ab</w:t></w:r><w:bookmarkStart w:id="0" w:name="n"/>',
      ),
      p(
        '<w:ins w:id="1" w:author="A"><w:r><w:rPr><w:b/></w:rPr><w:t>ab</w:t></w:r></w:ins><w:bookmarkStart w:id="0" w:name="n"/>',
      ),
    ]) {
      expect(canonical(other)).not.toBe(canonical(base));
    }
  });
});

describe("exporting edited documents", () => {
  it("rewrites what changed, keeping the unknown parts of what it rewrites", async () => {
    const { document, package: pkg } = await load("05-business-letter.docx");
    const edited = structuredClone(document);
    const [first, second] = paragraphs(edited) as [NodeJSON, NodeJSON];
    // A paragraph property changed: its w:pPr is rewritten, its other children kept.
    first.attrs = { ...first.attrs, justification: "both", keepNext: true };
    // Text made italic: the run's w:rPr is rewritten around its unknown children.
    const run = (second.content ?? []).find((n) => n.type === "text") as NodeJSON;
    run.marks = [...(run.marks ?? []), { type: "italic" }];
    run.text = `${run.text} edited`;
    const bytes = await exportDocx(edited, pkg);
    const again = await importDocx(bytes);
    expect(values(again.document)).toEqual(values(parseDocumentV3(edited)));
    // The first paragraph's original pPr children the model does not own are still there.
    const before = String(first.attrs?.ext ?? "");
    const after = String(paragraphs(again.document)[0]?.attrs?.ext ?? "");
    expect(after).toContain('<w:jc w:val="both"/>');
    expect(after).toContain("<w:keepNext/>");
    for (const local of before.match(/<w:(?!jc|keepNext|pPr)[A-Za-z]+/g) ?? [])
      expect(after).toContain(local);
    // Untouched paragraphs come back verbatim.
    expect(paragraphs(again.document).slice(2)).toEqual(paragraphs(document).slice(2));
  });

  it("adds hyperlink relationships, numbering and comments a document did not have", async () => {
    const { document, package: pkg } = await load("05-business-letter.docx");
    const edited = structuredClone(document);
    const link = { type: "link", attrs: { href: "https://example.com/terms" } };
    edited.numbering = {
      abstracts: [{ id: 0, levels: [{ level: 0, start: 1, format: "decimal", text: "%1." }] }],
      instances: [{ id: 1, abstract: 0 }],
    };
    edited.comments = [
      {
        id: 0,
        author: "Reviewer",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Check" }] }],
      },
    ];
    (edited.content.content as NodeJSON[]).push({
      type: "paragraph",
      attrs: { numbering: { id: 1, level: 0 } },
      content: [
        { type: "commentStart", attrs: { id: 0 } },
        { type: "text", text: "See the terms", marks: [link] },
        { type: "commentEnd", attrs: { id: 0 } },
        { type: "commentReference", attrs: { id: 0 } },
      ],
    });
    const bytes = await exportDocx(edited, pkg);
    const out = await readPackage(bytes);
    expect(out.part("/word/numbering.xml")?.contentType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml",
    );
    expect(out.part("/word/comments.xml")?.contentType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml",
    );
    const rels = out.relationships(out.mainDocument);
    expect(rels.some((r) => r.external && r.target === "https://example.com/terms")).toBe(true);
    expect(
      rels.filter(
        (r) => r.partName === "/word/numbering.xml" || r.partName === "/word/comments.xml",
      ),
    ).toHaveLength(2);
    const again = await importDocx(bytes);
    expect(values(again.document)).toEqual(values(parseDocumentV3(edited)));
  });

  it("removes deleted styles and adds new ones, keeping latent styles", async () => {
    const { document, package: pkg } = await load("01-mutual-nda.docx");
    const edited = structuredClone(document);
    const removed = edited.styles.splice(
      edited.styles.findIndex((s) => s.id === "Title"),
      1,
    );
    expect(removed).toHaveLength(1);
    edited.styles.push({
      id: "Mine",
      type: "paragraph",
      name: "Mine",
      basedOn: "Normal",
      run: [{ type: "bold" }],
    });
    const heading = edited.styles.find((s) => s.id === "Heading1") as { run?: MarkJSON[] };
    heading.run = (heading.run ?? []).filter((m) => m.type !== "caps");
    const bytes = await exportDocx(edited, pkg);
    const out = await readPackage(bytes);
    const styles = out.text("/word/styles.xml");
    expect(styles).toContain("<w:latentStyles");
    expect(styles).not.toContain('w:styleId="Title"');
    const again = await importDocx(bytes);
    expect(values(again.document.styles)).toEqual(values(parseDocumentV3(edited).styles));
  });

  it("rewrites comment threads when a comment is resolved", async () => {
    const { document, package: pkg } = await load("02-services-agreement-redlined.docx");
    const edited = structuredClone(document);
    (edited.comments[0] as { done?: boolean }).done = true;
    const bytes = await exportDocx(edited, pkg);
    const again = await importDocx(bytes);
    expect(again.document.comments.map((c) => [c.id, c.parent, c.done])).toEqual([
      [1, undefined, true],
      [2, 1, false],
      [5, undefined, true],
      [6, 5, true],
    ]);
  });
});

describe("exporting what changed, and only that", () => {
  const HYPERLINK = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
  const source = (bytes: Uint8Array) =>
    readPackage(bytes).then((p) => p.text("/word/document.xml"));

  it("keeps an unchanged property's element as written inside a rewritten paragraph", async () => {
    const { document, package: pkg } = await importDocx(
      await docx(
        '<w:p><w:pPr><w:ind w:left="720" w:leftChars="100" x:keep="1"/><w:jc w:val="left"/><w:suppressAutoHyphens/></w:pPr><w:r><w:t>a</w:t></w:r></w:p>',
      ),
    );
    const edited = structuredClone(document);
    const p = edited.content.content?.[0] as NodeJSON;
    p.attrs = { ...p.attrs, justification: "center" };
    const xml = await source(await exportDocx(edited, pkg));
    expect(xml).toContain(
      '<w:pPr><w:suppressAutoHyphens/><w:ind w:left="720" w:leftChars="100" x:keep="1"/><w:jc w:val="center"/></w:pPr>',
    );
  });

  it("writes deleted text as w:delText, and changes around runs", async () => {
    const { document, package: pkg } = await load("02-services-agreement-redlined.docx");
    const xml = await source(await exportDocx(document, pkg));
    expect(xml).toMatch(
      /<w:del w:id="\d+" w:author="[^"]*"[^>]*><w:r>(<w:rPr>.*?<\/w:rPr>)?<w:delText/,
    );
    expect(xml).not.toMatch(/<w:del [^>]*>(?:(?!<\/w:del>).)*<w:t[ >]/);
  });

  it("writes tracked moves as moves", async () => {
    const { document, package: pkg } = await importDocx(
      await docx(
        '<w:p><w:moveFromRangeStart w:id="1" w:name="m"/><w:moveFrom w:id="2" w:author="A"><w:r><w:t>x</w:t></w:r></w:moveFrom><w:moveFromRangeEnd w:id="1"/></w:p>' +
          '<w:p><w:moveToRangeStart w:id="3" w:name="m"/><w:moveTo w:id="4" w:author="A"><w:r><w:t>x</w:t></w:r></w:moveTo><w:moveToRangeEnd w:id="3"/></w:p>',
      ),
    );
    const xml = await source(await exportDocx(document, pkg));
    expect(xml).toContain(
      '<w:moveFrom w:id="2" w:author="A"><w:r><w:delText>x</w:delText></w:r></w:moveFrom>',
    );
    expect(xml).toContain('<w:moveTo w:id="4" w:author="A"><w:r><w:t>x</w:t></w:r></w:moveTo>');
  });

  it("keeps a hyperlink's relationship while its target is unchanged, adds one when it changes", async () => {
    const { document, package: pkg } = await importDocx(
      await docx(
        '<w:p><w:hyperlink r:id="rId7" w:history="1"><w:r><w:t>site</w:t></w:r></w:hyperlink></w:p>',
        {
          rels: `<Relationship Id="rId7" Type="${HYPERLINK}" Target="https://example.com/" TargetMode="External"/>`,
        },
      ),
    );
    const same = await exportDocx(document, pkg);
    expect(await source(same)).toContain('<w:hyperlink r:id="rId7" w:history="1">');
    expect((await readPackage(same)).text("/word/_rels/document.xml.rels")).toBe(
      pkg.text("/word/_rels/document.xml.rels"),
    );
    const edited = structuredClone(document);
    const run = edited.content.content?.[0]?.content?.[0] as NodeJSON;
    run.marks = [
      {
        type: "link",
        attrs: { ...(run.marks?.[0]?.attrs ?? {}), href: "https://example.com/new" },
      },
    ];
    const out = await readPackage(await exportDocx(edited, pkg));
    const added = out
      .relationships("/word/document.xml")
      .find((r) => r.target === "https://example.com/new");
    expect(added?.external).toBe(true);
    expect(out.text("/word/document.xml")).toContain(
      `<w:hyperlink r:id="${added?.id}" w:history="1">`,
    );
  });

  it("leaves parts it does not change byte for byte, and replaces only what differs", async () => {
    const { document, package: pkg } = await load("04-board-report.docx");
    const out = await readPackage(await exportDocx(document, pkg));
    for (const part of pkg.parts) {
      if (part.name !== "/word/document.xml")
        expect(out.part(part.name)?.data, part.name).toEqual(part.data);
    }
  });
});

describe("exporting without a package", () => {
  it("makes a new package from a v2 document", async () => {
    const v2 = createDocument({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
        {
          type: "orderedList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "one",
                      marks: [{ type: "link", attrs: { href: "https://example.com" } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "a" }, { type: "hardBreak" }, { type: "pageBreak" }],
        },
      ],
    } as never);
    const document = parseDocumentV3(v2);
    const bytes = await exportDocx(document);
    const again = await importDocx(bytes);
    expect(again.report.opaque).toEqual({});
    // The page margins Word requires but the document leaves out come back as Word's defaults.
    expect(again.document.section.margins).toEqual({
      ...document.section.margins,
      header: 720,
      footer: 720,
      gutter: 0,
    });
    expect(values({ ...again.document, section: undefined })).toEqual(
      values({ ...document, section: undefined }),
    );
  });

  it("round-trips the model's values for any content", async () => {
    const markArb = fc.constantFrom<MarkJSON>(
      { type: "bold" },
      { type: "italic", attrs: { value: false } },
      { type: "underline", attrs: { style: "double" } },
      { type: "color", attrs: { value: "C00000" } },
      { type: "fontSize", attrs: { value: 28 } },
      { type: "link", attrs: { href: "https://example.com/a" } },
      { type: "insertion", attrs: { id: 7, author: "A", date: "2026-01-01T00:00:00Z" } },
      { type: "deletion", attrs: { id: 8, author: "B" } },
    );
    const inline = fc.oneof(
      fc
        .tuple(
          fc.string({
            // A tab is a `tab` node (a tab character in text is written as one: see README).
            unit: fc.constantFrom("a", " ", "&", "<", "é", "‑"),
            minLength: 1,
            maxLength: 4,
          }),
          fc.uniqueArray(markArb, { selector: (m) => m.type, maxLength: 3 }),
        )
        .map(([text, marks]) => ({ type: "text", text, ...(marks.length ? { marks } : {}) })),
      fc.constantFrom<NodeJSON>(
        { type: "tab" },
        { type: "hardBreak" },
        { type: "pageBreak" },
        { type: "bookmarkStart", attrs: { id: 1, name: "b" } },
      ),
    );
    const paragraph = fc
      .tuple(
        fc.array(inline, { maxLength: 5 }),
        fc.record(
          {
            justification: fc.constantFrom("left", "center", "both"),
            indent: fc.constant({ left: 720, hanging: 360 }),
            spacing: fc.constant({ after: 120 }),
            keepNext: fc.boolean(),
          },
          { requiredKeys: [] },
        ),
      )
      .map(([content, attrs]) => ({
        type: "paragraph",
        ...(Object.keys(attrs).length ? { attrs } : {}),
        ...(content.length ? { content } : {}),
      }));
    await fc.assert(
      fc.asyncProperty(fc.array(paragraph, { minLength: 1, maxLength: 4 }), async (blocks) => {
        const document = parseDocumentV3({
          schemaVersion: 3,
          section: { pageSize: { width: 11906, height: 16838 } },
          defaults: {},
          styles: [],
          numbering: { abstracts: [], instances: [] },
          comments: [],
          content: { type: "doc", content: blocks },
        });
        const again = await importDocx(await exportDocx(document));
        expect(values(again.document.content)).toEqual(values(document.content));
      }),
      { numRuns: 100 },
    );
  });
});
