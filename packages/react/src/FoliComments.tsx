import {
  type CommentJSON,
  commentAnchors,
  deleteComment,
  type Editor,
  type EditorState,
  editComment,
  replyToComment,
  resolveComment,
  wordContext,
} from "@folijs/core";
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { useEditorOrContext, useEditorState, useIsomorphicLayoutEffect } from "./editor.js";

export interface FoliCommentsProps {
  /** Default: the editor of the nearest `FoliEditorProvider`. */
  editor?: Editor | undefined;
  /** Comments can be read, not changed (pass it with a `readOnly` canvas). */
  readOnly?: boolean | undefined;
  /** Accessible name of the pane (default "Comments"). */
  label?: string | undefined;
  className?: string | undefined;
}

/** A comment and its replies, where its range starts in the document. */
interface Thread {
  comment: CommentJSON;
  replies: CommentJSON[];
  /** Where its range starts (or its reference is), for order and alignment. */
  pos: number;
  /** Where its range ends. */
  end: number;
}

const EMPTY: readonly CommentJSON[] = [];

/** The comments of the editor's document, as threads in document order. */
function threadsOf(state: EditorState, comments: readonly CommentJSON[]): Thread[] {
  const anchors = commentAnchors(state.doc);
  const byId = new Map(comments.map((c) => [c.id, c]));
  const rootOf = (c: CommentJSON) => {
    let root = c;
    const seen = new Set<number>();
    while (root.parent !== undefined && byId.has(root.parent) && !seen.has(root.id)) {
      seen.add(root.id);
      root = byId.get(root.parent) as CommentJSON;
    }
    return root;
  };
  const threads = new Map<number, Thread>();
  for (const c of comments) {
    const root = rootOf(c);
    let thread = threads.get(root.id);
    if (!thread) {
      const a = anchors.get(root.id);
      const pos = a?.start ?? a?.reference ?? Number.MAX_SAFE_INTEGER;
      thread = { comment: root, replies: [], pos, end: a?.end ?? a?.reference ?? pos };
      threads.set(root.id, thread);
    }
    if (c !== root) thread.replies.push(c);
  }
  return [...threads.values()].sort((a, b) => a.pos - b.pos || a.comment.id - b.comment.id);
}

/** A comment's text: its paragraphs' text, a line each. */
const textOf = (c: CommentJSON) =>
  c.content.map((p) => (p.content ?? []).map((n) => n.text ?? "").join("")).join("\n");

/**
 * Whether a comment's content is plain text (paragraphs of unformatted text), which the pane
 * edits as text without losing anything.
 */
const plain = (c: CommentJSON) =>
  c.content.every(
    (p) =>
      p.type === "paragraph" &&
      !p.attrs &&
      (p.content ?? []).every((n) => n.type === "text" && !n.marks?.length),
  );

const isEmpty = (c: CommentJSON) => textOf(c).trim() === "";

/** The nearest ancestor of the pane that holds the editor's pages. */
function pagesAround(pane: HTMLElement): HTMLElement | null {
  let element = pane.parentElement;
  while (element && !element.querySelector(".foli-page")) element = element.parentElement;
  return element;
}

const dateOf = (date: string | undefined) => (date ? date.slice(0, 10) : "");

/**
 * The comments pane: the document's comment threads beside the pages, each next to its text,
 * moved down when they would overlap. Focusing a thread marks its text in the document; a
 * caret in commented text marks its thread. Reply, edit (plain text), resolve, reopen and
 * delete; a new empty comment (the toolbar's "New comment") opens for writing. Render it beside
 * the pages (`FoliEditor` does): it finds the comments' text in the nearest ancestor holding them.
 */
