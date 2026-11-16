/**
 * Accepting and rejecting tracked changes (9.4), as Word does. A change is a run of content with
 * one `insertion`, `deletion` or `formatChange` mark, a paragraph mark inserted or deleted
 * (`revision`), or a paragraph's recorded formatting (`formatChange`). Accepting an insertion or
 * a formatting change drops its record; accepting a deletion removes the content (a deleted
 * paragraph mark joins the paragraph with the next, keeping the first one's properties, as an
 * untracked join). Rejecting does the reverse: inserted content goes (an inserted paragraph mark
 * joins the paragraph with the next, which keeps its own properties: the original mark's), a
 * deletion's record is dropped, recorded formatting comes back. Both ends of a tracked move go
 * together. These edits are not tracked themselves, and undo takes them back.
 */
import type { Attrs, Mark, Node } from "../model/index.js";
import { RUN_PROPERTY_MARKS } from "../v3/schema.js";
import { MARK_ATTRS } from "./mark.js";
import { TextSelection } from "./selection.js";
import type { Command, EditorState, Transaction } from "./state.js";
import { RECORDED, untracked } from "./track.js";

export type ChangeKind =
  | "insertion"
  | "deletion"
  | "formatting"
  | "paragraphInsertion"
  | "paragraphDeletion"
  | "paragraphFormatting";

/** One tracked change of the document, where it is. */
export interface Change {
  readonly kind: ChangeKind;
  readonly id: number;
  readonly author: string;
  readonly date: string | null;
  /** The content it covers; for a paragraph mark, the paragraph's closing token. */
  readonly from: number;
  readonly to: number;
  /** A tracked move's name, shared by both ends (`w:moveFrom`, `w:moveTo`). */
  readonly move: string | null;
}

export interface ChangeFilter {
  /** Only this author's changes. */
  author?: string;
}

const MARK_KINDS: Record<string, ChangeKind> = {
  insertion: "insertion",
  deletion: "deletion",
  formatChange: "formatting",
};
const RUN_MARKS = new Set<string>(RUN_PROPERTY_MARKS);

interface Revision {
  id: number;
  author: string;
  date?: string | null;
}

/** Every tracked change of `doc`, in document order. */
export function trackedChanges(doc: Node): Change[] {
  const changes: Change[] = [];
  const flush = (run: { mark: Mark; from: number; to: number }) => {
    const attrs = run.mark.attrs;
    changes.push({
      kind: MARK_KINDS[run.mark.type.name] as ChangeKind,
      id: attrs.id as number,
      author: attrs.author as string,
      date: (attrs.date as string | null) ?? null,
      from: run.from,
      to: run.to,
      move: (attrs.move as string | null | undefined) ?? null,
    });
  };
  doc.forEach((block, offset) => {
    if (!block.isTextblock) return;
    const change = block.attrs.formatChange as Revision | null;
    if (change) changes.push(paragraphChange("paragraphFormatting", change, offset, block));
    // Runs of content with the same change mark, extended while the next node has it too.
    let open: { mark: Mark; from: number; to: number }[] = [];
    block.forEach((inline, at) => {
      const pos = offset + 1 + at;
      const next: typeof open = [];
      for (const mark of inline.marks) {
        if (!MARK_KINDS[mark.type.name]) continue;
        const run = open.find((r) => r.to === pos && r.mark.eq(mark));
        if (run) run.to = pos + inline.nodeSize;
        next.push(run ?? { mark, from: pos, to: pos + inline.nodeSize });
      }
      for (const run of open) if (!next.includes(run)) flush(run);
      open = next;
    });
    for (const run of open) flush(run);
    const revision = block.attrs.revision as { insertion?: Revision; deletion?: Revision } | null;
    if (revision?.insertion)
      changes.push(paragraphChange("paragraphInsertion", revision.insertion, offset, block));
    if (revision?.deletion)
      changes.push(paragraphChange("paragraphDeletion", revision.deletion, offset, block));
  });
  return changes.sort((a, b) => a.from - b.from || a.to - b.to);
}

