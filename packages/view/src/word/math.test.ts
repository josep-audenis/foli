// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseOpaque } from "./blocks.js";
import { mathElement } from "./math.js";

/** MathML as a compact string: tags, the attributes asked for, and text. */
function shape(node: Node, keep: readonly string[] = []): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  const element = node as Element;
  const attrs = keep
    .filter((a) => element.hasAttribute(a))
    .map((a) => ` ${a}="${element.getAttribute(a)}"`)
    .join("");
  const inner = [...element.childNodes].map((c) => shape(c, keep)).join("");
  return `<${element.localName}${attrs}>${inner}</${element.localName}>`;
}
const font = '<w:rPr><w:rFonts w:ascii="Cambria Math"/></w:rPr>';
const r = (text: string, props = "") =>
  `<m:r>${props ? `<m:rPr>${props}</m:rPr>` : ""}${font}<m:t>${text}</m:t></m:r>`;
const math = (inner: string, para = false) => {
  const xml = para
    ? `<m:oMathPara><m:oMath>${inner}</m:oMath></m:oMathPara>`
    : `<m:oMath>${inner}</m:oMath>`;
  return mathElement(parseOpaque(xml, document) as Element, document) as Element;
};
/** The MathML inside `<math>` only. */
const body = (inner: string, keep?: readonly string[]) =>
  shape(math(inner), keep).replace(/^<math>|<\/math>$/g, "");

