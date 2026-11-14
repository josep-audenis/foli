import { describe, expect, it } from "vitest";
import type { MarkJSON, NodeJSON } from "../model/index.js";
import type { FoliDocumentV3, StyleJSON } from "../v3/document.js";
import { createEditor } from "./editor.js";
import { NodeSelection, TextSelection } from "./selection.js";

const STYLES: StyleJSON[] = [
  { id: "Normal", type: "paragraph", name: "Normal", isDefault: true, next: "Normal" },
  {
    id: "Heading1",
    type: "paragraph",
    name: "heading 1",
    basedOn: "Normal",
    next: "Normal",
    paragraph: { outlineLevel: 0, keepNext: true },
    run: [{ type: "bold" }],
  },
  { id: "Quote", type: "paragraph", name: "Quote", basedOn: "Normal" },
  {
    id: "Hyperlink",
    type: "character",
    name: "Hyperlink",
    run: [{ type: "underline", attrs: { style: "single" } }],
  },
];

const text = (value: string, marks?: MarkJSON[]): NodeJSON =>
  marks ? { type: "text", text: value, marks } : { type: "text", text: value };
const p = (attrs: Record<string, unknown>, ...content: NodeJSON[]): NodeJSON => ({
  type: "paragraph",
  ...(Object.keys(attrs).length ? { attrs } : {}),
  ...(content.length ? { content } : {}),
});

function documentOf(...blocks: NodeJSON[]): FoliDocumentV3 {
  return {
    schemaVersion: 3,
    section: { pageSize: { width: 11906, height: 16838 }, margins: { top: 1440, left: 1800 } },
    defaults: {},
    styles: STYLES,
    numbering: { abstracts: [], instances: [] },
    comments: [],
    content: { type: "doc", content: blocks },
  };
}

function editorOf(...blocks: NodeJSON[]) {
  return createEditor({ document: documentOf(...blocks) });
}
const blocks = (editor: ReturnType<typeof editorOf>) => editor.getDocument().content.content ?? [];

describe("an editor on a schema v3 document", () => {
  it("keeps the envelope and gives page settings from the last section", () => {
    const editor = editorOf(p({}, text("Hello")));
    const document = editor.getDocument();
    expect(document.schemaVersion).toBe(3);
    expect(document.styles).toEqual(STYLES);
    expect(document.section).toEqual(documentOf().section);
    // A4 in twips; unset margins are Word's inch.
    expect(editor.settings.pageSize.width).toBeCloseTo(210, 1);
    expect(editor.settings.pageSize.height).toBeCloseTo(297, 1);
    expect(editor.settings.margins).toEqual({ top: 25.4, right: 25.4, bottom: 25.4, left: 31.75 });
    editor.select(6);
    editor.commands.insertText("!");
    expect(blocks(editor)).toEqual([p({}, text("Hello!"))]);
    // What it returns is a copy: changing it changes nothing in the editor.
    document.styles.length = 0;
    expect(editor.getDocument().styles).toEqual(STYLES);
  });

  it("validates the document, and replaces it with setDocument", () => {
    expect(() =>
      createEditor({ document: { ...documentOf(p({})), styles: "x" } as never }),
    ).toThrow();
    const editor = editorOf(p({}, text("a")));
    const next = { ...documentOf(p({}, text("b"))), section: {} };
    editor.setDocument(next);
    expect(blocks(editor)).toEqual([p({}, text("b"))]);
    // Word's default page: Letter.
    expect(editor.settings.pageSize.width).toBeCloseTo(215.9, 1);
  });

  it("adds the gutter to the left margin", () => {
    const document = {
      ...documentOf(p({})),
      section: { margins: { left: 1440, gutter: 720, top: -1440, bottom: -720 } },
    };
    const editor = createEditor({ document });
    expect(editor.settings.margins.left).toBeCloseTo(38.1, 5);
    // A negative top or bottom margin is the same distance (text may run over the header).
    expect(editor.settings.margins.top).toBeCloseTo(25.4, 5);
    expect(editor.settings.margins.bottom).toBeCloseTo(12.7, 5);
  });
});

