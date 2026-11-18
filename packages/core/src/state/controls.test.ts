import { describe, expect, it } from "vitest";
import type { NodeJSON } from "../model/index.js";
import type { ControlJSON, FoliDocument } from "../v3/document.js";
import { createDocument, parseDocument } from "../v3/document.js";
import {
  deleteBackward,
  deleteForward,
  deleteSelection,
  insertText,
  splitBlock,
  toggleMark,
} from "./commands.js";
import {
  addRepeatingItem,
  controlAt,
  controlProperties,
  controlSpot,
  controlsIn,
  controlValues,
  insertControl,
  insertControlText,
  setControlProperties,
  setControlValue,
} from "./controls.js";
import { createEditor, type Editor } from "./editor.js";
import { redo, undo, undoDepth } from "./history.js";
import { acceptAllChanges, rejectAllChanges } from "./review.js";
import { TextSelection } from "./selection.js";
import { fitPaste } from "./wordclip.js";

const text = (value: string, marks?: NodeJSON["marks"]): NodeJSON => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const inline = (id: string, ...content: NodeJSON[]): NodeJSON[] => [
  { type: "controlStart", attrs: { id } },
  ...content,
  { type: "controlEnd", attrs: { id } },
];
const p = (...content: (NodeJSON | NodeJSON[] | string)[]): NodeJSON => ({
  type: "paragraph",
  content: content
    .flat()
    .filter((c) => c !== "")
    .map((c) => (typeof c === "string" ? text(c) : c)),
});
const inBlock = (block: NodeJSON, ...ids: string[]): NodeJSON => ({
  ...block,
  attrs: { ...block.attrs, controls: ids },
});
const PLACEHOLDER_STYLE = {
  id: "PlaceholderText",
  type: "character" as const,
  name: "Placeholder Text",
  run: [{ type: "color", attrs: { value: "666666" } }],
};
const hint = (value: string) =>
  text(value, [{ type: "characterStyle", attrs: { id: "PlaceholderText" } }]);

function documentOf(
  blocks: NodeJSON[],
  controls: Record<string, ControlJSON>,
  more: Partial<FoliDocument> = {},
): FoliDocument {
  const base = createDocument({ type: "doc", content: blocks });
  return parseDocument({
    ...base,
    styles: [...base.styles, PLACEHOLDER_STYLE],
    controls,
    ...more,
  });
}
const editorOf = (
  blocks: NodeJSON[],
  controls: Record<string, ControlJSON>,
  options: { track?: boolean; more?: Partial<FoliDocument> } = {},
) =>
  createEditor({
    document: documentOf(blocks, controls, options.more),
    trackChanges: options.track ?? false,
    author: "A",
  });

const textOf = (editor: Editor) => editor.state.doc.textContent;
const range = (editor: Editor, id: string) =>
  controlsIn(editor.state.doc).find((r) => r.id === id) as NonNullable<
    ReturnType<typeof controlAt>
  >;
const props = (editor: Editor, id: string) => controlProperties(editor.state, id) as ControlJSON;
const inside = (editor: Editor, id: string, at = 0) =>
  editor.select(range(editor, id).contentFrom + at);
const valueAt = (editor: Editor, key: string) =>
  controlValues(editor.state).find((v) => v.id === key || v.tag === key);

