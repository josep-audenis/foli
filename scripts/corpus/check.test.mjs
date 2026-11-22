import { describe, expect, it } from "vitest";
import { parseXml } from "../../packages/docx/src/xml.ts";
import { compareXml, firstDifference } from "./check.mjs";
import { runAll, summarize } from "./run.mjs";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const doc = (body, prefix = "w", ns = W) =>
  `<${prefix}:document ${ns.replace("xmlns:w", `xmlns:${prefix}`)}><${prefix}:body>${body}</${prefix}:body></${prefix}:document>`;

describe("the corpus run's comparison (20.2)", () => {
  it("counts prefixes, attribute order and whitespace as no difference", () => {
    const a = doc('<w:p><w:r><w:t xml:space="preserve">Hi</w:t></w:r></w:p>');
    const b = doc(
      `<x:p>\n  <x:r><x:t xml:space="preserve">Hi</x:t></x:r>\n</x:p>`.replaceAll("x:", "x:"),
      "x",
    );
    expect(compareXml(a, a, parseXml)).toBe(null);
    expect(compareXml(a, b, parseXml)).toEqual({ kind: "equivalent" });
  });

  it("names what was lost or changed, never the text", () => {
    const a = doc(
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Secret words</w:t></w:r></w:p>',
    );
    const b = doc('<w:p><w:r w:rsidR="00AB"><w:t>Secret</w:t></w:r></w:p>');
    const diff = compareXml(a, b, parseXml);
    expect(diff).toMatchObject({ kind: "content", textLost: 6, runs: 1 });
    expect(diff.lost).toEqual(["w:pPr", "w:jc"]);
    expect(diff.changed).toEqual(["w:jc@w:val"]);
    expect(JSON.stringify(diff)).not.toContain("Secret");
  });

  it("takes runs joined, Word's volatile marks and rsids as no difference; a format change as one", () => {
    const split = doc(
      '<w:p w:rsidR="1"><w:r w:rsidRPr="2"><w:rPr><w:b/></w:rPr><w:t>He</w:t></w:r><w:proofErr w:type="spellStart"/><w:r><w:rPr><w:b/></w:rPr><w:lastRenderedPageBreak/><w:t xml:space="preserve">llo</w:t></w:r></w:p>',
    );
    const joined = doc("<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Hello</w:t></w:r></w:p>");
    expect(compareXml(split, joined, parseXml)).toEqual({ kind: "equivalent" });
    const italic = doc("<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Hello</w:t></w:r></w:p>");
    expect(compareXml(joined, italic, parseXml)).toMatchObject({ kind: "content", runs: 1 });
  });

  it("sees what joining runs must not hide (20.4's review)", () => {
    const p = (...runs) => `<w:p>${runs.join("")}</w:p>`;
    const r = (inner, props = "") => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}${inner}</w:r>`;
    const eq = (x, y) => compareXml(doc(x), doc(y), parseXml)?.kind ?? "same";
    // An empty run dropped, as Foli does: nothing shown changed.
    expect(eq(p(r("<w:t>A</w:t>"), r("", "<w:b/>")), p(r("<w:t>A</w:t>")))).toBe("equivalent");
    // A page break become a line break; a field code become text; deleted text become text.
    expect(eq(p(r('<w:br w:type="page"/>')), p(r("<w:br/>")))).toBe("content");
    expect(eq(p(r("<w:instrText>PAGE</w:instrText>")), p(r("<w:t>PAGE</w:t>")))).toBe("content");
    expect(eq(p(r("<w:delText>x</w:delText>")), p(r("<w:t>x</w:t>")))).toBe("content");
    // Spaces Word keeps lost, and spaces Word drops anyway.
    expect(eq(p(r('<w:t xml:space="preserve">a </w:t>')), p(r("<w:t>a </w:t>")))).toBe("content");
    expect(eq(p(r("<w:t> a </w:t>")), p(r("<w:t>a</w:t>")))).toBe("equivalent");
    // A no-break space is text, not XML space: Word keeps it.
    expect(eq(p(r("<w:t>a </w:t>")), p(r("<w:t>a</w:t>")))).toBe("content");
    // A run moved into the next paragraph.
    const b = (t) => r(`<w:t>${t}</w:t>`, "<w:b/>");
    const i = (t) => r(`<w:t>${t}</w:t>`, "<w:i/>");
    expect(eq(p(b("A"), i("B")) + p(b("C")), p(b("A")) + p(i("B"), b("C")))).toBe("content");
  });

  it("sees a lost space, text of the same length, text moved, another namespace", () => {
    const space = compareXml(
      doc('<w:r><w:t xml:space="preserve">a </w:t></w:r>'),
      doc("<w:r><w:t>a</w:t></w:r>"),
      parseXml,
    );
    expect(space?.text).toEqual(["w:t"]);
    expect(compareXml(doc("<w:t>abc</w:t>"), doc("<w:t>xyz</w:t>"), parseXml)?.text).toEqual([
      "w:t",
    ]);
    const moved = compareXml(
      doc("<w:t>a</w:t><w:instrText>b</w:instrText>"),
      doc("<w:t>b</w:t><w:instrText>a</w:instrText>"),
      parseXml,
    );
    expect(moved?.text).toEqual(["w:t", "w:instrText"]);
    const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
    const other = compareXml(doc("<w:t>x</w:t>"), doc("<a:t>x</a:t>", "w", `${W} ${A}`), parseXml);
    expect(other).toMatchObject({ lost: ["w:t"], added: ["a:t"] });
  });

  it("gives the first differing key path, without values", () => {
    expect(firstDifference({ a: [1, { b: "x" }] }, { a: [1, { b: "y" }] })).toBe("/a/1/b");
    expect(firstDifference({ a: 1 }, { a: 1 })).toBe(null);
  });

  it("keeps files that kill their worker from stopping the run, each tried twice", async () => {
    const results = await runAll(
      ["a", "b"].map((n) => ({ sha256: n, names: [`${n}.docx`], path: `no/such/${n}.docx` })),
      { threads: 1, limits: { ms: 20_000, heapMb: 256 } },
    );
    expect(results.map((r) => [r.names[0], r.import])).toEqual([
      ["a.docx", "died"],
      ["b.docx", "died"],
    ]);
    expect(summarize(results).outcome).toEqual([["died", 2]]);
  });
});