describe("Enter on a v3 document", () => {
  const section = { pageSize: { width: 12240, height: 15840 } };
  const own = { attributes: { "w14:paraId": "1A2B3C4D" } };

  it("splits a paragraph: the second keeps the paragraph mark (section, own attributes)", () => {
    const editor = editorOf(
      p({ style: "Quote", justification: "center", section, ...own }, text("abcd")),
      p({}, text("next")),
    );
    editor.select(3);
    editor.commands.splitBlock();
    expect(blocks(editor)).toEqual([
      p({ style: "Quote", justification: "center" }, text("ab")),
      p({ style: "Quote", justification: "center", section, ...own }, text("cd")),
      p({}, text("next")),
    ]);
    expect(editor.state.selection.from).toBe(5);
    editor.commands.undo();
    expect(blocks(editor)).toEqual([
      p({ style: "Quote", justification: "center", section, ...own }, text("abcd")),
      p({}, text("next")),
    ]);
  });

  it("at the end of a heading starts the style's next one, without the direct formatting", () => {
    const editor = editorOf(
      p({ style: "Heading1", justification: "center", ...own }, text("Title")),
    );
    editor.select(6);
    editor.commands.splitBlock();
    expect(blocks(editor)).toEqual([
      p({ style: "Heading1", justification: "center" }, text("Title")),
      p({ style: "Normal", ...own }),
    ]);
  });

  it("at the end of a paragraph whose style goes on (or names none) keeps its formatting", () => {
    for (const style of [null, "Normal", "Quote", "Missing"]) {
      const attrs = { ...(style ? { style } : {}), justification: "right" };
      const editor = editorOf(p(attrs, text("x")));
      editor.select(2);
      editor.commands.splitBlock();
      expect(blocks(editor)).toEqual([p(attrs, text("x")), p(attrs)]);
    }
  });

  it("at the end of a paragraph without a style follows the default style's next one", () => {
    const document = {
      ...documentOf(p({ justification: "right" }, text("x"))),
      styles: [
        { id: "Body", type: "paragraph" as const, isDefault: true, next: "Quote" },
        { id: "Quote", type: "paragraph" as const },
      ],
    };
    const editor = createEditor({ document });
    editor.select(2);
    editor.commands.splitBlock();
    expect(blocks(editor)).toEqual([
      p({ justification: "right" }, text("x")),
      p({ style: "Quote" }),
    ]);
  });

  it("in the middle of a heading keeps the heading on both sides", () => {
    const editor = editorOf(p({ style: "Heading1" }, text("Title")));
    editor.select(3);
    editor.commands.splitBlock();
    expect(blocks(editor)).toEqual([
      p({ style: "Heading1" }, text("Ti")),
      p({ style: "Heading1" }, text("tle")),
    ]);
  });
});

