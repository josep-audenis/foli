import {
  type Attrs,
  FoliDocumentError,
  Fragment,
  type Mark,
  type Node,
  type NodeType,
  ReplaceError,
  Slice,
} from "../model/index.js";
import { type Mappable, StepMap } from "./stepmap.js";

/** Either the new document or why the step could not be applied. */
export class StepResult {
  private constructor(
    readonly doc: Node | null,
    readonly failed: string | null,
  ) {}

  static ok(doc: Node): StepResult {
    return new StepResult(doc, null);
  }

  static fail(message: string): StepResult {
    return new StepResult(null, message);
  }

  /** Runs `doc.replace`, turning schema/range violations into a failed result. */
  static fromReplace(doc: Node, from: number, to: number, slice: Slice): StepResult {
    try {
      return StepResult.ok(doc.replace(from, to, slice));
    } catch (error) {
      if (!(error instanceof ReplaceError || error instanceof RangeError)) throw error;
      return StepResult.fail(error.message);
    }
  }
}

/**
 * One atomic, invertible document change. Every edit is a sequence of steps; steps report how
 * they move positions (`getMap`), can be inverted against the document they were applied to,
 * and can be mapped through later changes (for undo after unrelated edits).
 */
export abstract class Step {
  abstract apply(doc: Node): StepResult;

  getMap(): StepMap {
    return StepMap.empty;
  }

  /** The step that undoes this one. `doc` is the document this step was applied to. */
  abstract invert(doc: Node): Step;

  /** This step moved through `mapping`, or null if the content it targets was deleted. */
  abstract map(mapping: Mappable): Step | null;
}

/**
 * `from..to` moved through `mapping`, the start sticking right and the end left so the range
 * does not grow over content inserted at its edges. Null when the whole range was deleted.
 */
function mapRange(
  mapping: Mappable,
  from: number,
  to: number,
): { from: number; to: number } | null {
  const start = mapping.mapResult(from, 1);
  const end = mapping.mapResult(to, -1);
  return start.deleted && end.deleted ? null : { from: start.pos, to: end.pos };
}

/** `a` followed by `b`, for two slices that meet at closed edges. */
function concat(a: Slice, b: Slice): Slice {
  if (a.size === 0 && b.size === 0) return Slice.empty;
  return new Slice(a.content.append(b.content), a.openStart, b.openEnd);
}

/**
 * Replaces `from..to` with a slice. A `structure` step only moves node boundaries (split, join):
 * it fails instead of deleting content that, after mapping through other changes, now sits in
 * its range.
 */
export class ReplaceStep extends Step {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly slice: Slice,
    readonly structure = false,
  ) {
    super();
  }

  apply(doc: Node): StepResult {
    if (this.structure && !onlyBoundaries(doc, this.from, this.to)) {
      return StepResult.fail("Structure replace would overwrite content");
    }
    return StepResult.fromReplace(doc, this.from, this.to, this.slice);
  }

  override getMap(): StepMap {
    return new StepMap([this.from, this.to - this.from, this.slice.size]);
  }

  invert(doc: Node): Step {
    // What the range held before goes back where the slice now is.
    const removed = doc.slice(this.from, this.to);
    return new ReplaceStep(this.from, this.from + this.slice.size, removed);
  }

  map(mapping: Mappable): Step | null {
    const range = mapRange(mapping, this.from, this.to);
    if (!range) return null;
    const to = Math.max(range.from, range.to);
    return new ReplaceStep(range.from, to, this.slice, this.structure);
  }

  /**
   * One step equivalent to applying this step and then `next`, when they touch adjacent ranges
   * (e.g. consecutive keystrokes); null otherwise. Keeps typing history to one step per run.
   */
  merge(next: Step): ReplaceStep | null {
    if (!(next instanceof ReplaceStep) || this.structure || next.structure) return null;
    const end = this.from + this.slice.size;
    // `next` continues right after what this step inserted.
    if (next.from === end && this.slice.openEnd === 0 && next.slice.openStart === 0) {
      const to = this.to + next.to - next.from;
      return new ReplaceStep(this.from, to, concat(this.slice, next.slice));
    }
    // `next` works backwards from where this step started (Backspace after Backspace).
    if (next.to === this.from && this.slice.openStart === 0 && next.slice.openEnd === 0) {
      return new ReplaceStep(next.from, this.to, concat(next.slice, this.slice));
    }
    return null;
  }
}

