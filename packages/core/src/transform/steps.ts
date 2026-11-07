// The step design follows prosemirror-transform (MIT, see THIRD_PARTY_NOTICES.md); this is an
// independent implementation on Foli's model.
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
      if (error instanceof ReplaceError || error instanceof RangeError) {
        return StepResult.fail(error.message);
      }
      throw error;
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
    if (this.structure && contentBetween(doc, this.from, this.to)) {
      return StepResult.fail("Structure replace would overwrite content");
    }
    return StepResult.fromReplace(doc, this.from, this.to, this.slice);
  }

  override getMap(): StepMap {
    return new StepMap([this.from, this.to - this.from, this.slice.size]);
  }

  invert(doc: Node): Step {
    return new ReplaceStep(this.from, this.from + this.slice.size, doc.slice(this.from, this.to));
  }

  map(mapping: Mappable): Step | null {
    const from = mapping.mapResult(this.from, 1);
    const to = mapping.mapResult(this.to, -1);
    if (from.deleted && to.deleted) return null;
    return new ReplaceStep(from.pos, Math.max(from.pos, to.pos), this.slice, this.structure);
  }

  /**
   * One step equivalent to applying this step and then `next`, when they touch adjacent ranges
   * (e.g. consecutive keystrokes); null otherwise. Keeps typing history to one step per run.
   */
  merge(next: Step): ReplaceStep | null {
    if (!(next instanceof ReplaceStep) || next.structure || this.structure) return null;
    const join = (a: Slice, b: Slice) =>
      a.size + b.size === 0
        ? Slice.empty
        : new Slice(a.content.append(b.content), a.openStart, b.openEnd);
    if (this.from + this.slice.size === next.from && !this.slice.openEnd && !next.slice.openStart) {
      return new ReplaceStep(
        this.from,
        this.to + (next.to - next.from),
        join(this.slice, next.slice),
      );
    }
    if (next.to === this.from && !this.slice.openStart && !next.slice.openEnd) {
      return new ReplaceStep(next.from, this.to, join(next.slice, this.slice));
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
    if (
      this.from < 0 ||
      this.from > this.gapFrom ||
      this.gapFrom > this.gapTo ||
      this.gapTo > this.to ||
      this.to > doc.content.size
    ) {
      return StepResult.fail(`Invalid gap range ${this.from}..${this.to}`);
    }
    if (
      this.structure &&
      (contentBetween(doc, this.from, this.gapFrom) || contentBetween(doc, this.gapTo, this.to))
    ) {
      return StepResult.fail("Structure gap-replace would overwrite content");
    }
    const gap = doc.slice(this.gapFrom, this.gapTo);
    if (gap.openStart || gap.openEnd) return StepResult.fail("Gap is not a flat range");
    let inserted: Slice | null;
    try {
      inserted = this.slice.insertAt(this.insert, gap.content);
    } catch (error) {
      if (error instanceof RangeError) return StepResult.fail(error.message);
      throw error;
    }
    if (!inserted) return StepResult.fail("Content does not fit in gap");
    return StepResult.fromReplace(doc, this.from, this.to, inserted);
  }

  override getMap(): StepMap {
    return new StepMap([
      this.from,
      this.gapFrom - this.from,
      this.insert,
      this.gapTo,
      this.to - this.gapTo,
      this.slice.size - this.insert,
    ]);
  }

  invert(doc: Node): Step {
    const gap = this.gapTo - this.gapFrom;
    return new ReplaceAroundStep(
      this.from,
      this.from + this.slice.size + gap,
      this.from + this.insert,
      this.from + this.insert + gap,
      doc.slice(this.from, this.to).removeBetween(this.gapFrom - this.from, this.gapTo - this.from),
      this.gapFrom - this.from,
      this.structure,
    );
  }

  map(mapping: Mappable): Step | null {
    const from = mapping.mapResult(this.from, 1);
    const to = mapping.mapResult(this.to, -1);
    const gapFrom = this.from === this.gapFrom ? from.pos : mapping.map(this.gapFrom, -1);
    const gapTo = this.to === this.gapTo ? to.pos : mapping.map(this.gapTo, 1);
    if ((from.deleted && to.deleted) || gapFrom < from.pos || gapTo > to.pos) return null;
    // The content it moves is gone: a lift would only split its ancestors around nothing.
    if (this.gapTo > this.gapFrom && gapTo <= gapFrom) return null;
    return new ReplaceAroundStep(
      from.pos,
      to.pos,
      gapFrom,
      gapTo,
      this.slice,
      this.insert,
      this.structure,
    );
  }
}

/**
 * Whether `from..to` holds anything but node boundaries: text, a leaf, or a node that is not
 * the first or last along the path. Used by structure steps.
 */
function contentBetween(doc: Node, from: number, to: number): boolean {
  const $from = doc.resolve(from);
  let dist = to - from;
  let depth = $from.depth;
  while (dist > 0 && depth > 0 && $from.indexAfter(depth) === $from.node(depth).childCount) {
    depth--;
    dist--;
  }
  if (dist > 0) {
    let next = $from.node(depth).maybeChild($from.indexAfter(depth));
    while (dist > 0) {
      if (!next || next.isLeaf) return true;
      next = next.firstChild;
      dist--;
    }
  }
  return false;
}

/** Rebuilds inline nodes of a fragment with `f`, descending into block content. */
function mapInline(
  fragment: Fragment,
  f: (node: Node, parent: Node) => Node,
  parent: Node,
): Fragment {
  const mapped: Node[] = [];
  fragment.forEach((child) => {
    let node = child.content.size ? child.copy(mapInline(child.content, f, child)) : child;
    if (node.isInline) node = f(node, parent);
    mapped.push(node);
  });
  return Fragment.fromArray(mapped);
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
    if (this.from >= this.to || this.from < 0 || this.to > doc.content.size) {
      return StepResult.fail(`Invalid mark range ${this.from}..${this.to}`);
    }
    const old = doc.slice(this.from, this.to);
    const $from = doc.resolve(this.from);
    const parent = $from.node($from.sharedDepth(this.to));
    const content = mapInline(
      old.content,
      (node, p) =>
        p.type.allowsMarkType(this.mark.type) ? node.mark(this.change(node.marks)) : node,
      parent,
    );
    return StepResult.fromReplace(
      doc,
      this.from,
      this.to,
      new Slice(content, old.openStart, old.openEnd),
    );
  }

  map(mapping: Mappable): Step | null {
    const from = mapping.mapResult(this.from, 1);
    const to = mapping.mapResult(this.to, -1);
    if ((from.deleted && to.deleted) || from.pos >= to.pos) return null;
    return this.create(from.pos, to.pos);
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
