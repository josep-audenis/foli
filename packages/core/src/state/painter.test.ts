import { describe, expect, it } from "vitest";
import type { MarkJSON, NodeJSON } from "../model/index.js";
import type { FoliDocument } from "../v3/document.js";
import { createEditor } from "./editor.js";
import { copyFormat, formatPainterState, pasteFormat, stopFormatPainter } from "./wordformat.js";
import { wordKeymap } from "./wordkeys.js";

const text = (value: string, marks?: MarkJSON[]): NodeJSON =>
  marks ? { type: "text", text: value, marks } : { type: "text", text: value };
const p = (attrs: Record<string, unknown>, ...content: NodeJSON[]): NodeJSON => ({
  type: "paragraph",
  ...(Object.keys(attrs).length ? { attrs } : {}),
  ...(content.length ? { content } : {}),
});
const bold: MarkJSON = { type: "bold" };
const red: MarkJSON = { type: "color", attrs: { value: "FF0000" } };
const link: MarkJSON = { type: "link", attrs: { href: "https://example.com" } };

function editorOf(blocks: NodeJSON[], plugins = false) {
  const document: FoliDocument = {
    schemaVersion: 5,
    section: {},
    defaults: {},
    styles: [
      { id: "Normal", type: "paragraph", name: "Normal", isDefault: true },
      { id: "Heading1", type: "paragraph", name: "heading 1", basedOn: "Normal" },
    ],
    numbering: { abstracts: [], instances: [] },
    comments: [],
    content: { type: "doc", content: blocks },
  };
  return createEditor({ document, ...(plugins ? { plugins: [wordKeymap()] } : {}) });
}
type Editor = ReturnType<typeof editorOf>;
const blocks = (editor: Editor) => editor.getDocument().content.content ?? [];

describe("format painter", () => {
  it("copies the formatting at the selection and gives it to the next selection once", () => {
    const editor = editorOf([p({}, text("ab", [bold, red]), text(" cd", [link]))]);
    editor.select(1, 2);
    expect(editor.run(copyFormat("once"))).toBe(true);
    expect(formatPainterState(editor.state)).toEqual({ copied: true, armed: "once" });
    editor.select(4, 6);
    expect(editor.run(pasteFormat)).toBe(true);
    // The link is not formatting: it stays.
    expect(blocks(editor)[0]).toEqual(
      p({}, text("ab", [bold, red]), text(" ", [link]), text("cd", [link, bold, red])),
    );
    expect(formatPainterState(editor.state)).toEqual({ copied: true, armed: null });
    // Undone in one step.
    editor.commands.undo();
    expect(blocks(editor)[0]).toEqual(p({}, text("ab", [bold, red]), text(" cd", [link])));
  });

  it("replaces the target's own formatting; at a caret, the word's", () => {
    const editor = editorOf([p({}, text("ab"), text(" cd", [red]))]);
    editor.select(2);
    editor.run(copyFormat("sticky"));
    editor.select(5);
    editor.run(pasteFormat);
    expect(blocks(editor)[0]).toEqual(p({}, text("ab"), text(" ", [red]), text("cd")));
    // Sticky: still armed, until stopped.
    expect(formatPainterState(editor.state).armed).toBe("sticky");
    expect(editor.handleKey("Escape")).toBe(true);
    expect(formatPainterState(editor.state).armed).toBe(null);
    expect(editor.run(stopFormatPainter)).toBe(false);
  });

  it("gives paragraph properties to paragraphs the selection covers whole", () => {
    const editor = editorOf([
      p({ style: "Heading1", justification: "center" }, text("ab")),
      p({}, text("cd")),
      p({}, text("ef")),
    ]);
    editor.select(2);
    editor.run(copyFormat());
    // All of "cd", part of "ef".
    editor.select(5, 10);
    editor.run(pasteFormat);
    expect(blocks(editor).map((b) => b.attrs ?? {})).toEqual([
      { style: "Heading1", justification: "center" },
      { style: "Heading1", justification: "center" },
      {},
    ]);
  });

  it("changes nothing where the formatting is already the copied one", () => {
    const editor = editorOf([p({}, text("ab", [bold]), text(" cd", [bold]))]);
    editor.select(1, 2);
    editor.run(copyFormat("sticky"));
    const before = editor.state.doc;
    editor.select(4, 6);
    editor.run(pasteFormat);
    expect(editor.state.doc).toBe(before);
  });

  it("a click on no word puts a once-armed painter away; a click paints no paragraph", () => {
    const editor = editorOf([p({ style: "Heading1" }, text("ab")), p({}, text("one 2"))]);
    editor.select(2);
    editor.run(copyFormat("once"));
    editor.select(9);
    expect(editor.run(pasteFormat)).toBe(true);
    expect(formatPainterState(editor.state).armed).toBe(null);
    editor.run(copyFormat("once"));
    // A caret in a one-word paragraph: the word gets the run formatting, not the style.
    editor.select(6);
    editor.run(pasteFormat);
    expect(blocks(editor)[1]?.attrs ?? {}).toEqual({});
  });

  it("does nothing before something is copied", () => {
    const editor = editorOf([p({}, text("ab"))]);
    editor.select(1, 3);
    expect(editor.run(pasteFormat)).toBe(false);
  });
});

describe("wordKeymap", () => {
  it("gives Word's keys: copy and paste formatting, change case, bullets", () => {
    const editor = editorOf([p({}, text("ab", [bold]), text(" cd"))], true);
    editor.select(1, 2);
    expect(editor.handleKey("Mod-Shift-c")).toBe(true);
    editor.select(4, 6);
    expect(editor.handleKey("Mod-Shift-v")).toBe(true);
    expect(blocks(editor)[0]).toEqual(p({}, text("ab", [bold]), text(" "), text("cd", [bold])));
    expect(editor.handleKey("Shift-F3")).toBe(true);
    expect(blocks(editor)[0]?.content?.at(-1)?.text).toBe("Cd");
    expect(editor.handleKey("Mod-Shift-l")).toBe(true);
    expect(blocks(editor)[0]?.attrs?.numbering).toBeTruthy();
  });

  it("leaves Ctrl+Shift+V to the plain-text paste while nothing is copied", () => {
    const editor = editorOf([p({}, text("ab"))], true);
    editor.select(1, 3);
    expect(editor.handleKey("Mod-Shift-v")).toBe(false);
  });
});
