// @vitest-environment jsdom
import type { FoliDocumentV3, MarkJSON, NodeJSON, StyleJSON } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { fontStack, parseOpaque, renderBlocks, WORD_PAGE_BREAK_ATTR } from "./blocks.js";

const text = (value: string, marks?: MarkJSON[]): NodeJSON => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const mark = (type: string, attrs?: Record<string, unknown>): MarkJSON =>
  attrs ? { type, attrs } : { type };
const p = (attrs: Record<string, unknown>, ...content: NodeJSON[]): NodeJSON => ({
  type: "paragraph",
  ...(Object.keys(attrs).length ? { attrs } : {}),
  ...(content.length ? { content } : {}),
});

const STYLES: StyleJSON[] = [
  {
    id: "Normal",
    type: "paragraph",
    isDefault: true,
    paragraph: { spacing: { after: 160, line: 259, lineRule: "auto" } },
    run: [mark("font", { ascii: "Calibri", hAnsi: "Calibri" }), mark("fontSize", { value: 22 })],
  },
  {
    id: "Heading1",
    type: "paragraph",
    basedOn: "Normal",
    paragraph: { outlineLevel: 0, keepNext: true, spacing: { before: 240 } },
    run: [mark("bold")],
  },
  {
    id: "ListParagraph",
    type: "paragraph",
    basedOn: "Normal",
    paragraph: { contextualSpacing: true, indent: { left: 720 } },
  },
];

function documentOf(content: NodeJSON[], over: Partial<FoliDocumentV3> = {}): FoliDocumentV3 {
  return {
    schemaVersion: 3,
    section: {},
    defaults: {},
    styles: STYLES,
    numbering: {
      abstracts: [
        {
          id: 1,
          levels: [
            {
              level: 0,
              start: 1,
              format: "decimal",
              text: "%1.",
              paragraph: { indent: { left: 720, hanging: 360 } },
            },
            { level: 1, start: 1, format: "lowerLetter", text: "(%2)", suffix: "space" },
            { level: 2, start: 1, format: "bullet", text: "•", suffix: "tab" },
          ],
        },
      ],
      instances: [{ id: 1, abstract: 1 }],
    },
    comments: [],
    content: { type: "doc", content },
    ...over,
  };
}

const render = (content: NodeJSON[], options?: Parameters<typeof renderBlocks>[2]) =>
  renderBlocks(documentOf(content), document, options);

describe("fontStack", () => {
  it("names the font, its metric-compatible substitutes and a generic family", () => {
    expect(fontStack("Calibri")).toBe('"Calibri", "Carlito", sans-serif');
    expect(fontStack("Times New Roman")).toBe(
      '"Times New Roman", "Liberation Serif", "Tinos", serif',
    );
    expect(fontStack("Courier New")).toBe('"Courier New", "Liberation Mono", "Cousine", monospace');
    expect(fontStack("Aptos")).toBe('"Aptos", sans-serif');
    expect(fontStack(null)).toBe('"Times New Roman", "Liberation Serif", "Tinos", serif');
    expect(fontStack('Evil"Font\\')).toBe('"EvilFont", sans-serif');
  });
});

