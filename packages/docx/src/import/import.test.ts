import { readdirSync, readFileSync } from "node:fs";
import type { NodeJSON } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { importDocx } from "../index.js";
import { deflateEntry, writeZip } from "../zip.js";

const CORPUS = new URL("../../../../corpus/word/", import.meta.url);
const REFERENCE = new URL("../../../../corpus/reference/word/", import.meta.url);
const names = readdirSync(CORPUS).filter((n) => n.endsWith(".docx"));
const load = (name: string) => importDocx(new Uint8Array(readFileSync(new URL(name, CORPUS))));

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** A minimal package around `body` (the inside of `w:body`), with optional extra parts. */
async function docx(
  body: string,
  options: { rels?: string; parts?: Record<string, string>; root?: string } = {},
): Promise<Uint8Array> {
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml":
      options.root ??
      `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:x="urn:x"><w:body>${body}</w:body></w:document>`,
    "word/_rels/document.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${options.rels ?? ""}</Relationships>`,
    ...options.parts,
  };
  const entries = [];
  for (const [name, text] of Object.entries(files))
    entries.push(await deflateEntry(name, new TextEncoder().encode(text)));
  return writeZip(entries);
}

const blocksOf = async (body: string, options?: Parameters<typeof docx>[1]) => {
  const result = await importDocx(await docx(body, options));
  return { ...result, blocks: result.document.content.content ?? [] };
};

/** A paragraph's text as Word's `Range.Text` gives it, with tracked deletions accepted. */
function text(paragraph: NodeJSON): string {
  return (paragraph.content ?? [])
    .map((n) => {
      if ((n.marks ?? []).some((m) => m.type === "deletion")) return "";
      if (n.type === "text") return n.text;
      return n.type === "tab" ? "\t" : n.type === "hardBreak" ? "\n" : "";
    })
    .join("");
}

