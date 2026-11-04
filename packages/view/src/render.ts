import type { BlockJSON, DocJSON, InlineJSON, MarkType } from "@foli/core";

const MARK_TAGS: Record<MarkType, string> = {
  bold: "strong",
  italic: "em",
  underline: "u",
  strike: "s",
};

/**
 * Renders validated content to DOM. Read-only: the first piece of the Foli view.
 * Content is built with createElement/textContent only — never innerHTML — so text is never
 * interpreted as markup. Editing, position mapping and pagination arrive in Phases 4–5.
 */
export function renderContent(
  content: DocJSON,
  ownerDocument: Document = document,
): DocumentFragment {
  const fragment = ownerDocument.createDocumentFragment();
  for (const block of content.content) fragment.append(renderBlock(block, ownerDocument));
  return fragment;
}

function renderBlock(block: BlockJSON, doc: Document): HTMLElement {
  const element = doc.createElement(block.type === "heading" ? `h${block.attrs.level}` : "p");
  if (!block.content?.length) {
    // An empty block still needs a line box so it occupies height (and, later, can hold a caret).
    element.append(doc.createElement("br"));
    return element;
  }
  for (const inline of block.content) element.append(renderInline(inline, doc));
  return element;
}

function renderInline(inline: InlineJSON, doc: Document): Node {
  if (inline.type === "hardBreak") return doc.createElement("br");
  let node: Node = doc.createTextNode(inline.text);
  for (const mark of [...(inline.marks ?? [])].reverse()) {
    const wrapper = doc.createElement(MARK_TAGS[mark.type]);
    wrapper.append(node);
    node = wrapper;
  }
  return node;
}
