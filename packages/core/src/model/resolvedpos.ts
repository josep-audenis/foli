import type { Node } from "./node.js";

/**
 * A position resolved against a document: the chain of ancestors from the root (depth 0) to the
 * innermost node whose content holds the position, with the child index at each depth.
 * Depth arguments accept negative values, counted up from `depth`.
 */
export class ResolvedPos {
  private constructor(
    readonly pos: number,
    private readonly nodes: readonly Node[],
    private readonly indices: readonly number[],
    private readonly starts: readonly number[],
    /** Offset of `pos` inside its parent's content. */
    readonly parentOffset: number,
    /** Offset of `pos` inside the text node it falls in; 0 between nodes. */
    readonly textOffset: number,
  ) {}

  static resolve(doc: Node, pos: number): ResolvedPos {
    if (!(pos >= 0 && pos <= doc.content.size) || !Number.isInteger(pos)) {
      throw new RangeError(`Position ${pos} out of range 0..${doc.content.size}`);
    }
    const nodes: Node[] = [];
    const indices: number[] = [];
    const starts: number[] = [];
    let node = doc;
    let start = 0;
    let rel = pos;
    for (;;) {
      const { index, offset } = node.content.findIndex(rel);
      nodes.push(node);
      indices.push(index);
      starts.push(start);
      const rest = rel - offset;
      const child = node.content.maybeChild(index);
      if (rest === 0 || !child) return new ResolvedPos(pos, nodes, indices, starts, rel, 0);
      if (child.isText) return new ResolvedPos(pos, nodes, indices, starts, rel, rest);
      node = child;
      start += offset + 1;
      rel = rest - 1;
    }
  }

  /** Number of ancestors above the parent; 0 means the position is directly in the root. */
  get depth(): number {
    return this.nodes.length - 1;
  }

  /** The node whose content holds this position. */
  get parent(): Node {
    return this.node(this.depth);
  }

  get doc(): Node {
    return this.node(0);
  }

  /** The ancestor at `depth`. */
  node(depth = this.depth): Node {
    return this.nodes[this.at(depth)] as Node;
  }

  /** Index into the ancestor at `depth` of the child the position is in or before. */
  index(depth = this.depth): number {
    return this.indices[this.at(depth)] as number;
  }

  /** Index of the child after the position at `depth`. */
  indexAfter(depth = this.depth): number {
    const d = this.at(depth);
    return this.index(d) + (d === this.depth && !this.textOffset ? 0 : 1);
  }

  /** Absolute position where the content of the ancestor at `depth` starts. */
  start(depth = this.depth): number {
    return this.starts[this.at(depth)] as number;
  }

  /** Absolute position where the content of the ancestor at `depth` ends. */
  end(depth = this.depth): number {
    const d = this.at(depth);
    return this.start(d) + this.node(d).content.size;
  }

  /** Absolute position before the ancestor at `depth` (not defined for the root). */
  before(depth = this.depth): number {
    const d = this.at(depth);
    if (!d) throw new RangeError("There is no position before the root node");
    return this.start(d) - 1;
  }

  /** Absolute position after the ancestor at `depth` (not defined for the root). */
  after(depth = this.depth): number {
    const d = this.at(depth);
    if (!d) throw new RangeError("There is no position after the root node");
    return this.end(d) + 1;
  }

  /** The node right after the position (cut if the position is inside text). */
  get nodeAfter(): Node | null {
    const child = this.parent.maybeChild(this.index());
    if (!child) return null;
    return this.textOffset ? child.cut(this.textOffset) : child;
  }

  /** The node right before the position (cut if the position is inside text). */
  get nodeBefore(): Node | null {
    const index = this.index();
    if (this.textOffset) return this.parent.child(index).cut(0, this.textOffset);
    return this.parent.maybeChild(index - 1);
  }

  /** Absolute position of the child at `index` in the ancestor at `depth`. */
  posAtIndex(index: number, depth = this.depth): number {
    const node = this.node(depth);
    let pos = this.start(depth);
    for (let i = 0; i < index; i++) pos += node.child(i).nodeSize;
    return pos;
  }

  /** The deepest depth whose node contains both this position and `pos`. */
  sharedDepth(pos: number): number {
    for (let depth = this.depth; depth > 0; depth--) {
      if (this.start(depth) <= pos && this.end(depth) >= pos) return depth;
    }
    return 0;
  }

  sameParent(other: ResolvedPos): boolean {
    return this.pos - this.parentOffset === other.pos - other.parentOffset;
  }

  toString(): string {
    const path = this.nodes.slice(1).map((node, i) => `${node.type.name}_${this.indices[i]}`);
    return `${path.join("/")}:${this.parentOffset}`;
  }

  private at(depth: number): number {
    const d = depth < 0 ? this.depth + depth : depth;
    if (d < 0 || d > this.depth) throw new RangeError(`Depth ${depth} out of range`);
    return d;
  }
}