describe("importing the Word corpus", () => {
  it("has the corpus", () => {
    expect(names.length).toBeGreaterThanOrEqual(5);
  });

  for (const name of names) {
    it(`${name}: has Word's text in every paragraph outside tables`, async () => {
      const { document } = await load(name);
      const reference = JSON.parse(
        readFileSync(new URL(name.replace(".docx", ".json"), REFERENCE), "utf8"),
      );
      const expected = (reference.paragraphs as { text: string; inTable: boolean }[])
        .filter((p) => !p.inTable)
        .map((p) => p.text.toLowerCase());
      const imported = (document.content.content ?? [])
        .filter((b) => b.type === "paragraph")
        .map((p) => text(p).toLowerCase());
      if (name.startsWith("03-")) {
        // Content controls are opaque until Phase 11: the paragraphs without one match.
        const plain = imported.filter(
          (t) => !/date:|position:|salary|remote/.test(t) && t !== "dear ,",
        );
        let at = 0;
        for (const t of plain) {
          at = expected.indexOf(t, at);
          expect(at, t).toBeGreaterThanOrEqual(0);
        }
      } else {
        // Case aside: Word's Range.Text applies the heading styles' all caps.
        expect(imported).toEqual(expected);
      }
    });

    it(`${name}: keeps every unmodeled element verbatim`, async () => {
      const result = await load(name);
      const main = result.package.text("/word/document.xml");
      const walk = (node: NodeJSON) => {
        const attrs = (node.attrs ?? {}) as Record<string, unknown>;
        if (node.type.startsWith("opaque")) expect(main.includes(attrs.xml as string)).toBe(true);
        if (node.type === "paragraph" && attrs.ext)
          expect(main.includes(attrs.ext as string)).toBe(true);
        for (const m of node.marks ?? [])
          if (m.type === "runExt") expect(main.includes(m.attrs?.xml as string)).toBe(true);
        for (const c of node.content ?? []) walk(c);
      };
      walk(result.document.content);
      expect(result.report.unmodeledCount).toBe(0);
    });
  }

  it("reads legal numbering, styles and the theme (NDA)", async () => {
    const { document, report } = await load("01-mutual-nda.docx");
    const numbered = (document.content.content ?? []).filter((p) => p.attrs?.numbering);
    expect(numbered.length).toBeGreaterThan(5);
    const [abstract] = document.numbering.abstracts;
    expect(abstract?.levels.slice(0, 4).map((l) => [l.format, l.text, l.style])).toEqual([
      ["decimal", "%1.", "Heading1"],
      ["decimal", "%1.%2", "Clause"],
      ["lowerLetter", "(%3)", "Sub-clause"],
      ["lowerRoman", "(%4)", "Sub-sub-clause"],
    ]);
    const heading = document.styles.find((s) => s.id === "Heading1");
    expect(heading?.paragraph?.numbering?.id).toBeDefined();
    expect(heading?.run?.map((m) => m.type)).toContain("caps");
    expect(heading?.ext?.startsWith("<w:style ")).toBe(true);
    expect(document.defaults.run?.find((m) => m.type === "fontSize")?.attrs).toEqual({
      value: 22,
      complexScript: 22,
    });
    expect(document.theme?.fonts.minor.latin).toBe("Aptos");
    expect(document.section.pageSize).toEqual({ width: 11906, height: 16838 });
    expect(document.section.titlePage).toBe(true);
    // A cross-reference field: its structure opaque, its result editable text.
    expect(report.opaque).toEqual({ "w:fldChar": 3, "w:instrText": 1, "w:tbl": 1 });
    const bookmarks = (document.content.content ?? []).flatMap((p) =>
      (p.content ?? []).filter((n) => n.type === "bookmarkStart"),
    );
    expect(bookmarks.length).toBe(1);
  });

  it("reads tracked changes and comments (redlined agreement)", async () => {
    const { document } = await load("02-services-agreement-redlined.docx");
    const runs = (document.content.content ?? []).flatMap((p) => p.content ?? []);
    const changes = runs.flatMap((n) =>
      (n.marks ?? []).filter((m) => m.type === "insertion" || m.type === "deletion"),
    );
    expect(new Set(changes.map((m) => m.attrs?.author))).toEqual(
      new Set(["Alice Martin", "Bob Chen"]),
    );
    expect(changes.some((m) => m.type === "deletion")).toBe(true);
    expect(runs.some((n) => n.marks?.some((m) => m.type === "formatChange"))).toBe(true);
    // A new clause: its paragraph mark is inserted.
    expect(
      (document.content.content ?? []).some(
        (p) => (p.attrs?.revision as { insertion?: unknown })?.insertion,
      ),
    ).toBe(true);
    expect(document.comments.map((c) => [c.id, c.author, c.parent, c.done])).toEqual([
      [1, "Alice Martin", undefined, false],
      [2, "Bob Chen", 1, false],
      [5, "Bob Chen", undefined, true],
      [6, "Alice Martin", 5, true],
    ]);
    expect(document.comments[0]?.content[0]?.attrs?.style).toBe("CommentText");
    const anchors = runs.filter((n) => n.type.startsWith("comment")).map((n) => n.type);
    // Comments 1 and 2 anchor in the text; 5 and 6 in the fee table (opaque until Phase 10).
    expect(anchors).toEqual([
      "commentStart",
      "commentStart",
      "commentEnd",
      "commentReference",
      "commentEnd",
      "commentReference",
    ]);
  });

  it("keeps content controls and fields opaque (template)", async () => {
    const { document, report } = await load("03-offer-letter-template.docx");
    expect(report.opaque["w:sdt"]).toBe(5);
    const labels = (document.content.content ?? []).flatMap((p) =>
      (p.content ?? []).filter((n) => n.type === "opaqueInline").map((n) => n.attrs?.label),
    );
    expect(labels).toContain("«CandidateFirstName»");
    expect(labels).toContain("content control");
  });

  it("reads sections, pictures, footnotes and tables as Word has them (board report)", async () => {
    const { document, report } = await load("04-board-report.docx");
    const sections = (document.content.content ?? []).filter((p) => p.attrs?.section);
    expect(sections.length).toBe(1);
    const landscape = [sections[0]?.attrs?.section, document.section].map(
      (s) => (s as { pageSize: { orientation?: string } }).pageSize.orientation,
    );
    expect(landscape.sort()).toEqual(["landscape", undefined].sort());
    expect(report.opaque["w:drawing"]).toBe(1);
    expect(report.opaque["w:footnoteReference"]).toBe(2);
    expect(
      (document.content.content ?? [])
        .filter((b) => b.type === "opaqueBlock")
        .map((b) => b.attrs?.label),
    ).toEqual(["table"]);
  });

  it("reads character formatting, tabs and indents (business letter)", async () => {
    const { document, report } = await load("05-business-letter.docx");
    const nodes = (document.content.content ?? []).flatMap((p) => p.content ?? []);
    const marks = nodes.flatMap((n) => n.marks ?? []);
    expect(marks.find((m) => m.type === "highlight")?.attrs?.value).toBe("yellow");
    expect(marks.find((m) => m.type === "underline")?.attrs?.style).toBe("double");
    expect(marks.find((m) => m.type === "verticalAlign")?.attrs?.value).toBe("superscript");
    expect(
      marks.some((m) => m.type === "smallCaps") ||
        document.styles.some((s) => s.run?.some((m) => m.type === "smallCaps")),
    ).toBe(true);
    expect(nodes.filter((n) => n.type === "tab").length).toBe(4);
    expect(nodes.some((n) => n.type === "pageBreak")).toBe(true);
    expect(
      (document.content.content ?? []).some(
        (p) => (p.attrs?.indent as { hanging?: number })?.hanging,
      ),
    ).toBe(true);
    expect(report.opaque).toEqual({});
  });
});

