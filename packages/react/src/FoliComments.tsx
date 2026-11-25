import {
  type CommentJSON,
  type CommentMention,
  commentAnchors,
  commentMentions,
  deleteComment,
  type Editor,
  type EditorState,
  editComment,
  mentionText,
  type NodeJSON,
  replyToComment,
  resolveComment,
  trackState,
} from "@folijs/core";
import { wordContext } from "@folijs/core/internal";
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
  /** Not shown (still following the editor: a comment made meanwhile opens for writing). */
  hidden?: boolean | undefined;
  /**
   * Edit and delete only the editor's author's comments (`createEditor({ author })`, by name).
   * It hides the buttons, it does not guard the document: commands still change any comment.
   */
  onlyOwnComments?: boolean | undefined;
  /**
   * People a comment or reply can tag: typing `@` suggests them (by name or address), a pick
   * writes `@Name` linked to `mailto:` their address, as Word does. A list, or a function that
   * finds them for what follows the `@` (your directory; it may return a promise). Anyone may
   * be tagged, connected or not.
   */
  mentions?: MentionSource | undefined;
  /**
   * A comment or reply saved here tags people it did not tag before: tell them (send an email,
   * say). Called once per save with only the newly tagged. Comments made elsewhere (an agent, a
   * collab peer) do not call it: a server finds their tags with `commentMentions`.
   */
  onMention?: ((event: MentionEvent) => void) | undefined;
}

/** Who can be tagged: a list, or a function that finds them for a query. */
export type MentionSource =
  | readonly CommentMention[]
  | ((query: string) => readonly CommentMention[] | Promise<readonly CommentMention[]>);

export interface MentionEvent {
  /** The comment or reply as saved. */
  comment: CommentJSON;
  /** The people it tags that it did not before. */
  people: CommentMention[];
}

/** At most this many suggestions show. */
const SUGGESTIONS = 8;

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
  // No document scan per change when there is nothing to anchor (12.11).
  if (!comments.length) return [];
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

/** A paragraph's text as shown: tabs and line breaks kept. */
const paragraphText = (p: NodeJSON) =>
  (p.content ?? [])
    .map((n) =>
      n.type === "text"
        ? (n.text ?? "")
        : n.type === "tab"
          ? "\t"
          : n.type === "hardBreak"
            ? "\n"
            : "",
    )
    .join("");

/** A comment's text: its paragraphs' text, a line each. */
const textOf = (c: CommentJSON) => c.content.map(paragraphText).join("\n");

/**
 * Whether the pane edits a comment as text without losing anything: paragraphs of unformatted
 * text, all in one paragraph style or none (Word gives its comments the CommentText style).
 */
function plain(c: CommentJSON): boolean {
  const styles = new Set(c.content.map((p) => (p.attrs as { style?: unknown } | undefined)?.style));
  return (
    styles.size <= 1 &&
    c.content.every(
      (p) =>
        p.type === "paragraph" &&
        Object.keys(p.attrs ?? {}).every((key) => key === "style") &&
        (p.content ?? []).every(
          (n) =>
            n.type === "text" &&
            // A mention's link only: other marks on it would be lost when saved.
            (!n.marks?.length ||
              (n.marks.length === 1 && commentMentions({ content: [n] }).length > 0)),
        ),
    )
  );
}

/**
 * A line of text, `@Name` of each of `people` in it linked as their mention; of two people
 * with one name, the first in `people` (shortcut: by name, not by where each was picked; track
 * pick positions if two people of one name in one comment matter).
 */
function lineContent(line: string, people: readonly CommentMention[]): NodeJSON[] {
  // The longest name first: "@Ana Maria" is not "@Ana" and the rest.
  const names = [...people].sort((a, b) => b.name.length - a.name.length);
  const content: NodeJSON[] = [];
  let text = "";
  for (let i = 0; i < line.length; ) {
    const person =
      line[i] === "@"
        ? names.find(
            (p) =>
              p.name &&
              line.startsWith(`@${p.name}`, i) &&
              // The whole name: "@Anabel" is not "@Ana" and "bel".
              !/[\p{L}\p{N}]/u.test(line[i + p.name.length + 1] ?? ""),
          )
        : undefined;
    if (person) {
      if (text) content.push({ type: "text", text });
      text = "";
      content.push(mentionText(person));
      i += person.name.length + 1;
    } else text += line[i++];
  }
  if (text) content.push({ type: "text", text });
  return content;
}

