import { readdirSync, readFileSync } from "node:fs";
import type { NodeJSON } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { importDocx } from "../index.js";
import { docx } from "../testing/package.js";
import type { XmlElement } from "../xml.js";

const CORPUS = new URL("../../../../corpus/word/", import.meta.url);
const REFERENCE = new URL("../../../../corpus/reference/word/", import.meta.url);
const names = readdirSync(CORPUS).filter((n) => n.endsWith(".docx"));
const load = (name: string) => importDocx(new Uint8Array(readFileSync(new URL(name, CORPUS))));

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

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

  it("reads text as Word does: ends trimmed unless xml:space is preserve", async () => {
    const { blocks } = await blocksOf(
      '<w:p><w:r><w:t> a </w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve"> b </w:t></w:r></w:p>',
    );
    expect(blocks.map((p) => p.content?.[0]?.text)).toEqual(["a", " b "]);
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

/** Attributes import models as values (not kept as written): element → attribute names. */
const MODELED: Record<string, readonly string[]> = {
  "w:ins": ["w:id", "w:author", "w:date"],
  "w:del": ["w:id", "w:author", "w:date"],
  "w:moveFrom": ["w:id", "w:author", "w:date"],
  "w:moveTo": ["w:id", "w:author", "w:date"],
  "w:bookmarkStart": ["w:id", "w:name"],
  "w:bookmarkEnd": ["w:id"],
  "w:commentRangeStart": ["w:id"],
  "w:commentRangeEnd": ["w:id"],
  "w:commentReference": ["w:id"],
  "w:hyperlink": ["w:anchor", "w:tooltip"],
  "w:br": ["w:type", "w:clear"],
  // Regenerated: whether text needs `xml:space="preserve"` follows from the text.
  "w:t": ["xml:space"],
  "w:delText": ["xml:space"],
};
const REGENERATED = new Set(["w:t@xml:space", "w:delText@xml:space"]);

describe("import keeps every attribute of the corpus", () => {
  for (const name of names) {
    it(`${name}: every attribute is kept as written, in a bag, as a modeled value, or dropped by rule`, async () => {
      const result = await load(name);
      const json = JSON.stringify(result.document);
      const has = (text: string) => json.includes(JSON.stringify(text).slice(1, -1));
      for (const part of ["/word/document.xml", "/word/comments.xml"]) {
        if (!result.package.part(part)) continue;
        const xml = result.package.xml(part);
        const walk = (el: XmlElement, depth: number) => {
          if (depth > 1) {
            for (const a of el.attributes) {
              if (a.prefix === "xmlns" || a.name === "xmlns") continue;
              if (el.name === "w:r" && a.local.startsWith("rsid")) continue; // dropped by rule
              const raw = xml.source.slice(a.start, a.end);
              const bagged = json.includes(`${JSON.stringify(a.name)}:${JSON.stringify(a.value)}`);
              const modeled =
                (MODELED[el.name] ?? []).includes(a.name) &&
                (REGENERATED.has(`${el.name}@${a.name}`) || has(a.value));
              expect(
                has(raw) || bagged || modeled,
                `${part} ${el.name}@${a.name}="${a.value}"`,
              ).toBe(true);
            }
          }
          for (const c of el.children) if (c.kind === "element") walk(c, depth + 1);
        };
        walk(xml.root, 0);
      }
    });
  }
});

describe("import never strips an element it cannot model", () => {
  it("keeps current Word's extra attributes on tracked changes and markers", async () => {
    const { blocks, report } = await blocksOf(
      `<w:p><w:ins w:id="1" w:author="A" w:date="2026-01-01T10:00:00Z" w16du:dateUtc="2026-01-01T09:00:00Z" xmlns:w16du="urn:du"><w:r><w:t>new</w:t></w:r></w:ins>` +
        `<w:bookmarkStart w:id="0" w:name="b" w:displacedByCustomXml="next"/><w:commentRangeStart w:id="3" x:extra="1"/></w:p>`,
    );
    const nodes = blocks[0]?.content ?? [];
    // Its own namespace declaration included: written back, the attribute still resolves.
    expect(nodes[0]?.marks?.[0]?.attrs?.attributes).toEqual({
      "w16du:dateUtc": "2026-01-01T09:00:00Z",
      "xmlns:w16du": "urn:du",
    });
    expect(nodes[1]?.attrs).toEqual({
      id: 0,
      name: "b",
      attributes: { "w:displacedByCustomXml": "next" },
    });
    expect(nodes[2]?.attrs).toEqual({ id: 3, attributes: { "x:extra": "1" } });
    expect(report.unmodeledCount).toBe(0);
  });

  it("keeps a change or link the model rejects whole, never as plain text", async () => {
    const long = "x".repeat(300);
    const { blocks } = await blocksOf(
      `<w:p><w:del w:id="1" w:author="${long}"><w:r><w:delText>gone</w:delText></w:r></w:del>` +
        `<w:ins w:id="3000000000" w:author="A"><w:r><w:t>new</w:t></w:r></w:ins>` +
        `<w:hyperlink w:anchor=""><w:r><w:t>empty anchor</w:t></w:r></w:hyperlink>` +
        `<w:hyperlink w:anchor="a"><w:hyperlink w:anchor="b"><w:r><w:t>nested</w:t></w:r></w:hyperlink></w:hyperlink></w:p>`,
    );
    const nodes = blocks[0]?.content ?? [];
    expect(nodes.map((n) => [n.type, n.attrs?.label])).toEqual([
      ["opaqueInline", "gone"],
      ["opaqueInline", "new"],
      ["opaqueInline", "empty anchor"],
      ["opaqueInline", "nested"],
    ]);
    expect(nodes[3]?.marks?.[0]?.attrs?.anchor).toBe("a");
    expect(nodes[0]?.attrs?.xml).toMatch(/^<w:del /);
  });

  it("keeps a run with attributes it does not model whole", async () => {
    const { blocks, report } = await blocksOf(
      `<w:p><w:r w:rsidR="00AA" x:keep="1"><w:t>run</w:t></w:r><w:r><w:rPr><w:b/></w:rPr></w:r></w:p>`,
    );
    expect(blocks[0]?.content?.map((n) => [n.type, n.attrs?.label])).toEqual([
      ["opaqueInline", "run"],
    ]);
    expect(report.opaque).toEqual({ "w:r@x:keep": 1 });
    expect(report.dropped).toEqual({ "w:r (empty)": 1 });
  });

  it("keeps the body's section when it is not the last element, and others opaque", async () => {
    const { document, blocks } = await blocksOf(
      `<w:p/><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr><w:bookmarkEnd w:id="0"/>`,
    );
    expect(document.section.pageSize).toEqual({ width: 11906, height: 16838 });
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "opaqueBlock"]);
    const two = await blocksOf(
      `<w:sectPr><w:type w:val="continuous"/></w:sectPr><w:p/><w:sectPr/>`,
    );
    expect(two.blocks.map((b) => b.attrs?.label ?? b.type)).toEqual(["sectPr", "paragraph"]);
  });

  it("keeps the valid attributes of a paragraph and reports the rest", async () => {
    const many = Array.from({ length: 70 }, (_, i) => `x:a${i}="${i}"`).join(" ");
    const { blocks, report } = await blocksOf(`<w:p w14:paraId="1A2B" ${many}/>`);
    const bag = blocks[0]?.attrs?.attributes as Record<string, string>;
    expect(Object.keys(bag).length).toBe(64);
    expect(bag["w14:paraId"]).toBe("1A2B");
    expect(report.unmodeledCount).toBe(7);
  });
});

