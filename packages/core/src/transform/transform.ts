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

/** The attributes a block gets when it becomes `type` (see Transform.setBlockType). */
function blockAttrs(node: Node, type: NodeType, attrs: Attrs | null): Attrs {
  const merged: Record<string, unknown> = {};
  const own = node.type.spec.attrs ?? {};
  for (const name of Object.keys(type.spec.attrs ?? {})) {
    if (attrs && Object.hasOwn(attrs, name)) merged[name] = attrs[name];
    else if (Object.hasOwn(own, name)) merged[name] = node.attrs[name];
  }
  for (const name of Object.keys(attrs ?? {})) {
    if (!Object.hasOwn(merged, name)) merged[name] = attrs?.[name]; // unknown: rejected below
  }
  try {
    return type.createOpen(merged).attrs;
  } catch (error) {
    if (error instanceof FoliDocumentError) throw new TransformError(error.message);
    throw error;
  }
}

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
    const [removals, removeRun] = markRuns();
    const additions: { from: number; to: number }[] = [];
    this.doc.nodesBetween(from, to, (node, pos, parent) => {
      if (!node.isInline || !parent?.type.allowsMarkType(mark.type)) return;
      const marks = mark.addToSet(node.marks);
      // The mark is there already, or a mark on the node excludes it: nothing to do here.
      if (marks === node.marks) return;
      const start = Math.max(pos, from);
      const end = Math.min(pos + node.nodeSize, to);
      // Marks the new one excludes go first, so that the add step's inverse is exact.
      removeRun(
        node.marks.filter((old) => !old.isInSet(marks)),
        start,
        end,
      );
      const last = additions[additions.length - 1];
      if (last?.to === start) last.to = end;
      else additions.push({ from: start, to: end });
    });
    for (const run of removals) this.step(new RemoveMarkStep(run.from, run.to, run.mark));
    for (const run of additions) this.step(new AddMarkStep(run.from, run.to, mark));
    return this;
  }

  /** Removes a mark (or every mark of a type) from inline content in `from..to`. */
  removeMark(from: number, to: number, mark: Mark | MarkType): this {
    const [found, addRun] = markRuns();
    this.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isInline) return;
      const marks =
        mark instanceof MarkType
          ? node.marks.filter((m) => m.type === mark)
          : mark.isInSet(node.marks)
            ? [mark]
            : [];
      // A run continues over consecutive inline nodes, even into the next block.
      addRun(marks, Math.max(pos, from), Math.min(pos + node.nodeSize, to), true);
    });
    for (const run of found) this.step(new RemoveMarkStep(run.from, run.to, run.mark));
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
    // Innermost split node first; `level` 0 is the outermost, as in `typesAfter`.
    let head = Fragment.empty;
    let tail = Fragment.empty;
    for (let level = depth - 1; level >= 0; level--) {
      const node = $pos.node($pos.depth - (depth - 1 - level));
      head = Fragment.from(node.copy(head));
      tail = Fragment.from(splitOff(node, typesAfter?.[level], tail));
    }
    const slice = new Slice(head.append(tail), depth, depth);
    return this.step(new ReplaceStep(pos, pos, slice, true));
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
    // Built from the innermost wrapper out: each must accept the one inside it.
    const nested = wrappers.reduceRight((inner, { type, attrs }) => {
      if (inner.size && !type.contentMatch.matchFragment(inner)?.validEnd) {
        throw new TransformError(`${type.name} cannot hold the next wrapper`);
      }
      return Fragment.from(type.createOpen(attrs, inner));
    }, Fragment.empty);
    const { start, end } = range;
    // The range is the gap: the empty wrappers go around it, the blocks move in unchanged.
    const slice = new Slice(nested, 0, 0);
    return this.step(new ReplaceAroundStep(start, end, start, end, slice, wrappers.length, true));
  }

  /**
   * Moves the blocks of `range` up to `target` depth (from `liftTarget`), splitting the
   * ancestors they leave around them; ancestors left empty on a side are removed.
   */
  lift(range: NodeRange, target: number): this {
    const { $from, $to, depth, start, end } = range;
    const before = liftSide(
      depth,
      target,
      (d) => $from.node(d),
      (d) => $from.index(d) > 0,
    );
    const after = liftSide(
      depth,
      target,
      (d) => $to.node(d),
      (d) => $to.after(d + 1) < $to.end(d),
    );
    const slice = new Slice(before.split.append(after.split), before.open, after.open);
    return this.step(
      new ReplaceAroundStep(
        start - before.dropped,
        end + after.dropped,
        start,
        end,
        slice,
        before.split.size - before.open,
        true,
      ),
    );
  }

  /**
   * Changes every textblock touching `from..to` to `type`, keeping content. Attributes come from
   * `attrs`, then from the block itself for attributes both types declare (a centered paragraph
   * stays centered as a heading), then from defaults. Blocks already like that are untouched.
   * Invalid attributes throw TransformError.
   */
  setBlockType(from: number, to: number, type: NodeType, attrs: Attrs | null = null): this {
    const changed: NodeMarkupStep[] = [];
    this.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return undefined;
      const next = blockAttrs(node, type, attrs);
      if (node.type !== type || !deepEqual(node.attrs, next)) {
        changed.push(new NodeMarkupStep(pos, type, next));
      }
      return false;
    });
    // One step for all blocks: a step per block rebuilt the document each time (quadratic).
    return changed.length ? this.step(new NodeMarkupBatchStep(changed)) : this;
  }

  /**
   * Sets `attrs` on every textblock touching `from..to` whose type declares them (alignment on
   * paragraphs and headings), keeping each block's type. Blocks already like that are untouched.
   * Invalid attributes throw TransformError.
   */
  setBlockAttrs(from: number, to: number, attrs: Attrs): this {
    const changed: NodeMarkupStep[] = [];
    this.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return undefined;
      const declared = node.type.spec.attrs ?? {};
      const own = Object.fromEntries(Object.entries(attrs).filter(([name]) => name in declared));
      if (!Object.keys(own).length) return false;
      const next = { ...node.attrs, ...own };
      if (!deepEqual(node.attrs, next)) changed.push(new NodeMarkupStep(pos, node.type, next));
      return false;
    });
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

