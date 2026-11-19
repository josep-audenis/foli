import { createDocument, FoliDocumentError, type NodeJSON, parseDocument } from "@folijs/core";
import { exportDocx, importDocx } from "@folijs/docx";
import { describe, expect, it } from "vitest";
import { fromWord, toWord } from "./docx.js";
import { controlsOf, customs, mention, sample } from "./sample.js";
import { mentionText } from "./spec.js";

const nodeText = (node: NodeJSON) => mentionText(node.attrs ?? {});

describe("custom nodes and marks in .docx (spike)", () => {
  it("are refused, never dropped, by a schema without them", () => {
    expect(() => parseDocument(sample())).toThrow(FoliDocumentError);
  });

  it("go out as tagged content controls and come back the same", async () => {
    const original = sample();
    const word = toWord(original, nodeText);
    const controls = Object.values(word.controls ?? {});
    expect(controls.map((c) => [c.kind, c.tag])).toEqual([
      ["text", 'foli:{"node":"acme:mention","attrs":{"id":"u-42","label":"Ada Lovelace"}}'],
      ["richText", 'foli:{"mark":"acme:topic","attrs":{"topic":"finance"}}'],
      ["richText", 'foli:{"mark":"acme:topic","attrs":{"topic":"finance"}}'],
      ["text", 'foli:{"node":"acme:mention","attrs":{"id":"u-7","label":"Grace"}}'],
      ["richText", 'foli:{"mark":"acme:topic","attrs":{"topic":"product-2027"}}'],
    ]);
    const bytes = await exportDocx(word);
    const { document } = await importDocx(bytes);
    // Without the mapping the controls stay: their kind, tag, lock and text are kept.
    expect(controlsOf(document)).toEqual(controlsOf(word));
    expect(controlsOf(word).map((c) => c.text)).toEqual([
      "@Ada Lovelace",
      "budget",
      "plan",
      "@Grace",
      "roadmap",
    ]);
    const back = fromWord(document);
    expect(customs(back.content)).toEqual(customs(original.content));
    // Bold on a mention comes back too.
    expect(customs(back.content)).toContainEqual({
      node: "acme:mention",
      attrs: { id: "u-7", label: "Grace" },
      marks: [{ type: "bold" }],
    });
    expect(back.controls).toEqual({});
  });

  it("refuses attributes too long for a tag instead of cutting them", () => {
    const doc = createDocument({
      type: "doc",
      content: [{ type: "paragraph", content: [mention("u-1", "x".repeat(200))] }],
    });
    expect(() => toWord(doc, nodeText)).toThrow(/do not fit a tag/);
  });
});
