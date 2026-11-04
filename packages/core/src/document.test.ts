import { describe, expect, it } from "vitest";
import { createDocument, FoliDocumentError, parseContent, parseDocument } from "./index.js";

const roundTrip = (value: unknown) => JSON.parse(JSON.stringify(value));
const withContent = (content: unknown) => ({ ...createDocument(), content });
const withBlock = (block: unknown) => withContent({ type: "doc", content: [block] });
const withInline = (inline: unknown) => withBlock({ type: "paragraph", content: [inline] });

describe("parseDocument", () => {
  it("accepts a freshly created document", () => {
    const doc = createDocument();
    expect(parseDocument(roundTrip(doc))).toEqual(doc);
  });

  it("round-trips formatted content without loss", () => {
    const doc = createDocument({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "bold italic", marks: [{ type: "bold" }, { type: "italic" }] },
            { type: "hardBreak" },
            { type: "text", text: "plain" },
          ],
        },
        { type: "paragraph" },
      ],
    });
    expect(parseDocument(roundTrip(doc))).toEqual(doc);
  });

  it("normalizes content: merged text, canonical mark order, no empty arrays", () => {
    const loaded = parseDocument(
      withBlock({
        type: "paragraph",
        content: [
          { type: "text", text: "a", marks: [{ type: "italic" }, { type: "bold" }] },
          { type: "text", text: "b", marks: [{ type: "bold" }, { type: "italic" }] },
          { type: "hardBreak", marks: [{ type: "bold" }] },
          { type: "text", text: "c", marks: [] },
        ],
      }),
    );
    expect(loaded.content.content).toEqual([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "ab", marks: [{ type: "bold" }, { type: "italic" }] },
          { type: "hardBreak", marks: [{ type: "bold" }] },
          { type: "text", text: "c" },
        ],
      },
    ]);
    expect(parseDocument(withBlock({ type: "paragraph", content: [] })).content.content).toEqual([
      { type: "paragraph" },
    ]);
  });

  it("parses content into an immutable node tree", () => {
    const doc = parseContent({ type: "doc", content: [{ type: "paragraph" }] });
    expect(doc.type.name).toBe("doc");
    expect(doc.content.size).toBe(2);
    expect(() => parseContent({ type: "paragraph" })).toThrow(
      'content: root node must be of type "doc"',
    );
  });

  it("reports the path of invalid content", () => {
    expect(() =>
      parseDocument(withInline({ type: "text", text: "x", marks: [{ type: "code" }] })),
    ).toThrow("content.content[0].content[0].marks[0].type: unknown mark type");
  });

  it.each([
    ["non-object", 42],
    ["unknown version", { ...createDocument(), schemaVersion: 99 }],
    ["non-doc root", withContent({ type: "paragraph" })],
    [
      "marks on doc",
      withContent({ type: "doc", marks: [{ type: "bold" }], content: [{ type: "paragraph" }] }),
    ],
    ["empty doc", withContent({ type: "doc", content: [] })],
    ["unknown block type", withBlock({ type: "bulletList" })],
    ["text directly in doc", withBlock({ type: "text", text: "x" })],
    ["unknown key", withBlock({ type: "paragraph", style: "x" })],
    ["paragraph attrs", withBlock({ type: "paragraph", attrs: {} })],
    ["heading level 7", withBlock({ type: "heading", attrs: { level: 7 } })],
    ["heading without attrs", withBlock({ type: "heading" })],
    ["empty text", withInline({ type: "text", text: "" })],
    [
      "duplicate mark",
      withInline({ type: "text", text: "x", marks: [{ type: "bold" }, { type: "bold" }] }),
    ],
    ["block inside paragraph", withInline({ type: "paragraph" })],
    [
      "negative margin",
      createDocument(undefined, { margins: { top: -1, right: 0, bottom: 0, left: 0 } }),
    ],
    [
      "margins wider than page",
      createDocument(undefined, { margins: { top: 0, right: 150, bottom: 0, left: 150 } }),
    ],
  ])("rejects %s", (_label, input) => {
    expect(() => parseDocument(roundTrip(input))).toThrow(FoliDocumentError);
  });
});
