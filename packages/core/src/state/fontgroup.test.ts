import { describe, expect, it } from "vitest";
import type { MarkJSON, NodeJSON } from "../model/index.js";
import type { FoliDocument } from "../v3/document.js";
import { createEditor } from "./editor.js";
import {
  changeCase,
  clearFormatting,
  nextFontSize,
  setUnderline,
  stepFontSize,
  toggleVerticalAlign,
  underlineAt,
  verticalAlignAt,
} from "./wordformat.js";

const text = (value: string, marks?: MarkJSON[]): NodeJSON =>
  marks ? { type: "text", text: value, marks } : { type: "text", text: value };
const p = (attrs: Record<string, unknown>, ...content: NodeJSON[]): NodeJSON => ({
  type: "paragraph",
  ...(Object.keys(attrs).length ? { attrs } : {}),
  ...(content.length ? { content } : {}),
});
const bold: MarkJSON = { type: "bold" };
const size = (value: number): MarkJSON => ({
  type: "fontSize",
  attrs: { value, complexScript: value },
});

function editorOf(blocks: NodeJSON[], trackChanges = false) {
  const document: FoliDocument = {
    schemaVersion: 5,
    section: {},
    defaults: { run: [{ type: "fontSize", attrs: { value: 22 } }] },
    styles: [
      { id: "Normal", type: "paragraph", name: "Normal", isDefault: true },
      { id: "Heading1", type: "paragraph", name: "heading 1", basedOn: "Normal" },
      { id: "Strong", type: "character", name: "Strong" },
    ],
    numbering: { abstracts: [], instances: [] },
    comments: [],
    content: { type: "doc", content: blocks },
  };
  return createEditor({ document, author: "Me", trackChanges });
}
type Editor = ReturnType<typeof editorOf>;
const blocks = (editor: Editor) => editor.getDocument().content.content ?? [];
const textOf = (editor: Editor) =>
  blocks(editor)
    .map((b) => (b.content ?? []).map((t) => t.text ?? "").join(""))
    .join("\n");

describe("superscript and subscript", () => {
  it("raise or lower the selection, and put it back on its baseline", () => {
    const editor = editorOf([p({}, text("x2"))]);
    editor.select(2, 3);
    expect(verticalAlignAt(editor.state)).toBe("baseline");
    expect(editor.run(toggleVerticalAlign("superscript"))).toBe(true);
    expect(blocks(editor)[0]).toEqual(
      p({}, text("x"), text("2", [{ type: "verticalAlign", attrs: { value: "superscript" } }])),
    );
    expect(verticalAlignAt(editor.state)).toBe("superscript");
    editor.run(toggleVerticalAlign("subscript"));
    expect(verticalAlignAt(editor.state)).toBe("subscript");
    editor.run(toggleVerticalAlign("subscript"));
    expect(blocks(editor)[0]).toEqual(p({}, text("x2")));
  });

  it("have Word's keys", () => {
    const editor = editorOf([p({}, text("x2"))]);
    editor.select(2, 3);
    expect(editor.handleKey("Mod-Shift-+")).toBe(true);
    expect(verticalAlignAt(editor.state)).toBe("superscript");
    expect(editor.handleKey("Mod-=")).toBe(true);
    expect(verticalAlignAt(editor.state)).toBe("subscript");
  });
});

describe("clearFormatting", () => {
  const link: MarkJSON = { type: "link", attrs: { href: "https://example.com" } };
  const strong: MarkJSON = { type: "characterStyle", attrs: { id: "Strong" } };
  const yellow: MarkJSON = { type: "highlight", attrs: { value: "yellow" } };

  it("takes direct formatting off, keeping links and the character style (Ctrl+Space)", () => {
    const editor = editorOf([p({}, text("ab", [link, strong, bold, yellow, size(40)]))]);
    editor.select(1, 3);
    expect(editor.handleKey("Mod- ")).toBe(true);
    expect(blocks(editor)[0]).toEqual(p({}, text("ab", [link, strong])));
    expect(editor.run(clearFormatting())).toBe(false);
  });

  it("clears all: the character style and paragraph style too, the highlight stays", () => {
    const editor = editorOf([p({ style: "Heading1" }, text("ab", [strong, bold, yellow]))]);
    editor.select(1, 3);
    expect(editor.run(clearFormatting({ all: true }))).toBe(true);
    expect(blocks(editor)[0]).toEqual(p({}, text("ab", [yellow])));
  });

  it("at a caret, clears what is typed next", () => {
    const editor = editorOf([p({}, text("ab", [bold]))]);
    editor.select(2);
    expect(editor.run(clearFormatting())).toBe(true);
    editor.commands.insertText("c");
    expect(blocks(editor)[0]).toEqual(p({}, text("a", [bold]), text("c"), text("b", [bold])));
  });

  it("is undone in one step", () => {
    const editor = editorOf([p({}, text("ab", [bold, size(40)]))]);
    editor.select(1, 3);
    editor.run(clearFormatting());
    editor.commands.undo();
    expect(blocks(editor)[0]).toEqual(p({}, text("ab", [bold, size(40)])));
  });
});