describe("import names moves by their innermost open range", () => {
  it("returns to the outer range's name once the inner one closes", async () => {
    const { blocks } = await blocksOf(
      `<w:p><w:moveFromRangeStart w:id="1" w:name="outer"/><w:moveFromRangeStart w:id="2" w:name="inner"/>` +
        `<w:moveFrom w:id="3" w:author="A"><w:r><w:t>a</w:t></w:r></w:moveFrom><w:moveFromRangeEnd w:id="2"/>` +
        `<w:moveFrom w:id="4" w:author="A"><w:r><w:t>b</w:t></w:r></w:moveFrom><w:moveFromRangeEnd w:id="1"/>` +
        `<w:moveFrom w:id="5" w:author="A"><w:r><w:t>c</w:t></w:r></w:moveFrom></w:p>`,
    );
    const moves = (blocks[0]?.content ?? [])
      .filter((n) => n.type === "text")
      .map((n) => n.marks?.[0]?.attrs?.move);
    expect(moves).toEqual(["inner", "outer", "move"]);
  });
});

describe("import accepts what Word opens, and fails only with DocxError", () => {
  const STYLES = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles";
  const NUMBERING = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering";
  const THEME = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme";
  const COMMENTS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
  const EXTENDED = "http://schemas.microsoft.com/office/2011/relationships/commentsExtended";
  const rels =
    `<Relationship Id="s" Type="${STYLES}" Target="styles.xml"/><Relationship Id="n" Type="${NUMBERING}" Target="numbering.xml"/>` +
    `<Relationship Id="t" Type="${THEME}" Target="theme.xml"/><Relationship Id="c" Type="${COMMENTS}" Target="comments.xml"/><Relationship Id="e" Type="${EXTENDED}" Target="ext.xml"/>`;
  const change = '<w:rPrChange w:id="9" w:author="A"><w:rPr><w:i/></w:rPr></w:rPrChange>';

  it("imports values beyond the model's limits, reporting them", async () => {
    const { document, report } = await importDocx(
      await docx(`<w:p><w:pPr><w:rPr><w:b/>${change}</w:rPr></w:pPr></w:p>`, {
        rels,
        parts: {
          "word/styles.xml": `<w:styles xmlns:w="${W_NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:lang w:val="en-US"/>${change}</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:textAlignment w:val="center"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="S"><w:rPr><w:b/>${change}</w:rPr></w:style></w:styles>`,
          "word/numbering.xml": `<w:numbering xmlns:w="${W_NS}"><w:abstractNum w:abstractNumId="3000000000"/><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="99999999999"/><w:rPr>${change}</w:rPr></w:lvl></w:abstractNum><w:num w:numId="3000000000"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="1"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="3000000000"/></w:lvlOverride></w:num></w:numbering>`,
          "word/theme.xml": `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme><a:majorFont><a:latin typeface="${"F".repeat(300)}"/></a:majorFont><a:minorFont><a:latin typeface="B"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`,
          "word/comments.xml": `<w:comments xmlns:w="${W_NS}"><w:comment w:id="3000000000" w:author="A"><w:p/></w:comment><w:comment w:id="1" w:author="${"a".repeat(300)}" w:initials="ABCDEFGHIJK" w:date="2026-01-01"><w:p/></w:comment></w:comments>`,
        },
      }),
    );
    // A recorded change stays in the verbatim element; the run properties are kept.
    expect(document.content.content?.[0]?.attrs?.markFormat).toEqual([{ type: "bold" }]);
    expect(document.styles[0]?.run).toEqual([{ type: "bold" }]);
    expect(document.defaults.ext).toMatch(/^<w:docDefaults>.*w:textAlignment.*<\/w:docDefaults>$/);
    expect(document.numbering.abstracts.map((a) => [a.id, a.levels[0]?.start])).toEqual([
      [0, undefined],
    ]);
    expect(document.numbering.instances).toEqual([
      { id: 1, abstract: 0, overrides: [{ level: 0 }], ext: expect.any(String) },
    ]);
    expect(document.theme).toBeUndefined();
    expect(document.comments.map((c) => [c.id, c.author.length, c.initials, c.date])).toEqual([
      [1, 255, undefined, undefined],
    ]);
    expect(document.comments[0]?.ext).toMatch(
      /^<w:comment w:id="1" w:author="a{300}" w:initials="ABCDEFGHIJK" w:date="2026-01-01">$/,
    );
    // Two abstract ids and instance ids out of range, a start and a start override, the theme,
    // a comment id, a date without a time, a long author and long initials.
    expect(report.unmodeledCount).toBe(9);
    expect(report.unmodeled.join(" | ")).toMatch(/w:abstractNum: id 3000000000/);
    expect(report.unmodeled.join(" | ")).toMatch(/w:comment@w:date: 2026-01-01/);
  });

  it("fails with DocxError past what the model holds at all", async () => {
    const huge = `<w:tbl>${"<w:tr/>".repeat(2_400_000)}</w:tbl>`;
    await expect(importDocx(await docx(huge))).rejects.toMatchObject({
      name: "DocxError",
      message: expect.stringMatching(/^Cannot import: /),
    });
  });

  it("keeps resolved state and replies on the right comment when ids repeat", async () => {
    const { document } = await importDocx(
      await docx("<w:p/>", {
        rels,
        parts: {
          "word/comments.xml": `<w:comments xmlns:w="${W_NS}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:comment w:id="1" w:author="X1"><w:p w14:paraId="0001"/></w:comment><w:comment w:id="2" w:author="Y"><w:p w14:paraId="0002"/></w:comment><w:comment w:id="1" w:author="X2"><w:p w14:paraId="0003"/></w:comment></w:comments>`,
          "word/ext.xml": `<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w15:commentEx w15:paraId="0001" w15:done="1"/><w15:commentEx w15:paraId="0002" w15:paraIdParent="0001" w15:done="on"/><w15:commentEx w15:paraId="0003" w15:done="maybe"/></w15:commentsEx>`,
        },
      }),
    );
    expect(document.comments.map((c) => [c.author, c.parent, c.done])).toEqual([
      ["X1", undefined, true],
      ["Y", 1, true],
      ["X2", undefined, undefined],
    ]);
    const same = await importDocx(
      await docx("<w:p/>", {
        rels,
        parts: {
          "word/comments.xml": `<w:comments xmlns:w="${W_NS}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:comment w:id="1" w:author="First"><w:p w14:paraId="0001"/></w:comment><w:comment w:id="2" w:author="Second"><w:p w14:paraId="0001"/></w:comment></w:comments>`,
          "word/ext.xml": `<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w15:commentEx w15:paraId="0001" w15:done="1"/></w15:commentsEx>`,
        },
      }),
    );
    // Two comments with one paragraph id: the first has it, as Word resolves it.
    expect(same.document.comments.map((c) => [c.author, c.done])).toEqual([
      ["First", true],
      ["Second", undefined],
    ]);
  });

  it("counts element names that are object keys as names", async () => {
    const { report } = await blocksOf("<constructor/><toString/><w:p/>");
    expect(report.opaque).toEqual({ constructor: 1, toString: 1 });
  });
});

