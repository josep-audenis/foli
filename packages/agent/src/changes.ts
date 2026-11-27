/**
 * Review (23.8): the document's tracked changes listed for a model, and accepted or rejected by
 * their ids or all at once, as Word's Accept and Reject do. Only in a session opened with
 * `review`: an agent that edits as a tracked change does not, unasked, decide others' changes.
 */
import {
  acceptAllChanges,
  acceptChangesById,
  type Change,
  type ChangeKind,
  type Node,
  rejectAllChanges,
  rejectChangesById,
  trackedChanges,
} from "@folijs/core";
import { wordContext } from "@folijs/core/internal";
import { type Context, quote } from "./operations.js";
import { readBlocks } from "./read.js";
import { type Result, refuse } from "./result.js";

/** A tracked change as a model reads it. */
export interface ChangeInfo {
  /** Its id: what `acceptChanges` and `rejectChanges` take. */
  id: number;
  kind: ChangeKind;
  author: string;
  date: string | null;
  /** The handle of the block it is in (a table's for its rows and cells), when it has one. */
  block: string | null;
  /** The text it inserted or deleted, cut; empty for other kinds. */
  text: string;
}

const WORDS: Record<ChangeKind, string> = {
  insertion: "inserted",
  deletion: "deleted",
  formatting: "formatted text",
  paragraphInsertion: "split a paragraph",
  paragraphDeletion: "joined paragraphs",
  paragraphFormatting: "formatted a paragraph",
  sectionFormatting: "changed a section's setup",
  rowInsertion: "inserted a row",
  rowDeletion: "deleted a row",
  tableFormatting: "formatted a table",
};
const NODE_KINDS = new Set<ChangeKind>(["rowInsertion", "rowDeletion", "tableFormatting"]);

/** The block a change is in, by its handle. */
function blockOf(context: Context, change: Change): string | null {
  const { doc } = context.editor.state;
  const $pos = doc.resolve(
    Math.min(change.from + (NODE_KINDS.has(change.kind) ? 1 : 0), doc.content.size),
  );
  const wanted = (node: Node) =>
    NODE_KINDS.has(change.kind) ? node.type.name === "table" : node.isTextblock;
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (wanted(node)) return context.handles.at($pos.before(d), node);
  }
  return null;
}

/** The most changes one list shows; a longer list says how many more. */
const MOST = 300;

/** The body's tracked changes now, the last section's setup's included. */
const bodyChanges = (context: Context) => {
  const { state } = context.editor;
  return trackedChanges(state.doc, wordContext(state)?.envelope.section);
};

/** How many tracked changes the headers, footers, notes and text boxes hold. */
function storyCount(context: Context): number {
  let n = 0;
  for (const story of wordContext(context.editor.state)?.stories.values() ?? [])
    n += trackedChanges(story.doc).length;
  return n;
}

/** @internal The body's tracked changes, in document order. */
export function listChanges(context: Context): { changes: ChangeInfo[]; text: string } {
  const { state } = context.editor;
  // Handles in document order first: a list does not number blocks out of order.
  readBlocks(state, context.handles);
  const changes = bodyChanges(context).map((c): ChangeInfo => {
    const shown = c.kind === "insertion" || c.kind === "deletion" || c.kind === "formatting";
    const text = shown ? state.doc.textBetween(c.from, c.to, " ", " ") : "";
    return {
      id: c.id,
      kind: c.kind,
      author: c.author,
      date: c.date,
      block: blockOf(context, c),
      text,
    };
  });
  const lines = changes
    .slice(0, MOST)
    .map(
      (c) =>
        `[c${c.id}] ${WORDS[c.kind]}, ${c.author || "someone"}${c.date ? ` (${c.date.slice(0, 10)})` : ""}${c.block ? `, in [${c.block}]` : ""}${c.text ? `: ${quote(c.text, 80)}` : ""}`,
    );
  if (changes.length > MOST)
    lines.push(`(and ${changes.length - MOST} more: decide these first, or all at once)`);
  const elsewhere = storyCount(context);
  const stories = elsewhere
    ? `${elsewhere === 1 ? "1 change" : `${elsewhere} changes`} in headers, footers or notes, not listed: "all" decides them too.`
    : "";
  return {
    changes,
    text: [lines.length ? lines.join("\n") : "The body has no tracked changes.", stories]
      .filter(Boolean)
      .join("\n"),
  };
}

