import { describe, expect, it } from "vitest";
import type { NodeJSON } from "../model/index.js";
import { countWords } from "./count.js";
import { createEditor } from "./editor.js";

const p = (...content: NodeJSON[]): NodeJSON => ({ type: "paragraph", content });
const text = (value: string, deletion = false): NodeJSON => ({
  type: "text",
  text: value,
  ...(deletion ? { marks: [{ type: "deletion", attrs: { id: 1, author: "A", date: null } }] } : {}),
});

const editorOf = (blocks: NodeJSON[], stories = {}) =>
  createEditor({
    document: {
      schemaVersion: 5,
      section: {},
      defaults: {},
      styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
      numbering: { abstracts: [], instances: [] },
      comments: [],
      stories,
      content: { type: "doc", content: blocks },
    },
  });

describe("countWords", () => {
  it("counts as Word: words, characters with and without spaces, paragraphs", () => {
    const editor = editorOf([
      p(text("The quick brown fox — jumps.")),
      { type: "paragraph" },
      p(text("Well-known  re-use")),
    ]);
    expect(countWords(editor.state)).toEqual({
      // A dash between spaces is a word of its own, as Word counts it.
      words: 8,
      characters: 39,
      charactersWithSpaces: 46,
      paragraphs: 2,
    });
  });

  it("leaves out deleted text; counts a range", () => {
    const editor = editorOf([p(text("one "), text("two ", true), text("three"))]);
    expect(countWords(editor.state).words).toBe(2);
    expect(countWords(editor.state, { from: 1, to: 4 }).words).toBe(1);
  });

  it("counts notes on request", () => {
    const editor = editorOf([p(text("body"))], {
      n1: { kind: "footnote", content: { type: "doc", content: [p(text("a note here"))] } },
    });
    expect(countWords(editor.state).words).toBe(1);
    expect(countWords(editor.state, { notes: true })).toMatchObject({ words: 4, paragraphs: 2 });
  });
});
