import { Fragment } from "./fragment.js";
import type { Node, NodeJSON } from "./node.js";

export interface SliceJSON {
  content: NodeJSON[];
  openStart: number;
  openEnd: number;
}

/**
 * A piece of a document (for copy/paste and replace). `openStart`/`openEnd` say how many
 * nodes along the first/last child chain are cut open: their start/end tokens are not part of
 * the slice, so their content joins the content around the insertion point.
 */
export class Slice {
  static readonly empty = new Slice(Fragment.empty, 0, 0);

  constructor(
    readonly content: Fragment,
    readonly openStart: number,
    readonly openEnd: number,
  ) {}

  /** The number of positions this slice adds when inserted. */
  get size(): number {
    return this.content.size - this.openStart - this.openEnd;
  }

  /**
   * This slice with `fragment` inserted at `pos` (in slice positions): into the node that holds
   * `pos`, which must accept it. Null when the content would not be valid there.
   */
  insertAt(pos: number, fragment: Fragment): Slice | null {
    const path = descend(this.content, pos + this.openStart);
    const { content, offset } = path.inner;
    const result = content.cut(0, offset).append(fragment).append(content.cut(offset));
    const holder = path.steps[path.steps.length - 1];
    // A node the slice cuts open is completed by the document around the replaced range, and
    // replace validates it once joined: checking it here would reject valid content.
    if (holder && !this.isOpenNode(path.steps) && !holder.child.type.validContent(result)) {
      return null;
    }
    return new Slice(path.rebuild(result), this.openStart, this.openEnd);
  }

  /** This slice without the flat range `from..to` (slice positions). */
  removeBetween(from: number, to: number): Slice {
    const path = descend(this.content, from + this.openStart);
    const { content, offset } = path.inner;
    const end = offset + (to - from);
    // `to` must be in the same node as `from`, and not inside a child node.
    const { index, offset: start } = end <= content.size ? content.findIndex(end) : { index: -1, offset: -1 };
    if (index < 0 || (start !== end && !content.child(index).isText)) {
      throw new RangeError("Removing a non-flat range");
    }
    return new Slice(
      path.rebuild(content.cut(0, offset).append(content.cut(end))),
      this.openStart,
      this.openEnd,
    );
  }

  /** Whether the node reached through `steps` is one of the nodes this slice cuts open. */
  private isOpenNode(steps: readonly Step[]): boolean {
    const level = steps.length;
    const first = steps.every((step) => step.index === 0);
    const last = steps.every((step) => step.index === step.content.childCount - 1);
    return (first && level <= this.openStart) || (last && level <= this.openEnd);
  }

  eq(other: Slice): boolean {
    return (
      this.content.eq(other.content) &&
      this.openStart === other.openStart &&
      this.openEnd === other.openEnd
    );
  }

  toJSON(): SliceJSON {
    return { content: this.content.toJSON(), openStart: this.openStart, openEnd: this.openEnd };
  }
}

/** One level of a descent: `child` is the node at `index` of `content`. */
interface Step {
  content: Fragment;
  index: number;
  child: Node;
}

/**
 * Walks from `content` into the node whose content holds `pos` (a position inside text stays
 * in the text's parent). `inner` is that content and the offset of `pos` in it; `rebuild` puts a
 * replacement for it back into copies of the nodes walked through.
 */
function descend(
  content: Fragment,
  pos: number,
): {
  steps: Step[];
  inner: { content: Fragment; offset: number };
  rebuild: (inner: Fragment) => Fragment;
} {
  const steps: Step[] = [];
  let rel = pos;
  for (;;) {
    const { index, offset } = content.findIndex(rel);
    const child = content.maybeChild(index);
    if (offset === rel || !child || child.isText) break;
    steps.push({ content, index, child });
    content = child.content;
    rel -= offset + 1;
  }
  return {
    steps,
    inner: { content, offset: rel },
    rebuild(inner) {
      let result = inner;
      for (let i = steps.length - 1; i >= 0; i--) {
        const step = steps[i] as Step;
        result = step.content.replaceChild(step.index, step.child.copy(result));
      }
      return result;
    },
  };
}