describe("finding controls", () => {
  it("finds inline, block, row and cell controls, nested", () => {
    const cell = {
      type: "tableCell",
      attrs: { controls: ["cell"] },
      content: [p("x")],
    };
    const row = { type: "tableRow", attrs: { controls: ["row"] }, content: [cell] };
    const table = {
      type: "table",
      attrs: { grid: [2000] },
      content: [row],
    } as unknown as NodeJSON;
    const editor = editorOf(
      [
        inBlock(p("a", inline("in", text("b"))), "outer"),
        inBlock(p("c"), "outer", "inner"),
        table,
        p(""),
      ],
      {
        in: { kind: "text" },
        outer: { kind: "richText" },
        inner: { kind: "richText" },
        row: { kind: "richText" },
        cell: { kind: "richText" },
      },
    );
    const levels = Object.fromEntries(controlsIn(editor.state.doc).map((r) => [r.id, r.level]));
    expect(levels).toEqual({
      in: "inline",
      outer: "block",
      inner: "block",
      row: "row",
      cell: "cell",
    });
    const outer = range(editor, "outer");
    expect(editor.state.doc.resolve(outer.contentFrom).parent.textContent).toBe("ab");
    expect(editor.state.doc.resolve(outer.contentTo).parent.textContent).toBe("c");
    expect(controlAt(editor.state.doc, range(editor, "inner").contentFrom)?.id).toBe("inner");
  });

  it("tells a marker's two sides for one place", () => {
    const editor = editorOf([p("a", inline("c", text("b")), "d")], { c: { kind: "richText" } });
    const { from, contentFrom, contentTo } = range(editor, "c");
    expect(controlSpot(editor.state.doc, from, contentFrom)).toBe(true);
    expect(controlSpot(editor.state.doc, contentFrom, contentTo)).toBe(false);
  });
});

describe("locks", () => {
  const blocks = (id: string) => [p("before"), p("x ", inline(id, text("held")), " y"), p("after")];

  it("a control locked against deletion is edited but stays", () => {
    const editor = editorOf(blocks("c"), { c: { kind: "richText", lock: "sdtLocked" } });
    inside(editor, "c", 2);
    editor.commands.insertText("!");
    expect(textOf(editor)).toContain("he!ld");
    const { from, to } = range(editor, "c");
    editor.select(from, to);
    expect(editor.run(deleteSelection)).toBe(true);
    expect(textOf(editor)).toContain("he!ld");
    editor.select(1, editor.state.doc.content.size - 1);
    editor.run(deleteSelection);
    expect(range(editor, "c")).toBeDefined();
  });

  it("a control with locked content takes no edit, however it comes, but can go", () => {
    const editor = editorOf(blocks("c"), { c: { kind: "richText", lock: "contentLocked" } });
    const before = editor.state.doc;
    inside(editor, "c", 1);
    editor.commands.insertText("x");
    editor.run(deleteBackward());
    editor.run(deleteForward());
    editor.run(splitBlock);
    const { contentFrom, contentTo, from, to } = range(editor, "c");
    editor.select(contentFrom, contentTo);
    editor.run(toggleMark("bold"));
    editor.run(deleteSelection);
    editor.dispatch(editor.state.tr.insertText("code", contentFrom + 1));
    expect(editor.state.doc.eq(before)).toBe(true);
    // Half of it, from outside: not without the other half.
    editor.dispatch(editor.state.tr.delete(from - 1, contentFrom + 1));
    expect(editor.state.doc.eq(before)).toBe(true);
    // Whole: it goes, as in Word.
    editor.select(from, to);
    editor.run(deleteSelection);
    expect(controlsIn(editor.state.doc)).toHaveLength(0);
    expect(editor.run(undo)).toBe(true);
    expect(editor.state.doc.eq(before)).toBe(true);
  });

  it("locked both ways: neither edited nor deleted, across its boundary either", () => {
    const editor = editorOf(blocks("c"), { c: { kind: "richText", lock: "sdtContentLocked" } });
    const before = editor.state.doc;
    editor.select(3, editor.state.doc.content.size - 2);
    editor.run(deleteSelection);
    editor.commands.insertText("over");
    expect(editor.state.doc.eq(before)).toBe(true);
  });

  it("holds while tracking, and a tracked change around it stays out of it", () => {
    const editor = editorOf(
      blocks("c"),
      { c: { kind: "richText", lock: "contentLocked" } },
      {
        track: true,
      },
    );
    const before = editor.state.doc;
    inside(editor, "c", 1);
    editor.commands.insertText("x");
    const { contentFrom, contentTo } = range(editor, "c");
    editor.select(contentFrom, contentTo);
    editor.run(deleteSelection);
    expect(editor.state.doc.eq(before)).toBe(true);
    editor.select(2);
    editor.commands.insertText("n");
    expect(textOf(editor)).toContain("bnefore");
  });

  it("a bound control's content is read-only", () => {
    const editor = editorOf(blocks("c"), { c: { kind: "text", binding: { xpath: "/a" } } });
    inside(editor, "c", 1);
    editor.commands.insertText("!");
    expect(textOf(editor)).not.toContain("!");
    expect(editor.run(setControlValue("c", "new"))).toBe(false);
  });

  it("holds in a story", () => {
    const editor = editorOf(
      [p("body")],
      { c: { kind: "text", lock: "sdtContentLocked" } },
      {
        more: {
          stories: {
            h: {
              kind: "header",
              content: { type: "doc", content: [p(inline("c", text("kept")))] },
            },
          },
        },
      },
    );
    const story = editor.story("h") as Editor;
    story.select(3);
    story.commands.insertText("x");
    expect(textOf(story)).toBe("kept");
    story.select(0, story.state.doc.content.size);
    story.run(deleteSelection);
    expect(textOf(story)).toBe("kept");
  });

  it("tracked changes in locked content can be accepted, not rejected", () => {
    const inserted = text("new", [
      { type: "insertion", attrs: { id: 1, author: "A", date: "2026-01-01T00:00:00Z" } },
    ]);
    const blocksWith = [p(inline("c", inserted)), p("x", inserted)];
    const lock: ControlJSON = { kind: "richText", lock: "contentLocked" };
    const rejecting = editorOf(blocksWith, { c: lock });
    rejecting.run(rejectAllChanges());
    expect(textOf(rejecting)).toBe("newx");
    const accepting = editorOf(blocksWith, { c: lock });
    expect(accepting.run(acceptAllChanges())).toBe(true);
    expect(JSON.stringify(accepting.state.doc.toJSON())).not.toContain("insertion");
  });
});

