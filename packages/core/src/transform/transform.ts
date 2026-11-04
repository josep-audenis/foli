// Mark helpers follow the design of prosemirror-transform's addMark/removeMark (MIT, see
// THIRD_PARTY_NOTICES.md); independent implementation.
import { deepEqual } from "../model/attrs.js";
import {
  type Attrs,
  Fragment,
  type Mark,
  MarkType,
  type Node,
  type NodeType,
  Slice,
} from "../model/index.js";
import { Mapping } from "./stepmap.js";
import {
  AddMarkStep,
  NodeMarkupStep,
  RemoveMarkStep,
  ReplaceStep,
  type Step,
  type StepResult,
} from "./steps.js";

/** A step could not be applied (the change would break the schema or the range is invalid). */
export class TransformError extends Error {
  override name = "TransformError";
}

/**
 * Accumulates steps against a document. `step` throws TransformError on failure and leaves the
 * transform unchanged; `maybeStep` reports failure instead.
 */
export class Transform {
  readonly steps: Step[] = [];
  /** The document before each step. */
  readonly docs: Node[] = [];
  readonly mapping = new Mapping();

  constructor(private current: Node) {}

  /** The document after all steps so far. Changes only through steps. */
  get doc(): Node {
    return this.current;
  }

  /** The document before any step. */
  get before(): Node {
    return this.docs[0] ?? this.doc;
  }

  get docChanged(): boolean {
    return this.steps.length > 0;
  }

  step(step: Step): this {
    const result = this.maybeStep(step);
    if (result.failed !== null) throw new TransformError(result.failed);
    return this;
  }

  maybeStep(step: Step): StepResult {
    const result = step.apply(this.doc);
    if (result.doc) this.addStep(step, result.doc);
    return result;
  }

  protected addStep(step: Step, doc: Node): void {
    this.docs.push(this.doc);
    this.steps.push(step);
    this.mapping.appendMap(step.getMap());
    this.current = doc;
  }

  replace(from: number, to = from, slice: Slice = Slice.empty): this {
    if (from === to && !slice.size) return this;
    return this.step(new ReplaceStep(from, to, slice));
  }

  delete(from: number, to: number): this {
    return this.replace(from, to);
  }

  insert(pos: number, content: Node | readonly Node[] | Fragment): this {
    return this.replace(pos, pos, new Slice(Fragment.from(content), 0, 0));
  }

  /** Replaces `from..to` with text carrying `marks`. Empty text just deletes. */
  insertText(text: string, from: number, to = from, marks?: readonly Mark[]): this {
    if (!text) return this.delete(from, to);
    const node = this.doc.type.schema.text(text, marks);
    return this.replace(from, to, new Slice(Fragment.from(node), 0, 0));
  }

  /**
   * Adds `mark` to inline content in `from..to` where the parent allows it. Only ranges that lack
   * the mark get a step, and marks it excludes are removed first, so every step inverts exactly.
   */
  addMark(from: number, to: number, mark: Mark): this {
    const removed: { from: number; to: number; mark: Mark }[] = [];
    const added: { from: number; to: number }[] = [];
    this.doc.nodesBetween(from, to, (node, pos, parent) => {
      if (!node.isInline || !parent) return;
      if (!parent.type.allowsMarkType(mark.type)) return;
      // Unchanged when the mark is already there or an existing mark excludes it: no step.
      const next = mark.addToSet(node.marks);
      if (next === node.marks) return;
      const start = Math.max(pos, from);
      const end = Math.min(pos + node.nodeSize, to);
      for (const old of node.marks) {
        if (old.isInSet(next)) continue;
        const last = removed[removed.length - 1];
        if (last && last.to === start && last.mark.eq(old)) last.to = end;
        else removed.push({ from: start, to: end, mark: old });
      }
      const last = added[added.length - 1];
      if (last && last.to === start) last.to = end;
      else added.push({ from: start, to: end });
    });
    for (const r of removed) this.step(new RemoveMarkStep(r.from, r.to, r.mark));
    for (const r of added) this.step(new AddMarkStep(r.from, r.to, mark));
    return this;
  }

  /** Removes a mark (or every mark of a type) from inline content in `from..to`. */
  removeMark(from: number, to: number, mark: Mark | MarkType): this {
    const matched: { from: number; to: number; mark: Mark; index: number }[] = [];
    let index = 0;
    this.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isInline) return;
      index++;
      const found =
        mark instanceof MarkType
          ? node.marks.filter((m) => m.type === mark)
          : mark.isInSet(node.marks)
            ? [mark]
            : [];
      const end = Math.min(pos + node.nodeSize, to);
      for (const style of found) {
        const prev = matched.find((m) => m.index === index - 1 && m.mark.eq(style));
        if (prev) {
          prev.to = end;
          prev.index = index;
        } else {
          matched.push({ from: Math.max(pos, from), to: end, mark: style, index });
        }
      }
    });
    for (const m of matched) this.step(new RemoveMarkStep(m.from, m.to, m.mark));
    return this;
  }

  /**
   * Splits the textblock around `pos` in two. The second half gets the same markup unless
   * `after` says otherwise. shortcut: splits one level only; nested splits arrive with lists (Phase 7).
   */
  split(pos: number, after?: { type: NodeType; attrs?: Attrs | null }): this {
    const parent = this.doc.resolve(pos).parent;
    const second = after ? after.type.create(after.attrs) : parent.copy();
    return this.replace(pos, pos, new Slice(Fragment.from([parent.copy(), second]), 1, 1));
  }

  /** Joins the blocks on either side of `pos` (a position between two sibling blocks). */
  join(pos: number): this {
    // Without this check a position inside text would silently delete the two characters around it.
    const $pos = pos > 0 && pos < this.doc.content.size ? this.doc.resolve(pos) : null;
    if (!$pos?.nodeBefore?.isTextblock || !$pos.nodeAfter?.isTextblock) {
      throw new TransformError(`Position ${pos} is not between two textblocks`);
    }
    return this.delete(pos - 1, pos + 1);
  }

  /** Changes every textblock touching `from..to` to `type` with `attrs`, keeping content. */
  setBlockType(from: number, to: number, type: NodeType, attrs: Attrs | null = null): this {
    this.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return undefined;
      if (node.type !== type || !deepEqual(node.attrs, attrs ?? {})) {
        this.step(new NodeMarkupStep(pos, type, attrs));
      }
      return false;
    });
    return this;
  }

  /** Changes the markup of the node at `pos` (see NodeMarkupStep). */
  setNodeMarkup(
    pos: number,
    type: NodeType,
    attrs: Attrs | null = null,
    marks?: readonly Mark[],
  ): this {
    return this.step(new NodeMarkupStep(pos, type, attrs, marks));
  }
}
