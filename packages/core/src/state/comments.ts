/**
 * Comments (9.6), as Word keeps them: a comment's range in the text (`commentStart`,
 * `commentEnd`) and its reference mark right after the range (`commentReference`), its content
 * and thread in the envelope (`comments`: replies point at their comment with `parent`,
 * resolved ones are `done`). Comment changes are `CommentStep`s, so undo takes them back; they
 * are not tracked changes. A reply has its own anchors, next to its comment's, as Word writes
 * them. A comment whose reference mark goes (its range deleted with it) goes too, with its
 * replies.
 */
import type { Node, NodeJSON } from "../model/index.js";
import type { CommentJSON } from "../v3/document.js";
import { closeHistory } from "./history.js";
import { AllSelection, Selection, TextSelection } from "./selection.js";
import { type Command, type EditorState, Plugin, PluginKey, type Transaction } from "./state.js";
import { now, trackState, untracked } from "./track.js";
import { setComments, wordContext } from "./word.js";

const ANCHORS = new Set(["commentStart", "commentEnd", "commentReference"]);

export interface CommentOptions {
  /** Default: the editor's author (`createEditor({ author })`). */
  author?: string;
  /** Word shows them on the comment (at most 9 characters). */
  initials?: string;
}

/** A comment's content: paragraphs of plain text (one per line), or schema v3 blocks. */
export type CommentContent = string | readonly NodeJSON[];

function contentOf(content: CommentContent): NodeJSON[] {
  if (typeof content !== "string") return structuredClone([...content]);
  return content
    .split(/\r\n|\r|\n/)
    .map((line) =>
      line ? { type: "paragraph", content: [{ type: "text", text: line }] } : { type: "paragraph" },
    );
}

/** Word's limit on a comment's initials. */
const INITIALS = 9;
const initialsOf = (options: CommentOptions) =>
  options.initials !== undefined ? { initials: options.initials.slice(0, INITIALS) } : {};

/** Comment anchors inside content Foli keeps verbatim (an opaque block): their ids. */
function opaqueCommentIds(doc: Node): Set<number> {
  const ids = new Set<number>();
  doc.descendants((node) => {
    if (node.type.name === "opaqueBlock" || node.type.name === "opaqueInline")
      for (const [, id] of String(node.attrs.xml).matchAll(
        /<\w+:comment(?:RangeStart|RangeEnd|Reference)\b[^>]*?\b\w+:id="(\d+)"/g,
      ))
        ids.add(Number(id));
    return node.isBlock;
  });
  return ids;
}

/** The next free comment id: above every comment and every comment anchor, verbatim ones too. */
function nextCommentId(doc: Node, comments: readonly CommentJSON[]): number {
  let max = -1;
  for (const c of comments) max = Math.max(max, c.id);
  doc.descendants((node) => {
    if (ANCHORS.has(node.type.name)) max = Math.max(max, node.attrs.id as number);
    return node.isBlock;
  });
  for (const id of opaqueCommentIds(doc)) max = Math.max(max, id);
  return max + 1;
}

/** The comment a thread starts with (`id`'s, following `parent`). */
function rootOf(comments: readonly CommentJSON[], id: number): CommentJSON | undefined {
  let root = comments.find((c) => c.id === id);
  const seen = new Set<number>();
  while (root?.parent !== undefined && !seen.has(root.id)) {
    seen.add(root.id);
    const up = root.parent;
    root = comments.find((c) => c.id === up);
  }
  return root;
}

/** Where each comment's anchors are: start, end (after which the reference goes) and reference. */
export function commentAnchors(
  doc: Node,
): Map<number, { start?: number; end?: number; reference?: number }> {
  const anchors = new Map<number, { start?: number; end?: number; reference?: number }>();
  doc.descendants((node, pos) => {
    if (!ANCHORS.has(node.type.name)) return node.isBlock;
    const id = node.attrs.id as number;
    const entry = anchors.get(id) ?? {};
    if (node.type.name === "commentStart") entry.start ??= pos;
    else if (node.type.name === "commentEnd") entry.end ??= pos;
    else entry.reference ??= pos;
    anchors.set(id, entry);
    return false;
  });
  return anchors;
}

/** A transaction for comment edits: not tracked, an undo step of its own. */
const commentTr = (state: EditorState) =>
  state.tr.setMeta(untracked, true).setMeta(closeHistory, true);

