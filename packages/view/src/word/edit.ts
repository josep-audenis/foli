/**
 * Schema v3 blocks for the editable view (8.7a): the paragraphs of `blocks.ts`, rendered from
 * model nodes with their leaves (the text nodes and elements positions map to), split into
 * fragments at content offsets like the v2 blocks (`render.ts`), and what the page flow needs
 * of each: Word's paragraph spacing and keep rules. Built with createElement/textContent only.
 *
 * Tracked changes show as the view's review mode says (deleted text hidden, not left out, in the
 * simple and final views: positions map through it). Content the model
 * keeps opaque is shown from its XML and cannot be edited: an opaque block is a block leaf, an
 * opaque inline node a leaf element.
 */
import {
  type CellFormat,
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
  CHANGE_BAR,
  changeElement,
  type FloatGeometry,
  floatElements,
  floatGeometry,
  fontStack,
  type ImageSource,
  imageSource,
  latin,
  lineHeight,
  marginAbove,
  markerElement,
  opaqueBlock,
  opaqueText,
  PX_PER_TWIP,
  parseOpaque,
  pictureElement,
  type ReviewView,
  styleParagraph,
  styleRun,
  tagOf,
  WORD_COLUMN_BREAK_ATTR,
  WORD_PAGE_BREAK_ATTR,
} from "./blocks.js";

/** Inline nodes with nothing to show: a line holding only these is still an empty line. */
const NOT_IN_LINE = new Set([
  "bookmarkStart",
  "bookmarkEnd",
  "commentStart",
  "commentEnd",
  "controlStart",
  "controlEnd",
  "fieldStart",
  "fieldCode",
  "fieldSeparator",
  "fieldEnd",
  "noteReference",
  "noteMark",
]);

const REVIEW_MARKS = new Set(["insertion", "deletion", "formatChange"]);

/** Whether a paragraph has tracked changes: in its text, its mark or its formatting. */
function hasChanges(node: ModelNode): boolean {
  if (node.attrs.revision || node.attrs.formatChange) return true;
  let found = false;
  node.forEach((child) => {
    if (child.marks.some((m) => REVIEW_MARKS.has(m.type.name))) found = true;
  });
  return found;
}

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
  /** A paragraph with nothing to show in its line. */
  empty: boolean;
}

/** A rendered v3 block: a view block plus its flow information and what it was rendered for. */
export interface WordBlockDesc extends BlockDesc {
  readonly word: WordInfo;
  /** What the rendering depends on besides the node (its marker, open comments). */
  readonly key: string;
}

/**
 * A floating picture's holder (drawn first in its paragraph, the view's own DOM) to its anchor:
 * the empty, non-editable span at the picture's place in the text, which positions map to.
 */
