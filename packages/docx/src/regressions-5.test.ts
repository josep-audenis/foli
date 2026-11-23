// Regressions (Phase 21, 21.10: export correctness). Each test failed before its fix.
import { readFileSync } from "node:fs";
import { createDocument, createEditor, type FoliDocument, type NodeJSON } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { docPrIds } from "./export/pictures.js";
import { exportDocx, importDocx, readPackage } from "./index.js";
import { docx } from "./testing/package.js";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const load = (name: string) => importDocx(new Uint8Array(readFileSync(new URL(name, CORPUS))));
const settingsOf = async (bytes: Uint8Array) =>
  (await readPackage(bytes)).text("/word/settings.xml");

describe("21.10", () => {
  it("a new package says it is for Word 2013 and later, not compatibility mode", async () => {
    const settings = await settingsOf(await exportDocx(createDocument()));
    expect(settings).toContain(
      '<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>',
    );
  });

  it("writes doNotUseHTMLParagraphAutoSpacing into a settings part that lacks it", async () => {
    const { document, package: pkg } = await load("01-mutual-nda.docx");
    const before = await settingsOf(await exportDocx(document, pkg));
    expect(before).not.toContain("doNotUseHTMLParagraphAutoSpacing");
    const spaced = {
      ...document,
      settings: { ...document.settings, doNotUseHTMLParagraphAutoSpacing: true },
    };
    const bytes = await exportDocx(spaced, pkg);
    const after = await settingsOf(bytes);
    // Inside the one w:compat, before its compatSetting elements.
    expect(after.match(/<w:compat>/g)).toHaveLength(1);
    expect(after.indexOf("doNotUseHTMLParagraphAutoSpacing")).toBeLessThan(
      after.indexOf("compatSetting") === -1
        ? Number.POSITIVE_INFINITY
        : after.indexOf("compatSetting"),
    );
    expect((await importDocx(bytes)).document.settings?.doNotUseHTMLParagraphAutoSpacing).toBe(
      true,
    );
  });

  it("makes a related part the package lacks where the relationship points, related once", async () => {
    const bytes = await docx(`<w:p><w:r><w:t>Text</w:t></w:r></w:p>`, {
      rels: `<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>`,
    });
    const { document, package: pkg } = await importDocx(bytes);
    const editor = createEditor({ document, author: "A" });
    editor.select(1, 5);
    editor.commands.addComment("Note");
    const out = await readPackage(await exportDocx(editor.getDocument(), pkg));
    const rels = out.text("/word/_rels/document.xml.rels");
    expect(rels.match(/relationships\/comments"/g)).toHaveLength(1);
    expect(out.part("/word/comments.xml")).toBeDefined();
    expect(
      (await importDocx(await exportDocx(editor.getDocument(), pkg))).document.comments,
    ).toHaveLength(1);
  });

  it("reads xml:space=preserve inherited from a paragraph", async () => {
    const { document } = await importDocx(
      await docx(`<w:p xml:space="preserve"><w:r><w:t> a </w:t></w:r></w:p>`),
    );
    const texts = (document.content.content?.[0]?.content ?? []).map((n: NodeJSON) => n.text);
    expect(texts.join("")).toBe(" a ");
  });

  it("writes one border for a side a cell names both left and start", async () => {
    const cell = (borders: Record<string, unknown>): NodeJSON => ({
      type: "tableCell",
      attrs: { borders },
      content: [{ type: "paragraph" }],
    });
    const line = { style: "single", size: 4 };
    const document: FoliDocument = createDocument({
      type: "doc",
      content: [
        {
          type: "table",
          attrs: { grid: [2000] },
          content: [{ type: "tableRow", content: [cell({ left: line, start: line, end: line })] }],
        },
        { type: "paragraph" },
      ],
    });
    const xml = (await readPackage(await exportDocx(document))).text("/word/document.xml");
    const borders = xml.match(/<w:tcBorders>.*?<\/w:tcBorders>/)?.[0] ?? "";
    expect(borders).toContain("<w:left ");
    expect(borders).not.toContain("<w:start ");
    expect(borders).toContain("<w:end ");
  });

  it("finds wp:docPr ids in single quotes", () => {
    expect(docPrIds(`<wp:docPr id='12' name="a"/><docPr name="b" id = "13"/>`)).toEqual([12, 13]);
  });
});