const authorOf = (state: EditorState, options: CommentOptions) =>
  options.author ?? trackState(state)?.author ?? "Author";

/**
 * Comments the selection (at a caret, the point there): its range around the selection, the
 * reference mark after it, the comment in the envelope. Schema v3 only.
 */
export function addComment(content: CommentContent, options: CommentOptions = {}): Command {
  return (state, dispatch) => {
    const context = wordContext(state);
    const { schema } = state;
    const types = {
      start: schema.nodes.commentStart,
      end: schema.nodes.commentEnd,
      reference: schema.nodes.commentReference,
    };
    if (!context || !types.start || !types.end || !types.reference) return false;
    // Select-all comments the whole text: from the first textblock to the last.
    const all = state.selection instanceof AllSelection;
    const $from = all ? Selection.atStart(state.doc).$from : state.selection.$from;
    const $to = all ? Selection.atEnd(state.doc).$to : state.selection.$to;
    if (!$from.parent.inlineContent || !$to.parent.inlineContent) return false;
    if (dispatch) {
      const comments = context.envelope.comments;
      const id = nextCommentId(state.doc, comments);
      const tr = commentTr(state);
      // From the end, so the start's position stays.
      tr.insert($to.pos, [types.end.create({ id }), types.reference.create({ id })]);
      tr.insert($from.pos, types.start.create({ id }));
      // The selection stays on the commented text, not on the anchors after it: typing over
      // it must not delete the comment's reference.
      tr.setSelection(TextSelection.create(tr.doc, $from.pos + 1, $to.pos + 1));
      const comment: CommentJSON = {
        id,
        author: authorOf(state, options),
        ...initialsOf(options),
        date: now(),
        content: contentOf(content),
      };
      setComments(tr, comments, [...comments, comment]);
      dispatch(tr);
    }
    return true;
  };
}

/** Replies to comment `parent` (a reply to a reply answers its thread's comment, as Word). */
export function replyToComment(
  parent: number,
  content: CommentContent,
  options: CommentOptions = {},
): Command {
  return (state, dispatch) => {
    const context = wordContext(state);
    const { schema } = state;
    const comments = context?.envelope.comments ?? [];
    const root = rootOf(comments, parent);
    const all = commentAnchors(state.doc);
    const anchors = root && all.get(root.id);
    const { commentStart, commentEnd, commentReference } = schema.nodes;
    if (!context || !root || !anchors || !commentStart || !commentEnd || !commentReference)
      return false;
    if (dispatch) {
      const id = nextCommentId(state.doc, comments);
      const tr = commentTr(state);
      // As Word writes a thread: the starts together (this one after the thread's last), then
      // each end with its reference (this pair after the thread's last reference).
      const ids = thread(comments, root.id);
      const last = (key: "start" | "reference") =>
        Math.max(...[...ids].map((i) => all.get(i)?.[key] ?? -1));
      const lastStart = last("start");
      const lastReference = last("reference");
      if (lastReference >= 0)
        tr.insert(lastReference + 1, [commentEnd.create({ id }), commentReference.create({ id })]);
      if (lastStart >= 0) tr.insert(lastStart + 1, commentStart.create({ id }));
      const reply: CommentJSON = {
        id,
        author: authorOf(state, options),
        ...initialsOf(options),
        date: now(),
        content: contentOf(content),
        parent: root.id,
      };
      setComments(tr, comments, [...comments, reply]);
      dispatch(tr);
    }
    return true;
  };
}

/** Changes the comments with `change` applied to comment `id`; false when there is none. */
function changeComment(
  id: number,
  change: (comment: CommentJSON, comments: readonly CommentJSON[]) => CommentJSON[],
): Command {
  return (state, dispatch) => {
    const comments = wordContext(state)?.envelope.comments;
    const comment = comments?.find((c) => c.id === id);
    if (!comments || !comment) return false;
    if (dispatch) {
      const next = comments.flatMap((c) => (c === comment ? change(c, comments) : [c]));
      dispatch(setComments(commentTr(state), comments, next));
    }
    return true;
  };
}

/** Replaces comment `id`'s content. */
export const editComment = (id: number, content: CommentContent): Command =>
  changeComment(id, (c) => [{ ...c, content: contentOf(content) }]);

