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

function v3(
  overrides: Partial<Record<keyof FoliDocumentV3, unknown>> = {},
): Record<string, unknown> {
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

describe("schema v3 content", () => {
  it("keeps Word's paragraph properties, omitting unset ones", () => {
    const attrs = {
      style: "Heading1",
      justification: "both",
      indent: { left: 720, hanging: 360 },
      spacing: { before: 240, after: 120, line: 276, lineRule: "auto" },
      keepNext: true,
      widowControl: false,
      outlineLevel: 0,
      numbering: { id: 3, level: 1 },
      tabs: [{ position: 9026, kind: "right", leader: "dot" }],
      borders: { bottom: { style: "single", size: 6, space: 1, color: "auto" } },
      shading: { pattern: "clear", fill: "D9E2F3" },
      markFormat: [{ type: "bold" }],
      section: {
        pageSize: { width: 16838, height: 11906, orientation: "landscape" },
        margins: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708 },
      },
      revision: { kind: "insertion", id: 4, author: "Alice Martin", date: "2026-11-09T10:00:00Z" },
      formatChange: { id: 5, author: "Bob Chen", previous: { justification: "left" } },
      ext: "<w:suppressAutoHyphens/>",
    };
    const json = doc(paragraph(attrs, [{ type: "text", text: "x" }]), { type: "paragraph" });
    expect(parse(json)).toEqual(json);
    // A paragraph with nothing set has no attrs.
    expect(parse(doc(paragraph({ style: null, keepNext: null })))).toEqual(
      doc({ type: "paragraph" }),
    );
  });

  it("rejects paragraph properties Word does not have", () => {
    const bad: [Record<string, unknown>, RegExp][] = [
      [{ justification: "middle" }, /justification: must be one of/],
      [{ indent: { firstLine: 10, hanging: 10 } }, /cannot have both firstLine and hanging/],
      [{ indent: {} }, /must not be empty/],
      [{ indent: { left: 1.5 } }, /left must be an integer/],
      [{ indent: { top: 1 } }, /unknown key top/],
      [{ numbering: { id: 1, level: 9 } }, /level must be an integer from 0 to 8/],
      [{ numbering: { id: 1 } }, /level is required/],
      [{ tabs: [{ position: 10, kind: "middle" }] }, /\[0\] kind must be one of/],
      [
        { borders: { bottom: { style: "single", size: 97 } } },
        /size must be an integer from 0 to 96/,
      ],
      [{ borders: { bottom: { style: "<b>" } } }, /style must be a Word token/],
      [{ shading: { pattern: "clear", fill: "#ffffff" } }, /fill must be RRGGBB or auto/],
      [{ markFormat: [{ type: "bold" }, { type: "bold" }] }, /duplicate mark/],
      [
        {
          section: {
            pageSize: { width: 0, height: 10 },
            margins: { top: 0, right: 0, bottom: 0, left: 0 },
          },
        },
        /width must be an integer from 1/,
      ],
      [
        { revision: { kind: "moved", id: 1, author: "A" } },
        /kind must be one of insertion, deletion/,
      ],
      [{ revision: { kind: "insertion", id: 1, author: "A", date: "yesterday" } }, /ISO 8601/],
      [{ ext: "" }, /must be an XML string/],
      [{ outline: 1 }, /unknown attribute/],
      [
        { formatChange: { id: 1, author: "A", previous: { justification: "middle" } } },
        /previous justification must be one of/,
      ],
      [
        { formatChange: { id: 1, author: "A", previous: { section: null } } },
        /previous unknown key section/,
      ],
    ];
    for (const [attrs, message] of bad) {
      expect(() => parseContentV3(doc(paragraph(attrs))), JSON.stringify(attrs)).toThrow(message);
    }
  });

  it("keeps Word's run properties as marks, in canonical order", () => {
    const marks = [
      { type: "link", attrs: { href: "https://example.com", tooltip: "Example" } },
      { type: "insertion", attrs: { id: 1, author: "A", date: "2026-11-09T10:00" } },
      { type: "deletion", attrs: { id: 2, author: "B" } },
      { type: "characterStyle", attrs: { id: "Emphasis" } },
      { type: "bold", attrs: { value: false } },
      { type: "italic" },
      { type: "underline", attrs: { style: "double", color: "FF0000" } },
      { type: "strike" },
      { type: "doubleStrike" },
      { type: "caps" },
      { type: "smallCaps" },
      { type: "hidden" },
      { type: "font", attrs: { ascii: "Calibri", hAnsi: "Calibri", csTheme: "minorBidi" } },
      { type: "fontSize", attrs: { value: 22, complexScript: 22 } },
      { type: "color", attrs: { value: "1F3864", themeColor: "accent1", themeShade: "80" } },
      { type: "highlight", attrs: { value: "yellow" } },
      { type: "shading", attrs: { pattern: "clear", fill: "D9E2F3" } },
      { type: "verticalAlign", attrs: { value: "superscript" } },
      { type: "characterSpacing", attrs: { value: -10 } },
      { type: "formatChange", attrs: { id: 3, author: "A", previous: [{ type: "italic" }] } },
      { type: "runExt", attrs: { xml: '<w:kern w:val="28"/>' } },
    ];
    const json = doc(paragraph({}, [{ type: "text", text: "x", marks }]));
    expect(parse(json)).toEqual(json);
    const shuffled = doc(paragraph({}, [{ type: "text", text: "x", marks: [...marks].reverse() }]));
    expect(parse(shuffled)).toEqual(json);
  });

  it("rejects run properties Word does not have", () => {
    const bad: [Record<string, unknown>, RegExp][] = [
      [{ type: "link", attrs: { href: "javascript:alert(1)" } }, /href: must be a relative URL/],
      [{ type: "highlight", attrs: { value: "orange" } }, /value: must be one of/],
      [{ type: "color", attrs: { value: "#ff0000" } }, /value: must be RRGGBB or auto/],
      [{ type: "fontSize", attrs: { value: 0 } }, /value: must be an integer from 1 to 3276/],
      [{ type: "fontSize" }, /required attribute is missing/],
      [{ type: "font", attrs: { asciiTheme: "majorLatin" } }, /asciiTheme: must be one of/],
      [
        { type: "formatChange", attrs: { id: 1, author: "A", previous: [{ type: "glow" }] } },
        /Unknown mark type|unknown/i,
      ],
      [{ type: "insertion", attrs: { id: -1, author: "A" } }, /id: must be an integer from 0/],
      [{ type: "bold", attrs: { value: "yes" } }, /value: must be true or false/],
    ];
    for (const [mark, message] of bad) {
      expect(
        () =>
          parseContentV3(
            doc(paragraph({}, [{ type: "text", text: "x", marks: [mark as unknown as MarkJSON] }])),
          ),
        JSON.stringify(mark),
      ).toThrow(message);
    }
  });

  it("has Word's inline content and opaque content", () => {
    const json = doc(
      paragraph({}, [
        { type: "commentStart", attrs: { id: 0 } },
        { type: "text", text: "a" },
        { type: "tab" },
        { type: "hardBreak" },
        { type: "columnBreak" },
        { type: "pageBreak" },
        { type: "commentEnd", attrs: { id: 0 } },
        { type: "commentReference", attrs: { id: 0 } },
        { type: "opaqueInline", attrs: { xml: '<w:fldSimple w:instr="PAGE"/>', label: "PAGE" } },
      ]),
      { type: "opaqueBlock", attrs: { xml: "<w:tbl/>" } },
    );
    expect(parse(json)).toEqual(json);
    expect(() => parseContentV3(doc({ type: "opaqueBlock" }))).toThrow(
      /xml: required attribute is missing/,
    );
    expect(() => parseContentV3(doc({ type: "heading", attrs: { level: 1 } }))).toThrow(
      /Unknown node type|unknown/i,
    );
    expect(() => parseContentV3(doc({ type: "bulletList", content: [] }))).toThrow();
    expect(schemaV3.nodes.heading).toBeUndefined();
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
          author: "Bob",
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

  it("rejects envelopes that are not consistent", () => {
    const bad: [Record<string, unknown>, RegExp][] = [
      [{ extra: 1 }, /extra: unknown key/],
      [{ section: undefined }, /section: must be an object/],
      [
        {
          styles: [
            { id: "A", type: "paragraph" },
            { id: "A", type: "character" },
          ],
        },
        /styles\[1\]\.id: duplicate id A/,
      ],
      [
        {
          styles: [
            { id: "A", type: "paragraph", basedOn: "B" },
            { id: "B", type: "paragraph", basedOn: "A" },
          ],
        },
        /A is based on itself/,
      ],
      [{ styles: [{ id: "A", type: "paragraph", basedOn: "A" }] }, /A is based on itself/],
      [{ styles: [{ id: "A", type: "list" }] }, /type must be one of/],
      [
        { styles: [{ id: "A", type: "paragraph", paragraph: { section: null } }] },
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
          numbering: {
            abstracts: [
              {
                id: 0,
                levels: [
                  { level: 0, format: "decimal" },
                  { level: 0, format: "bullet" },
                ],
              },
            ],
            instances: [],
          },
        },
        /levels must be distinct/,
      ],
      [
        { numbering: { abstracts: [], instances: [{ id: 1, abstract: 7 }] } },
        /no abstract numbering 7/,
      ],
      [
        {
          numbering: {
            abstracts: [
              { id: 0, levels: [] },
              { id: 0, levels: [] },
            ],
            instances: [],
          },
        },
        /duplicate id 0/,
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
      [{ comments: [{ id: 0, author: "A", content: [], parent: 0 }] }, /no other comment 0/],
      [{ comments: [{ id: 0, author: "A", content: [], parent: 3 }] }, /no other comment 3/],
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
    expect(
      migrated.numbering.abstracts.map((a) => [
        a.levels[0]?.format,
        a.levels[1]?.format,
        a.levels[0]?.text,
      ]),
    ).toEqual([
      ["bullet", "bullet", "•"],
      ["decimal", "lowerLetter", "%1."],
    ]);
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

  it("keeps every character, break and mark of any v2 document", () => {
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
            fc.integer({ min: 0, max: 5 }),
            fc.array(
              fc.tuple(
                textblock.map((b) => ({ ...b, type: "paragraph", attrs: {} })),
                fc.array(tie("block"), { maxLength: 2, depthIdentifier: "list" }),
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
    const flatten = (node: NodeJSON, out: string[]) => {
      if (node.type === "text") out.push(`${node.text}|${(node.marks ?? []).length}`);
      else if (node.type === "hardBreak" || node.type === "pageBreak") out.push(node.type);
      else if (
        node.type === "paragraph" ||
        node.type === "heading" ||
        node.type === "horizontalRule"
      )
        out.push("¶");
      for (const child of node.content ?? []) flatten(child, out);
      return out;
    };
    fc.assert(
      fc.property(fc.array(block, { minLength: 1, maxLength: 4 }), (content) => {
        const before = parseDocument(createDocument({ type: "doc", content } as DocJSON));
        const after = parseDocumentV3(before);
        // The same characters (with as many marks each), breaks and paragraphs, in order.
        expect(flatten(after.content, [])).toEqual(flatten(before.content as NodeJSON, []));
        // Every numbered paragraph references an instance that exists.
        const ids = new Set(after.numbering.instances.map((n) => n.id));
        for (const p of after.content.content ?? []) {
          const numbering = p.attrs?.numbering as { id: number } | undefined;
          if (numbering) expect(ids.has(numbering.id)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("gives a nested list with its own start its own numbering", () => {
    const item = (text: string, ...rest: NodeJSON[]) => ({
      type: "listItem",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }, ...rest],
    });
    const migrated = parseDocumentV3(
      createDocument({
        type: "doc",
        content: [
          {
            type: "orderedList",
            content: [
              item("a", { type: "orderedList", attrs: { start: 5 }, content: [item("e")] }),
            ],
          },
        ],
      } as DocJSON),
    );
    expect(migrated.content.content?.map((p) => p.attrs?.numbering)).toEqual([
      { id: 1, level: 0 },
      { id: 2, level: 1 },
    ]);
    expect(migrated.numbering.instances[1]).toEqual({
      id: 2,
      abstract: 1,
      overrides: [{ level: 1, start: 5 }],
    });
  });

  it("keeps lists nested past Word's nine levels at the ninth", () => {
    let list: NodeJSON = {
      type: "bulletList",
      content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
    };
    for (let i = 0; i < 10; i++) {
      list = {
        type: "bulletList",
        content: [{ type: "listItem", content: [{ type: "paragraph" }, list] }],
      };
    }
    const migrated = parseDocumentV3(createDocument({ type: "doc", content: [list] } as DocJSON));
    expect(
      migrated.content.content?.map(
        (p) => (p.attrs as { numbering: { level: number } }).numbering.level,
      ),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8]);
  });

  it("writes no undefined values", () => {
    const out = migrateToV3(parseDocument(v2));
    expect(JSON.parse(JSON.stringify(out))).toStrictEqual(out);
    const plain = migrateToV3(
      createDocument({
        type: "doc",
        content: [{ type: "paragraph", attrs: { align: "start" } }],
      } as DocJSON),
    );
    expect(plain.content.content?.[0]).toStrictEqual({ type: "paragraph" });
  });

  it("migrates without changing its input", () => {
    const copy = structuredClone(v2);
    migrateToV3(parseDocument(copy));
    expect(copy).toEqual(v2);
  });
});