describe("what a control holds", () => {
  it("plain text: one run, no paragraph, no line break unless it takes them", () => {
    const editor = editorOf([p(inline("c", text("ab")))], { c: { kind: "text" } });
    inside(editor, "c", 1);
    editor.run(splitBlock);
    editor.commands.insertHardBreak();
    expect(editor.state.doc.childCount).toBe(1);
    expect(textOf(editor)).toBe("ab");
    expect(editor.run(insertControlText("x\ny"))).toBe(true);
    expect(textOf(editor)).toBe("ax yb");
    editor.run(setControlProperties("c", { multiLine: true }));
    editor.handleKey("Enter");
    expect(JSON.stringify(editor.state.doc.toJSON())).toContain("hardBreak");
    expect(editor.state.doc.childCount).toBe(1);
  });

  it("plain text: formatting part of it formats all of it", () => {
    const editor = editorOf([p(inline("c", text("abcd")))], { c: { kind: "text" } });
    const { contentFrom } = range(editor, "c");
    editor.select(contentFrom, contentFrom + 2);
    editor.run(toggleMark("bold"));
    const runs = editor.state.doc.firstChild?.toJSON().content?.filter((n) => n.type === "text");
    expect(runs).toHaveLength(1);
    expect(runs?.[0]?.marks?.[0]?.type).toBe("bold");
  });

  it("a drop-down list and a check box take no typing", () => {
    const editor = editorOf([p(inline("d", text("One")), inline("k", text("☐")))], {
      d: { kind: "dropDown", items: [{ value: "1", display: "One" }] },
      k: { kind: "checkbox", checked: false },
    });
    const before = editor.state.doc;
    inside(editor, "d", 1);
    editor.commands.insertText("x");
    inside(editor, "k", 1);
    editor.commands.insertText("x");
    expect(editor.state.doc.eq(before)).toBe(true);
  });

  it("Enter stays out of an inline control, and works in a block one", () => {
    const editor = editorOf([p(inline("c", text("ab"))), inBlock(p("cd"), "b")], {
      c: { kind: "richText" },
      b: { kind: "richText" },
    });
    inside(editor, "c", 1);
    expect(editor.handleKey("Enter")).toBe(true);
    expect(editor.state.doc.childCount).toBe(2);
    inside(editor, "b", 1);
    editor.handleKey("Enter");
    expect(editor.state.doc.childCount).toBe(3);
    expect(range(editor, "b").to - range(editor, "b").from).toBe(6);
  });

  it("Backspace and Delete stop at its edges and reach in from outside", () => {
    const editor = editorOf([p("a", inline("c", text("bc")), "d")], { c: { kind: "richText" } });
    const before = editor.state.doc;
    inside(editor, "c");
    editor.handleKey("Backspace");
    editor.select(range(editor, "c").contentTo);
    editor.handleKey("Delete");
    expect(editor.state.doc.eq(before)).toBe(true);
    const { to, from, contentFrom, contentTo } = range(editor, "c");
    editor.select(to);
    editor.handleKey("Backspace");
    expect([editor.state.selection.from, editor.state.selection.to]).toEqual([
      contentFrom,
      contentTo,
    ]);
    editor.select(from);
    editor.handleKey("Delete");
    expect([editor.state.selection.from, editor.state.selection.to]).toEqual([
      contentFrom,
      contentTo,
    ]);
  });

  it("a selection crossing its edge takes it whole", () => {
    const editor = editorOf([p("ab", inline("c", text("cd")), "ef")], { c: { kind: "richText" } });
    const { from, to, contentFrom } = range(editor, "c");
    editor.select(2, contentFrom + 1);
    expect(editor.state.selection.to).toBe(to);
    editor.select(contentFrom + 1, to + 1);
    expect(editor.state.selection.from).toBe(from);
  });
});

