import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createDocument, type FoliDocument, parseDocument } from "../document.js";
import type { MarkJSON, NodeJSON } from "../model/index.js";
import type { DocJSON } from "../schema.js";
import { type FoliDocumentV3, parseContentV3, parseDocumentV3 } from "./document.js";
import { migrateToV3 } from "./migrate.js";
import { schemaV3 } from "./schema.js";
import { mmToTwips, twipsToMm } from "./units.js";

const paragraph = (attrs: Record<string, unknown>, content?: NodeJSON[]): NodeJSON => ({
  type: "paragraph",
  ...(Object.keys(attrs).length ? { attrs } : {}),
  ...(content ? { content } : {}),
});
const doc = (...content: NodeJSON[]): NodeJSON => ({ type: "doc", content });
const parse = (json: NodeJSON) => parseContentV3(json).toJSON();
const withMark = (mark: unknown) =>
  doc(paragraph({}, [{ type: "text", text: "x", marks: [mark as MarkJSON] }]));

function v3(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 3,
    section: {
      pageSize: { width: 11906, height: 16838 },
      margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
    },
    defaults: {},
    styles: [],
    numbering: { abstracts: [], instances: [] },
    comments: [],
    content: doc({ type: "paragraph" }),
    ...overrides,
  };
}

const rev = (id: number, author = "A") => ({ id, author });

