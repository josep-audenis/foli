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
    const { editor, host } = setup("one cat", "two dogs");
    host.focus();
    const focused = document.activeElement;
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
    expect(document.activeElement).toBe(focused);

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
    vi.advanceTimersByTime(1000);
    hint(editor, { story: null, from: 14, to: 18 });
    expect(marks.shown()).toEqual(["dogs"]);
    // Where the first one's time ran out: the second is still shown whole.
    vi.advanceTimersByTime(1200);
    expect(marks.shown()).toEqual(["dogs"]);
    expect(marks.fading()).toEqual([]);
    vi.advanceTimersByTime(800);
    expect(marks.fading()).toEqual(["dogs"]);
    hint(editor, { story: null, from: 1, to: 4 });
    // A new document with text where the hint was: nothing of it is marked.
    editor.setDocument(
      createDocument({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "another document" }] }],
      }),
    );
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

  it("shows a point's paragraph, and keeps it through edits elsewhere", () => {
    vi.useFakeTimers();
    const marks = fakeHighlights();
    const { editor } = setup("one cat", "two dogs");
    expect(hint(editor, { story: null, from: 3, to: 3 })).toBe(true);
    expect(marks.shown()).toEqual(["one cat"]);
    editor.select(14);
    editor.commands.insertText("!");
    expect(marks.shown()).toEqual(["one cat"]);
  });

  it("says when it cannot: a range outside the document, a story not built yet, no view", () => {
    fakeHighlights();
    const { editor, view } = setup("one cat");
    expect(view.hint({ story: null, from: 3, to: 99 })).toBe(false);
    expect(view.hint({ story: null, from: 5, to: 3 })).toBe(false);
    expect(view.hint({ story: null, from: 1.5, to: 3 })).toBe(false);
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

describe("a story's drawn copy", () => {
  it("is marked by paragraph and character, across the text nodes of a paragraph", async () => {
    const { rangesInCopy } = await import("./matches.js");
    const root = document.createElement("div");
    root.innerHTML = "<p><span>Page </span><span>3</span> of 9</p><p>Second line</p>";
    document.body.append(root);
    const marked = (spans: { block: number; from: number; to: number }[]) =>
      rangesInCopy(root, spans).map((r) => r.toString());
    expect(marked([{ block: 0, from: 3, to: 8 }])).toEqual(["e ", "3", " o"]);
    expect(marked([{ block: 1, from: 0, to: 6 }])).toEqual(["Second"]);
    // A paragraph the copy does not have, and an empty span: nothing.
    expect(
      marked([
        { block: 5, from: 0, to: 3 },
        { block: 0, from: 2, to: 2 },
      ]),
    ).toEqual([]);
  });
});
