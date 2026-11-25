// @vitest-environment jsdom
import type { FoliDocument } from "@folijs/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { FoliEditor, type FoliEditorHandle } from "./index.js";

const anchor = (type: string, id: number) => ({ type, attrs: { id } });
const document3 = (comments: FoliDocument["comments"]): FoliDocument => ({
  schemaVersion: 5,
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

function setup(comments: FoliDocument["comments"], onlyOwnComments?: boolean) {
  const ref = createRef<FoliEditorHandle>();
  render(
    <FoliEditor
      ref={ref}
      initialContent={document3(comments)}
      author="Me"
      onlyOwnComments={onlyOwnComments}
    />,
  );
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

  it("shades a thread's text until it is resolved, replies too", () => {
    const shaded = () =>
      (document.querySelector('[data-foli-comments~="0"]') as HTMLElement).style.backgroundColor;
    const editor = setup([{ id: 0, author: "Ana", content: note("Which world?") }]);
    expect(shaded()).not.toBe("");
    fireEvent.click(within(pane()).getByRole("button", { name: "Resolve" }));
    expect(shaded()).toBe("");
    act(() => {
      editor.commands.undo();
    });
    expect(shaded()).not.toBe("");
  });

  it("takes its mark off every copy of the focused thread's text", () => {
    setup([{ id: 0, author: "Ana", content: note("Which world?") }]);
    const thread = within(pane()).getByRole("article", { name: "Comment by Ana" });
    fireEvent.focus(thread);
    const text = document.querySelector('[data-foli-comments~="0"]') as HTMLElement;
    expect(text.classList.contains("foli-comment-active")).toBe(true);
    // As the page layout copies a paragraph split across pages, mark and all.
    text.parentElement?.append(text.cloneNode(true));
    fireEvent.blur(thread);
    expect(document.querySelectorAll(".foli-comment-active")).toHaveLength(0);
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

  it("shows a comment added by a command to a document that had none", () => {
    const editor = setup([]);
    expect(screen.queryByRole("article")).toBeNull();
    act(() => {
      editor.select(2, 4);
      editor.commands.addComment("From the API");
    });
    expect(within(pane()).getByRole("article", { name: "Comment by Me" }).textContent).toContain(
      "From the API",
    );
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

  it("replies to a reply at the end of its thread", () => {
    const editor = setup([
      { id: 0, author: "Ana", content: note("Which world?") },
      { id: 1, author: "Ben", content: note("This one"), parent: 0 },
    ]);
    const thread = within(pane()).getByRole("article", { name: "Comment by Ana" });
    fireEvent.click(within(thread).getByRole("button", { name: "Reply to Ben" }));
    fireEvent.change(within(thread).getByRole("textbox", { name: "Reply" }), {
      target: { value: "Agreed" },
    });
    fireEvent.click(within(thread).getByRole("button", { name: "Save" }));
    expect(editor.getDocument().comments.map((c) => [c.author, c.parent])).toEqual([
      ["Ana", undefined],
      ["Ben", 0],
      ["Me", 0],
    ]);
    // Back to the button that opened the form.
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Reply to Ben");
  });

  it("edits and deletes only the author's own comments when asked", () => {
    const comments = [
      { id: 0, author: "Ana", content: note("Which world?") },
      { id: 1, author: "Me", content: note("This one"), parent: 0 },
    ];
    setup(comments, true);
    const thread = within(pane()).getByRole("article", { name: "Comment by Ana" });
    const names = () =>
      within(thread)
        .queryAllByRole("button")
        .map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(names()).toEqual([
      "Reply",
      "Resolve",
      "Reply to Me",
      "Edit reply by Me",
      "Delete reply by Me",
    ]);
    cleanup();
    // Off (the default): every comment.
    setup(comments);
    expect(within(pane()).getByRole("button", { name: "Edit comment by Ana" })).toBeTruthy();
    expect(within(pane()).getByRole("button", { name: "Delete comment by Ana" })).toBeTruthy();
  });
});

describe("FoliEditor commentOnly (26.2)", () => {
  afterEach(cleanup);

  function commenter(comments: FoliDocument["comments"] = [], onlyOwnComments?: boolean) {
    const ref = createRef<FoliEditorHandle>();
    render(
      <FoliEditor
        ref={ref}
        initialContent={document3(comments)}
        author="Me"
        commentOnly
        onlyOwnComments={onlyOwnComments}
      />,
    );
    return (ref.current as FoliEditorHandle).editor;
  }
  const text = (editor: ReturnType<typeof commenter>) => editor.state.doc.textContent;

  it("comments and replies; the text and the formatting stay", () => {
    const editor = commenter([{ id: 0, author: "Ana", content: note("Which world?") }]);
    expect(document.querySelector('[contenteditable="true"]')).toBeNull();
    // Formatting is off; commenting and review navigation stay.
    expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-disabled")).toBe("true");
    act(() => editor.select(1, 6));
    fireEvent.click(screen.getByRole("button", { name: "New comment" }));
    const field = within(pane()).getByRole("textbox", { name: "Comment" });
    fireEvent.change(field, { target: { value: "Greeting?" } });
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    const thread = within(pane()).getByRole("article", { name: "Comment by Ana" });
    fireEvent.click(within(thread).getByRole("button", { name: "Reply" }));
    fireEvent.change(within(thread).getByRole("textbox", { name: "Reply" }), {
      target: { value: "This one" },
    });
    fireEvent.click(within(thread).getByRole("button", { name: "Save" }));
    expect(editor.getDocument().comments.map((c) => [c.author, c.parent])).toEqual([
      ["Ana", undefined],
      ["Me", undefined],
      ["Me", 0],
    ]);
    // Undo takes the reply back, redo brings it again.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(editor.getDocument().comments).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    expect(editor.getDocument().comments).toHaveLength(3);
    // Only the user's own comments are edited and deleted (onlyOwnComments by default).
    expect(within(pane()).queryByRole("button", { name: "Delete comment by Ana" })).toBeNull();
    expect(within(pane()).getByRole("button", { name: "Delete reply by Me" })).toBeTruthy();
    // Commands that change the text are refused.
    const content = editor.getDocument().content;
    act(() => {
      editor.select(1, 3);
      editor.commands.insertText("Bye");
      editor.commands.toggleMark("bold");
    });
    expect(text(editor)).toBe("Hello world");
    expect(editor.getDocument().content).toEqual(content);
  });

  it("onlyOwnComments can still be turned off", () => {
    commenter([{ id: 0, author: "Ana", content: note("Which world?") }], false);
    expect(within(pane()).getByRole("button", { name: "Delete comment by Ana" })).toBeTruthy();
  });
});
