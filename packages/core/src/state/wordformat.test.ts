import { describe, expect, it } from "vitest";
import { createDocument } from "../document.js";
import type { MarkJSON, NodeJSON } from "../model/index.js";
import type { FoliDocumentV3, StyleJSON } from "../v3/document.js";
import { createEditor } from "./editor.js";
import { alignAt, colorAt } from "./format.js";
import { linkAt } from "./links.js";
import { listKindAt } from "./lists.js";
import {
  canOutdent,
  changeIndent,
  fontFamilyAt,
  fontSizeAt,
  lineSpacingAt,
  paragraphStyleAt,
  paragraphStyles,
  setFontFamily,
  setFontSize,
  setLineSpacing,
  setParagraphSpacing,
  setParagraphStyle,
} from "./wordformat.js";

const STYLES: StyleJSON[] = [
  { id: "Title", type: "paragraph", name: "Title", basedOn: "Normal" },
  { id: "Normal", type: "paragraph", name: "Normal", isDefault: true },
  {
    id: "Heading1",
    type: "paragraph",
    name: "heading 1",
    basedOn: "Normal",
    paragraph: { justification: "center", spacing: { line: 360, lineRule: "auto" } },
    run: [
      { type: "font", attrs: { ascii: "Cambria", hAnsi: "Cambria" } },
      { type: "fontSize", attrs: { value: 32 } },
      { type: "color", attrs: { value: "2F5496" } },
      { type: "highlight", attrs: { value: "yellow" } },
    ],
  },
  { id: "ListParagraph", type: "paragraph", name: "List Paragraph", basedOn: "Normal" },
  { id: "Hyperlink", type: "character", name: "Hyperlink" },
];

const text = (value: string, marks?: MarkJSON[]): NodeJSON =>
  marks ? { type: "text", text: value, marks } : { type: "text", text: value };
const p = (attrs: Record<string, unknown>, ...content: NodeJSON[]): NodeJSON => ({
  type: "paragraph",
  ...(Object.keys(attrs).length ? { attrs } : {}),
  ...(content.length ? { content } : {}),
});

function documentOf(blocks: NodeJSON[], over: Partial<FoliDocumentV3> = {}): FoliDocumentV3 {
  return {
    schemaVersion: 3,
    section: {},
    defaults: { run: [{ type: "fontSize", attrs: { value: 22 } }] },
    styles: STYLES,
    numbering: { abstracts: [], instances: [] },
    comments: [],
    content: { type: "doc", content: blocks },
    ...over,
  };
}
const editorOf = (...blocks: NodeJSON[]) => createEditor({ document: documentOf(blocks) });
type V3Editor = ReturnType<typeof editorOf>;
const blocks = (editor: V3Editor) => editor.getDocument().content.content ?? [];
const attrsOf = (editor: V3Editor) => blocks(editor).map((b) => b.attrs ?? {});

describe("paragraph styles", () => {
  it("lists the document's paragraph styles, the default first", () => {
    const editor = editorOf(p({}, text("a")));
    expect(paragraphStyles(editor.state).map((s) => s.id)).toEqual([
      "Normal",
      "Title",
      "Heading1",
      "ListParagraph",
    ]);
    expect(paragraphStyles(editor.state)[2]?.name).toBe("heading 1");
  });

  it("puts paragraphs in a style (the default one: no style named), and tells which", () => {
    const editor = editorOf(p({ justification: "right" }, text("a")), p({}, text("b")));
    expect(paragraphStyleAt(editor.state)).toBe("Normal");
    editor.select(1, 5);
    expect(editor.run(setParagraphStyle("Title"))).toBe(true);
    // Direct formatting stays.
    expect(attrsOf(editor)).toEqual([
      { style: "Title", justification: "right" },
      { style: "Title" },
    ]);
    editor.select(1);
    editor.run(setParagraphStyle("Normal"));
    expect(attrsOf(editor)).toEqual([{ justification: "right" }, { style: "Title" }]);
    editor.select(1, 5);
    expect(paragraphStyleAt(editor.state)).toBeNull();
    // Not a style the document has, nor a character style.
    expect(editor.run(setParagraphStyle("Missing"))).toBe(false);
    expect(editor.run(setParagraphStyle("Hyperlink"))).toBe(false);
    // An undo step of its own.
    editor.commands.undo();
    expect(attrsOf(editor)).toEqual([
      { style: "Title", justification: "right" },
      { style: "Title" },
    ]);
  });

  it("makes headings with Word's heading styles (setBlockType)", () => {
    const editor = editorOf(p({}, text("a")));
    editor.select(1);
    expect(editor.commands.setBlockType("heading", { level: 1 })).toBe(true);
    expect(attrsOf(editor)).toEqual([{ style: "Heading1" }]);
    // No "heading 2" in this document.
    expect(editor.commands.setBlockType("heading", { level: 2 })).toBe(false);
    expect(editor.commands.setBlockType("paragraph")).toBe(true);
    expect(attrsOf(editor)).toEqual([{}]);
    expect(editor.commands.setBlockType("horizontalRule")).toBe(false);
  });
});