describe("placeholders", () => {
  const showing: ControlJSON = {
    kind: "text",
    tag: "t",
    placeholder: { showing: true, docPart: "DefaultPlaceholder_-1854013440", text: "Type here" },
  };
  const of = (control: ControlJSON = showing, options = {}) =>
    editorOf([p("a", inline("c", hint("Type here")), "z")], { c: control }, options);

  it("is selected whole on entering, and left by the arrows' collapse", () => {
    const editor = of();
    inside(editor, "c", 3);
    const { contentFrom, contentTo, to } = range(editor, "c");
    expect([editor.state.selection.from, editor.state.selection.to]).toEqual([
      contentFrom,
      contentTo,
    ]);
    editor.select(contentTo);
    expect(editor.state.selection.from).toBe(to);
  });

  it("typing replaces it and looks like text; undo brings it back", () => {
    const editor = of();
    inside(editor, "c");
    editor.commands.insertText("x");
    editor.commands.insertText("y");
    expect(textOf(editor)).toBe("axyz");
    expect(props(editor, "c").placeholder?.showing).toBe(false);
    expect(JSON.stringify(editor.state.doc.toJSON())).not.toContain("characterStyle");
    expect(valueAt(editor, "t")?.value).toBe("xy");
    while (undoDepth(editor.state)) editor.run(undo);
    expect(textOf(editor)).toBe("aType herez");
    expect(props(editor, "c").placeholder?.showing).toBe(true);
    editor.run(redo);
    expect(props(editor, "c").placeholder?.showing).toBe(false);
  });

  it("emptying brings it back, selected", () => {
    const editor = of();
    inside(editor, "c");
    editor.commands.insertText("x");
    editor.run(deleteBackward());
    expect(textOf(editor)).toBe("aType herez");
    expect(props(editor, "c").placeholder?.showing).toBe(true);
    const { contentFrom, contentTo } = range(editor, "c");
    expect([editor.state.selection.from, editor.state.selection.to]).toEqual([
      contentFrom,
      contentTo,
    ]);
    expect(valueAt(editor, "t")).toMatchObject({ showingPlaceholder: true, value: null, text: "" });
  });

  it("Backspace and Delete leave it", () => {
    const editor = of();
    inside(editor, "c");
    expect(editor.handleKey("Backspace")).toBe(true);
    expect(editor.handleKey("Delete")).toBe(true);
    expect(textOf(editor)).toBe("aType herez");
  });

  it("tracked typing records the text, not the placeholder's deletion", () => {
    const editor = of(showing, { track: true });
    inside(editor, "c");
    editor.commands.insertText("x");
    expect(textOf(editor)).toBe("axz");
    const json = JSON.stringify(editor.state.doc.toJSON());
    expect(json).toContain("insertion");
    expect(json).not.toContain("deletion");
  });

  it("an emptied control without an entry shows Word's five spaces; none in a list's", () => {
    const editor = editorOf([p(inline("c", text("x")))], { c: { kind: "richText" } });
    inside(editor, "c", 1);
    editor.run(deleteBackward());
    expect(textOf(editor)).toBe("     ");
    expect(props(editor, "c").placeholder?.showing).toBe(true);
  });

  it("adds the style a document lacks", () => {
    const editor = createEditor({ document: createDocument() });
    editor.run(insertControl("text"));
    expect(editor.getDocument().styles.some((s) => s.id === "PlaceholderText")).toBe(true);
  });
});