describe("renderBlocks: paragraphs", () => {
  it("renders headings by outline level and paragraphs as p", () => {
    const blocks = render([p({ style: "Heading1" }, text("Title")), p({}, text("Body"))]);
    expect(blocks.map((b) => b.element.localName)).toEqual(["h1", "p"]);
    const [heading, body] = blocks;
    expect(heading?.element.style.fontWeight).toBe("700");
    expect(body?.element.style.fontWeight).toBe("400");
    expect(heading?.element.style.margin).toBe("0px");
    expect(heading).toMatchObject({ keepNext: true, keepLines: false, nodes: [0] });
    expect(heading?.before).toBeCloseTo(16);
    expect(body?.after).toBeCloseTo(160 / 15);
    const deep = render([p({ outlineLevel: 5 }, text("x")), p({ outlineLevel: 6 }, text("y"))]);
    expect(deep.map((b) => b.element.localName)).toEqual(["h6", "p"]);
  });

  it("styles indents, alignment, shading and borders", () => {
    const [block] = render([
      p(
        {
          indent: { left: 1440, right: 720, firstLine: 360 },
          justification: "both",
          shading: { pattern: "clear", fill: "FFEEDD" },
          borders: {
            bottom: { style: "double", size: 8, space: 3, color: "FF0000" },
            between: { style: "single" },
          },
        },
        text("x"),
      ),
    ]);
    const style = (block as { element: HTMLElement }).element.style;
    expect(style.paddingLeft).toBe("96px");
    expect(style.paddingRight).toBe("48px");
    expect(style.textIndent).toBe("24px");
    expect(style.textAlign).toBe("justify");
    expect(style.backgroundColor).toBe("rgb(255, 238, 221)");
    expect(style.borderBottom).toContain("double");
    expect(style.paddingBottom).toBe("4px");
    expect(style.borderTop).toBe("");
    const [hanging] = render([
      p({ indent: { left: 720, hanging: 360 }, justification: "end" }, text("x")),
    ]);
    expect(hanging?.element.style.textIndent).toBe("-24px");
    expect(hanging?.element.style.textAlign).toBe("right");
  });

  it("uses the font's own line height when no line spacing is given", () => {
    const [block] = renderBlocks(documentOf([p({}, text("x"))], { styles: [] }), document, {
      lineRatio: () => 1.25,
    });
    expect(block?.element.style.lineHeight).toBe("1.25");
  });

  it("sets line heights from Word's line rules", () => {
    const ratio = () => 1.25;
    const [auto, exact, least, single] = render(
      [
        p({}, text("a")),
        p({ spacing: { line: 300, lineRule: "exact" } }, text("b")),
        p({ spacing: { line: 200, lineRule: "atLeast" } }, text("c")),
        p({ spacing: { line: 240 } }, text("d")),
      ],
      { lineRatio: ratio },
    );
    expect(Number(auto?.element.style.lineHeight)).toBeCloseTo((1.25 * 259) / 240);
    expect(exact?.element.style.lineHeight).toBe("20px");
    // 11 pt is 14.67 px; 1.25 of that is 18.3 px, more than the 13.3 px minimum.
    expect(Number.parseFloat(least?.element.style.lineHeight ?? "")).toBeCloseTo(
      (1.25 * (11 * 96)) / 72,
    );
    expect(Number(single?.element.style.lineHeight)).toBe(1.25);
    // Each run's own font sets its own line height.
    const span = exact?.element.querySelector("span");
    expect(span?.style.lineHeight).toBe("20px");
  });

  it("drops the space between paragraphs of a style with contextual spacing", () => {
    const blocks = render([
      p({}, text("a")),
      p({ style: "ListParagraph" }, text("b")),
      p({ style: "ListParagraph", spacing: { before: 120 } }, text("c")),
      p({}, text("d")),
    ]);
    expect(blocks.map((b) => [Math.round(b.before), Math.round(b.after)])).toEqual([
      [0, 11],
      [0, 0],
      [0, 11],
      [0, 11],
    ]);
  });

  it("reports keep rules, page break before and section ends", () => {
    const [a, b] = render([
      p(
        { keepLines: true, pageBreakBefore: true, section: { pageSize: { width: 100 } } },
        text("a"),
      ),
      p({ spacing: { beforeAutospacing: true, afterAutospacing: true } }, text("b")),
    ]);
    expect(a).toMatchObject({
      keepLines: true,
      pageBreakBefore: true,
      section: { pageSize: { width: 100 } },
    });
    expect(b?.section).toBeNull();
    expect(b?.before).toBeCloseTo(280 / 15);
    expect(b?.after).toBeCloseTo(280 / 15);
  });

  it("ends lines at breaks: an empty last line after a line break, none after a page break", () => {
    const [empty, line, page, mid] = render([
      p({}),
      p({}, text("a"), { type: "hardBreak" }),
      p({}, text("a"), { type: "pageBreak" }),
      p({}, { type: "pageBreak" }, text("b")),
    ]);
    expect(empty?.element.innerHTML).toBe("<br>");
    expect(line?.element.querySelectorAll("br")).toHaveLength(2);
    expect(page?.element.querySelectorAll("br")).toHaveLength(1);
    expect(page?.element.querySelector("br")?.hasAttribute(WORD_PAGE_BREAK_ATTR)).toBe(true);
    expect(mid?.element.querySelectorAll("br")).toHaveLength(1);
    const [only] = render([p({}, { type: "pageBreak" })]);
    expect(only?.element.querySelectorAll("br")).toHaveLength(1);
  });
});

