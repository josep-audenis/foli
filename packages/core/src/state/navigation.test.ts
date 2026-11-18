import { describe, expect, it } from "vitest";
import type { NodeJSON } from "../model/index.js";
import type { FoliDocument } from "../v3/document.js";
import { createDocument, SCHEMA_VERSION } from "../v3/document.js";
import { createEditor, type Editor } from "./editor.js";
import { crossReferenceTargets } from "./fieldupdate.js";
import { undoDepth } from "./history.js";
import {
  deleteBookmark,
  documentOutline,
  goTo,
  insertBookmark,
  isBookmarkName,
  listBookmarks,
  renameBookmark,
} from "./navigation.js";

const t = (text: string): NodeJSON => ({ type: "text", text });
const p = (text: string, attrs?: Record<string, unknown>, ...more: NodeJSON[]): NodeJSON => ({
  type: "paragraph",
  ...(attrs ? { attrs } : {}),
  content: [...(text ? [t(text)] : []), ...more],
});
const docOf = (...content: NodeJSON[]): NodeJSON => ({ type: "doc", content });
const atom = (type: string, attrs?: Record<string, unknown>): NodeJSON => ({
  type,
  ...(attrs ? { attrs } : {}),
});
const mark = (id: number, name: string) => [
  atom("bookmarkStart", { id, name }),
  atom("bookmarkEnd", { id }),
];

const base = createDocument();
function documentOf(content: NodeJSON[], more: Partial<FoliDocument> = {}): FoliDocument {
  return {
    ...base,
    schemaVersion: SCHEMA_VERSION,
    styles: [
      { id: "Normal", type: "paragraph", name: "Normal", isDefault: true },
      { id: "Heading1", type: "paragraph", name: "heading 1", basedOn: "Normal" },
      { id: "Heading2", type: "paragraph", name: "Heading 2", basedOn: "Normal" },
      { id: "TOC1", type: "paragraph", name: "toc 1", basedOn: "Normal" },
    ],
    content: docOf(...content),
    ...more,
  };
}
const open = (content: NodeJSON[], more: Partial<FoliDocument> = {}, track = false) =>
  createEditor({ document: documentOf(content, more), trackChanges: track });
const STORIES: FoliDocument["stories"] = {
  h1: { kind: "header", content: docOf(p("head", undefined, ...mark(7, "Inside"))) },
};
const names = (editor: Editor, hidden = false) =>
  listBookmarks(editor, { hidden }).map((b) => b.name);

describe("bookmark names", () => {
  it("are what Word takes", () => {
    for (const name of ["a", "A1", "a_b", "aé", "n".repeat(40)])
      expect(isBookmarkName(name)).toBe(true);
    for (const name of ["", "1a", "a b", "a-b", "a.b", "it's", "_x", "n".repeat(41)])
      expect(isBookmarkName(name)).toBe(false);
  });
});

