import type { Attrs, Node, NodeRange, NodeType } from "../model/index.js";

/** A node type with attributes, as `findWrapping` returns and `Transform.wrap`/`split` take. */
export interface NodeTypeWithAttrs {
  type: NodeType;
  attrs?: Attrs | null;
}

/**
 * The depth the blocks of `range` can be lifted to (out of their parent, e.g. out of a list
 * item), or null when they cannot be lifted. Ancestors are split around the range as needed.
 */
export function liftTarget(range: NodeRange): number | null {
  const moved = range.parent.content.cutByIndex(range.startIndex, range.endIndex);
  // Once an ancestor is split, the part before (after) the range stays as a node of its own in
  // the ancestor above, next to where the range would go.
  let partBefore = false;
  let partAfter = false;
  for (let depth = range.depth; depth >= 0; depth--) {
    const node = range.$from.node(depth);
    const start: number = range.$from.index(depth) + (partBefore ? 1 : 0);
    const end: number = range.$to.indexAfter(depth) - (partAfter ? 1 : 0);
    if (depth < range.depth && node.canReplace(start, end, moved)) return depth;
    if (depth === 0) return null;
    // What stays of `node` on either side of the range must be valid on its own.
    const before: boolean = start > 0;
    const after: boolean = end < node.childCount;
    if (before && !node.canReplace(start, node.childCount)) return null;
    if (after && !node.canReplace(0, end)) return null;
    partBefore ||= before;
    partAfter ||= after;
  }
  return null;
}

/**
 * The wrappers (outermost first) that put the blocks of `range` inside a node of `type`: any
 * wrappers its parent needs around `type`, `type` itself, then any wrappers needed between
 * `type` and the blocks (for a list: the list, then a list item). Null when impossible.
 */
export function findWrapping(
  range: NodeRange,
  type: NodeType,
  attrs: Attrs | null = null,
): NodeTypeWithAttrs[] | null {
  const { parent, startIndex, endIndex } = range;
  // Wrappers the parent needs around `type`; the outermost replaces the range.
  const outside = parent.contentMatchAt(startIndex).findWrapping(type);
  if (!outside || !parent.canReplaceWith(startIndex, endIndex, outside[0] ?? type)) return null;
  // Wrappers `type` needs around the blocks; the innermost must take all of them.
  const inside = type.contentMatch.findWrapping(parent.child(startIndex).type);
  if (!inside) return null;
  const innermost = inside[inside.length - 1] ?? type;
  if (!innermost.contentMatch.matchFragment(parent.content, startIndex, endIndex)?.validEnd) {
    return null;
  }
  const bare = (t: NodeType): NodeTypeWithAttrs => ({ type: t, attrs: null });
  return [...outside.map(bare), { type, attrs }, ...inside.map(bare)];
}

/**
 * Whether splitting at `pos` through `depth` ancestors is valid, giving the new nodes after the
 * split the types in `typesAfter`: entry 0 for the outermost split node, entry `depth - 1` for
 * the innermost (the one holding `pos`); missing or null entries keep the original type.
 */
export function canSplit(
  doc: Node,
  pos: number,
  depth = 1,
  typesAfter?: readonly (NodeTypeWithAttrs | null | undefined)[],
): boolean {
  const $pos = doc.resolve(pos);
  const base = $pos.depth - depth;
  if (base < 0) return false;
  if (typesAfter?.some((entry) => entry && !attrsValid(entry))) return false;
  // Each split node, innermost first: the part before must stay valid, and the part after must
  // be valid content for the type it gets.
  for (let level = depth - 1; level >= 0; level--) {
    const node = $pos.node(base + 1 + level);
    const index = $pos.index(base + 1 + level);
    let rest = node.content.cutByIndex(index, node.childCount);
    const innermost = level === depth - 1;
    // Above the innermost, the split child is the start of the next level's part after.
    const below = innermost ? undefined : typesAfter?.[level + 1];
    if (below) rest = rest.replaceChild(0, below.type.createOpen(below.attrs));
    const keeps = node.canReplace(innermost ? index : index + 1, node.childCount);
    if (!keeps || !(typesAfter?.[level]?.type ?? node.type).validContent(rest)) return false;
  }
  // The new node must fit next to the old one in the node that is not split.
  const index = $pos.indexAfter(base);
  const outerType = typesAfter?.[0]?.type ?? $pos.node(base + 1).type;
  return $pos.node(base).canReplaceWith(index, index, outerType);
}

function attrsValid({ type, attrs }: NodeTypeWithAttrs): boolean {
  try {
    type.createOpen(attrs);
    return true;
  } catch {
    return false;
  }
}

/** Whether the nodes on either side of `pos` can be joined into one. */
export function canJoin(doc: Node, pos: number): boolean {
  if (pos <= 0 || pos >= doc.content.size) return false;
  const $pos = doc.resolve(pos);
  const { nodeBefore: before, nodeAfter: after } = $pos;
  // A leaf after the boundary has no content to join: "joining" would delete it.
  if (!before || !after || before.isLeaf || after.isLeaf) return false;
  // Even empty content needs types that take the same kind of content.
  if (!before.type.compatibleContent(after.type)) return false;
  const index = $pos.index();
  const end = before.childCount;
  return before.canReplace(end, end, after.content) && $pos.parent.canReplace(index, index + 1);
}
