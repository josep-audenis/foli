// @vitest-environment jsdom
import {
  createEditor,
  type Editor,
  type FoliDocument,
  type FoundMatches,
  listBookmarks,
  type NodeJSON,
  type StoryView,
  undoDepth,
} from "@folijs/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FoliEditor, FoliNavigation, FoliToolbar } from "./index.js";

const p = (text: string, style?: string): NodeJSON => ({
  type: "paragraph",
  ...(style ? { attrs: { style } } : {}),
  content: [{ type: "text", text }],
});
const documentOf = (...content: NodeJSON[]): FoliDocument => ({
  schemaVersion: 5,
  section: {},
  defaults: {},
  styles: [
    { id: "Normal", type: "paragraph", name: "Normal", isDefault: true },
    { id: "Heading1", type: "paragraph", name: "heading 1", basedOn: "Normal" },
    { id: "Heading2", type: "paragraph", name: "heading 2", basedOn: "Normal" },
  ],
  numbering: { abstracts: [], instances: [] },
  comments: [],
  content: { type: "doc", content },
  stories: {
    h: { kind: "header", content: { type: "doc", content: [p("cat in the header")] } },
  },
});

/** A view that only records what it is told. */
function fakeView(editor: Editor) {
  const shown: (FoundMatches | null)[] = [];
  const view: StoryView = {
    open: null,
    edit: () => false,
    editNote: () => false,
    toReference: () => false,
    close: () => {},
    fieldLayout: { pages: 3, pageAt: () => ({ number: 2, sectionPages: 3 }) },
    updateFields: () => ({ updated: 0, unchanged: 0, rebuilt: 0, skipped: [] }),
    showMatches: (found) => shown.push(found),
    reveal: vi.fn((target) => {
      if (target.story === null) editor.select(target.from, target.to);
      else editor.story(target.story)?.select(target.from, target.to);
      return true;
    }),
    goToPage: vi.fn(() => true),
    focus: vi.fn(),
  };
  editor.storyView = view;
  return { view, shown };
}

function setup(...content: NodeJSON[]) {
  const editor = createEditor({ document: documentOf(...content) });
  const fake = fakeView(editor);
  render(<FoliNavigation editor={editor} />);
  return { editor, ...fake };
}
const ask = (editor: Editor, request: Parameters<NonNullable<Editor["navigation"]>>[0]) =>
  act(() => {
    expect(editor.navigation?.(request)).toBe(true);
  });
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const text = (editor: Editor) => editor.state.doc.textContent;

afterEach(cleanup);

