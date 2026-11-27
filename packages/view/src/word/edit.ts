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
  type FieldDisplay,
  fieldDisplay,
  isSafeHref,
  type Mark,
  type MarkJSON,
  type Node as ModelNode,
} from "@folijs/core";
import {
  type CellFormat,
  type ListMarker,
  type RunFormat,
  referencesIn,
  resolvedCommentIds,
  type WordContext,
} from "@folijs/core/internal";
import {
  applyAttrs,
  type Decoration,
  type Drawn,
  type NodeView,
  type NodeViewDOM,
  nodeViewDOM,
  reportError,
  type Views,
} from "../extension.js";
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
  NOTE_NUMBER_ATTR,
  NOTE_REF_ATTR,
  onlyPictures,
  opaqueBlock,
  opaqueText,
  PICTURE_ATTR,
  PX_PER_TWIP,
  parseOpaque,
  pictureElement,
  type ReviewView,
  styleParagraph,
  styleRun,
  tagOf,
  textBoxElement,
  WORD_COLUMN_BREAK_ATTR,
  WORD_PAGE_BREAK_ATTR,
} from "./blocks.js";

/** A number per story tree, new for each tree: what a block's key holds of its text boxes. */
const serials = new WeakMap<object, number>();
let nextSerial = 0;
const storySerial = (tree: object | undefined): number => {
  if (!tree) return -1;
  let found = serials.get(tree);
  if (found === undefined) {
    found = ++nextSerial;
    serials.set(tree, found);
  }
  return found;
};

const boxesOf = new WeakMap<ModelNode, string[]>();

/** The stories of the text boxes in a block, in order (read once per node). */
function textBoxesIn(node: ModelNode): string[] {
  let ids = boxesOf.get(node);
  if (!ids) {
    const found: string[] = [];
    node.descendants((child) => {
      if (child.type.name === "textBox") found.push(String(child.attrs.story));
      return true;
    });
    ids = found;
    boxesOf.set(node, ids);
  }
  return ids;
}

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

/**
 * What the page flow needs to know about a v3 block.
 * @internal
 */
export interface WordInfo {
  /** Space before and after in CSS px (Word adds them: the flow places them). */
  before: number;
  after: number;
  keepNext: boolean;
  keepLines: boolean;
  /** `w:widowControl`: false splits it at any line, as Word does. */
  widowControl?: boolean;
  pageBreakBefore: boolean;
  /** The paragraph's style and whether it drops spacing next to the same style. */
  style: string | null;
  contextual: boolean;
  /** A paragraph with nothing to show in its line. */
  empty: boolean;
}

/** A paragraph's inline nodes, by type name. */
function childTypes(node: ModelNode): string[] {
  const types: string[] = [];
  if (node.type.name === "paragraph")
    node.forEach((child) => {
      types.push(child.type.name);
    });
  return types;
}

/**
 * A rendered v3 block: a view block plus its flow information and what it was rendered for.
 * @internal
 */
export interface WordBlockDesc extends BlockDesc {
  readonly word: WordInfo;
  /** What the rendering depends on besides the node (its marker, open comments). */
  readonly key: string;
  /**
   * A custom block's node view that may split: where it may break, as the bottoms of its root's
   * children from its top (client px; the last is its height). Its `splits` are then the layout
   * px from its top where each fragment after the first starts, not content offsets.
   */
  readonly parts?: () => number[];
}

/**
 * A floating picture's holder (drawn first in its paragraph, the view's own DOM) to its anchor:
 * the empty, non-editable span at the picture's place in the text, which positions map to.
 * @internal
 */
export const FLOAT_ANCHORS = new WeakMap<Element, HTMLElement>();

/**
 * Renders the blocks of one v3 document for the editable view. `prepare` runs before each
 * render: list numbers and comment ranges depend on the blocks before.
 * @internal
 */
export class WordRenderer {
  #context: WordContext;
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
  /** Resolved comments: their text is not shaded (a change of comments renews the renderer). */
  #resolved: ReadonlySet<number>;
  /** Where a document adds paragraph spacing: the space after the paragraph above, in a cell. */
  #above: number[] = [];
  /** Whether fields show their codes. */
  readonly #codes: boolean;
  /** What each block shows of its fields. */
  #fields: FieldDisplay[] = [];
  /** What note references show, by story, and what a note's own mark shows. */
  #notes: ReadonlyMap<string, string> = new Map();
  #noteMark = "";
  /** The numbers each block shows. */
  #noteKeys: string[] = [];
  /** The text box stories each block draws, as keys: a story edited draws its block again. */
  #boxKeys: string[] = [];
  /** Node and mark views (`ViewExtension`), none on the clipboard. */
  views: Views | null = null;
  /** Where node views' drawings are recorded, for their `destroy` (the view's list). */
  drawn: Drawn[] | null = null;
  readonly #dom: NodeViewDOM;
  /** Each block's decorations, relative to its content (`decorationsByBlock`), and as keys. */
  #decorations: readonly (readonly Decoration[] | undefined)[] = [];
  #decorationKeys: string[] = [];

