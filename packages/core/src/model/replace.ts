// The algorithm follows the design of prosemirror-model's replace (MIT, see
// THIRD_PARTY_NOTICES.md); this is an independent implementation.
import { ReplaceError } from "./errors.js";
import { Fragment } from "./fragment.js";
import type { Node } from "./node.js";
import type { ResolvedPos } from "./resolvedpos.js";
import type { Slice } from "./slice.js";

/**
 * Replaces `$from..$to` with `slice`. Nodes cut open at either side of the range are joined
 * with the open nodes of the slice; every rebuilt node is validated against the schema.
 */
export function replace($from: ResolvedPos, $to: ResolvedPos, slice: Slice): Node {
  if (slice.openStart > $from.depth) {
    throw new ReplaceError("Inserted content is deeper than the insertion position");
  }
  if ($from.depth - slice.openStart !== $to.depth - slice.openEnd) {
    throw new ReplaceError("Inconsistent open depths");
  }
  return replaceOuter($from, $to, slice, 0);
}

function replaceOuter($from: ResolvedPos, $to: ResolvedPos, slice: Slice, depth: number): Node {
  const index = $from.index(depth);
  const node = $from.node(depth);
  if (index === $to.index(depth) && depth < $from.depth - slice.openStart) {
    // Both ends are inside the same child: rebuild only that child.
    const inner = replaceOuter($from, $to, slice, depth + 1);
    return node.copy(node.content.replaceChild(index, inner));
  }
  if (!slice.content.size) return close(node, replaceTwoWay($from, $to, depth));
  if (!slice.openStart && !slice.openEnd && $from.depth === depth && $to.depth === depth) {
    // Flat insertion into one parent.
    const content = node.content;
    return close(
      node,
      content
        .cut(0, $from.parentOffset)
        .append(slice.content)
        .append(content.cut($to.parentOffset)),
    );
  }
  const { start, end } = placeSlice(slice, $from);
  return close(node, replaceThreeWay($from, start, end, $to, depth));
}

/** Wraps the slice in copies of `$along`'s ancestors so its open ends can be resolved. */
function placeSlice(slice: Slice, $along: ResolvedPos): { start: ResolvedPos; end: ResolvedPos } {
  const extra = $along.depth - slice.openStart;
  let node = $along.node(extra).copy(slice.content);
  for (let depth = extra - 1; depth >= 0; depth--) {
    node = $along.node(depth).copy(Fragment.from(node));
  }
  return {
    start: node.resolve(slice.openStart + extra),
    end: node.resolve(node.content.size - slice.openEnd - extra),
  };
}

function replaceThreeWay(
  $from: ResolvedPos,
  $start: ResolvedPos,
  $end: ResolvedPos,
  $to: ResolvedPos,
  depth: number,
): Fragment {
  const openStart = $from.depth > depth ? joinable($from, $start, depth + 1) : null;
  const openEnd = $to.depth > depth ? joinable($end, $to, depth + 1) : null;
  const content: Node[] = [];
  addRange(null, $from, depth, content);
  if (openStart && openEnd && $start.index(depth) === $end.index(depth)) {
    checkJoin(openStart, openEnd);
    content.push(close(openStart, replaceThreeWay($from, $start, $end, $to, depth + 1)));
  } else {
    if (openStart) content.push(close(openStart, replaceTwoWay($from, $start, depth + 1)));
    addRange($start, $end, depth, content);
    if (openEnd) content.push(close(openEnd, replaceTwoWay($end, $to, depth + 1)));
  }
  addRange($to, null, depth, content);
  return Fragment.fromArray(content);
}

function replaceTwoWay($from: ResolvedPos, $to: ResolvedPos, depth: number): Fragment {
  const content: Node[] = [];
  addRange(null, $from, depth, content);
  if ($from.depth > depth) {
    const node = joinable($from, $to, depth + 1);
    content.push(close(node, replaceTwoWay($from, $to, depth + 1)));
  }
  addRange($to, null, depth, content);
  return Fragment.fromArray(content);
}

/**
 * Pushes the children of the node at `depth` between `$start` and `$end` (either may be
 * open-ended). Adjacent text is merged later by Fragment.fromArray.
 */
function addRange(
  $start: ResolvedPos | null,
  $end: ResolvedPos | null,
  depth: number,
  target: Node[],
): void {
  const node = (($end ?? $start) as ResolvedPos).node(depth);
  let startIndex = 0;
  const endIndex = $end ? $end.index(depth) : node.childCount;
  if ($start) {
    startIndex = $start.index(depth);
    if ($start.depth > depth) {
      startIndex++;
    } else if ($start.textOffset) {
      target.push($start.nodeAfter as Node);
      startIndex++;
    }
  }
  for (let i = startIndex; i < endIndex; i++) target.push(node.child(i));
  if ($end && $end.depth === depth && $end.textOffset) target.push($end.nodeBefore as Node);
}

function joinable($before: ResolvedPos, $after: ResolvedPos, depth: number): Node {
  const node = $before.node(depth);
  checkJoin(node, $after.node(depth));
  return node;
}

function checkJoin(main: Node, sub: Node): void {
  if (!sub.type.compatibleContent(main.type)) {
    throw new ReplaceError(`Cannot join ${sub.type.name} onto ${main.type.name}`);
  }
}

function close(node: Node, content: Fragment): Node {
  if (!node.type.validContent(content)) {
    throw new ReplaceError(`Invalid content for node ${node.type.name}`);
  }
  return node.copy(content);
}