describe("find and replace panel", () => {
  it("opens on its key with the focus in the query, counts and marks matches", () => {
    const { editor, shown } = setup(p("a cat, a cat"));
    ask(editor, "find");
    const dialog = screen.getByRole("dialog", { name: "Find and replace" });
    expect(document.activeElement).toBe(screen.getByLabelText("Find what"));
    type("Find what", "cat");
    expect(within(dialog).getByRole("status").textContent).toBe("1 of 3");
    const last = shown[shown.length - 1];
    expect(last?.matches.length).toBe(3);
    expect(last?.current?.from).toBe(3);
    // Typing moves nothing in the document.
    expect(editor.state.selection.empty).toBe(true);
    type("Find what", "zebra");
    expect(within(dialog).getByRole("status").textContent).toBe("No results");
  });

  it("leaves the view where it is when the document changes, and searches again after a pause", async () => {
    const { editor, shown } = setup(p("a cat, a cat"));
    ask(editor, "find");
    type("Find what", "cat");
    expect(shown[shown.length - 1]).toMatchObject({ scroll: true, current: { from: 3 } });
    const count = shown.length;
    act(() => editor.select(13));
    act(() => {
      editor.commands.insertText(" cat");
    });
    // Typing: nothing looked for yet, the marks moved with the text.
    expect(shown.length).toBe(count + 1);
    expect(shown[shown.length - 1]).toMatchObject({ scroll: false, current: { from: 3 } });
    expect(shown[shown.length - 1]?.matches.length).toBe(3);
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    const last = shown[shown.length - 1];
    expect(last?.matches.length).toBe(4);
    expect(last).toMatchObject({ scroll: false, current: { from: 3 } });
    act(() => editor.select(1, 2));
    act(() => {
      editor.commands.insertText("An");
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    // The current match moved with the text and stays current; nothing is gone to.
    expect(shown[shown.length - 1]).toMatchObject({ scroll: false, current: { from: 4 } });
    expect(screen.getByRole("status").textContent).toBe("1 of 4");
    // Deleted, it is current no more.
    act(() => editor.select(4, 7));
    act(() => {
      editor.commands.deleteSelection();
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    expect(shown[shown.length - 1]).toMatchObject({ scroll: false, current: null });
    expect(screen.getByRole("status").textContent).toBe("3 found");
  });

  it("searches again at once after its own Replace all", () => {
    const { editor, shown } = setup(p("cat cat dog dog"));
    ask(editor, "replace");
    type("Find what", "cat");
    type("Replace with", "dog");
    type("Find what", "dog");
    type("Replace with", "cow");
    press("Replace all");
    expect(text(editor)).toBe("cat cat cow cow");
    const last = shown[shown.length - 1];
    expect(last?.matches).toEqual([]);
    expect(last?.current).toBeNull();
  });

  it("moves the marks with the text while typing, before the search comes again", () => {
    const { editor, shown } = setup(p("A cat sat"));
    ask(editor, "find");
    type("Find what", "cat");
    expect(shown[shown.length - 1]?.current).toMatchObject({ from: 3, to: 6 });
    act(() => editor.select(1));
    act(() => {
      editor.commands.insertText("xyz");
    });
    const last = shown[shown.length - 1];
    expect(last?.current).toMatchObject({ from: 6, to: 9, text: "cat" });
    expect(editor.state.doc.textBetween(6, 9)).toBe("cat");
    // Enter goes to it, not to where it was.
    fireEvent.submit(screen.getByLabelText("Find what").closest("form") as HTMLFormElement);
    expect(editor.state.selection).toMatchObject({ from: 6, to: 9 });
    // Typing inside a match takes it away until the search comes again.
    act(() => editor.select(7));
    act(() => {
      editor.commands.insertText("o");
    });
    expect(shown[shown.length - 1]?.matches.map((m) => m.story)).toEqual(["h"]);
  });

  it("takes the selection as the query", () => {
    const { editor } = setup(p("a cat"));
    act(() => editor.select(3, 6));
    ask(editor, "find");
    expect((screen.getByLabelText("Find what") as HTMLInputElement).value).toBe("cat");
    expect(screen.getByRole("status").textContent).toBe("1 of 2");
  });

  it("goes on with Enter, back with Shift+Enter, through the stories, and around", () => {
    const { editor, view } = setup(p("a cat, a cat"));
    ask(editor, "find");
    type("Find what", "cat");
    const input = screen.getByLabelText("Find what");
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(editor.state.selection.from).toBe(3);
    press("Next");
    expect(editor.state.selection.from).toBe(10);
    press("Next");
    expect(view.reveal).toHaveBeenLastCalledWith(
      expect.objectContaining({ story: "h", from: 1 }),
      {},
    );
    expect(screen.getByRole("status").textContent).toBe("3 of 3, in a header");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(screen.getByRole("status").textContent).toContain("of 3");
  });

  it("follows the options", () => {
    const { editor } = setup(p("Cat concat"));
    ask(editor, "find");
    type("Find what", "cat");
    expect(screen.getByRole("status").textContent).toBe("1 of 3");
    fireEvent.click(screen.getByLabelText("Match case"));
    expect(screen.getByRole("status").textContent).toBe("1 of 2");
    fireEvent.click(screen.getByLabelText("Whole words"));
    expect(screen.getByRole("status").textContent).toBe("1 of 1, in a header");
  });

  it("replaces the current match, after showing it, then all in one undo step", () => {
    const { editor } = setup(p("cat cat cat"));
    ask(editor, "replace");
    type("Find what", "cat");
    type("Replace with", "dog");
    press("Replace");
    expect(text(editor)).toBe("cat cat cat");
    press("Replace");
    expect(text(editor)).toBe("dog cat cat");
    expect(screen.getByRole("status").textContent).toBe("Replaced 1.");
    const depth = undoDepth(editor.state);
    press("Replace all");
    expect(text(editor)).toBe("dog dog dog");
    expect(editor.story("h")?.state.doc.textContent).toBe("dog in the header");
    expect(undoDepth(editor.state)).toBe(depth + 1);
    expect(screen.getByRole("status").textContent).toBe("Replaced 3.");
  });

  it("says what it left", () => {
    const { editor } = setup({
      type: "paragraph",
      content: [
        { type: "text", text: "x" },
        { type: "fieldStart" },
        { type: "fieldCode", attrs: { text: " QUOTE " } },
        { type: "fieldSeparator" },
        { type: "text", text: "yz" },
        { type: "fieldEnd" },
      ],
    });
    ask(editor, "replace");
    type("Find what", "xy");
    type("Replace with", "q");
    press("Replace all");
    expect(screen.getByRole("status").textContent).toBe(
      "Replaced 0. 1 left as they are: across a field's edge.",
    );
  });

  it("offers no replacing when read-only", () => {
    const editor = createEditor({ document: documentOf(p("cat")) });
    fakeView(editor);
    render(<FoliNavigation editor={editor} readOnly />);
    ask(editor, "replace");
    expect(screen.queryByLabelText("Replace with")).toBeNull();
    expect(screen.queryByRole("button", { name: "Replace" })).toBeNull();
  });

  it("switches what it does with the arrow keys on its tabs", () => {
    const { editor } = setup(p("cat"));
    ask(editor, "find");
    const tab = screen.getByRole("tab", { name: "Find" });
    tab.focus();
    fireEvent.keyDown(tab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Replace" }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Replace" }));
    expect(screen.getByLabelText("Replace with")).toBeTruthy();
  });

  it("closes on Escape, unmarks, and gives the focus back", () => {
    const { editor, shown, view } = setup(p("cat"));
    ask(editor, "find");
    type("Find what", "cat");
    fireEvent.keyDown(screen.getByLabelText("Find what"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(shown[shown.length - 1]).toBeNull();
    expect(view.focus).toHaveBeenCalled();
  });

  it("goes to the next match on F3 with the panel closed, or opens it", () => {
    const { editor } = setup(p("cat cat"));
    ask(editor, "next");
    expect(screen.getByRole("dialog")).toBeTruthy();
    type("Find what", "cat");
    fireEvent.keyDown(screen.getByLabelText("Find what"), { key: "Escape" });
    act(() => editor.select(1));
    ask(editor, "next");
    expect(editor.state.selection.from).toBe(1);
    ask(editor, "next");
    expect(editor.state.selection.from).toBe(5);
    ask(editor, "previous");
    expect(editor.state.selection.from).toBe(1);
  });

  it("goes to a page, a bookmark and a heading", () => {
    const { editor, view } = setup(p("Title", "Heading1"), p("body"));
    ask(editor, "goTo");
    type("Page number", "3");
    press("Go to");
    expect(view.goToPage).toHaveBeenCalledWith(3, { focus: true });
    ask(editor, "goTo");
    fireEvent.change(screen.getByLabelText("Go to what"), { target: { value: "heading" } });
    fireEvent.submit(screen.getByLabelText("Heading").closest("form") as HTMLFormElement);
    expect(view.reveal).toHaveBeenLastCalledWith(expect.objectContaining({ from: 1 }), {
      focus: true,
    });
  });

  it("gives the key back when nothing is mounted", () => {
    const editor = createEditor({ document: documentOf(p("cat")) });
    const { unmount } = render(<FoliNavigation editor={editor} />);
    expect(editor.navigation).not.toBeNull();
    unmount();
    expect(editor.navigation).toBeNull();
  });
});

describe("bookmarks dialog", () => {
  it("adds, refuses bad names, renames, goes to and deletes", () => {
    const { editor, view } = setup(p("one two"));
    act(() => editor.select(1, 4));
    ask(editor, "bookmarks");
    expect(document.activeElement).toBe(screen.getByLabelText("Bookmark name"));
    type("Bookmark name", "1bad");
    press("Add");
    expect(screen.getByRole("alert").textContent).toContain("starts with a letter");
    type("Bookmark name", "First");
    press("Add");
    expect(listBookmarks(editor).map((b) => b.name)).toEqual(["First"]);
    const list = () => screen.getByLabelText("Bookmarks", { selector: "select" });
    fireEvent.change(list(), { target: { value: "First" } });
    type("Bookmark name", "Second");
    press("Rename");
    expect(listBookmarks(editor).map((b) => b.name)).toEqual(["Second"]);
    press("Delete");
    expect(listBookmarks(editor)).toEqual([]);
    type("Bookmark name", "Again");
    press("Add");
    fireEvent.change(list(), { target: { value: "Again" } });
    press("Go to");
    expect(view.reveal).toHaveBeenCalledWith(expect.objectContaining({ story: null }), {
      focus: true,
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("outline", () => {
  it("lists the headings with their pages, shows where the caret is, and goes there", () => {
    const { editor, view } = setup(p("Title", "Heading1"), p("text"), p("Sub", "Heading2"));
    ask(editor, "outline");
    const nav = screen.getByRole("navigation", { name: "Document outline" });
    const buttons = within(nav).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Close", "Title2", "Sub2"]);
    act(() => editor.select(15));
    expect(buttons[2]?.getAttribute("aria-current")).toBe("location");
    fireEvent.click(buttons[1] as HTMLElement);
    expect(view.reveal).toHaveBeenCalledWith({ story: null, from: 1, to: 1 }, { focus: true });
    (buttons[1] as HTMLElement).focus();
    fireEvent.keyDown(buttons[1] as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(buttons[2]);
    fireEvent.keyDown(buttons[2] as HTMLElement, { key: "Escape" });
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});

describe("with the toolbar", () => {
  it("offers the panels from its menu, only when they are there", () => {
    const editor = createEditor({ document: documentOf(p("cat")) });
    fakeView(editor);
    const { rerender } = render(<FoliToolbar editor={editor} />);
    fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
    expect(screen.getByRole("menuitem", { name: "Find…" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
    rerender(
      <>
        <FoliToolbar editor={editor} />
        <FoliNavigation editor={editor} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
    fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Replace…" }));
    expect(screen.getByLabelText("Replace with")).toBeTruthy();
  });

  it("is part of FoliEditor", () => {
    let held: Editor | null = null;
    render(
      <FoliEditor
        ref={(handle) => {
          held = handle?.editor ?? held;
        }}
        initialContent={documentOf(p("cat"))}
      />,
    );
    expect((held as Editor | null)?.navigation).not.toBeNull();
  });
});
