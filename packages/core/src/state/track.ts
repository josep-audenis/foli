/**
 * Tracked changes (9.2): with tracking on, an edit is recorded as Word records it. Text and
 * breaks an edit removes stay in the document with a `deletion` mark; what it adds gets an
 * `insertion` mark; a paragraph mark it removes or adds is recorded on the paragraph
 * (`revision`). Deleting one's own insertion removes it for real, as Word does.
 *
 * Commands do not know about tracking: the editor rebuilds each transaction it dispatches from
 * what the transaction changed (`trackTransaction`). The ranges its steps replaced are compared
 * before and after; each becomes a tracked deletion of the old content followed by a tracked
 * insertion of the new, and the steps that move nothing (marks, attributes, comments) are
 * replayed on top. Undo and redo, transactions kept out of history and those with the
 * `untracked` meta (accepting and rejecting changes) are not tracked.
 */

import { deepEqual } from "../model/attrs.js";
import {
  type Attrs,
  Fragment,
  type Mark,
  type MarkType,
  type Node,
  Slice,
} from "../model/index.js";
import { type Mappable, Mapping, type MapResult } from "../transform/stepmap.js";
import {
  AddMarkStep,
  NodeMarkupBatchStep,
  NodeMarkupStep,
  RemoveMarkStep,
  type Step,
} from "../transform/steps.js";
import { TransformError } from "../transform/transform.js";
import type { CommentJSON, SectionJSON } from "../v3/document.js";
import { PARAGRAPH_PROPERTY_KEYS, RUN_PROPERTY_MARKS } from "../v3/schema.js";
import { MARK_ATTRS } from "./mark.js";
import { NodeSelection, Selection, TextSelection } from "./selection.js";
import { type Command, type EditorState, Plugin, PluginKey, type Transaction } from "./state.js";
import { otherTrees, wordContext } from "./word.js";

/**
 * How tracked changes show: `markup` (inserted text underlined and deleted text struck through,
 * in the author's color, with a bar beside changed paragraphs), `simple` (as if accepted, with
 * the bar), `final` (as if accepted).
 */
export type ReviewView = "markup" | "simple" | "final";

export interface TrackState {
  /** Whether edits are recorded as tracked changes. */
  readonly on: boolean;
  /** Who makes them. */
  readonly author: string;
  /** How changes show in a view of the editor (default `markup`). */
  readonly view?: ReviewView;
}

const key = new PluginKey<TrackState>("track");

/** Set this meta (true) on a transaction to keep it out of tracking. */
export const untracked = "untracked";

/** On a rebuilt transaction: the ranges it records as deleted, as `[from, to]` of the document before. */
export const trackedDeletes = "trackedDeletes";

/** Inline nodes a tracked change does not mark: they stand between runs in Word. */
const MARKERS = new Set([
  "bookmarkStart",
  "bookmarkEnd",
  "commentStart",
  "commentEnd",
  "controlStart",
  "controlEnd",
]);

const RUN_MARKS = new Set<string>(RUN_PROPERTY_MARKS);
/**
 * Paragraph properties a formatting change does not record: the paragraph mark's look (Word
 * records it on the mark) and the verbatim XML.
 */
const UNRECORDED = new Set(["markFormat", "ext"]);

/** @internal Paragraph properties a formatting change records (`previous`). */
export const RECORDED = PARAGRAPH_PROPERTY_KEYS.filter((k) => !UNRECORDED.has(k));
/** A paragraph's recorded properties (a formatting change's `previous`): those it has. */
const propertiesOf = (attrs: Attrs) =>
  Object.fromEntries(RECORDED.filter((k) => attrs[k] != null).map((k) => [k, attrs[k]]));
const sameProperties = (a: Attrs, b: Attrs) =>
  RECORDED.every((k) => deepEqual(a[k] ?? null, b[k] ?? null));

/** A tracked change's author and date, as the schema keeps them (`w:id`, `w:author`, `w:date`). */
interface Revision {
  id: number;
  author: string;
  date: string;
}
interface ParagraphRevision {
  insertion?: Revision;
  deletion?: Revision;
}

