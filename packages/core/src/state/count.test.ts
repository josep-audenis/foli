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

  it("does not split words at a bookmark or count a field's code", () => {
    const editor = editorOf([
      p(
        text("wo"),
        { type: "bookmarkStart", attrs: { id: 0, name: "_GoBack" } },
        text("rd"),
        { type: "bookmarkEnd", attrs: { id: 0 } },
        text(" page "),
        { type: "fieldStart" },
        { type: "fieldCode", attrs: { text: " PAGE " } },
        { type: "fieldSeparator" },
        text("3"),
        { type: "fieldEnd" },
      ),
    ]);
    expect(countWords(editor.state)).toMatchObject({
      words: 3,
      characters: 9,
      charactersWithSpaces: 11,
    });
  });

  it("leaves note separators out", () => {
    const editor = editorOf([p(text("body"))], {
      s: {
        kind: "footnote",
        noteType: "separator",
        content: { type: "doc", content: [p(text("x y"))] },
      },
    });
    expect(countWords(editor.state, { notes: true }).words).toBe(1);
  });
});
