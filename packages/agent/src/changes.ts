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

/** @internal The body's tracked changes, in document order. */
export function listChanges(context: Context): { changes: ChangeInfo[]; text: string } {
  const { state } = context.editor;
  const all = trackedChanges(state.doc, wordContext(state)?.envelope.section);
  const changes = all.map((c): ChangeInfo => {
    const inline = c.kind === "insertion" || c.kind === "deletion";
    const text = inline ? state.doc.textBetween(c.from, c.to, " ", " ") : "";
    return {
      id: c.id,
      kind: c.kind,
      author: c.author,
      date: c.date,
      block: blockOf(context, c),
      text,
    };
  });
  const lines = changes.map(
    (c) =>
      `[c${c.id}] ${WORDS[c.kind]}, ${c.author || "someone"}${c.date ? ` (${c.date.slice(0, 10)})` : ""}${c.block ? `, in [${c.block}]` : ""}${c.text ? `: ${quote(c.text, 80)}` : ""}`,
  );
  return {
    changes,
    text: lines.length ? lines.join("\n") : "The document has no tracked changes.",
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
  options: ResolveOptions = {},
): Result<{ text: string }> {
  const { editor } = context;
  const verb = accept ? "accepted" : "rejected";
  if (ids === "all") {
    const author = options.author;
    if (author !== undefined && typeof author !== "string")
      return refuse("invalid", "author is the name of who made the changes, as the list shows it.");
    const done = editor.run((accept ? acceptAllChanges : rejectAllChanges)(author));
    return done
      ? { ok: true, text: `All changes${author ? ` by ${quote(author)}` : ""} ${verb}.` }
      : refuse(
          "no-match",
          `There are no changes${author ? ` by ${quote(author)}` : ""} to be ${verb}.`,
        );
  }
  if (!Array.isArray(ids) || !ids.length || !ids.every((id) => Number.isInteger(id)))
    return refuse(
      "invalid",
      'ids are the changes\' numbers, as the list shows them ([c12] is 12), or "all".',
    );
  const known = new Set(trackedChanges(editor.state.doc).map((c) => c.id));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length)
    return refuse(
      "unknown-handle",
      `There is no change ${missing.map((id) => `c${id}`).join(", ")}: list the changes for their numbers.`,
    );
  const before = editor.state.doc;
  const done = editor.run((accept ? acceptChangesById : rejectChangesById)(ids));
  if (!done || editor.state.doc === before)
    return refuse(
      "read-only",
      `The changes could not be ${verb} (in a locked content control, or a table Foli cannot change). Nothing was changed.`,
    );
  return {
    ok: true,
    text: `${verb[0]?.toUpperCase()}${verb.slice(1)} ${ids.map((id) => `c${id}`).join(", ")}.`,
  };
}