describe("font family and size", () => {
  it("set the Latin fonts directly, unless the style already gives the font", () => {
    const font = { type: "font", attrs: { eastAsia: "MS Mincho" } };
    const editor = editorOf(p({}, text("ab", [font])), p({ style: "Heading1" }, text("h")));
    editor.select(1, 6);
    expect(fontFamilyAt(editor.state)).toBeNull();
    editor.run(setFontFamily("Arial"));
    expect(blocks(editor)).toEqual([
      p(
        {},
        text("ab", [
          { type: "font", attrs: { ascii: "Arial", hAnsi: "Arial", eastAsia: "MS Mincho" } },
        ]),
      ),
      p(
        { style: "Heading1" },
        text("h", [{ type: "font", attrs: { ascii: "Arial", hAnsi: "Arial" } }]),
      ),
    ]);
    expect(fontFamilyAt(editor.state)).toBe("Arial");
    editor.select(5, 6);
    editor.run(setFontFamily("Cambria"));
    expect(blocks(editor)[1]).toEqual(p({ style: "Heading1" }, text("h")));
    editor.select(1, 3);
    editor.run(setFontFamily(null));
    expect(blocks(editor)[0]).toEqual(p({}, text("ab", [font])));
  });

  it("set the size in half points (and for complex scripts); the style's size leaves none", () => {
    const editor = editorOf(p({}, text("ab")), p({ style: "Heading1" }, text("h")));
    editor.select(1, 3);
    expect(fontSizeAt(editor.state)).toBe(11);
    editor.run(setFontSize(10.5));
    expect(blocks(editor)[0]).toEqual(
      p({}, text("ab", [{ type: "fontSize", attrs: { value: 21, complexScript: 21 } }])),
    );
    expect(fontSizeAt(editor.state)).toBe(10.5);
    editor.select(5, 6);
    expect(editor.run(setFontSize(16))).toBe(false);
    expect(editor.run(setFontSize(0))).toBe(false);
    expect(editor.run(setFontSize(2000))).toBe(false);
    editor.select(1, 3);
    editor.run(setFontSize(null));
    expect(blocks(editor)[0]).toEqual(p({}, text("ab")));
  });

  it("at a caret, set what the next typed text gets", () => {
    const editor = editorOf(p({}, text("ab")));
    editor.select(2);
    editor.run(setFontSize(14));
    expect(fontSizeAt(editor.state)).toBe(14);
    editor.commands.insertText("x");
    expect(blocks(editor)[0]).toEqual(
      p(
        {},
        text("a"),
        text("x", [{ type: "fontSize", attrs: { value: 28, complexScript: 28 } }]),
        text("b"),
      ),
    );
  });
});

describe("color and highlight on a v3 document", () => {
  it("color: Word's RRGGBB; automatic writes auto where a style colors the text", () => {
    const editor = editorOf(p({}, text("a")), p({ style: "Heading1" }, text("h")));
    editor.select(1, 2);
    editor.commands.setTextColor("#C00000");
    expect(blocks(editor)[0]).toEqual(
      p({}, text("a", [{ type: "color", attrs: { value: "C00000" } }])),
    );
    expect(colorAt(editor.state, "textColor")).toBe("#c00000");
    editor.commands.setTextColor(null);
    expect(blocks(editor)[0]).toEqual(p({}, text("a")));
    editor.select(4, 5);
    expect(colorAt(editor.state, "textColor")).toBe("#2f5496");
    editor.commands.setTextColor(null);
    expect(blocks(editor)[1]).toEqual(
      p({ style: "Heading1" }, text("h", [{ type: "color", attrs: { value: "auto" } }])),
    );
    expect(colorAt(editor.state, "textColor")).toBeNull();
    expect(editor.commands.setTextColor("red")).toBe(false);
  });

  it("highlight: Word's colors as highlights, others as shading; none removes both", () => {
    const editor = editorOf(p({}, text("a")), p({ style: "Heading1" }, text("h")));
    editor.select(1, 2);
    editor.commands.setHighlight("#FFFF00");
    expect(blocks(editor)[0]).toEqual(
      p({}, text("a", [{ type: "highlight", attrs: { value: "yellow" } }])),
    );
    expect(colorAt(editor.state, "highlight")).toBe("#ffff00");
    editor.commands.setHighlight("#fff59d");
    expect(blocks(editor)[0]).toEqual(
      p({}, text("a", [{ type: "shading", attrs: { pattern: "clear", fill: "FFF59D" } }])),
    );
    expect(colorAt(editor.state, "highlight")).toBe("#fff59d");
    editor.commands.setHighlight(null);
    expect(blocks(editor)[0]).toEqual(p({}, text("a")));
    editor.select(4, 5);
    editor.commands.setHighlight(null);
    expect(blocks(editor)[1]).toEqual(
      p({ style: "Heading1" }, text("h", [{ type: "highlight", attrs: { value: "none" } }])),
    );
  });
});

