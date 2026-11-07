// The structure helpers follow the design of prosemirror-transform's structure.ts (MIT, see
// THIRD_PARTY_NOTICES.md); independent implementation on Foli's model.
import type { Attrs, Node, NodeRange, NodeType } from "../model/index.js";

/** A node type with attributes, as `findWrapping` returns and `Transform.wrap`/`split` take. */
export interface NodeTypeWithAttrs {
  type: NodeType;
  attrs?: Attrs | null;
}

/** Whether the children of `node` before `start` and from `end` on are valid on their own. */
function canCut(node: Node, start: number, end: number): boolean {
  return (
    (start === 0 || node.canReplace(start, node.childCount)) &&
    (end === node.childCount || node.canReplace(0, end))
  );
}

/**
 * The depth the blocks of `range` can be lifted to (out of their parent, e.g. out of a list
 * item), or null when they cannot be lifted. Ancestors are split around the range as needed.
 */
export function liftTarget(range: NodeRange): number | null {
  const content = range.parent.content.cutByIndex(range.startIndex, range.endIndex);
  for (let depth = range.depth; ; depth--) {
    const node = range.$from.node(depth);
    const index = range.$from.index(depth);
    const endIndex = range.$to.indexAfter(depth);
    if (depth < range.depth && node.canReplace(index, endIndex, content)) return depth;
    if (depth === 0 || !canCut(node, index, endIndex)) return null;
  }
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
  const around = wrappingOutside(range, type);
  const inner = around && wrappingInside(range, type);
  if (!around || !inner) return null;
  return [
    ...around.map((t) => ({ type: t, attrs: null })),
    { type, attrs },
    ...inner.map((t) => ({ type: t, attrs: null })),
  ];
}

function wrappingOutside(range: NodeRange, type: NodeType): readonly NodeType[] | null {
  const { parent, startIndex, endIndex } = range;
  const around = parent.contentMatchAt(startIndex).findWrapping(type);
  if (!around) return null;
  const outer = around[0] ?? type;
  return parent.canReplaceWith(startIndex, endIndex, outer) ? around : null;
}

function wrappingInside(range: NodeRange, type: NodeType): readonly NodeType[] | null {
  const { parent, startIndex, endIndex } = range;
  const inside = type.contentMatch.findWrapping(parent.child(startIndex).type);
  if (!inside) return null;
  let match = (inside[inside.length - 1] ?? type).contentMatch;
  for (let i = startIndex; i < endIndex; i++) {
    const next = match.matchType(parent.child(i).type);
    if (!next) return null;
    match = next;
  }
  return match.validEnd ? inside : null;
}

/**
 * Whether splitting at `pos` through `depth` ancestors is valid, giving the new nodes after the
 * split the types in `typesAfter` (outermost first; missing entries keep the original type).
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
  const innerType = typesAfter?.[typesAfter.length - 1]?.type ?? $pos.parent.type;
  if (
    !$pos.parent.canReplace($pos.index(), $pos.parent.childCount) ||
    !innerType.validContent($pos.parent.content.cutByIndex($pos.index(), $pos.parent.childCount))
  ) {
    return false;
  }
  for (let d = $pos.depth - 1, i = depth - 2; d > base; d--, i--) {
    const node = $pos.node(d);
    const index = $pos.index(d);
    let rest = node.content.cutByIndex(index, node.childCount);
    const override = typesAfter?.[i + 1];
    if (override) {
      rest = rest.replaceChild(0, override.type.createOpen(override.attrs));
    }
    const after = typesAfter?.[i]?.type ?? node.type;
    if (!node.canReplace(index + 1, node.childCount) || !after.validContent(rest)) return false;
  }
  const index = $pos.indexAfter(base);
  const baseType = typesAfter?.[0]?.type ?? $pos.node(base + 1).type;
  return $pos.node(base).canReplaceWith(index, index, baseType);
}

/** Whether the nodes on either side of `pos` can be joined into one. */
export function canJoin(doc: Node, pos: number): boolean {
  if (pos <= 0 || pos >= doc.content.size) return false;
  const $pos = doc.resolve(pos);
  const before = $pos.nodeBefore;
  const after = $pos.nodeAfter;
  // A leaf after the boundary has no content to join: "joining" would delete it.
  if (!before || !after || before.isLeaf || after.isLeaf) return false;
  const index = $pos.index();
  return (
    before.canReplace(before.childCount, before.childCount, after.content) &&
    $pos.parent.canReplace(index, index + 1)
  );
}
