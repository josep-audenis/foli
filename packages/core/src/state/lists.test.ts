import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createDocument } from "../document.js";
import type { NodeJSON } from "../model/index.js";
import type { DocJSON } from "../schema.js";
import { createEditor, type Editor, listTypeAt } from "./index.js";

const t = (text: string): NodeJSON => ({ type: "text", text });
const p = (text?: string): NodeJSON => ({
  type: "paragraph",
  ...(text ? { content: [t(text)] } : {}),
});
const item = (...content: NodeJSON[]): NodeJSON => ({ type: "listItem", content });
const ul = (...items: NodeJSON[]): NodeJSON => ({ type: "bulletList", content: items });
const ol = (...items: NodeJSON[]): NodeJSON => ({ type: "orderedList", content: items });

function editorWith(...blocks: NodeJSON[]): Editor {
  return createEditor({
    document: createDocument({ type: "doc", content: blocks } as DocJSON),
  });
}
const json = (editor: Editor) => editor.getDocument().content.content;

/** Puts the caret in the text `text`, `offset` characters in (end by default). */
function caretIn(editor: Editor, text: string, offset = text.length): void {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text === text) found = pos + offset;
    return found < 0;
  });
  if (found < 0) throw new Error(`no text ${text}`);
  editor.select(found);
}

/** Runs `act`, checks the result, then undo restores the exact document and selection. */
function expectUndoable(editor: Editor, act: () => boolean, after: NodeJSON[]): void {
  const before = editor.state.doc;
  const selection = editor.state.selection;
  expect(act()).toBe(true);
  expect(json(editor)).toEqual(after);
  editor.state.doc.check();
  expect(editor.commands.undo()).toBe(true);
  expect(editor.state.doc.eq(before)).toBe(true);
  expect(editor.state.selection.eq(selection)).toBe(true);
}

