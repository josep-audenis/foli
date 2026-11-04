import { Mark } from "./mark.js";
import type { Node, NodeJSON, TextNode } from "./node.js";

/**
 * An immutable sequence of child nodes with its total size in positions. Adjacent text nodes
 * with equal marks are always merged, so every fragment is in normal form.
 */
export class Fragment {
  static readonly empty = new Fragment([], 0);

  private constructor(
    readonly content: readonly Node[],
    /** Total size of the children, in positions. */
    readonly size: number,
  ) {}

  /** Builds a fragment, merging adjacent text nodes with equal marks. */
  static fromArray(nodes: readonly Node[]): Fragment {
    if (!nodes.length) return Fragment.empty;
    const out: Node[] = [];
    let size = 0;
    for (const node of nodes) {
      size += node.nodeSize;
      const last = out[out.length - 1];
      if (last?.isText && node.isText && Mark.sameSet(last.marks, node.marks)) {
        out[out.length - 1] = (last as TextNode).withText(last.textContent + node.textContent);
      } else {
        out.push(node);
      }
    }
    return new Fragment(out, size);
  }

  static from(nodes?: Fragment | Node | readonly Node[] | null): Fragment {
    if (!nodes) return Fragment.empty;
    if (nodes instanceof Fragment) return nodes;
    return Fragment.fromArray(Array.isArray(nodes) ? nodes : [nodes as Node]);
  }

  get childCount(): number {
    return this.content.length;
  }

  get firstChild(): Node | null {
    return this.content[0] ?? null;
  }

  get lastChild(): Node | null {
    return this.content[this.content.length - 1] ?? null;
  }

  child(index: number): Node {
    const child = this.content[index];
    if (!child)
      throw new RangeError(`Index ${index} out of range for fragment of ${this.childCount}`);
    return child;
  }

  maybeChild(index: number): Node | null {
    return this.content[index] ?? null;
  }

  /** Calls `f` for each child with its offset inside this fragment and its index. */
  forEach(f: (node: Node, offset: number, index: number) => void): void {
    for (let i = 0, offset = 0; i < this.content.length; i++) {
      const child = this.content[i] as Node;
      f(child, offset, i);
      offset += child.nodeSize;
    }
  }

  /**
   * Calls `f` for every node overlapping `from..to`, depth first, with its absolute position
   * (`nodeStart` is the position of this fragment's start). Return false to skip a node's children.
   */
  nodesBetween(
    from: number,
    to: number,
    f: (node: Node, pos: number, parent: Node | null, index: number) => boolean | undefined,
    nodeStart = 0,
    parent: Node | null = null,
  ): void {
    for (let i = 0, pos = 0; pos < to && i < this.content.length; i++) {
      const child = this.content[i] as Node;
      const end = pos + child.nodeSize;
      if (end > from && f(child, nodeStart + pos, parent, i) !== false && child.content.size) {
        const start = pos + 1;
        child.content.nodesBetween(
          Math.max(0, from - start),
          Math.min(child.content.size, to - start),
          f,
          nodeStart + start,
          child,
        );
      }
      pos = end;
    }
  }

  /** Text between two positions; `blockSeparator` goes between textblocks, `leafText` for leaves. */
  textBetween(from: number, to: number, blockSeparator = "", leafText = ""): string {
    let text = "";
    let first = true;
    this.nodesBetween(from, to, (node, pos) => {
      if (node.isTextblock) {
        if (!first) text += blockSeparator;
        first = false;
      } else if (node.isText) {
        text += node.textContent.slice(Math.max(from, pos) - pos, to - pos);
      } else if (node.isLeaf) {
        text += leafText;
      }
      return undefined;
    });
    return text;
  }

  /** Concatenates, merging text across the boundary. */
  append(other: Fragment): Fragment {
    if (!other.size) return this;
    if (!this.size) return other;
    return Fragment.fromArray([...this.content, ...other.content]);
  }

  /** The part of this fragment between two offsets; nodes cut in half become open copies. */
  cut(from: number, to = this.size): Fragment {
    if (from <= 0 && to >= this.size) return this;
    if (from >= to) return Fragment.empty;
    const result: Node[] = [];
    let size = 0;
    for (let i = 0, pos = 0; pos < to; i++) {
      let child = this.content[i] as Node;
      const end = pos + child.nodeSize;
      if (end > from) {
        if (pos < from || end > to) {
          child = child.isText
            ? child.cut(Math.max(0, from - pos), Math.min(child.nodeSize, to - pos))
            : child.cut(Math.max(0, from - pos - 1), Math.min(child.content.size, to - pos - 1));
        }
        result.push(child);
        size += child.nodeSize;
      }
      pos = end;
    }
    return new Fragment(result, size);
  }

  /** A copy with the child at `index` replaced. Does not merge text; callers keep normal form. */
  replaceChild(index: number, node: Node): Fragment {
    const current = this.child(index);
    if (current === node) return this;
    const content = this.content.slice();
    content[index] = node;
    return new Fragment(content, this.size - current.nodeSize + node.nodeSize);
  }

  /** The child containing `pos`, or the child starting at `pos`; `index` = childCount at the end. */
  findIndex(pos: number): { index: number; offset: number } {
    if (pos === 0) return { index: 0, offset: 0 };
    if (pos === this.size) return { index: this.content.length, offset: pos };
    if (pos < 0 || pos > this.size) throw new RangeError(`Position ${pos} outside fragment`);
    for (let i = 0, offset = 0; ; i++) {
      const end = offset + (this.content[i] as Node).nodeSize;
      if (end > pos) return { index: i, offset };
      offset = end;
    }
  }

  eq(other: Fragment): boolean {
    if (this === other) return true;
    if (this.content.length !== other.content.length) return false;
    return this.content.every((node, i) => node.eq(other.content[i] as Node));
  }

  toJSON(): NodeJSON[] {
    return this.content.map((node) => node.toJSON());
  }

  toString(): string {
    return `<${this.content.join(", ")}>`;
  }
}
