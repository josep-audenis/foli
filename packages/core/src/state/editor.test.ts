import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument, parseDocument } from "../document.js";
import type { NodeJSON } from "../model/index.js";
import { Slice } from "../model/index.js";
import type { BlockJSON, DocJSON } from "../schema.js";
import { testSchema } from "../testing/index.js";
import {
  createEditor,
  deleteSelection,
  type Editor,
  EditorState,
  Plugin,
  PluginKey,
  redoDepth,
  TextSelection,
  undoDepth,
} from "./index.js";

const text = (t: string, ...marks: string[]): NodeJSON =>
  marks.length
    ? { type: "text", text: t, marks: marks.map((type) => ({ type })) }
    : { type: "text", text: t };
const para = (...content: (string | NodeJSON)[]): NodeJSON => ({
  type: "paragraph",
  ...(content.length ? { content: content.map((c) => (typeof c === "string" ? text(c) : c)) } : {}),
});
const heading = (level: number, ...content: string[]): NodeJSON => ({
  type: "heading",
  attrs: { level },
  ...(content.length ? { content: content.map((c) => text(c)) } : {}),
});
const docJSON = (...blocks: NodeJSON[]) => ({ type: "doc", content: blocks }) as DocJSON;
const editorWith = (...blocks: NodeJSON[]) =>
  createEditor({ document: createDocument(docJSON(...(blocks as BlockJSON[]))) });
const content = (editor: Editor) => editor.getDocument().content;