/** `text` as `c`'s content: a paragraph per line, in `c`'s paragraph style, `people` tagged. */
function contentLike(c: CommentJSON, text: string, people: readonly CommentMention[] = []) {
  const style = (c.content[0]?.attrs as { style?: string } | undefined)?.style;
  return text.split(/\r\n|\r|\n/).map(
    (line): NodeJSON => ({
      type: "paragraph",
      ...(style ? { attrs: { style } } : {}),
      ...(line ? { content: lineContent(line, people) } : {}),
    }),
  );
}

/** Who `after` tags that `before` did not (by address). */
function newlyTagged(before: CommentJSON | undefined, after: CommentJSON): CommentMention[] {
  const old = new Set((before ? commentMentions(before) : []).map((p) => p.email.toLowerCase()));
  return commentMentions(after).filter((p) => !old.has(p.email.toLowerCase()));
}

const isEmpty = (c: CommentJSON) => textOf(c).trim() === "";

/** The nearest ancestor of the pane that holds the editor's pages. */
function pagesAround(pane: HTMLElement): HTMLElement | null {
  let element = pane.parentElement;
  while (element && !element.querySelector(".foli-page")) element = element.parentElement;
  return element;
}

const dateOf = (date: string | undefined) => (date ? date.slice(0, 10) : "");
const nameOf = (c: CommentJSON) => c.author || "an unknown author";

/**
 * The comments pane: the document's comment threads beside the pages, each next to its text,
 * moved down when they would overlap. Focusing a thread marks its text in the document; a
 * caret in commented text marks its thread. Reply, edit (plain text), resolve, reopen and
 * delete; a comment made empty while the pane shows (the toolbar's "New comment") opens for
 * writing, and goes when cancelled empty. Render it beside the pages (`FoliEditor` does): it
 * finds the comments' text in the nearest ancestor holding them.
 */