  constructor(
    context: WordContext,
    doc: Document,
    ratio: (family: string) => number,
    clipboard = false,
    review: ReviewView = "markup",
    image?: ImageSource,
    codes = false,
  ) {
    this.#codes = codes;
    this.#context = context;
    this.#doc = doc;
    this.#dom = nodeViewDOM(doc);
    this.#ratio = ratio;
    this.#clipboard = clipboard;
    this.#review = review;
    this.#image = image ?? imageSource(context.envelope.resources);
    this.#resolved = resolvedCommentIds(context.envelope.comments);
  }

  get context(): WordContext {
    return this.#context;
  }

  /** The envelope moved on without touching what blocks look like (a story was edited). */
  set context(context: WordContext) {
    this.#context = context;
  }

  /** Decorations by block index (of those prepared): set before `key` and `render`. */
  set decorations(list: readonly (readonly Decoration[] | undefined)[]) {
    this.#decorations = list;
    this.#decorationKeys = list.map((own) => (own ? JSON.stringify(own) : ""));
  }

  /** What notes show: set before `prepare`. */
  setNotes(references: ReadonlyMap<string, string>, mark = ""): void {
    this.#notes = references;
    this.#noteMark = mark;
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
    this.#fields = fieldDisplay(blocks.map(childTypes), this.#codes);
    this.#boxKeys = blocks.map((node) => this.#boxKey(node));
    this.#noteKeys = this.#notes.size
      ? blocks.map((node) =>
          referencesIn(node)
            .map((ref) => this.#notes.get(ref.story) ?? "")
            .join(" "),
        )
      : [];
  }

  /** The versions of the text box stories `node` holds ("" for none). */
  #boxKey(node: ModelNode): string {
    const ids = textBoxesIn(node);
    if (!ids.length) return "";
    const { stories } = this.#context;
    return ids.map((id) => storySerial(stories.get(id)?.doc)).join(",");
  }

  /** Whether the block at `index` (of those prepared) shows a list number. */
  hasMarker(index: number): boolean {
    return !!this.#markers[index];
  }

  /** What a block's rendering depends on at `index`, besides its node (and its cell's format). */
  key(index: number, cell?: CellFormat | null): string {
    const inCell = cell ? `|${cell.style ?? ""}:${cell.conditions.join(",")}` : "";
    const above = this.#above[index] ? `|${this.#above[index]}` : "";
    // A field opened or closed in an earlier block changes what shows here.
    const field = this.#fields[index];
    const fields = field?.hidden.size || field?.gone ? `|${[...field.hidden]}${field.gone}` : "";
    const notes = this.#noteKeys[index] ? `|${this.#noteKeys[index]}` : "";
    const decorations = this.#decorationKeys[index] ? `|${this.#decorationKeys[index]}` : "";
    const boxes = this.#boxKeys[index] ? `|boxes:${this.#boxKeys[index]}` : "";
    return `${boxes}${this.#markers[index]?.text ?? ""}|${(this.#comments[index] ?? []).join(" ")}${inCell}${above}${fields}${notes}|${this.#noteMark}${decorations}`;
  }

