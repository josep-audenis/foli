import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { NodeJSON } from "../model/index.js";
import type { FoliDocument, StyleJSON } from "../v3/document.js";
import { createDocument, parseDocument, SCHEMA_VERSION } from "../v3/document.js";
import { deleteBackward, deleteForward } from "./commands.js";
import { createEditor, type Editor } from "./editor.js";
import { fieldCodesShown, fieldDisplay, fieldsIn, toggleFieldCodes } from "./fields.js";
import {
  crossReferenceTargets,
  type FieldLayout,
  formatDatePicture,
  formatNumericPicture,
  insertCrossReference,
  insertDate,
  insertField,
  insertPageNumber,
  insertTableOfContents,
  parseFieldInstruction,
  updateFields,
} from "./fieldupdate.js";
import { redo, undo, undoDepth } from "./history.js";
import { acceptAllChanges, rejectAllChanges } from "./review.js";
import { TextSelection } from "./selection.js";

const text = (value: string): NodeJSON => ({ type: "text", text: value });
const field = (code: string, shown = "", attrs?: Record<string, unknown>): NodeJSON[] => [
  { type: "fieldStart", ...(attrs ? { attrs } : {}) },
  { type: "fieldCode", attrs: { text: ` ${code} ` } },
  { type: "fieldSeparator" },
  ...(shown ? [text(shown)] : []),
  { type: "fieldEnd" },
];
const p = (...content: (NodeJSON | string)[]): NodeJSON => ({
  type: "paragraph",
  content: content.filter((c) => c !== "").map((c) => (typeof c === "string" ? text(c) : c)),
});
const styled = (style: string, value: string): NodeJSON => ({
  type: "paragraph",
  attrs: { style },
  content: [text(value)],
});
const STYLES: StyleJSON[] = [
  { id: "Normal", type: "paragraph", name: "Normal", isDefault: true },
  {
    id: "Heading1",
    type: "paragraph",
    name: "heading 1",
    basedOn: "Normal",
    paragraph: { outlineLevel: 0 },
  },
  {
    id: "Heading2",
    type: "paragraph",
    name: "heading 2",
    basedOn: "Normal",
    paragraph: { outlineLevel: 1 },
  },
  { id: "Note", type: "paragraph", name: "Side note", basedOn: "Normal" },
];

function documentOf(content: NodeJSON[], more: Partial<FoliDocument> = {}): FoliDocument {
  return {
    ...createDocument(),
    schemaVersion: SCHEMA_VERSION,
    styles: STYLES,
    section: { pageSize: { width: 11906, height: 16838 }, margins: { left: 1440, right: 1440 } },
    content: { type: "doc", content },
    ...more,
  };
}
const editorOf = (content: NodeJSON[], more?: Partial<FoliDocument>, trackChanges = false) =>
  createEditor({ document: documentOf(content, more), trackChanges, author: "Ann" });
const results = (editor: Editor) => fieldsIn(editor.state.doc).map((f) => f.result);
const firstField = (editor: Editor) =>
  fieldsIn(editor.state.doc)[0] as ReturnType<typeof fieldsIn>[0];
/** One page per `perPage` positions. */
const pagesEvery = (perPage: number, pages = 9): FieldLayout => ({
  pages,
  pageAt: (pos) => ({ number: Math.floor(pos / perPage) + 1, sectionPages: pages }),
});
/** The document still validates (the markers are in order and paired for export). */
const valid = (editor: Editor) => expect(() => parseDocument(editor.getDocument())).not.toThrow();

describe("fieldsIn", () => {
  it("pairs markers by depth, reads a nested field in the code as its result", () => {
    const editor = editorOf([
      p(
        { type: "fieldStart" },
        { type: "fieldCode", attrs: { text: " IF " } },
        ...field("MERGEFIELD x", "yes"),
        { type: "fieldCode", attrs: { text: ' = "yes" ' } },
        { type: "fieldSeparator" },
        "shown",
        { type: "fieldEnd" },
      ),
    ]);
    const [outer, inner] = fieldsIn(editor.state.doc);
    expect(outer?.instruction).toBe('IF yes = "yes"');
    expect(outer?.name).toBe("IF");
    expect(outer?.result).toBe("shown");
    expect(inner).toMatchObject({ name: "MERGEFIELD", result: "yes", inCode: true });
    expect(inner?.parent).toBe(outer);
  });

  it("ignores markers without partners, and gives a field across paragraphs its text", () => {
    const editor = editorOf([
      p({ type: "fieldEnd" }, "a", { type: "fieldStart" }),
      p(...field("X", "one"), { type: "fieldSeparator" }),
    ]);
    expect(fieldsIn(editor.state.doc).map((f) => f.name)).toEqual(["X"]);
    const across = editorOf([
      p(
        { type: "fieldStart" },
        { type: "fieldCode", attrs: { text: "T" } },
        { type: "fieldSeparator" },
        "a",
      ),
      p("b"),
      p({ type: "fieldEnd" }),
    ]);
    expect(firstField(across).result).toBe("a\rb");
  });
});

