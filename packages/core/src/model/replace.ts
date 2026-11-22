import { ReplaceError } from "./errors.js";
import { Fragment } from "./fragment.js";
import type { Node } from "./node.js";
import type { ResolvedPos } from "./resolvedpos.js";
import type { Slice } from "./slice.js";

/**
 * Replaces `$from..$to` with `slice`. Nodes cut open at either side of the range are joined
 * with the open nodes of the slice; every rebuilt node is validated against the schema.
 *
 * The result is built like a stream of tokens: the open ancestors of `$from` form a stack of
 * nodes under construction, the slice's content is fed into that stack (its open start lands in
 * the nodes already open, its open end leaves new nodes open), and finally the content after
 * `$to` closes the stack level by level.
 */
export function replace($from: ResolvedPos, $to: ResolvedPos, slice: Slice): Node {
  if (slice.openStart > $from.depth) {
    throw new ReplaceError("Inserted content is deeper than the insertion position");
  }
  // The depth whose content receives the slice's top-level nodes, seen from either end.
  const base = $from.depth - slice.openStart;
  if (base !== $to.depth - slice.openEnd) throw new ReplaceError("Inconsistent open depths");

  // Ancestors that hold both ends in the same child are copied with that one child swapped;
  // nothing else in them changes, so they need no validation.
  let top = 0;
  while (top < base && $from.index(top) === $to.index(top)) top++;

  const builder = new Builder($from, top);
  builder.feed(base, slice.content, slice.openStart, slice.openEnd);
  let node = builder.finish($to);
  for (let depth = top - 1; depth >= 0; depth--) {
    const parent = $from.node(depth);
    node = parent.copy(parent.content.replaceChild($from.index(depth), node));
  }
  return node;
}

/** A node being rebuilt: its children so far, and the node whose type and attributes it keeps. */
interface Open {
  node: Node;
  /** The last node whose content was merged into this one (checked against what joins next). */
  joined: Node;
  children: Node[];
}

class Builder {
  private readonly stack: Open[] = [];

  /** Opens the ancestors of `$from` from `top` down, each holding its content before `$from`. */
  constructor(
    $from: ResolvedPos,
    private readonly top: number,
  ) {
    for (let depth = top; depth <= $from.depth; depth++) {
      const node = $from.node(depth);
      const children: Node[] = [];
      const end = $from.index(depth);
      for (let i = 0; i < end; i++) children.push(node.child(i));
      if (depth === $from.depth && $from.textOffset) children.push($from.nodeBefore as Node);
      this.stack.push({ node, joined: node, children });
    }
  }

  /** The open node at `depth`, if the stack reaches it. */
  private at(depth: number): Open | undefined {
    return this.stack[depth - this.top];
  }

  /** Closes the open nodes deeper than `depth`, each into its parent. */
  private closeBelow(depth: number): void {
    while (this.stack.length > depth - this.top + 1) {
      const open = this.stack.pop() as Open;
      (this.stack[this.stack.length - 1] as Open).children.push(complete(open));
    }
  }

  /**
   * Adds `content` to the open node at `depth`. With `openStart`, its first child continues the
   * node open one level deeper; with `openEnd`, its last child stays open for what follows.
   */
  feed(depth: number, content: Fragment, openStart: number, openEnd: number): void {
    const last = content.childCount - 1;
    content.forEach((child, _offset, i) => {
      if (i === 0 && openStart > 0) {
        const inner = this.at(depth + 1) as Open;
        mustJoin(inner.node, child);
        inner.joined = child;
        this.feed(depth + 1, child.content, openStart - 1, i === last && openEnd ? openEnd - 1 : 0);
        return;
      }
      this.closeBelow(depth);
      if (i === last && openEnd > 0) {
        this.stack.push({ node: child, joined: child, children: [] });
        this.feed(depth + 1, child.content, 0, openEnd - 1);
      } else {
        (this.at(depth) as Open).children.push(child);
      }
    });
  }

  /** Appends the content after `$to` at every level and closes the stack into one node. */
  finish($to: ResolvedPos): Node {
    this.closeBelow($to.depth);
    if (this.stack.length !== $to.depth - this.top + 1) {
      throw new ReplaceError("Inconsistent open depths");
    }
    for (let depth = $to.depth; depth >= this.top; depth--) {
      const open = this.at(depth) as Open;
      const after = $to.node(depth);
      mustJoin(open.joined, after);
      let index = $to.index(depth);
      if (depth < $to.depth) {
        index++;
      } else if ($to.textOffset) {
        open.children.push($to.nodeAfter as Node);
        index++;
      }
      for (; index < after.childCount; index++) open.children.push(after.child(index));
      if (depth > this.top) this.closeBelow(depth - 1);
    }
    return complete(this.stack[0] as Open);
  }
}

/** Throws unless `next`'s content can continue `node`'s. */
function mustJoin(node: Node, next: Node): void {
  if (!next.type.compatibleContent(node.type)) {
    throw new ReplaceError(`Cannot join ${next.type.name} onto ${node.type.name}`);
  }
}

/** The open node with its children, validated (adjacent text is merged by Fragment.fromArray). */
function complete(open: Open): Node {
  const content = Fragment.fromArray(open.children);
  if (!open.node.type.validContent(content)) {
    throw new ReplaceError(`Invalid content for node ${open.node.type.name}`);
  }
  return open.node.copy(content);
}