export function FoliComments({
  editor: editorProp,
  readOnly = false,
  label = "Comments",
  className,
  hidden = false,
  onlyOwnComments = false,
  mentions,
  onMention,
}: FoliCommentsProps) {
  const editor = useEditorOrContext(editorProp, "FoliComments");
  const comments = useEditorState((state) => wordContext(state)?.envelope.comments ?? EMPTY, {
    editor,
  });
  const documentId = useEditorState((state) => wordContext(state)?.id ?? "", { editor });
  const doc = useEditorState((state) => state.doc, { editor });
  const head = useEditorState((state) => state.selection.head, { editor });
  const me = useEditorState((state) => trackState(state)?.author, { editor });
  const own = (c: CommentJSON) => !onlyOwnComments || c.author === me;
  const all = threadsOf(editor.state, comments);
  /** Open threads, beside their text; the resolved ones are in their own list (the history). */
  const threads = all.filter((thread) => !thread.comment.done);
  const resolved = all.filter((thread) => thread.comment.done);
  const [showResolved, setShowResolved] = useState(false);
  const pane = useRef<HTMLElement>(null);
  const [tops, setTops] = useState<number[]>([]);
  const [height, setHeight] = useState(0);
  const [written, setWriting] = useState<{ id: number; reply: boolean; from?: number } | null>(
    null,
  );
  // A form open when the editor turns read-only goes: it could still save.
  const writing = readOnly ? null : written;
  const [focused, setFocused] = useState<number | null>(null);
  /** The comments the pane has seen, per document: only ones made later open for writing. */
  const known = useRef<{
    document: string;
    objects: WeakSet<CommentJSON>;
    ids: Set<number>;
  } | null>(null);
  /** The comments the pane opened for writing: cancelled while empty, they go. */
  const created = useRef(new Set<number>());
  /** After a change, the element to focus (the next thread, the button that opened a form). */
  const refocus = useRef<(() => void) | null>(null);

  useEffect(() => {
    const seen = known.current;
    const same = seen?.document === documentId;
    const objects = same ? seen.objects : new WeakSet<CommentJSON>();
    known.current = { document: documentId, objects, ids: new Set(comments.map((c) => c.id)) };
    // New: an id that was not there, and an object never seen (not one undo brought back).
    const fresh = same ? comments.find((c) => !seen.ids.has(c.id) && !objects.has(c)) : undefined;
    for (const c of comments) objects.add(c);
    // The first render, or another document: what is there was not made here, and nothing
    // open for writing belongs to it.
    if (!same) {
      if (seen) {
        created.current.clear();
        setWriting(null);
      }
      return;
    }
    // A comment that comes back (undo) is the very object seen before: not new.
    if (fresh && !readOnly && isEmpty(fresh) && plain(fresh)) {
      created.current.add(fresh.id);
      setWriting({ id: fresh.id, reply: false });
      setShowResolved(false);
    }
  }, [comments, documentId, readOnly]);

  // Each thread next to its text, pushed down below the one before. Nothing to place while
  // hidden or without threads: no query of the pages, no layout forced.
  const measure = () => {
    const root = pane.current;
    if (hidden || showResolved || !threads.length) return;
    const container = root && pagesAround(root);
    if (!root || !container) return;
    const paneTop = root.getBoundingClientRect().top;
    // The first text of each comment, in one pass.
    const anchors = new Map<string, HTMLElement>();
    for (const element of container.querySelectorAll<HTMLElement>(
      "[data-foli-comments], [data-foli-comment-reference]",
    )) {
      const ids = (element.dataset.foliComments ?? element.dataset.foliCommentReference ?? "")
        .split(" ")
        .filter(Boolean);
      for (const id of ids) if (!anchors.has(id)) anchors.set(id, element);
    }
    const items = [...root.querySelectorAll<HTMLElement>(":scope > .foli-comment-thread")];
    const next: number[] = [];
    const header = root.querySelector<HTMLElement>(":scope > .foli-comments-header");
    let bottom = header ? header.offsetHeight + 8 : 0;
    threads.forEach((thread, i) => {
      const anchor = anchors.get(String(thread.comment.id));
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
    setHeight(bottom);
  };
  const measureRef = useRef(measure);
  measureRef.current = measure;
  // biome-ignore lint/correctness/useExhaustiveDependencies: measured after every change of what it shows.
  useIsomorphicLayoutEffect(measure, [comments, writing, threads.length, hidden, showResolved]);
  // Typing moves the text: measured once a frame, not once a keystroke, and only with threads.
  const frame = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `doc` changes move the anchors.
  useEffect(() => {
    if (hidden || !threads.length || frame.current || typeof requestAnimationFrame === "undefined")
      return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      measureRef.current();
    });
  }, [doc]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const observer = useRef<ResizeObserver | null>(null);
  // After each render until the pages are there: a pane mounted before the canvas has none yet.
  useEffect(() => {
    if (hidden || observer.current || typeof ResizeObserver === "undefined") return;
    const container = pane.current && pagesAround(pane.current);
    if (!container) return;
    observer.current = new ResizeObserver(() => measureRef.current());
    observer.current.observe(container);
  });
  useEffect(
    () => () => {
      observer.current?.disconnect();
      observer.current = null;
    },
    [],
  );
  // Focus where the last action left it (after React drew the change).
  useEffect(() => {
    const focus = refocus.current;
    refocus.current = null;
    focus?.();
  });

  // A thread that left the list it was focused in (resolved, reopened, deleted) took the focus
  // with it, without a blur: its text is not marked.
  const marked = (showResolved ? resolved : threads).some((t) => t.comment.id === focused)
    ? focused
    : null;
  // Forgotten, so switching lists does not mark it again.
  useEffect(() => {
    if (marked === null && focused !== null) setFocused(null);
  }, [marked, focused]);
  // The focused thread's text marked in the document (again after the view redraws it).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `doc` changes mean redrawn text to mark.
  useEffect(() => {
    const container = pane.current && pagesAround(pane.current);
    if (!container || marked === null) return;
    for (const element of container.querySelectorAll<HTMLElement>(
      `[data-foli-comments~="${marked}"]`,
    ))
      element.classList.add("foli-comment-active");
    // Every element with the mark, not those marked: the page layout copies a paragraph split
    // across pages, mark included.
    return () => {
      for (const element of container.querySelectorAll<HTMLElement>(".foli-comment-active"))
        element.classList.remove("foli-comment-active");
    };
  }, [marked, doc]);

  const run = (command: Parameters<Editor["run"]>[0]) => editor.run(command);
  const commentsNow = () => wordContext(editor.state)?.envelope.comments ?? EMPTY;
  /** Tells `onMention` whom `saved` newly tags. */
  const tell = (before: CommentJSON | undefined, saved: CommentJSON | undefined) => {
    const people = saved ? newlyTagged(before, saved) : [];
    if (saved && people.length) onMention?.({ comment: saved, people });
  };
  /**
   * Focus the thread of `id` (comment `from`'s first button, else the thread's), else the pane,
   * else the document.
   */
  const focusThread = (id: number | undefined, from?: number) => {
    refocus.current = () => {
      const root = pane.current;
      const thread =
        id === undefined ? null : root?.querySelector<HTMLElement>(`[data-thread="${id}"]`);
      const document = root && pagesAround(root)?.querySelector<HTMLElement>('[role="textbox"]');
      (
        (from === undefined
          ? null
          : thread?.querySelector<HTMLElement>(`[data-comment="${from}"] button`)) ??
        thread?.querySelector<HTMLElement>("button") ??
        thread ??
        (root?.hidden ? document : root)
      )?.focus();
    };
  };

  /** A thread: beside its text (an open one), or in the list of resolved ones. */
  const threadView = (thread: Thread, i: number, list: readonly Thread[], beside: boolean) => {
    const { comment } = thread;
    const active = head >= thread.pos && head <= thread.end + 1;
    const after = list[i + 1] ?? list[i - 1];
    const canReply = !readOnly && editor.can(replyToComment(comment.id, "x"));
    return (
      <article
        key={comment.id}
        data-thread={comment.id}
        tabIndex={-1}
        className="foli-comment-thread"
        data-active={active || undefined}
        data-done={comment.done || undefined}
        style={beside ? { top: tops[i] ?? 0 } : undefined}
        aria-label={`Comment by ${nameOf(comment)}${comment.done ? ", resolved" : ""}`}
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
            canReply={canReply}
            canEdit={own(c) && plain(c)}
            canDelete={!readOnly && own(c) && editor.can(deleteComment(c.id))}
            editing={writing?.id === c.id && !writing.reply}
            onEdit={() => setWriting({ id: c.id, reply: false })}
            onReply={() => setWriting({ id: comment.id, reply: true, from: c.id })}
            onResolve={() => {
              run(resolveComment(comment.id, !comment.done));
              // It moves to the other list: the next thread of this one has the focus.
              focusThread(after?.comment.id);
            }}
            onDelete={() => {
              run(deleteComment(c.id));
              focusThread(c === comment ? after?.comment.id : comment.id);
            }}
            mentions={mentions}
            onSave={(text, picked) => {
              // The latest pick first: it wins over an earlier one of the same name.
              const people = [...picked].reverse().concat(commentMentions(c));
              if (!run(editComment(c.id, contentLike(c, text, people)))) return false;
              tell(
                c,
                commentsNow().find((saved) => saved.id === c.id),
              );
              created.current.delete(c.id);
              setWriting(null);
              focusThread(comment.id);
              return true;
            }}
            onCancel={() => {
              // A comment made here and left empty goes.
              const gone = created.current.has(c.id) && isEmpty(c);
              created.current.delete(c.id);
              if (gone) run(deleteComment(c.id));
              setWriting(null);
              focusThread(gone ? after?.comment.id : comment.id);
            }}
          />
        ))}
        {writing?.reply && writing.id === comment.id && (
          <CommentForm
            label="Reply"
            initial=""
            mentions={mentions}
            onSave={(text, picked) => {
              if (text.trim()) {
                const before = new Set(commentsNow().map((saved) => saved.id));
                const people = [...picked].reverse();
                if (!run(replyToComment(comment.id, contentLike(comment, text, people))))
                  return false;
                tell(
                  undefined,
                  commentsNow().find((saved) => !before.has(saved.id)),
                );
              }
              setWriting(null);
              focusThread(comment.id, writing.from);
              return true;
            }}
            onCancel={() => {
              setWriting(null);
              focusThread(comment.id, writing.from);
            }}
          />
        )}
      </article>
    );
  };

  return (
    <aside
      ref={pane}
      tabIndex={-1}
      className={`foli-comments${className ? ` ${className}` : ""}`}
      aria-label={label}
      hidden={hidden}
      style={height && !showResolved ? { minHeight: height } : undefined}
    >
      {(resolved.length > 0 || showResolved) && (
        <div className="foli-comments-header">
          <button type="button" aria-pressed={!showResolved} onClick={() => setShowResolved(false)}>
            Open ({threads.length})
          </button>
          <button type="button" aria-pressed={showResolved} onClick={() => setShowResolved(true)}>
            Resolved ({resolved.length})
          </button>
        </div>
      )}
      {showResolved ? (
        <div className="foli-comments-resolved">
          {resolved.length === 0 && <p className="foli-comments-empty">No resolved comments</p>}
          {resolved.map((thread, i) => threadView(thread, i, resolved, false))}
        </div>
      ) : (
        <>
          {threads.length === 0 && (
            <p className="foli-comments-empty">
              {resolved.length ? "No open comments" : "No comments"}
            </p>
          )}
          {threads.map((thread, i) => threadView(thread, i, threads, true))}
        </>
      )}
    </aside>
  );
}