describe("alignment, line spacing, space before and after", () => {
  it("align with Word's justification; the style's value leaves none", () => {
    const editor = editorOf(p({}, text("a")), p({ style: "Heading1" }, text("h")));
    editor.select(1);
    expect(alignAt(editor.state)).toBe("start");
    editor.commands.setAlign("justify");
    expect(attrsOf(editor)[0]).toEqual({ justification: "both" });
    expect(alignAt(editor.state)).toBe("justify");
    editor.select(1, 5);
    expect(alignAt(editor.state)).toBeNull();
    editor.commands.setAlign("center");
    expect(attrsOf(editor)).toEqual([{ justification: "center" }, { style: "Heading1" }]);
    editor.commands.setAlign("start");
    expect(attrsOf(editor)).toEqual([{}, { style: "Heading1", justification: "left" }]);
    editor.commands.setAlign("end");
    expect(attrsOf(editor)).toEqual([
      { justification: "right" },
      { style: "Heading1", justification: "right" },
    ]);
  });

  it("line spacing as a multiple of single", () => {
    const editor = editorOf(
      p({ spacing: { after: 120 } }, text("a")),
      p({ style: "Heading1" }, text("h")),
    );
    editor.select(1);
    expect(lineSpacingAt(editor.state)).toBe(1);
    editor.run(setLineSpacing(1.15));
    expect(attrsOf(editor)[0]).toEqual({ spacing: { after: 120, line: 276, lineRule: "auto" } });
    expect(lineSpacingAt(editor.state)).toBe(1.15);
    editor.run(setLineSpacing(null));
    expect(attrsOf(editor)[0]).toEqual({ spacing: { after: 120 } });
    editor.select(4);
    expect(lineSpacingAt(editor.state)).toBe(1.5);
    expect(editor.run(setLineSpacing(1.5))).toBe(false);
    expect(editor.run(setLineSpacing(0))).toBe(false);
    editor.run(setLineSpacing(2));
    expect(attrsOf(editor)[1]).toEqual({
      style: "Heading1",
      spacing: { line: 480, lineRule: "auto" },
    });
  });

  it("space before and after in points", () => {
    const editor = editorOf(p({ spacing: { line: 300 } }, text("a")));
    editor.select(1);
    editor.run(setParagraphSpacing({ before: 12, after: 6 }));
    expect(attrsOf(editor)[0]).toEqual({ spacing: { line: 300, before: 240, after: 120 } });
    editor.run(setParagraphSpacing({ before: null }));
    expect(attrsOf(editor)[0]).toEqual({ spacing: { line: 300, after: 120 } });
    expect(editor.run(setParagraphSpacing({ after: -1 }))).toBe(false);
    editor.run(setParagraphSpacing({ after: null }));
    editor.run(setLineSpacing(null));
    expect(attrsOf(editor)[0]).toEqual({});
  });

  it("indent by half-inch stops; decrease stops at 0", () => {
    const editor = editorOf(p({ indent: { left: 500, firstLine: 200 } }, text("a")));
    editor.select(1);
    expect(canOutdent(editor.state)).toBe(true);
    editor.run(changeIndent(1));
    expect(attrsOf(editor)[0]).toEqual({ indent: { left: 720, firstLine: 200 } });
    editor.run(changeIndent(-1));
    editor.run(changeIndent(-1));
    expect(attrsOf(editor)[0]).toEqual({ indent: { left: 0, firstLine: 200 } });
    expect(canOutdent(editor.state)).toBe(false);
    expect(editor.run(changeIndent(-1))).toBe(false);
  });
});