describe("renderBlocks: runs", () => {
  const runOf = (marks: MarkJSON[]) =>
    render([p({}, text("x", marks))])[0]?.element.querySelector("span") as HTMLElement;

  it("styles run formatting", () => {
    const span = runOf([
      mark("italic"),
      mark("underline", { style: "double", color: "00FF00" }),
      mark("strike"),
      mark("caps"),
      mark("smallCaps"),
      mark("color", { value: "112233" }),
      mark("highlight", { value: "yellow" }),
      mark("characterSpacing", { value: 30 }),
    ]);
    const { style } = span;
    expect(style.fontFamily).toBe('"Calibri", "Carlito", sans-serif');
    expect(style.fontSize).toBe("11pt");
    expect(style.fontStyle).toBe("italic");
    expect(style.textDecorationLine).toBe("underline line-through");
    expect(style.textDecorationStyle).toBe("double");
    expect(style.textTransform).toBe("uppercase");
    expect(style.fontVariant).toBe("small-caps");
    expect(style.color).toBe("rgb(17, 34, 51)");
    expect(style.backgroundColor).toBe("rgb(255, 255, 0)");
    expect(style.letterSpacing).toBe("2px");
    expect(span.textContent).toBe("x");
  });

  it("raises superscripts without growing the line, hides hidden text, shades", () => {
    const sup = runOf([mark("verticalAlign", { value: "superscript" })]);
    expect(sup.style.verticalAlign).toBe("super");
    expect(sup.style.lineHeight).toBe("0");
    expect(Number.parseFloat(sup.style.fontSize)).toBeCloseTo((11 * 2) / 3);
    expect(runOf([mark("verticalAlign", { value: "subscript" })]).style.verticalAlign).toBe("sub");
    expect(runOf([mark("hidden")]).style.display).toBe("none");
    expect(
      runOf([mark("shading", { pattern: "clear", fill: "abcdef" })]).style.backgroundColor,
    ).toBe("rgb(171, 205, 239)");
    expect(runOf([mark("underline", { style: "wave" })]).style.textDecorationStyle).toBe("wavy");
    expect(runOf([mark("doubleStrike")]).style.textDecorationStyle).toBe("double");
  });

  it("keeps a link's target as data, never as a navigable href", () => {
    const span = runOf([mark("link", { href: "javascript:alert(1)" })]);
    expect(span.dataset.href).toBe("javascript:alert(1)");
    expect(span.closest("a")).toBeNull();
    expect(runOf([mark("link", { href: null, anchor: "clause" })]).dataset.href).toBe("#clause");
  });

  it("renders tabs as tab characters", () => {
    const [block] = render([p({}, text("a"), { type: "tab" }, text("b"))]);
    expect(block?.element.textContent).toBe("a\tb");
    expect(block?.element.style.tabSize).toBe("48px");
    expect(block?.element.style.whiteSpace).toBe("pre-wrap");
  });
});