/** A paragraph's change: its mark (the closing token), or its content for its formatting. */
function paragraphChange(
  kind: ChangeKind,
  revision: Revision,
  offset: number,
  block: Node,
): Change {
  const end = offset + block.nodeSize;
  return {
    kind,
    id: revision.id,
    author: revision.author,
    date: revision.date ?? null,
    from: kind === "paragraphFormatting" ? offset + 1 : end - 1,
    to: kind === "paragraphFormatting" ? end - 1 : end,
    move: null,
  };
}
const INLINE: ReadonlySet<ChangeKind> = new Set(["insertion", "deletion", "formatting"]);
/** Inline nodes no change marks: they stay when the text around them goes. */
const MARKERS = new Set(["bookmarkStart", "bookmarkEnd", "commentStart", "commentEnd"]);

/**
 * The changes `from..to` touches, with their moves' other ends. At a caret: the ones around it,
 * the paragraph's formatting only when nothing else is. In a selection, changes to content only
 * as far as the selection goes (Word accepts the selected part).
 */
function changesIn(doc: Node, from: number, to: number, filter: ChangeFilter = {}): Change[] {
  const all = trackedChanges(doc).filter((c) => !filter.author || c.author === filter.author);
  let picked: Change[];
  if (from === to) {
    const around = all.filter((c) => c.from <= from && from <= c.to);
    const own = around.filter((c) => c.kind !== "paragraphFormatting");
    picked = own.length ? own : around;
  } else
    picked = all
      .filter((c) => c.from < to && from < c.to)
      .map((c) =>
        INLINE.has(c.kind) ? { ...c, from: Math.max(c.from, from), to: Math.min(c.to, to) } : c,
      );
  const moves = new Set(picked.map((c) => c.move).filter((m) => m !== null));
  const partners = all.filter(
    (c) =>
      c.move !== null &&
      moves.has(c.move) &&
      !picked.some((p) => p.id === c.id && p.kind === c.kind),
  );
  return [...picked, ...partners];
}

/** Applies accepting (or rejecting) `changes` to `tr`. */
function resolve(tr: Transaction, changes: readonly Change[], accept: boolean): void {
  const schema = tr.doc.type.schema;
  const removed: [number, number][] = [];
  const joins: { pos: number; keepFirst: boolean }[] = [];
  for (const change of changes) {
    const { kind, from, to } = change;
    const markType = schema.marks[kind === "formatting" ? "formatChange" : kind];
    switch (kind) {
      case "insertion":
      case "deletion": {
        if (!markType) break;
        if ((kind === "insertion") === accept) removeMarkOf(tr, from, to, markType.name, change.id);
        else removed.push([from, to]);
        break;
      }
      case "formatting": {
        tr.doc.nodesBetween(from, to, (node, pos) => {
          if (!node.isInline) return true;
          const record = node.marks.find((m) => m.type.name === "formatChange");
          if (!record || record.attrs.id !== change.id) return false;
          const s = Math.max(pos, from);
          const e = Math.min(pos + node.nodeSize, to);
          if (!accept) {
            for (const mark of node.marks)
              if (RUN_MARKS.has(mark.type.name)) tr.removeMark(s, e, mark);
            for (const json of record.attrs.previous as { type: string; attrs?: Attrs }[])
              tr.addMark(s, e, schema.mark(json.type, json.attrs ?? null));
          }
          tr.removeMark(s, e, record);
          return false;
        });
        break;
      }
      case "paragraphFormatting": {
        const start = tr.doc.resolve(from).before();
        const node = tr.doc.nodeAt(start);
        if (!node?.isTextblock) break;
        const attrs: Attrs = { ...node.attrs, formatChange: null };
        if (!accept) {
          const previous = (node.attrs.formatChange as { previous: Attrs }).previous;
          for (const key of RECORDED)
            (attrs as Record<string, unknown>)[key] = previous[key] ?? null;
        }
        tr.setNodeMarkup(start, node.type, attrs);
        break;
      }
      case "paragraphInsertion":
      case "paragraphDeletion": {
        const start = tr.doc.resolve(from).before();
        const node = tr.doc.nodeAt(start);
        if (!node?.isTextblock) break;
        const revision = { ...(node.attrs.revision as Record<string, unknown>) };
        const goes = (kind === "paragraphDeletion") === accept;
        delete revision[kind === "paragraphInsertion" ? "insertion" : "deletion"];
        const next = Object.keys(revision).length ? revision : null;
        tr.setNodeMarkup(start, node.type, { ...node.attrs, revision: next });
        // The mark goes: the paragraph joins the next one, when there is one to join.
        const end = start + node.nodeSize;
        // A paragraph whose text goes too is removed whole: the next one stays as it is.
        const emptied = covered(node, start + 1, removed);
        if (goes && tr.doc.resolve(end).nodeAfter?.isTextblock)
          joins.push({ pos: end, keepFirst: accept && !emptied });
        break;
      }
    }
  }
  // Content removed and paragraphs joined, from the end so earlier positions stay.
  const ops = [
    ...removed.map(([s, e]) => ({ at: s, run: () => tr.delete(s, e) })),
    ...joins.map(({ pos, keepFirst }) => ({ at: pos - 1, run: () => join(tr, pos, keepFirst) })),
  ].sort((a, b) => b.at - a.at);
  for (const op of ops) op.run();
}

