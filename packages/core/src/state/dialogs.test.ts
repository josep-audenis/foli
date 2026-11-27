import { describe, expect, it } from "vitest";
import type { MarkJSON, NodeJSON } from "../model/index.js";
import type { FoliDocument } from "../v3/document.js";
import { chainCommands, openDialog, requestedDialog } from "./dialogs.js";
import { createEditor } from "./editor.js";
import { undo } from "./history.js";
import {
  paragraphFormatAt,
  runFormatAt,
  setCharacterSpacing,
  setIndent,
  setLineSpacing,
  setOutlineLevel,
  setParagraphFlags,
  setRunEffects,
} from "./wordformat.js";

const text = (value: string, marks?: MarkJSON[]): NodeJSON =>
  marks ? { type: "text", text: value, marks } : { type: "text", text: value };
const p = (attrs: Record<string, unknown>, ...content: NodeJSON[]): NodeJSON => ({
  type: "paragraph",
  ...(Object.keys(attrs).length ? { attrs } : {}),
  ...(content.length ? { content } : {}),
});

function editorOf(blocks: NodeJSON[], trackChanges = false) {
  const document: FoliDocument = {
    schemaVersion: 5,
    section: {},
    defaults: { run: [{ type: "fontSize", attrs: { value: 22 } }] },
    styles: [
      { id: "Normal", type: "paragraph", name: "Normal", isDefault: true },
      {
        id: "Heading1",
        type: "paragraph",
        name: "heading 1",
        basedOn: "Normal",
        paragraph: { keepNext: true, outlineLevel: 0, indent: { hanging: 360 } },
        run: [{ type: "caps" }],
      },
    ],
    numbering: { abstracts: [], instances: [] },
    comments: [],
    content: { type: "doc", content: blocks },
  };
  return createEditor({ document, author: "Me", trackChanges });
}
type Editor = ReturnType<typeof editorOf>;
const blocks = (editor: Editor) => editor.getDocument().content.content ?? [];
const attrsOf = (editor: Editor, i = 0) =>
  editor.state.doc.child(i).attrs as Record<string, unknown>;

describe("setIndent", () => {
  it("sets the parts given in points, one special indent at a time, and undoes in one step", () => {
    const editor = editorOf([p({}, text("one"))]);
    editor.select(2);
    expect(editor.run(setIndent({ left: 36, right: -9, firstLine: 18 }))).toBe(true);
    expect(attrsOf(editor).indent).toEqual({ left: 720, right: -180, firstLine: 360 });
    editor.run(setIndent({ hanging: 27 }));
    expect(attrsOf(editor).indent).toEqual({ left: 720, right: -180, hanging: 540 });
    editor.run(setIndent({ left: null, right: null, hanging: null }));
    expect(attrsOf(editor).indent).toBeNull();
    editor.run(undo);
    expect(attrsOf(editor).indent).toEqual({ left: 720, right: -180, hanging: 540 });
  });

  it("a first line replaces a style's hanging indent; out-of-range values do not apply", () => {
    const editor = editorOf([p({ style: "Heading1" }, text("one"))]);
    editor.select(2);
    editor.run(setIndent({ firstLine: 0 }));
    expect(paragraphFormatAt(editor.state)?.indent).toEqual({
      left: 0,
      right: 0,
      firstLine: 0,
      hanging: 0,
    });
    expect(editor.run(setIndent({ left: 2000 }))).toBe(false);
    expect(editor.run(setIndent({ hanging: -1 }))).toBe(false);
  });
});

describe("setLineSpacing with a rule", () => {
  it("writes a multiple, Exactly or At least", () => {
    const editor = editorOf([p({}, text("one"))]);
    editor.select(2);
    editor.run(setLineSpacing(1.5));
    expect(attrsOf(editor).spacing).toEqual({ line: 360, lineRule: "auto" });
    editor.run(setLineSpacing(12, "exact"));
    expect(attrsOf(editor).spacing).toEqual({ line: 240, lineRule: "exact" });
    editor.run(setLineSpacing(14.5, "atLeast"));
    expect(paragraphFormatAt(editor.state)?.spacing).toMatchObject({
      line: 290,
      lineRule: "atLeast",
    });
    expect(editor.run(setLineSpacing(2000, "exact"))).toBe(false);
    expect(editor.run(setLineSpacing(200))).toBe(false);
    editor.run(setLineSpacing(null));
    expect(attrsOf(editor).spacing).toBeNull();
  });
});