/** A one-level bullet list definition, instance 1. */
const BULLETS: FoliDocumentV3["numbering"] = {
  abstracts: [
    {
      id: 0,
      levels: [0, 1].map((level) => ({ level, format: "bullet", text: "-" })),
    },
  ],
  instances: [{ id: 1, abstract: 0 }],
};

describe("lists as Word's numbering", () => {
  it("bullets: a definition made once, shared; List Paragraph style; off again", () => {
    const editor = editorOf(p({}, text("a")), p({ style: "Title" }, text("b")), p({}, text("c")));
    editor.select(1, 5);
    expect(listKindAt(editor.state)).toBeNull();
    editor.commands.toggleList("bulletList");
    const { numbering } = editor.getDocument();
    expect(numbering.instances).toEqual([{ id: 1, abstract: 0 }]);
    expect(numbering.abstracts[0]?.levels[0]).toMatchObject({ format: "bullet", text: "" });
    expect(numbering.abstracts[0]?.levels).toHaveLength(9);
    expect(attrsOf(editor)).toEqual([
      { style: "ListParagraph", numbering: { id: 1, level: 0 } },
      { style: "Title", numbering: { id: 1, level: 0 } },
      {},
    ]);
    expect(listKindAt(editor.state)).toBe("bulletList");
    // A later bulleted paragraph uses the same definition (bullets do not count).
    editor.select(7);
    editor.commands.toggleList("bulletList");
    expect(attrsOf(editor)[2]).toEqual({ style: "ListParagraph", numbering: { id: 1, level: 0 } });
    expect(editor.getDocument().numbering.instances).toHaveLength(1);
    editor.select(1, 5);
    editor.commands.toggleList("bulletList");
    expect(attrsOf(editor)).toEqual([
      {},
      { style: "Title" },
      { style: "ListParagraph", numbering: { id: 1, level: 0 } },
    ]);
  });

  it("numbers: a new list starts at 1; right after a list of the kind, it goes on", () => {
    const editor = editorOf(p({}, text("a")), p({}, text("b")), p({}, text("c")));
    editor.select(1);
    editor.commands.toggleList("orderedList");
    editor.select(4);
    editor.commands.toggleList("orderedList");
    const { numbering } = editor.getDocument();
    expect(numbering.instances).toEqual([
      { id: 1, abstract: 0, overrides: [{ level: 0, start: 1 }] },
    ]);
    expect(numbering.abstracts[0]?.levels[0]).toMatchObject({ format: "decimal", text: "%1." });
    expect(attrsOf(editor).map((a) => a.numbering)).toEqual([
      { id: 1, level: 0 },
      { id: 1, level: 0 },
      undefined,
    ]);
    expect(listKindAt(editor.state)).toBe("orderedList");
    // Not right after it: a new list (a new instance of the same definition, from 1).
    editor.select(7);
    editor.commands.setBlockType("heading", { level: 1 });
    editor.select(4);
    editor.commands.toggleList("orderedList");
    editor.select(7);
    editor.commands.toggleList("orderedList");
    expect(editor.getDocument().numbering.instances).toEqual([
      { id: 1, abstract: 0, overrides: [{ level: 0, start: 1 }] },
      { id: 2, abstract: 0, overrides: [{ level: 0, start: 1 }] },
    ]);
    // The other kind over a list: renumbered as that kind, at the same level.
    editor.select(1);
    editor.commands.toggleList("bulletList");
    expect(listKindAt(editor.state)).toBe("bulletList");
  });

  it("a numbered heading's numbering does not continue as a list", () => {
    const document = documentOf(
      [p({ style: "Heading1", numbering: { id: 5, level: 0 } }, text("H")), p({}, text("b"))],
      {
        numbering: {
          abstracts: [
            { id: 3, levels: [{ level: 0, format: "decimal", text: "%1.", style: "Heading1" }] },
          ],
          instances: [{ id: 5, abstract: 3 }],
        },
      },
    );
    const editor = createEditor({ document });
    editor.select(4);
    editor.commands.toggleList("orderedList");
    const { numbering } = editor.getDocument();
    // Its own definition, not the headings'.
    expect(numbering.abstracts).toHaveLength(2);
    expect(attrsOf(editor)[1]).toEqual({ style: "ListParagraph", numbering: { id: 6, level: 0 } });
  });

  it("Tab at a list paragraph's start goes a level deeper, elsewhere types a tab", () => {
    const list = (...blocks: NodeJSON[]) =>
      createEditor({ document: documentOf(blocks, { numbering: BULLETS }) });
    const editor = list(p({ numbering: { id: 1, level: 0 } }, text("ab")), p({}, text("c")));
    editor.select(1);
    expect(editor.handleKey("Tab")).toBe(true);
    expect(attrsOf(editor)[0]).toEqual({ numbering: { id: 1, level: 1 } });
    editor.select(2);
    expect(editor.handleKey("Tab")).toBe(true);
    expect(blocks(editor)[0]?.content).toEqual([text("a"), { type: "tab" }, text("b")]);
    editor.select(1);
    expect(editor.handleKey("Shift-Tab")).toBe(true);
    expect(attrsOf(editor)[0]).toEqual({ numbering: { id: 1, level: 0 } });
    expect(editor.handleKey("Shift-Tab")).toBe(true);
    expect(attrsOf(editor)[0]).toEqual({});
    // Outside a list Shift+Tab is not taken (the focus moves on).
    expect(editor.handleKey("Shift-Tab")).toBe(false);
    // Over several paragraphs with a numbered one: a level deeper (the others stay).
    const many = list(p({ numbering: { id: 1, level: 0 } }, text("a")), p({}, text("b")));
    many.select(1, 5);
    many.handleKey("Tab");
    expect(attrsOf(many)).toEqual([{ numbering: { id: 1, level: 1 } }, { indent: { left: 720 } }]);
    // A plain schema v2 editor takes no Tab.
    expect(createEditor({ document: createDocument() }).handleKey("Tab")).toBe(false);
  });

  it("Enter in an empty list paragraph ends the list; Backspace at its start removes the number", () => {
    const numbered = { numbering: { id: 1, level: 0 } };
    const document = documentOf([p(numbered, text("a")), p(numbered)], {
      numbering: {
        abstracts: [
          {
            id: 0,
            levels: [
              {
                level: 0,
                format: "decimal",
                text: "%1.",
                paragraph: { indent: { left: 720, hanging: 360 } },
              },
            ],
          },
        ],
        instances: [{ id: 1, abstract: 0 }],
      },
    });
    const editor = createEditor({ document });
    editor.select(4);
    editor.handleKey("Enter");
    expect(attrsOf(editor)).toEqual([numbered, {}]);
    // Enter in a non-empty one splits it, both numbered.
    editor.select(2);
    editor.handleKey("Enter");
    expect(attrsOf(editor)).toEqual([numbered, numbered, {}]);
    editor.select(4);
    editor.handleKey("Backspace");
    // The text stays where the number put it.
    expect(attrsOf(editor)[1]).toEqual({ indent: { left: 720, right: 0, firstLine: 0 } });
    editor.handleKey("Backspace");
    expect(blocks(editor)).toHaveLength(2);
  });
});