describe("schema v3 content", () => {
  it("keeps Word's paragraph properties, omitting unset ones", () => {
    const attrs = {
      style: "Heading1",
      justification: "both",
      indent: { left: -720, hanging: 360 },
      spacing: { before: 240, after: 120, line: 276, lineRule: "auto" },
      keepNext: true,
      widowControl: false,
      outlineLevel: 0,
      numbering: { id: 3, level: 1 },
      tabs: [{ position: 9026, kind: "right", leader: "dot" }],
      borders: { bottom: { style: "single", size: 6, space: 1, color: "auto" } },
      shading: { pattern: "clear", fill: "D9E2F3" },
      markFormat: [{ type: "bold" }],
      ext: "<w:pPr><w:suppressAutoHyphens/></w:pPr>",
      section: {
        pageSize: { width: 16838, height: 11906, orientation: "landscape" },
        margins: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708 },
      },
      revision: {
        insertion: rev(4, "Alice Martin"),
        deletion: { ...rev(5), date: "2026-11-09T10:00:00Z" },
      },
      formatChange: { id: 5, author: "Bob Chen", previous: { justification: "left" } },
      attributes: { "w14:paraId": "1A2B3C4D", "w:rsidR": "00AB12CD" },
    };
    const json = doc(paragraph(attrs, [{ type: "text", text: "x" }]), { type: "paragraph" });
    expect(parse(json)).toEqual(json);
    // A paragraph with nothing set has no attrs.
    expect(parse(doc(paragraph({ style: null, keepNext: null })))).toEqual(
      doc({ type: "paragraph" }),
    );
  });

  it("accepts what Word accepts", () => {
    const accepted: Record<string, unknown>[] = [
      // A style's numbering often has only the instance, a demoted item only the level.
      { numbering: { id: 3 } },
      { numbering: { level: 1 } },
      // Both: Word applies the hanging indent.
      { indent: { firstLine: 10, hanging: 10 } },
      // A section break with Word's default page.
      { section: {} },
      { section: { margins: { left: 1000 } } },
      // An anonymous reviewer.
      { revision: { insertion: rev(1, "") } },
      { formatChange: { id: 1, author: "", previous: {} } },
    ];
    for (const attrs of accepted) {
      expect(() => parseContentV3(doc(paragraph(attrs))), JSON.stringify(attrs)).not.toThrow();
    }
    const marks: unknown[] = [
      // Any target the file has: whether it may be opened is decided where it is opened.
      { type: "link", attrs: { href: "file:///S:/Contracts/annex.docx" } },
      { type: "link", attrs: { href: "\\\\server\\share\\x.docx" } },
      { type: "font", attrs: { ascii: "A font name longer than thirty-one characters" } },
      { type: "fontSize", attrs: { complexScript: 22 } },
      { type: "bold", attrs: { value: null, complexScript: true } },
      { type: "insertion", attrs: { id: 1, author: "", move: "move1" } },
    ];
    for (const mark of marks) {
      expect(() => parseContentV3(withMark(mark)), JSON.stringify(mark)).not.toThrow();
    }
  });

  it("rejects what the engine cannot work with", () => {
    const bad: [Record<string, unknown>, RegExp][] = [
      [{ justification: "middle" }, /justification: must be one of/],
      [{ indent: {} }, /must not be empty/],
      [{ indent: { left: 1.5 } }, /left must be an integer/],
      [{ indent: { top: 1 } }, /unknown key top/],
      [{ numbering: {} }, /must not be empty/],
      [{ numbering: { id: 1, level: 9 } }, /level must be an integer from 0 to 8/],
      [{ tabs: [{ position: 10, kind: "middle" }] }, /\[0\] kind must be one of/],
      [
        { borders: { bottom: { style: "single", size: 97 } } },
        /size must be an integer from 0 to 96/,
      ],
      [{ borders: { bottom: { style: "<b>" } } }, /style must be a Word token/],
      [{ shading: { pattern: "clear", fill: "#ffffff" } }, /fill must be RRGGBB or auto/],
      [{ markFormat: [{ type: "bold" }, { type: "bold" }] }, /duplicate mark/],
      [{ markFormat: [{ type: "insertion", attrs: rev(1) }] }, /insertion is not a run property/],
      [{ section: { pageSize: { width: 0, height: 10 } } }, /width must be an integer from 1/],
      [{ revision: { moved: rev(1) } }, /unknown key moved/],
      [{ revision: { insertion: { ...rev(1), date: "yesterday" } } }, /ISO 8601/],
      [
        { formatChange: { id: 1, author: "A", previous: { justification: "middle" } } },
        /previous justification must be one of/,
      ],
      [
        { formatChange: { id: 1, author: "A", previous: { section: {} } } },
        /previous unknown key section/,
      ],
      [{ attributes: { "not a name": "x" } }, /is not an attribute name/],
      [{ attributes: { "w:x": 1 } }, /w:x must be a string/],
      [{ ext: "" }, /must be an XML string/],
      [{ outline: 1 }, /unknown attribute/],
    ];
    for (const [attrs, message] of bad) {
      expect(() => parseContentV3(doc(paragraph(attrs))), JSON.stringify(attrs)).toThrow(message);
    }
  });

  it("never looks up inherited keys (untrusted input)", () => {
    const cases: [string, RegExp][] = [
      ['{"indent":{"__proto__":1}}', /unknown key __proto__/],
      ['{"indent":{"isPrototypeOf":1}}', /unknown key isPrototypeOf/],
      ['{"indent":{"hasOwnProperty":1}}', /unknown key hasOwnProperty/],
      ['{"spacing":{"valueOf":1}}', /unknown key valueOf/],
      ['{"section":{"constructor":{}}}', /unknown key constructor/],
      ['{"formatChange":{"id":1,"author":"A","previous":{"toString":5}}}', /unknown key toString/],
      [
        '{"formatChange":{"id":1,"author":"A","previous":{"__proto__":{"style":"x"}}}}',
        /unknown key __proto__/,
      ],
    ];
    for (const [attrs, message] of cases) {
      expect(() => parseContentV3(doc(paragraph(JSON.parse(attrs)))), attrs).toThrow(message);
    }
    const style = JSON.parse(
      '{"id":"A","type":"paragraph","paragraph":{"__proto__":{"polluted":1}}}',
    );
    expect(() => parseDocumentV3(v3({ styles: [style] }))).toThrow(/unknown key __proto__/);
    expect(() => parseDocumentV3(v3({ defaults: JSON.parse('{"constructor":1}') }))).toThrow(
      /unknown key constructor/,
    );
  });

  it("keeps Word's run properties as marks, in canonical order", () => {
    const marks = [
      {
        type: "link",
        attrs: {
          href: "https://example.com",
          tooltip: "Example",
          attributes: { "w:history": "1" },
        },
      },
      { type: "insertion", attrs: { id: 1, author: "A", date: "2026-11-09T10:00" } },
      { type: "deletion", attrs: { id: 2, author: "B", move: "move1" } },
      { type: "characterStyle", attrs: { id: "Emphasis" } },
      { type: "bold", attrs: { value: false, complexScript: false } },
      { type: "italic" },
      { type: "underline", attrs: { style: "double", color: "FF0000" } },
      { type: "strike" },
      { type: "doubleStrike" },
      { type: "caps" },
      { type: "smallCaps" },
      { type: "hidden" },
      {
        type: "font",
        attrs: { ascii: "Calibri", hAnsi: "Calibri", csTheme: "minorBidi", hint: "eastAsia" },
      },
      { type: "fontSize", attrs: { value: 22, complexScript: 22 } },
      { type: "color", attrs: { value: "1F3864", themeColor: "accent1", themeShade: "80" } },
      { type: "highlight", attrs: { value: "yellow" } },
      { type: "shading", attrs: { pattern: "clear", fill: "D9E2F3" } },
      { type: "verticalAlign", attrs: { value: "superscript" } },
      { type: "characterSpacing", attrs: { value: -10 } },
      { type: "formatChange", attrs: { id: 3, author: "A", previous: [{ type: "italic" }] } },
      { type: "runExt", attrs: { xml: '<w:rPr><w:kern w:val="28"/></w:rPr>' } },
    ];
    const json = doc(paragraph({}, [{ type: "text", text: "x", marks }]));
    expect(parse(json)).toEqual(json);
    const shuffled = doc(paragraph({}, [{ type: "text", text: "x", marks: [...marks].reverse() }]));
    expect(parse(shuffled)).toEqual(json);
  });

  it("rejects run properties Word does not have", () => {
    const changeIn = (previous: unknown) => ({
      type: "formatChange",
      attrs: { id: 1, author: "A", previous },
    });
    const bad: [Record<string, unknown>, RegExp][] = [
      [{ type: "link", attrs: { href: "" } }, /href: must be a non-empty string/],
      [{ type: "highlight", attrs: { value: "orange" } }, /value: must be one of/],
      [{ type: "color", attrs: { value: "#ff0000" } }, /value: must be RRGGBB or auto/],
      [{ type: "fontSize", attrs: { value: 0 } }, /value: must be an integer from 1 to 3276/],
      [{ type: "font", attrs: { asciiTheme: "majorLatin" } }, /asciiTheme: must be one of/],
      // A recorded change holds run properties only: no change inside a change.
      [changeIn([changeIn([])]), /formatChange is not a run property/],
      [changeIn([{ type: "glow" }]), /glow is not a run property/],
      [{ type: "insertion", attrs: { id: -1, author: "A" } }, /id: must be an integer from 0/],
      [{ type: "bold", attrs: { value: "yes" } }, /value: must be true or false/],
    ];
    for (const [mark, message] of bad) {
      expect(() => parseContentV3(withMark(mark)), JSON.stringify(mark)).toThrow(message);
    }
  });

  it("has Word's inline content and opaque content", () => {
    const json = doc(
      paragraph({}, [
        { type: "bookmarkStart", attrs: { id: 1, name: "_Ref123" } },
        { type: "commentStart", attrs: { id: 0 } },
        { type: "text", text: "a" },
        { type: "tab" },
        { type: "hardBreak", attrs: { clear: "all" } },
        { type: "hardBreak" },
        { type: "columnBreak" },
        { type: "pageBreak" },
        { type: "commentEnd", attrs: { id: 0 } },
        { type: "commentReference", attrs: { id: 0 } },
        { type: "bookmarkEnd", attrs: { id: 1 } },
        { type: "opaqueInline", attrs: { xml: '<w:fldSimple w:instr="PAGE"/>', label: "PAGE" } },
      ]),
      { type: "opaqueBlock", attrs: { xml: "<w:tbl/>" } },
    );
    expect(parse(json)).toEqual(json);
    expect(() => parseContentV3(doc({ type: "opaqueBlock" }))).toThrow(
      /xml: required attribute is missing/,
    );
    expect(() => parseContentV3(doc({ type: "heading", attrs: { level: 1 } }))).toThrow(/unknown/i);
    expect(schemaV3.nodes.heading).toBeUndefined();
    expect(schemaV3.nodes.bulletList).toBeUndefined();
  });
});

