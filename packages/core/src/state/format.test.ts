import { describe, expect, it } from "vitest";
import { createDocument } from "../document.js";
import type { NodeJSON } from "../model/index.js";
import type { DocJSON } from "../schema.js";
import { schemaV3 } from "../v3/index.js";
import {
  alignAt,
  colorAt,
  createEditor,
  type Editor,
  EditorState,
  listKindAt,
  setAlign,
  setBlockType,
  setHighlight,
  setTextColor,
  toggleList,
  wrapInList,
} from "./index.js";

const t = (text: string, ...marks: object[]): NodeJSON =>
  (marks.length ? { type: "text", text, marks } : { type: "text", text }) as NodeJSON;
const p = (text: string): NodeJSON => ({ type: "paragraph", content: [t(text)] }) as NodeJSON;

function editorWith(...blocks: NodeJSON[]): Editor {
  return createEditor({ document: createDocument({ type: "doc", content: blocks } as DocJSON) });
}
const json = (editor: Editor) => editor.getDocument().content.content;

describe("text color and highlight", () => {
  it("rejects colors that are not #rrggbb", () => {
    const editor = editorWith(p("ab"));
    editor.select(1, 3);
    for (const bad of ["red", "#fff", "#12345g", "rgb(0,0,0)", "", "#0000001"]) {
      expect(editor.commands.setTextColor(bad)).toBe(false);
      expect(editor.commands.setHighlight(bad)).toBe(false);
    }
    expect(json(editor)).toEqual([p("ab")]);
  });

  it("takes an uppercase color as lowercase; at a caret, colors the text typed next", () => {
    const editor = editorWith(p("ab"));
    editor.select(2);
    expect(editor.commands.setTextColor("#C00000")).toBe(true);
    expect(colorAt(editor.state, "textColor")).toBe("#c00000");
    editor.commands.insertText("x");
    expect(json(editor)).toEqual([
      {
        type: "paragraph",
        content: [t("a"), t("x", { type: "color", attrs: { value: "C00000" } }), t("b")],
      },
    ]);
  });
});

describe("on a state without a schema v3 envelope (no editor)", () => {
  it("the list, format and block type commands do not apply", () => {
    const doc = schemaV3.nodeFromJSON({ type: "doc", content: [p("ab")] });
    const state = EditorState.create({ doc });
    for (const command of [
      toggleList("bulletList"),
      wrapInList("orderedList"),
      setAlign("center"),
      setTextColor("#c00000"),
      setHighlight("#ffff00"),
      setBlockType("heading", { level: 1 }),
      setBlockType("paragraph"),
    ])
      expect(command(state)).toBe(false);
    expect(listKindAt(state)).toBeNull();
    expect(alignAt(state)).toBeNull();
    expect(colorAt(state, "textColor")).toBeNull();
  });
});