describe("values", () => {
  const controls: Record<string, ControlJSON> = {
    text: { kind: "text", tag: "t" },
    rich: { kind: "richText", tag: "r" },
    drop: {
      kind: "dropDown",
      tag: "d",
      items: [
        { value: "1", display: "One" },
        { value: "2", display: "Two" },
      ],
      placeholder: { showing: true },
    },
    combo: { kind: "comboBox", tag: "o", items: [{ value: "a", display: "Alpha" }] },
    date: { kind: "date", tag: "w", dateFormat: "d MMMM yyyy" },
    box: { kind: "checkbox", tag: "b", checked: false },
    twin: { kind: "text", tag: "t" },
  };
  const of = (options = {}) =>
    editorOf(
      [
        p(
          inline("text", text("old")),
          inline("rich", text("r")),
          inline("drop", hint("Choose")),
          inline("combo", text("c")),
          inline("date", text("d")),
          inline("box", text("☐", [{ type: "font", attrs: { ascii: "MS Gothic" } }])),
          inline("twin", text("old")),
        ),
      ],
      controls,
      options,
    );

  it("fills each kind by tag or id and reads it back", () => {
    const editor = of();
    expect(editor.commands.setControlValue("t", "new")).toBe(true);
    expect(editor.commands.setControlValue("rich", { content: [text("bold!")] })).toBe(true);
    expect(editor.commands.setControlValue("d", "2")).toBe(true);
    expect(editor.commands.setControlValue("o", "free")).toBe(true);
    expect(editor.commands.setControlValue("w", new Date(2026, 2, 3))).toBe(true);
    expect(editor.commands.setControlValue("b", true)).toBe(true);
    const values = Object.fromEntries(editor.controlValues().map((v) => [v.id, v]));
    expect(values.text?.value).toBe("new");
    expect(values.twin?.value).toBe("new");
    expect(values.rich?.content).toEqual([text("bold!")]);
    expect(values.drop).toMatchObject({ value: "2", text: "Two", showingPlaceholder: false });
    expect(values.combo?.value).toBe("free");
    expect(values.date).toMatchObject({ value: "2026-03-03", text: "3 March 2026" });
    expect(values.box).toMatchObject({ value: true, text: "☒" });
    expect(props(editor, "date").date).toBe("2026-03-03T00:00:00Z");
    expect(props(editor, "drop").placeholder?.showing).toBe(false);
    expect(editor.commands.setControlValue("o", "Alpha")).toBe(true);
    expect(valueAt(editor, "o")?.value).toBe("a");
  });

  it("refuses what the control cannot hold", () => {
    const editor = of();
    expect(editor.commands.setControlValue("d", "9")).toBe(false);
    expect(editor.commands.setControlValue("b", "yes")).toBe(false);
    expect(editor.commands.setControlValue("nobody", "x")).toBe(false);
    expect(editor.commands.setControlValue("rich", { content: [{ type: "nope" }] })).toBe(false);
  });

  it("is one undo step, and tracked when tracking is on", () => {
    const editor = of();
    const before = editor.state.doc;
    editor.commands.setControlValue("t", "new");
    expect(editor.run(undo)).toBe(true);
    expect(editor.state.doc.eq(before)).toBe(true);
    const tracked = of({ track: true });
    tracked.commands.setControlValue("text", "new");
    const json = JSON.stringify(tracked.state.doc.toJSON());
    expect(json).toContain("insertion");
    expect(json).toContain("deletion");
    expect(valueAt(tracked, "text")?.value).toBe("new");
  });

  it("empties a control back to its placeholder", () => {
    const editor = of();
    editor.commands.setControlValue("d", "1");
    editor.commands.setControlValue("d", null);
    expect(valueAt(editor, "d")?.showingPlaceholder).toBe(true);
    expect(textOf(editor)).toContain("     ");
  });

  it("toggles a check box with Space", () => {
    const editor = of();
    inside(editor, "box");
    expect(editor.handleKey(" ")).toBe(true);
    expect(valueAt(editor, "b")?.value).toBe(true);
    editor.handleKey(" ");
    expect(valueAt(editor, "b")?.value).toBe(false);
  });

  it("drops a picked date when other text is typed over it", () => {
    const editor = of();
    editor.commands.setControlValue("w", "2026-03-03");
    inside(editor, "date", 1);
    editor.commands.insertText("x");
    expect(props(editor, "date").date).toBeUndefined();
    expect(valueAt(editor, "w")?.value).toBe("3x March 2026");
  });

  it("reaches controls in stories from the body's editor", () => {
    const editor = editorOf(
      [p(inline("a", text("x")))],
      { a: { kind: "text", tag: "t" }, b: { kind: "text", tag: "t" } },
      {
        more: {
          stories: {
            h: { kind: "header", content: { type: "doc", content: [p(inline("b", text("y")))] } },
          },
        },
      },
    );
    expect(editor.commands.setControlValue("t", "new")).toBe(true);
    expect(editor.controlValues().map((v) => [v.story, v.value])).toEqual([
      [undefined, "new"],
      ["h", "new"],
    ]);
    expect(undoDepth(editor.state)).toBe(1);
    editor.run(undo);
    expect(editor.controlValues().map((v) => v.value)).toEqual(["x", "y"]);
  });
});