/** Types text one keystroke at a time, checking the document stays valid after each. */
function type(editor: Editor, value: string): void {
  for (const ch of value) {
    expect(editor.commands.insertText(ch)).toBe(true);
    editor.state.doc.check();
    vi.advanceTimersByTime(50);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

describe("T1: type and format several paragraphs (headless)", () => {
  it("builds the expected document and keeps it valid after every keystroke", () => {
    const editor = createEditor();
    type(editor, "Title");
    expect(editor.commands.setBlockType("heading", { level: 1 })).toBe(true);
    expect(editor.handleKey("Enter")).toBe(true);
    type(editor, "Plain ");
    expect(editor.handleKey("Mod-b")).toBe(true);
    expect(editor.isMarkActive("bold")).toBe(true);
    type(editor, "bold");
    editor.handleKey("Mod-b");
    type(editor, " end");
    editor.handleKey("Enter");
    type(editor, "Second");
    editor.handleKey("Shift-Enter");
    type(editor, "line");
    expect(content(editor)).toEqual(
      docJSON(
        heading(1, "Title"),
        para("Plain ", text("bold", "bold"), " end"),
        para("Second", { type: "hardBreak" }, "line"),
      ),
    );
    expect(parseDocument(JSON.parse(JSON.stringify(editor.getDocument())))).toEqual(
      editor.getDocument(),
    );
  });
});

describe("T2: replace a selection across paragraphs, undo", () => {
  it("restores the exact document and selection", () => {
    const editor = editorWith(
      para("one ", text("two", "bold")),
      para(text("three", "italic")),
      para("four five"),
    );
    const before = editor.state.doc;
    editor.select(6, 20); // after "t" of "two" … after "fou"
    const selection = editor.state.selection;
    expect(editor.commands.insertText("X")).toBe(true);
    editor.state.doc.check();
    expect(content(editor)).toEqual(docJSON(para("one ", text("tX", "bold"), "r five")));
    expect(editor.commands.undo()).toBe(true);
    expect(editor.state.doc.eq(before)).toBe(true);
    expect(editor.state.selection.eq(selection)).toBe(true);
    expect(editor.commands.redo()).toBe(true);
    expect(content(editor)).toEqual(docJSON(para("one ", text("tX", "bold"), "r five")));
  });
});

describe("history", () => {
  it("groups fast adjacent typing into one undo step", () => {
    const editor = createEditor();
    type(editor, "abc");
    editor.commands.undo();
    expect(content(editor)).toEqual(docJSON(para()));
    expect(editor.commands.undo()).toBe(false);
  });

  it("starts a new step after a pause, a jump, or formatting", () => {
    const editor = editorWith(para("text"));
    editor.select(5);
    type(editor, "ab");
    vi.advanceTimersByTime(1000);
    type(editor, "cd");
    editor.select(1);
    type(editor, "Z");
    editor.select(1, 3);
    editor.commands.toggleMark("italic");
    const steps = [
      docJSON(para(text("Zt", "italic"), "extabcd")),
      docJSON(para("Ztextabcd")),
      docJSON(para("textabcd")),
      docJSON(para("textab")),
      docJSON(para("text")),
    ];
    for (const expected of steps) {
      expect(content(editor)).toEqual(expected);
      editor.commands.undo();
    }
  });

  it("clears redo after a new change", () => {
    const editor = createEditor();
    type(editor, "a");
    editor.commands.undo();
    type(editor, "b");
    expect(editor.commands.redo()).toBe(false);
  });

  it("rebases undo over changes kept out of history", () => {
    const editor = editorWith(para("abcd"));
    editor.select(3, 5); // "cd"
    editor.commands.deleteSelection(); // recorded: "ab"
    vi.advanceTimersByTime(1000);
    editor.select(3);
    type(editor, "XY"); // recorded: "abXY"
    editor.dispatch(editor.state.tr.insertText("Z", 1).setMeta("addToHistory", false)); // "ZabXY"
    expect(content(editor)).toEqual(docJSON(para("ZabXY")));
    editor.commands.undo();
    expect(content(editor)).toEqual(docJSON(para("Zab")));
    editor.commands.undo();
    expect(content(editor)).toEqual(docJSON(para("Zabcd")));
    expect(editor.state.selection.from).toBe(4);
    expect(editor.state.selection.to).toBe(6);
  });

  it("keeps positions inside re-inserted text exact (mirrored rebase)", () => {
    const editor = editorWith(para("hello world"));
    editor.select(1, 7); // "hello "
    editor.commands.deleteSelection();
    vi.advanceTimersByTime(1000);
    editor.select(6);
    type(editor, "!"); // "world!"
    editor.dispatch(editor.state.tr.insertText(">", 1).setMeta("addToHistory", false));
    editor.commands.undo(); // removes "!"
    editor.commands.undo(); // re-inserts "hello "
    expect(content(editor)).toEqual(docJSON(para(">hello world")));
  });

  it("setDocument resets history", () => {
    const editor = createEditor();
    type(editor, "a");
    editor.setDocument(createDocument());
    expect(editor.commands.undo()).toBe(false);
  });
});

describe("commands", () => {
  it("Backspace deletes a whole grapheme cluster", () => {
    const editor = editorWith(para("a👍🏽"));
    editor.select(6);
    editor.handleKey("Backspace");
    expect(content(editor)).toEqual(docJSON(para("a")));
  });

  it("word deletion removes the previous word and the spaces after it", () => {
    const editor = editorWith(para("hello big  world"));
    editor.select(12);
    editor.handleKey("Mod-Backspace");
    expect(content(editor)).toEqual(docJSON(para("hello world")));
    editor.select(1);
    editor.handleKey("Mod-Delete");
    expect(content(editor)).toEqual(docJSON(para(" world")));
  });

  it("Backspace at a block start joins with the previous block; not at the first block", () => {
    const editor = editorWith(heading(2, "Head"), para("body"));
    editor.select(7);
    editor.handleKey("Backspace");
    expect(content(editor)).toEqual(docJSON(heading(2, "Headbody")));
    expect(editor.state.selection.head).toBe(5);
    editor.select(1);
    expect(editor.handleKey("Backspace")).toBe(false);
  });

  it("Delete at a block end joins the next block", () => {
    const editor = editorWith(para("ab"), para("cd"));
    editor.select(3);
    editor.handleKey("Delete");
    expect(content(editor)).toEqual(docJSON(para("abcd")));
  });

  it("Enter at the end of a heading starts a paragraph; in the middle it splits the heading", () => {
    const editor = editorWith(heading(1, "Title"));
    editor.select(4);
    editor.handleKey("Enter");
    expect(content(editor)).toEqual(docJSON(heading(1, "Tit"), heading(1, "le")));
    editor.select(9);
    editor.handleKey("Enter");
    expect(content(editor)).toEqual(docJSON(heading(1, "Tit"), heading(1, "le"), para()));
  });

  it("Enter keeps the formatting for the next paragraph", () => {
    const editor = editorWith(para(text("bold", "bold")));
    editor.select(5);
    editor.handleKey("Enter");
    type(editor, "x");
    expect(content(editor)).toEqual(docJSON(para(text("bold", "bold")), para(text("x", "bold"))));
  });

  it("toggleMark on a range removes it only when all text has it", () => {
    const editor = editorWith(para("a", text("b", "bold"), "c"));
    editor.select(1, 4);
    expect(editor.isMarkActive("bold")).toBe(false);
    editor.commands.toggleMark("bold");
    expect(content(editor)).toEqual(docJSON(para(text("abc", "bold"))));
    editor.commands.toggleMark("bold");
    expect(content(editor)).toEqual(docJSON(para("abc")));
    expect(editor.commands.toggleMark("nope")).toBe(false);
  });

  it("select all, then typing replaces everything with one paragraph", () => {
    const editor = editorWith(heading(1, "A"), para("B"));
    editor.handleKey("Mod-a");
    type(editor, "new");
    expect(content(editor)).toEqual(docJSON(para("new")));
  });

  it("dry runs report applicability without changing state", () => {
    const editor = editorWith(para("ab"));
    const state = editor.state;
    editor.select(1);
    expect(editor.can(editor.state.plugins[1]?.spec.keymap?.Backspace as never)).toBe(false);
    expect(editor.state.doc).toBe(state.doc);
  });

  it("replaceSelection inserts a slice and puts the caret after it", () => {
    const editor = editorWith(para("abc"));
    editor.select(2, 3);
    const slice = editor.state.doc.slice(1, 2); // "a"
    editor.dispatch(editor.state.tr.replaceSelection(slice));
    expect(content(editor)).toEqual(docJSON(para("aac")));
    expect(editor.state.selection.head).toBe(3);
  });

  it("notifies subscribers with the applied transactions", () => {
    const editor = createEditor();
    const seen: number[] = [];
    const off = editor.subscribe((_state, trs) => seen.push(trs.length));
    type(editor, "a");
    off();
    type(editor, "b");
    expect(seen).toEqual([1]);
  });
});

describe("plugins", () => {
  it("can filter transactions, append follow-ups and keep a state field", () => {
    const count = new PluginKey<number>("count");
    const counter = new Plugin<number>({
      key: count,
      state: { init: () => 0, apply: (tr, value) => (tr.docChanged ? value + 1 : value) },
    });
    const noDigits = new Plugin({
      filterTransaction: (tr) => !/\d/.test(tr.doc.textContent),
    });
    // Appends a "!" after any "?" that does not have one yet.
    const exclaim = new Plugin({
      appendTransaction: (_trs, _old, state) => {
        const text = state.doc.textContent;
        return text.endsWith("?") ? state.tr.insertText("!", state.doc.content.size - 1) : null;
      },
    });
    const editor = createEditor({ plugins: [counter, noDigits, exclaim] });
    type(editor, "a");
    expect(editor.commands.insertText("1")).toBe(true); // command applies, filter drops it
    expect(content(editor)).toEqual(docJSON(para("a")));
    editor.commands.insertText("?");
    expect(content(editor)).toEqual(docJSON(para("a?!")));
    expect(count.getState(editor.state)).toBe(3);
  });
});

/** Applies a change that is kept out of undo history (like a programmatic edit). */
function unrecorded(
  editor: Editor,
  build: (tr: ReturnType<Editor["state"]["tr"]["setMeta"]>) => void,
): void {
  const tr = editor.state.tr.setMeta("addToHistory", false);
  build(tr);
  editor.dispatch(tr);
}

describe("review regressions (PR #4)", () => {
  it("undo after an unrecorded change never edits the wrong text", () => {
    const editor = editorWith(
      para("hello world"),
      heading(1, "head"),
      para("tail text"),
      para("more"),
    );
    editor.select(35);
    type(editor, "Z");
    vi.advanceTimersByTime(1000);
    editor.select(28, 2);
    editor.commands.splitBlock(); // p"h", p"t", p"moreZ"
    unrecorded(editor, (tr) => tr.delete(3, 6)); // removes p"t" outside history
    const before = editor.state.doc;
    while (editor.commands.undo()) editor.state.doc.check();
    const last = editor.state.doc.lastChild?.textContent;
    expect(last).toBe("more"); // the typed "Z" is undone, not the "e" of "more"
    while (editor.commands.redo()) editor.state.doc.check();
    expect(editor.state.doc.eq(before)).toBe(true);
  });

  it("undo of a block type change does not land on another block after its block was deleted", () => {
    const editor = editorWith(para("a"), para("b"), heading(2, "c"));
    editor.select(4);
    editor.commands.setBlockType("heading", { level: 1 });
    unrecorded(editor, (tr) => tr.delete(3, 6)); // deletes the changed block
    expect(editor.commands.undo()).toBe(false);
    expect(content(editor)).toEqual(docJSON(para("a"), heading(2, "c")));
  });

  it("a plugin reacting to undo cannot trap the history", () => {
    // Keeps an empty paragraph at the end of the document.
    const trailing = new Plugin({
      appendTransaction: (_trs, _old, state) =>
        state.doc.lastChild?.content.size
          ? state.tr.insert(state.doc.content.size, state.schema.node("paragraph"))
          : null,
    });
    const editor = createEditor({
      document: createDocument(docJSON(para("a") as BlockJSON)),
      plugins: [trailing],
    });
    // No select(): a selection-only transaction would trigger the plugin as its own undo event.
    type(editor, "b");
    const typed = editor.getDocument().content;
    expect(typed).toEqual(docJSON(para("ba"), para()));
    expect(undoDepth(editor.state)).toBe(1);
    expect(editor.commands.undo()).toBe(true);
    expect(content(editor)).toEqual(docJSON(para("a"), para()));
    expect(editor.commands.undo()).toBe(false);
    expect(redoDepth(editor.state)).toBe(1);
    expect(editor.commands.redo()).toBe(true);
    expect(content(editor)).toEqual(typed);
  });

  it("a long typing run is one cheap undo step, even through unrecorded changes", () => {
    const editor = createEditor();
    for (let i = 0; i < 3000; i++) {
      editor.commands.insertText("x");
      vi.advanceTimersByTime(10);
    }
    expect(undoDepth(editor.state)).toBe(1);
    const start = performance.now();
    unrecorded(editor, (tr) => tr.insertText("!", 1));
    expect(performance.now() - start).toBeLessThan(200);
    editor.commands.undo();
    expect(content(editor)).toEqual(docJSON(para("!")));
  });

  it("deleteSelection returns false instead of throwing on an impossible deletion", () => {
    const doc = testSchema.nodeFromJSON({
      type: "doc",
      content: [{ type: "blockquote", content: [para("quoted")] }, para("after")],
    });
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 4, 13) });
    expect(() => deleteSelection(state, () => {})).not.toThrow();
    expect(deleteSelection(state)).toBe(false);
  });

  it("selection helpers map only through their own steps", () => {
    const editor = editorWith(para("abc"));
    editor.select(2, 3);
    const tr = editor.state.tr.insertText("XXXX", 1);
    tr.setSelection(TextSelection.create(tr.doc, 6, 7));
    tr.replaceSelection(new Slice(editor.state.doc.slice(1, 2).content, 0, 0));
    editor.dispatch(tr);
    expect(content(editor)).toEqual(docJSON(para("XXXXaac")));
    expect(editor.state.selection.head).toBe(7);
  });

  it("carets never split a surrogate pair", () => {
    const editor = editorWith(para("a😀b"));
    editor.select(3); // between the halves of 😀
    expect(editor.state.selection.head).toBe(2);
    editor.select(4);
    editor.handleKey("Backspace");
    expect(content(editor)).toEqual(docJSON(para("ab")));
  });

  it("Backspace after a combining mark that follows a hard break keeps the break", () => {
    const editor = editorWith(para("a", { type: "hardBreak" }, "́b"));
    editor.select(4);
    editor.handleKey("Backspace");
    expect(content(editor)).toEqual(docJSON(para("a", { type: "hardBreak" }, "b")));
  });

  it("toggleMark on only empty paragraphs does not apply", () => {
    const editor = editorWith(para(), para());
    editor.select(1, 3);
    expect(editor.commands.toggleMark("bold")).toBe(false);
  });

  it("select all on an already empty document deletes nothing and records nothing", () => {
    const editor = createEditor();
    const doc = editor.state.doc;
    editor.handleKey("Mod-a");
    editor.commands.deleteSelection(); // only collapses the selection
    expect(editor.state.doc).toBe(doc);
    expect(undoDepth(editor.state)).toBe(0);
  });

  it("hard break replaces a select-all selection", () => {
    const editor = editorWith(para("x"), para("y"));
    editor.handleKey("Mod-a");
    expect(editor.commands.insertHardBreak()).toBe(true);
    expect(content(editor)).toEqual(docJSON(para({ type: "hardBreak" })));
  });

  it("an appendTransaction loop fails loudly instead of hanging", () => {
    // A plugin never sees its own appended transactions, so a loop takes two that trigger each other.
    const ping = new Plugin({ appendTransaction: (_t, _o, state) => state.tr.insertText("x", 1) });
    const pong = new Plugin({ appendTransaction: (_t, _o, state) => state.tr.insertText("y", 1) });
    const editor = createEditor({ plugins: [ping, pong] });
    expect(() => editor.commands.insertText("a")).toThrow(RangeError);
  });
});
