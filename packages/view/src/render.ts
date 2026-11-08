import type { Mark, Node as ModelNode, SimpleMarkName } from "@folijs/core";

// Every mark without attributes has a tag. Marks with attributes are rendered by `markElement`;
// marks of other schemas fall back to <span>.
const MARK_TAGS: ReadonlyMap<string, string> = new Map(
  Object.entries({
    bold: "strong",
    italic: "em",
    underline: "u",
    strike: "s",
  } satisfies Record<SimpleMarkName, string>),
);

/** Marks the <br> of an explicit page break. */
export const PAGE_BREAK_ATTR = "data-page-break";

/** Marks a container element (list, list item) the view created around blocks. */
export const WRAPPER_ATTR = "data-foli-wrapper";

/** The element for a container node: lists and list items; anything else is a <div>. */
const WRAPPER_TAGS: ReadonlyMap<string, string> = new Map([
  ["bulletList", "ul"],
  ["orderedList", "ol"],
  ["listItem", "li"],
]);

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

/** The element for a mark: a tag, a link, or a span with a color. Values come validated. */
function markElement(mark: Mark, doc: Document): HTMLElement {
  const { name } = mark.type;
  if (name === "link") {
    const a = doc.createElement("a");
    // The schema only lets safe hrefs into a document (isSafeHref); clicks do not navigate.
    a.setAttribute("href", String(mark.attrs.href));
    return a;
  }
  const element = doc.createElement(MARK_TAGS.get(name) ?? "span");
  if (name === "textColor") element.style.color = String(mark.attrs.color);
  if (name === "highlight") element.style.backgroundColor = String(mark.attrs.color);
  return element;
}

/** The element for a block: a heading or paragraph tag, or a rule. */
function blockTag(node: ModelNode): string {
  if (node.type.name === "heading") return `h${String(node.attrs.level)}`;
  if (node.type.name === "horizontalRule") return "hr";
  return "p";
}

/**
 * Renders one leaf block (a textblock, or a block leaf such as a rule) with
 * createElement/textContent only (never innerHTML), and records its leaves for position
 * mapping. With `splits`, a textblock's content is rendered as several fragments of the same
 * element type: each continued fragment has no bottom margin and each continuation no top
 * margin, so together they take the same height as the whole block.
 */
export function renderBlock(
  node: ModelNode,
  doc: Document,
  splits: readonly number[] = [],
): BlockDesc {
  const tag = blockTag(node);
  const align = node.attrs.align;
  const fragments = [0, ...splits].map((_, i, all) => {
    const fragment = doc.createElement(tag);
    if (typeof align === "string" && align !== "start") fragment.style.textAlign = align;
    if (all.length > 1) {
      fragment.dataset.fragment = String(i);
      if (i > 0) fragment.style.marginTop = "0";
      if (i < all.length - 1) {
        fragment.style.marginBottom = "0";
        // A fragment's last line is not the paragraph's last line: justified text stays
        // justified up to the page break (CSS would align a block's last line to the start).
        if (align === "justify") fragment.style.textAlignLast = "justify";
      }
    }
    return fragment;
  });
  const leaves: LeafDesc[] = [];
  const dom = fragments[0] as HTMLElement;
  // A block leaf (a rule) has no content: nothing to map, nothing to split.
  if (!node.isTextblock) return { node, dom, fragments, splits, leaves };
  /** The fragment that holds content offset `at` (a split offset starts the next fragment). */
  const fragmentAt = (at: number) => {
    let i = 0;
    while (i < splits.length && (splits[i] as number) <= at) i++;
    return fragments[i] as HTMLElement;
  };
  node.forEach((child, offset) => {
    if (!child.isText) {
      // A hard break or a page break: both end their line (the flow ends the page at a page break).
      const br = doc.createElement("br");
      if (child.type.name === "pageBreak") br.setAttribute(PAGE_BREAK_ATTR, "");
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
      // Marks are in canonical order, outermost first (a link wraps the formatting inside it).
      for (const mark of [...child.marks].reverse()) {
        const wrapper = markElement(mark, doc);
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
  return { node, dom, fragments, splits, leaves };
}

/**
 * Creates the element for a container (list, list item). It takes no vertical space of its own
 * (block margins and paddings 0): the page flow treats the blocks inside as siblings, whose
 * margins collapse through it (ADR-0004).
 */
/** Every container element the view created (a set: checked for every block on every render). */
const wrappers = new WeakSet<Node>();

export function createWrapper(node: ModelNode, doc: Document): HTMLElement {
  const element = doc.createElement(WRAPPER_TAGS.get(node.type.name) ?? "div");
  element.setAttribute(WRAPPER_ATTR, "");
  wrappers.add(element);
  const { style } = element;
  style.marginTop = style.marginBottom = style.paddingTop = style.paddingBottom = "0";
  return element;
}

/** Whether `element` is the container element `createWrapper` makes for `node`. */
export function isWrapperFor(element: Node | null, node: ModelNode): element is HTMLElement {
  return (
    element !== null &&
    wrappers.has(element) &&
    (element as HTMLElement).localName === (WRAPPER_TAGS.get(node.type.name) ?? "div")
  );
}

/** Whether `node` is a container element the view created. */
export function isWrapper(node: Node | null): node is HTMLElement {
  return node !== null && wrappers.has(node);
}

/**
 * Renders a fragment of blocks as one DOM tree, for the clipboard: containers become their
 * elements (with the list's start number), leaf blocks as in the editor, unsplit.
 */
export function renderTree(content: Iterable<ModelNode>, parent: Node, doc: Document): void {
  for (const node of content) {
    if (node.isTextblock || node.isLeaf) {
      parent.appendChild(renderBlock(node, doc).dom);
      continue;
    }
    const element = createWrapper(node, doc);
    wrappers.delete(element);
    element.removeAttribute(WRAPPER_ATTR);
    element.removeAttribute("style");
    const start = node.attrs.start;
    if (typeof start === "number" && start !== 1) element.setAttribute("start", String(start));
    renderTree(node.content.content, element, doc);
    parent.appendChild(element);
  }
}
