// Mark helpers follow the design of prosemirror-transform's addMark/removeMark (MIT, see
// THIRD_PARTY_NOTICES.md); independent implementation.
import { deepEqual } from "../model/attrs.js";
import {
  type Attrs,
  FoliDocumentError,
  Fragment,
  type Mark,
  MarkType,
  type Node,
  type NodeRange,
  type NodeType,
  Slice,
} from "../model/index.js";
import { Mapping } from "./stepmap.js";
import {
  AddMarkStep,
  NodeMarkupBatchStep,
  NodeMarkupStep,
  RemoveMarkStep,
  ReplaceAroundStep,
  ReplaceStep,
  type Step,
  type StepResult,
} from "./steps.js";
import type { NodeTypeWithAttrs } from "./structure.js";

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
   * Splits the node around `pos` and `depth - 1` of its ancestors in two (depth 2 in a list
   * item's paragraph splits the item). The new nodes after the split get the types in
   * `typesAfter`: entry 0 for the outermost split node, entry `depth - 1` for the innermost;
   * missing or null entries keep the original type and attributes. Check with `canSplit`
   * first: an invalid split (content or attributes) throws TransformError.
   */
  split(
    pos: number,
    depth = 1,
    typesAfter?: readonly (NodeTypeWithAttrs | null | undefined)[],
  ): this {
    const $pos = this.doc.resolve(pos);
    if (depth < 1 || depth > $pos.depth)
      throw new TransformError(`Cannot split ${depth} levels at ${pos}`);
    let before = Fragment.empty;
    let after = Fragment.empty;
    for (let d = $pos.depth, i = depth - 1; d > $pos.depth - depth; d--, i--) {
      before = Fragment.from($pos.node(d).copy(before));
      const typeAfter = typesAfter?.[i];
      let next: Node;
      try {
        next = typeAfter
          ? typeAfter.type.createOpen(typeAfter.attrs, after)
          : $pos.node(d).copy(after);
      } catch (error) {
        if (error instanceof FoliDocumentError) throw new TransformError(error.message);
        throw error;
      }
      after = Fragment.from(next);
    }
    return this.step(
      new ReplaceStep(pos, pos, new Slice(before.append(after), depth, depth), true),
    );
  }

  /**
   * Joins the nodes on either side of `pos` (and, with `depth` > 1, their last and first
   * descendants down to that depth). Throws TransformError when they cannot be joined; check
   * with `canJoin` first.
   */
  join(pos: number, depth = 1): this {
    // Without this check a position inside text would silently delete the characters around it.
    const $pos = pos > 0 && pos < this.doc.content.size ? this.doc.resolve(pos) : null;
    const before = $pos?.nodeBefore;
    const after = $pos?.nodeAfter;
    if (!before || !after || before.isLeaf || after.isLeaf || $pos?.textOffset) {
      throw new TransformError(`Position ${pos} is not between two joinable nodes`);
    }
    return this.step(new ReplaceStep(pos - depth, pos + depth, Slice.empty, true));
  }

  /**
   * Wraps the blocks of `range` in `wrappers` (outermost first, as `findWrapping` returns
   * them). The blocks move inside without being re-created, so positions in them map through.
   */
  wrap(range: NodeRange, wrappers: readonly NodeTypeWithAttrs[]): this {
    let content = Fragment.empty;
    for (let i = wrappers.length - 1; i >= 0; i--) {
      const wrapper = wrappers[i] as NodeTypeWithAttrs;
      if (content.size && !wrapper.type.contentMatch.matchFragment(content)?.validEnd) {
        throw new TransformError(`${wrapper.type.name} cannot hold the next wrapper`);
      }
      content = Fragment.from(wrapper.type.createOpen(wrapper.attrs, content));
    }
    const { start, end } = range;
    return this.step(
      new ReplaceAroundStep(
        start,
        end,
        start,
        end,
        new Slice(content, 0, 0),
        wrappers.length,
        true,
      ),
    );
  }

  /**
   * Moves the blocks of `range` up to `target` depth (from `liftTarget`), splitting the
   * ancestors they leave around them; ancestors left empty on a side are removed.
   */
  lift(range: NodeRange, target: number): this {
    const { $from, $to, depth } = range;
    const gapStart = $from.before(depth + 1);
    const gapEnd = $to.after(depth + 1);
    let start = gapStart;
    let end = gapEnd;
    let before = Fragment.empty;
    let openStart = 0;
    for (let d = depth, splitting = false; d > target; d--) {
      if (splitting || $from.index(d) > 0) {
        splitting = true;
        before = Fragment.from($from.node(d).copy(before));
        openStart++;
      } else {
        start--;
      }
    }
    let after = Fragment.empty;
    let openEnd = 0;
    for (let d = depth, splitting = false; d > target; d--) {
      if (splitting || $to.after(d + 1) < $to.end(d)) {
        splitting = true;
        after = Fragment.from($to.node(d).copy(after));
        openEnd++;
      } else {
        end++;
      }
    }
    return this.step(
      new ReplaceAroundStep(
        start,
        end,
        gapStart,
        gapEnd,
        new Slice(before.append(after), openStart, openEnd),
        before.size - openStart,
        true,
      ),
    );
  }

  /** Changes every textblock touching `from..to` to `type` with `attrs`, keeping content. */
  setBlockType(from: number, to: number, type: NodeType, attrs: Attrs | null = null): this {
    const changed: NodeMarkupStep[] = [];
    this.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return undefined;
      if (node.type !== type || !deepEqual(node.attrs, attrs ?? {})) {
        changed.push(new NodeMarkupStep(pos, type, attrs));
      }
      return false;
    });
    // One step for all blocks: a step per block rebuilt the document each time (quadratic).
    return changed.length ? this.step(new NodeMarkupBatchStep(changed)) : this;
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