describe("setParagraphFlags and setOutlineLevel", () => {
  it("write a switch only where the style does not give it", () => {
    const editor = editorOf([p({ style: "Heading1" }, text("one")), p({}, text("two"))]);
    editor.select(2, 8);
    editor.run(setParagraphFlags({ keepNext: true, pageBreakBefore: true, keepLines: false }));
    expect(attrsOf(editor, 0)).toMatchObject({ keepNext: null, pageBreakBefore: true });
    expect(attrsOf(editor, 1)).toMatchObject({ keepNext: true, pageBreakBefore: true });
    // keepLines false is what both show already.
    expect(attrsOf(editor, 1).keepLines).toBeNull();
    editor.run(setParagraphFlags({ keepNext: false }));
    expect(attrsOf(editor, 0).keepNext).toBe(false);
    expect(attrsOf(editor, 1).keepNext).toBeNull();
    editor.run(setParagraphFlags({ contextualSpacing: true, widowControl: false }));
    expect(paragraphFormatAt(editor.state)).toMatchObject({
      contextualSpacing: true,
      widowControl: false,
      keepNext: false,
    });
    editor.run(setParagraphFlags({ pageBreakBefore: null }));
    expect(attrsOf(editor, 1).pageBreakBefore).toBeNull();
  });

  it("sets Level 1 to 9 or Body Text", () => {
    const editor = editorOf([p({ style: "Heading1" }, text("one")), p({}, text("two"))]);
    editor.select(9);
    editor.run(setOutlineLevel(2));
    expect(attrsOf(editor, 1).outlineLevel).toBe(2);
    editor.run(setOutlineLevel(null));
    expect(attrsOf(editor, 1).outlineLevel).toBeNull();
    editor.select(2);
    editor.run(setOutlineLevel(null));
    expect(attrsOf(editor, 0).outlineLevel).toBe(9);
    editor.run(setOutlineLevel(0));
    expect(attrsOf(editor, 0).outlineLevel).toBeNull();
    expect(editor.run(setOutlineLevel(9))).toBe(false);
  });
});

describe("paragraphFormatAt", () => {
  it("leaves out what the paragraphs differ in, part by part", () => {
    const editor = editorOf([
      p({ indent: { left: 720, right: 100 }, justification: "center" }, text("one")),
      p({ indent: { left: 360, right: 100 }, justification: "center" }, text("two")),
    ]);
    editor.select(2, 8);
    const format = paragraphFormatAt(editor.state);
    expect(format?.justification).toBe("center");
    expect(format?.indent).toEqual({ right: 100, firstLine: 0, hanging: 0 });
    expect("left" in (format?.indent ?? {})).toBe(false);
    expect(format?.outlineLevel).toBeNull();
  });

  it("takes what Word shows alike as the same value", () => {
    const editor = editorOf([
      p(
        { justification: "left", outlineLevel: 9, spacing: { line: 240, lineRule: "auto" } },
        text("a"),
      ),
      p({}, text("b")),
    ]);
    editor.select(1, 5);
    expect(paragraphFormatAt(editor.state)).toMatchObject({
      justification: "left",
      outlineLevel: null,
      spacing: { line: 240, lineRule: "auto" },
    });
  });
});