describe("instructions", () => {
  it("splits names, quoted arguments and switches", () => {
    const { name, args, switches } = parseFieldInstruction(
      'toc \\o "1-3" \\h \\t "Side note,2" \\* MERGEFORMAT',
    );
    expect(name).toBe("TOC");
    expect(args).toEqual([]);
    expect(switches.get("o")).toEqual(["1-3"]);
    expect(switches.get("h")).toEqual([""]);
    expect(switches.get("t")).toEqual(["Side note,2"]);
    expect(switches.get("*")).toEqual(["MERGEFORMAT"]);
    expect(parseFieldInstruction('DATE \\@"d/M"').switches.get("@")).toEqual(["d/M"]);
    expect(parseFieldInstruction('MERGEFIELD "a b" \\b "x\\"y"').args).toEqual(["a b"]);
    expect(parseFieldInstruction('MERGEFIELD "a b" \\b "x\\"y"').switches.get("b")).toEqual([
      'x"y',
    ]);
  });

  it("formats dates in Word's pictures", () => {
    const date = new Date(2026, 2, 3, 15, 4, 9);
    expect(formatDatePicture(date, "d MMMM yyyy")).toBe("3 March 2026");
    expect(formatDatePicture(date, "dddd, dd/MM/yy")).toBe("Tuesday, 03/03/26");
    expect(formatDatePicture(date, "ddd MMM")).toBe("Tue Mar");
    expect(formatDatePicture(date, "h:mm:ss AM/PM")).toBe("3:04:09 PM");
    expect(formatDatePicture(date, "HH'h'mm")).toBe("15h04");
  });

  it("formats numbers in Word's pictures", () => {
    expect(formatNumericPicture(1234.5, "#,##0.00")).toBe("1,234.50");
    expect(formatNumericPicture(5, "000")).toBe("005");
    expect(formatNumericPicture(-5, "0")).toBe("-5");
    expect(formatNumericPicture(-5, "0;(0)")).toBe("(5)");
    expect(formatNumericPicture(0, "0;-0;'none'")).toBe("none");
    expect(formatNumericPicture(7, "$0.0 'net'")).toBe("$7.0 net");
    expect(formatNumericPicture(1234567, "#,##0")).toBe("1,234,567");
  });
});