describe("inserting controls", () => {
  const kinds: ControlJSON["kind"][] = ["text", "richText", "dropDown", "comboBox", "date"];

  it.each(kinds)("%s: at the caret, showing its placeholder, one undo step", (kind) => {
    const editor = createEditor({ document: createDocument() });
    editor.commands.insertText("ab");
    editor.select(2);
    expect(editor.run(insertControl(kind, { title: "T", tag: "g" }))).toBe(true);
    const value = editor.controlValues()[0];
    expect(value).toMatchObject({ kind, tag: "g", title: "T", showingPlaceholder: true });
    const id = value?.id as string;
    const { contentFrom, contentTo } = range(editor, id);
    expect(editor.state.selection.from).toBe(contentFrom);
    expect(editor.state.selection.to).toBe(contentTo);
    editor.run(undo);
    expect(textOf(editor)).toBe("ab");
  });

  it("a check box", () => {
    const editor = createEditor({ document: createDocument() });
    editor.run(insertControl("checkbox", { checked: true }));
    expect(editor.controlValues()[0]).toMatchObject({ value: true, text: "☒" });
  });

  it("around selected text and around paragraphs", () => {
    const editor = createEditor({
      document: createDocument({ type: "doc", content: [p("abc"), p("def")] }),
    });
    editor.select(2, 3);
    editor.run(insertControl("richText"));
    expect(editor.controlValues()[0]).toMatchObject({ text: "b", showingPlaceholder: false });
    editor.select(2, editor.state.doc.content.size - 2);
    editor.run(insertControl("richText", { tag: "around" }));
    expect(range(editor, editor.controlValues()[0]?.id as string).level).toBe("block");
  });

  it("a repeating section, its items copied with new ids", () => {
    const editor = createEditor({
      document: createDocument({ type: "doc", content: [p("item"), p("end")] }),
    });
    editor.select(2);
    editor.run(insertControl("repeating", { tag: "rep" }));
    const [section, item] = controlsIn(editor.state.doc);
    expect(props(editor, item?.id as string).kind).toBe("repeatingItem");
    editor.select((item?.to as number) - 1);
    editor.run(insertControl("text", { tag: "in" }));
    expect(editor.run(addRepeatingItem())).toBe(true);
    expect(textOf(editor).match(/item/g)).toHaveLength(2);
    const ranges = controlsIn(editor.state.doc);
    expect(new Set(ranges.map((r) => r.id)).size).toBe(ranges.length);
    expect(ranges.filter((r) => r.id === section?.id)).toHaveLength(1);
    expect(ranges.filter((r) => controlProperties(editor.state, r.id)?.tag === "in")).toHaveLength(
      2,
    );
    editor.run(undo);
    expect(textOf(editor).match(/item/g)).toHaveLength(1);
  });

  it("not inside a plain text control", () => {
    const editor = editorOf([p(inline("c", text("ab")))], { c: { kind: "text" } });
    inside(editor, "c", 1);
    editor.run(insertControl("date"));
    expect(controlsIn(editor.state.doc)).toHaveLength(1);
  });
});

