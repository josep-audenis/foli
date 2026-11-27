import { describe, expect, it } from "vitest";
import { createEditor } from "../state/index.js";
import { createDocument, parseDocument, SCHEMA_VERSION } from "./document.js";

const borders = { top: { style: "single", size: 4, space: 24 }, offsetFrom: "page" as const };

describe("page decoration (schema 9)", () => {
  it("needs schema 9 for a page color, page borders or line numbers", () => {
    expect(SCHEMA_VERSION).toBe(11);
    const plain = createDocument();
    expect(plain.schemaVersion).toBe(5);
    expect(createDocument(undefined, { pageBorders: borders }).schemaVersion).toBe(9);
    expect(createDocument(undefined, { lineNumbers: { countBy: 1 } }).schemaVersion).toBe(9);
    const colored = parseDocument({
      ...plain,
      schemaVersion: 9,
      settings: { background: { color: "FFF2CC", themeColor: "accent4", themeTint: "33" } },
    });
    expect(colored.schemaVersion).toBe(9);
    // A section break's setup counts too, and so does the one a tracked change recorded.
    const broken = parseDocument({
      ...plain,
      schemaVersion: 9,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: {
              section: {
                change: { id: 1, author: "A", previous: { lineNumbers: { countBy: 5 } } },
              },
            },
          },
          { type: "paragraph" },
        ],
      },
    });
    expect(broken.schemaVersion).toBe(9);
    // Saved by an editor: the version its content needs.
    expect(createEditor({ document: colored }).getDocument().schemaVersion).toBe(9);
  });

  it("refuses them in a document that says it is of an earlier schema", () => {
    const plain = createDocument();
    expect(() =>
      parseDocument({ ...plain, schemaVersion: 8, settings: { background: { color: "FF0000" } } }),
    ).toThrow(/settings\.background: is of schema 9 \(the document says schema 8\)/);
    expect(() =>
      parseDocument({ ...plain, schemaVersion: 8, section: { pageBorders: borders } }),
    ).toThrow(/section: pageBorders is of schema 9/);
    expect(() =>
      parseDocument({
        ...plain,
        schemaVersion: 7,
        content: {
          type: "doc",
          content: [
            { type: "paragraph", attrs: { section: { lineNumbers: { countBy: 2 } } } },
            { type: "paragraph" },
          ],
        },
      }),
    ).toThrow(/a section's lineNumbers is a schema 9 node/);
    // A schema 8 document without them is read as it is.
    expect(parseDocument({ ...plain, schemaVersion: 8 }).schemaVersion).toBe(5);
  });

  it("checks their values", () => {
    const doc = (section: object, settings?: object) => ({
      ...createDocument(),
      schemaVersion: 9,
      section,
      ...(settings ? { settings } : {}),
    });
    expect(() => parseDocument(doc({ pageBorders: { display: "sometimes" } }))).toThrow(/display/);
    expect(() => parseDocument(doc({ pageBorders: { left: { size: 4 } } }))).toThrow(/style/);
    expect(() => parseDocument(doc({ lineNumbers: { start: 1 } }))).toThrow(/countBy/);
    expect(() => parseDocument(doc({ lineNumbers: { countBy: 0 } }))).toThrow(/countBy/);
    expect(() => parseDocument(doc({}, { background: { color: "red" } }))).toThrow(/RRGGBB/);
    expect(() => parseDocument(doc({}, { background: { themeTint: "1" } }))).toThrow(/hex/);
  });
});

describe("suppressLineNumbers (schema 9)", () => {
  it("needs schema 9 in a paragraph or a style", () => {
    const plain = createDocument();
    const paragraph = parseDocument({
      ...plain,
      schemaVersion: 9,
      content: {
        type: "doc",
        content: [{ type: "paragraph", attrs: { suppressLineNumbers: true } }],
      },
    });
    expect(paragraph.schemaVersion).toBe(9);
    const styled = parseDocument({
      ...plain,
      schemaVersion: 9,
      styles: [
        ...plain.styles,
        { id: "X", type: "paragraph", paragraph: { suppressLineNumbers: true } },
      ],
    });
    expect(styled.schemaVersion).toBe(9);
    expect(() => parseDocument({ ...styled, schemaVersion: 8 })).toThrow(
      /suppressLineNumbers is of schema 9/,
    );
    expect(() => parseDocument({ ...paragraph, schemaVersion: 8 })).toThrow(/schema 9/);
  });
});

describe("a document of schema 8 adopts what its kept XML says (32.5 review)", () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  it("in styles, and not from a tracked change", () => {
    const plain = createDocument();
    const doc = parseDocument({
      ...plain,
      schemaVersion: 8,
      styles: [
        ...plain.styles,
        {
          id: "X",
          type: "paragraph",
          // As the importer keeps it: the whole element on the style.
          ext: `<w:style ${W} w:type="paragraph" w:styleId="X"><w:pPr><w:suppressLineNumbers/></w:pPr><w:rPr><w:b/></w:rPr></w:style>`,
        },
      ],
      section: {
        ext: `<w:sectPr ${W}><w:sectPrChange w:id="1" w:author="A"><w:sectPr><w:lnNumType w:countBy="2"/></w:sectPr></w:sectPrChange></w:sectPr>`,
      },
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: {
              ext: `<w:pPr ${W}><w:pPrChange w:id="2" w:author="A"><w:pPr><w:suppressLineNumbers/></w:pPr></w:pPrChange></w:pPr>`,
            },
          },
        ],
      },
    });
    expect(doc.styles.find((s) => s.id === "X")?.paragraph?.suppressLineNumbers).toBe(true);
    expect(doc.section.lineNumbers).toBeUndefined();
    expect(doc.content.content?.[0]?.attrs?.suppressLineNumbers ?? null).toBeNull();
    expect(doc.schemaVersion).toBe(9);
  });
});