describe("import takes linear time on crafted files", () => {
  const timed = async (body: string, options?: Parameters<typeof docx>[1]) => {
    const bytes = await docx(body, options);
    const started = performance.now();
    await importDocx(bytes);
    return performance.now() - started;
  };

  it("long style chains", async () => {
    const STYLES = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles";
    const chain = Array.from(
      { length: 10_000 },
      (_, i) =>
        `<w:style w:type="paragraph" w:styleId="S${i}">${i ? `<w:basedOn w:val="S${i - 1}"/>` : ""}</w:style>`,
    ).join("");
    const ms = await timed("<w:p/>", {
      rels: `<Relationship Id="s" Type="${STYLES}" Target="styles.xml"/>`,
      parts: { "word/styles.xml": `<w:styles xmlns:w="${W_NS}">${chain}</w:styles>` },
    });
    // Quadratic took about 15 s here; the bound leaves room for a loaded machine.
    expect(ms).toBeLessThan(6000);
  });

  it("many open moves and many hyperlinks", async () => {
    const moves = Array.from(
      { length: 10_000 },
      (_, i) =>
        `<w:moveFromRangeStart w:id="${i}" w:name="m${i}"/><w:moveFrom w:id="${i}" w:author="A"><w:r><w:t>x</w:t></w:r></w:moveFrom>`,
    ).join("");
    expect(await timed(`<w:p>${moves}</w:p>`)).toBeLessThan(6000);
    const HYPERLINK =
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
    const n = 10_000;
    const linkRels = Array.from(
      { length: n },
      (_, i) =>
        `<Relationship Id="h${i}" Type="${HYPERLINK}" Target="https://e.com/${i}" TargetMode="External"/>`,
    ).join("");
    const links = Array.from(
      { length: n },
      (_, i) => `<w:hyperlink r:id="h${i}"><w:r><w:t>l</w:t></w:r></w:hyperlink>`,
    ).join("");
    expect(await timed(`<w:p>${links}</w:p>`, { rels: linkRels })).toBeLessThan(6000);
  });
});
