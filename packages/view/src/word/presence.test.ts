// @vitest-environment jsdom
import {
  collab,
  createDocument,
  createEditor,
  presenceMessage,
  receivePresence,
  removePresence,
} from "@folijs/core";
import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "../index.js";

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.innerHTML = "";
  delete (CSS as unknown as { highlights?: unknown }).highlights;
});

/** The Highlight API, which jsdom has not. */
function fakeHighlights() {
  class FakeHighlight extends Set<Range> {
    priority = 0;
  }
  const registry = new Map<string, FakeHighlight>();
  (window as unknown as { Highlight: unknown }).Highlight = FakeHighlight;
  (CSS as unknown as { highlights: unknown }).highlights = registry;
  return (name: string) => [...(registry.get(name) ?? [])].map((r) => r.toString());
}

const doc = () =>
  createDocument({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
  });

describe("presence in the view (22.9)", () => {
  it("marks another person's selection and draws their caret and name, nothing in the pages", () => {
    const marked = fakeHighlights();
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor({ document: doc(), plugins: [collab({ clientID: 1 })] });
    const view = new EditorView(host, editor);
    views.push(view);
    const other = createEditor({ document: doc(), plugins: [collab({ clientID: 2 })] });
    other.select(7, 12);
    const html = host.innerHTML;
    editor.dispatch(
      receivePresence(
        editor.state,
        presenceMessage(other.state, { name: "Bob", color: "#3366cc" }),
      ),
    );
    expect(marked("foli-peer-3366cc")).toEqual(["world"]);
    expect(host.innerHTML).toBe(html);
    const style = document.head.querySelector("style[data-foli-peers]")?.textContent ?? "";
    expect(style).toContain("::highlight(foli-peer-3366cc)");
    // jsdom lays nothing out: no rectangle, no caret; the label is checked where one is drawn.
    editor.dispatch(removePresence(editor.state, 2));
    expect(marked("foli-peer-3366cc")).toEqual([]);
    expect(document.querySelectorAll("[data-foli-peer]")).toHaveLength(0);
  });
});