function CommentView({
  comment,
  root,
  readOnly,
  canReply,
  canEdit,
  canDelete,
  editing,
  onEdit,
  onReply,
  onResolve,
  onDelete,
  onSave,
  onCancel,
  mentions,
}: {
  comment: CommentJSON;
  root: boolean;
  readOnly: boolean;
  canReply: boolean;
  canEdit: boolean;
  canDelete: boolean;
  editing: boolean;
  onEdit(): void;
  onReply(): void;
  onResolve(): void;
  onDelete(): void;
  onSave(text: string, picked: readonly CommentMention[]): boolean;
  onCancel(): void;
  mentions: MentionSource | undefined;
}) {
  const author = comment.author || "Unknown author";
  const what = root ? "comment" : "reply";
  return (
    <div className="foli-comment" data-comment={comment.id}>
      <p className="foli-comment-meta">
        <strong>{author}</strong> <span>{dateOf(comment.date)}</span>
      </p>
      {editing ? (
        <CommentForm
          label="Comment"
          initial={textOf(comment)}
          onSave={onSave}
          onCancel={onCancel}
          mentions={mentions}
        />
      ) : (
        <div className="foli-comment-text">
          {comment.content.map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs have no identity.
            <p key={i}>
              {(p.content ?? []).map((n, j) =>
                commentMentions({ content: [n] }).length ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: runs have no identity.
                  <span key={j} className="foli-comment-mention">
                    {n.text}
                  </span>
                ) : (
                  paragraphText({ type: "paragraph", content: [n] })
                ),
              )}
            </p>
          ))}
        </div>
      )}
      {!readOnly && !editing && (
        <div className="foli-comment-actions">
          {/* A reply to a reply goes at the end of the thread, as Word keeps them. */}
          {canReply && (
            <button
              type="button"
              onClick={onReply}
              aria-label={root ? undefined : `Reply to ${nameOf(comment)}`}
            >
              Reply
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={onEdit}
              aria-label={`Edit ${what} by ${nameOf(comment)}`}
            >
              Edit
            </button>
          )}
          {root && (
            <button type="button" onClick={onResolve}>
              {comment.done ? "Reopen" : "Resolve"}
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={onDelete}
              aria-label={`Delete ${what} by ${nameOf(comment)}`}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The `@query` being typed before the caret (no space in it), or null. */
function mentionQuery(text: string, caret: number): { from: number; query: string } | null {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
  return match
    ? { from: caret - (match[1] as string).length - 1, query: match[1] as string }
    : null;
}

/** The people of a list that match `query` (in their name or address). */
const matching = (people: readonly CommentMention[], query: string) => {
  const q = query.toLowerCase();
  return people.filter(
    (p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q),
  );
};

function CommentForm({
  label,
  initial,
  onSave,
  onCancel,
  mentions,
}: {
  label: string;
  initial: string;
  /** False when it could not be saved: the form stays open. */
  onSave(text: string, picked: readonly CommentMention[]): boolean;
  onCancel(): void;
  mentions?: MentionSource | undefined;
}) {
  const id = useId();
  const [text, setText] = useState(initial);
  const [failed, setFailed] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  /** The people picked here: their `@Name` is linked when saved. */
  const picked = useRef<CommentMention[]>([]);
  const [query, setQuery] = useState<{ from: number; query: string } | null>(null);
  const [found, setFound] = useState<readonly CommentMention[]>([]);
  const [active, setActive] = useState(0);
  useEffect(() => field.current?.focus(), []);
  // The people for the query: at once from a list, else when the function answers (the last
  // query's answer only).
  // Read when the query changes: an inline list or function does not search again per render.
  const source = useRef(mentions);
  source.current = mentions;
  const typed = query?.query;
  useEffect(() => {
    const mentions = source.current;
    // A new query: the last one's people go until this one's answer comes.
    setFound([]);
    if (!mentions || typed === undefined) return;
    let current = true;
    const show = (people: readonly CommentMention[]) => {
      if (!current) return;
      setFound(people.slice(0, SUGGESTIONS));
      setActive(0);
    };
    if (typeof mentions !== "function") show(matching(mentions, typed));
    else Promise.resolve(mentions(typed)).then(show, () => show([]));
    return () => {
      current = false;
    };
  }, [typed]);
  const open = !!query && found.length > 0;
  const follow = (element: HTMLTextAreaElement) =>
    setQuery(mentions ? mentionQuery(element.value, element.selectionStart) : null);
  const pick = (person: CommentMention) => {
    const element = field.current;
    if (!element || !query) return;
    const caret = element.selectionStart;
    const written = `@${person.name} `;
    const next = text.slice(0, query.from) + written + text.slice(caret);
    picked.current.push(person);
    setText(next);
    setQuery(null);
    const at = query.from + written.length;
    globalThis.requestAnimationFrame?.(() => {
      element.focus();
      element.setSelectionRange(at, at);
    });
  };
  const save = () => setFailed(!onSave(text, picked.current));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save();
  };
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + found.length) % found.length);
    } else if (
      open &&
      (e.key === "Enter" || e.key === "Tab") &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.shiftKey
    ) {
      e.preventDefault();
      pick(found[active] as CommentMention);
    } else if (e.key === "Escape") {
      e.preventDefault();
      // The suggestions close first, then the form.
      if (open) setQuery(null);
      else onCancel();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    }
  };
  const listId = `${id}-people`;
  return (
    <form className="foli-comment-form" onSubmit={submit}>
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        ref={field}
        value={text}
        rows={3}
        onChange={(e) => {
          setText(e.target.value);
          follow(e.target);
        }}
        // The caret moved (not by the keys the suggestions take, after which it is set).
        onKeyUp={(e) => {
          if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key))
            follow(e.currentTarget);
        }}
        onClick={(e) => follow(e.currentTarget)}
        onKeyDown={keys}
        onBlur={() => setQuery(null)}
        aria-autocomplete={mentions ? "list" : undefined}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-invalid={failed || undefined}
        aria-describedby={failed ? `${id}-error` : undefined}
      />
      {open && (
        <div id={listId} className="foli-comment-people" role="listbox" aria-label="People">
          {found.map((person, i) => (
            <div
              key={person.email}
              id={`${listId}-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              // Before the field's blur: the pick needs the caret where it was.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(person);
              }}
            >
              <strong>{person.name}</strong> <span>{person.email}</span>
            </div>
          ))}
        </div>
      )}
      {failed && (
        <p id={`${id}-error`} className="foli-comment-error" role="alert">
          Could not be saved here.
        </p>
      )}
      <div className="foli-comment-actions">
        <button type="submit">Save</button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