describe("bold, italic, underline and strike on a v3 document", () => {
  // As JSON: attributes at their defaults (value true, no twin) are left out.
  const bold = (value: boolean | null, complexScript?: boolean): MarkJSON => {
    const attrs = {
      ...(value === true ? {} : { value }),
      ...(complexScript === undefined ? {} : { complexScript }),
    };
    return Object.keys(attrs).length ? { type: "bold", attrs } : { type: "bold" };
  };

  it("toggle what text shows: off in a bold heading is a direct 'not bold'", () => {
    const editor = editorOf(p({ style: "Heading1" }, text("Title")));
    editor.select(1, 6);
    expect(editor.isMarkActive("bold")).toBe(true);
    editor.commands.toggleMark("bold");
    expect(blocks(editor)).toEqual([p({ style: "Heading1" }, text("Title", [bold(false)]))]);
    expect(editor.isMarkActive("bold")).toBe(false);
    editor.commands.toggleMark("bold");
    expect(blocks(editor)).toEqual([p({ style: "Heading1" }, text("Title"))]);
    expect(editor.isMarkActive("bold")).toBe(true);
  });

  it("turn on where some text shows it: only the rest gets the mark", () => {
    const editor = editorOf(p({ style: "Heading1" }, text("H")), p({}, text("ab")));
    editor.select(1, 6);
    expect(editor.isMarkActive("bold")).toBe(false);
    editor.commands.toggleMark("bold");
    expect(blocks(editor)).toEqual([
      p({ style: "Heading1" }, text("H")),
      p({}, text("ab", [bold(true)])),
    ]);
    expect(editor.isMarkActive("bold")).toBe(true);
    editor.commands.toggleMark("bold");
    expect(blocks(editor)).toEqual([
      p({ style: "Heading1" }, text("H", [bold(false)])),
      p({}, text("ab")),
    ]);
  });

  it("keep the complex-script twin of bold", () => {
    const editor = editorOf(p({}, text("ab", [bold(null, true)])));
    editor.select(1, 3);
    editor.commands.toggleMark("bold");
    expect(blocks(editor)).toEqual([p({}, text("ab", [bold(true, true)]))]);
    editor.commands.toggleMark("bold");
    expect(blocks(editor)).toEqual([p({}, text("ab", [bold(null, true)]))]);
  });

  it("at a caret set what the next typed text shows", () => {
    const editor = editorOf(p({ style: "Heading1" }, text("T")), p({}, text("n")));
    editor.select(2);
    editor.commands.toggleMark("bold");
    expect(editor.isMarkActive("bold")).toBe(false);
    editor.commands.insertText("x");
    editor.select(6);
    editor.commands.toggleMark("bold");
    expect(editor.isMarkActive("bold")).toBe(true);
    editor.commands.insertText("y");
    expect(blocks(editor)).toEqual([
      p({ style: "Heading1" }, text("T"), text("x", [bold(false)])),
      p({}, text("n"), text("y", [bold(true)])),
    ]);
  });

  it("underline from a character style is turned off with an explicit none", () => {
    const link: MarkJSON = { type: "characterStyle", attrs: { id: "Hyperlink" } };
    const underline = (style: string): MarkJSON =>
      style === "single" ? { type: "underline" } : { type: "underline", attrs: { style } };
    const editor = editorOf(p({}, text("a", [link]), text("b")));
    editor.select(1, 3);
    expect(editor.isMarkActive("underline")).toBe(false);
    editor.commands.toggleMark("underline");
    expect(blocks(editor)).toEqual([p({}, text("a", [link]), text("b", [underline("single")]))]);
    editor.commands.toggleMark("underline");
    expect(blocks(editor)).toEqual([p({}, text("a", [link, underline("none")]), text("b"))]);
    // "none" shows no underline.
    expect(editor.isMarkActive("underline")).toBe(false);
  });

  it("at a caret in text with a direct mark, turn it off by leaving the mark out", () => {
    const editor = editorOf(p({}, text("ab", [bold(true)])));
    editor.select(2);
    expect(editor.isMarkActive("bold")).toBe(true);
    editor.commands.toggleMark("bold");
    editor.commands.insertText("x");
    expect(blocks(editor)).toEqual([
      p({}, text("a", [bold(true)]), text("x"), text("b", [bold(true)])),
    ]);
  });

  it("are not active on a selection without text (an opaque block)", () => {
    const editor = editorOf(p({}, text("a", [bold(true)])), {
      type: "opaqueBlock",
      attrs: { xml: "<w:tbl/>" },
    });
    editor.run((state, dispatch) => {
      dispatch?.(state.tr.setSelection(NodeSelection.create(state.doc, 3)));
      return true;
    });
    expect(editor.isMarkActive("bold")).toBe(false);
  });

  it("italic and strike toggle a value", () => {
    const editor = editorOf(p({}, text("ab")));
    editor.select(1, 3);
    editor.commands.toggleMark("italic");
    editor.commands.toggleMark("strike");
    expect(blocks(editor)).toEqual([p({}, text("ab", [{ type: "italic" }, { type: "strike" }]))]);
    // Undo takes back one toggle at a time.
    editor.commands.undo();
    expect(editor.isMarkActive("strike")).toBe(false);
    expect(editor.isMarkActive("italic")).toBe(true);
  });

  it("are judged by text, not by markers or breaks in the selection", () => {
    const editor = editorOf(
      p({}, text("a", [bold(true)]), { type: "bookmarkStart", attrs: { id: 1, name: "x" } }),
    );
    editor.select(1, 3);
    expect(editor.isMarkActive("bold")).toBe(true);
    // Only a marker selected: judged by it.
    editor.select(2, 3);
    expect(editor.isMarkActive("bold")).toBe(false);
  });

  it("change only the selected part of a text node", () => {
    const editor = editorOf(p({}, text("abc")));
    editor.select(2, 3);
    editor.commands.toggleMark("bold");
    expect(blocks(editor)).toEqual([p({}, text("a"), text("b", [bold(true)]), text("c"))]);
  });

  it("include double strike, caps, small caps and hidden from a character style", () => {
    const styled: MarkJSON = { type: "characterStyle", attrs: { id: "Struck" } };
    const document = {
      ...documentOf(p({}, text("a", [styled]))),
      styles: [
        ...STYLES,
        { id: "Struck", type: "character" as const, run: [{ type: "doubleStrike" }] },
      ],
    };
    const editor = createEditor({ document });
    editor.select(1, 2);
    expect(editor.isMarkActive("doubleStrike")).toBe(true);
    editor.commands.toggleMark("doubleStrike");
    expect(blocks(editor)).toEqual([
      p({}, text("a", [styled, { type: "doubleStrike", attrs: { value: false } }])),
    ]);
  });

  it("leave other marks to the generic toggle", () => {
    const editor = editorOf(p({}, text("ab")));
    editor.select(1, 3);
    editor.commands.toggleMark("highlight", { value: "yellow" });
    expect(editor.isMarkActive("highlight")).toBe(true);
    editor.commands.toggleMark("highlight");
    expect(editor.isMarkActive("highlight")).toBe(false);
  });
});