export function trackPlugin(state: TrackState): Plugin<TrackState> {
  return new Plugin({
    key,
    state: {
      init: () => state,
      apply: (tr, value) => (tr.getMeta(key) as TrackState | undefined) ?? value,
    },
  });
}

/** Whether `state` records edits as tracked changes, and in whose name. */
export function trackState(state: EditorState): TrackState | null {
  return key.getState(state) ?? null;
}

/** Makes `tr` set the tracking state (a story's editor passes its change to the body). */
export const withTrackState = (tr: Transaction, state: TrackState): Transaction =>
  tr.setMeta(key, state);

/** Turns tracking on or off (and sets the author). Applies only to a schema v3 editor. */
export function setTrackChanges(on: boolean, author?: string): Command {
  return (state, dispatch) => {
    const current = key.getState(state);
    if (!current || !state.schema.marks.insertion) return false;
    dispatch?.(state.tr.setMeta(key, { ...current, on, author: author ?? current.author }));
    return true;
  };
}

/** Shows tracked changes as `view` in the editor's views. Applies only to a schema v3 editor. */
export function setReviewView(view: ReviewView): Command {
  return (state, dispatch) => {
    const current = key.getState(state);
    if (!current || !state.schema.marks.insertion) return false;
    dispatch?.(state.tr.setMeta(key, { ...current, view }));
    return true;
  };
}

/** @internal Word's date: UTC, to the second. */
export function now(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

const REVIEW_MARKS = new Set(["insertion", "deletion", "formatChange"]);

/**
 * The largest change id in the document's trees (the body and every story: ids are allocated
 * across them), the comments' content (marks, paragraph revisions) and the sections' tracked
 * setups, or -1.
 */
function maxRevisionId(state: EditorState): number {
  const envelope = wordContext(state)?.envelope;
  const comments: readonly CommentJSON[] = envelope?.comments ?? [];
  const last: SectionJSON | undefined = envelope?.section;
  let max = -1;
  const see = (value: unknown) => {
    const id = (value as { id?: unknown } | null | undefined)?.id;
    if (typeof id === "number" && id > max) max = id;
  };
  see(last?.change);
  for (const doc of [state.doc, ...otherTrees(state)])
    doc.descendants((node) => {
      for (const mark of node.marks) {
        const name = mark.type.name;
        if (REVIEW_MARKS.has(name)) see(mark.attrs);
      }
      if (node.isTextblock) {
        const revision = node.attrs.revision as ParagraphRevision | null | undefined;
        see(revision?.insertion);
        see(revision?.deletion);
        see(node.attrs.formatChange);
        see((node.attrs.section as SectionJSON | null | undefined)?.change);
      }
      return true;
    });
  // Comments hold paragraphs too, which can carry changes (JSON: walked as it is).
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      const json = value as Record<string, unknown>;
      if (REVIEW_MARKS.has(json.type as string)) see(json.attrs);
      if (json.type === "paragraph") see((json.attrs as { formatChange?: unknown })?.formatChange);
      const revision = json.revision as ParagraphRevision | null | undefined;
      if (revision && typeof revision === "object") {
        see(revision.insertion);
        see(revision.deletion);
      }
      Object.values(json).forEach(walk);
    }
  };
  walk(comments.map((c) => c.content));
  return max;
}

/** @internal A new tracked change's id, author and date, when `state` is tracking; else null. */
export function newRevision(state: EditorState): Revision | null {
  const track = key.getState(state);
  if (!track?.on) return null;
  return { id: nextRevisionId(state), author: track.author, date: now() };
}

/** @internal The id after every change of the document, in all its trees. */
export function nextRevisionId(state: EditorState): number {
  return maxRevisionId(state) + 1;
}

