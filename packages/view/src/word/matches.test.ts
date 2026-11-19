// @vitest-environment jsdom
import { createDocument, createEditor, type NavigationRequest } from "@folijs/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "../index.js";
import { MatchMarks, rangesInText } from "./matches.js";

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
});

function setup() {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = createEditor({
    document: createDocument({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "one cat" }] }],
    }),
  });
  const view = new EditorView(host, editor);
  views.push(view);
  return { host, editor, view };
}
const press = (host: HTMLElement, init: KeyboardEventInit) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  host.dispatchEvent(event);
  return event.defaultPrevented;
};

/** The Highlight API, which jsdom has not. */
function fakeHighlights() {
  class FakeHighlight extends Set<Range> {
    priority = 0;
  }
  const registry = new Map<string, FakeHighlight>();
  (window as unknown as { Highlight: unknown }).Highlight = FakeHighlight;
  (CSS as unknown as { highlights: unknown }).highlights = registry;
  return registry;
}

describe("Word's navigation keys", () => {
  it("stay the browser's without a navigation UI, and when it declines", () => {
    const { host, editor } = setup();
    expect(press(host, { key: "f", ctrlKey: true })).toBe(false);
    editor.navigation = () => false;
    expect(press(host, { key: "f", ctrlKey: true })).toBe(false);
  });

  it("go to the navigation UI when there is one", () => {
    const { host, editor } = setup();
    const asked = vi.fn((_: NavigationRequest) => true);
    editor.navigation = asked;
    expect(press(host, { key: "f", ctrlKey: true })).toBe(true);
    expect(press(host, { key: "h", ctrlKey: true })).toBe(true);
    expect(press(host, { key: "g", ctrlKey: true })).toBe(true);
    expect(press(host, { key: "F3" })).toBe(true);
    expect(press(host, { key: "F3", shiftKey: true })).toBe(true);
    expect(press(host, { key: "F5", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(asked.mock.calls.map(([request]) => request)).toEqual([
      "find",
      "replace",
      "goTo",
      "next",
      "previous",
      "bookmarks",
    ]);
    expect(press(host, { key: "F5" })).toBe(false);
  });
});

describe("marks", () => {
  it("are ranges beside the DOM, the view's own, gone when cleared", () => {
    const registry = fakeHighlights();
    const { host, view } = setup();
    const before = host.innerHTML;
    const match = { story: null, from: 5, to: 8, text: "cat" };
    view.showMatches({ query: "cat", matches: [match], current: match });
    expect([...(registry.get("foli-find") ?? [])].map(String)).toEqual(["cat"]);
    expect([...(registry.get("foli-find-current") ?? [])].map(String)).toEqual(["cat"]);
    expect(host.innerHTML).toBe(before);
    view.showMatches(null);
    expect(registry.get("foli-find")?.size).toBe(0);
    expect(registry.get("foli-find-current")?.size).toBe(0);
  });

  it("leave another view's alone", () => {
    const registry = fakeHighlights();
    const first = new MatchMarks(document);
    const second = new MatchMarks(document);
    const range = () => document.createRange();
    first.set([range()], []);
    second.set([range()], []);
    expect(registry.get("foli-find")?.size).toBe(2);
    first.set([], []);
    expect(registry.get("foli-find")?.size).toBe(1);
  });

  it("do nothing without the browser's API", () => {
    const marks = new MatchMarks(document);
    expect(() => marks.set([document.createRange()], [])).not.toThrow();
  });

  it("are found in drawn copies paragraph by paragraph, across runs", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p><span>the c</span><span>at</span></p><p>ca</p><p>t Cat</p>";
    expect(rangesInText(root, "cat", {}).map(String)).toEqual(["c", "at", "Cat"]);
    expect(rangesInText(root, "cat", { matchCase: true }).map(String)).toEqual(["c", "at"]);
  });

  it("leave a page's number alone", () => {
    const root = document.createElement("div");
    root.innerHTML = '<p>Page <span data-foli-page-field="">2</span> of 2</p>';
    expect(rangesInText(root, "2", {}).map((r) => r.startContainer.parentElement?.tagName)).toEqual(
      ["P"],
    );
    expect(rangesInText(root, "e 2", {})).toEqual([]);
  });
});
