// Phase 30's acceptance: what Word's Paragraph, Font and Tabs dialogs set round-trips through
// .docx, set by the dialogs' commands.
import {
  chainCommands,
  createDocument,
  createEditor,
  paragraphFormatAt,
  runFormatAt,
  setAlign,
  setCharacterSpacing,
  setIndent,
  setLineSpacing,
  setOutlineLevel,
  setParagraphFlags,
  setParagraphSpacing,
  setRunEffects,
  setTabStops,
  setUnderline,
  setVerticalAlign,
} from "@folijs/core";
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx } from "./index.js";

describe("Phase 30 dialogs through .docx", () => {
  it("keeps every paragraph and run property the dialogs set", async () => {
    const editor = createEditor({ document: createDocument() });
    editor.commands.insertText("Dialogs");
    editor.select(1, 8);
    expect(
      editor.run(
        chainCommands([
          setAlign("justify"),
          setOutlineLevel(2),
          setIndent({ left: 36, right: 18, hanging: 9 }),
          setParagraphSpacing({ before: 6, after: 12 }),
          setLineSpacing(14, "exact"),
          setParagraphFlags({
            keepNext: true,
            keepLines: true,
            widowControl: false,
            pageBreakBefore: true,
            contextualSpacing: true,
          }),
          setTabStops({ set: [{ position: 144, alignment: "decimal", leader: "dot" }] }),
          setRunEffects({
            bold: true,
            italic: true,
            doubleStrike: true,
            smallCaps: true,
            hidden: true,
          }),
          setUnderline("wave", "#ff0000"),
          setVerticalAlign("superscript"),
          setCharacterSpacing(-1.5),
        ]),
      ),
    ).toBe(true);
    const paragraph = paragraphFormatAt(editor.state);
    const run = runFormatAt(editor.state);
    const { document } = await importDocx(await exportDocx(editor.getDocument()));
    const back = createEditor({ document });
    back.select(1, 8);
    expect(paragraphFormatAt(back.state)).toEqual(paragraph);
    expect(runFormatAt(back.state)).toEqual(run);
    expect(paragraph).toMatchObject({
      justification: "both",
      outlineLevel: 2,
      indent: { left: 720, right: 360, hanging: 180, firstLine: 0 },
      spacing: { before: 120, after: 240, line: 280, lineRule: "exact" },
      keepNext: true,
      widowControl: false,
      contextualSpacing: true,
      tabs: [{ position: 2880, kind: "decimal", leader: "dot" }],
    });
    expect(run).toMatchObject({
      bold: true,
      doubleStrike: true,
      smallCaps: true,
      hidden: true,
      underline: "wave",
      underlineColor: "FF0000",
      verticalAlign: "superscript",
      characterSpacing: -30,
    });
  });
});
