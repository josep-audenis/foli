// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  equationElement,
  LinearFormError,
  ommlToUnicodeMath,
  unicodeMathToOmml,
} from "./unicodemath.js";

/** Word's equation gallery's linear forms (Word 16), and a few of the corpus's. */
const FORMS = [
  "A=πr^2",
  "(x+a)^n=∑_(k=0)^n▒(n¦k) x^k a^(n-k)",
  "(1+x)^n=1+nx/1!+(n(n-1) x^2)/2!+⋯",
  "f(x)=a_0+∑_(n=1)^∞▒(a_n cos⁡(nπx/L)+b_n sin⁡(nπx/L))",
  "a^2+b^2=c^2",
  "x=(-b±√(b^2-4ac))/2a",
  "sin⁡α±sin⁡β=2sin⁡(1/2(α±β)) cos⁡(1/2(α∓β))",
  "[■(a&b@c&d)]",
  "√(3&x+1)",
  "x_i^2/2",
];

describe("an equation's linear form (35.5)", () => {
  it("reads Word's linear format into OMML and writes it back the same", () => {
    for (const form of FORMS) {
      const xml = unicodeMathToOmml(form);
      expect(xml, form).toMatch(/^<m:oMathPara><m:oMath>.*<\/m:oMath><\/m:oMathPara>$/s);
      expect(ommlToUnicodeMath(xml), form).toBe(form);
      expect(equationElement(xml), form).not.toBeNull();
    }
  });

  it("writes OMML as Word does", () => {
    const font = '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr>';
    const r = (t: string) => `<m:r>${font}<m:t>${t}</m:t></m:r>`;
    expect(unicodeMathToOmml("a/b", false)).toBe(
      `<m:oMath><m:f><m:num>${r("a")}</m:num><m:den>${r("b")}</m:den></m:f></m:oMath>`,
    );
    expect(unicodeMathToOmml("√x", false)).toBe(
      `<m:oMath><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${r("x")}</m:e></m:rad></m:oMath>`,
    );
    expect(unicodeMathToOmml("∑_k▒k", false)).toBe(
      `<m:oMath><m:nary><m:naryPr><m:chr m:val="∑"/><m:limLoc m:val="undOvr"/><m:supHide m:val="1"/></m:naryPr><m:sub>${r("k")}</m:sub><m:sup/><m:e>${r("k")}</m:e></m:nary></m:oMath>`,
    );
    expect(unicodeMathToOmml("sin⁡x", false)).toBe(
      `<m:oMath><m:func><m:fName><m:r><m:rPr><m:sty m:val="p"/></m:rPr>${font}<m:t>sin</m:t></m:r></m:fName><m:e>${r("x")}</m:e></m:func></m:oMath>`,
    );
    // Escaped, symbols by name.
    expect(unicodeMathToOmml(String.raw`a<b\pi`, false)).toContain("<m:t>a&lt;bπ</m:t>");
  });

  it("gives nothing for XML that is not an equation", () => {
    expect(ommlToUnicodeMath("<w:r/>")).toBe("");
    expect(equationElement("<w:r/>")).toBeNull();
  });
});

/** OMML's structure: its elements, text runs as their text, properties and fonts left out. */
const skeleton = (xml: string) =>
  xml
    .replace(/<w:rPr>.*?<\/w:rPr>/g, "")
    .replace(/<m:r>(?:<m:rPr>.*?<\/m:rPr>)?<m:t>(.*?)<\/m:t><\/m:r>/g, "'$1'")
    .replace(/<m:(\w+)Pr>.*?<\/m:\1Pr>/g, "")
    .replace(/<m:(\w+)\/>/g, "$1()")
    .replace(/<m:(\w+)>/g, "$1(")
    .replace(/<\/m:\w+>/g, ")");

describe("the linear form's structure, as Word builds it up (35.5 review)", () => {
  it("keeps Word's structures for the gallery's equations", () => {
    // Word's own OMML for the quadratic formula (the corpus's 13): no bracket in the numerator.
    expect(skeleton(unicodeMathToOmml("x=(-b±√(b^2-4ac))/2a", false))).toBe(
      "oMath('x='f(num('-b±'rad(deg()e(sSup(e('b')sup('2'))'-4ac')))den('2a')))",
    );
    // A binomial in an n-ary operator's argument.
    expect(unicodeMathToOmml("∑_(k=0)^n▒(n¦k)", false)).toContain(
      '<m:e><m:d><m:e><m:f><m:fPr><m:type m:val="noBar"/></m:fPr>',
    );
    // A factorial stays in the denominator.
    expect(skeleton(unicodeMathToOmml("x/1!", false))).toBe("oMath(f(num('x')den('1!')))");
    // A script on the run's last letter: πr^2 is π then r².
    expect(skeleton(unicodeMathToOmml("A=πr^2", false))).toBe("oMath('A=π'sSup(e('r')sup('2')))");
  });

  it("reads scripts on functions, repeated scripts, separators and any closing bracket", () => {
    expect(skeleton(unicodeMathToOmml("log_2⁡x", false))).toBe(
      "oMath(func(fName(sSub(e('log')sub('2')))e('x')))",
    );
    expect(skeleton(unicodeMathToOmml("x^2^3", false))).toBe(
      "oMath(sSup(e('x')sup(sSup(e('2')sup('3')))))",
    );
    expect(skeleton(unicodeMathToOmml("(a│b)", false))).toBe("oMath(d(e('a')e('b')))");
    // `)` is OMML's default closing bracket: only the opening one is written.
    expect(unicodeMathToOmml("[0,1)", false)).toContain(
      '<m:dPr><m:begChr m:val="["/></m:dPr><m:e>',
    );
    expect(unicodeMathToOmml("[0,1]", false)).toContain('<m:endChr m:val="]"/>');
    // Lines of a display equation, one m:oMath each.
    expect(unicodeMathToOmml("a=1\nb=2").match(/<m:oMath>/g)).toHaveLength(2);
  });

  it("refuses input nested deeper than an equation is", () => {
    expect(() => unicodeMathToOmml("(".repeat(5000))).toThrow(LinearFormError);
    expect(() => unicodeMathToOmml("√".repeat(5000))).toThrow(LinearFormError);
  });
});