describe("list commands", () => {
  it("toggleList wraps paragraphs in a list, changes the list type, and removes it", () => {
    const editor = editorWith(p("a"), p("b"));
    editor.select(1, 5);
    expectUndoable(editor, () => editor.commands.toggleList("bulletList"), [
      ul(item(p("a"), p("b"))),
    ]);
    editor.commands.toggleList("bulletList");
    expect(listTypeAt(editor.state)?.name).toBe("bulletList");
    expect(editor.commands.toggleList("orderedList")).toBe(true);
    expect(json(editor)).toEqual([ol(item(p("a"), p("b")))]);
    expect(listTypeAt(editor.state)?.name).toBe("orderedList");
    expect(editor.commands.toggleList("orderedList")).toBe(true);
    expect(json(editor)).toEqual([p("a"), p("b")]);
    expect(listTypeAt(editor.state)).toBeNull();
  });

  it("toggleList and listTypeAt with everything selected look at the first text", () => {
    const editor = editorWith(p("a"), p("b"));
    editor.commands.selectAll();
    expect(editor.commands.toggleList("orderedList")).toBe(true);
    expect(listTypeAt(editor.state)?.name).toBe("orderedList");
    expect(editor.commands.toggleList("orderedList")).toBe(true); // off, not a list in a list
    expect(json(editor)).toEqual([p("a"), p("b")]);
  });

  it("toggleList off a nested item takes it out of every list of that type", () => {
    const editor = editorWith(ul(item(p("a"), ul(item(p("b"))))));
    caretIn(editor, "b");
    expect(editor.commands.toggleList("bulletList")).toBe(true);
    expect(json(editor)).toEqual([ul(item(p("a"))), p("b")]);
  });

  it("Enter splits an item; at its end the new item starts with an empty paragraph", () => {
    const editor = editorWith(ul(item(p("abcd"))));
    caretIn(editor, "abcd", 2);
    expectUndoable(editor, () => editor.handleKey("Enter"), [ul(item(p("ab")), item(p("cd")))]);
    caretIn(editor, "abcd");
    expect(editor.handleKey("Enter")).toBe(true);
    expect(json(editor)).toEqual([ul(item(p("abcd")), item(p()))]);
    // The caret is in the new item: typing goes there.
    editor.commands.insertText("x");
    expect(json(editor)).toEqual([ul(item(p("abcd")), item(p("x")))]);
  });

  it("Enter on an empty item leaves the list (a nested one: up one level)", () => {
    const editor = editorWith(ul(item(p("a")), item(p())), p("after"));
    editor.select(8); // in the empty item
    expect(editor.state.selection.$from.parent.content.size).toBe(0);
    expectUndoable(editor, () => editor.handleKey("Enter"), [ul(item(p("a"))), p(), p("after")]);
    const nested = editorWith(ul(item(p("a"), ul(item(p("b")), item(p())))));
    nested.select(13);
    expect(nested.state.selection.$from.parent.content.size).toBe(0);
    expect(nested.handleKey("Enter")).toBe(true);
    expect(json(nested)).toEqual([ul(item(p("a"), ul(item(p("b")))), item(p()))]);
  });

  it("Enter on a trailing empty paragraph of an item starts a new item with it", () => {
    const editor = editorWith(ul(item(p("a"), p())));
    editor.select(6);
    expect(editor.state.selection.$from.parent.content.size).toBe(0);
    expect(editor.handleKey("Enter")).toBe(true);
    expect(json(editor)).toEqual([ul(item(p("a")), item(p()))]);
  });

  it("Tab nests an item in the one before (joining a sublist), Shift+Tab lifts it back", () => {
    const editor = editorWith(ul(item(p("a")), item(p("b")), item(p("c"))));
    caretIn(editor, "b");
    expectUndoable(editor, () => editor.handleKey("Tab"), [
      ul(item(p("a"), ul(item(p("b")))), item(p("c"))),
    ]);
    editor.handleKey("Tab");
    caretIn(editor, "c");
    expect(editor.handleKey("Tab")).toBe(true); // joins the sublist of "a"
    expect(json(editor)).toEqual([ul(item(p("a"), ul(item(p("b")), item(p("c")))))]);
    caretIn(editor, "b");
    expectUndoable(editor, () => editor.handleKey("Shift-Tab"), [
      ul(item(p("a")), item(p("b"), ul(item(p("c"))))),
    ]);
  });

  it("Tab does nothing in the first item or outside a list (focus can move on)", () => {
    const editor = editorWith(ul(item(p("a"))), p("x"));
    caretIn(editor, "a");
    expect(editor.handleKey("Tab")).toBe(false);
    caretIn(editor, "x");
    expect(editor.handleKey("Tab")).toBe(false);
    expect(editor.handleKey("Shift-Tab")).toBe(false);
  });

  it("Shift+Tab on a top-level item takes it out of the list, splitting the list", () => {
    const editor = editorWith(ol(item(p("a")), item(p("b")), item(p("c"))));
    caretIn(editor, "b");
    expectUndoable(editor, () => editor.handleKey("Shift-Tab"), [
      ol(item(p("a"))),
      p("b"),
      ol(item(p("c"))),
    ]);
  });

  it("Backspace at an item's start lifts it; inside the text it deletes", () => {
    const editor = editorWith(ul(item(p("a")), item(p("bc"))));
    caretIn(editor, "bc", 0);
    expectUndoable(editor, () => editor.handleKey("Backspace"), [ul(item(p("a"))), p("bc")]);
    caretIn(editor, "bc", 1);
    expect(editor.handleKey("Backspace")).toBe(true);
    expect(json(editor)).toEqual([ul(item(p("a")), item(p("c")))]);
    // At the start of an item's second paragraph: joins it into the first, the item stays.
    const two = editorWith(ul(item(p("a"), p("b"))));
    caretIn(two, "b", 0);
    expect(two.handleKey("Backspace")).toBe(true);
    expect(json(two)).toEqual([ul(item(p("ab")))]);
  });

  it("Backspace after a list joins into its last text; Delete before one pulls its first in", () => {
    const editor = editorWith(ul(item(p("a"), ul(item(p("b"))))), p("c"));
    caretIn(editor, "c", 0);
    expectUndoable(editor, () => editor.handleKey("Backspace"), [
      ul(item(p("a"), ul(item(p("bc"))))),
    ]);
    expect(editor.handleKey("Backspace")).toBe(true);
    expect(editor.state.selection.$from.parent.textContent).toBe("bc");

    const forward = editorWith(p("x"), ul(item(p("y")), item(p("z"))));
    caretIn(forward, "x");
    expectUndoable(forward, () => forward.handleKey("Delete"), [p("xy"), ul(item(p("z")))]);
    // A list item that goes on with a nested list keeps its paragraph: Delete does nothing.
    const kept = editorWith(p("x"), ul(item(p("y"), ul(item(p("z"))))));
    caretIn(kept, "x");
    expect(kept.handleKey("Delete")).toBe(false);
    // The only item of a list: the list goes too.
    const only = editorWith(p("x"), ul(item(p("y"))));
    caretIn(only, "x");
    expect(only.handleKey("Delete")).toBe(true);
    expect(json(only)).toEqual([p("xy")]);
  });

  it("Mod-Shift-7 and Mod-Shift-8 toggle numbered and bulleted lists", () => {
    const editor = editorWith(p("a"));
    caretIn(editor, "a");
    expect(editor.handleKey("Mod-Shift-8")).toBe(true);
    expect(json(editor)).toEqual([ul(item(p("a")))]);
    expect(editor.handleKey("Mod-Shift-7")).toBe(true);
    expect(json(editor)).toEqual([ol(item(p("a")))]);
    expect(editor.handleKey("Mod-Shift-7")).toBe(true);
    expect(json(editor)).toEqual([p("a")]);
  });

  it("indentListItem and outdentListItem are the commands behind Tab and Shift+Tab", () => {
    const editor = editorWith(ul(item(p("a")), item(p("b"))));
    caretIn(editor, "b");
    expect(editor.commands.indentListItem()).toBe(true);
    expect(editor.commands.outdentListItem()).toBe(true);
    expect(json(editor)).toEqual([ul(item(p("a")), item(p("b")))]);
    // An item starts with a paragraph: its first paragraph cannot be wrapped in a list.
    expect(editor.commands.wrapInList("orderedList")).toBe(false);
  });
});