/** Whether every child of `node` (content at `start`) but markers lies in `removed`. */
function covered(node: Node, start: number, removed: readonly [number, number][]): boolean {
  let all = true;
  node.forEach((child, offset) => {
    const pos = start + offset;
    if (MARKERS.has(child.type.name)) return;
    if (!removed.some(([s, e]) => s <= pos && pos + child.nodeSize <= e)) all = false;
  });
  return all;
}

/** Removes `type`'s mark with `id` from `from..to`. */
function removeMarkOf(tr: Transaction, from: number, to: number, type: string, id: number): void {
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline) return true;
    const mark = node.marks.find((m) => m.type.name === type && m.attrs.id === id);
    if (mark) tr.removeMark(Math.max(pos, from), Math.min(pos + node.nodeSize, to), mark);
    return false;
  });
}

/**
 * Joins the paragraph ending at `pos` with the next one. Accepting a deleted mark keeps the first
 * one's properties and the last one's mark (as an untracked join), unless the first one is left
 * with nothing (then it is gone); rejecting an inserted mark keeps the last one whole: its mark
 * is the original's.
 */
function join(tr: Transaction, pos: number, keepFirst: boolean): void {
  const $pos = tr.doc.resolve(pos);
  const first = $pos.nodeBefore;
  const last = $pos.nodeAfter;
  if (!first?.isTextblock || !last?.isTextblock) return;
  const start = pos - first.nodeSize;
  tr.join(pos);
  const attrs: Attrs = keepFirst ? { ...first.attrs } : { ...last.attrs };
  if (keepFirst)
    for (const key of MARK_ATTRS) (attrs as Record<string, unknown>)[key] = last.attrs[key] ?? null;
  tr.setNodeMarkup(start, first.type, attrs);
}

function command(
  accept: boolean,
  range: (state: EditorState) => [number, number] | null,
  filter?: ChangeFilter,
): Command {
  return (state, dispatch) => {
    if (!state.schema.marks.insertion) return false;
    const r = range(state);
    if (!r) return false;
    const changes = changesIn(state.doc, r[0], r[1], filter);
    if (!changes.length) return false;
    if (dispatch) {
      const tr = state.tr.setMeta(untracked, true);
      resolve(tr, changes, accept);
      dispatch(tr);
    }
    return true;
  };
}

const selected = (state: EditorState): [number, number] => [
  state.selection.from,
  state.selection.to,
];
const everything = (state: EditorState): [number, number] => [0, state.doc.content.size];

/** Accepts the change at the caret, or the changes in the selection. */
export const acceptChange: Command = command(true, selected);
/** Rejects the change at the caret, or the changes in the selection. */
export const rejectChange: Command = command(false, selected);
/** Accepts every change (of `author`, if given). */
export const acceptAllChanges = (author?: string): Command =>
  command(true, everything, author === undefined ? {} : { author });
/** Rejects every change (of `author`, if given). */
export const rejectAllChanges = (author?: string): Command =>
  command(false, everything, author === undefined ? {} : { author });

/** Selects the next (or previous) change after (before) the selection. */
function goTo(forward: boolean): Command {
  return (state, dispatch) => {
    const changes = trackedChanges(state.doc);
    const { from, to } = state.selection;
    // In document order (by start, then end), the first one after (before) the selection.
    const target = forward
      ? changes.find((c) => c.from > from || (c.from === from && c.to > to))
      : [...changes].reverse().find((c) => c.from < from || (c.from === from && c.to < to));
    if (!target) return false;
    if (dispatch) {
      // A paragraph mark: the caret at the end of its paragraph.
      const mark = target.kind === "paragraphInsertion" || target.kind === "paragraphDeletion";
      const head = mark ? target.from : target.to;
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, target.from, head)));
    }
    return true;
  };
}

export const nextChange: Command = goTo(true);
export const previousChange: Command = goTo(false);