describe("setCharacterSpacing and setRunEffects", () => {
  it("expand or condense in points, back to the styles' with null", () => {
    const editor = editorOf([p({}, text("abc"))]);
    editor.select(1, 4);
    editor.run(setCharacterSpacing(1.5));
    expect(blocks(editor)[0]?.content?.[0]?.marks).toEqual([
      { type: "characterSpacing", attrs: { value: 30 } },
    ]);
    expect(runFormatAt(editor.state)?.characterSpacing).toBe(30);
    editor.run(setCharacterSpacing(-1));
    expect(runFormatAt(editor.state)?.characterSpacing).toBe(-20);
    editor.run(setCharacterSpacing(null));
    expect(blocks(editor)[0]?.content?.[0]?.marks).toBeUndefined();
    expect(editor.run(setCharacterSpacing(2000))).toBe(false);
  });

  it("turn effects on and off in one step, one of each exclusive pair", () => {
    const editor = editorOf([p({}, text("abc", [{ type: "strike" }]))]);
    editor.select(1, 4);
    expect(editor.run(setRunEffects({ doubleStrike: true, caps: true, hidden: true }))).toBe(true);
    expect(runFormatAt(editor.state)).toMatchObject({
      strike: false,
      doubleStrike: true,
      caps: true,
      smallCaps: false,
      hidden: true,
    });
    expect(
      blocks(editor)[0]
        ?.content?.[0]?.marks?.map((m) => m.type)
        .sort(),
    ).toEqual(["caps", "doubleStrike", "hidden"]);
    editor.run(undo);
    expect(blocks(editor)[0]?.content?.[0]?.marks).toEqual([{ type: "strike" }]);
  });

  it("write off over a style's effect, and nothing where the style gives the value", () => {
    const editor = editorOf([p({ style: "Heading1" }, text("abc"))]);
    editor.select(1, 4);
    editor.run(setRunEffects({ caps: false }));
    expect(blocks(editor)[0]?.content?.[0]?.marks).toEqual([
      { type: "caps", attrs: { value: false } },
    ]);
    editor.run(setRunEffects({ caps: true }));
    expect(blocks(editor)[0]?.content?.[0]?.marks).toBeUndefined();
  });

  it("set the text typed next at a caret", () => {
    const editor = editorOf([p({}, text("abc"))]);
    editor.select(2);
    editor.run(setRunEffects({ smallCaps: true }));
    expect(runFormatAt(editor.state)?.smallCaps).toBe(true);
  });

  it("give the paragraph's where no text is selected", () => {
    const editor = editorOf([p({}), p({})]);
    editor.select(1, 3);
    expect(runFormatAt(editor.state)).toMatchObject({ size: 22, caps: false });
  });

  it("leave out what mixed runs differ in", () => {
    const editor = editorOf([p({}, text("ab", [{ type: "caps" }]), text("cd"))]);
    editor.select(1, 5);
    const format = runFormatAt(editor.state);
    expect("caps" in (format ?? {})).toBe(false);
    expect(format?.hidden).toBe(false);
  });
});

describe("tracking", () => {
  it("records paragraph and run changes as formatting changes", () => {
    const editor = editorOf([p({}, text("abc"))], true);
    editor.select(1, 4);
    editor.run(setIndent({ left: 36 }));
    editor.run(setParagraphFlags({ keepNext: true }));
    editor.run(setCharacterSpacing(2));
    editor.run(setRunEffects({ smallCaps: true }));
    expect(attrsOf(editor).formatChange).toMatchObject({ author: "Me" });
    const marks = blocks(editor)[0]?.content?.[0]?.marks?.map((m) => m.type);
    expect(marks).toContain("formatChange");
    expect(marks).toContain("characterSpacing");
  });
});

describe("openDialog and chainCommands", () => {
  it("asks for a dialog with a transaction that changes nothing", () => {
    const editor = editorOf([p({}, text("abc"))]);
    editor.select(2);
    const asked: (string | null)[] = [];
    editor.subscribe((_state, transactions) => {
      for (const tr of transactions) asked.push(requestedDialog(tr));
    });
    expect(editor.commands.openDialog("paragraph")).toBe(true);
    expect(asked).toEqual(["paragraph"]);
    expect(editor.run(openDialog("nope" as "paragraph"))).toBe(false);
  });

  it("runs commands as one transaction, one undo step", () => {
    const editor = editorOf([p({}, text("abc"))]);
    editor.select(1, 4);
    const both = chainCommands([setIndent({ left: 36 }), setCharacterSpacing(1)]);
    expect(editor.run(both)).toBe(true);
    expect(attrsOf(editor).indent).toEqual({ left: 720 });
    editor.run(undo);
    expect(attrsOf(editor).indent).toBeNull();
    expect(blocks(editor)[0]?.content?.[0]?.marks).toBeUndefined();
    expect(editor.run(chainCommands([setIndent({ left: 5000 })]))).toBe(false);
  });
});