/**
 * Replaces `from..to` with a slice while keeping the content between `gapFrom` and `gapTo`,
 * which is inserted into the slice at `insert`. Wrapping blocks in a list (the slice holds the
 * empty wrappers) and lifting them out (the slice holds the split ancestors) are such steps:
 * the moved content is not deleted and re-inserted, so positions inside it map through.
 */
export class ReplaceAroundStep extends Step {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly gapFrom: number,
    readonly gapTo: number,
    readonly slice: Slice,
    readonly insert: number,
    readonly structure = false,
  ) {
    super();
  }

  apply(doc: Node): StepResult {
    const { from, to, gapFrom, gapTo } = this;
    const ordered = 0 <= from && from <= gapFrom && gapFrom <= gapTo && gapTo <= to;
    if (!ordered || to > doc.content.size)
      return StepResult.fail(`Invalid gap range ${from}..${to}`);
    if (this.structure && !(onlyBoundaries(doc, from, gapFrom) && onlyBoundaries(doc, gapTo, to))) {
      return StepResult.fail("Structure gap-replace would overwrite content");
    }
    const kept = doc.slice(gapFrom, gapTo);
    if (kept.openStart !== 0 || kept.openEnd !== 0)
      return StepResult.fail("Gap is not a flat range");
    let filled: Slice | null;
    try {
      filled = this.slice.insertAt(this.insert, kept.content);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return StepResult.fail(error.message);
    }
    return filled
      ? StepResult.fromReplace(doc, from, to, filled)
      : StepResult.fail("Content does not fit in gap");
  }

  override getMap(): StepMap {
    // Two changed ranges: before the gap (becomes the slice up to `insert`) and after it.
    const { from, to, gapFrom, gapTo, insert } = this;
    return new StepMap([from, gapFrom - from, insert, gapTo, to - gapTo, this.slice.size - insert]);
  }

  invert(doc: Node): Step {
    const gapSize = this.gapTo - this.gapFrom;
    const gapStart = this.from + this.insert;
    // The old content around the gap, without the gap itself, is what the inverse puts back.
    const around = doc
      .slice(this.from, this.to)
      .removeBetween(this.gapFrom - this.from, this.gapTo - this.from);
    return new ReplaceAroundStep(
      this.from,
      this.from + this.slice.size + gapSize,
      gapStart,
      gapStart + gapSize,
      around,
      this.gapFrom - this.from,
      this.structure,
    );
  }

  map(mapping: Mappable): Step | null {
    const range = mapRange(mapping, this.from, this.to);
    if (!range) return null;
    // The gap keeps its content: its edges stick inwards, unless they are the range's edges.
    const gapFrom = this.gapFrom === this.from ? range.from : mapping.map(this.gapFrom, -1);
    const gapTo = this.gapTo === this.to ? range.to : mapping.map(this.gapTo, 1);
    if (gapFrom < range.from || gapTo > range.to) return null;
    // The content it moves is gone: a lift would only split its ancestors around nothing.
    if (this.gapTo > this.gapFrom && gapTo <= gapFrom) return null;
    return new ReplaceAroundStep(
      range.from,
      range.to,
      gapFrom,
      gapTo,
      this.slice,
      this.insert,
      this.structure,
    );
  }
}

/**
 * Whether `from..to` holds nothing but node boundaries: closing tokens of nodes that end there,
 * then opening tokens of nodes (each the first child of the one before) that start there. Text,
 * a leaf or any other node in the range is content a structure step must not overwrite.
 */
function onlyBoundaries(doc: Node, from: number, to: number): boolean {
  // Out of range: nothing to protect, and the replace itself fails (it does not throw).
  if (from < 0 || to > doc.content.size || from >= to) return true;
  const $from = doc.resolve(from);
  let pos = from;
  for (let depth = $from.depth; pos < to && depth > 0 && pos === $from.end(depth); depth--) pos++;
  if (pos === to) return true;
  let next = doc.resolve(pos).nodeAfter;
  for (; pos < to; pos++) {
    if (!next || next.isLeaf) return false;
    next = next.firstChild;
  }
  return true;
}