export interface ResolveOptions {
  /** With `all`: only this author's changes. */
  author?: string;
}

/** @internal Accepts or rejects changes by id, or all of them (every story too). */
export function resolveChanges(
  context: Context,
  ids: readonly number[] | "all",
  accept: boolean,
  options?: ResolveOptions | null,
): Result<{ text: string }> {
  const { editor } = context;
  const verb = accept ? "accepted" : "rejected";
  const author = options?.author;
  const count = () => bodyChanges(context).length + storyCount(context);
  if (ids === "all") {
    if (author !== undefined && (typeof author !== "string" || !author.trim()))
      return refuse("invalid", "author is the name of who made the changes, as the list shows it.");
    const before = count();
    if (!before) return refuse("no-match", "There are no tracked changes.");
    editor.run((accept ? acceptAllChanges : rejectAllChanges)(author));
    const left = count();
    const by = author ? ` by ${quote(author)}` : "";
    if (left === before)
      return refuse(
        "no-match",
        `No change${by} could be ${verb}: there are none${by}, or they are in a locked content control.`,
      );
    return {
      ok: true,
      text:
        left && !author
          ? `Changes ${verb}; ${left} could not be (in a locked content control): list them.`
          : `All changes${by} ${verb}.`,
    };
  }
  if (author !== undefined)
    return refuse("invalid", 'author goes with "all": by ids, the ids say which changes.');
  if (!Array.isArray(ids) || !ids.length || !ids.every((id) => Number.isInteger(id)))
    return refuse(
      "invalid",
      'ids are the changes\' numbers, as the list shows them ([c12] is 12), or "all".',
    );
  const wanted = [...new Set(ids)];
  const now = bodyChanges(context);
  const known = new Set(now.map((c) => c.id));
  const missing = wanted.filter((id) => !known.has(id));
  if (missing.length)
    return refuse(
      "unknown-handle",
      `There is no change ${missing.map((id) => `c${id}`).join(", ")}: list the changes for their numbers.`,
    );
  // A tracked move's other end goes with it.
  const moves = new Set(now.filter((c) => wanted.includes(c.id) && c.move).map((c) => c.move));
  const partners = [
    ...new Set(
      now.filter((c) => c.move && moves.has(c.move) && !wanted.includes(c.id)).map((c) => c.id),
    ),
  ];
  editor.run((accept ? acceptChangesById : rejectChangesById)(wanted));
  // What is left of them: a part in a locked content control, or a table Foli cannot change.
  const after = new Set(bodyChanges(context).map((c) => c.id));
  const stayed = [...wanted, ...partners].filter((id) => after.has(id));
  const done = [...wanted, ...partners].filter((id) => !after.has(id));
  const name = (list: number[]) => list.map((id) => `c${id}`).join(", ");
  if (!done.length)
    return refuse(
      "read-only",
      `The changes could not be ${verb} (in a locked content control, or a table Foli cannot change). Nothing was changed.`,
    );
  const moved = partners.length ? ` (with the other end of its move, ${name(partners)})` : "";
  return {
    ok: true,
    text: `${verb[0]?.toUpperCase()}${verb.slice(1)} ${name(done.filter((id) => wanted.includes(id)))}${moved}.${stayed.length ? ` ${name(stayed)} could not be, or not all of ${stayed.length === 1 ? "it" : "them"} (in a locked content control): still listed.` : ""}`,
  };
}
