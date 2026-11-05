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

/** A rendered inline leaf (text node or hard break) and where it sits in its block's content. */
export interface LeafDesc {
  readonly dom: Node;
  readonly offset: number;
  readonly size: number;
}

/** View descriptor of one block: the model node, its element and its leaves. */
export interface BlockDesc {
  readonly node: ModelNode;
  readonly dom: HTMLElement;
  readonly leaves: readonly LeafDesc[];
}

/**
 * Renders one textblock with createElement/textContent only (never innerHTML), and records
 * its leaves for position mapping.
 */
export function renderBlock(node: ModelNode, doc: Document): BlockDesc {
  const level = node.attrs.level;
  const dom = doc.createElement(node.type.name === "heading" ? `h${String(level)}` : "p");
  const leaves: LeafDesc[] = [];
  node.forEach((child, offset) => {
    let leaf: Node;
    if (child.isText) leaf = doc.createTextNode(child.text ?? "");
    else leaf = doc.createElement("br");
    leaves.push({ dom: leaf, offset, size: child.nodeSize });
    let outer = leaf;
    // Text only: a mark wrapper around <br> would add nothing visible.
    if (child.isText) {
      for (const mark of [...child.marks].reverse()) {
        const wrapper = doc.createElement(MARK_TAGS.get(mark.type.name) ?? "span");
        wrapper.append(outer);
        outer = wrapper;
      }
    }
    dom.append(outer);
  });
  // An empty block, or one ending in a hard break, needs an extra <br> to show its last line.
  if (!node.lastChild?.isText) dom.append(doc.createElement("br"));
  return { node, dom, leaves };
}