describe("importing WordprocessingML", () => {
  it("reads runs, breaks, hyphens and toggles", async () => {
    const { blocks, report } = await blocksOf(
      `<w:p w14:paraId="12AB34CD" w:rsidR="00AA"><w:pPr><w:jc w:val="center"/><w:ind w:start="720" w:firstLine="360"/></w:pPr>` +
        `<w:proofErr w:type="spellStart"/><w:r w:rsidR="00BB"><w:rPr><w:b w:val="0"/><w:iCs/><w:rFonts w:ascii="Arial" w:cstheme="minorBidi"/><w:szCs w:val="28"/></w:rPr><w:t xml:space="preserve">a </w:t><w:noBreakHyphen/><w:softHyphen/><w:tab/><w:br/><w:br w:type="page"/><w:br w:type="column"/><w:br w:type="textWrapping" w:clear="all"/><w:cr/><w:lastRenderedPageBreak/></w:r></w:p>`,
    );
    const [p] = blocks;
    expect(p?.attrs).toMatchObject({
      justification: "center",
      indent: { left: 720, firstLine: 360 },
      attributes: { "w14:paraId": "12AB34CD", "w:rsidR": "00AA" },
    });
    expect(p?.content?.map((n) => (n.type === "text" ? n.text : n.type))).toEqual([
      "a ‑­",
      "tab",
      "hardBreak",
      "pageBreak",
      "columnBreak",
      "hardBreak",
      "hardBreak",
    ]);
    expect(p?.content?.[5]?.attrs).toEqual({ clear: "all" });
    const marks = p?.content?.[0]?.marks ?? [];
    // Canonical form: values equal to their default are left out.
    expect(marks.find((m) => m.type === "bold")?.attrs).toEqual({ value: false });
    expect(marks.find((m) => m.type === "italic")?.attrs).toEqual({
      value: null,
      complexScript: true,
    });
    expect(marks.find((m) => m.type === "font")?.attrs).toMatchObject({
      ascii: "Arial",
      csTheme: "minorBidi",
    });
    expect(marks.find((m) => m.type === "fontSize")?.attrs).toEqual({ complexScript: 28 });
    expect(marks.find((m) => m.type === "runExt")?.attrs?.xml).toMatch(/^<w:rPr><w:b w:val="0"\/>/);
    expect(report.dropped).toEqual({
      "w:lastRenderedPageBreak": 1,
      "w:proofErr": 1,
      "w:r@w:rsidR": 1,
    });
  });

  it("resolves hyperlinks against the part's relationships", async () => {
    const { blocks } = await blocksOf(
      `<w:p><w:hyperlink r:id="rId5" w:history="1"><w:r><w:t>site</w:t></w:r></w:hyperlink><w:hyperlink w:anchor="_Toc1" w:tooltip="Go"><w:r><w:t>toc</w:t></w:r></w:hyperlink><w:hyperlink r:id="rId6"><w:r><w:t>share</w:t></w:r></w:hyperlink></w:p>`,
      {
        rels:
          '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/a?b=1" TargetMode="External"/>' +
          '<Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="file:///\\\\server\\share\\x.docx" TargetMode="External"/>',
      },
    );
    const links = blocks[0]?.content?.map((n) => n.marks?.find((m) => m.type === "link")?.attrs);
    expect(links).toEqual([
      { href: "https://example.com/a?b=1", attributes: { "r:id": "rId5", "w:history": "1" } },
      { anchor: "_Toc1", tooltip: "Go" },
      { href: "file:///\\\\server\\share\\x.docx", attributes: { "r:id": "rId6" } },
    ]);
  });

  it("reads tracked moves with their names", async () => {
    const { blocks } = await blocksOf(
      `<w:p><w:moveFromRangeStart w:id="1" w:name="move123" w:author="A"/><w:moveFrom w:id="2" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:t>moved</w:t></w:r></w:moveFrom><w:moveFromRangeEnd w:id="1"/></w:p>` +
        `<w:p><w:moveToRangeStart w:id="3" w:name="move123" w:author="A"/><w:moveTo w:id="4" w:author="A"><w:r><w:t>moved</w:t></w:r></w:moveTo><w:moveToRangeEnd w:id="3"/></w:p>`,
    );
    const mark = (i: number) => blocks[i]?.content?.find((n) => n.type === "text")?.marks?.[0];
    expect(mark(0)).toEqual({
      type: "deletion",
      attrs: { id: 2, author: "A", date: "2026-01-01T00:00:00Z", move: "move123" },
    });
    expect(mark(1)?.type).toBe("insertion");
    expect(mark(1)?.attrs?.move).toBe("move123");
    // The range markers are kept, showing nothing.
    expect(
      blocks[0]?.content?.filter((n) => n.type === "opaqueInline").map((n) => n.attrs?.label),
    ).toEqual([undefined, undefined]);
  });

  it("reports what the model cannot hold, keeping it in ext, and imports the rest", async () => {
    const { blocks, report } = await blocksOf(
      `<w:p><w:pPr><w:jc w:val="sideways"/><w:ind w:left="1.5cm"/><w:spacing w:after="120"/><w:numPr><w:numId w:val="3"/></w:numPr></w:pPr>` +
        `<w:ins w:id="7" w:author="A" w:date="last tuesday"><w:r><w:rPr><w:sz w:val="9999"/><w:highlight w:val="orange"/><w:b w:val="maybe"/><w:i/></w:rPr><w:t>x</w:t></w:r></w:ins><w:r><w:br w:clear="sideways"/><w:commentReference w:id="-1"/></w:r></w:p>`,
    );
    const p = blocks[0];
    expect(p?.attrs).toMatchObject({ spacing: { after: 120 }, numbering: { id: 3 } });
    expect(p?.attrs?.justification).toBeUndefined();
    expect(p?.attrs?.indent).toBeUndefined();
    expect(p?.attrs?.ext).toContain('w:val="sideways"');
    const x = p?.content?.[0];
    // The change is kept without its date; italic kept; the rest only in runExt.
    expect(x?.marks?.map((m) => m.type)).toEqual(["insertion", "italic", "runExt"]);
    expect(x?.marks?.[0]?.attrs?.date).toBeUndefined();
    expect(p?.content?.slice(1).map((n) => n.type)).toEqual(["opaqueInline", "opaqueInline"]);
    expect(report.unmodeledCount).toBe(8);
    expect(report.unmodeled.join("\n")).toMatch(/w:jc: justification/);
  });

  it("keeps unknown block and inline content as opaque nodes", async () => {
    const { blocks, report } = await blocksOf(
      `<w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl><w:bookmarkEnd w:id="9"/><x:custom/><w:p><w:smartTag><w:r><w:t>a</w:t></w:r></w:smartTag><w:fldSimple w:instr=" PAGE "><w:r><w:t>3</w:t></w:r></w:fldSimple><w:r><w:drawing/><w:sym w:font="Wingdings" w:char="F0FC"/></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>`,
    );
    expect(blocks.map((b) => [b.type, b.attrs?.label])).toEqual([
      ["opaqueBlock", "table"],
      ["opaqueBlock", undefined],
      ["opaqueBlock", "custom"],
      ["paragraph", undefined],
    ]);
    expect(blocks[0]?.attrs?.xml).toBe("<w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>");
    expect(blocks[3]?.content?.map((n) => n.attrs?.label)).toEqual([
      "smartTag",
      "3",
      "picture",
      "symbol",
    ]);
    expect(report.opaque).toEqual({
      "w:bookmarkEnd": 1,
      "w:drawing": 1,
      "w:fldSimple": 1,
      "w:smartTag": 1,
      "w:sym": 1,
      "w:tbl": 1,
      "x:custom": 1,
    });
  });

  it("reads the body's last section, and gives an empty body a paragraph", async () => {
    const { document, blocks } = await blocksOf(
      `<w:sectPr><w:headerReference w:type="default" r:id="rId9"/><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/><w:type w:val="continuous"/><w:titlePg w:val="0"/><w:cols w:space="708"/></w:sectPr>`,
    );
    expect(blocks).toEqual([{ type: "paragraph" }]);
    expect(document.section).toMatchObject({
      pageSize: { width: 16838, height: 11906, orientation: "landscape" },
      margins: { top: 1440, header: 708, gutter: 0 },
      type: "continuous",
      titlePage: false,
      headers: { default: "rId9" },
    });
    expect(document.section.ext).toMatch(/^<w:sectPr>.*<w:cols w:space="708"\/><\/w:sectPr>$/);
  });

  it("reads styles, numbering and comments parts", async () => {
    const STYLES = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles";
    const NUMBERING =
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering";
    const COMMENTS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
    const EXTENDED = "http://schemas.microsoft.com/office/2011/relationships/commentsExtended";
    const { document, report } = await importDocx(
      await docx("<w:p/>", {
        rels: `<Relationship Id="s" Type="${STYLES}" Target="styles.xml"/><Relationship Id="n" Type="${NUMBERING}" Target="numbering.xml"/><Relationship Id="c" Type="${COMMENTS}" Target="comments.xml"/><Relationship Id="e" Type="${EXTENDED}" Target="commentsExtended.xml"/>`,
        parts: {
          "word/styles.xml": `<w:styles xmlns:w="${W_NS}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Duplicate"/></w:style><w:style w:type="paragraph" w:styleId="A"><w:basedOn w:val="B"/></w:style><w:style w:type="paragraph" w:styleId="B"><w:basedOn w:val="A"/></w:style><w:style w:type="table"/></w:styles>`,
          "word/numbering.xml": `<w:numbering xmlns:w="${W_NS}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:lvlText w:val="%1)"/><w:lvlJc w:val="both"/></w:lvl><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="12"/></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="4"/></w:lvlOverride></w:num><w:num w:numId="2"><w:abstractNumId w:val="9"/></w:num><w:num w:numId="0"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
          "word/comments.xml": `<w:comments xmlns:w="${W_NS}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:comment w:id="1" w:author="" w:initials="" w:date="bad"><w:p w14:paraId="AAAA0001"><w:r><w:t>first</w:t></w:r></w:p></w:comment><w:comment w:id="2" w:author="B"><w:p w14:paraId="AAAA0002"/></w:comment></w:comments>`,
          "word/commentsExtended.xml": `<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w15:commentEx w15:paraId="AAAA0001" w15:paraIdParent="AAAA0002" w15:done="1"/><w15:commentEx w15:paraId="AAAA0002" w15:paraIdParent="AAAA0001"/></w15:commentsEx>`,
        },
      }),
    );
    // Duplicates kept (the first wins when resolved); the cycle broken where it closes; a style
    // without an id left in the original part.
    expect(document.styles.map((st) => [st.id, st.name, st.basedOn, st.isDefault])).toEqual([
      ["Normal", "Normal", undefined, true],
      ["Normal", "Duplicate", undefined, undefined],
      ["A", undefined, "B", undefined],
      ["B", undefined, undefined, undefined],
    ]);
    // The first of two level 0s; a level past 8 left out; an invalid justification left out.
    expect(
      document.numbering.abstracts[0]?.levels.map((l) => [l.level, l.text, l.justification]),
    ).toEqual([[0, "%1)", undefined]]);
    expect(document.numbering.instances.map((n) => [n.id, n.abstract, n.overrides])).toEqual([
      [1, 0, [{ level: 0, start: 4 }]],
      [2, 9, undefined],
    ]);
    // Anonymous, no usable date; a reply that would close a cycle is not kept.
    expect(
      document.comments.map((c) => [c.id, c.author, c.initials, c.date, c.parent, c.done]),
    ).toEqual([
      [1, "", "", undefined, 2, true],
      [2, "B", undefined, undefined, undefined, undefined],
    ]);
    expect(document.comments[1]?.content).toEqual([
      { type: "paragraph", attrs: { attributes: { "w14:paraId": "AAAA0002" } } },
    ]);
    expect(report.unmodeled.join(" ")).toMatch(/closes a cycle/);
  });

  it("refuses what is not a WordprocessingML document", async () => {
    await expect(
      importDocx(
        await docx("", {
          root: '<w:document xmlns:w="http://purl.oclc.org/ooxml/wordprocessingml/main"><w:body/></w:document>',
        }),
      ),
    ).rejects.toThrow(/Strict Open XML/);
    await expect(
      importDocx(await docx("", { root: `<w:other xmlns:w="${W_NS}"/>` })),
    ).rejects.toThrow(/not a WordprocessingML document/);
    await expect(
      importDocx(await docx("", { root: `<w:document xmlns:w="${W_NS}"/>` })),
    ).rejects.toThrow(/no w:body/);
  });

  it("keeps attribute names that are object keys as data", async () => {
    const { blocks } = await blocksOf(
      '<w:p __proto__="x" constructor="y"><w:r><w:t>a</w:t></w:r></w:p>',
    );
    const bag = blocks[0]?.attrs?.attributes as Record<string, string>;
    expect(Object.getPrototypeOf(bag)).toBe(Object.prototype);
    expect(Object.hasOwn(bag, "__proto__") && bag.constructor).toBe("y");
  });
});