describe("renderBlocks: lists", () => {
  it("puts the marker in the hanging indent, or follows it with a tab or space", () => {
    const [first, second, letter, bullet] = render([
      p({ numbering: { id: 1, level: 0 } }, text("one")),
      p({ numbering: { id: 1, level: 0 } }, text("two")),
      p({ numbering: { id: 1, level: 1 } }, text("a")),
      p({ numbering: { id: 1, level: 2 } }, text("dot")),
    ]);
    const marker = (b: typeof first) =>
      b?.element.querySelector("[data-foli-marker]") as HTMLElement;
    expect(marker(first).textContent).toBe("1.");
    expect(marker(first).style.minWidth).toBe("24px");
    expect(marker(first).style.display).toBe("inline-block");
    expect(marker(first).getAttribute("aria-hidden")).toBe("true");
    expect(marker(second).textContent).toBe("2.");
    expect(marker(letter).textContent).toBe("(a) ");
    expect(marker(bullet).textContent).toBe("•\t");
    expect(first?.element.style.paddingLeft).toBe("48px");
    expect(first?.element.textContent).toBe("1.one");
  });
});

describe("renderBlocks: review", () => {
  const insertion = mark("insertion", { id: 1, author: "Ana" });
  const deletion = mark("deletion", { id: 2, author: "Ben" });

  it("shows insertions and deletions in markup", () => {
    const [block] = render([
      p({}, text("kept "), text("new", [insertion]), text("old", [deletion])),
    ]);
    const ins = block?.element.querySelector("ins") as HTMLElement;
    const del = block?.element.querySelector("del") as HTMLElement;
    expect(ins.textContent).toBe("new");
    expect(ins.title).toBe("Ana");
    expect(del.textContent).toBe("old");
    expect(del.title).toBe("Ben");
    expect(del.style.textDecorationLine).toBe("line-through");
  });

  it("shows the final text: deletions gone, a deleted paragraph mark merged into the next", () => {
    const blocks = render(
      [
        p(
          { numbering: { id: 1, level: 0 }, revision: { deletion: { id: 3, author: "Ben" } } },
          text("first "),
        ),
        p({ numbering: { id: 1, level: 0 } }, text("second"), text(" gone", [deletion])),
        p({ revision: { deletion: { id: 4, author: "Ben" } } }, text("last")),
      ],
      { review: "final" },
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.nodes).toEqual([0, 1]);
    // The merged paragraph's marker is the first one's.
    expect(blocks[0]?.element.textContent).toBe("1.first second");
    expect(blocks[0]?.element.querySelector("ins, del")).toBeNull();
    // The document's last paragraph mark cannot be deleted: it stays.
    expect(blocks[1]?.nodes).toEqual([2]);
    const markup = render(
      [p({ revision: { deletion: { id: 3, author: "Ben" } } }, text("a")), p({}, text("b"))],
      { review: "markup" },
    );
    expect(markup).toHaveLength(2);
  });

  it("marks commented text and comment references", () => {
    const [block] = render([
      p(
        {},
        text("before "),
        { type: "commentStart", attrs: { id: 7 } },
        text("in", [mark("highlight", { value: "green" })]),
        text("side"),
        { type: "commentEnd", attrs: { id: 7 } },
        { type: "commentReference", attrs: { id: 7 } },
        text(" after"),
        { type: "bookmarkStart", attrs: { id: 1, name: "b" } },
      ),
    ]);
    const spans = [...(block?.element.querySelectorAll("span") ?? [])];
    expect(spans.map((s) => s.dataset.foliComments ?? null)).toEqual([null, "7", "7", null, null]);
    expect(spans[1]?.style.backgroundColor).toBe("rgb(0, 255, 0)");
    expect(spans[2]?.style.backgroundColor).not.toBe("");
    expect(spans[3]?.dataset.foliCommentReference).toBe("7");
  });
});

