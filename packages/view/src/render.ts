import type { MarkName, Node as ModelNode } from "@foli/core";

// Every schema v1 mark must have a tag; marks of other schemas fall back to <span>.
const MARK_TAGS: ReadonlyMap<string, string> = new Map(
  Object.entries({
    bold: "strong",
    italic: "em",
    underline: "u",
    strike: "s",
  } satisfies Record<MarkName, string>),
);

/**
 * A rendered inline leaf (a text node or hard break) and where it sits in its block's content.
 * A text node split across fragments is two leaves, one per fragment.
 */
export interface LeafDesc {
  readonly dom: Node;
  readonly offset: number;
  readonly size: number;
}

/**
 * View descriptor of one block: the model node, its elements and its leaves. A block split
 * across pages has one element per page (its fragments, in order); `dom` is the first.
 */
export interface BlockDesc {
  readonly node: ModelNode;
  readonly dom: HTMLElement;
  readonly fragments: readonly HTMLElement[];
  /** Content offsets where each fragment after the first starts (sorted, inside the content). */
  readonly splits: readonly number[];
  readonly leaves: readonly LeafDesc[];
}

/**
 * Renders one textblock with createElement/textContent only (never innerHTML), and records its
 * leaves for position mapping. With `splits`, the content is rendered as several fragments of
 * the same element type: each continued fragment has no bottom margin and each continuation no
 * top margin, so together they take the same height as the whole block.
 */
export function renderBlock(
  node: ModelNode,
  doc: Document,
  splits: readonly number[] = [],
): BlockDesc {
  const tag = node.type.name === "heading" ? `h${String(node.attrs.level)}` : "p";
  const fragments = [0, ...splits].map((_, i, all) => {
    const fragment = doc.createElement(tag);
    if (all.length > 1) {
      fragment.dataset.fragment = String(i);
      if (i > 0) fragment.style.marginTop = "0";
      if (i < all.length - 1) fragment.style.marginBottom = "0";
    }
    return fragment;
  });
  const leaves: LeafDesc[] = [];
  /** The fragment that holds content offset `at` (a split offset starts the next fragment). */
  const fragmentAt = (at: number) => {
    let i = 0;
    while (i < splits.length && (splits[i] as number) <= at) i++;
    return fragments[i] as HTMLElement;
  };
  node.forEach((child, offset) => {
    if (!child.isText) {
      const br = doc.createElement("br");
      leaves.push({ dom: br, offset, size: child.nodeSize });
      // Text only: a mark wrapper around <br> would add nothing visible.
      fragmentAt(offset).append(br);
      return;
    }
    const text = child.text ?? "";
    const cuts = splits.filter((split) => split > offset && split < offset + text.length);
    let from = offset;
    for (const to of [...cuts, offset + text.length]) {
      const leaf = doc.createTextNode(text.slice(from - offset, to - offset));
      leaves.push({ dom: leaf, offset: from, size: to - from });
      let outer: Node = leaf;
      for (const mark of [...child.marks].reverse()) {
        const wrapper = doc.createElement(MARK_TAGS.get(mark.type.name) ?? "span");
        wrapper.append(outer);
        outer = wrapper;
      }
      fragmentAt(from).append(outer);
      from = to;
    }
  });
  // An empty block, or one ending in a hard break, needs an extra <br> to show its last line.
  if (!node.lastChild?.isText)
    (fragments[fragments.length - 1] as HTMLElement).append(doc.createElement("br"));
  const dom = fragments[0] as HTMLElement;
  return { node, dom, fragments, splits, leaves };
}
