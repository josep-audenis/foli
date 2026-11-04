import { describe, expect, it } from "vitest";
import { createDocument, FoliDocumentError, parseDocument } from "./index.js";

const roundTrip = (value: unknown) => JSON.parse(JSON.stringify(value));

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
          content: [{ type: "text", text: "bold", marks: [{ type: "bold" }] }],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "item" }] }],
            },
          ],
        },
      ],
    });
    expect(parseDocument(roundTrip(doc))).toEqual(doc);
  });

  it.each([
    ["non-object", 42],
    ["unknown version", { ...createDocument(), schemaVersion: 99 }],
    ["unknown node type", createDocument({ type: "doc", content: [{ type: "nope" }] })],
    [
      "invalid content model",
      createDocument({ type: "doc", content: [{ type: "text", text: "x" }] }),
    ],
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
