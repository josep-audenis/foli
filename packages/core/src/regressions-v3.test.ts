import { describe, expect, it } from "vitest";
import { createDocument, parseDocument } from "./v3/document.js";
import { formatNumber, Resolver } from "./v3/resolve.js";

describe("regressions: v3", () => {
  it("formatNumber: a large chicago counter does not throw", () => {
    expect(() => formatNumber(2_147_483_647, "chicago")).not.toThrow();
  });

  it("markers: a valid document with a huge chicago start resolves", () => {
    const doc = parseDocument({
      ...createDocument({
        type: "doc",
        content: [{ type: "paragraph", attrs: { numbering: { id: 1, level: 0 } } }],
      }),
      numbering: {
        abstracts: [
          { id: 0, levels: [{ level: 0, start: 2_147_483_647, format: "chicago", text: "%1" }] },
        ],
        instances: [{ id: 1, abstract: 0 }],
      },
    });
    const resolver = new Resolver(doc);
    expect(() => resolver.markers([{ numbering: { id: 1, level: 0 } }])).not.toThrow();
  });

  it("parseDocument: a foreign custom node's content is not dropped silently", () => {
    const input = createDocument({
      type: "doc",
      content: [
        {
          type: "acme:callout",
          attrs: { tone: "warn" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "precious words" }] }],
        },
        { type: "paragraph" },
      ],
    });
    let out: unknown;
    try {
      out = parseDocument(input);
    } catch {
      return; // refusing it is fine: nothing is lost
    }
    expect(JSON.stringify(out)).toContain("precious words");
  });
});