describe("changeCase", () => {
  it("changes the selection's case, its formatting kept", () => {
    const editor = editorOf([p({}, text("hello "), text("big", [bold]), text(" world"))]);
    editor.select(1, 16);
    editor.run(changeCase("upper"));
    expect(blocks(editor)[0]).toEqual(p({}, text("HELLO "), text("BIG", [bold]), text(" WORLD")));
    editor.run(changeCase("title"));
    expect(textOf(editor)).toBe("Hello Big World");
    editor.run(changeCase("lower"));
    editor.run(changeCase("sentence"));
    expect(textOf(editor)).toBe("Hello big world");
    editor.run(changeCase("toggle"));
    expect(textOf(editor)).toBe("hELLO BIG WORLD");
    // The selection stays on the text.
    expect([editor.state.selection.from, editor.state.selection.to]).toEqual([1, 16]);
  });

  it("cycles as Shift+F3: lowercase, Capitalize Each Word, UPPERCASE", () => {
    const editor = editorOf([p({}, text("one two"))]);
    editor.select(1, 8);
    editor.run(changeCase("cycle"));
    expect(textOf(editor)).toBe("One Two");
    editor.run(changeCase("cycle"));
    expect(textOf(editor)).toBe("ONE TWO");
    editor.run(changeCase("cycle"));
    expect(textOf(editor)).toBe("one two");
  });

  it("changes the word at a caret; nothing between words", () => {
    const editor = editorOf([p({}, text("one two"))]);
    editor.select(6);
    expect(editor.run(changeCase("upper"))).toBe(true);
    expect(textOf(editor)).toBe("one TWO");
    editor.select(4);
    editor.run(changeCase("upper"));
    expect(textOf(editor)).toBe("ONE TWO");
    expect(editorOf([p({}, text("1 2"))]).run(changeCase("upper"))).toBe(false);
  });

  it("is tracked while tracking, and leaves deleted text as it is", () => {
    const editor = editorOf([p({}, text("ab"))], true);
    editor.select(1, 3);
    editor.run(changeCase("upper"));
    const runs = blocks(editor)[0]?.content ?? [];
    expect(runs.map((r) => [r.text, r.marks?.map((m) => m.type)])).toEqual([
      ["ab", ["deletion"]],
      ["AB", ["insertion"]],
    ]);
    editor.select(1, 5);
    editor.run(changeCase("lower"));
    expect((blocks(editor)[0]?.content ?? []).map((r) => r.text)).toEqual(["ab", "ab"]);
  });

  it("cases each paragraph on its own", () => {
    const editor = editorOf([p({}, text("foo")), p({}, text("bar"))]);
    editor.select(1, 9);
    editor.run(changeCase("title"));
    expect(textOf(editor)).toBe(["Foo", "Bar"].join("\n"));
    const sentences = editorOf([p({}, text("HELLO.")), p({}, text("WORLD"))]);
    sentences.select(1, 15);
    sentences.run(changeCase("sentence"));
    expect(textOf(sentences)).toBe(["Hello.", "World"].join("\n"));
  });

  it("keeps each run's formatting when a case changes a run's length (ß)", () => {
    const editor = editorOf([p({}, text("aß"), text("bc", [bold]))]);
    editor.select(1, 5);
    editor.run(changeCase("upper"));
    expect(blocks(editor)[0]).toEqual(p({}, text("ASS"), text("BC", [bold])));
  });

  it("at a caret, Clear All clears what is typed next too", () => {
    const editor = editorOf([p({ style: "Heading1" }, text("ab", [bold]))]);
    editor.select(2);
    expect(editor.run(clearFormatting({ all: true }))).toBe(true);
    editor.commands.insertText("c");
    expect(blocks(editor)[0]).toEqual(p({}, text("a", [bold]), text("c"), text("b", [bold])));
  });

  it("keeps the text when a case changes its length (ß)", () => {
    const editor = editorOf([p({}, text("straße"))]);
    editor.select(1, 7);
    editor.run(changeCase("upper"));
    expect(textOf(editor)).toBe("STRASSE");
  });
});

describe("grow and shrink font", () => {
  it("steps through Word's sizes", () => {
    expect(nextFontSize(11, 1)).toBe(12);
    expect(nextFontSize(10.5, 1)).toBe(11);
    expect(nextFontSize(28, 1)).toBe(36);
    expect(nextFontSize(72, 1)).toBe(80);
    expect(nextFontSize(5, 1)).toBe(6);
    expect(nextFontSize(12, -1)).toBe(11);
    expect(nextFontSize(8, -1)).toBe(7);
    expect(nextFontSize(80, -1)).toBe(72);
    expect(nextFontSize(90, -1)).toBe(80);
    expect(nextFontSize(1, -1)).toBe(1);
    expect(nextFontSize(1638, 1)).toBe(1638);
  });

  it("grows each run from its own size (Ctrl+Shift+>, Ctrl+Shift+<)", () => {
    const editor = editorOf([p({}, text("a"), text("b", [size(28)]))]);
    editor.select(1, 3);
    expect(editor.handleKey("Mod-Shift->")).toBe(true);
    // Each script's size from its own: the document's complex-script size is Word's 10 pt.
    const sizes = (value: number, complexScript: number): MarkJSON => ({
      type: "fontSize",
      attrs: { value, complexScript },
    });
    expect(blocks(editor)[0]).toEqual(p({}, text("a", [sizes(24, 22)]), text("b", [size(32)])));
    editor.handleKey("Mod-Shift-<");
    editor.handleKey("Mod-Shift-<");
    expect(blocks(editor)[0]).toEqual(p({}, text("a", [sizes(20, 18)]), text("b", [size(24)])));
  });
});

describe("underline styles", () => {
  it("sets a style, removes it, reads it", () => {
    const editor = editorOf([p({}, text("ab"))]);
    editor.select(1, 3);
    expect(underlineAt(editor.state)).toBe("none");
    editor.run(setUnderline("double"));
    expect(underlineAt(editor.state)).toBe("double");
    expect(blocks(editor)[0]).toEqual(
      p({}, text("ab", [{ type: "underline", attrs: { style: "double" } }])),
    );
    editor.run(setUnderline(null));
    expect(blocks(editor)[0]).toEqual(p({}, text("ab")));
  });
});