/** A replaced range: `a..b` before the transaction, `c..d` after it. */
interface Range {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** The ranges `tr`'s steps replaced, merged where they touch, in document order. */
function changedRanges(tr: Transaction): Range[] {
  const maps = tr.mapping.maps;
  const ranges: Range[] = [];
  maps.forEach((map, k) => {
    if (!map.ranges.length) return;
    const back = new Mapping(
      maps
        .slice(0, k)
        .map((m) => m.invert())
        .reverse(),
    );
    const forward = tr.mapping.slice(k + 1);
    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      const a = back.map(oldStart, -1);
      const c = forward.map(newStart, -1);
      ranges.push({
        a,
        b: Math.max(a, back.map(oldEnd, 1)),
        c,
        d: Math.max(c, forward.map(newEnd, 1)),
      });
    });
  });
  ranges.sort((x, y) => x.a - y.a);
  const merged: Range[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.a <= last.b) {
      last.b = Math.max(last.b, r.b);
      last.c = Math.min(last.c, r.c);
      last.d = Math.max(last.d, r.d);
    } else merged.push({ ...r });
  }
  return merged;
}

/** A position in the rebuilt transaction's document after its first `step` steps. */
interface At {
  pos: number;
  step: number;
}

/**
 * `tr` rebuilt as tracked changes when `state` tracks them (`tr` itself otherwise), or null when
 * it cannot be recorded (the edit is then not made: nothing is changed untracked).
 */
export function trackTransaction(state: EditorState, tr: Transaction): Transaction | null {
  const track = key.getState(state);
  const { insertion, deletion } = state.schema.marks;
  if (
    !track?.on ||
    !insertion ||
    !deletion ||
    !tr.docChanged ||
    tr.getMeta(untracked) ||
    tr.getMeta("historyOp") ||
    !tr.addToHistory
  )
    return tr;
  try {
    return rebuild(state, tr, track.author, insertion, deletion);
  } catch (error) {
    if (error instanceof TransformError) return null;
    throw error;
  }
}

