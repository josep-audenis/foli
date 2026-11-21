// @vitest-environment jsdom
import { createDocument, createEditor, hint, undoDepth } from "@folijs/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "../index.js";

let views: EditorView[] = [];
afterEach(() => {
  for (const view of views) {
    view.destroy();
    view.host.remove();
  }
  views = [];
  document.body.replaceChildren();
  delete (window as unknown as { Highlight?: unknown }).Highlight;
  delete (CSS as unknown as { highlights?: unknown }).highlights;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The Highlight API, which jsdom has not. */
function fakeHighlights() {
  class FakeHighlight extends Set<Range> {
    priority = 0;
  }
  const registry = new Map<string, FakeHighlight>();
  (window as unknown as { Highlight: unknown }).Highlight = FakeHighlight;
  (CSS as unknown as { highlights: unknown }).highlights = registry;
  const text = (name: string) => [...(registry.get(name) ?? [])].map((r) => r.toString());
  return { shown: () => text("foli-hint"), fading: () => text("foli-hint-fading") };
}

function setup(...paragraphs: string[]) {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = createEditor({
    document: createDocument({
      type: "doc",
      content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
    }),
  });
  const view = new EditorView(host, editor);
  views.push(view);
  return { host, editor, view };
}

describe("a hint", () => {
  it("marks its range, then fades, then goes; nothing else changes", () => {
    vi.useFakeTimers();
    const marks = fakeHighlights();
    const { editor } = setup("one cat", "two dogs");
    editor.select(2);
    const selection = editor.state.selection.toJSON();
    const doc = editor.state.doc;
    const depth = undoDepth(editor.state);

    // "cat" (1..8 is the first paragraph's text) and "two" (10..13).
    expect(hint(editor, { story: null, from: 5, to: 12 }, { ms: 1000 })).toBe(true);
    expect(marks.shown()).toEqual(["cat", "tw"]);
    expect(editor.state.selection.toJSON()).toEqual(selection);
    expect(editor.state.doc).toBe(doc);
    expect(undoDepth(editor.state)).toBe(depth);

    vi.advanceTimersByTime(999);
    expect(marks.shown()).toEqual(["cat", "tw"]);
    vi.advanceTimersByTime(1);
    expect(marks.shown()).toEqual([]);
    expect(marks.fading()).toEqual(["cat", "tw"]);
    vi.advanceTimersByTime(400);
    expect(marks.fading()).toEqual([]);
    expect(editor.state.selection.toJSON()).toEqual(selection);
  });

  it("follows edits made while it shows, and goes with its text", () => {
    vi.useFakeTimers();
    const marks = fakeHighlights();
    const { editor } = setup("one cat");
    hint(editor, { story: null, from: 5, to: 8 });
    editor.select(1);
    editor.commands.insertText("my ");
    expect(marks.shown()).toEqual(["cat"]);
    editor.select(8, 11);
    editor.commands.deleteSelection();
    expect(marks.shown()).toEqual([]);
    // Gone: its timers do nothing more.
    vi.advanceTimersByTime(5000);
    expect(marks.fading()).toEqual([]);
  });

  it("is replaced by the next one, and taken off by a new document", () => {
    vi.useFakeTimers();
    const marks = fakeHighlights();
    const { editor } = setup("one cat", "two dogs");
    hint(editor, { story: null, from: 1, to: 4 });
    hint(editor, { story: null, from: 14, to: 18 });
    expect(marks.shown()).toEqual(["dogs"]);
    // The first one's timers are stopped: the second fades on its own time.
    vi.advanceTimersByTime(2000);
    expect(marks.fading()).toEqual(["dogs"]);
    hint(editor, { story: null, from: 1, to: 4 });
    editor.setDocument(createDocument({ type: "doc", content: [{ type: "paragraph" }] }));
    expect(marks.shown()).toEqual([]);
  });

  it("goes at once under reduced motion: no fading step", () => {
    vi.useFakeTimers();
    const marks = fakeHighlights();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
    }));
    const { editor } = setup("one cat");
    hint(editor, { story: null, from: 5, to: 8 }, { ms: 500 });
    vi.advanceTimersByTime(500);
    expect(marks.shown()).toEqual([]);
    expect(marks.fading()).toEqual([]);
  });

  it("says when it cannot: a range outside the document, a story not built yet, no view", () => {
    fakeHighlights();
    const { editor, view } = setup("one cat");
    expect(view.hint({ story: null, from: 3, to: 99 })).toBe(false);
    expect(view.hint({ story: null, from: 5, to: 3 })).toBe(false);
    expect(view.hint({ story: "header1", from: 1, to: 2 })).toBe(false);
    view.destroy();
    views = [];
    expect(hint(editor, { story: null, from: 1, to: 2 })).toBe(false);
  });

  it("without the Highlight API, still answers and marks nothing", () => {
    const { editor } = setup("one cat");
    expect(hint(editor, { story: null, from: 5, to: 8 })).toBe(true);
  });
});
