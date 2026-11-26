import type { NodeJSON } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx, readPackage } from "./index.js";
import { docx } from "./testing/package.js";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
const DECLARED = `xmlns:mc="${MC}" xmlns:w="${W}" xmlns:w14="${W14}" xmlns:z="urn:made-up"`;
const SECT = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>';
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const doc = (inner: string, before = "") =>
  `<w:document>${before}<w:body>${inner}${SECT}</w:body></w:document>`;
const root = (branches: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><mc:AlternateContent ${DECLARED}>${branches}</mc:AlternateContent>`;
const choice = (requires: string, inner: string) =>
  `<mc:Choice Requires="${requires}">${inner}</mc:Choice>`;
const fallback = (inner: string) => `<mc:Fallback>${inner}</mc:Fallback>`;

const texts = (node: { content?: readonly NodeJSON[] }): string[] =>
  (node.content ?? []).flatMap((n) =>
    n.type === "paragraph"
      ? [(n.content ?? []).map((c) => (c.type === "text" ? c.text : "")).join("")]
      : texts(n),
  );
const read = async (rootXml: string, parts?: Record<string, string>, rels?: string) => {
  const result = await importDocx(await docx("", { root: rootXml, parts, rels }));
  return { ...result, texts: texts(result.document.content).filter(Boolean) };
};

describe("a document whose root is mc:AlternateContent, read as Word reads it", () => {
  it("takes the choice whose namespaces it understands", async () => {
    const { texts: got, report } = await read(
      root(choice("w14", doc(p("CHOICE"))) + fallback(doc(p("FALLBACK")))),
    );
    expect(got).toEqual(["CHOICE"]);
    expect(report.dropped).toMatchObject({ "mc:Fallback (root)": 1 });
  });

  it("takes the fallback when it does not, and nothing when there is none", async () => {
    expect(
      (await read(root(choice("z", doc(p("CHOICE"))) + fallback(doc(p("FALLBACK")))))).texts,
    ).toEqual(["FALLBACK"]);
    expect((await read(root(choice("z", doc(p("CHOICE")))))).texts).toEqual([]);
    expect((await read(root(fallback(doc(p("ONLY")))))).texts).toEqual(["ONLY"]);
  });

  it("joins the documents of a branch, keeping the last section and the first background", async () => {
    const { document, package: pkg } = await read(
      root(
        choice("w14", doc(p("FIRST"), '<w:background w:color="FF0000"/>') + doc(p("SECOND"))) +
          fallback(doc(p("FALLBACK"))),
      ),
    );
    expect(texts(document.content).filter(Boolean)).toEqual(["FIRST", "SECOND"]);
    const text = pkg.text(pkg.mainDocument);
    expect(text.match(/<w:sectPr>/g)).toHaveLength(1);
    expect(text).toContain('<w:background w:color="FF0000"/>');
    expect(text).toMatch(/^<\?xml[^>]*\?><w:document xmlns:mc=/);
  });

  it("reads a bare body or bare paragraphs in a branch, and drops what else it holds", async () => {
    expect(await read(root(choice("w14", `<w:body>${p("BODY")}</w:body>`)))).toMatchObject({
      texts: ["BODY"],
    });
    expect(await read(root(choice("w14", p("ONE") + p("TWO"))))).toMatchObject({
      texts: ["ONE", "TWO"],
    });
    const { texts: got, report } = await read(
      root(choice("w14", `${doc(p("DOCUMENT"))}<w:hdr>${p("HEADER")}</w:hdr>`)),
    );
    expect(got).toEqual(["DOCUMENT"]);
    expect(report.dropped).toMatchObject({ "w:hdr (in mc:Choice)": 1 });
  });

  it("reads another part's mc:AlternateContent root: its branch's first element", async () => {
    const rels =
      '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>';
    const footnotes = root(
      choice(
        "w14",
        `<w:footnotes><w:footnote w:type="separator" w:id="-1">${p("")}</w:footnote><w:footnote w:id="1">${p("NOTE")}</w:footnote></w:footnotes>`,
      ) + fallback("<w:footnotes/>"),
    );
    const body = `<w:p><w:r><w:t>Text</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>`;
    const bytes = await docx(body, { parts: { "word/footnotes.xml": footnotes }, rels });
    const { document, package: pkg } = await importDocx(bytes);
    expect(JSON.stringify(document)).toContain("NOTE");
    const again = await importDocx(await exportDocx(document, pkg));
    expect(JSON.stringify(again.document)).toContain("NOTE");
  });

  it("refuses an unknown root, naming it", async () => {
    await expect(
      importDocx(await docx("", { root: `<w:madeUp xmlns:w="${W}">${p("X")}</w:madeUp>` })),
    ).rejects.toThrow(/not a WordprocessingML document \(its root is <w:madeUp>\)/);
  });

  it("exports an unchanged part as it was, and an edited one with a w:document root", async () => {
    const original = root(choice("w14", doc(p("CHOICE"))) + fallback(doc(p("FALLBACK"))));
    const { document, package: pkg } = await importDocx(await docx("", { root: original }));
    const same = await readPackage(await exportDocx(document, pkg));
    expect(new TextDecoder().decode(same.part(same.mainDocument)?.data)).toBe(original);
    const edited = structuredClone(document);
    const run = edited.content.content?.[0]?.content?.[0];
    if (run?.type !== "text") throw new Error("no text");
    run.text = "EDITED";
    const out = await readPackage(await exportDocx(edited, pkg));
    const text = new TextDecoder().decode(out.part(out.mainDocument)?.data);
    expect(text).toMatch(/<w:document /);
    expect(text).not.toContain("AlternateContent");
    expect(texts((await importDocx(await exportDocx(edited, pkg))).document.content)).toContain(
      "EDITED",
    );
  });
});
