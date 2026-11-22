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
    expect(compareXml(a, b, parseXml)).toEqual({ kind: "order" });
  });

  it("names what was lost or changed, never the text", () => {
    const a = doc(
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Secret words</w:t></w:r></w:p>',
    );
    const b = doc('<w:p><w:r w:rsidR="00AB"><w:t>Secret</w:t></w:r></w:p>');
    const diff = compareXml(a, b, parseXml);
    expect(diff).toMatchObject({ kind: "content", textLost: 6 });
    expect(diff.lost).toEqual(["main:pPr", "main:jc"]);
    expect(diff.changed).toEqual(["main:jc@main:val", "main:r@main:rsidR"]);
    expect(JSON.stringify(diff)).not.toContain("Secret");
  });

  it("gives the first differing key path, without values", () => {
    expect(firstDifference({ a: [1, { b: "x" }] }, { a: [1, { b: "y" }] })).toBe("/a/1/b");
    expect(firstDifference({ a: 1 }, { a: 1 })).toBe(null);
  });

  it("keeps a file that kills its worker from stopping the run", async () => {
    const results = await runAll(
      [{ sha256: "x", names: ["missing.docx"], path: "no/such/file.docx" }],
      { threads: 1, limits: { ms: 20_000, heapMb: 256 } },
    );
    expect(results[0]).toMatchObject({ names: ["missing.docx"], import: "died" });
    expect(summarize(results).outcome).toEqual([["died", 1]]);
  });
});
