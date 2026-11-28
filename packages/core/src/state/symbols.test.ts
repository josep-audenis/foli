import { describe, expect, it } from "vitest";
import type { NodeJSON } from "../model/index.js";
import type { FoliDocument } from "../v3/document.js";
import { insertSymbol } from "./commands.js";
import { createEditor } from "./editor.js";
import { undo } from "./history.js";

const p = (...content: NodeJSON[]): NodeJSON => ({ type: "paragraph", content });

function editorOf(blocks: NodeJSON[]) {
  const document: FoliDocument = {
    schemaVersion: 5,
    section: {},
    defaults: {},
    styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
    numbering: { abstracts: [], instances: [] },
    comments: [],
    content: { type: "doc", content: blocks },
  };
  return createEditor({ document });
}
const first = (editor: ReturnType<typeof editorOf>) => editor.getDocument().content.content?.[0];

describe("insertSymbol (35.1)", () => {
  it("inserts a symbol as text, in the text's own font without one", () => {
    const editor = editorOf([p({ type: "text", text: "ab" })]);
    editor.select(2);
    expect(editor.run(insertSymbol("©"))).toBe(true);
    expect(first(editor)).toEqual(p({ type: "text", text: "a©b" }));
    expect(editor.state.selection.from).toBe(3);
  });

  it("sets the Latin fonts to the symbol's font, as Word's Symbol dialog writes it, the rest kept", () => {
    const font = { type: "font", attrs: { eastAsia: "MS Mincho", ascii: "Aptos", hAnsi: "Aptos" } };
    const editor = editorOf([p({ type: "text", text: "ab", marks: [font] })]);
    editor.select(2);
    expect(editor.run(insertSymbol("☺", "Segoe UI Symbol"))).toBe(true);
    const marks = (first(editor)?.content ?? []).map((n) => [n.text, n.marks]);
    expect(marks).toEqual([
      ["a", [font]],
      [
        "☺",
        [
          {
            type: "font",
            attrs: { eastAsia: "MS Mincho", ascii: "Segoe UI Symbol", hAnsi: "Segoe UI Symbol" },
          },
        ],
      ],
      ["b", [font]],
    ]);
    // One undo step.
    editor.run(undo);
    expect(first(editor)).toEqual(p({ type: "text", text: "ab", marks: [font] }));
  });

  it("types Word's special characters on their keys", () => {
    const editor = editorOf([p({ type: "text", text: "x" })]);
    editor.select(2);
    for (const key of [
      "Mod-Alt-c",
      "Mod-Alt-r",
      "Mod-Alt-t",
      "Mod-Alt-.",
      "Mod-Alt--",
      "Mod-Shift- ",
      "Mod-Shift-_",
    ])
      expect(editor.handleKey(key)).toBe(true);
    expect(first(editor)).toEqual(p({ type: "text", text: "x©®™…— ‑" }));
  });
});
