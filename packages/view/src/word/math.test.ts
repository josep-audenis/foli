// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseOpaque } from "./blocks.js";
import { mathElement, mathText } from "./math.js";

/** MathML as a compact string: tags and text. */
function shape(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  const element = node as Element;
  return `<${element.localName}>${[...element.childNodes].map(shape).join("")}</${element.localName}>`;
}
const r = (text: string, sty?: string) =>
  `<m:r>${sty ? `<m:rPr><m:sty m:val="${sty}"/></m:rPr>` : ""}<w:rPr><w:rFonts w:ascii="Cambria Math"/></w:rPr><m:t>${text}</m:t></m:r>`;
const math = (xml: string) => {
  const omml = parseOpaque(xml, document) as Element;
  return mathElement(omml, document) as Element;
};

describe("OMML as MathML (35.4)", () => {
  it("draws runs as identifiers, numbers and operators, Word's hyphen as minus", () => {
    const m = math(`<m:oMath>${r("x=-2ab")}${r("sin", "p")}</m:oMath>`);
    expect(shape(m)).toBe(
      "<math><mi>x</mi><mo>=</mo><mo>−</mo><mn>2</mn><mi>a</mi><mi>b</mi><mi>s</mi><mi>i</mi><mi>n</mi></math>",
    );
    expect(m.getAttribute("display")).toBeNull();
    expect(m.getAttribute("alttext")).toBe("x=-2absin");
    expect(m.querySelector("mi:last-child")?.getAttribute("mathvariant")).toBe("normal");
  });

  it("draws fractions, scripts, radicals, n-ary operators, delimiters and matrices", () => {
    const xml =
      "<m:oMathPara><m:oMath>" +
      `<m:f><m:num>${r("a")}</m:num><m:den>${r("b")}</m:den></m:f>` +
      `<m:f><m:fPr><m:type m:val="noBar"/></m:fPr><m:num>${r("n")}</m:num><m:den>${r("k")}</m:den></m:f>` +
      `<m:sSubSup><m:e>${r("x")}</m:e><m:sub>${r("i")}</m:sub><m:sup>${r("2")}</m:sup></m:sSubSup>` +
      `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${r("y")}</m:e></m:rad>` +
      `<m:rad><m:deg>${r("3")}</m:deg><m:e>${r("z")}</m:e></m:rad>` +
      `<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub>${r("k")}</m:sub><m:sup>${r("n")}</m:sup><m:e>${r("k")}</m:e></m:nary>` +
      `<m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr><m:e><m:m><m:mr><m:e>${r("a")}</m:e><m:e>${r("b")}</m:e></m:mr></m:m></m:e></m:d>` +
      "</m:oMath></m:oMathPara>";
    const m = math(xml);
    expect(m.getAttribute("display")).toBe("block");
    expect(shape(m)).toBe(
      "<math><mfrac><mi>a</mi><mi>b</mi></mfrac><mfrac><mi>n</mi><mi>k</mi></mfrac>" +
        "<msubsup><mi>x</mi><mi>i</mi><mn>2</mn></msubsup><msqrt><mi>y</mi></msqrt>" +
        "<mroot><mi>z</mi><mn>3</mn></mroot><munderover><mo>∑</mo><mi>k</mi><mi>n</mi></munderover><mi>k</mi>" +
        "<mrow><mo>[</mo><mtable><mtr><mtd><mi>a</mi></mtd><mtd><mi>b</mi></mtd></mtr></mtable><mo>]</mo></mrow></math>",
    );
    expect(m.querySelectorAll("mfrac")[1]?.getAttribute("linethickness")).toBe("0");
    expect(mathText(parseOpaque(xml, document) as Element)).toBe("abnkxi2y3zknkab");
  });

  it("refuses what is not an equation", () => {
    expect(
      mathElement(parseOpaque("<w:r><w:t>a</w:t></w:r>", document) as Element, document),
    ).toBeNull();
  });
});
