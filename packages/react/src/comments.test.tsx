// @vitest-environment jsdom
import type { FoliDocument } from "@folijs/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { FoliEditor, type FoliEditorHandle } from "./index.js";

const anchor = (type: string, id: number) => ({ type, attrs: { id } });
const document3 = (comments: FoliDocument["comments"]): FoliDocument => ({
  schemaVersion: 3,
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

    const [, reply] = within(pane()).getAllByRole("button", { name: "Delete" });
    fireEvent.click(reply as HTMLElement);
    expect(editor.getDocument().comments).toHaveLength(1);
    fireEvent.click(within(pane()).getByRole("button", { name: "Delete" }));
    expect(editor.getDocument().comments).toEqual([]);
    // No comments left: the pane goes ("auto").
    expect(screen.queryByRole("complementary", { name: "Comments" })).toBeNull();
  });

  it("edits a comment's text", () => {
    const editor = setup([{ id: 0, author: "Ana", content: note("Old") }]);
    fireEvent.click(within(pane()).getByRole("button", { name: "Edit" }));
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
