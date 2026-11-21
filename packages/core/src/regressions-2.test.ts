// Regressions, second sweep: bookmark references, field formats, date controls, history, fragments, indents.
import { describe, expect, it } from "vitest";
import { EditorState, history, undoDepth } from "./index.js";
import { Fragment, type NodeJSON } from "./model/index.js";
import { controlValues, setControlValue } from "./state/controls.js";
import { createEditor, type Editor } from "./state/editor.js";
import { updateFields } from "./state/fieldupdate.js";
import { renameBookmark } from "./state/navigation.js";
import { testSchema } from "./testing/index.js";
import type { FoliDocument } from "./v3/document.js";
import { createDocument, SCHEMA_VERSION } from "./v3/document.js";
import { Resolver } from "./v3/resolve.js";

type Inline = NodeJSON | string;
const t = (text: string): NodeJSON => ({ type: "text", text });
const inline = (c: Inline) => (typeof c === "string" ? t(c) : c);
const p = (...content: Inline[]): NodeJSON => ({
  type: "paragraph",
  ...(content.length ? { content: content.map(inline) } : {}),
});
const atom = (type: string, attrs?: Record<string, unknown>): NodeJSON => ({
  type,
  ...(attrs ? { attrs } : {}),
});
const field = (code: string, ...result: Inline[]): NodeJSON[] => [
  atom("fieldStart"),
  atom("fieldCode", { text: code }),
  atom("fieldSeparator"),
  ...result.map(inline),
  atom("fieldEnd"),
];
const open = (content: NodeJSON[], more: Partial<FoliDocument> = {}) =>
  createEditor({
    document: {
      ...createDocument(),
      schemaVersion: SCHEMA_VERSION,
      content: { type: "doc", content },
      ...more,
    },
    author: "Me",
  });
const paragraphs = (editor: Editor) => {
  const out: string[] = [];
  editor.state.doc.forEach((node) => {
    out.push(node.textContent);
  });
  return out;
};
const codes = (editor: Editor) => {
  const out: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "fieldCode") out.push(String(node.attrs.text));
    return true;
  });
  return out;
};

describe("regressions 2: bookmarks", () => {
  it("renaming a bookmark follows references that quote its name", () => {
    const editor = open([
      p(atom("bookmarkStart", { id: 0, name: "Intro" }), "target", atom("bookmarkEnd", { id: 0 })),
      p(...field('REF "Intro" \\h', "x")),
      p(...field(' HYPERLINK \\l "Intro" ', "x")),
      p(...field("HYPERLINK \\l Intro", "x")),
      p(...field('HYPERLINK "https://example.com/Intro"', "x")),
    ]);
    expect(renameBookmark(editor, "Intro", "Start").ok).toBe(true);
    expect(codes(editor)).toEqual([
      'REF "Start" \\h',
      ' HYPERLINK \\l "Start" ',
      "HYPERLINK \\l Start",
      'HYPERLINK "https://example.com/Intro"',
    ]);
  });
});

describe("regressions 2: field formats", () => {
  const shown = (code: string) => {
    const editor = open([p(...field("SEQ f", "9")), p(...field("SEQ f", "9")), p(...field(code))]);
    return { skipped: updateFields(editor).skipped, text: paragraphs(editor)[2] };
  };

  it("a number format named with an initial capital is the uppercase one", () => {
    expect(shown("SEQ f \\* Roman")).toEqual({ skipped: [], text: "III" });
    expect(shown("SEQ f \\* Alphabetic")).toEqual({ skipped: [], text: "C" });
    expect(shown("SEQ f \\* roman")).toEqual({ skipped: [], text: "iii" });
  });

  it("\\* Hex shows a whole number", () => {
    const editor = open([p(...field("MERGEFIELD n \\* Hex", "x"))]);
    updateFields(editor, { data: { n: 12.5 } });
    expect(paragraphs(editor)).toEqual(["D"]);
  });
});

describe("regressions 2: date controls", () => {
  it("shows a year before 100 as that year", () => {
    const editor = open(
      [p("a", atom("controlStart", { id: "d" }), "x", atom("controlEnd", { id: "d" }), "b")],
      { controls: { d: { kind: "date", dateFormat: "yyyy-MM-dd" } } },
    );
    expect(editor.run(setControlValue("d", "0050-01-02"))).toBe(true);
    // Not 1950; how many digits `yyyy` gives such a year is not this test's matter.
    expect(controlValues(editor.state)[0]?.text).toMatch(/^0*50-01-02$/);
  });
});

describe("regressions 2: history", () => {
  const tdoc = (...texts: string[]) =>
    testSchema.nodeFromJSON({ type: "doc", content: texts.map((text) => p(text)) });

  it("a depth of 0 keeps no undo events", () => {
    let state = EditorState.create({ doc: tdoc("a"), plugins: [history({ depth: 0 })] });
    state = state.applyTransaction(state.tr.insertText("b", 2)).state;
    expect(undoDepth(state)).toBe(0);
  });
});

describe("regressions 2: fragments", () => {
  it("cut past the end is a RangeError, as findIndex's is", () => {
    const fragment = Fragment.from(testSchema.text("abc"));
    expect(() => fragment.cut(1, 9)).toThrow(RangeError);
  });
});

describe("regressions 2: indents", () => {
  it("a derived style's hanging indent of 0 replaces the inherited first-line indent", () => {
    const resolver = new Resolver({
      defaults: {},
      numbering: { abstracts: [], instances: [] },
      styles: [
        { id: "Body", type: "paragraph", paragraph: { indent: { firstLine: 720 } } },
        { id: "Flush", type: "paragraph", basedOn: "Body", paragraph: { indent: { hanging: 0 } } },
      ],
    });
    expect(resolver.paragraph({ style: "Flush" }).paragraph.indent).toMatchObject({
      firstLine: 0,
      hanging: 0,
    });
  });
});