describe("links on a v3 document", () => {
  it("take the Hyperlink style, and lose it with the link", () => {
    const editor = editorOf(p({}, text("ab")));
    editor.select(1, 3);
    editor.commands.setLink("example.com");
    expect(blocks(editor)[0]).toEqual(
      p(
        {},
        text("ab", [
          { type: "link", attrs: { href: "https://example.com" } },
          { type: "characterStyle", attrs: { id: "Hyperlink" } },
        ]),
      ),
    );
    expect(linkAt(editor.state)).toBe("https://example.com");
    editor.commands.removeLink();
    expect(blocks(editor)[0]).toEqual(p({}, text("ab")));
  });

  it("look like Word's links where the document has no Hyperlink style", () => {
    const document = documentOf([p({}, text("ab"))], { styles: STYLES.slice(0, 2) });
    const editor = createEditor({ document });
    editor.select(3);
    editor.commands.setLink("https://example.com/");
    expect(blocks(editor)[0]).toEqual(
      p(
        {},
        text("ab"),
        text("https://example.com/", [
          { type: "link", attrs: { href: "https://example.com/" } },
          { type: "underline" },
          { type: "color", attrs: { value: "0563C1" } },
        ]),
      ),
    );
  });
});

describe("Word formatting on a schema v2 editor", () => {
  it("does not apply", () => {
    const editor = createEditor();
    for (const command of [
      setParagraphStyle("Normal"),
      setFontFamily("Arial"),
      setFontSize(12),
      setLineSpacing(2),
      setParagraphSpacing({ before: 1 }),
      changeIndent(1),
    ])
      expect(editor.run(command)).toBe(false);
    expect(paragraphStyles(editor.state)).toEqual([]);
    expect(fontSizeAt(editor.state)).toBeNull();
  });
});