describe("renderBlocks: opaque content", () => {
  const tableXml = [
    '<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="8" w:color="FF0000"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="nil"/></w:tblBorders>',
    '<w:tblCellMar><w:left w:w="60" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr>',
    '<w:tblGrid><w:gridCol w:w="1500"/><w:gridCol w:w="3000"/></w:tblGrid>',
    '<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:shd w:val="clear" w:fill="002060"/></w:tcPr><w:p><w:r><w:t>Head</w:t></w:r></w:p></w:tc></w:tr>',
    '<w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/><w:tcMar><w:left w:w="0" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>A</w:t></w:r></w:p><w:p><w:r><w:t>B</w:t></w:r><w:r><w:delText>gone</w:delText></w:r></w:p></w:tc>',
    "<w:tc><w:p/></w:tc></w:tr>",
    '<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p><w:r><w:t>hidden</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcBorders><w:bottom w:val="dotted" w:sz="4"/></w:tcBorders></w:tcPr><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc></w:tr>',
    "</w:tbl>",
  ].join("");

  it("shows a table from its XML: grid, spans, shading, margins, borders, header rows, cell paragraphs", () => {
    const [block] = render([{ type: "opaqueBlock", attrs: { xml: tableXml, label: "Table" } }]);
    const element = block?.element as HTMLElement;
    expect(element.dataset.foliOpaque).toBe("Table");
    const table = element.querySelector("table") as HTMLTableElement;
    expect(table.style.width).toBe("300px");
    expect(table.style.borderTop).toContain("solid");
    expect([...table.querySelectorAll("col")].map((c) => c.style.width)).toEqual([
      "100px",
      "200px",
    ]);
    const rows = [...table.querySelectorAll("tr")];
    expect(rows.map((r) => "foliHeader" in r.dataset)).toEqual([true, false, false]);
    const head = rows[0]?.querySelector("td") as HTMLTableCellElement;
    expect(head.colSpan).toBe(2);
    expect(head.style.backgroundColor).toBe("rgb(0, 32, 96)");
    expect(head.style.padding).toBe("0px 6px 0px 4px");
    expect(head.style.borderTop).toContain("solid");
    expect(head.style.borderLeftStyle).toBe("none");
    const merged = rows[1]?.querySelector("td") as HTMLTableCellElement;
    expect(merged.style.paddingLeft).toBe("0px");
    expect([...merged.querySelectorAll("h1, p")].map((e) => [e.localName, e.textContent])).toEqual([
      ["h1", "A"],
      ["p", "B"],
    ]);
    // Every cell paragraph keeps its space after, the last one too.
    expect(merged.querySelector("p")?.style.marginBottom).toBe(`${160 / 15}px`);
    expect(rows[1]?.querySelectorAll("td")[1]?.innerHTML).toContain("<br>");
    const continued = rows[2]?.querySelectorAll("td");
    expect(continued?.[0]?.textContent).toBe("");
    expect(continued?.[1]?.style.borderBottom).toContain("dotted");
    expect(block).toMatchObject({ before: 0, after: 0, nodes: [0] });
  });

  it("formats opaque paragraphs: alignment, run properties, character styles; no deleted runs", () => {
    const xml = [
      '<w:tbl><w:tr><w:tc><w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:b/></w:rPr></w:pPr>',
      '<w:r><w:rPr><w:b/><w:i w:val="0"/><w:color w:val="FFFFFF"/><w:sz w:val="28"/><w:u w:val="single"/><w:highlight w:val="yellow"/></w:rPr><w:t>Head</w:t></w:r>',
      '<w:r><w:rPr><w:rStyle w:val="Strong"/><w:strike/></w:rPr><w:t>styled</w:t></w:r>',
      '<w:del w:id="1" w:author="A"><w:r><w:delText>gone</w:delText></w:r></w:del>',
      '<w:ins w:id="2" w:author="A"><w:r><w:t>new</w:t></w:r></w:ins>',
      "</w:p></w:tc></w:tr></w:tbl>",
    ].join("");
    const blocks = renderBlocks(
      documentOf([{ type: "opaqueBlock", attrs: { xml } }], {
        styles: [...STYLES, { id: "Strong", type: "character", run: [mark("italic")] }],
      }),
      document,
    );
    const paragraph = blocks[0]?.element.querySelector("p") as HTMLElement;
    expect(paragraph.style.textAlign).toBe("center");
    expect(paragraph.textContent).toBe("Headstylednew");
    const [head, styled, inserted] = [...paragraph.querySelectorAll("span")];
    expect(head?.style.fontWeight).toBe("700");
    expect(head?.style.fontStyle).toBe("normal");
    expect(head?.style.color).toBe("rgb(255, 255, 255)");
    expect(head?.style.fontSize).toBe("14pt");
    expect(head?.style.textDecorationLine).toBe("underline");
    expect(head?.style.backgroundColor).toBe("rgb(255, 255, 0)");
    expect(styled?.style.fontStyle).toBe("italic");
    expect(styled?.style.textDecorationLine).toBe("line-through");
    expect(inserted?.style.fontWeight).toBe("400");
  });

  it("reads tabs in runs, not a paragraph's tab stops", () => {
    const xml =
      '<w:sdt><w:sdtContent><w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t></w:r></w:p></w:sdtContent></w:sdt>';
    const [block] = render([{ type: "opaqueBlock", attrs: { xml } }]);
    expect(block?.element.textContent).toBe("a\tb");
  });

  it("shows other opaque blocks as their paragraphs, and unreadable ones as a placeholder", () => {
    const sdt =
      "<w:sdt><w:sdtContent><w:p><w:r><w:t>One</w:t></w:r></w:p><w:p><w:r><w:t>Two</w:t></w:r></w:p></w:sdtContent></w:sdt>";
    const [content, broken] = render([
      { type: "opaqueBlock", attrs: { xml: sdt } },
      { type: "opaqueBlock", attrs: { xml: "<w:sdt><unclosed>" } },
    ]);
    expect([...(content?.element.querySelectorAll("p") ?? [])].map((e) => e.textContent)).toEqual([
      "One",
      "Two",
    ]);
    expect(content?.after).toBeCloseTo(160 / 15);
    expect(content?.element.querySelector("p")?.style.marginBottom).toBe(`${160 / 15}px`);
    expect(broken?.element.childNodes).toHaveLength(0);
    expect(broken?.element.style.minHeight).toBe("1em");
  });

  it("shows opaque inline content as its text, or an empty placeholder", () => {
    const field =
      '<w:fldSimple w:instr="REF clause"><w:r><w:t>2.1</w:t></w:r><w:r><w:tab/></w:r></w:fldSimple>';
    const [block] = render([
      p(
        {},
        text("see "),
        { type: "opaqueInline", attrs: { xml: field, label: "Field" } },
        { type: "opaqueInline", attrs: { xml: "<w:drawing/>", label: "Picture", run: true } },
      ),
    ]);
    expect(block?.element.textContent).toBe("see 2.1\t");
    const placeholder = block?.element.querySelector("[data-foli-opaque]") as HTMLElement;
    expect(placeholder.dataset.foliOpaque).toBe("Picture");
  });

  it("parses opaque XML with its prefixes declared, inertly", () => {
    const element = parseOpaque(
      '<w:p w14:paraId="1" xml:space="preserve"><w:r><w:t>x</w:t></w:r></w:p>',
      document,
    );
    expect(element?.localName).toBe("p");
    expect(element?.textContent).toBe("x");
    expect(parseOpaque("<w:p>", document)).toBeNull();
    expect(parseOpaque("<script>alert(1)</script>", document)?.localName).toBe("script");
    expect(document.querySelector("script")).toBeNull();
  });
});
