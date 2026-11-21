// Bug hunt (engine: model, transform, state core). Every test asserts the correct behaviour and
// fails on the current code. See the hand-back report for file:line and suggested fixes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocumentV2 } from "./document.js";
import {
  canJoin,
  createEditor,
  EditorState,
  history,
  liftTarget,
  Plugin,
  ReplaceStep,
  Slice,
  TextSelection,
  Transform,
  TransformError,
  undo,
} from "./index.js";
import type { NodeJSON } from "./model/index.js";
import type { BlockJSON, DocJSON } from "./schema.js";
import { testSchema } from "./testing/index.js";

const text = (t: string): NodeJSON => ({ type: "text", text: t });
const para = (...content: string[]): NodeJSON => ({
  type: "paragraph",
  ...(content.length ? { content: content.map(text) } : {}),
});
const node = (type: string, ...content: NodeJSON[]): NodeJSON => ({ type, content });
const tdoc = (...blocks: NodeJSON[]) => testSchema.nodeFromJSON({ type: "doc", content: blocks });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

describe("history", () => {
  it("a plugin's change appended to a selection-only transaction is an undo step of its own", () => {
    // The plugin reacts to a caret move (no document change) by inserting "!" at the start.
    const stamp = new Plugin({
      appendTransaction(transactions, _old, state) {
        const root = transactions[0];
        if (!root || root.docChanged || root.getMeta("stamp") !== true) return null;
        return state.tr.insertText("!", 1);
      },
    });
    let state = EditorState.create({ doc: tdoc(para("a")), plugins: [history(), stamp] });
    const dispatch = (tr: Parameters<typeof state.apply>[0]) => {
      state = state.applyTransaction(tr).state;
    };
    dispatch(state.tr.insertText("b", 2)); // the user types "b": undo event 1
    vi.advanceTimersByTime(60_000); // a minute later…
    dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1)).setMeta("stamp", true));
    expect(state.doc.textContent).toBe("!ab");

    expect(undo(state, dispatch)).toBe(true);
    // Only the plugin's "!" goes: the typing a minute before is another step.
    expect(state.doc.textContent).toBe("ab");
  });
});

describe("stored marks", () => {
  it("a mark toggled at a caret does not follow the selection to other text (Mod-b, Mod-a, type)", () => {
    const editor = createEditor({
      document: createDocumentV2({
        type: "doc",
        content: [para("abc"), para("def")] as BlockJSON[],
      } as DocJSON),
    });
    editor.select(2);
    expect(editor.handleKey("Mod-b")).toBe(true); // bold for the next text typed here
    expect(editor.handleKey("Mod-a")).toBe(true); // …but the user selects everything instead
    expect(editor.commands.insertText("x")).toBe(true);
    expect(editor.getDocument().content.content).toEqual([para("x")]);
  });

  it("editor.select() to another paragraph drops the marks stored at the old caret", () => {
    const editor = createEditor({
      document: createDocumentV2({
        type: "doc",
        content: [para("abc"), para("def")] as BlockJSON[],
      } as DocJSON),
    });
    editor.select(2);
    editor.commands.toggleMark("bold");
    editor.select(8);
    editor.commands.insertText("x");
    expect(editor.getDocument().content.content).toEqual([para("abc"), para("dexf")]);
  });
});

describe("structure predicates agree with the transform", () => {
  it("canJoin is false for a container followed by an empty textblock (join throws there)", () => {
    // blockquote(p("a")) then an empty paragraph: position 5 is between them.
    const doc = tdoc(node("blockquote", para("a")), para());
    expect(() => new Transform(doc).join(5)).toThrow(TransformError);
    expect(canJoin(doc, 5)).toBe(false);
  });

  it("liftTarget gives no depth whose lift throws (nested list, items left after the range)", () => {
    // list(item(p, list(item(p("a")), item(p("b"))))): lifting the first inner item to the outer
    // list would leave item(list(item(p("b")))), which cannot start with a list.
    const doc = tdoc(
      node(
        "bulletList",
        node(
          "listItem",
          para(),
          node("bulletList", node("listItem", para("a")), node("listItem", para("b"))),
        ),
      ),
    );
    const range = doc.resolve(5).blockRange(doc.resolve(6));
    expect(range?.parent.type.name).toBe("bulletList");
    expect(range?.depth).toBe(3);
    const target = range ? liftTarget(range) : null;
    if (range && target !== null) {
      const tr = new Transform(doc);
      expect(() => tr.lift(range, target)).not.toThrow();
      tr.doc.check();
    }
  });
});

describe("steps fail instead of throwing", () => {
  it("a structure ReplaceStep outside the document is a failed result, like a plain one", () => {
    const doc = tdoc(para("ab"), para("cd"));
    expect(new Transform(doc).maybeStep(new ReplaceStep(100, 101, Slice.empty)).failed).not.toBe(
      null,
    );
    const tr = new Transform(doc);
    let failed: string | null = null;
    expect(() => {
      failed = tr.maybeStep(new ReplaceStep(100, 101, Slice.empty, true)).failed;
    }).not.toThrow();
    expect(failed).not.toBe(null);
  });

  it("Transform.join deeper than the document throws TransformError, not RangeError", () => {
    const doc = tdoc(para("ab"), para("cd"));
    expect(() => new Transform(doc).join(4, 5)).toThrow(TransformError);
  });
});
