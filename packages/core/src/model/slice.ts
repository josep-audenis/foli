import { Fragment } from "./fragment.js";
import type { NodeJSON } from "./node.js";

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
