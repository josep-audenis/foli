/**
 * Schema v3 blocks for the editable view (8.7a): the paragraphs of `blocks.ts`, rendered from
 * model nodes with their leaves (the text nodes and elements positions map to), split into
 * fragments at content offsets like the v2 blocks (`render.ts`), and what the page flow needs
 * of each: Word's paragraph spacing and keep rules. Built with createElement/textContent only.
 *
 * Tracked changes are shown as markup (inserted and deleted text both shown). Content the model
 * keeps opaque is shown from its XML and cannot be edited: an opaque block is a block leaf, an
 * opaque inline node a leaf element.
 */
import {
  isSafeHref,
  type ListMarker,
  type Mark,
  type MarkJSON,
  type Node as ModelNode,
  type RunFormat,
  type WordContext,
} from "@folijs/core";
import type { BlockDesc, LeafDesc } from "../render.js";
import {
  fontStack,
  latin,
  lineHeight,
  markerElement,
  opaqueBlock,
  opaqueText,
  PX_PER_TWIP,
  parseOpaque,
  styleParagraph,
  styleRun,
  tagOf,
  WORD_PAGE_BREAK_ATTR,
} from "./blocks.js";

/** What the page flow needs to know about a v3 block. */
export interface WordInfo {
  /** Space before and after in CSS px (Word adds them: the flow places them). */
  before: number;
  after: number;
  keepNext: boolean;
  keepLines: boolean;
  pageBreakBefore: boolean;
  /** The paragraph's style and whether it drops spacing next to the same style. */
  style: string | null;
  contextual: boolean;
}

/** A rendered v3 block: a view block plus its flow information and what it was rendered for. */
export interface WordBlockDesc extends BlockDesc {
  readonly word: WordInfo;
  /** What the rendering depends on besides the node (its marker, open comments). */
  readonly key: string;
}

/**
 * Renders the blocks of one v3 document for the editable view. `prepare` runs before each
 * render: list numbers and comment ranges depend on the blocks before.
 */
export class WordRenderer {
  readonly #context: WordContext;
  readonly #doc: Document;
  readonly #ratio: (family: string) => number;
  /** For the clipboard (`clipboardBlocks`): links as links, list numbers as Word's HTML has them. */
  readonly #clipboard: boolean;
  #markers: (ListMarker | null)[] = [];
  /** Comment ranges open at the start of each block. */
  #comments: number[][] = [];

  constructor(
    context: WordContext,
    doc: Document,
    ratio: (family: string) => number,
    clipboard = false,
  ) {
    this.#context = context;
    this.#doc = doc;
    this.#ratio = ratio;
    this.#clipboard = clipboard;
  }

  get context(): WordContext {
    return this.#context;
  }

  /** Numbering and comment state per top-level node of `doc`. */
  prepare(doc: ModelNode): void {
    const attrs: Record<string, unknown>[] = [];
    const comments: number[][] = [];
    const open = new Set<number>();
    doc.forEach((node) => {
      attrs.push(node.type.name === "paragraph" ? node.attrs : { numbering: { id: 0 } });
      comments.push([...open]);
      node.forEach((child) => {
        const id = child.attrs.id as number;
        if (child.type.name === "commentStart") open.add(id);
        else if (child.type.name === "commentEnd") open.delete(id);
      });
    });
    this.#markers = this.#context.resolver.markers(attrs);
    this.#comments = comments;
  }

  /** Whether the top-level block at `index` shows a list number. */
  hasMarker(index: number): boolean {
    return !!this.#markers[index];
  }

  /** What a block's rendering depends on at `index`, besides its node. */
  key(index: number): string {
    return `${this.#markers[index]?.text ?? ""}|${(this.#comments[index] ?? []).join(" ")}`;
  }