describe("OMML as MathML (35.4)", () => {
  it("draws runs as identifiers, numbers and operators, Word's hyphen as minus", () => {
    expect(body(r("x=-2a⋅b'"))).toBe(
      "<mi>x</mi><mo>=</mo><mo>−</mo><mn>2</mn><mi>a</mi><mo>⋅</mo><mi>b</mi><mo>′</mo>",
    );
    // An upright run (a function's name) is one identifier.
    expect(body(r("sin", '<m:sty m:val="p"/>'), ["mathvariant"])).toBe(
      '<mi mathvariant="normal">sin</mi>',
    );
    // Normal text.
    expect(body(r("if", "<m:nor/>"))).toBe("<mtext>if</mtext>");
  });

  it("draws styled letters as Unicode's mathematical ones", () => {
    expect(body(r("x", '<m:sty m:val="b"/>'))).toBe("<mi>\u{1d431}</mi>");
    expect(body(r("R", '<m:scr m:val="double-struck"/><m:sty m:val="p"/>'))).toBe("<mi>ℝ</mi>");
    expect(body(r("F", '<m:scr m:val="script"/>'))).toBe("<mi>ℱ</mi>");
    expect(body(r("2", '<m:sty m:val="b"/>'))).toBe("<mn>\u{1d7d0}</mn>");
  });

  it("draws fractions, scripts and radicals, a degree only when there is one", () => {
    expect(
      body(
        `<m:f><m:num>${r("a")}</m:num><m:den>${r("b")}</m:den></m:f>` +
          `<m:f><m:fPr><m:type m:val="lin"/></m:fPr><m:num>${r("c")}</m:num><m:den>${r("d")}</m:den></m:f>` +
          `<m:sSubSup><m:e>${r("x")}</m:e><m:sub>${r("i")}</m:sub><m:sup>${r("2")}</m:sup></m:sSubSup>` +
          `<m:sPre><m:sub>${r("1")}</m:sub><m:sup>${r("2")}</m:sup><m:e>${r("X")}</m:e></m:sPre>` +
          `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${r("y")}</m:e></m:rad>` +
          `<m:rad><m:deg><m:ctrlPr/></m:deg><m:e>${r("y")}</m:e></m:rad>` +
          `<m:rad><m:deg>${r("3")}</m:deg><m:e>${r("z")}</m:e></m:rad>`,
      ),
    ).toBe(
      "<mfrac><mi>a</mi><mi>b</mi></mfrac><mi>c</mi><mo>/</mo><mi>d</mi>" +
        "<msubsup><mi>x</mi><mi>i</mi><mn>2</mn></msubsup>" +
        "<mmultiscripts><mi>X</mi><mprescripts></mprescripts><mn>1</mn><mn>2</mn></mmultiscripts>" +
        "<msqrt><mi>y</mi></msqrt><msqrt><mi>y</mi></msqrt><mroot><mi>z</mi><mn>3</mn></mroot>",
    );
  });

  it("puts n-ary limits as Word does: integrals beside, others under and over", () => {
    const nary = (chr: string | null, more = "") =>
      `<m:nary><m:naryPr>${chr ? `<m:chr m:val="${chr}"/>` : ""}${more}</m:naryPr><m:sub>${r("a")}</m:sub><m:sup>${r("b")}</m:sup><m:e>${r("f")}</m:e></m:nary>`;
    expect(body(nary(null))).toMatch(/^<msubsup><mo>∫<\/mo>/);
    expect(body(nary("∬"))).toMatch(/^<msubsup><mo>∬<\/mo>/);
    expect(body(nary("∑"))).toMatch(/^<munderover><mo>∑<\/mo>/);
    expect(body(nary("∑", '<m:limLoc m:val="subSup"/>'))).toMatch(/^<msubsup>/);
    // Hidden or empty limits are not drawn.
    expect(
      body(
        `<m:nary><m:naryPr><m:chr m:val="∑"/><m:supHide m:val="1"/></m:naryPr><m:sub>${r("k")}</m:sub><m:sup/><m:e>${r("k")}</m:e></m:nary>`,
      ),
    ).toBe("<munder><mo>∑</mo><mi>k</mi></munder><mi>k</mi>");
  });

  it("draws delimiters with their separator, functions, limits, accents, bars, group characters", () => {
    expect(
      body(
        `<m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val=""/><m:sepChr m:val=";"/></m:dPr><m:e>${r("a")}</m:e><m:e>${r("b")}</m:e></m:d>`,
      ),
    ).toBe("<mrow><mo>[</mo><mi>a</mi><mo>;</mo><mi>b</mi></mrow>");
    expect(
      body(
        `<m:func><m:fName><m:limLow><m:e>${r("lim", '<m:sty m:val="p"/>')}</m:e><m:lim>${r("n")}</m:lim></m:limLow></m:fName><m:e>${r("a")}</m:e></m:func>`,
      ),
    ).toBe("<munder><mi>lim</mi><mi>n</mi></munder><mo>⁡</mo><mi>a</mi>");
    expect(body(`<m:limUpp><m:e>${r("a")}</m:e><m:lim>${r("b")}</m:lim></m:limUpp>`)).toBe(
      "<mover><mi>a</mi><mi>b</mi></mover>",
    );
    expect(body(`<m:acc><m:e>${r("x")}</m:e></m:acc>`, ["accent"])).toBe(
      '<mover accent="true"><mi>x</mi><mo>ˆ</mo></mover>',
    );
    expect(body(`<m:acc><m:accPr><m:chr m:val="⃗"/></m:accPr><m:e>${r("v")}</m:e></m:acc>`)).toBe(
      "<mover><mi>v</mi><mo>→</mo></mover>",
    );
    expect(body(`<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${r("x")}</m:e></m:bar>`)).toBe(
      "<mover><mi>x</mi><mo>¯</mo></mover>",
    );
    expect(body(`<m:bar><m:e>${r("x")}</m:e></m:bar>`)).toBe(
      "<munder><mi>x</mi><mo>¯</mo></munder>",
    );
    expect(body(`<m:groupChr><m:e>${r("x")}</m:e></m:groupChr>`)).toBe(
      "<munder><mi>x</mi><mo>⏟</mo></munder>",
    );
  });

  it("draws matrices, and equation arrays without their alignment marks", () => {
    expect(body(`<m:m><m:mr><m:e>${r("a")}</m:e><m:e>${r("b")}</m:e></m:mr></m:m>`)).toBe(
      "<mtable><mtr><mtd><mi>a</mi></mtd><mtd><mi>b</mi></mtd></mtr></mtable>",
    );
    expect(body(`<m:eqArr><m:e>${r("x&amp;=1")}</m:e><m:e>${r("y&amp;=2")}</m:e></m:eqArr>`)).toBe(
      "<mtable><mtr><mtd><mrow><mi>x</mi><mo>=</mo><mn>1</mn></mrow></mtd></mtr><mtr><mtd><mrow><mi>y</mi><mo>=</mo><mn>2</mn></mrow></mtd></mtr></mtable>",
    );
  });

  it("hides a hidden phantom, and leaves out text a tracked change deleted", () => {
    expect(
      body(`<m:phant><m:phantPr><m:show m:val="0"/></m:phantPr><m:e>${r("x")}</m:e></m:phant>`),
    ).toBe("<mphantom><mi>x</mi></mphantom>");
    expect(
      body(`<m:phant><m:phantPr><m:zeroWid/></m:phantPr><m:e>${r("x")}</m:e></m:phant>`, ["width"]),
    ).toBe('<mpadded width="0"><mi>x</mi></mpadded>');
    expect(body(`${r("a")}<w:del w:id="1" w:author="A">${r("q")}</w:del>`)).toBe("<mi>a</mi>");
  });

  it("makes a display equation a block, and is not a place to type or press", () => {
    const m = math(r("x"), true);
    expect(m.getAttribute("display")).toBe("block");
    expect(m.getAttribute("style")).toContain("user-select: none");
    expect(math(r("x")).getAttribute("display")).toBeNull();
  });

  it("refuses what is not an equation", () => {
    expect(
      mathElement(parseOpaque("<w:r><w:t>a</w:t></w:r>", document) as Element, document),
    ).toBeNull();
  });
});