describe("Word formatting edge cases", () => {
  const numbering = (format: string, extra: Partial<FoliDocumentV3> = {}) => ({
    numbering: {
      abstracts: [
        { id: 0, levels: Array.from({ length: 9 }, (_, level) => ({ level, format, text: "-" })) },
      ],
      instances: [{ id: 1, abstract: 0 }],
    },
    ...extra,
  });

  it("a color the style already gives leaves no direct color", () => {
    const editor = editorOf(p({ style: "Heading1" }, text("h")));
    editor.select(1, 2);
    expect(editor.commands.setTextColor("#2f5496")).toBe(false);
    expect(blocks(editor)).toEqual([p({ style: "Heading1" }, text("h"))]);
  });

  it("indent: lists stop at level 9; half-inch stops round down from between them", () => {
    const deep = createEditor({
      document: documentOf([p({ numbering: { id: 1, level: 8 } }, text("a"))], numbering("bullet")),
    });
    deep.select(1);
    expect(deep.run(changeIndent(1))).toBe(false);
    const between = editorOf(p({ indent: { left: 1000 } }, text("a")));
    between.select(1);
    between.run(changeIndent(-1));
    expect(attrsOf(between)[0]).toEqual({ indent: { left: 720 } });
  });

  it("a numbered paragraph can always decrease its indent", () => {
    const editor = createEditor({
      document: documentOf([p({ numbering: { id: 1, level: 0 } }, text("a"))], numbering("bullet")),
    });
    editor.select(1);
    expect(canOutdent(editor.state)).toBe(true);
  });

  it("numbering with format none is no list", () => {
    const editor = createEditor({
      document: documentOf([p({ numbering: { id: 1, level: 0 } }, text("a"))], numbering("none")),
    });
    editor.select(1);
    expect(listKindAt(editor.state)).toBeNull();
  });

  it("taking a paragraph numbered by its style out of the list writes numbering 0", () => {
    const styles: StyleJSON[] = [
      ...STYLES,
      {
        id: "ListBullet",
        type: "paragraph",
        name: "List Bullet",
        paragraph: { numbering: { id: 1, level: 0 } },
      },
    ];
    const editor = createEditor({
      document: documentOf(
        [p({ style: "ListBullet" }, text("a"))],
        numbering("bullet", { styles }),
      ),
    });
    editor.select(1);
    expect(listKindAt(editor.state)).toBe("bulletList");
    editor.commands.toggleList("bulletList");
    expect(attrsOf(editor)[0]).toEqual({ style: "ListBullet", numbering: { id: 0 } });
    expect(listKindAt(editor.state)).toBeNull();
  });

  it("bullets apart share one definition and instance", () => {
    const editor = editorOf(p({}, text("a")), p({}, text("b")), p({}, text("c")));
    editor.select(1);
    editor.commands.toggleList("bulletList");
    editor.select(7);
    editor.commands.toggleList("bulletList");
    expect(editor.getDocument().numbering.instances).toEqual([{ id: 1, abstract: 0 }]);
    expect(attrsOf(editor)[2]).toEqual({ style: "ListParagraph", numbering: { id: 1, level: 0 } });
  });

  it("changing a list's kind keeps each paragraph's level", () => {
    const editor = createEditor({
      document: documentOf(
        [p({ numbering: { id: 1, level: 2 } }, text("a"))],
        numbering("decimal"),
      ),
    });
    editor.select(1);
    editor.commands.toggleList("bulletList");
    expect(attrsOf(editor)[0]?.numbering).toMatchObject({ level: 2 });
  });

  it("Enter at the start of a non-empty list paragraph splits it, both numbered", () => {
    const numbered = { numbering: { id: 1, level: 0 } };
    const editor = createEditor({
      document: documentOf([p(numbered, text("a"))], numbering("bullet")),
    });
    editor.select(1);
    editor.handleKey("Enter");
    expect(attrsOf(editor)).toEqual([numbered, numbered]);
  });

  it("headings of every level map to their styles", () => {
    const styles: StyleJSON[] = [
      ...STYLES,
      { id: "Heading2", type: "paragraph", name: "heading 2" },
    ];
    const editor = createEditor({ document: documentOf([p({}, text("a"))], { styles }) });
    editor.select(1);
    editor.commands.setBlockType("heading", { level: 2 });
    expect(attrsOf(editor)[0]).toEqual({ style: "Heading2" });
  });
});
