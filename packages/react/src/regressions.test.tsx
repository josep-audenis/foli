// @vitest-environment jsdom
// Bug-hunt repros: each test asserts the correct behaviour and fails on today's code.
import {
  createEditor,
  type Editor,
  type FoliDocument,
  insertControl,
  type NodeJSON,
  openLinkEditor,
  type StoryView,
} from "@folijs/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FoliEditor, type FoliEditorHandle, FoliNavigation, FoliToolbar } from "./index.js";

const p = (text: string): NodeJSON => ({ type: "paragraph", content: [{ type: "text", text }] });
const documentOf = (
  content: NodeJSON[],
  comments: FoliDocument["comments"] = [],
): FoliDocument => ({
  schemaVersion: 5,
  section: {},
  defaults: {},
  styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
  numbering: { abstracts: [], instances: [] },
  comments,
  content: { type: "doc", content },
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

afterEach(cleanup);

describe("regressions: react", () => {
  it("the link dialog closes when another document is set (as the other dialogs do)", () => {
    const editor = createEditor({ document: documentOf([p("Hello"), p("World")]) });
    render(<FoliToolbar editor={editor} />);
    act(() => editor.select(1));
    act(() => {
      editor.run(openLinkEditor);
    });
    expect(screen.getByRole("dialog", { name: "Add link" })).toBeTruthy();
    // Another document: its start is the same position, but it is not the text the dialog opened on.
    act(() => editor.setDocument(documentOf([p("Other")])));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opening one toolbar dialog closes the one already open", () => {
    const editor = createEditor({ document: documentOf([p("Hello"), p("World")]) });
    render(<FoliToolbar editor={editor} />);
    act(() => editor.select(1));
    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Note options…" }));
    expect(screen.getByRole("dialog", { name: "Note options" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Section" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Page setup…" }));
    expect(screen.getByRole("dialog", { name: "Page setup" })).toBeTruthy();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("the replace panel offers no replacing once the editor turns read-only", () => {
    const editor = createEditor({ document: documentOf([p("a cat, a cat")]) });
    fakeView(editor);
    const { rerender } = render(<FoliNavigation editor={editor} />);
    act(() => {
      editor.navigation?.("replace");
    });
    fireEvent.change(screen.getByLabelText("Find what"), { target: { value: "cat" } });
    fireEvent.change(screen.getByLabelText("Replace with"), { target: { value: "dog" } });
    rerender(<FoliNavigation editor={editor} readOnly />);
    const all = screen.queryByRole("button", { name: "Replace all" });
    if (all) fireEvent.click(all);
    expect(editor.state.doc.textContent).toBe("a cat, a cat");
    expect(screen.queryByLabelText("Replace with")).toBeNull();
  });

  it("a comment open for editing cannot be saved once the editor turns read-only", () => {
    const ref = createRef<FoliEditorHandle>();
    const content = documentOf(
      [
        {
          type: "paragraph",
          content: [
            { type: "commentStart", attrs: { id: 0 } },
            { type: "text", text: "world" },
            { type: "commentEnd", attrs: { id: 0 } },
            { type: "commentReference", attrs: { id: 0 } },
          ],
        },
      ],
      [{ id: 0, author: "Ana", content: [p("Old")] }],
    );
    const { rerender } = render(<FoliEditor ref={ref} initialContent={content} />);
    const pane = screen.getByRole("complementary", { name: "Comments" });
    fireEvent.click(within(pane).getByRole("button", { name: "Edit comment by Ana" }));
    fireEvent.change(within(pane).getByRole("textbox", { name: "Comment" }), {
      target: { value: "New" },
    });
    rerender(<FoliEditor ref={ref} initialContent={content} readOnly />);
    const save = within(pane).queryByRole("button", { name: "Save" });
    if (save) fireEvent.click(save);
    expect(ref.current?.editor.getDocument().comments[0]?.content).toEqual([p("Old")]);
    expect(within(pane).queryByRole("textbox")).toBeNull();
  });

  it("OK in the control properties dialog keeps a list item whose value has a | in it", () => {
    const editor = createEditor({ document: documentOf([p("Hello"), p("World")]) });
    render(<FoliToolbar editor={editor} />);
    act(() => {
      editor.select(6);
      editor.run(insertControl("dropDown", { items: [{ value: "a|b" }, { value: "c" }] }));
    });
    const items = () => Object.values(editor.getDocument().controls ?? {})[0]?.items;
    expect(items()?.map((item) => item.value)).toEqual(["a|b", "c"]);
    fireEvent.click(screen.getByRole("button", { name: "Controls" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Control properties…" }));
    const dialog = screen.getByRole("dialog", { name: "Content control properties" });
    // Nothing edited: OK must not change the list.
    fireEvent.submit(dialog.querySelector("form") as HTMLFormElement);
    expect(items()?.map((item) => item.value)).toEqual(["a|b", "c"]);
  });
});