describe("schema v3 envelope", () => {
  it("accepts a document with styles, numbering, theme and comments", () => {
    const input = v3({
      defaults: {
        paragraph: { spacing: { after: 160, line: 259, lineRule: "auto" } },
        run: [{ type: "fontSize", attrs: { value: 22 } }],
      },
      styles: [
        { id: "Normal", type: "paragraph", name: "Normal", isDefault: true },
        {
          id: "Heading1",
          type: "paragraph",
          name: "heading 1",
          basedOn: "Normal",
          next: "Normal",
          paragraph: { outlineLevel: 0 },
          run: [{ type: "bold" }],
        },
        { id: "ListBullet", type: "paragraph", paragraph: { numbering: { id: 1 } } },
        { id: "Missing", type: "character", basedOn: "NotThere" },
      ],
      numbering: {
        abstracts: [
          {
            id: 0,
            multiLevelType: "multilevel",
            levels: [
              {
                level: 0,
                start: 1,
                format: "decimal",
                text: "%1.",
                legal: true,
                paragraph: { indent: { left: 360, hanging: 360 } },
              },
              { level: 1 },
            ],
          },
        ],
        instances: [{ id: 1, abstract: 0, overrides: [{ level: 0, start: 5 }] }],
      },
      theme: {
        fonts: { major: { latin: "Calibri Light" }, minor: { latin: "Calibri", eastAsia: "" } },
        colors: { dk1: "000000", accent1: "4472C4" },
      },
      comments: [
        {
          id: 0,
          author: "Alice",
          initials: "AM",
          date: "2026-11-09T10:00:00Z",
          content: [paragraph({}, [{ type: "text", text: "Why?" }])],
        },
        {
          id: 1,
          author: "",
          initials: "",
          content: [{ type: "paragraph", attrs: {} }],
          parent: 0,
          done: true,
        },
      ],
    });
    const parsed = parseDocumentV3(input);
    expect(parsed.styles).toEqual(input.styles);
    // Comment content is canonical too.
    expect(parsed.comments[1]?.content).toEqual([{ type: "paragraph" }]);
    expect(parseDocumentV3(parsed)).toEqual(parsed);
  });

  it("accepts the inconsistencies Word opens", () => {
    const accepted: Record<string, unknown>[] = [
      // Duplicate ids: the first wins.
      {
        styles: [
          { id: "A", type: "paragraph" },
          { id: "A", type: "character" },
        ],
      },
      {
        numbering: {
          abstracts: [
            { id: 0, levels: [] },
            { id: 0, levels: [] },
          ],
          instances: [
            { id: 1, abstract: 0 },
            { id: 1, abstract: 0 },
          ],
        },
      },
      // A definition or a reply target that is not there.
      { numbering: { abstracts: [], instances: [{ id: 1, abstract: 7 }] } },
      { comments: [{ id: 0, author: "A", content: [{ type: "paragraph" }], parent: 3 }] },
      // A sectPr without page size or margins.
      { section: {} },
    ];
    for (const overrides of accepted) {
      expect(() => parseDocumentV3(v3(overrides)), JSON.stringify(overrides)).not.toThrow();
    }
  });

  it("rejects envelopes the engine cannot work with", () => {
    const comment = (id: number, parent?: number) => ({
      id,
      author: "A",
      content: [{ type: "paragraph" }],
      ...(parent === undefined ? {} : { parent }),
    });
    const bad: [Record<string, unknown>, RegExp][] = [
      [{ extra: 1 }, /extra: unknown key/],
      [{ section: undefined }, /section: must be an object/],
      [
        {
          styles: [
            { id: "A", type: "paragraph", basedOn: "B" },
            { id: "B", type: "paragraph", basedOn: "A" },
          ],
        },
        /is based on itself/,
      ],
      [
        { styles: [{ id: "A", type: "paragraph", basedOn: "A" }] },
        /styles\[0\]: A is based on itself/,
      ],
      [{ styles: [{ id: "A", type: "list" }] }, /type must be one of/],
      [
        { styles: [{ id: "A", type: "paragraph", paragraph: { section: {} } }] },
        /unknown key section/,
      ],
      [
        { styles: [{ id: "A", type: "paragraph", paragraph: { keepNext: null } }] },
        /must not be null/,
      ],
      [
        { styles: [{ id: "A", type: "paragraph", run: [{ type: "bold", attrs: { value: 1 } }] }] },
        /true or false/,
      ],
      [
        {
          styles: [{ id: "A", type: "paragraph", run: [{ type: "link", attrs: { href: "x" } }] }],
        },
        /link is not a run property/,
      ],
      [
        { numbering: { abstracts: [{ id: 0, levels: [] }], instances: [{ id: 0, abstract: 0 }] } },
        /id must be an integer from 1/,
      ],
      [{ numbering: { abstracts: [] } }, /instances is required/],
      [
        {
          theme: {
            fonts: { major: { latin: "A" }, minor: { latin: "B" } },
            colors: { accent9: "000000" },
          },
        },
        /unknown color accent9/,
      ],
      [{ comments: [comment(0, 0)] }, /comment 0 replies to itself/],
      [{ comments: [comment(0, 1), comment(1, 0)] }, /replies to itself/],
      [
        { comments: [{ id: 0, author: "A", content: [{ type: "heading" }] }] },
        /comments\[0\]\.content/,
      ],
      [{ content: { type: "paragraph" } }, /root node must be of type "doc"/],
      [{ schemaVersion: 4 }, /Unsupported schemaVersion: 4/],
    ];
    for (const [overrides, message] of bad) {
      expect(() => parseDocumentV3(v3(overrides)), JSON.stringify(overrides)).toThrow(message);
    }
    expect(() => parseDocumentV3(null)).toThrow(/must be an object/);
  });

  it("checks long style chains in linear time", () => {
    const styles = Array.from({ length: 20_000 }, (_, i) => ({
      id: `S${i}`,
      type: "paragraph",
      ...(i ? { basedOn: `S${i - 1}` } : {}),
    }));
    const started = performance.now();
    parseDocumentV3(v3({ styles }));
    // Quadratic took seconds at 10 000; linear takes milliseconds.
    expect(performance.now() - started).toBeLessThan(1500);
    const cycle = [
      ...styles,
      { id: "X", type: "paragraph", basedOn: "Y" },
      { id: "Y", type: "paragraph", basedOn: "X" },
    ];
    expect(() => parseDocumentV3(v3({ styles: cycle }))).toThrow(/based on itself/);
  });

  it("returns a document that shares nothing with its input", () => {
    const input = v3({
      styles: [{ id: "A", type: "paragraph", paragraph: { indent: { left: 1 } } }],
    });
    const parsed = parseDocumentV3(input);
    (input.section as { pageSize: { width: unknown } }).pageSize.width = "evil";
    (input.styles as { id: string }[])[0]!.id = "changed";
    expect(parsed.section.pageSize?.width).toBe(11906);
    expect(parsed.styles[0]?.id).toBe("A");
  });
});