describe("properties", () => {
  it("changes them in one undo step, and shows a picked date in its new format", () => {
    const editor = editorOf([p(inline("c", text("3 March 2026")))], {
      c: { kind: "date", dateFormat: "d MMMM yyyy", date: "2026-03-03T00:00:00Z" },
    });
    editor.run(setControlProperties("c", { title: "When", tag: "w", dateFormat: "dd/MM/yyyy" }));
    expect(props(editor, "c")).toMatchObject({ alias: "When", tag: "w" });
    expect(textOf(editor)).toBe("03/03/2026");
    editor.run(undo);
    expect(props(editor, "c").alias).toBeUndefined();
    expect(textOf(editor)).toBe("3 March 2026");
  });

  it("are changed on a locked control too", () => {
    const editor = editorOf([p(inline("c", text("x")))], {
      c: { kind: "text", lock: "sdtContentLocked" },
    });
    expect(editor.run(setControlProperties("c", { lock: "unlocked" }))).toBe(true);
    expect(props(editor, "c").lock).toBeUndefined();
    inside(editor, "c", 1);
    editor.run(insertText("y"));
    expect(textOf(editor)).toBe("xy");
  });
});

describe("copy and paste", () => {
  const paste = (editor: Editor, json: NodeJSON) => {
    const { doc, envelope } = fitPaste(editor.state, json);
    return { doc: doc.toJSON(), controls: envelope.controls ?? {} };
  };
  const content = { type: "doc", content: [p(inline("c", text("v")))] };

  it("a copy is a new control with the same properties", () => {
    const editor = editorOf([p(inline("c", text("v"))), p("")], {
      c: { kind: "text", tag: "t", ext: '<w:sdt><w:sdtPr><w:id w:val="5"/></w:sdtPr></w:sdt>' },
    });
    editor.select(editor.state.doc.content.size - 1);
    const { doc, controls } = paste(editor, content);
    const id = doc.content?.[0]?.content?.[0]?.attrs?.id as string;
    expect(id).not.toBe("c");
    expect(controls[id]).toEqual({ ...controls.c, ext: "<w:sdt><w:sdtPr></w:sdtPr></w:sdt>" });
  });

  it("cut and pasted, it stays the same control", () => {
    const editor = editorOf([p(inline("c", text("v"))), p("")], { c: { kind: "text" } });
    editor.select(range(editor, "c").from, range(editor, "c").to);
    editor.run(deleteSelection);
    const { doc } = paste(editor, content);
    expect(doc.content?.[0]?.content?.[0]?.attrs?.id).toBe("c");
  });

  it("a block control copied gets a new id on its blocks", () => {
    const editor = editorOf([inBlock(p("v"), "b"), p("")], { b: { kind: "richText" } });
    editor.select(editor.state.doc.content.size - 1);
    const { doc } = paste(editor, { type: "doc", content: [inBlock(p("v"), "b")] });
    expect(doc.content?.[0]?.attrs?.controls).not.toEqual(["b"]);
  });

  it("over its own selection it is the same control", () => {
    const editor = editorOf([p(inline("c", text("v")))], { c: { kind: "text" } });
    const { from, to } = range(editor, "c");
    editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
    const { doc } = paste(editor, content);
    expect(doc.content?.[0]?.content?.[0]?.attrs?.id).toBe("c");
  });
});