  render(node: ModelNode, index: number, splits: readonly number[] = []): WordBlockDesc {
    if (node.type.name !== "paragraph") return this.#opaque(node, index);
    const { resolver } = this.#context;
    const { paragraph, run } = resolver.paragraph(node.attrs);
    const line = (r: RunFormat) => lineHeight(paragraph, r, this.#ratio(fontStack(latin(r))));
    const doc = this.#doc;
    const fragments = [0, ...splits].map((_, i, all) => {
      const fragment = doc.createElement(tagOf(paragraph));
      styleParagraph(fragment, paragraph);
      styleRun(fragment, run, line(run));
      if (all.length > 1) {
        fragment.dataset.fragment = String(i);
        // The first-line indent is the paragraph's first line only.
        if (i > 0) fragment.style.textIndent = "0";
        // Justified text stays justified up to the page end (a fragment's last line is not
        // the paragraph's; see render.ts for the forced-break case).
        if (i < all.length - 1 && fragment.style.textAlign === "justify")
          fragment.style.textAlignLast = "justify";
      }
      return fragment;
    });
    const dom = fragments[0] as HTMLElement;
    const marker = this.#markers[index];
    if (marker) {
      const element = markerElement(marker, paragraph, doc, this.#ratio);
      // Shown, not document text: no caret inside, not read back. Other apps take it as Word's
      // number for its list paragraph (set below).
      if (this.#clipboard) element.setAttribute("style", `${styleOf(element)}mso-list:Ignore`);
      else element.setAttribute("contenteditable", "false");
      dom.append(element);
    }
    const fragmentAt = (at: number) => {
      let i = 0;
      while (i < splits.length && (splits[i] as number) <= at) i++;
      return fragments[i] as HTMLElement;
    };
    const leaves: LeafDesc[] = [];
    const comments = new Set(this.#comments[index] ?? []);
    node.forEach((child, offset) => {
      const name = child.type.name;
      if (name === "commentStart") comments.add(child.attrs.id as number);
      if (name === "commentEnd") comments.delete(child.attrs.id as number);
      const leafElement = (element: HTMLElement) => {
        leaves.push({ dom: element, offset, size: child.nodeSize });
        fragmentAt(offset).append(this.#wrap(element, child.marks, comments.size > 0));
      };
      switch (name) {
        case "text":
          break;
        case "hardBreak":
        case "columnBreak":
        case "pageBreak": {
          // shortcut: a column break ends the line; Foli lays out one column.
          const br = doc.createElement("br");
          if (name === "pageBreak") br.setAttribute(WORD_PAGE_BREAK_ATTR, "");
          leaves.push({ dom: br, offset, size: 1 });
          fragmentAt(offset).append(br);
          return;
        }
        case "tab": {
          // A tab is text to the line layout (tab stops) and to the read-back.
          const span = this.#run(run, child.marks, line);
          const tab = doc.createTextNode("\t");
          span.append(tab);
          leaves.push({ dom: tab, offset, size: 1 });
          fragmentAt(offset).append(this.#wrap(span, child.marks, comments.size > 0));
          return;
        }
        case "opaqueInline": {
          const span = this.#run(run, child.marks, line);
          const xml = parseOpaque(String(child.attrs.xml ?? ""), doc);
          span.textContent = xml ? opaqueText(xml) : "";
          span.dataset.foliOpaque = String(child.attrs.label ?? "");
          span.setAttribute("contenteditable", "false");
          leafElement(span);
          return;
        }
        default: {
          // Bookmarks, comment anchors and reference marks: nothing to see, a place to map to.
          const span = doc.createElement("span");
          if (name === "commentReference")
            span.dataset.foliCommentReference = String(child.attrs.id);
          leaves.push({ dom: span, offset, size: child.nodeSize });
          fragmentAt(offset).append(span);
          return;
        }
      }
      const text = child.text ?? "";
      const cuts = splits.filter((split) => split > offset && split < offset + text.length);
      let from = offset;
      for (const to of [...cuts, offset + text.length]) {
        const leaf = doc.createTextNode(text.slice(from - offset, to - offset));
        leaves.push({ dom: leaf, offset: from, size: to - from });
        const span = this.#run(run, child.marks, line);
        span.append(leaf);
        fragmentAt(from).append(this.#wrap(span, child.marks, comments.size > 0));
        from = to;
      }
    });
    // An empty paragraph, or one ending in a line break, shows its last line; after a page
    // break the paragraph mark stays on the break's line, as in Word.
    let last: ModelNode | null = null;
    for (let i = node.childCount - 1; i >= 0 && !last; i--) {
      const child = node.child(i);
      if (!["bookmarkStart", "bookmarkEnd", "commentStart", "commentEnd"].includes(child.type.name))
        last = child;
    }
    if (!last || last.type.name === "hardBreak" || last.type.name === "columnBreak")
      (fragments[fragments.length - 1] as HTMLElement).append(doc.createElement("br"));
    const { before, after } = paragraph.spacing;
    // Word's automatic spacing (HTML): 14 pt.
    const word: WordInfo = {
      before: (paragraph.spacing.beforeAutospacing ? 280 : before) * PX_PER_TWIP,
      after: (paragraph.spacing.afterAutospacing ? 280 : after) * PX_PER_TWIP,
      keepNext: paragraph.keepNext,
      keepLines: paragraph.keepLines,
      pageBreakBefore: paragraph.pageBreakBefore,
      style: paragraph.style,
      contextual: paragraph.contextualSpacing,
    };
    if (this.#clipboard) {
      // The flow places the spacing in the editor; elsewhere it is the paragraph's margins.
      dom.style.marginTop = `${word.before}px`;
      dom.style.marginBottom = `${word.after}px`;
      // Written as text: the CSS object model drops properties it does not know.
      const numbering = marker && paragraph.numbering;
      if (numbering) {
        const list = `l${numbering.id} level${numbering.level + 1} lfo${numbering.id}`;
        dom.setAttribute("style", `${styleOf(dom)}mso-list:${list}`);
      }
    }
    return { node, dom, fragments, splits, leaves, word, key: this.key(index) };
  }

  /** A span for text with `marks` over its paragraph's run formatting. */
  #run(
    paragraphRun: RunFormat,
    marks: readonly Mark[],
    line: (run: RunFormat) => string,
  ): HTMLElement {
    const json: MarkJSON[] = marks.map((m) => m.toJSON());
    const run = this.#context.resolver.run(paragraphRun, json);
    const span = this.#doc.createElement("span");
    styleRun(span, run, line(run));
    return span;
  }

  /** Tracked changes and comment shading around a rendered run. */
  #wrap(element: HTMLElement, marks: readonly Mark[], commented: boolean): HTMLElement {
    if (commented && !this.#clipboard && !element.style.backgroundColor)
      element.style.backgroundColor = "rgba(255, 213, 79, 0.35)";
    let outer = element;
    const change = marks.find((m) => m.type.name === "insertion" || m.type.name === "deletion");
    if (change) {
      const inserted = change.type.name === "insertion";
      outer = this.#doc.createElement(inserted ? "ins" : "del");
      if (change.attrs.author) outer.title = String(change.attrs.author);
      outer.style.color = "#B5082E";
      outer.style.textDecorationLine = inserted ? "underline" : "line-through";
      outer.append(element);
    }
    // Schema v3 keeps any target (`file:`…): only a safe one is a link in the page or on the
    // clipboard. It looks as its run says (Word shows a link without the Hyperlink style plain).
    const href = marks.find((m) => m.type.name === "link")?.attrs.href;
    if (typeof href !== "string" || !isSafeHref(href)) return outer;
    const a = this.#doc.createElement("a");
    a.setAttribute("href", href);
    a.style.color = "inherit";
    a.style.textDecoration = "none";
    a.append(outer);
    return a;
  }

  /** An opaque block, shown from its XML: a block leaf, not editable inside. */
  #opaque(node: ModelNode, index: number): WordBlockDesc {
    const shown = opaqueBlock(node.toJSON(), index, this.#context.resolver, this.#doc, this.#ratio);
    const dom = shown.element;
    dom.setAttribute("contenteditable", "false");
    return {
      node,
      dom,
      fragments: [dom],
      splits: [],
      leaves: [],
      key: this.key(index),
      word: {
        before: shown.before,
        after: shown.after,
        keepNext: false,
        keepLines: false,
        pageBreakBefore: false,
        style: null,
        contextual: false,
      },
    };
  }
}

/** An element's style attribute, ready for one more declaration. */
function styleOf(element: Element): string {
  const style = element.getAttribute("style")?.trim() ?? "";
  return style && !style.endsWith(";") ? `${style};` : style;
}

/**
 * The HTML of copied v3 blocks `nodes`: drawn as the editor draws them, with their list numbers
 * in `doc` (from top-level block `first`; -1 for text from inside one paragraph, which takes no
 * number), without what only the editor needs (comment shading, `contenteditable`).
 */
export function clipboardBlocks(
  context: WordContext,
  doc: ModelNode,
  nodes: readonly ModelNode[],
  first: number,
  ownerDocument: Document,
  ratio: (family: string) => number,
): HTMLElement[] {
  const renderer = new WordRenderer(context, ownerDocument, ratio, true);
  renderer.prepare(doc);
  return nodes.map((node, i) => {
    const { dom } = renderer.render(node, first < 0 ? -1 : first + i);
    for (const element of [dom, ...dom.querySelectorAll("*")])
      for (const name of element.getAttributeNames())
        if (
          name === "contenteditable" ||
          (name.startsWith("data-") && name !== WORD_PAGE_BREAK_ATTR)
        )
          element.removeAttribute(name);
    return dom;
  });
}

/**
 * A block's space before and after next to its neighbours: Word ignores the space between
 * paragraphs of the same style that ask for it (contextual spacing).
 */
export function spacing(
  above: WordInfo | undefined,
  block: WordInfo,
  below: WordInfo | undefined,
): { before: number; after: number } {
  const same = (other: WordInfo | undefined) => other !== undefined && other.style === block.style;
  return {
    before: same(above) && block.contextual ? 0 : block.before,
    after: same(below) && block.contextual ? 0 : block.after,
  };
}
