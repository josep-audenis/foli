import { describe, expect, it } from "vitest";
import { createDocument, type FoliDocument } from "../v3/document.js";
import { createEditor } from "./editor.js";
import { undo } from "./history.js";
import { trackedChanges } from "./review.js";
import {
  paragraphBordersAt,
  setParagraphBorder,
  setParagraphBorders,
  setParagraphShading,
} from "./wordformat.js";

/** Home ▸ Borders and Shading for paragraphs (32.4). */

const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const editorOf = (trackChanges = false) =>
  createEditor({
    document: {
      ...createDocument(),
      content: { type: "doc", content: [p("one"), p("two")] },
    } as FoliDocument,
    trackChanges,
    author: "Ann",
  });
const bordersOf = (editor: ReturnType<typeof editorOf>, i: number) =>
  editor.state.doc.child(i).attrs.borders;
const line = { style: "single", size: 4, space: 1, color: "auto" };

describe("paragraph borders", () => {
  it("turns a side on and off, as Word's menu, in one undo step each", () => {
    const editor = editorOf();
    editor.select(1, 8);
    expect(editor.run(setParagraphBorder("bottom"))).toBe(true);
    expect(bordersOf(editor, 0)).toEqual({ bottom: line });
    expect(bordersOf(editor, 1)).toEqual({ bottom: line });
    editor.run(setParagraphBorder("bottom"));
    expect(bordersOf(editor, 0)).toBeNull();
    editor.run(setParagraphBorder("outside"));
    expect(Object.keys(bordersOf(editor, 1) ?? {}).sort()).toEqual([
      "bottom",
      "left",
      "right",
      "top",
    ]);
    expect((bordersOf(editor, 1) as { left: { space: number } }).left.space).toBe(4);
    editor.run(setParagraphBorder("inside"));
    expect(bordersOf(editor, 0)).toHaveProperty("between");
    expect(paragraphBordersAt(editor.state)?.borders).toHaveProperty("top");
    editor.run(setParagraphBorder("none"));
    expect(bordersOf(editor, 0)).toBeNull();
    editor.run(undo);
    expect(bordersOf(editor, 0)).toHaveProperty("between");
  });

  it("sets borders and shading from the dialog, and refuses what the schema does not take", () => {
    const editor = editorOf();
    editor.select(2);
    const box = { top: { style: "double", size: 6, space: 1, color: "FF0000" } };
    expect(editor.run(setParagraphBorders(box))).toBe(true);
    expect(bordersOf(editor, 0)).toEqual(box);
    expect(bordersOf(editor, 1)).toBeNull();
    expect(editor.can(setParagraphBorders({ top: { style: "single", size: 500 } }))).toBe(false);
    expect(
      editor.run(setParagraphShading({ pattern: "clear", color: "auto", fill: "FFFF00" })),
    ).toBe(true);
    expect(paragraphBordersAt(editor.state)?.shading).toEqual({
      pattern: "clear",
      color: "auto",
      fill: "FFFF00",
    });
    expect(editor.can(setParagraphShading({ pattern: "clear", fill: "yellow" }))).toBe(false);
    editor.run(setParagraphShading(null));
    expect(editor.state.doc.child(0).attrs.shading).toBeNull();
  });

  it("is tracked as paragraph formatting", () => {
    const editor = editorOf(true);
    editor.select(2);
    editor.run(setParagraphBorder("bottom"));
    expect(trackedChanges(editor.state.doc).map((c) => c.kind)).toEqual(["paragraphFormatting"]);
  });
});
