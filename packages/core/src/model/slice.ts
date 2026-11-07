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
    const content = insertInto(this.content, pos + this.openStart, fragment, {
      parent: null,
      level: 0,
      onStart: true,
      onEnd: true,
      openStart: this.openStart,
      openEnd: this.openEnd,
    });
    return content && new Slice(content, this.openStart, this.openEnd);
  }

  /** This slice without the flat range `from..to` (slice positions). */
  removeBetween(from: number, to: number): Slice {
    return new Slice(
      removeRange(this.content, from + this.openStart, to + this.openStart),
      this.openStart,
      this.openEnd,
    );
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

interface InsertPath {
  /** The node holding `content`, null at the top of the slice. */
  parent: Node | null;
  /** Depth of `parent` in the slice (1 for a top-level node). */
  level: number;
  /** Whether `parent` is on the slice's first-child chain, and on its last-child chain. */
  onStart: boolean;
  onEnd: boolean;
  openStart: number;
  openEnd: number;
}

function insertInto(
  content: Fragment,
  dist: number,
  insert: Fragment,
  path: InsertPath,
): Fragment | null {
  const { index, offset } = content.findIndex(dist);
  const child = content.maybeChild(index);
  if (offset === dist || !child || child.isText) {
    const result = content.cut(0, dist).append(insert).append(content.cut(dist));
    const { parent, level } = path;
    // An open node of the slice is completed by the document around the replaced range;
    // replace validates it once joined. Checking it here would reject valid content.
    const open = (path.onStart && level <= path.openStart) || (path.onEnd && level <= path.openEnd);
    return parent && !open && !parent.type.validContent(result) ? null : result;
  }
  const inner = insertInto(child.content, dist - offset - 1, insert, {
    ...path,
    parent: child,
    level: path.level + 1,
    onStart: path.onStart && index === 0,
    onEnd: path.onEnd && index === content.childCount - 1,
  });
  return inner && content.replaceChild(index, child.copy(inner));
}

function removeRange(content: Fragment, from: number, to: number): Fragment {
  const { index, offset } = content.findIndex(from);
  const child = content.maybeChild(index);
  const { index: indexTo, offset: offsetTo } = content.findIndex(to);
  if (offset === from || !child || child.isText) {
    if (offsetTo !== to && !content.child(indexTo).isText) {
      throw new RangeError("Removing a non-flat range");
    }
    return content.cut(0, from).append(content.cut(to));
  }
  if (index !== indexTo) throw new RangeError("Removing a non-flat range");
  return content.replaceChild(
    index,
    child.copy(removeRange(child.content, from - offset - 1, to - offset - 1)),
  );
}
