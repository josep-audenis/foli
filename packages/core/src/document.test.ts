import { describe, expect, it } from "vitest";
import {
  createDocument,
  FoliDocumentError,
  isColor,
  isSafeHref,
  parseContent,
  parseDocument,
} from "./index.js";

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
            { type: "pageBreak" },
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
    ["unknown paragraph attr", withBlock({ type: "paragraph", attrs: { color: "red" } })],
    ["invalid align", withBlock({ type: "paragraph", attrs: { align: "middle" } })],
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

describe("schema v2 and migrations", () => {
  /** A document exactly as @folijs/core 0.1.0 saved it (schema v1). */
  const savedBy010 = {
    schemaVersion: 1,
    settings: {
      pageSize: { width: 215.9, height: 279.4 },
      margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
    },
    content: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "bold", marks: [{ type: "bold" }, { type: "italic" }] },
            { type: "hardBreak", marks: [{ type: "bold" }] },
            { type: "text", text: "next" },
            { type: "pageBreak" },
          ],
        },
        { type: "paragraph" },
      ],
    },
  };

  it("loads a document saved by 0.1.0: version 2, content and settings unchanged", () => {
    const loaded = parseDocument(roundTrip(savedBy010));
    expect(loaded.schemaVersion).toBe(2);
    expect(loaded.settings).toEqual(savedBy010.settings);
    expect(loaded.content).toEqual(savedBy010.content);
  });

  it("rejects versions it cannot read, naming a newer document as such", () => {
    const at = (schemaVersion: unknown) => () => parseDocument({ ...savedBy010, schemaVersion });
    expect(at(3)).toThrow(/newer/);
    for (const bad of [0, -1, 1.5, "2", null, undefined]) {
      expect(at(bad)).toThrow(FoliDocumentError);
    }
  });

  const v2 = createDocument({
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1, align: "center" },
        content: [{ type: "text", text: "T" }],
      },
      {
        type: "paragraph",
        attrs: { align: "justify" },
        content: [
          {
            type: "text",
            text: "link",
            marks: [{ type: "link", attrs: { href: "https://x.test/a?b#c" } }, { type: "bold" }],
          },
          {
            type: "text",
            text: " red",
            marks: [{ type: "textColor", attrs: { color: "#c00000" } }],
          },
          {
            type: "text",
            text: " lit",
            marks: [{ type: "highlight", attrs: { color: "#ffff00" } }],
          },
        ],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "one" }] },
              {
                type: "orderedList",
                attrs: { start: 3 },
                content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
              },
            ],
          },
        ],
      },
      { type: "horizontalRule" },
      { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
    ],
  });

  it("round-trips every v2 type without loss", () => {
    expect(parseDocument(roundTrip(v2))).toEqual(v2);
  });

  it("leaves out attributes equal to their default, and fills them back in", () => {
    const loaded = parseDocument(
      withContent({
        type: "doc",
        content: [
          { type: "paragraph", attrs: { align: "start" } },
          {
            type: "orderedList",
            attrs: { start: 1 },
            content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
          },
          { type: "heading", attrs: { level: 3, align: "start" } },
        ],
      }),
    );
    expect(loaded.content.content).toEqual([
      { type: "paragraph" },
      { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
      { type: "heading", attrs: { level: 3 } },
    ]);
    const node = parseContent(loaded.content);
    expect(node.child(0).attrs).toEqual({ align: "start" });
    expect(node.child(1).attrs).toEqual({ start: 1 });
  });

  it("puts a link outside the other marks (canonical order)", () => {
    const loaded = parseDocument(
      withInline({
        type: "text",
        text: "x",
        marks: [{ type: "bold" }, { type: "link", attrs: { href: "/a" } }],
      }),
    );
    const inline = (loaded.content.content[0] as { content: { marks: { type: string }[] }[] })
      .content[0];
    expect(inline?.marks.map((m) => m.type)).toEqual(["link", "bold"]);
  });

  const item = (...content: unknown[]) => ({ type: "listItem", content });
  const list = (...items: unknown[]) => ({ type: "bulletList", content: items });
  it.each([
    ["an empty list", list()],
    ["a list item starting with a heading", list(item({ type: "heading", attrs: { level: 1 } }))],
    ["an empty list item", list(item())],
    ["a list item outside a list", item({ type: "paragraph" })],
    ["text in a list", { type: "bulletList", content: [{ type: "text", text: "x" }] }],
    ["a rule with content", { type: "horizontalRule", content: [{ type: "paragraph" }] }],
    [
      "a negative start",
      { type: "orderedList", attrs: { start: -1 }, content: [item({ type: "paragraph" })] },
    ],
    [
      "a fractional start",
      { type: "orderedList", attrs: { start: 1.5 }, content: [item({ type: "paragraph" })] },
    ],
  ])("rejects %s", (_name, block) => {
    expect(() => parseDocument(withBlock(block))).toThrow(FoliDocumentError);
  });

  it.each([
    ["javascript:alert(1)"],
    ["JavaScript:alert(1)"],
    [" javascript:alert(1)"],
    ["java\tscript:alert(1)"],
    ["java\nscript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["vbscript:msgbox(1)"],
    ["file:///etc/passwd"],
    ["\\evil.test/share"],
    ["https://x.test/a b"],
    [""],
  ])("rejects the link href %j", (href) => {
    expect(isSafeHref(href)).toBe(false);
    const link = { type: "text", text: "x", marks: [{ type: "link", attrs: { href } }] };
    expect(() => parseDocument(withInline(link))).toThrow(/href/);
  });

  it.each([
    ["https://x.test/a?b=c#d"],
    ["http://x.test"],
    ["HTTPS://X.TEST"],
    ["mailto:someone@x.test"],
    ["tel:+34600000000"],
    ["/relative/path"],
    ["relative/path"],
    ["#section"],
    ["?query"],
    ["//x.test/protocol-relative"],
  ])("accepts the link href %j", (href) => {
    expect(isSafeHref(href)).toBe(true);
  });

  it("rejects a link without href, and colors that are not lowercase #rrggbb", () => {
    expect(() =>
      parseDocument(withInline({ type: "text", text: "x", marks: [{ type: "link" }] })),
    ).toThrow(FoliDocumentError);
    for (const color of ["#FFF", "#ABCDEF", "red", "#12345g", "", 0]) {
      expect(isColor(color)).toBe(false);
      const marked = { type: "text", text: "x", marks: [{ type: "highlight", attrs: { color } }] };
      expect(() => parseDocument(withInline(marked))).toThrow(FoliDocumentError);
    }
    expect(isColor("#a1b2c3")).toBe(true);
  });
});