describe("selecting and deleting a field", () => {
  const doc = () => editorOf([p("ab", ...field("SEQ x", "1"), "cd")]);
  // Positions: a1 b2, start 3, code 4, separator 5, "1" 6-7, end 7, c at 8.

  it("takes a selection crossing a marker over the whole field", () => {
    const editor = doc();
    const { from, to } = firstField(editor);
    editor.select(2, 6);
    expect([editor.state.selection.anchor, editor.state.selection.head]).toEqual([2, to]);
    editor.select(to + 1, 6);
    expect([editor.state.selection.anchor, editor.state.selection.head]).toEqual([to + 1, from]);
    editor.select(6, 9);
    expect([editor.state.selection.anchor, editor.state.selection.head]).toEqual([from, 9]);
  });

  it("gives the field up when the head comes back over it", () => {
    const editor = doc();
    const { from, to } = firstField(editor);
    editor.select(2, 6);
    expect(editor.state.selection.head).toBe(to);
    // Back to the other side of the end marker only: the same place.
    editor.select(2, to - 1);
    expect(editor.state.selection.head).toBe(to);
    editor.select(2, to - 2);
    expect(editor.state.selection.head).toBe(from);
  });

  it("keeps a selection inside the result, and the caret out of the code", () => {
    const editor = editorOf([p("ab", ...field("X", "result"), "cd")]);
    const { from, resultFrom } = firstField(editor);
    editor.select(resultFrom + 1, resultFrom + 3);
    expect(editor.state.selection.from).toBe(resultFrom + 1);
    // On, or back, as the caret was going.
    editor.select(from);
    editor.select(from + 1);
    expect(editor.state.selection.head).toBe(resultFrom);
    editor.select(resultFrom + 2);
    editor.select(from + 1);
    expect(editor.state.selection.head).toBe(from);
  });

  it("Backspace after a field selects it, then deletes it, undo bringing it back", () => {
    const editor = doc();
    const { from, to } = firstField(editor);
    editor.select(to);
    expect(editor.run(deleteBackward())).toBe(true);
    expect(editor.state.doc.textContent).toBe("ab1cd");
    expect([editor.state.selection.from, editor.state.selection.to]).toEqual([from, to]);
    editor.run(deleteBackward());
    expect(editor.state.doc.textContent).toBe("abcd");
    expect(fieldsIn(editor.state.doc)).toEqual([]);
    valid(editor);
    editor.run(undo);
    expect(fieldsIn(editor.state.doc)).toHaveLength(1);
  });

  it("Delete before a field selects it, and at the result's edges too", () => {
    const editor = doc();
    const { from, to, resultFrom, resultTo } = firstField(editor);
    for (const [at, run] of [
      [from, deleteForward()],
      [resultTo, deleteForward()],
      [resultFrom, deleteBackward()],
    ] as const) {
      editor.select(at);
      editor.run(run);
      expect([editor.state.selection.from, editor.state.selection.to]).toEqual([from, to]);
    }
  });

  it("still types and deletes inside a result", () => {
    const editor = editorOf([p(...field("X", "abc"))]);
    const { resultFrom } = firstField(editor);
    editor.select(resultFrom + 2);
    editor.run(deleteBackward());
    expect(firstField(editor).result).toBe("ac");
  });

  it("deleted while tracking, every part is marked and the field is skipped afterwards", () => {
    const editor = editorOf([p("ab", ...field("SEQ x", "1"), "cd")], {}, true);
    const { to } = firstField(editor);
    editor.select(to);
    editor.run(deleteBackward());
    editor.run(deleteBackward());
    const parts = (editor.getDocument().content.content?.[0]?.content ?? []).filter((n) =>
      n.type.startsWith("field"),
    );
    expect(parts).toHaveLength(4);
    expect(parts.every((n) => n.marks?.some((m) => m.type === "deletion"))).toBe(true);
    // The next Backspace goes on to the text before it.
    editor.run(deleteBackward());
    expect(firstField(editor).deleted).toBe(true);
    expect(JSON.stringify(editor.getDocument().content)).toContain('"text":"b"');
    editor.run(rejectAllChanges());
    expect(firstField(editor).deleted).toBe(false);
    expect(editor.state.doc.textContent).toBe("ab1cd");
  });

  it("selection never rests half in a field, whatever is asked (property)", () => {
    const content = [
      p("ab", ...field("A", "xy"), "cd", ...field("B", ""), "e"),
      p(...field("C", "z"), "f"),
    ];
    const editor = editorOf(content);
    const size = editor.state.doc.content.size;
    const fields = fieldsIn(editor.state.doc);
    const positions = fc.integer({ min: 1, max: size - 1 });
    fc.assert(
      fc.property(positions, positions, (anchor, head) => {
        const { state } = editor;
        const inline = (pos: number) => state.doc.resolve(pos).parent.inlineContent;
        fc.pre(inline(anchor) && inline(head));
        editor.dispatch(state.tr.setSelection(TextSelection.create(state.doc, anchor, head)));
        const { from, to, empty } = editor.state.selection;
        for (const f of fields) {
          // The caret is never in the code; a range holds a field whole or stays in or out of it.
          expect(from > f.from && from <= f.codeEnd).toBe(false);
          expect(to > f.from && to <= f.codeEnd).toBe(false);
          if (!empty) expect(from > f.from && from < f.to).toBe(to > f.from && to < f.to);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe("what a view shows", () => {
  const types = (...lists: string[][]) => lists;
  const whole = ["fieldStart", "fieldCode", "fieldSeparator", "text", "fieldEnd"];

  it("hides what is in a code range, a nested field's result included", () => {
    const [shown] = fieldDisplay(
      types(["fieldStart", "fieldCode", ...whole, "fieldSeparator", "text", "fieldEnd"]),
      false,
    );
    expect([...(shown?.hidden ?? [])]).toEqual([1, 3, 5]);
    expect(shown?.braces.size).toBe(0);
  });

  it("with codes, shows braces and hides results, paragraphs inside them going", () => {
    const shown = fieldDisplay(
      types(["fieldStart", "fieldCode", "fieldSeparator", "text"], ["text"], ["fieldEnd", "text"]),
      true,
    );
    expect([...(shown[0]?.braces ?? [])]).toEqual([
      [0, "{"],
      [2, "}"],
    ]);
    expect([...(shown[0]?.hidden ?? [])]).toEqual([3]);
    expect(shown[0]?.gone).toBe(false);
    expect(shown[1]?.gone).toBe(true);
    expect(shown[2]?.gone).toBe(false);
    expect(shown[2]?.hidden.size).toBe(0);
  });

  it("toggles codes through a command, the caret leaving a result then hidden", () => {
    const editor = editorOf([p("a", ...field("X", "res"), "b")]);
    const { resultFrom, to } = firstField(editor);
    editor.select(resultFrom + 1);
    expect(fieldCodesShown(editor.state)).toBe(false);
    editor.run(toggleFieldCodes);
    expect(fieldCodesShown(editor.state)).toBe(true);
    expect(editor.state.selection.head).toBe(to);
    expect(undoDepth(editor.state)).toBe(0);
  });
});

describe("updateFields", () => {
  it("numbers SEQ fields, each sequence by itself, with \\r, \\c, \\h and \\*", () => {
    const editor = editorOf([
      p(...field("SEQ a", "9")),
      p(...field("SEQ b \\* ROMAN", "9")),
      p(...field("SEQ a", "9")),
      p(...field("SEQ a \\c", "9")),
      p(...field("SEQ a \\r 7", "9")),
      p(...field("SEQ a \\* roman", "9")),
      p(...field("SEQ a \\h", "9")),
      p(...field('SEQ a \\# "000"', "9")),
    ]);
    const report = updateFields(editor);
    expect(report.updated).toBe(8);
    expect(results(editor)).toEqual(["1", "I", "2", "2", "7", "viii", "", "010"]);
  });

  it("restarts SEQ at a heading with \\s", () => {
    const editor = editorOf([
      styled("Heading1", "One"),
      p(...field("SEQ a \\s 1")),
      p(...field("SEQ a \\s 1")),
      styled("Heading1", "Two"),
      p(...field("SEQ a \\s 1")),
    ]);
    updateFields(editor);
    expect(results(editor)).toEqual(["1", "2", "1"]);
  });

  it("fills page fields from the layout, formats and all", () => {
    const editor = editorOf([
      p(...field("PAGE", "?")),
      p(...field("PAGE \\* ROMAN", "?")),
      p(...field("NUMPAGES", "?")),
      p(...field("SECTIONPAGES", "?")),
    ]);
    updateFields(editor, {
      layout: { pages: 12, pageAt: () => ({ number: 4, sectionPages: 5, format: "lowerRoman" }) },
    });
    expect(results(editor)).toEqual(["iv", "IV", "12", "5"]);
  });

  it("reports page fields it has no layout for, and keeps them", () => {
    const editor = editorOf([p(...field("PAGE", "3")), p(...field("NUMPAGES", "4"))]);
    const report = updateFields(editor);
    expect(results(editor)).toEqual(["3", "4"]);
    expect(report.skipped.map((s) => s.reason)).toEqual(["no-layout", "no-layout"]);
  });

  it("gives DATE and TIME the time asked, leaves locked fields and reports them", () => {
    const now = new Date(2026, 10, 18, 9, 5);
    const editor = editorOf([
      p(...field('DATE \\@ "d MMM yyyy"', "x")),
      p(...field('TIME \\@ "HH:mm"', "x")),
      p(...field('DATE \\@ "yyyy"', "kept", { locked: true })),
    ]);
    const report = updateFields(editor, { now });
    expect(results(editor)).toEqual(["18 Nov 2026", "09:05", "kept"]);
    expect(report.skipped).toMatchObject([{ reason: "locked" }]);
  });

  it("keeps unknown instructions and missing bookmarks, reporting them", () => {
    const editor = editorOf([
      p(...field("WEIRD thing", "a")),
      p(...field("REF nowhere", "b")),
      p(...field("SEQ a \\z", "c")),
      p(...field("SEQ b \\* Nonsense", "d")),
    ]);
    const report = updateFields(editor);
    expect(results(editor)).toEqual(["a", "b", "c", "d"]);
    expect(report.skipped.map((s) => [s.reason, s.detail])).toEqual([
      ["unsupported-switch", "\\z"],
      ["unsupported-switch", "\\*"],
      ["unknown", undefined],
      ["missing-bookmark", "nowhere"],
    ]);
  });

  const marked: NodeJSON[] = [
    { type: "bookmarkStart", attrs: { id: 1, name: "there" } },
    { type: "text", text: "Marked", marks: [{ type: "bold" }] },
    { type: "bookmarkEnd", attrs: { id: 1 } },
  ];

  it("REF copies the bookmark with its formatting; a bare name is a REF", () => {
    const editor = editorOf([
      p(...marked, " rest"),
      p(...field("REF there \\h")),
      p(...field("there")),
    ]);
    const report = updateFields(editor);
    expect(report.skipped).toEqual([]);
    expect(results(editor)).toEqual(["Marked", "Marked"]);
    const json = JSON.stringify(editor.getDocument().content.content?.[1]);
    expect(json).toContain('"marks":[{"type":"bold"');
  });

  it("REF \\* Upper and \\* CHARFORMAT take the field's own format", () => {
    const code = { type: "fieldCode", attrs: { text: " REF there \\* Upper \\* CHARFORMAT " } };
    const editor = editorOf([
      p(...marked),
      p(
        { type: "fieldStart" },
        { ...code, marks: [{ type: "italic" }] },
        { type: "fieldSeparator" },
        { type: "fieldEnd" },
      ),
    ]);
    updateFields(editor);
    expect(results(editor)).toEqual(["MARKED"]);
    const json = JSON.stringify(editor.getDocument().content.content?.[1]);
    expect(json).toContain('"text":"MARKED","marks":[{"type":"italic"');
  });

  it("REF \\p, PAGEREF and PAGEREF \\p say where", () => {
    const editor = editorOf([
      p(...field("REF there \\p")),
      p(...marked),
      p(...field("REF there \\p")),
      p(...field("PAGEREF there \\h")),
      p(...field("PAGEREF there \\p")),
    ]);
    updateFields(editor, {
      layout: {
        pages: 3,
        pageAt: (pos) => ({ number: pos < 20 ? 2 : 3, sectionPages: 3 }),
      },
    });
    expect(results(editor)).toEqual(["below", "above", "2", "on page 2"]);
  });

  it("MERGEFORMAT keeps the old result's look, a field without one takes its code's", () => {
    const old: NodeJSON = { type: "text", text: "old", marks: [{ type: "bold" }] };
    const editor = editorOf([
      p(
        { type: "fieldStart" },
        { type: "fieldCode", attrs: { text: " SEQ a \\* MERGEFORMAT " } },
        { type: "fieldSeparator" },
        old,
        { type: "fieldEnd" },
      ),
      p(
        { type: "fieldStart" },
        { type: "fieldCode", attrs: { text: " SEQ b " } },
        { type: "fieldSeparator" },
        old,
        { type: "fieldEnd" },
      ),
    ]);
    updateFields(editor);
    const [first, second] = editor.getDocument().content.content ?? [];
    expect(first?.content?.find((n) => n.type === "text")?.marks).toEqual([{ type: "bold" }]);
    expect(second?.content?.find((n) => n.type === "text")?.marks).toBeUndefined();
  });

  it("gives a field without a separator one when it has a result", () => {
    const editor = editorOf([
      p(
        { type: "fieldStart" },
        { type: "fieldCode", attrs: { text: "SEQ a" } },
        { type: "fieldEnd" },
      ),
    ]);
    updateFields(editor);
    expect(firstField(editor).separator).not.toBeNull();
    expect(results(editor)).toEqual(["1"]);
    valid(editor);
  });

  it("is one undo step, and doing it twice changes nothing more", () => {
    const editor = editorOf([p(...field("SEQ a", "5")), p(...field("SEQ a", "5"))]);
    updateFields(editor);
    expect(undoDepth(editor.state)).toBe(1);
    const after = editor.state.doc;
    const report = updateFields(editor);
    expect(report).toMatchObject({ updated: 0, unchanged: 2 });
    expect(editor.state.doc).toBe(after);
    editor.run(undo);
    expect(results(editor)).toEqual(["5", "5"]);
    editor.run(redo);
    expect(results(editor)).toEqual(["1", "2"]);
  });

  it("while tracking, records the change, and again without piling up", () => {
    const editor = editorOf([p(...field("SEQ a", "5"))], {}, true);
    updateFields(editor);
    const json = () => JSON.stringify(editor.getDocument().content);
    expect(json()).toContain('"text":"5","marks":[{"type":"deletion"');
    expect(json()).toContain('"text":"1","marks":[{"type":"insertion"');
    expect(firstField(editor).result).toBe("1");
    updateFields(editor);
    expect(json().match(/"insertion"/g)).toHaveLength(1);
    editor.run(acceptAllChanges());
    expect(firstField(editor).result).toBe("1");
    expect(json()).not.toContain('"deletion"');
    valid(editor);
  });

  it("only: a caret takes the field around it, a range what it touches, a function its pick", () => {
    const content = [
      p(...field("SEQ a", "x")),
      p(...field("SEQ a", "x")),
      p(...field("SEQ a", "x")),
    ];
    const caret = editorOf(content);
    const second = fieldsIn(caret.state.doc)[1] as ReturnType<typeof fieldsIn>[0];
    updateFields(caret, { only: { from: second.resultFrom, to: second.resultFrom } });
    expect(results(caret)).toEqual(["x", "2", "x"]);
    const range = editorOf(content);
    updateFields(range, { only: { from: 0, to: second.to } });
    expect(results(range)).toEqual(["1", "2", "x"]);
    const picked = editorOf(content);
    let n = 0;
    updateFields(picked, { only: () => n++ === 2 });
    expect(results(picked)).toEqual(["x", "x", "3"]);
  });

  it("MERGEFIELD: from data, \\b and \\f around a value, none around nothing", () => {
    const editor = editorOf([
      p(...field("MERGEFIELD Name", "«Name»")),
      p(...field('MERGEFIELD City \\b "in " \\f "!"', "«City»")),
      p(...field('MERGEFIELD Gone \\b "x"', "«Gone»")),
      p(...field("MERGEFIELD Missing", "«Missing»")),
      p(...field('MERGEFIELD Total \\# "0.00"', "«Total»")),
      p(...field("MERGEFIELD Name \\* Upper", "«Name»")),
    ]);
    const report = updateFields(editor, {
      data: { Name: "Ada", City: "Paris", Gone: "", Total: 3 },
    });
    expect(results(editor)).toEqual(["Ada", "in Paris!", "", "«Missing»", "3.00", "ADA"]);
    expect(report.skipped).toMatchObject([{ reason: "no-data", detail: "Missing" }]);
    // Without data merge fields stay as they are, unreported.
    expect(updateFields(editorOf([p(...field("MERGEFIELD A", "x"))])).skipped).toEqual([]);
  });

  it("filled from data while tracking, the value is a tracked insertion", () => {
    const editor = editorOf([p(...field("MERGEFIELD Name", "«Name»"))], {}, true);
    updateFields(editor, { data: { Name: "Ada" } });
    expect(JSON.stringify(editor.getDocument().content)).toContain(
      '"text":"Ada","marks":[{"type":"insertion"',
    );
  });

  describe("in stories", () => {
    const stories = {
      h1: {
        kind: "header" as const,
        content: {
          type: "doc" as const,
          content: [p(...field("REF there", "?"), ...field("PAGE", "7"))],
        },
      },
    };
    const body = [
      p({ type: "bookmarkStart", attrs: { id: 1, name: "there" } }, "T", {
        type: "bookmarkEnd",
        attrs: { id: 1 },
      }),
    ];
    const section = { headers: { default: "h1" } };

    it("updates them with the body, one undo step, page fields left to the view", () => {
      const editor = editorOf(body, { stories, section });
      updateFields(editor, { layout: pagesEvery(100) });
      const tree = () => (editor.story("h1") as Editor).state.doc;
      expect(fieldsIn(tree()).map((f) => f.result)).toEqual(["T", "7"]);
      expect(undoDepth(editor.state)).toBe(1);
      editor.run(undo);
      expect(fieldsIn(tree()).map((f) => f.result)).toEqual(["?", "7"]);
    });

    it("tracks them when tracking is on", () => {
      const editor = editorOf(body, { stories, section }, true);
      updateFields(editor);
      const json = JSON.stringify(editor.getDocument().stories?.h1?.content);
      expect(json).toContain('"text":"T","marks":[{"type":"insertion"');
    });

    it("updates from a story's own editor", () => {
      const editor = editorOf(body, { stories, section });
      const story = editor.story("h1") as Editor;
      updateFields(story, { only: { from: 0, to: story.state.doc.content.size } });
      expect(fieldsIn(story.state.doc)[0]?.result).toBe("T");
      expect(JSON.stringify(editor.getDocument().stories?.h1?.content)).toContain('"text":"T"');
    });
  });
});

describe("tables of contents", () => {
  const headings = [
    styled("Heading1", "First"),
    p("body"),
    styled("Heading2", "Second"),
    styled("Note", "A note"),
    styled("Heading1", "Third"),
  ];
  const tocText = (editor: Editor) => firstField(editor).result;

  it("is inserted as Word's: styles, _Toc bookmarks, links, nested PAGEREF, right tab", () => {
    const editor = editorOf([p(), ...headings]);
    editor.select(1);
    expect(editor.run(insertTableOfContents({ layout: pagesEvery(1000) }))).toBe(true);
    expect(firstField(editor).instruction).toBe('TOC \\o "1-3" \\h \\z \\u');
    expect(tocText(editor)).toBe("First\t1\rSecond\t1\rThird\t1");
    const document = editor.getDocument();
    const [one, two, three, end] = document.content.content ?? [];
    expect(one?.attrs).toMatchObject({
      style: "TOC1",
      tabs: [{ position: 9016, kind: "right", leader: "dot" }],
    });
    expect(two?.attrs?.style).toBe("TOC2");
    expect(three?.attrs?.style).toBe("TOC1");
    expect(end?.content?.map((n) => n.type)).toEqual(["fieldEnd"]);
    const styles = document.styles.map((s) => s.id);
    expect(styles).toEqual(expect.arrayContaining(["TOC1", "TOC2", "Hyperlink"]));
    expect(document.styles.find((s) => s.id === "TOC2")?.paragraph?.indent?.left).toBe(220);
    // The entries point at bookmarks around their headings.
    const nested = fieldsIn(editor.state.doc).filter((f) => f.name === "PAGEREF");
    expect(nested).toHaveLength(3);
    const name = nested[0]?.instruction.split(" ")[1] as string;
    expect(name).toMatch(/^_Toc\d+$/);
    expect(JSON.stringify(document.content)).toContain(
      `"bookmarkStart","attrs":{"id":0,"name":"${name}"`,
    );
    expect(JSON.stringify(one)).toContain(`"anchor":"${name}"`);
    valid(editor);
    // One undo step takes it all back.
    editor.run(undo);
    expect(fieldsIn(editor.state.doc)).toEqual([]);
    expect(editor.state.doc.childCount).toBe(6);
  });

  it("in a paragraph with text, goes in one of its own", () => {
    const editor = editorOf([p("before after"), ...headings]);
    editor.select(8);
    editor.run(insertTableOfContents({ layout: pagesEvery(1000), hyperlinks: false }));
    const texts: string[] = [];
    editor.state.doc.forEach((node) => {
      texts.push(node.textContent);
    });
    expect(texts[0]).toBe("before ");
    expect(texts.at(-headings.length - 1)).toBe("after");
    expect(JSON.stringify(editor.getDocument().content)).not.toContain('"link"');
    valid(editor);
  });

  it("follows \\o, \\u and \\t", () => {
    const outline: NodeJSON = {
      type: "paragraph",
      attrs: { outlineLevel: 1 },
      content: [text("Outlined")],
    };
    const make = (code: string) => {
      const editor = editorOf([p(...field(code)), p(), ...headings, outline]);
      updateFields(editor, { layout: pagesEvery(1000) });
      return tocText(editor).replace(/\t\d+/g, "").split("\r");
    };
    expect(make('TOC \\o "1-1"')).toEqual(["First", "Third"]);
    expect(make('TOC \\o "2-2" \\u')).toEqual(["Second", "Outlined"]);
    expect(make('TOC \\t "Side note,2"')).toEqual(["A note"]);
    expect(make("TOC")).toEqual(["First", "Second", "Third"]);
  });

  it("leaves page numbers out with \\n, and says so when nothing is found", () => {
    const editor = editorOf([p(...field('TOC \\o "1-2" \\n "2-2"')), p(), ...headings]);
    updateFields(editor, { layout: pagesEvery(1000) });
    expect(tocText(editor)).toBe("First\t1\rSecond\rThird\t1");
    const none = editorOf([p(...field("TOC \\o")), p("text")]);
    updateFields(none);
    expect(tocText(none)).toBe("No table of contents entries found.");
    valid(none);
  });

  it("lists a numbered heading's number, reports switches it does not follow", () => {
    const numbering = {
      abstracts: [{ id: 1, levels: [{ level: 0, format: "decimal", text: "%1.", start: 1 }] }],
      instances: [{ id: 1, abstract: 1 }],
    };
    const numbered: NodeJSON = {
      type: "paragraph",
      attrs: { style: "Heading1", numbering: { id: 1, level: 0 } },
      content: [text("Numbered")],
    };
    const editor = editorOf([p(...field("TOC")), p(), numbered], { numbering } as never);
    updateFields(editor, { layout: pagesEvery(1000) });
    expect(tocText(editor)).toBe("1.\tNumbered\t1");
    const other = editorOf([p(...field("TOC \\c Figure", "kept")), p()]);
    const report = updateFields(other);
    expect(tocText(other)).toBe("kept");
    expect(report.skipped).toMatchObject([{ reason: "unsupported-switch", detail: "\\c" }]);
  });

  it("is rebuilt while tracking as tracked content", () => {
    const editor = editorOf([p(...field("TOC \\o")), p(), ...headings], {}, true);
    updateFields(editor, { layout: pagesEvery(1000) });
    expect(tocText(editor)).toBe("First\t1\rSecond\t1\rThird\t1");
    expect(JSON.stringify(editor.getDocument().content)).toContain(
      '"text":"First","marks":[{"type":"insertion"',
    );
    editor.run(rejectAllChanges());
    expect(fieldsIn(editor.state.doc).filter((f) => f.name === "PAGEREF")).toEqual([]);
    valid(editor);
  });
});

describe("inserting fields", () => {
  it("puts a page number at the caret, worked out from the layout", () => {
    const editor = editorOf([p("ab")]);
    editor.select(2);
    editor.run(
      insertPageNumber({ layout: { pages: 3, pageAt: () => ({ number: 3, sectionPages: 3 }) } }),
    );
    expect(firstField(editor)).toMatchObject({ instruction: "PAGE", result: "3" });
    expect(editor.state.selection.head).toBe(firstField(editor).to);
    expect(editor.state.doc.textContent).toBe("a3b");
    valid(editor);
  });

  it("replaces the selection, and keeps the marks of the text there", () => {
    const editor = editorOf([
      p({ type: "text", text: "abc", marks: [{ type: "bold" }] } as NodeJSON),
    ]);
    editor.select(1, 3);
    editor.run(insertField("SEQ a"));
    expect(editor.state.doc.textContent).toBe("1c");
    expect(JSON.stringify(editor.getDocument().content)).toContain(
      '"fieldStart","marks":[{"type":"bold"',
    );
  });

  it("puts the date in Word's picture", () => {
    const editor = editorOf([p("")]);
    editor.select(1);
    editor.run(insertDate("d MMMM yyyy", { now: new Date(2026, 0, 2) }));
    expect(firstField(editor)).toMatchObject({
      instruction: 'DATE \\@ "d MMMM yyyy"',
      result: "2 January 2026",
    });
  });

  it("works in a story, its page number left for the view to draw", () => {
    const editor = editorOf([p("x")], {
      section: { headers: { default: "h1" } },
      stories: { h1: { kind: "header", content: { type: "doc", content: [p("")] } } },
    });
    const story = editor.story("h1") as Editor;
    story.select(1);
    expect(story.run(insertPageNumber())).toBe(true);
    expect(fieldsIn(story.state.doc)[0]?.result).toBe("1");
    expect(story.can(insertTableOfContents())).toBe(false);
    story.run(undo);
    expect(fieldsIn(story.state.doc)).toEqual([]);
  });

  describe("cross-references", () => {
    const content = [
      p({ type: "bookmarkStart", attrs: { id: 3, name: "spot" } }, "Spot", {
        type: "bookmarkEnd",
        attrs: { id: 3 },
      }),
      styled("Heading1", "Chapter"),
      p("here"),
    ];

    it("lists bookmarks and headings", () => {
      const editor = editorOf(content);
      const targets = crossReferenceTargets(editor.state);
      expect(targets.bookmarks).toEqual([{ name: "spot", text: "Spot" }]);
      expect(targets.headings).toMatchObject([{ text: "Chapter", level: 1 }]);
    });

    it("to a bookmark: its text, or its page", () => {
      const editor = editorOf(content);
      editor.select(editor.state.doc.content.size - 1);
      editor.run(insertCrossReference({ to: "spot" }));
      expect(fieldsIn(editor.state.doc)[0]).toMatchObject({
        instruction: "REF spot \\h",
        result: "Spot",
      });
      editor.run(insertCrossReference({ to: "spot", show: "page", layout: pagesEvery(1000) }));
      expect(fieldsIn(editor.state.doc)[1]).toMatchObject({
        instruction: "PAGEREF spot \\h",
        result: "1",
      });
    });

    it("to a heading: gives it a _Ref bookmark, reused the next time", () => {
      const editor = editorOf(content);
      const { pos } = crossReferenceTargets(editor.state).headings[0] as { pos: number };
      editor.select(editor.state.doc.content.size - 1);
      editor.run(insertCrossReference({ to: pos }));
      const first = firstField(editor);
      expect(first.result).toBe("Chapter");
      const name = first.instruction.split(" ")[1] as string;
      expect(name).toMatch(/^_Ref\d+$/);
      const next = crossReferenceTargets(editor.state).headings[0] as { pos: number };
      editor.run(insertCrossReference({ to: next.pos, link: false }));
      expect(fieldsIn(editor.state.doc)[1]?.instruction).toBe(`REF ${name}`);
      valid(editor);
      editor.run(undo);
      editor.run(undo);
      expect(JSON.stringify(editor.getDocument().content)).not.toContain("_Ref");
    });

    it("says it cannot when the target is gone", () => {
      const editor = editorOf(content);
      expect(editor.can(insertCrossReference({ to: "nothing" }))).toBe(false);
      expect(editor.can(insertCrossReference({ to: 1 }))).toBe(false);
    });
  });

  it("numbers a clause reference as Word's \\r, \\n and \\w do", () => {
    const numbering = {
      abstracts: [
        {
          id: 1,
          levels: [
            { level: 0, format: "decimal", text: "%1.", start: 1 },
            { level: 1, format: "decimal", text: "%1.%2", start: 1 },
            { level: 2, format: "lowerLetter", text: "(%3)", start: 1 },
          ],
        },
      ],
      instances: [{ id: 1, abstract: 1 }],
    };
    const item = (level: number, ...content: (NodeJSON | string)[]): NodeJSON => ({
      ...p(...content),
      attrs: { numbering: { id: 1, level } },
    });
    const mark: NodeJSON[] = [
      { type: "bookmarkStart", attrs: { id: 1, name: "c" } },
      text("target"),
      { type: "bookmarkEnd", attrs: { id: 1 } },
    ];
    const editor = editorOf(
      [
        item(0, "one"),
        item(1, "one one"),
        item(2, ...mark),
        item(2, ...field("REF c \\r"), " ", ...field("REF c \\n"), " ", ...field("REF c \\w")),
        p(...field("REF c \\r"), ...field("REF c \\w \\t")),
      ],
      { numbering } as never,
    );
    updateFields(editor);
    expect(results(editor)).toEqual(["(a)", "(a)", "1.1(a)", "1.1(a)", "1.1"]);
  });
});
