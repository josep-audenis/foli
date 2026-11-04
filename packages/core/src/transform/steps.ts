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

/** Replaces `from..to` with a slice. */
export class ReplaceStep extends Step {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly slice: Slice,
  ) {
    super();
  }

  apply(doc: Node): StepResult {
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
    return new ReplaceStep(from.pos, Math.max(from.pos, to.pos), this.slice);
  }

  /**
   * One step equivalent to applying this step and then `next`, when they touch adjacent ranges
   * (e.g. consecutive keystrokes); null otherwise. Keeps typing history to one step per run.
   */
  merge(next: Step): ReplaceStep | null {
    if (!(next instanceof ReplaceStep)) return null;
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
