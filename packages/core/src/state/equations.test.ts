import { describe, expect, it } from "vitest";
import type { NodeJSON } from "../model/index.js";
import { createDocument, parseDocument, SCHEMA_VERSION } from "../v3/document.js";
import { createEditor } from "./editor.js";
import { insertEquation, isDisplayEquation, selectedEquation, setEquation } from "./equations.js";
import { findAll } from "./find.js";
import { undo } from "./history.js";
import { setTrackChanges } from "./track.js";

const OMATH =
  '<m:oMath><m:r><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr><m:t>x=2</m:t></m:r></m:oMath>';
const DISPLAY = `<m:oMathPara>${OMATH}</m:oMathPara>`;
const p = (...content: NodeJSON[]): NodeJSON => ({ type: "paragraph", content });
const editorOf = (content: NodeJSON[]) =>
  createEditor({
    document: {
      ...createDocument(),
      schemaVersion: SCHEMA_VERSION,
      styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
      content: { type: "doc", content },
    },
  });

describe("equations (35.5, schema 12)", () => {
  it("are inserted at the selection, selected, in one undo step, found by their characters", () => {
    const editor = editorOf([p({ type: "text", text: "ab" })]);
    editor.select(2);
    expect(editor.run(insertEquation(OMATH))).toBe(true);
    const [, equation] = editor.getDocument().content.content?.[0]?.content ?? [];
    expect(equation).toEqual({ type: "equation", attrs: { xml: OMATH } });
    expect(selectedEquation(editor.state)?.pos).toBe(2);
    expect(findAll(editor, "x=2")).toHaveLength(1);
    expect(editor.getDocument().schemaVersion).toBe(12);
    editor.run(undo);
    expect(editor.getDocument().content.content?.[0]).toEqual(p({ type: "text", text: "ab" }));
  });

  it("change their OMML in one step, and refuse what is not an equation or while tracking", () => {
    const editor = editorOf([p({ type: "equation", attrs: { xml: OMATH } })]);
    expect(isDisplayEquation(DISPLAY)).toBe(true);
    expect(isDisplayEquation(OMATH)).toBe(false);
    expect(editor.run(setEquation(1, DISPLAY))).toBe(true);
    expect(editor.state.doc.nodeAt(1)?.attrs.xml).toBe(DISPLAY);
    expect(editor.run(setEquation(1, "<w:r/>"))).toBe(false);
    expect(editor.run(insertEquation("<w:r><w:t>x</w:t></w:r>"))).toBe(false);
    editor.run(undo);
    expect(editor.state.doc.nodeAt(1)?.attrs.xml).toBe(OMATH);
    editor.run(setTrackChanges(true));
    expect(editor.run(setEquation(1, DISPLAY))).toBe(false);
    expect(editor.run(insertEquation(OMATH))).toBe(false);
  });

  it("need schema 12; a document saying 11 holding one is refused", () => {
    const document = {
      ...createDocument(),
      schemaVersion: 11,
      content: { type: "doc", content: [p({ type: "equation", attrs: { xml: OMATH } })] },
    };
    expect(() => parseDocument(document)).toThrow(/equation.*schema 12/);
    expect(() =>
      parseDocument({
        ...document,
        schemaVersion: 12,
        content: { type: "doc", content: [p({ type: "equation", attrs: { xml: "<w:r/>" } })] },
      }),
    ).toThrow(/m:oMath or m:oMathPara/);
  });
});