export const FLOAT_ANCHORS = new WeakMap<Element, HTMLElement>();

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
  /** How tracked changes show. */
  readonly #review: ReviewView;
  /** Where pictures' images are shown from. */
  readonly #image: ImageSource | undefined;
  #markers: (ListMarker | null)[] = [];
  /** Comment ranges open at the start of each block. */
  #comments: number[][] = [];
  /** Where a document adds paragraph spacing: the space after the paragraph above, in a cell. */
  #above: number[] = [];

  constructor(
    context: WordContext,
    doc: Document,
    ratio: (family: string) => number,
    clipboard = false,
    review: ReviewView = "markup",
    image?: ImageSource,
  ) {
    this.#context = context;
    this.#doc = doc;
    this.#ratio = ratio;
    this.#clipboard = clipboard;
    this.#review = review;
    this.#image = image ?? imageSource(context.envelope.resources);
  }

  get context(): WordContext {
    return this.#context;
  }

  /**
   * Numbering and comment state for `blocks`, the blocks rendered, in document order (the
   * paragraphs in table cells among them: Word numbers lists through tables). `aboveInCell`
   * gives the paragraph before one in its table cell, with that cell's format.
   */
  prepare(
    blocks: readonly ModelNode[],
    aboveInCell?: (index: number) => { node: ModelNode; cell: CellFormat } | null,
  ): void {
    const { resolver } = this.#context;
    this.#above =
      resolver.addsParagraphSpacing && aboveInCell
        ? blocks.map((_, i) => {
            const previous = aboveInCell(i);
            if (previous?.node.type.name !== "paragraph") return 0;
            const { spacing } = resolver.paragraph(previous.node.attrs, previous.cell).paragraph;
            return (spacing.afterAutospacing ? 280 : spacing.after) * PX_PER_TWIP;
          })
        : [];
    const attrs: Record<string, unknown>[] = [];
    const comments: number[][] = [];
    const open = new Set<number>();
    for (const node of blocks) {
      attrs.push(node.type.name === "paragraph" ? node.attrs : { numbering: { id: 0 } });
      comments.push([...open]);
      node.forEach((child) => {
        const id = child.attrs.id as number;
        if (child.type.name === "commentStart") open.add(id);
        else if (child.type.name === "commentEnd") open.delete(id);
      });
    }
    this.#markers = this.#context.resolver.markers(attrs);
    this.#comments = comments;
  }

  /** Whether the block at `index` (of those prepared) shows a list number. */
  hasMarker(index: number): boolean {
    return !!this.#markers[index];
  }

  /** What a block's rendering depends on at `index`, besides its node (and its cell's format). */
  key(index: number, cell?: CellFormat | null): string {
    const inCell = cell ? `|${cell.style ?? ""}:${cell.conditions.join(",")}` : "";
    const above = this.#above[index] ? `|${this.#above[index]}` : "";
    return `${this.#markers[index]?.text ?? ""}|${(this.#comments[index] ?? []).join(" ")}${inCell}${above}`;
  }

  /** A block; `cell` is the format of the table cell it is in, if any. */
  render(
    node: ModelNode,
    index: number,
    splits: readonly number[] = [],
    cell?: CellFormat | null,
  ): WordBlockDesc {
    if (node.type.name !== "paragraph") return this.#opaque(node, index);
    const { resolver } = this.#context;
    const { paragraph, run } = resolver.paragraph(node.attrs, cell ?? undefined);
    const line = (r: RunFormat) => lineHeight(paragraph, r, this.#ratio(fontStack(latin(r))));
    const doc = this.#doc;
    const changed = this.#review !== "final" && hasChanges(node);
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
      if (changed && !this.#clipboard) fragment.style.boxShadow = CHANGE_BAR;
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
    // Floating pictures go first in the fragment their anchor is in, in order.
    const floats = new Map<HTMLElement, HTMLElement[]>();
    let geometry: FloatGeometry | undefined;
    const comments = new Set(this.#comments[index] ?? []);
    node.forEach((child, offset) => {
      const name = child.type.name;
      if (name === "commentStart") comments.add(child.attrs.id as number);
      if (name === "commentEnd") comments.delete(child.attrs.id as number);
      const leafElement = (element: HTMLElement) => {
        leaves.push({ dom: element, offset, size: child.nodeSize });
        fragmentAt(offset).append(this.#wrap(element, child.marks, comments));
      };
      switch (name) {
        case "text":
          break;
        case "hardBreak":
        case "columnBreak":
        case "pageBreak": {
          const br = doc.createElement("br");
          if (name === "pageBreak") br.setAttribute(WORD_PAGE_BREAK_ATTR, "");
          if (name === "columnBreak") br.setAttribute(WORD_COLUMN_BREAK_ATTR, "");
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
          fragmentAt(offset).append(this.#wrap(span, child.marks, comments));
          return;
        }
        case "picture": {
          // Not editable inside (no browser resize handles); one position, like opaque content.
          const span = doc.createElement("span");
          span.setAttribute("contenteditable", "false");
          if (child.attrs.float && !this.#clipboard) {
            // Floating: drawn at the fragment's start (ADR-0006), its place in the text an
            // empty anchor.
            geometry ??= floatGeometry(this.#context.envelope.section);
            const { nodes, holder } = floatElements(child.attrs, doc, this.#image, geometry);
            for (const node of nodes) node.setAttribute("contenteditable", "false");
            FLOAT_ANCHORS.set(holder, span);
            const fragment = fragmentAt(offset);
            floats.set(fragment, [...(floats.get(fragment) ?? []), ...nodes]);
          } else span.append(pictureElement(child.attrs, doc, this.#image));
          leafElement(span);
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
        fragmentAt(from).append(this.#wrap(span, child.marks, comments));
        from = to;
      }
    });
    for (const [fragment, nodes] of floats) fragment.prepend(...nodes);
    // An empty paragraph, or one ending in a line break, shows its last line; after a page
    // break the paragraph mark stays on the break's line, as in Word.
    let last: ModelNode | null = null;
    for (let i = node.childCount - 1; i >= 0 && !last; i--) {
      const child = node.child(i);
      // A floating picture is not in the line: a paragraph holding only one shows its empty line.
      if (
        !NOT_IN_LINE.has(child.type.name) &&
        !(child.type.name === "picture" && child.attrs.float)
      )
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
      empty: !last && !marker,
    };
    if (cell && !this.#clipboard) {
      // In a cell its spacing is its margins (the page flow spaces top-level blocks); a
      // fragment continued on the next page has none at the split.
      // shortcut: contextual spacing between paragraphs in a cell is not applied.
      dom.style.marginTop = `${marginAbove(word.before, this.#above[index] ?? 0, resolver)}px`;
      (fragments[fragments.length - 1] as HTMLElement).style.marginBottom = `${word.after}px`;
    }
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
    return { node, dom, fragments, splits, leaves, word, key: this.key(index, cell) };
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
  #wrap(element: HTMLElement, marks: readonly Mark[], comments: ReadonlySet<number>): HTMLElement {
    if (comments.size && !this.#clipboard) {
      // The comments whose range holds this text: the comments pane finds and marks it.
      element.dataset.foliComments = [...comments].join(" ");
      if (!element.style.backgroundColor)
        element.style.backgroundColor = "rgba(255, 213, 79, 0.35)";
    }
    let outer = element;
    // Text inserted, then deleted, shows as deleted (in the deleting author's color).
    const change =
      marks.find((m) => m.type.name === "deletion") ??
      marks.find((m) => m.type.name === "insertion");
    if (change) {
      const { author, date } = change.attrs as { author: string; date: string | null };
      const inserted = change.type.name === "insertion";
      outer = changeElement(this.#doc, inserted, author, date, this.#review);
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
    const shown = opaqueBlock(
      node.toJSON(),
      index,
      this.#context.resolver,
      this.#doc,
      this.#ratio,
      this.#image,
      floatGeometry(this.#context.envelope.section),
    );
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
        empty: false,
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
  const top: ModelNode[] = [];
  doc.forEach((node) => {
    top.push(node);
  });
  renderer.prepare(top);
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
 * paragraphs of the same style that ask for it (contextual spacing). When only the first asks,
 * its space after still eats into the second's space before, unless the document adds the two
 * (`adds`).
 */
export function spacing(
  above: WordInfo | undefined,
  block: WordInfo,
  below: WordInfo | undefined,
  adds = false,
): { before: number; after: number } {
  const same = (other: WordInfo | undefined) => other !== undefined && other.style === block.style;
  let { before } = block;
  if (above && same(above)) {
    if (block.contextual) before = 0;
    else if (above.contextual && !adds) before = Math.max(0, block.before - above.after);
  }
  return { before, after: same(below) && block.contextual ? 0 : block.after };
}