describe("v2 → v3 migration", () => {
  const v2: FoliDocument = {
    schemaVersion: 2,
    settings: {
      pageSize: { width: 297, height: 210 },
      margins: { top: 20, right: 25.4, bottom: 20, left: 25.4 },
    },
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2, align: "center" },
          content: [{ type: "text", text: "Title" }],
        },
        {
          type: "paragraph",
          attrs: { align: "justify" },
          content: [
            {
              type: "text",
              text: "a",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }, { type: "bold" }],
            },
            {
              type: "text",
              text: "b",
              marks: [
                { type: "underline" },
                { type: "textColor", attrs: { color: "#c00000" } },
                { type: "highlight", attrs: { color: "#fff2cc" } },
              ],
            },
            { type: "hardBreak" },
            { type: "pageBreak", marks: [{ type: "italic" }] },
          ],
        },
        { type: "horizontalRule" },
        {
          type: "orderedList",
          attrs: { start: 3 },
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "one" }] },
                { type: "paragraph", content: [{ type: "text", text: "more" }] },
                {
                  type: "orderedList",
                  content: [
                    {
                      type: "listItem",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "1.a" }] }],
                    },
                  ],
                },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        { type: "paragraph", attrs: { align: "end" } },
                        { type: "horizontalRule" },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }],
            },
          ],
        },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
      ],
    } as DocJSON,
  };

  it("turns headings, lists and rules into Word's paragraphs", () => {
    const migrated = parseDocumentV3(v2);
    const rule = { bottom: { style: "single", size: 6, space: 1, color: "auto" } };
    expect(migrated.content).toEqual(
      doc(
        paragraph({ style: "Heading2", justification: "center" }, [
          { type: "text", text: "Title" },
        ]),
        paragraph({ justification: "both" }, [
          {
            type: "text",
            text: "a",
            marks: [{ type: "link", attrs: { href: "https://example.com" } }, { type: "bold" }],
          },
          {
            type: "text",
            text: "b",
            marks: [
              { type: "underline" },
              { type: "color", attrs: { value: "C00000" } },
              { type: "shading", attrs: { pattern: "clear", fill: "FFF2CC" } },
            ],
          },
          { type: "hardBreak" },
          { type: "pageBreak", marks: [{ type: "italic" }] },
        ]),
        paragraph({ borders: rule }),
        paragraph({ style: "ListParagraph", numbering: { id: 1, level: 0 } }, [
          { type: "text", text: "one" },
        ]),
        paragraph({ style: "ListParagraph", indent: { left: 720 } }, [
          { type: "text", text: "more" },
        ]),
        // Same kind, starting at 1: the parent's numbering, one level down.
        paragraph({ style: "ListParagraph", numbering: { id: 1, level: 1 } }, [
          { type: "text", text: "1.a" },
        ]),
        // Another kind: its own numbering.
        paragraph({
          style: "ListParagraph",
          numbering: { id: 2, level: 1 },
          justification: "right",
        }),
        paragraph({ style: "ListParagraph", indent: { left: 1440 }, borders: rule }),
        paragraph({ style: "ListParagraph", numbering: { id: 1, level: 0 } }, [
          { type: "text", text: "two" },
        ]),
        paragraph({ style: "ListParagraph", numbering: { id: 3, level: 0 } }),
      ),
    );
    expect(migrated.numbering.instances).toEqual([
      { id: 1, abstract: 1, overrides: [{ level: 0, start: 3 }] },
      { id: 2, abstract: 0 },
      { id: 3, abstract: 0 },
    ]);
    expect(migrated.section).toEqual({
      pageSize: { width: 16838, height: 11906, orientation: "landscape" },
      margins: { top: 1134, right: 1440, bottom: 1134, left: 1440 },
    });
    expect(migrated.defaults.run?.map((m) => m.type)).toEqual(["font", "fontSize"]);
    expect(migrated.styles.map((s) => s.id)).toEqual([
      "Normal",
      "Heading1",
      "Heading2",
      "Heading3",
      "Heading4",
      "Heading5",
      "Heading6",
      "ListParagraph",
      "DefaultParagraphFont",
    ]);
    // v2 showed nested numbers as decimal at every level.
    expect(
      migrated.numbering.abstracts.map((a) => [
        a.levels[0]?.format,
        a.levels[1]?.format,
        a.levels[1]?.text,
      ]),
    ).toEqual([
      ["bullet", "bullet", "\u25e6"],
      ["decimal", "decimal", "%2."],
    ]);
  });

  const item = (text: string, ...rest: NodeJSON[]): NodeJSON => ({
    type: "listItem",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }, ...rest],
  });
  const migrate = (content: NodeJSON[]) =>
    parseDocumentV3(createDocument({ type: "doc", content } as DocJSON));
  const numbering = (d: FoliDocumentV3) => d.content.content?.map((p) => p.attrs?.numbering);

  it("gives a nested list with its own start its own numbering", () => {
    const migrated = migrate([
      {
        type: "orderedList",
        content: [item("a", { type: "orderedList", attrs: { start: 5 }, content: [item("e")] })],
      },
    ]);
    expect(numbering(migrated)).toEqual([
      { id: 1, level: 0 },
      { id: 2, level: 1 },
    ]);
    expect(migrated.numbering.instances[1]).toEqual({
      id: 2,
      abstract: 1,
      overrides: [{ level: 1, start: 5 }],
    });
  });

  it("restarts a second nested list of the same item", () => {
    const nested = (text: string): NodeJSON => ({ type: "orderedList", content: [item(text)] });
    const migrated = migrate([
      {
        type: "orderedList",
        content: [
          item("a", nested("first"), { type: "paragraph" }, nested("second, from 1 again")),
        ],
      },
    ]);
    expect(numbering(migrated)).toEqual([
      { id: 1, level: 0 },
      { id: 1, level: 1 },
      undefined,
      { id: 2, level: 1 },
    ]);
    expect(migrated.numbering.instances[1]).toEqual({
      id: 2,
      abstract: 1,
      overrides: [{ level: 1, start: 1 }],
    });
  });

  it("keeps lists nested past Word's nine levels at the ninth, numbered apart", () => {
    let list: NodeJSON = { type: "orderedList", content: [item("deepest")] };
    for (let i = 0; i < 10; i++) list = { type: "orderedList", content: [item(`${i}`, list)] };
    const migrated = migrate([list]);
    const levels = numbering(migrated) as { id: number; level: number }[];
    expect(levels.map((n) => n.level)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8]);
    // At the ninth level each list has its own numbering: none continues its parent's count.
    expect(new Set(levels.slice(8).map((n) => n.id)).size).toBe(3);
  });

  it("keeps pages Word cannot have within its limits", () => {
    const migrated = parseDocumentV3(
      createDocument(undefined, {
        pageSize: { width: 600, height: 841 },
        margins: { top: 10, right: 10, bottom: 10, left: 10 },
      }),
    );
    expect(migrated.section.pageSize).toEqual({ width: 31680, height: 31680 });
  });

  it("migrates a document saved by 0.1.0 (schema v1)", () => {
    const savedBy010 = {
      schemaVersion: 1,
      settings: {
        pageSize: { width: 215.9, height: 279.4 },
        margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
      },
      content: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "T" }] },
          { type: "paragraph" },
        ],
      },
    };
    const migrated = parseDocumentV3(savedBy010);
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.section.pageSize).toEqual({ width: 12240, height: 15840 });
    expect(migrated.content).toEqual(
      doc(paragraph({ style: "Heading1" }, [{ type: "text", text: "T" }]), { type: "paragraph" }),
    );
  });

  it("validates a v1 or v2 document before migrating it", () => {
    expect(() =>
      parseDocumentV3({ ...v2, content: { type: "doc", content: [{ type: "heading" }] } }),
    ).toThrow(/required attribute is missing/);
  });

  it("converts units", () => {
    expect(mmToTwips(25.4)).toBe(1440);
    expect(mmToTwips(210)).toBe(11906);
    expect(Math.abs(twipsToMm(mmToTwips(123.45)) - 123.45)).toBeLessThan(0.02);
  });

  it("keeps every character, break and mark of any v2 document, and its list numbers", () => {
    const text = fc.string({
      unit: fc.constantFrom("a", "é", " ", "😀"),
      minLength: 1,
      maxLength: 3,
    });
    const marks = fc
      .record({
        bold: fc.boolean(),
        underline: fc.boolean(),
        link: fc.option(fc.constant("https://example.com/x")),
        color: fc.option(fc.constantFrom("#123456", "#abcdef")),
        highlight: fc.option(fc.constantFrom("#fff2cc")),
      })
      .map((m) => [
        ...(m.link ? [{ type: "link", attrs: { href: m.link } }] : []),
        ...(m.bold ? [{ type: "bold" }] : []),
        ...(m.underline ? [{ type: "underline" }] : []),
        ...(m.color ? [{ type: "textColor", attrs: { color: m.color } }] : []),
        ...(m.highlight ? [{ type: "highlight", attrs: { color: m.highlight } }] : []),
      ]);
    const inline = fc.oneof(
      fc
        .tuple(text, marks)
        .map(([t, m]) => ({ type: "text", text: t, ...(m.length ? { marks: m } : {}) })),
      fc.constantFrom({ type: "hardBreak" }, { type: "pageBreak" }),
    );
    const textblock = fc
      .tuple(
        fc.array(inline, { maxLength: 4 }),
        fc.constantFrom(0, 1, 2, 3),
        fc.constantFrom("start", "center", "end", "justify"),
      )
      .map(([content, level, align]) =>
        level === 0
          ? { type: "paragraph", attrs: { align }, content }
          : { type: "heading", attrs: { level, align }, content },
      );
    const { block } = fc.letrec<{ block: NodeJSON }>((tie) => ({
      block: fc.oneof(
        { maxDepth: 4, depthIdentifier: "list" },
        textblock,
        fc.constant({ type: "horizontalRule" }),
        fc
          .tuple(
            fc.constantFrom("bulletList", "orderedList"),
            fc.constantFrom(1, 1, 0, 5),
            fc.array(
              fc.tuple(
                textblock.map((b) => ({ ...b, type: "paragraph", attrs: {} })),
                fc.array(tie("block"), { maxLength: 3, depthIdentifier: "list" }),
              ),
              { minLength: 1, maxLength: 3, depthIdentifier: "list" },
            ),
          )
          .map(([type, start, items]) => ({
            type,
            ...(type === "orderedList" ? { attrs: { start } } : {}),
            content: items.map(([first, rest]) => ({
              type: "listItem",
              content: [first, ...rest],
            })),
          })),
      ),
    }));

    const V3_NAMES: Record<string, string> = { textColor: "color", highlight: "shading" };
    const inlines = (node: NodeJSON, out: string[]) => {
      for (const child of node.content ?? []) {
        const types = (child.marks ?? []).map((m) => V3_NAMES[m.type] ?? m.type).sort();
        out.push(child.type === "text" ? `${child.text}|${types}` : `${child.type}|${types}`);
      }
    };
    /** Paragraphs in order: text with its marks' (v3) types, breaks, and v2's number for ordered items. */
    const flattenV2 = (nodes: readonly NodeJSON[], out: string[] = []): string[] => {
      for (const node of nodes) {
        if (node.type === "orderedList" || node.type === "bulletList") {
          const start = (node.attrs?.start as number | undefined) ?? 1;
          (node.content ?? []).forEach((listItem, i) => {
            const [first, ...rest] = listItem.content ?? [];
            out.push(node.type === "orderedList" ? `#${start + i}` : "•");
            inlines(first as NodeJSON, out);
            flattenV2(rest, out);
          });
        } else {
          out.push("¶");
          inlines(node, out);
        }
      }
      return out;
    };
    /** The same, numbering v3's paragraphs as Word does: a counter per instance and level. */
    const flattenV3 = (d: FoliDocumentV3): string[] => {
      const out: string[] = [];
      const counters = new Map<number, number[]>();
      const abstracts = new Map(d.numbering.abstracts.map((a) => [a.id, a]));
      const instances = new Map(d.numbering.instances.map((n) => [n.id, n]));
      for (const p of d.content.content ?? []) {
        const num = p.attrs?.numbering as { id: number; level: number } | undefined;
        if (!num) {
          out.push("¶");
        } else {
          const instance = instances.get(num.id);
          const abstract = abstracts.get(instance?.abstract ?? -1);
          const level = abstract?.levels[num.level];
          if (level?.format === "bullet") {
            out.push("•");
          } else {
            const levels = counters.get(num.id) ?? [];
            const start =
              instance?.overrides?.find((o) => o.level === num.level)?.start ?? level?.start ?? 1;
            const current = levels[num.level];
            levels[num.level] = current === undefined ? start : current + 1;
            levels.length = num.level + 1; // deeper levels restart
            counters.set(num.id, levels);
            out.push(`#${levels[num.level]}`);
          }
        }
        inlines(p, out);
      }
      return out;
    };

    fc.assert(
      fc.property(fc.array(block, { minLength: 1, maxLength: 4 }), (content) => {
        const before = parseDocument(createDocument({ type: "doc", content } as DocJSON));
        const after = parseDocumentV3(before);
        // The same characters with the same marks, breaks and paragraphs, in order, and every
        // ordered item numbered as v2 numbered it.
        expect(flattenV3(after)).toEqual(flattenV2(before.content.content as NodeJSON[]));
      }),
      { numRuns: 300 },
    );
  });

  it("migrates without changing its input, sharing nothing between documents", () => {
    const copy = structuredClone(v2);
    const first = migrateToV3(parseDocument(copy));
    expect(copy).toEqual(v2);
    first.styles.push({ id: "Mine", type: "paragraph" });
    (first.numbering.abstracts[0]?.levels[0] as { text?: string }).text = "changed";
    const second = migrateToV3(parseDocument(copy));
    expect(second.styles.map((s) => s.id)).not.toContain("Mine");
    expect(second.numbering.abstracts[0]?.levels[0]?.text).toBe("\u2022");
    expect(JSON.parse(JSON.stringify(second))).toStrictEqual(second);
  });

  it("writes no undefined values", () => {
    const plain = migrateToV3(
      createDocument({
        type: "doc",
        content: [{ type: "paragraph", attrs: { align: "start" } }],
      } as DocJSON),
    );
    expect(plain.content.content?.[0]).toStrictEqual({ type: "paragraph" });
  });
});