describe("Backspace and Delete on a v3 document", () => {
  const bookmark: NodeJSON = { type: "bookmarkStart", attrs: { id: 1, name: "b" } };
  const end: NodeJSON = { type: "bookmarkEnd", attrs: { id: 1 } };
  const field: NodeJSON = { type: "opaqueInline", attrs: { xml: "<w:fldSimple/>" } };
  const table: NodeJSON = { type: "opaqueBlock", attrs: { xml: "<w:tbl/>" } };

  it("step over invisible markers, which stay", () => {
    const editor = editorOf(p({}, text("ab"), bookmark, end, text("cd")));
    editor.select(5);
    editor.commands.deleteBackward();
    expect(blocks(editor)).toEqual([p({}, text("a"), bookmark, end, text("cd"))]);
    editor.select(2);
    editor.commands.deleteForward();
    expect(blocks(editor)).toEqual([p({}, text("a"), bookmark, end, text("d"))]);
  });

  it("join paragraphs across markers at a paragraph's edge", () => {
    const editor = editorOf(p({}, text("ab")), p({}, bookmark, text("cd"), end));
    editor.select(6);
    editor.commands.deleteBackward();
    expect(blocks(editor)).toEqual([p({}, text("ab"), bookmark, text("cd"), end)]);
    editor.select(6);
    // Delete at the end, before the bookmark's end: nothing follows to join.
    expect(editor.commands.deleteForward()).toBe(false);
    const forward = editorOf(p({}, text("ab"), end), p({}, text("cd")));
    forward.select(3);
    forward.commands.deleteForward();
    expect(blocks(forward)).toEqual([p({}, text("ab"), end, text("cd"))]);
  });

  it("select opaque content first, then delete it", () => {
    const editor = editorOf(p({}, text("a"), field, text("b")));
    editor.select(3);
    editor.commands.deleteBackward();
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(editor.state.selection.from).toBe(2);
    editor.commands.deleteBackward();
    expect(blocks(editor)).toEqual([p({}, text("ab"))]);
    const forward = editorOf(p({}, text("a"), field, text("b")));
    forward.select(2);
    forward.commands.deleteForward();
    expect(forward.state.selection.from).toBe(2);
    expect(forward.state.selection.to).toBe(3);
  });

  it("select an opaque block beside the paragraph instead of deleting it", () => {
    const editor = editorOf(p({}, text("a")), table, p({}, text("b")));
    editor.select(5);
    editor.commands.deleteBackward();
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(editor.state.selection.from).toBe(3);
    editor.select(2);
    editor.commands.deleteForward();
    expect(editor.state.selection.from).toBe(3);
    expect(editor.state.selection.to).toBe(4);
    editor.commands.deleteForward();
    expect(blocks(editor)).toEqual([p({}, text("a")), p({}, text("b"))]);
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
  });
});