/** `fragment` with `f` applied to every inline node, at any depth; `parent` holds `fragment`. */
function eachInline(
  fragment: Fragment,
  parent: Node,
  f: (node: Node, parent: Node) => Node,
): Fragment {
  const nodes: Node[] = [];
  for (let i = 0; i < fragment.childCount; i++) {
    const child = fragment.child(i);
    const inner = child.content.size ? child.copy(eachInline(child.content, child, f)) : child;
    nodes.push(inner.isInline ? f(inner, parent) : inner);
  }
  return Fragment.fromArray(nodes);
}

abstract class MarkStep extends Step {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly mark: Mark,
  ) {
    super();
  }

  protected abstract change(marks: readonly Mark[]): readonly Mark[];
  protected abstract create(from: number, to: number): MarkStep;

  apply(doc: Node): StepResult {
    const { from, to } = this;
    if (from < 0 || from >= to || to > doc.content.size) {
      return StepResult.fail(`Invalid mark range ${from}..${to}`);
    }
    const before = doc.slice(from, to);
    const $from = doc.resolve(from);
    const top = $from.node($from.sharedDepth(to));
    const type = this.mark.type;
    const content = eachInline(before.content, top, (node, parent) =>
      parent.type.allowsMarkType(type) ? node.mark(this.change(node.marks)) : node,
    );
    const slice = new Slice(content, before.openStart, before.openEnd);
    return StepResult.fromReplace(doc, from, to, slice);
  }

  map(mapping: Mappable): Step | null {
    const range = mapRange(mapping, this.from, this.to);
    return range && range.from < range.to ? this.create(range.from, range.to) : null;
  }
}

/** Adds a mark to all inline content in `from..to` whose parent allows it. */
export class AddMarkStep extends MarkStep {
  protected change(marks: readonly Mark[]): readonly Mark[] {
    return this.mark.addToSet(marks);
  }

  protected create(from: number, to: number): MarkStep {
    return new AddMarkStep(from, to, this.mark);
  }

  /** Exact only if no content in the range had the mark before; Transform.addMark ensures that. */
  invert(): Step {
    return new RemoveMarkStep(this.from, this.to, this.mark);
  }
}

/** Removes a mark from all inline content in `from..to`. */
export class RemoveMarkStep extends MarkStep {
  protected change(marks: readonly Mark[]): readonly Mark[] {
    return this.mark.removeFromSet(marks);
  }

  protected create(from: number, to: number): MarkStep {
    return new RemoveMarkStep(from, to, this.mark);
  }

  invert(): Step {
    return new AddMarkStep(this.from, this.to, this.mark);
  }
}

/**
 * Changes the type, attributes or marks of the node starting at `pos`, keeping its content.
 * Positions inside the node do not move (empty map), unlike replacing the node. Covers attribute
 * changes (an "AttrStep") and block type changes (paragraph ↔ heading).
 */
export class NodeMarkupStep extends Step {
  constructor(
    readonly pos: number,
    readonly type: NodeType,
    readonly attrs: Attrs | null,
    readonly marks?: readonly Mark[],
  ) {
    super();
  }

  apply(doc: Node): StepResult {
    const node = this.pos >= 0 && this.pos < doc.content.size ? doc.nodeAt(this.pos) : null;
    if (!node || node.isText) return StepResult.fail(`No node at position ${this.pos}`);
    let updated: Node;
    try {
      updated = this.type.create(this.attrs, node.content, this.marks ?? node.marks);
    } catch (error) {
      if (error instanceof FoliDocumentError) return StepResult.fail(error.message);
      throw error;
    }
    return StepResult.fromReplace(
      doc,
      this.pos,
      this.pos + node.nodeSize,
      new Slice(Fragment.from(updated), 0, 0),
    );
  }

