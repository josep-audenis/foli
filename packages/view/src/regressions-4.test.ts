// @vitest-environment jsdom
// Regressions (fourth sweep): each test failed before its fix.
import type { FoliDocument, NodeJSON, StoryJSON } from "@folijs/core";
import { Resolver } from "@folijs/core/internal";
import { describe, expect, it } from "vitest";
import { PageRegions } from "./word/regions.js";

const text = (value: string): NodeJSON => ({ type: "text", text: value });
const field = (code: string): NodeJSON[] => [
  { type: "fieldStart" },
  { type: "fieldCode", attrs: { text: code } },
  { type: "fieldSeparator" },
  text("1"),
  { type: "fieldEnd" },
];

/** What the header of page 3 shows, its fields' codes shown. */
function header(content: NodeJSON[]): string | null | undefined {
  const story: StoryJSON = {
    kind: "header",
    content: { type: "doc", content: [{ type: "paragraph", content }] },
  };
  const doc: FoliDocument = {
    schemaVersion: 5,
    section: {},
    defaults: {},
    styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
    numbering: { abstracts: [], instances: [] },
    comments: [],
    stories: { h: story },
    content: { type: "doc", content: [{ type: "paragraph", content: [text("body")] }] },
  };
  const regions = new PageRegions(
    document,
    { measureIn: () => document.body, fieldCodes: true },
    new WeakMap(),
  );
  regions.setDocument(doc, [{ headers: { default: "h" } }], new Resolver(doc));
  return regions.drawing(0, "header", { first: false, number: 3, index: 2 })?.content.content
    .textContent;
}

describe("page fields in a header, field codes shown", () => {
  it("keeps private-use characters of a field code that look like a page field's mark", () => {
    const own = "";
    const shown = header([...field(` QUOTE ${own} `), ...field(" PAGE ")]);
    expect(shown).toContain(own);
    const inPage = header(field(` PAGE ${own} `));
    expect(inPage).toContain(own);
  });
});