/** Resolves (or reopens) comment `id`'s thread: every comment of it, as Word marks them. */
export function resolveComment(id: number, done = true): Command {
  return (state, dispatch) => {
    const comments = wordContext(state)?.envelope.comments ?? [];
    const root = rootOf(comments, id);
    if (!root) return false;
    if (dispatch) {
      const ids = thread(comments, root.id);
      const next = comments.map((c) => {
        if (!ids.has(c.id)) return c;
        const { done: _, ...rest } = c;
        return done ? { ...rest, done: true } : rest;
      });
      dispatch(setComments(commentTr(state), comments, next));
    }
    return true;
  };
}

/** The ids of `id` and every reply under it. */
function thread(comments: readonly CommentJSON[], id: number): Set<number> {
  const ids = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of comments)
      if (c.parent !== undefined && ids.has(c.parent) && !ids.has(c.id)) {
        ids.add(c.id);
        grew = true;
      }
  }
  return ids;
}

/** Removes the comments `ids` and their anchors. */
function removeComments(tr: Transaction, comments: readonly CommentJSON[], ids: Set<number>): void {
  const positions: number[] = [];
  tr.doc.descendants((node, pos) => {
    if (ANCHORS.has(node.type.name) && ids.has(node.attrs.id as number)) positions.push(pos);
    return node.isBlock;
  });
  for (const pos of positions.reverse()) tr.delete(pos, pos + 1);
  setComments(
    tr,
    comments,
    comments.filter((c) => !ids.has(c.id)),
  );
}

/** Deletes comment `id` with its replies and their anchors. */
export function deleteComment(id: number): Command {
  return (state, dispatch) => {
    const comments = wordContext(state)?.envelope.comments ?? [];
    const ids = thread(comments, id);
    // shortcut: a comment anchored in content Foli keeps verbatim (an opaque block) stays, its
    // anchors there cannot be removed; model that content to remove them.
    const verbatim = opaqueCommentIds(state.doc);
    if (!comments.some((c) => c.id === id) || [...ids].some((i) => verbatim.has(i))) return false;
    if (dispatch) {
      const tr = commentTr(state);
      removeComments(tr, comments, ids);
      dispatch(tr);
    }
    return true;
  };
}

/** Deletes every comment and its anchors (not the threads anchored in verbatim content). */
export const deleteAllComments: Command = (state, dispatch) => {
  const comments = wordContext(state)?.envelope.comments ?? [];
  const verbatim = opaqueCommentIds(state.doc);
  const kept = new Set<number>();
  for (const c of comments) {
    const root = rootOf(comments, c.id);
    if (root && verbatim.has(root.id)) for (const i of thread(comments, root.id)) kept.add(i);
    if (verbatim.has(c.id)) kept.add(c.id);
  }
  const gone = new Set(comments.map((c) => c.id).filter((i) => !kept.has(i)));
  if (!gone.size) return false;
  if (dispatch) {
    const tr = commentTr(state);
    removeComments(tr, comments, gone);
    dispatch(tr);
  }
  return true;
};

const key = new PluginKey("comments");

/** Whether one of `tr`'s steps replaced content holding a comment's reference mark. */
function removesReference(tr: Transaction): boolean {
  return tr.steps.some((step, i) => {
    let found = false;
    step.getMap().forEach((from, to) => {
      if (from < to)
        (tr.docs[i] as Node).nodesBetween(from, to, (node) => {
          if (node.type.name === "commentReference") found = true;
          return !found;
        });
    });
    return found;
  });
}

/**
 * Keeps comments with their text: a comment whose reference mark an edit removed (its range
 * deleted) is removed with its replies and the rest of their anchors, in the same undo step.
 * Only references the edit removed count: a comment without one from the start stays.
 */
export function commentsPlugin(): Plugin {
  return new Plugin({
    key,
    appendTransaction(transactions, oldState, newState) {
      const comments = wordContext(newState)?.envelope.comments;
      if (!comments?.length || !transactions.some(removesReference)) return null;
      const before = commentAnchors(oldState.doc);
      const after = commentAnchors(newState.doc);
      const gone = new Set<number>();
      for (const [id, anchors] of before)
        if (anchors.reference !== undefined && after.get(id)?.reference === undefined)
          for (const t of thread(comments, id)) gone.add(t);
      const present = [...gone].filter((id) => comments.some((c) => c.id === id));
      if (!present.length) return null;
      const tr = newState.tr.setMeta(untracked, true);
      removeComments(tr, comments, new Set(present));
      return tr;
    },
  });
}