  invert(doc: Node): Step {
    const node = doc.nodeAt(this.pos);
    if (!node) throw new RangeError(`No node at position ${this.pos}`);
    return new NodeMarkupStep(this.pos, node.type, node.attrs, node.marks);
  }

  map(mapping: Mappable): Step | null {
    const pos = mapping.mapResult(this.pos, 1);
    // A node deleted from exactly its start leaves `pos` on the range edge (not "deleted"); the
    // position just after its first token is deleted or collapses onto `pos` (leaf nodes). Without
    // this check the step would land on whatever node follows.
    const inside = mapping.mapResult(this.pos + 1, -1);
    if (pos.deleted || inside.deleted || inside.pos <= pos.pos) return null;
    return new NodeMarkupStep(pos.pos, this.type, this.attrs, this.marks);
  }
}

/** `parent` with the nodes that `steps` (sorted, inside its content at `start`) target re-marked. */
function remarkup(parent: Node, start: number, steps: readonly NodeMarkupStep[]): Node {
  const children: Node[] = [];
  let i = 0;
  parent.forEach((child, offset) => {
    const pos = start + offset;
    const first = i;
    while (i < steps.length && (steps[i] as NodeMarkupStep).pos < pos + child.nodeSize) i++;
    if (first === i) {
      children.push(child);
      return;
    }
    const own = (steps[first] as NodeMarkupStep).pos === pos ? steps[first] : undefined;
    const inner = steps.slice(own ? first + 1 : first, i);
    let node = inner.length ? remarkup(child, pos + 1, inner) : child;
    if (own) {
      if (node.isText) throw new RangeError(`No node at position ${pos}`);
      node = own.type.create(own.attrs, node.content, own.marks ?? node.marks);
      // An empty map is only right while sizes stay the same (no leaf <-> non-leaf changes).
      if (node.nodeSize !== child.nodeSize)
        throw new RangeError("Node markup must keep the node size");
    }
    children.push(node);
  });
  // Steps left over point inside text or past the end of the content.
  if (i < steps.length) throw new RangeError(`No node at position ${steps[i]?.pos}`);
  const content = Fragment.fromArray(children);
  if (!parent.type.validContent(content)) {
    throw new RangeError(`Invalid content for node ${parent.type.name}`);
  }
  return parent.copy(content);
}

/**
 * Several NodeMarkupSteps (sorted by position) applied in one pass, so changing many blocks
 * rebuilds the document once instead of once per block. Positions do not move (empty map).
 */
export class NodeMarkupBatchStep extends Step {
  constructor(readonly steps: readonly NodeMarkupStep[]) {
    super();
  }

  apply(doc: Node): StepResult {
    for (let i = 0; i < this.steps.length; i++) {
      const pos = (this.steps[i] as NodeMarkupStep).pos;
      if (pos < 0 || (i > 0 && pos <= (this.steps[i - 1] as NodeMarkupStep).pos)) {
        return StepResult.fail(`Unsorted or invalid node markup position ${pos}`);
      }
    }
    try {
      return StepResult.ok(remarkup(doc, 0, this.steps));
    } catch (error) {
      if (error instanceof FoliDocumentError || error instanceof RangeError) {
        return StepResult.fail(error.message);
      }
      throw error;
    }
  }

  invert(doc: Node): Step {
    const old: NodeMarkupStep[] = [];
    const last = this.steps[this.steps.length - 1];
    if (last) {
      doc.nodesBetween((this.steps[0] as NodeMarkupStep).pos, last.pos + 1, (node, pos) => {
        if (this.steps[old.length]?.pos === pos) {
          old.push(new NodeMarkupStep(pos, node.type, node.attrs, node.marks));
        }
        const next = this.steps[old.length];
        return next !== undefined && next.pos < pos + node.nodeSize;
      });
    }
    if (old.length !== this.steps.length) throw new RangeError("Node markup batch does not fit");
    return new NodeMarkupBatchStep(old);
  }

  map(mapping: Mappable): Step | null {
    const steps = this.steps
      .map((step) => step.map(mapping))
      .filter((step): step is NodeMarkupStep => step !== null);
    return steps.length ? new NodeMarkupBatchStep(steps) : null;
  }
}
