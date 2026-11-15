import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createDocumentV2 } from "../document.js";
import type { NodeJSON } from "../model/index.js";
import type { DocJSON } from "../schema.js";
import { createEditor, type Editor, listKindAt } from "./index.js";

// Documents are written as 0.2.0 ones (nested lists): the editor migrates them to Word's
// numbered paragraphs.
const p = (text: string): NodeJSON => ({ type: "paragraph", content: [{ type: "text", text }] });
const item = (...content: NodeJSON[]): NodeJSON => ({ type: "listItem", content });
const ul = (...items: NodeJSON[]): NodeJSON => ({ type: "bulletList", content: items });

const editorWith = (...blocks: NodeJSON[]): Editor =>
  createEditor({ document: createDocumentV2({ type: "doc", content: blocks } as DocJSON) });
/** The list level of each paragraph (null: not numbered). */
const levels = (editor: Editor) =>
  (editor.getDocument().content.content ?? []).map(
    (block) => (block.attrs?.numbering as { level: number } | undefined)?.level ?? null,
  );

describe("list keys and commands", () => {
  it("Mod-Shift-7 and Mod-Shift-8 toggle numbered and bulleted lists", () => {
    const editor = editorWith(p("a"));
    editor.select(1);
    expect(editor.handleKey("Mod-Shift-8")).toBe(true);
    expect(listKindAt(editor.state)).toBe("bulletList");
    expect(editor.handleKey("Mod-Shift-7")).toBe(true);
    expect(listKindAt(editor.state)).toBe("orderedList");
    expect(editor.handleKey("Mod-Shift-7")).toBe(true);
    expect(listKindAt(editor.state)).toBeNull();
    expect(levels(editor)).toEqual([null]);
  });

  it("indentListItem and outdentListItem are the commands behind Tab and Shift+Tab", () => {
    const editor = editorWith(ul(item(p("a")), item(p("b"))));
    editor.select(4); // the start of "b"
    expect(editor.commands.indentListItem()).toBe(true);
    expect(levels(editor)).toEqual([0, 1]);
    expect(editor.commands.outdentListItem()).toBe(true);
    expect(levels(editor)).toEqual([0, 0]);
    expect(editor.commands.outdentListItem()).toBe(true);
    expect(levels(editor)).toEqual([0, null]);
    expect(editor.commands.outdentListItem()).toBe(false);
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
    // A range to another point, or everything selected, or a caret.
    to: fc.oneof(
      fc.constant(undefined),
      fc.constant("all" as const),
      fc.noBias(fc.integer({ min: 0, max: 1000 })),
    ),
  });

  it("every list key keeps the document valid; undo restores it exactly; redo the result", () => {
    let changed = 0;
    fc.assert(
      fc.property(docs, fc.array(key, { minLength: 1, maxLength: 10 }), (blocks, keys) => {
        const editor = editorWith(...blocks);
        const initial = editor.state.doc;
        for (const k of keys) {
          // A caret or range, chosen from the fractions, or everything.
          const size = editor.state.doc.content.size;
          const at = (fraction: number) => Math.round((fraction / 1000) * size);
          if (k.to === "all") editor.commands.selectAll();
          else editor.select(at(k.at), k.to === undefined ? at(k.at) : at(k.to));
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