describe("bookmarks", () => {
  it("go over the selection, or at a caret, as one undo step, not tracked", () => {
    const editor = open([p("one two")], {}, true);
    editor.select(1, 4);
    const made = insertBookmark(editor, "First");
    expect(made).toMatchObject({ ok: true, bookmark: { name: "First", text: "one", story: null } });
    editor.select(8);
    expect(insertBookmark(editor, "Point")).toMatchObject({ ok: true, bookmark: { text: "" } });
    expect(names(editor)).toEqual(["First", "Point"]);
    expect(editor.state.doc.textContent).toBe("one two");
    expect(JSON.stringify(editor.state.doc.toJSON())).not.toContain("insertion");
    expect(undoDepth(editor.state)).toBe(2);
    editor.commands.undo();
    expect(names(editor)).toEqual(["First"]);
  });

  it("span paragraphs", () => {
    const editor = open([p("one"), p("two")]);
    editor.select(2, 7);
    expect(insertBookmark(editor, "Both")).toMatchObject({ ok: true });
    expect(listBookmarks(editor)[0]?.from).toBe(3);
  });

  it("refuse a bad name and a place that is not text", () => {
    const editor = open([p("one")]);
    expect(insertBookmark(editor, "1a")).toEqual({ ok: false, reason: "invalid-name" });
    expect(insertBookmark(editor, "ok", { from: 0, to: 0 })).toEqual({
      ok: false,
      reason: "no-place",
    });
    expect(insertBookmark(editor, "ok", { from: 2, to: 99 })).toEqual({
      ok: false,
      reason: "no-place",
    });
  });

  it("have one name in the document: using it again moves it, in any case or story", () => {
    const editor = open([p("one two")], { stories: STORIES });
    editor.select(1, 4);
    insertBookmark(editor, "Same");
    editor.select(7, 10);
    insertBookmark(editor, "SAME");
    expect(listBookmarks(editor).map((b) => [b.name, b.text])).toEqual([
      ["SAME", "two"],
      ["Inside", ""],
    ]);
    editor.select(1, 4);
    insertBookmark(editor, "inside");
    expect(listBookmarks(editor).map((b) => [b.name, b.story])).toEqual([
      ["inside", null],
      ["SAME", null],
    ]);
    expect(JSON.stringify(editor.getDocument().stories?.h1)).not.toContain("bookmark");
    editor.commands.undo();
    expect(names(editor)).toContain("Inside");
  });

  it("get ids no tree uses, also from a story's editor", () => {
    const editor = open([p("one", undefined, ...mark(40, "Far"))], { stories: STORIES });
    editor.select(1, 2);
    insertBookmark(editor, "New");
    const head = editor.story("h1") as Editor;
    head.select(1, 3);
    const made = insertBookmark(head, "InHead");
    expect(made).toMatchObject({ ok: true, bookmark: { story: "h1", text: "he" } });
    const ids: number[] = [];
    const walk = (node: NodeJSON) => {
      if (node.type === "bookmarkStart") ids.push(node.attrs?.id as number);
      node.content?.forEach(walk);
    };
    const document = editor.getDocument();
    walk(document.content);
    walk(document.stories?.h1?.content as NodeJSON);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(4);
  });

  it("hide Word's own unless asked", () => {
    const editor = open([
      p("x", undefined, ...mark(1, "_Toc123"), ...mark(2, "_Ref9"), ...mark(3, "Mine")),
    ]);
    expect(names(editor)).toEqual(["Mine"]);
    expect(names(editor, true)).toEqual(["_Toc123", "_Ref9", "Mine"]);
  });

  it("are deleted, in whichever tree, and that can be undone", () => {
    const editor = open([p("x", undefined, ...mark(1, "Mine"))], { stories: STORIES });
    expect(deleteBookmark(editor, "mine")).toBe(true);
    expect(deleteBookmark(editor, "Inside")).toBe(true);
    expect(names(editor)).toEqual([]);
    expect(deleteBookmark(editor, "Nothing")).toBe(false);
    editor.commands.undo();
    expect(names(editor)).toEqual(["Inside"]);
  });

  it("are renamed with what refers to them", () => {
    const field = (code: string) => [
      atom("fieldStart"),
      atom("fieldCode", { text: code }),
      atom("fieldSeparator"),
      t("old result"),
      atom("fieldEnd"),
    ];
    const link: NodeJSON = {
      type: "text",
      text: "there",
      marks: [{ type: "link", attrs: { anchor: "Mine" } }],
    };
    const editor = open([
      p(
        "x",
        undefined,
        ...mark(1, "Mine"),
        ...field(" REF Mine \\h "),
        ...field(" PAGEREF Mine "),
        ...field(" REF Mined "),
        link,
      ),
      p("other", undefined, ...mark(2, "Other")),
    ]);
    expect(renameBookmark(editor, "mine", "Yours")).toMatchObject({ ok: true });
    const json = JSON.stringify(editor.state.doc.toJSON());
    expect(json).toContain(" REF Yours \\\\h ");
    expect(json).toContain(" PAGEREF Yours ");
    expect(json).toContain(" REF Mined ");
    expect(json).toContain('"anchor":"Yours"');
    expect(names(editor)).toEqual(["Yours", "Other"]);
    expect(renameBookmark(editor, "Yours", "other")).toEqual({ ok: false, reason: "exists" });
    expect(renameBookmark(editor, "Yours", "9")).toEqual({ ok: false, reason: "invalid-name" });
    expect(renameBookmark(editor, "No", "Fine")).toEqual({ ok: false, reason: "missing" });
    expect(renameBookmark(editor, "Yours", "YOURS")).toMatchObject({ ok: true });
    editor.commands.undo();
    editor.commands.undo();
    expect(names(editor)).toEqual(["Mine", "Other"]);
  });

  it("are refused where the content is locked", () => {
    const editor = open(
      [
        p(
          "",
          undefined,
          atom("controlStart", { id: "c" }),
          t("x"),
          atom("controlEnd", { id: "c" }),
        ),
      ],
      { controls: { c: { kind: "richText", lock: "contentLocked" } } },
    );
    expect(insertBookmark(editor, "Mine", { from: 2, to: 3 })).toEqual({
      ok: false,
      reason: "refused",
    });
    expect(names(editor)).toEqual([]);
  });

  it("are offered by the cross-reference targets", () => {
    const editor = open([p("one")]);
    editor.select(1, 4);
    insertBookmark(editor, "Target");
    expect(crossReferenceTargets(editor.state).bookmarks).toEqual([
      { name: "Target", text: "one" },
    ]);
  });
});