/** The part of `node` after a split: `after` in a copy of it, or in `override`'s type. */
function splitOff(
  node: Node,
  override: NodeTypeWithAttrs | null | undefined,
  after: Fragment,
): Node {
  try {
    return override ? override.type.createOpen(override.attrs, after) : node.copy(after);
  } catch (error) {
    if (error instanceof FoliDocumentError) throw new TransformError(error.message);
    throw error;
  }
}

/**
 * One side of a lift, going up from the range's parent (`depth`) to `target`. Ancestors with
 * nothing on this side of the range lose their token on this side (`dropped` counts them); from
 * the first that has content there on, each is split, its copy left open in the slice.
 */
function liftSide(
  depth: number,
  target: number,
  nodeAt: (depth: number) => Node,
  hasContent: (depth: number) => boolean,
): { split: Fragment; open: number; dropped: number } {
  let split = Fragment.empty;
  let open = 0;
  let dropped = 0;
  for (let d = depth, splitting = false; d > target; d--) {
    splitting ||= hasContent(d);
    if (splitting) {
      split = Fragment.from(nodeAt(d).copy(split));
      open++;
    } else {
      dropped++;
    }
  }
  return { split, open, dropped };
}

/** A run of one mark over consecutive ranges: one mark step. */
interface MarkRun {
  from: number;
  to: number;
  mark: Mark;
}

/**
 * Collects mark runs from ranges given in document order: `add(marks, from, to, continues)`
 * says `from..to` has `marks`. A run grows while the ranges it is found in follow each other
 * (`continues`, by default when `from` is where the previous range ended); a range without the
 * mark ends it.
 */
function markRuns(): [
  MarkRun[],
  (marks: readonly Mark[], from: number, to: number, continues?: boolean) => void,
] {
  const runs: MarkRun[] = [];
  // The runs the previous range was part of, and where that range ended.
  let previous: MarkRun[] = [];
  let previousEnd = -1;
  const add = (
    marks: readonly Mark[],
    from: number,
    to: number,
    continues = from === previousEnd,
  ) => {
    const current: MarkRun[] = [];
    for (const mark of marks) {
      let run = continues ? previous.find((r) => r.mark.eq(mark)) : undefined;
      if (run) {
        run.to = to;
      } else {
        run = { from, to, mark };
        runs.push(run);
      }
      current.push(run);
    }
    previous = current;
    previousEnd = to;
  };
  return [runs, add];
}