function rebuild(
  state: EditorState,
  tr: Transaction,
  author: string,
  insertion: MarkType,
  deletion: MarkType,
): Transaction {
  const out = state.tr.copyMeta(tr);
  out.setMeta(
    trackedDeletes,
    changedRanges(tr)
      .filter((r) => r.b > r.a)
      .map((r) => [r.a, r.b]),
  );
  const date = now();
  let nextId = -1;
  const newId = () => {
    if (nextId < 0) nextId = maxRevisionId(state) + 1;
    return nextId++;
  };
  const at = (x: At, assoc: number) => out.mapping.slice(x.step).map(x.pos, assoc);
  const here = (pos: number): At => ({ pos, step: out.steps.length });
  const pending: { at: At; kind: "insertion" | "deletion"; revision: Revision }[] = [];
  /** Paragraphs whose mark `tr` removed and the rebuilt document keeps (deleted). */
  const apart: At[] = [];
  /** Paragraphs joined for real (one's own inserted mark removed). */
  const rejoined: At[] = [];
  /** Paragraphs that keep a mark with another paragraph's properties, and that paragraph. */
  const formats: { at: At; host: Node }[] = [];

  /** The mark of `type` by `author` next to `from..to`, to extend instead of starting a change. */
  const adjacent = (type: MarkType, from: number, to: number): Mark | undefined => {
    const doc = out.doc;
    for (const node of [doc.resolve(from).nodeBefore, doc.resolve(to).nodeAfter]) {
      const mark = node && type.isInSet(node.marks);
      const other = type === insertion ? deletion : insertion;
      if (mark && mark.attrs.author === author && !other.isInSet(node.marks)) return mark;
    }
    return undefined;
  };
  const revisionOf = (mark: Mark): Revision => ({
    id: mark.attrs.id as number,
    author,
    date: (mark.attrs.date as string | null) ?? date,
  });

  /** Records `from..to` (current positions) as deleted; returns where the kept content ends. */
  const deleteRange = (from: number, to: number, inserting: boolean): { start: At; end: At } => {
    const doc = out.doc;
    const startStep = out.steps.length;
    let mark: Mark | undefined;
    const markOf = () =>
      (mark ??= adjacent(deletion, from, to) ?? deletion.create({ id: newId(), author, date }));
    const real: [number, number][] = [];
    const marked: [number, number][] = [];
    /** Whole rows deleted: recorded as the rows' deletion. */
    const rows: { pos: number; node: Node }[] = [];
    /** One's own inserted rows deleted, by table: they go (the table, when they are all its rows). */
    const ownRows = new Map<number, [number, number][]>();
    // Paragraphs joined for real (one's own inserted mark removed) become one, which starts
    // where the first starts and ends with the last one's mark (`keepLastMark`), as an
    // untracked join does.
    let group: number | null = null;
    /** Whether the group's first paragraph keeps content before the range (else it is gone). */
    let groupLive = false;
    const merged: { at: At; node: Node; live: boolean }[] = [];
    doc.nodesBetween(from, to, (node, pos) => {
      if (node.isTextblock) {
        const end = pos + node.nodeSize;
        const start = group ?? pos;
        const revision = node.attrs.revision as ParagraphRevision | null;
        // Its mark goes: the range runs into the next block, or covers this one whole.
        const crossed =
          (from < end && to > end) ||
          (from <= pos && to >= end && (inserting || !!doc.resolve(end).nodeAfter));
        if (
          crossed &&
          !revision?.deletion &&
          revision?.insertion?.author === author &&
          doc.resolve(end).nodeAfter?.isTextblock
        ) {
          real.push([end - 1, end + 1]);
          if (group === null) {
            groupLive = false;
            node.forEach((child, offset) => {
              const live = !MARKERS.has(child.type.name) && !deletion.isInSet(child.marks);
              if (live && pos + 1 + offset < from) groupLive = true;
            });
          }
          group = start;
          return true;
        }
        if (group !== null) merged.push({ at: here(group), node, live: groupLive });
        group = null;
        if (crossed) apart.push(here(start));
        if (crossed && !revision?.deletion)
          pending.push({ at: here(start), kind: "deletion", revision: revisionOf(markOf()) });
        return true;
      }
      // A whole row: its deletion is the row's (`w:trPr/w:del`), its content kept as Word keeps
      // it; one's own inserted row goes for real.
      if (node.type.name === "tableRow" && from <= pos && to >= pos + node.nodeSize) {
        const revision = node.attrs.revision as ParagraphRevision | null;
        if (revision?.insertion?.author === author && !revision.deletion) {
          const table = doc.resolve(pos).before();
          ownRows.set(table, [...(ownRows.get(table) ?? []), [pos, pos + node.nodeSize]]);
        } else if (!revision?.deletion) rows.push({ pos, node });
        return false;
      }
      // Tables, rows and cells partly covered: the text in them, cell by cell.
      if (["table", "tableRow", "tableCell"].includes(node.type.name)) return true;
      // shortcut: other blocks Foli does not model cannot be recorded as changed, so such an
      // edit is not made while tracking.
      if (!node.isInline)
        throw new TransformError("This content cannot be deleted as a tracked change");
      const s = Math.max(pos, from);
      const e = Math.min(pos + node.nodeSize, to);
      if (s >= e || MARKERS.has(node.type.name) || deletion.isInSet(node.marks)) return false;
      const own = insertion.isInSet(node.marks);
      (own && own.attrs.author === author ? real : marked).push([s, e]);
      return false;
    });
    for (const [table, list] of ownRows) {
      const node = doc.nodeAt(table);
      if (node && list.length === node.childCount) real.push([table, table + node.nodeSize]);
      else real.push(...list);
    }
    for (const [s, e] of joined(marked)) out.addMark(s, e, markOf());
    for (const { pos, node } of rows) {
      const revision = (node.attrs.revision as ParagraphRevision | null) ?? {};
      const deleted = revisionOf(markOf());
      out.step(
        new NodeMarkupStep(
          pos,
          node.type,
          { ...node.attrs, revision: { ...revision, deletion: deleted } },
          node.marks,
        ),
      );
    }
    for (const [s, e] of joined(real).reverse()) out.delete(s, e);
    for (const { at: where, node, live } of merged) {
      const pos = at(where, 1);
      const current = out.doc.nodeAt(pos);
      if (!current?.isTextblock) continue;
      // The first paragraph left nothing (all of it deleted): it is gone, the last one stays
      // whole (`keepLastMark`).
      if (!live) {
        out.step(new NodeMarkupStep(pos, node.type, node.attrs, current.marks));
        rejoined.push(here(pos));
        continue;
      }
      const attrs = { ...current.attrs };
      for (const key of MARK_ATTRS) attrs[key] = node.attrs[key] ?? null;
      // The mark kept is the last paragraph's: taking the first one's properties is a change of
      // its formatting, recorded unless that mark is one's own insertion or has a record.
      const revision = node.attrs.revision as ParagraphRevision | null;
      if (
        !attrs.formatChange &&
        revision?.insertion?.author !== author &&
        !sameProperties(attrs, node.attrs)
      )
        attrs.formatChange = { id: newId(), author, date, previous: propertiesOf(node.attrs) };
      // One's own record of what the paragraph is again (Enter, then Backspace) goes.
      const record = attrs.formatChange as { author: string; previous: Attrs } | null;
      if (record?.author === author && sameProperties(attrs, record.previous))
        attrs.formatChange = null;
      out.step(new NodeMarkupStep(pos, current.type, attrs, current.marks));
      rejoined.push(here(pos));
    }
    const mapping = out.mapping.slice(startStep);
    return { start: here(mapping.map(from, -1)), end: here(mapping.map(to, 1)) };
  };

  const ranges = changedRanges(tr);
  const records: { range: Range; start: At; end: At; inserted: At | null }[] = [];
  for (const range of [...ranges].reverse()) {
    const slice = tr.doc.slice(range.c, range.d);
    const first = slice.content.firstChild;
    // Deleting everything leaves one empty paragraph: here, the last one, its text deleted.
    const emptyBlock =
      range.a === 0 &&
      range.b === state.doc.content.size &&
      !slice.openStart &&
      slice.content.childCount === 1 &&
      first?.isTextblock &&
      !first.content.size;
    const { start, end } =
      range.a < range.b
        ? deleteRange(range.a, range.b, slice.size > 0 && !emptyBlock)
        : { start: here(range.a), end: here(range.a) };
    let inserted: At | null = null;
    const pos = end.pos;
    if (slice.size && !emptyBlock) {
      const host = out.doc.resolve(pos).parent;
      const mark = adjacent(insertion, pos, pos) ?? insertion.create({ id: newId(), author, date });
      const content = markFragment(slice.content, mark, insertion, deletion);
      out.replace(pos, pos, new Slice(content, slice.openStart, slice.openEnd));
      inserted = here(pos);
      const size = slice.size;
      // Whole rows inserted: the rows' insertion (`w:trPr/w:ins`), beside their text's marks.
      const newRows: number[] = [];
      out.doc.nodesBetween(pos, pos + size, (node, p) => {
        if (node.type.name === "tableRow" && p >= pos && p + node.nodeSize <= pos + size)
          newRows.push(p);
        if (!node.isTextblock) return !node.isInline;
        const close = p + node.nodeSize - 1;
        if (close >= pos && close < pos + size)
          pending.push({ at: here(p), kind: "insertion", revision: revisionOf(mark) });
        return false;
      });
      for (const p of newRows) {
        const row = out.doc.nodeAt(p);
        if (!row) continue;
        const revision = (row.attrs.revision as ParagraphRevision | null) ?? {};
        if (revision.insertion) continue;
        out.step(
          new NodeMarkupStep(
            p,
            row.type,
            { ...row.attrs, revision: { ...revision, insertion: revisionOf(mark) } },
            row.marks,
          ),
        );
      }
      // An open end: the paragraph there keeps the original mark with the inserted content's
      // properties (Enter at the end of a heading: the next style), a change of its formatting.
      const $end = out.doc.resolve(pos + size);
      if (slice.openEnd && host.isTextblock && $end.parent.isTextblock && $end.depth > 0)
        formats.push({ at: here($end.before()), host });
    }
    records.unshift({ range, start, end, inserted });
  }

  /** A position of `tr`'s final document in the rebuilt one. */
  const toOut = (p: number, assoc: number): number => {
    let delta = 0;
    for (const { range, start, end, inserted } of records) {
      const { a, b, c, d } = range;
      if (p < c) break;
      if (p <= d) {
        if (inserted) return at(inserted, -1) + (p - c);
        return c === d && assoc < 0 ? at(start, -1) : at(end, 1);
      }
      delta += d - c - (b - a);
    }
    return out.mapping.map(p - delta, assoc);
  };

  // Formatting changes (9.3): what the formatting was before the first tracked change, kept on
  // the run (`formatChange` mark) or the paragraph (`formatChange` attribute). One's own
  // insertions record none: they are new.
  const formatChange = state.schema.marks.formatChange;
  const ownInsertion = (node: Node) => insertion.isInSet(node.marks)?.attrs.author === author;
  const recordRun = (step: AddMarkStep | RemoveMarkStep) => {
    if (!formatChange || !RUN_MARKS.has(step.mark.type.name)) return;
    const segments: { from: number; to: number; previous: string }[] = [];
    out.doc.nodesBetween(step.from, step.to, (node, pos) => {
      if (!node.isInline) return true;
      if (MARKERS.has(node.type.name) || formatChange.isInSet(node.marks) || ownInsertion(node))
        return false;
      const present = step.mark.isInSet(node.marks);
      if (step instanceof AddMarkStep ? present : !present) return false;
      const previous = JSON.stringify(
        node.marks.filter((m) => RUN_MARKS.has(m.type.name)).map((m) => m.toJSON()),
      );
      const from = Math.max(pos, step.from);
      const to = Math.min(pos + node.nodeSize, step.to);
      const last = segments[segments.length - 1];
      if (last && last.to === from && last.previous === previous) last.to = to;
      else segments.push({ from, to, previous });
      return false;
    });
    for (const { from, to, previous } of segments) {
      const attrs = { id: newId(), author, date, previous: JSON.parse(previous) };
      out.addMark(from, to, formatChange.create(attrs));
    }
  };
  const recordParagraph = (step: NodeMarkupStep): NodeMarkupStep => {
    const node = out.doc.nodeAt(step.pos);
    const attrs = step.attrs;
    if (!node?.isTextblock || !attrs || node.type !== step.type) return step;
    // Only the mark's attributes change (a split moves them to the second paragraph): as is.
    if (sameProperties(node.attrs, attrs)) return step;
    // A record stays (the properties before the first change), whatever the step sets.
    if (node.attrs.formatChange) {
      if (deepEqual(attrs.formatChange ?? null, node.attrs.formatChange)) return step;
      const kept = { ...attrs, formatChange: node.attrs.formatChange };
      return new NodeMarkupStep(step.pos, step.type, kept, step.marks);
    }
    const revision = node.attrs.revision as ParagraphRevision | null;
    if (revision?.insertion?.author === author) return step;
    const formatChange = { id: newId(), author, date, previous: propertiesOf(node.attrs) };
    return new NodeMarkupStep(step.pos, step.type, { ...attrs, formatChange }, step.marks);
  };

  // Steps that move nothing (marks, attributes, comments), replayed on the rebuilt document.
  // An attribute change of a paragraph whose mark is now a tracked deletion (the merged
  // paragraph of a join) does not apply: the paragraphs stay apart.
  tr.steps.forEach((step, k) => {
    if (step.getMap().ranges.length) return;
    const rest = tr.mapping.slice(k + 1);
    const mapping: Mappable = {
      map: (p, assoc = 1) => toOut(rest.map(p, assoc), assoc),
      mapResult: (p, assoc = 1): MapResult => {
        const result = rest.mapResult(p, assoc);
        return { pos: toOut(result.pos, assoc), deleted: result.deleted, recover: null };
      },
    };
    let mapped: Step | null = step.map(mapping);
    // Paragraphs joined for real already have their attributes (`keepLastMark` and the record).
    const joins = new Set([...apart, ...rejoined].map((x) => at(x, 1)));
    if (mapped instanceof NodeMarkupStep && joins.has(mapped.pos)) mapped = null;
    if (mapped instanceof NodeMarkupBatchStep) {
      const kept = mapped.steps.filter((s) => !joins.has(s.pos));
      mapped = kept.length ? new NodeMarkupBatchStep(kept) : null;
    }
    if (mapped instanceof AddMarkStep || mapped instanceof RemoveMarkStep) recordRun(mapped);
    if (mapped instanceof NodeMarkupStep) mapped = recordParagraph(mapped);
    if (mapped instanceof NodeMarkupBatchStep)
      mapped = new NodeMarkupBatchStep(mapped.steps.map(recordParagraph));
    if (mapped) out.step(mapped);
  });

  // Paragraphs keeping the original mark with an inserted paragraph's properties.
  for (const { at: where, host } of formats) {
    const pos = at(where, 1);
    const node = out.doc.nodeAt(pos);
    const revision = node?.attrs.revision as ParagraphRevision | null | undefined;
    if (
      !node?.isTextblock ||
      node.attrs.formatChange ||
      revision?.insertion?.author === author ||
      sameProperties(node.attrs, host.attrs)
    )
      continue;
    const formatChange = { id: newId(), author, date, previous: propertiesOf(host.attrs) };
    out.step(new NodeMarkupStep(pos, node.type, { ...node.attrs, formatChange }, node.marks));
  }

  // Paragraph marks inserted or deleted, set last so attribute changes above do not undo them.
  const done = new Set<number>();
  for (const { at: where, kind, revision } of pending) {
    const pos = at(where, 1);
    const node = out.doc.nodeAt(pos);
    if (!node?.isTextblock || done.has(pos * 2 + (kind === "insertion" ? 1 : 0))) continue;
    done.add(pos * 2 + (kind === "insertion" ? 1 : 0));
    const current = (node.attrs.revision as ParagraphRevision | null) ?? {};
    const next =
      kind === "insertion" ? { insertion: revision } : { ...current, deletion: revision };
    out.step(new NodeMarkupStep(pos, node.type, { ...node.attrs, revision: next }));
  }

  // The selection: a caret left of what Backspace deleted, right of what Delete deleted.
  const only = ranges.length === 1 ? ranges[0] : undefined;
  const back =
    state.selection.empty &&
    only !== undefined &&
    only.c === only.d &&
    state.selection.head === only.b;
  const assoc = back ? -1 : 1;
  const selection = tr.selection;
  const anchor = toOut(selection.anchor, assoc);
  const head = toOut(selection.head, assoc);
  if (selection instanceof NodeSelection && out.doc.nodeAt(anchor)?.type === selection.node.type)
    out.setSelection(NodeSelection.create(out.doc, anchor));
  else if (selection instanceof TextSelection)
    out.setSelection(TextSelection.create(out.doc, anchor, head));
  // Cells stay selected (`Selection.fromJSON` falls back to a caret when they are not cells).
  else if (selection.toJSON().type === "cell")
    out.setSelection(Selection.fromJSON(out.doc, { type: "cell", anchor, head }));
  else out.setSelection(Selection.near(out.doc.resolve(head)));
  if (tr.storedMarks)
    out.setStoredMarks(tr.storedMarks.filter((m) => m.type !== insertion && m.type !== deletion));
  return out;
}

/** Ranges with touching ones joined. */
function joined(ranges: readonly [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [s, e] of [...ranges].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/**
 * `fragment` as inserted content: inline content marked with `mark` (other review marks
 * dropped: the content is new, in one author's name).
 */
function markFragment(
  fragment: Fragment,
  mark: Mark,
  insertion: MarkType,
  deletion: MarkType,
): Fragment {
  const nodes: Node[] = [];
  fragment.forEach((node) => {
    if (node.isInline) {
      if (MARKERS.has(node.type.name)) nodes.push(node);
      else {
        const marks = node.marks.filter((m) => m.type !== insertion && m.type !== deletion);
        nodes.push(node.mark(mark.addToSet(marks)));
      }
      return;
    }
    // A paragraph keeps its revision: an open end's is the original mark's, and the marks
    // inserted get theirs afterwards. Tables, rows and cells: their content marked (whole rows
    // get their insertion afterwards too).
    const container = ["table", "tableRow", "tableCell"].includes(node.type.name);
    if (!node.isTextblock && !container)
      throw new TransformError("This content cannot be inserted as a tracked change");
    nodes.push(node.copy(markFragment(node.content, mark, insertion, deletion)));
  });
  return Fragment.fromArray(nodes);
}