describe("goTo without a view", () => {
  it("selects in the body or the story", () => {
    const editor = open([p("one two")], { stories: STORIES });
    expect(goTo(editor, { story: null, from: 2, to: 4 })).toBe(true);
    expect(editor.state.selection.from).toBe(2);
    expect(goTo(editor, { story: "h1", from: 1, to: 3 })).toBe(true);
    expect(editor.story("h1")?.state.selection.to).toBe(3);
    expect(goTo(editor, { story: "gone", from: 1, to: 1 })).toBe(false);
  });
});

describe("documentOutline", () => {
  it("lists heading styles and outline levels, by the table of contents' rule", () => {
    const editor = open([
      p("Title", { style: "Heading1" }),
      p("text"),
      p("Sub", { style: "Heading2" }),
      p("By level", { outlineLevel: 2 }),
      p("Body level", { outlineLevel: 9 }),
      p("", { style: "Heading1" }),
    ]);
    expect(documentOutline(editor.state).map((e) => [e.level, e.text, e.page])).toEqual([
      [1, "Title", null],
      [2, "Sub", null],
      [3, "By level", null],
    ]);
    expect(documentOutline(editor.state)[1]?.pos).toBe(13);
  });

  it("leaves out a table of contents' lines and takes pages from a layout", () => {
    const toc = [
      atom("fieldStart"),
      atom("fieldCode", { text: ' TOC \\o "1-3" ' }),
      atom("fieldSeparator"),
    ];
    const editor = open([
      p("", undefined, ...toc, t("Title")),
      p("Listed", { style: "Heading1" }, atom("fieldEnd")),
      p("Title", { style: "Heading1" }),
    ]);
    const layout = {
      pages: 3,
      pageAt: () => ({ number: 4, sectionPages: 3, format: "upperRoman" }),
    };
    expect(documentOutline(editor.state, layout)).toMatchObject([{ text: "Title", page: "IV" }]);
  });

  it("is the body's, from a story's editor too", () => {
    const editor = open([p("Title", { style: "Heading1" })], { stories: STORIES });
    expect(documentOutline((editor.story("h1") as Editor).state).length).toBe(1);
  });
});