export function FoliComments({
  editor: editorProp,
  readOnly = false,
  label = "Comments",
  className,
}: FoliCommentsProps) {
  const editor = useEditorOrContext(editorProp, "FoliComments");
  const comments = useEditorState((state) => wordContext(state)?.envelope.comments ?? EMPTY, {
    editor,
  });
  const doc = useEditorState((state) => state.doc, { editor });
  const head = useEditorState((state) => state.selection.head, { editor });
  const threads = threadsOf(editor.state, comments);
  const pane = useRef<HTMLElement>(null);
  const [tops, setTops] = useState<number[]>([]);
  const [writing, setWriting] = useState<{ id: number; reply: boolean } | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const opened = useRef(new Set<number>());

  // A new empty comment opens for writing (once).
  useEffect(() => {
    if (readOnly) return;
    const fresh = comments.find((c) => isEmpty(c) && !opened.current.has(c.id));
    if (fresh) {
      opened.current.add(fresh.id);
      setWriting({ id: fresh.id, reply: false });
    }
  }, [comments, readOnly]);

  // Each thread next to its text, pushed down below the one before.
  const measure = () => {
    const root = pane.current;
    const container = root && pagesAround(root);
    if (!root || !container) return;
    const paneTop = root.getBoundingClientRect().top;
    const items = [...root.querySelectorAll<HTMLElement>(":scope > .foli-comment-thread")];
    const next: number[] = [];
    let bottom = 0;
    threads.forEach((thread, i) => {
      const id = thread.comment.id;
      const anchor =
        container.querySelector<HTMLElement>(`[data-foli-comments~="${id}"]`) ??
        container.querySelector<HTMLElement>(`[data-foli-comment-reference="${id}"]`);
      const wanted = anchor ? anchor.getBoundingClientRect().top - paneTop : bottom;
      const top = Math.max(wanted, bottom);
      next.push(top);
      bottom = top + (items[i]?.offsetHeight ?? 0) + 8;
    });
    setTops((old) =>
      old.length === next.length && old.every((t, i) => Math.abs(t - (next[i] as number)) < 0.5)
        ? old
        : next,
    );
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: measured after every change of what it shows.
  useIsomorphicLayoutEffect(measure, [doc, comments, writing, threads.length]);
  useEffect(() => {
    const container = pane.current && pagesAround(pane.current);
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(container);
    return () => observer.disconnect();
  });

  // The focused thread's text marked in the document (again after the view redraws it).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `doc` changes mean redrawn text to mark.
  useEffect(() => {
    const container = pane.current && pagesAround(pane.current);
    if (!container || focused === null) return;
    const marked = [
      ...container.querySelectorAll<HTMLElement>(`[data-foli-comments~="${focused}"]`),
    ];
    for (const element of marked) element.classList.add("foli-comment-active");
    return () => {
      for (const element of marked) element.classList.remove("foli-comment-active");
    };
  }, [focused, doc]);

  const run = (command: Parameters<Editor["run"]>[0]) => editor.run(command);
  const minHeight = tops.length ? (tops[tops.length - 1] as number) + 160 : undefined;

  return (
    <aside
      ref={pane}
      className={`foli-comments${className ? ` ${className}` : ""}`}
      aria-label={label}
      style={minHeight ? { minHeight } : undefined}
    >
      {threads.length === 0 && <p className="foli-comments-empty">No comments</p>}
      {threads.map((thread, i) => {
        const { comment } = thread;
        const active = head >= thread.pos && head <= thread.end + 1;
        return (
          <article
            key={comment.id}
            className="foli-comment-thread"
            data-active={active || undefined}
            data-done={comment.done || undefined}
            style={{ top: tops[i] ?? 0 }}
            aria-label={`Comment by ${comment.author || "an unknown author"}${comment.done ? ", resolved" : ""}`}
            onFocus={() => setFocused(comment.id)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(null);
            }}
          >
            {[comment, ...thread.replies].map((c) => (
              <CommentView
                key={c.id}
                comment={c}
                root={c === comment}
                readOnly={readOnly}
                editing={writing?.id === c.id && !writing.reply}
                onEdit={() => setWriting({ id: c.id, reply: false })}
                onReply={() => setWriting({ id: comment.id, reply: true })}
                onResolve={() => run(resolveComment(comment.id, !comment.done))}
                onDelete={() => run(deleteComment(c.id))}
                onSave={(text) => {
                  run(editComment(c.id, text));
                  setWriting(null);
                }}
                onCancel={() => {
                  // A new comment left empty goes.
                  if (isEmpty(c)) run(deleteComment(c.id));
                  setWriting(null);
                }}
              />
            ))}
            {writing?.reply && writing.id === comment.id && (
              <CommentForm
                label="Reply"
                initial=""
                onSave={(text) => {
                  if (text.trim()) run(replyToComment(comment.id, text));
                  setWriting(null);
                }}
                onCancel={() => setWriting(null)}
              />
            )}
          </article>
        );
      })}
    </aside>
  );
}

function CommentView({
  comment,
  root,
  readOnly,
  editing,
  onEdit,
  onReply,
  onResolve,
  onDelete,
  onSave,
  onCancel,
}: {
  comment: CommentJSON;
  root: boolean;
  readOnly: boolean;
  editing: boolean;
  onEdit(): void;
  onReply(): void;
  onResolve(): void;
  onDelete(): void;
  onSave(text: string): void;
  onCancel(): void;
}) {
  const author = comment.author || "Unknown author";
  return (
    <div className="foli-comment">
      <p className="foli-comment-meta">
        <strong>{author}</strong> <span>{dateOf(comment.date)}</span>
      </p>
      {editing ? (
        <CommentForm
          label="Comment"
          initial={textOf(comment)}
          onSave={onSave}
          onCancel={onCancel}
        />
      ) : (
        <div className="foli-comment-text">
          {comment.content.map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs have no identity.
            <p key={i}>{(p.content ?? []).map((n) => n.text ?? "").join("")}</p>
          ))}
        </div>
      )}
      {!readOnly && !editing && (
        <div className="foli-comment-actions">
          {root && (
            <button type="button" onClick={onReply}>
              Reply
            </button>
          )}
          {plain(comment) && (
            <button type="button" onClick={onEdit}>
              Edit
            </button>
          )}
          {root && (
            <button type="button" onClick={onResolve}>
              {comment.done ? "Reopen" : "Resolve"}
            </button>
          )}
          <button type="button" onClick={onDelete}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function CommentForm({
  label,
  initial,
  onSave,
  onCancel,
}: {
  label: string;
  initial: string;
  onSave(text: string): void;
  onCancel(): void;
}) {
  const id = useId();
  const [text, setText] = useState(initial);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => field.current?.focus(), []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave(text);
  };
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSave(text);
    }
  };
  return (
    <form className="foli-comment-form" onSubmit={submit}>
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        ref={field}
        value={text}
        rows={3}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={keys}
      />
      <div className="foli-comment-actions">
        <button type="submit">Save</button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
