// @vitest-environment jsdom
import type { FoliDocument } from "@folijs/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { FoliEditor, type FoliEditorHandle } from "./index.js";

const anchor = (type: string, id: number) => ({ type, attrs: { id } });
const document3 = (comments: FoliDocument["comments"]): FoliDocument => ({
  schemaVersion: 4,
  section: {},
  defaults: {},
  styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
  numbering: { abstracts: [], instances: [] },
  comments,
  content: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Hello " },
          anchor("commentStart", 0),
          { type: "text", text: "world" },
          anchor("commentEnd", 0),
          anchor("commentReference", 0),
        ],
      },
    ],
  },
});
const note = (text: string) => [{ type: "paragraph", content: [{ type: "text", text }] }];

function setup(comments: FoliDocument["comments"]) {
  const ref = createRef<FoliEditorHandle>();
  render(<FoliEditor ref={ref} initialContent={document3(comments)} author="Me" />);
  return (ref.current as FoliEditorHandle).editor;
}
const pane = () => screen.getByRole("complementary", { name: "Comments" });

describe("FoliComments in FoliEditor", () => {
  afterEach(cleanup);

  it("shows threads; replies, resolves, reopens and deletes", () => {
    const editor = setup([{ id: 0, author: "Ana", content: note("Which world?") }]);
    const thread = within(pane()).getByRole("article", { name: "Comment by Ana" });
    expect(thread.textContent).toContain("Which world?");
    // The commented text carries the comment's id (the pane aligns and marks it).
    expect(document.querySelector('[data-foli-comments~="0"]')?.textContent).toBe("world");

    fireEvent.click(within(thread).getByRole("button", { name: "Reply" }));
    fireEvent.change(within(thread).getByRole("textbox", { name: "Reply" }), {
      target: { value: "This one" },
    });
    fireEvent.click(within(thread).getByRole("button", { name: "Save" }));
    expect(editor.getDocument().comments.map((c) => [c.author, c.parent])).toEqual([
      ["Ana", undefined],
      ["Me", 0],
    ]);
    expect(thread.textContent).toContain("This one");

    fireEvent.click(within(thread).getByRole("button", { name: "Resolve" }));
    expect(editor.getDocument().comments[0]?.done).toBe(true);
    expect(within(pane()).getByRole("article", { name: "Comment by Ana, resolved" })).toBeTruthy();
    fireEvent.click(within(pane()).getByRole("button", { name: "Reopen" }));
    expect(editor.getDocument().comments[0]?.done).toBeUndefined();

    fireEvent.click(within(pane()).getByRole("button", { name: "Delete reply by Me" }));
    expect(editor.getDocument().comments).toHaveLength(1);
    fireEvent.click(within(pane()).getByRole("button", { name: "Delete comment by Ana" }));
    expect(editor.getDocument().comments).toEqual([]);
    // No comments left: the pane goes ("auto").
    expect(screen.queryByRole("complementary", { name: "Comments" })).toBeNull();
  });

  it("edits a comment's text", () => {
    const editor = setup([{ id: 0, author: "Ana", content: note("Old") }]);
    fireEvent.click(within(pane()).getByRole("button", { name: "Edit comment by Ana" }));
    fireEvent.change(within(pane()).getByRole("textbox", { name: "Comment" }), {
      target: { value: "New\nlines" },
    });
    fireEvent.click(within(pane()).getByRole("button", { name: "Save" }));
    expect(editor.getDocument().comments[0]?.content).toEqual([...note("New"), ...note("lines")]);
  });

  it("opens a new comment for writing; one left empty goes", () => {
    const editor = setup([]);
    act(() => editor.select(2, 4));
    fireEvent.click(screen.getByRole("button", { name: "New comment" }));
    const field = within(pane()).getByRole("textbox", { name: "Comment" });
    expect(document.activeElement).toBe(field);
    fireEvent.keyDown(field, { key: "Escape" });
    expect(editor.getDocument().comments).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "New comment" }));
    fireEvent.change(within(pane()).getByRole("textbox", { name: "Comment" }), {
      target: { value: "Noted" },
    });
    fireEvent.keyDown(within(pane()).getByRole("textbox", { name: "Comment" }), {
      key: "Enter",
      ctrlKey: true,
    });
    expect(editor.getDocument().comments.map((c) => [c.author, c.content])).toEqual([
      ["Me", note("Noted")],
    ]);
  });

  it("does not open or delete an empty comment the document came with", () => {
    const empty = [{ type: "paragraph", attrs: { style: "CommentText" } }];
    const editor = setup([{ id: 0, author: "Ana", content: empty }]);
    expect(within(pane()).queryByRole("textbox")).toBeNull();
    fireEvent.click(within(pane()).getByRole("button", { name: "Edit comment by Ana" }));
    fireEvent.keyDown(within(pane()).getByRole("textbox", { name: "Comment" }), { key: "Escape" });
    expect(editor.getDocument().comments).toHaveLength(1);
  });

  it("edits a Word comment (CommentText style) keeping its style, and refocuses", () => {
    const styled = [
      {
        type: "paragraph",
        attrs: { style: "CommentText" },
        content: [{ type: "text", text: "Old" }],
      },
    ];
    const editor = setup([{ id: 0, author: "Ana", content: styled }]);
    fireEvent.click(within(pane()).getByRole("button", { name: "Edit comment by Ana" }));
    fireEvent.change(within(pane()).getByRole("textbox", { name: "Comment" }), {
      target: { value: "New" },
    });
    fireEvent.click(within(pane()).getByRole("button", { name: "Save" }));
    expect(editor.getDocument().comments[0]?.content).toEqual([
      {
        type: "paragraph",
        attrs: { style: "CommentText" },
        content: [{ type: "text", text: "New" }],
      },
    ]);
    expect(document.activeElement?.closest("article")).not.toBeNull();
  });

  it("closes what it was writing when the document changes; undo does not reopen", () => {
    const editor = setup([]);
    act(() => editor.select(2, 4));
    fireEvent.click(screen.getByRole("button", { name: "New comment" }));
    expect(within(pane()).getByRole("textbox", { name: "Comment" })).toBeTruthy();
    const empty = [{ type: "paragraph", attrs: { style: "CommentText" } }];
    act(() => editor.setDocument(document3([{ id: 0, author: "Ana", content: empty }])));
    expect(within(pane()).queryByRole("textbox")).toBeNull();
    // Deleting it, then undo: it comes back closed.
    fireEvent.click(within(pane()).getByRole("button", { name: "Delete comment by Ana" }));
    act(() => {
      editor.commands.undo();
    });
    expect(editor.getDocument().comments).toHaveLength(1);
    expect(within(pane()).queryByRole("textbox")).toBeNull();
  });

  it("offers no reply where one cannot be anchored", () => {
    const editor = setup([
      { id: 0, author: "Ana", content: note("anchored") },
      { id: 7, author: "Ben", content: note("no anchors") },
    ]);
    const thread = within(pane()).getByRole("article", { name: "Comment by Ben" });
    expect(within(thread).queryByRole("button", { name: "Reply" })).toBeNull();
    expect(editor.getDocument().comments).toHaveLength(2);
  });

  it("moves the focus to the next thread after a delete", () => {
    setup([{ id: 0, author: "Ana", content: note("one") }]);
    fireEvent.click(within(pane()).getByRole("button", { name: "Delete comment by Ana" }));
    // No thread left, the pane hidden ("auto"): back to the document.
    expect(document.activeElement?.getAttribute("role")).toBe("textbox");
  });

  it("shows no actions when read-only", () => {
    const ref = createRef<FoliEditorHandle>();
    render(
      <FoliEditor
        ref={ref}
        initialContent={document3([{ id: 0, author: "Ana", content: note("x") }])}
        readOnly
      />,
    );
    expect(within(pane()).queryAllByRole("button")).toEqual([]);
  });
});