  /** A block; `cell` is the format of the table cell it is in, if any. */
  render(
    node: ModelNode,
    index: number,
    splits: readonly number[] = [],
    cell?: CellFormat | null,
  ): WordBlockDesc {
    const decorations = this.#decorations[index] ?? [];
    if (node.type.name !== "paragraph") return this.#opaque(node, index, splits, !!cell);
    const { resolver } = this.#context;
    const { paragraph, run } = resolver.paragraph(node.attrs, cell ?? undefined);
    const line = (r: RunFormat) => lineHeight(paragraph, r, this.#ratio(fontStack(latin(r))));
    const doc = this.#doc;
    const codes = this.#codes;
    // On the clipboard a block stands by itself.
    const display = this.#clipboard
      ? (fieldDisplay([childTypes(node)], false)[0] as FieldDisplay)
      : (this.#fields[index] ?? (fieldDisplay([[]], false)[0] as FieldDisplay));
    const changed = this.#review !== "final" && hasChanges(node);
    // The line's own height is the paragraph mark's, as in `renderBlocks`.
    const mark = resolver.run(run, (node.attrs.markFormat ?? []) as MarkJSON[]);
    const fragments = [0, ...splits].map((_, i, all) => {
      const fragment = doc.createElement(tagOf(paragraph));
      styleParagraph(fragment, paragraph);
      styleRun(fragment, mark, line(mark));
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
      if (display.gone) fragment.style.display = "none";
      for (const d of decorations) if (d.node && d.from < 0) applyAttrs(fragment, d.attrs);
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
    /** Inline decorations over content `from`..`to`, and node ones on a leaf there. */
    const decorate = (element: HTMLElement, from: number, to: number, leaf: boolean) => {
      for (const d of decorations)
        if (d.node ? leaf && d.from === from : d.from <= from && d.to >= to)
          applyAttrs(element, d.attrs);
    };
    node.forEach((child, offset, childIndex) => {
      const name = child.type.name;
      if (name === "commentStart") comments.add(child.attrs.id as number);
      if (name === "commentEnd") comments.delete(child.attrs.id as number);
      const hidden = display.hidden.has(childIndex);
      /** Where this node's DOM goes: out of sight when it is hidden, as hidden deletions are. */
      const holder = (at: number): HTMLElement => {
        const fragment = fragmentAt(at);
        if (!hidden) return fragment;
        const span = doc.createElement("span");
        span.style.display = "none";
        fragment.append(span);
        return span;
      };
      const leafElement = (element: HTMLElement) => {
        decorate(element, offset, offset + child.nodeSize, true);
        leaves.push({ dom: element, offset, size: child.nodeSize });
        holder(offset).append(this.#wrap(element, child.marks, comments));
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
          // A deleted break breaks nothing in the views that show the text as accepted.
          const gone =
            this.#review !== "markup" && child.marks.some((m) => m.type.name === "deletion");
          if (gone && !hidden) {
            const span = doc.createElement("span");
            span.style.display = "none";
            span.append(br);
            holder(offset).append(span);
          } else holder(offset).append(br);
          return;
        }
        case "tab": {
          // A tab is text to the line layout (tab stops) and to the read-back.
          const span = this.#run(run, child.marks, line);
          decorate(span, offset, offset + 1, true);
          const tab = doc.createTextNode("\t");
          span.append(tab);
          leaves.push({ dom: tab, offset, size: 1 });
          holder(offset).append(this.#wrap(span, child.marks, comments));
          return;
        }
        case "picture": {
          // Not editable inside (no browser resize handles); one position, like opaque content.
          const span = doc.createElement("span");
          span.setAttribute("contenteditable", "false");
          if (child.attrs.float && !this.#clipboard && !hidden) {
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
        case "textBox": {
          // A text box (33.2): its story drawn read-only, one position in the text, placed as
          // a picture is.
          const span = doc.createElement("span");
          span.setAttribute("contenteditable", "false");
          // On the clipboard nothing: its paragraphs in the line's would break the HTML (Foli's
          // own format carries the box and its text).
          if (this.#clipboard) {
            leafElement(span);
            return;
          }
          const box = textBoxElement(child.attrs, this.#context.envelope, doc, {
            resolver: this.#context.resolver,
            review: this.#review,
            fieldCodes: codes,
            lineRatio: this.#ratio,
            image: this.#image,
          });
          if (child.attrs.float && !this.#clipboard && !hidden) {
            geometry ??= floatGeometry(this.#context.envelope.section);
            const { nodes, holder } = floatElements(child.attrs, doc, this.#image, geometry, box);
            for (const node of nodes) node.setAttribute("contenteditable", "false");
            FLOAT_ANCHORS.set(holder, span);
            const fragment = fragmentAt(offset);
            floats.set(fragment, [...(floats.get(fragment) ?? []), ...nodes]);
          } else span.append(box);
          leafElement(span);
          return;
        }
        case "noteReference":
        case "noteMark": {
          // Drawn, never document text: the number comes from where the note is.
          const span = this.#run(run, child.marks, line);
          const story = String(child.attrs.story);
          span.textContent = name === "noteMark" ? this.#noteMark : (this.#notes.get(story) ?? "");
          span.setAttribute("contenteditable", "false");
          span.setAttribute(NOTE_NUMBER_ATTR, "");
          if (name === "noteReference") span.setAttribute(NOTE_REF_ATTR, story);
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
          const stands = child.type.spec.text;
          if (stands) {
            // A custom or foreign node (ADR-0008): its node view or its text, one position, as
            // opaque content.
            const span = this.#run(run, child.marks, line);
            const view = this.#clipboard ? undefined : this.views?.nodes.get(name);
            const drawn = view && this.#draw(view, child, span);
            if (drawn) span.append(drawn);
            else span.textContent = stands(child.attrs);
            span.dataset.foliCustom = String(child.attrs.type ?? name);
            span.setAttribute("contenteditable", "false");
            leafElement(span);
            return;
          }
          // A field's code and braces, when codes show: drawn, not document text.
          const shown =
            display.braces.get(childIndex) ??
            (codes && !hidden && name === "fieldCode" ? String(child.attrs.text ?? "") : "");
          if (shown) {
            const span = this.#run(run, child.marks, line);
            span.textContent = shown;
            span.dataset.foliFieldCode = "";
            span.setAttribute("contenteditable", "false");
            leaves.push({ dom: span, offset, size: child.nodeSize });
            fragmentAt(offset).append(span);
            return;
          }
          // Bookmarks, comment anchors and reference marks: nothing to see, a place to map to.
          const span = doc.createElement("span");
          if (name === "commentReference")
            span.dataset.foliCommentReference = String(child.attrs.id);
          leaves.push({ dom: span, offset, size: child.nodeSize });
          holder(offset).append(span);
          return;
        }
      }
      const text = child.text ?? "";
      const inside = (at: number) => at > offset && at < offset + text.length;
      const cuts = splits.filter(inside);
      // Inline decorations start and end runs of their own.
      for (const d of decorations)
        if (!d.node)
          for (const at of [d.from, d.to]) if (inside(at) && !cuts.includes(at)) cuts.push(at);
      cuts.sort((a, b) => a - b);
      let from = offset;
      for (const to of [...cuts, offset + text.length]) {
        const leaf = doc.createTextNode(text.slice(from - offset, to - offset));
        leaves.push({ dom: leaf, offset: from, size: to - from });
        const span = this.#run(run, child.marks, line);
        decorate(span, from, to, false);
        span.append(leaf);
        holder(from).append(this.#wrap(span, child.marks, comments));
        from = to;
      }
    });
    for (const [fragment, nodes] of floats) fragment.prepend(...nodes);
    const inline: ModelNode[] = [];
    node.forEach((child) => {
      inline.push(child);
    });
    if (
      onlyPictures(
        inline,
        (child) => child.type.name,
        (child) => !!child.attrs.float,
      )
    )
      for (const fragment of fragments)
        for (const picture of fragment.querySelectorAll<HTMLElement>(`[${PICTURE_ATTR}]`))
          picture.style.verticalAlign = "bottom";
    // An empty paragraph, or one ending in a line break, shows its last line; after a page
    // break the paragraph mark stays on the break's line, as in Word.
    let last: ModelNode | null = null;
    for (let i = node.childCount - 1; i >= 0 && !last; i--) {
      const child = node.child(i);
      if (display.hidden.has(i)) continue;
      // A floating picture is not in the line: a paragraph holding only one shows its empty line.
      if (
        display.braces.has(i) ||
        (codes && child.type.name === "fieldCode") ||
        (!NOT_IN_LINE.has(child.type.name) && !(child.type.name === "picture" && child.attrs.float))
      )
        last = child;
    }
    if (!last || last.type.name === "hardBreak" || last.type.name === "columnBreak")
      (fragments[fragments.length - 1] as HTMLElement).append(doc.createElement("br"));
    const { before, after } = paragraph.spacing;
    // Word's automatic spacing (HTML): 14 pt.
    const word: WordInfo = {
      before: display.gone ? 0 : (paragraph.spacing.beforeAutospacing ? 280 : before) * PX_PER_TWIP,
      after: display.gone ? 0 : (paragraph.spacing.afterAutospacing ? 280 : after) * PX_PER_TWIP,
      keepNext: paragraph.keepNext,
      keepLines: paragraph.keepLines,
      widowControl: paragraph.widowControl,
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
    // Custom marks (ADR-0008): named for CSS, styled by their mark views.
    const custom: string[] = [];
    for (const mark of marks) {
      const type = mark.type.name === "foreign" ? String(mark.attrs.type) : mark.type.name;
      if (!type.includes(":")) continue;
      custom.push(type);
      const view = this.views?.marks.get(mark.type.name);
      try {
        if (view) applyAttrs(span, view(mark));
      } catch (error) {
        reportError(error);
      }
    }
    if (custom.length) span.dataset.foliMark = custom.join(" ");
    return span;
  }

  /** Tracked changes and comment shading around a rendered run. */
  #wrap(element: HTMLElement, marks: readonly Mark[], comments: ReadonlySet<number>): HTMLElement {
    if (comments.size && !this.#clipboard) {
      // The comments whose range holds this text: the comments pane finds and marks it.
      element.dataset.foliComments = [...comments].join(" ");
      if (!element.style.backgroundColor && [...comments].some((id) => !this.#resolved.has(id)))
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

  /** A node view's drawing of `node` in `box`, recorded; null (reported) when `render` throws. */
  #draw(view: NodeView, node: ModelNode, box: HTMLElement): Node | null {
    try {
      const root = view.render(node, this.#dom);
      this.drawn?.push({ view, root, box });
      return root;
    } catch (error) {
      reportError(error);
      return null;
    }
  }

  /**
   * A custom block drawn by its node view (ADR-0008): one fragment, or one per page it is split
   * across, each drawing the node again and showing its part (`splits`, layout px) through a clip.
   */
  #nodeView(
    node: ModelNode,
    index: number,
    view: NodeView,
    splits: readonly number[],
    inCell: boolean,
  ): WordBlockDesc {
    const doc = this.#doc;
    const tops = [0, ...splits];
    let root: Node | undefined;
    const fragments = tops.map((top, i) => {
      const box = doc.createElement("div");
      box.dataset.foliCustom = node.type.name;
      box.setAttribute("contenteditable", "false");
      // Its root's margins stay inside it: measured as the flow places it.
      box.style.display = "flow-root";
      const drawn =
        this.#draw(view, node, box) ?? doc.createTextNode(node.type.spec.text?.(node.attrs) ?? "");
      root ??= drawn;
      if (tops.length > 1) {
        box.dataset.fragment = String(i);
        box.style.overflow = "hidden";
        const next = tops[i + 1];
        if (next !== undefined) box.style.height = `${next - top}px`;
        // The parts after the first are drawn again: read once.
        if (i > 0) {
          box.setAttribute("aria-hidden", "true");
          box.setAttribute("inert", "");
        }
        const inner = doc.createElement("div");
        inner.style.marginTop = `${-top}px`;
        inner.append(drawn);
        box.append(inner);
      } else box.append(drawn);
      for (const d of this.#decorations[index] ?? [])
        if (d.node && d.from < 0) applyAttrs(box, d.attrs);
      return box;
    });
    const dom = fragments[0] as HTMLElement;
    // shortcut: a custom block in a table cell is kept whole (cells split at their lines); split it there when a node view needs it.
    const split = view.split !== false && !inCell;
    const parts = () => {
      const { top, height } = dom.getBoundingClientRect();
      const bottoms: number[] = [];
      const children = root?.nodeType === Node.ELEMENT_NODE ? (root as Element).children : [];
      for (const child of children) {
        const bottom = child.getBoundingClientRect().bottom - top;
        if (bottom > (bottoms[bottoms.length - 1] ?? 0) && bottom < height) bottoms.push(bottom);
      }
      bottoms.push(height);
      return bottoms;
    };
    return {
      node,
      dom,
      fragments,
      splits,
      leaves: [],
      key: this.key(index),
      word: leafInfo(!split),
      ...(split ? { parts } : {}),
    };
  }

  /** An opaque block, shown from its XML: a block leaf, not editable inside. */
  #opaque(
    node: ModelNode,
    index: number,
    splits: readonly number[],
    inCell: boolean,
  ): WordBlockDesc {
    const view = this.#clipboard ? undefined : this.views?.nodes.get(node.type.name);
    if (view) return this.#nodeView(node, index, view, splits, inCell);
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
    const stands = node.type.spec.text;
    if (stands) {
      // A custom or foreign block (ADR-0008): its text in a box.
      dom.textContent = stands(node.attrs);
      dom.dataset.foliCustom = String(node.attrs.type ?? node.type.name);
    }
    for (const d of this.#decorations[index] ?? [])
      if (d.node && d.from < 0) applyAttrs(dom, d.attrs);
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

/** What the flow needs of a block that is not a paragraph: no spacing, keep rules or breaks. */
function leafInfo(keepLines: boolean): WordInfo {
  return {
    before: 0,
    after: 0,
    keepNext: false,
    keepLines,
    pageBreakBefore: false,
    style: null,
    contextual: false,
    empty: false,
  };
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
 * @internal
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
 * @internal
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