describe("list editing properties (2,000 runs)", () => {
  const words = fc.constantFrom("a", "bc", "def");
  const para = words.map((text) => p(text));
  const { list } = fc.letrec<{ list: NodeJSON }>((tie) => ({
    list: fc
      .tuple(
        fc.constantFrom("bulletList", "orderedList"),
        fc.array(
          fc
            .tuple(para, fc.option(tie("list"), { depthIdentifier: "list", nil: undefined }))
            .map(([first, nested]) => item(first, ...(nested ? [nested] : []))),
          { minLength: 1, maxLength: 3, depthIdentifier: "list" },
        ),
      )
      .map(([type, items]) => ({ type, content: items })),
  }));
  const docs = fc.array(fc.oneof(para, list), { minLength: 1, maxLength: 4 });
  const key = fc.record({
    name: fc.constantFrom(
      "Enter",
      "Backspace",
      "Delete",
      "Tab",
      "Shift-Tab",
      "Mod-Shift-7",
      "Mod-Shift-8",
      "type",
    ),
    at: fc.noBias(fc.integer({ min: 0, max: 1000 })),
  });

  it("every list key keeps the document valid; undo restores it exactly; redo the result", () => {
    let changed = 0;
    fc.assert(
      fc.property(docs, fc.array(key, { minLength: 1, maxLength: 10 }), (blocks, keys) => {
        const editor = editorWith(...blocks);
        const initial = editor.state.doc;
        for (const k of keys) {
          // A caret inside text, chosen from the fraction.
          const size = editor.state.doc.content.size;
          editor.select(Math.round((k.at / 1000) * size));
          const before = editor.state.doc;
          if (k.name === "type") editor.commands.insertText("x");
          else editor.handleKey(k.name);
          editor.state.doc.check();
          if (editor.state.doc !== before) changed++;
        }
        const final = editor.state.doc;
        while (editor.commands.undo()) editor.state.doc.check();
        expect(editor.state.doc.eq(initial)).toBe(true);
        while (editor.commands.redo()) editor.state.doc.check();
        expect(editor.state.doc.eq(final)).toBe(true);
      }),
      { numRuns: 2000 },
    );
    expect(changed).toBeGreaterThan(5000);
  }, 120_000);
});
