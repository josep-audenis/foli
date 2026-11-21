// @vitest-environment jsdom
// Bug-hunt repros (second sweep): each test asserts the correct behaviour.
import {
  createEditor,
  type Editor,
  type FoliDocument,
  insertBookmark,
  listBookmarks,
  type NodeJSON,
  type StoryView,
} from "@folijs/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { memo } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FoliCanvas, FoliComments, FoliEditorProvider, FoliNavigation } from "./index.js";

const p = (text: string): NodeJSON => ({ type: "paragraph", content: [{ type: "text", text }] });
const documentOf = (content: NodeJSON[], more: Partial<FoliDocument> = {}): FoliDocument => ({
  schemaVersion: 5,
  section: {},
  defaults: {},
  styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
  numbering: { abstracts: [], instances: [] },
  comments: [],
  content: { type: "doc", content },
  ...more,
});

function fakeView(editor: Editor) {
  const view: StoryView = {
    open: null,
    edit: () => false,
    editNote: () => false,
    toReference: () => false,
    close: () => {},
    fieldLayout: { pages: 1, pageAt: () => ({ number: 1, sectionPages: 1 }) },
    updateFields: () => ({ updated: 0, unchanged: 0, rebuilt: 0, skipped: [] }),
    showMatches: () => {},
    reveal: vi.fn(() => true),
    goToPage: vi.fn(() => true),
    focus: vi.fn(),
  };
  editor.storyView = view;
}

const options = () =>
  [...screen.getByLabelText<HTMLSelectElement>("Bookmarks", { selector: "select" }).options].map(
    (option) => option.value,
  );

// Memo keeps the parent's render from reaching the pane: only the editor does.
const Pane = memo(() => <FoliComments />);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("regressions 2: react", () => {
  it("the bookmarks dialog lists a bookmark made in the document while it is open", () => {
    const editor = createEditor({ document: documentOf([p("one two")]) });
    fakeView(editor);
    render(<FoliNavigation editor={editor} />);
    act(() => {
      editor.navigation?.("bookmarks");
    });
    expect(options()).toEqual([]);
    act(() => {
      insertBookmark(editor, "Late", { from: 1, to: 4 });
    });
    expect(options()).toEqual(["Late"]);
  });

  it("a refused bookmark delete says so and keeps the bookmark picked", () => {
    const editor = createEditor({
      document: documentOf(
        [
          {
            type: "paragraph",
            content: [
              { type: "controlStart", attrs: { id: "c" } },
              { type: "bookmarkStart", attrs: { id: 1, name: "Locked" } },
              { type: "text", text: "x" },
              { type: "bookmarkEnd", attrs: { id: 1 } },
              { type: "controlEnd", attrs: { id: "c" } },
            ],
          },
        ],
        { controls: { c: { kind: "richText", lock: "contentLocked" } } },
      ),
    });
    fakeView(editor);
    render(<FoliNavigation editor={editor} />);
    act(() => {
      editor.navigation?.("bookmarks");
    });
    const list = screen.getByLabelText<HTMLSelectElement>("Bookmarks", { selector: "select" });
    fireEvent.change(list, { target: { value: "Locked" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(listBookmarks(editor).map((b) => b.name)).toEqual(["Locked"]);
    expect(screen.getByRole("alert").textContent).toContain("cannot change");
    expect(list.value).toBe("Locked");
    expect(screen.getByLabelText<HTMLInputElement>("Bookmark name").value).toBe("Locked");
  });

  it("a comments pane mounted before the pages watches them once they are there", () => {
    const observed: Element[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(target: Element) {
          observed.push(target);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    const editor = createEditor({ document: documentOf([p("Hello")]) });
    const tree = (canvas: boolean) => (
      <FoliEditorProvider editor={editor}>
        <Pane />
        {canvas && <FoliCanvas />}
      </FoliEditorProvider>
    );
    const { rerender } = render(tree(false));
    const pane = screen.getByRole("complementary", { name: "Comments" });
    expect(observed).toEqual([]);
    rerender(tree(true));
    expect(document.querySelector(".foli-page")).toBeTruthy();
    act(() => editor.select(2));
    expect(observed.some((target) => target.contains(pane))).toBe(true);
  });
});
