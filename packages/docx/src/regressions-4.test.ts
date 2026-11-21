/** Bugs found by review (fourth sweep), each kept as the test that showed it. */
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx, readPackage } from "./index.js";
import { docx } from "./testing/package.js";
import { parseXml } from "./xml.js";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** A body using kept-attribute paths, its elements under `x` ("" = default), attributes under `q`. */
function body(x: string, q = x): string {
  const w = (name: string) => (x ? `${x}:${name}` : name);
  const a = (name: string) => `${q}:${name}`;
  return (
    `<${w("p")} ${a("rsidR")}="00AB12CD"><${w("pPr")}><${w("jc")} ${a("val")}="center"/></${w("pPr")}>` +
    `<${w("bookmarkStart")} ${a("id")}="1" ${a("name")}="b" ${a("colFirst")}="0"/>` +
    `<${w("r")} ${a("rsidR")}="00AB12CD"><${w("t")}>a</${w("t")}></${w("r")}>` +
    `<${w("bookmarkEnd")} ${a("id")}="1"/>` +
    `<${w("fldSimple")} ${a("instr")}=" PAGE " ${a("dirty")}="true"><${w("r")}><${w("t")}>1</${w("t")}></${w("r")}></${w("fldSimple")}>` +
    `<${w("hyperlink")} ${a("anchor")}="b" ${a("history")}="1"><${w("r")}><${w("t")}>l</${w("t")}></${w("r")}></${w("hyperlink")}>` +
    `<${w("ins")} ${a("id")}="2" ${a("author")}="A" ${a("date")}="2024-01-01T00:00:00Z"><${w("r")}><${w("t")}>i</${w("t")}></${w("r")}></${w("ins")}>` +
    `</${w("p")}>`
  );
}
const root = (x: string) =>
  x
    ? `<${x}:document xmlns:${x}="${W_NS}"><${x}:body>${body(x)}</${x}:body></${x}:document>`
    : `<document xmlns="${W_NS}" xmlns:q="${W_NS}"><body>${body("", "q")}</body></document>`;

describe("a document binding WordprocessingML to a prefix other than w", () => {
  for (const [name, x] of [
    ["another prefix", "x"],
    ["the default namespace", ""],
  ] as const) {
    it(`${name}: kept attributes export well-formed and read back the same`, async () => {
      const first = await importDocx(await docx("", { root: root(x) }));
      const bytes = await exportDocx(first.document, first.package);
      const out = await readPackage(bytes);
      expect(() => parseXml(out.text("/word/document.xml"))).not.toThrow();
      const again = await importDocx(bytes);
      expect(again.document.content).toEqual(first.document.content);
    });
  }
});
