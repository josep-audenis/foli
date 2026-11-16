import { describe, expect, it } from "vitest";
import type { NodeJSON } from "../model/index.js";
import type { CommentJSON, FoliDocument } from "../v3/document.js";
import { createEditor, type Editor } from "./editor.js";

const text = (value: string): NodeJSON => ({ type: "text", text: value });
const p = (...content: NodeJSON[]): NodeJSON => ({
  type: "paragraph",
  ...(content.length ? { content } : {}),
});
const anchor = (type: string, id: number): NodeJSON => ({ type, attrs: { id } });
const start = (id: number) => anchor("commentStart", id);
const end = (id: number) => anchor("commentEnd", id);
const ref = (id: number) => anchor("commentReference", id);
const DATE = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

function editorOf(blocks: NodeJSON[], comments: CommentJSON[] = [], trackChanges = false): Editor {
  const document: FoliDocument = {
    schemaVersion: 3,
    section: {},
    defaults: {},
    styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
    numbering: { abstracts: [], instances: [] },
    comments,
    content: { type: "doc", content: blocks },
  };
  return createEditor({ document, author: "Me", trackChanges });
}
const blocks = (editor: Editor) => editor.getDocument().content.content ?? [];
const comments = (editor: Editor) => editor.getDocument().comments;
const note = (value: string) => [p(text(value))];

describe("comments", () => {
  it("comments a selection: its range, the reference after it, the comment", () => {
    const editor = editorOf([p(text("Hello world"))]);
    editor.select(7, 12);
    expect(editor.commands.addComment("Which world?", { initials: "M" })).toBe(true);
    expect(blocks(editor)).toEqual([p(text("Hello "), start(0), text("world"), end(0), ref(0))]);
    expect(comments(editor)).toEqual([
      { id: 0, author: "Me", initials: "M", date: DATE, content: note("Which world?") },
    ]);
    editor.commands.undo();
    expect(blocks(editor)).toEqual([p(text("Hello world"))]);
    expect(comments(editor)).toEqual([]);
  });

  it("replies next to the comment's anchors, edits, resolves, reopens", () => {
    const editor = editorOf([p(text("ab"))]);
    editor.select(1, 3);
    editor.commands.addComment("one\ntwo");
    expect(comments(editor)[0]?.content).toEqual([p(text("one")), p(text("two"))]);
    expect(editor.commands.replyToComment(0, "reply", { author: "You" })).toBe(true);
    expect(blocks(editor)).toEqual([
      p(start(0), start(1), text("ab"), end(0), end(1), ref(0), ref(1)),
    ]);
    // A reply to a reply answers the thread's comment.
    editor.commands.replyToComment(1, "again");
    expect(comments(editor).map((c) => [c.id, c.author, c.parent])).toEqual([
      [0, "Me", undefined],
      [1, "You", 0],
      [2, "Me", 0],
    ]);
    editor.commands.editComment(1, "changed");
    expect(comments(editor)[1]?.content).toEqual(note("changed"));
    editor.commands.resolveComment(2);
    expect(comments(editor)[0]?.done).toBe(true);
    editor.commands.resolveComment(0, false);
    expect(comments(editor)[0]?.done).toBeUndefined();
  });

  it("deletes a comment with its replies and anchors; deletes all", () => {
    const editor = editorOf(
      [
        p(
          start(0),
          start(1),
          text("ab"),
          end(0),
          end(1),
          ref(0),
          ref(1),
          start(2),
          text("c"),
          end(2),
          ref(2),
        ),
      ],
      [
        { id: 0, author: "A", content: note("x") },
        { id: 1, author: "B", content: note("y"), parent: 0 },
        { id: 2, author: "A", content: note("z") },
      ],
    );
    editor.commands.deleteComment(0);
    expect(blocks(editor)).toEqual([p(text("ab"), start(2), text("c"), end(2), ref(2))]);
    expect(comments(editor).map((c) => c.id)).toEqual([2]);
    editor.commands.deleteAllComments();
    expect(blocks(editor)).toEqual([p(text("abc"))]);
    expect(comments(editor)).toEqual([]);
    editor.commands.undo();
    expect(comments(editor).map((c) => c.id)).toEqual([2]);
  });

  it("removes a comment whose text is deleted with its anchors, in the same undo step", () => {
    const editor = editorOf(
      [p(text("a"), start(0), text("bc"), end(0), ref(0), text("d"))],
      [{ id: 0, author: "A", content: note("x") }],
    );
    // Only the commented text: the anchors stay, collapsed.
    editor.select(3, 5);
    editor.commands.deleteSelection();
    expect(blocks(editor)).toEqual([p(text("a"), start(0), end(0), ref(0), text("d"))]);
    expect(comments(editor)).toHaveLength(1);
    // The range and its reference: the comment goes.
    editor.select(2, 5);
    editor.commands.deleteSelection();
    expect(blocks(editor)).toEqual([p(text("ad"))]);
    expect(comments(editor)).toEqual([]);
    editor.commands.undo();
    expect(comments(editor)).toHaveLength(1);
    // (Both deletions were one undo step: quick and next to each other.)
    expect(blocks(editor)).toEqual([p(text("a"), start(0), text("bc"), end(0), ref(0), text("d"))]);
  });

  it("is not a tracked change, and a tracked deletion keeps the comment until accepted", () => {
    const editor = editorOf([p(text("abc"))], [], true);
    editor.select(2, 3);
    editor.commands.addComment("note");
    expect(JSON.stringify(blocks(editor))).not.toMatch(/insertion/);
    editor.select(1, 6);
    editor.commands.deleteSelection();
    expect(comments(editor)).toHaveLength(1);
    editor.commands.acceptAllChanges();
    expect(comments(editor)).toEqual([]);
    expect(blocks(editor)).toEqual([p(text("c"))]);
  });

  it("keeps a comment that had no reference mark to begin with", () => {
    const editor = editorOf(
      [p(start(0), text("ab"), end(0))],
      [{ id: 0, author: "A", content: note("x") }],
    );
    editor.select(3);
    editor.commands.insertText("c");
    expect(comments(editor)).toHaveLength(1);
  });
});
