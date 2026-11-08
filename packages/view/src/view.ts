import {
  AllSelection,
  arrowAcrossLeaf,
  autolinkHref,
  type Command,
  closeHistory,
  type DocumentSettings,
  deleteBackward,
  deleteForward,
  deleteSelection,
  type Editor,
  type EditorState,
  insertHardBreak,
  insertLink,
  insertText,
  type Node as ModelNode,
  marksAt,
  NodeSelection,
  redo,
  Selection,
  Slice,
  setLink,
  splitBlock,
  TextSelection,
  type Transaction,
  TransformError,
  toggleMark,
  undo,
} from "@folijs/core";
import { docFromClipboard, FOLI_MIME, serializeRange } from "./clipboard.js";
import {
  type BlockBox,
  contentHeight,
  DEFAULT_RULES,
  type FlowResult,
  flowFrom,
  PX_PER_MM,
  type Reuse,
} from "./layout/flow.js";
import {
  type BlockDesc,
  createWrapper,
  isWrapper,
  isWrapperFor,
  PAGE_BREAK_ATTR,
  renderBlock,
} from "./render.js";

/**
 * A container around blocks (a list, a list item) as rendered: its node, the position before it
 * (which identifies it within one render), its index in its parent and its first block's index.
 */
interface Container {
  readonly node: ModelNode;
  readonly pos: number;
  readonly index: number;
  readonly firstBlock: number;
}

/** Class of the element of a node-selected block (a rule). */
const SELECTED_CLASS = "foli-selected-node";

interface DomPoint {
  node: Node;
  offset: number;
}

export interface EditorViewOptions {
  /** Whether the user can change the document (default true). Code can always change it. */
  editable?: boolean;
  /** Shown while the document is one empty block (default: none). */
  placeholder?: string;
}

const PLACEHOLDER_ATTR = "data-foli-placeholder";
// Generated content is not document text: no caret stops inside it, a zero-height float keeps
// the caret at the line start, and the empty alt text keeps screen readers on aria-placeholder.
const STYLES = `[${PLACEHOLDER_ATTR}]::before{content:attr(${PLACEHOLDER_ATTR});content:attr(${PLACEHOLDER_ATTR}) / "";float:inline-start;height:0;pointer-events:none;color:GrayText}`;

/**
 * Adds the view's stylesheet once per document or shadow root, when a placeholder is first shown
 * (by then the host is usually mounted where it will stay).
 * shortcut: a CSP without 'unsafe-inline' for styles blocks it (placeholder not shown); ship a CSS file with the Phase 6 package if users need that.
 */
function injectStyles(host: HTMLElement): void {
  const doc = host.ownerDocument;
  const root = host.getRootNode();
  const parent =
    root.nodeType === Node.DOCUMENT_FRAGMENT_NODE
      ? (root as ShadowRoot)
      : (doc.head ?? doc.documentElement);
  if (parent.querySelector("style[data-foli]")) return;
  const style = host.ownerDocument.createElement("style");
  style.setAttribute("data-foli", "");
  style.textContent = STYLES;
  parent.append(style);
}

const VIEW_ATTR = "data-foli-view";
let viewCount = 0;

/**
 * Print rules for the page settings of the view whose host has `VIEW_ATTR` = `id`: one sheet of
 * the document's size per page, without margins (the page's padding holds them). A page is
 * exactly as tall as a sheet (the flow keeps content inside it; the exact height absorbs its
 * half-pixel slack), with no gap after it. Content taller than a page (a line taller than a
 * page) is not cut: it prints over the next sheet.
 * shortcut: `@page` is per document: with several editors of different page sizes on one web page, the last one's sheet size wins (each keeps its own page rules); print one editor per document until that is needed.
 */
function printStyles({ pageSize }: DocumentSettings, id: string): string {
  const { width, height } = pageSize;
  const pages = `[${VIEW_ATTR}="${id}"]>.foli-page`;
  return (
    `@media print{@page{size:${width}mm ${height}mm;margin:0}` +
    `${pages}{height:${height}mm!important;margin-block:0!important;` +
    `break-after:page;break-inside:avoid}${pages}:last-child{break-after:auto}}`
  );
}

/**
 * The editable view of an `Editor` from `@folijs/core`: renders its state into one
 * `contenteditable` host and turns DOM input into core commands. The model is the source of
 * truth; the DOM is rebuilt from it (unchanged blocks are reused by node identity).
 *
 * The browser edits the DOM itself only during composition (IME, dead keys) and for changes the
 * view cannot prevent (Android keyboards, extensions). A MutationObserver records those; the view
 * then reads the changed text back into a transaction (`readBack`) and re-renders.
 *
 * Blocks are the leaf blocks of the document at any depth (paragraphs, headings, rules); the
 * containers around them (lists, list items) are rebuilt on each page around the blocks it holds
 * (ADR-0004).
 */
export class EditorView {
  private state: EditorState;
  private blocks: BlockDesc[] = [];
  /** Position before each block, parallel to `blocks`. */
  private starts: number[] = [];
  /** The containers around each block, outermost first, parallel to `blocks`. */
  private chains: (readonly Container[])[] = [];
  /** The index of each block in `blocks`. */
  private indexOf = new Map<BlockDesc, number>();
  /** The container types around each block at its last render (a change means re-measuring). */
  private chainKeys = new WeakMap<ModelNode, string>();
  /** The element that shows a node selection, if any. */
  private selectedDom: HTMLElement | null = null;
  /** The page of each fragment of each block. */
  private fragmentPages = new Map<BlockDesc, readonly number[]>();
  /** The block each fragment element belongs to. */
  private owner = new Map<Node, BlockDesc>();
  /** The page elements, in order; the host's only children. */
  private pages: HTMLElement[] = [];
  private pageStyle = "";
  /** Marks the host for this view's print rules (`printStyles`). */
  private readonly id = String(++viewCount);
  /**
   * This view's print rules: in the document's head (`@page` only applies there) and, for a host
   * in a shadow root, there too (page rules do not cross into it).
   */
  private printStyles: HTMLStyleElement[] = [];
  private destroyed = false;
  /** Set by a render during a composition, which places blocks but does not flow them. */
  private unflowed = false;
  /**
   * Measurements by model node: a node's rendered height, margins and lines only depend on
   * its content (unchanged node, same identity), the page width and the CSS. Cleared when the
   * page settings or the fonts change; single entries go stale when a block's size changes
   * without an edit (`ResizeObserver`: CSS, fonts, a container).
   */
  private measures = new WeakMap<ModelNode, Measure>();
  private readonly stale = new Set<ModelNode>();
  /**
   * Set when a block resized without an edit: the CSS or a font changed, and may have rewrapped
   * other blocks without changing their height. The next render drops every cached line list
   * (heights stay; lines are measured again only for blocks that cross a page end).
   */
  private linesStale = false;
  /** The last flow and the nodes it was made for, for the next incremental one. */
  private flowed: { nodes: readonly ModelNode[]; result: FlowResult } | null = null;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly observed = new Set<Element>();
  private relayoutPending = false;
  private composing = false;
  /** Set by Ctrl/Cmd+Shift+V for the paste event it triggers. */
  private plainPaste = false;
  /** Blocks whose DOM the browser changed: the next render rebuilds them. */
  private readonly dirty = new Set<BlockDesc>();
  /** DOM mutations not yet read back (kept while a composition is running). */
  private pending: MutationRecord[] = [];
  private readonly observer: MutationObserver;
  private readonly unsubscribe: () => void;
  private editable = true;
  private placeholder = "";
  /** The block that shows the placeholder, if any. */
  private placeholderDom: HTMLElement | null = null;
  /** Set by a mousedown that focuses the host: the click places the caret, not the view. */
  private pointerFocus = false;
  /** Whether the view added the host's tabindex (a read-only host must stay focusable). */
  private readonly addedTabIndex: boolean;

  constructor(
    readonly host: HTMLElement,
    readonly editor: Editor,
    options: EditorViewOptions = {},
  ) {
    this.state = editor.state;
    host.setAttribute("role", "textbox");
    host.setAttribute("aria-multiline", "true");
    host.setAttribute(VIEW_ATTR, this.id);
    this.addedTabIndex = !host.hasAttribute("tabindex");
    if (this.addedTabIndex) host.tabIndex = 0;
    // Spaces typed into the model must stay visible and caret-addressable.
    host.style.whiteSpace = "pre-wrap";
    host.style.overflowWrap = "break-word";
    host.replaceChildren();
    this.resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(this.onResize);
    this.observer = new MutationObserver(this.onMutations);
    this.observer.observe(host, { childList: true, characterData: true, subtree: true });
    this.render();
    this.setOptions(options);

    host.addEventListener("beforeinput", this.onBeforeInput);
    host.addEventListener("focus", this.onFocus);
    host.addEventListener("keydown", this.onKeyDown);
    host.addEventListener("input", this.onInput);
    host.addEventListener("compositionstart", this.onCompositionStart);
    host.addEventListener("compositionend", this.onCompositionEnd);
    host.addEventListener("blur", this.onBlur);
    host.addEventListener("mousedown", this.onMouseDown);
    host.addEventListener("copy", this.onCopy);
    host.addEventListener("cut", this.onCut);
    host.addEventListener("paste", this.onPaste);
    host.addEventListener("click", this.onClick);
    host.addEventListener("auxclick", this.onClick);
    host.ownerDocument.addEventListener("selectionchange", this.onSelectionChange);
    host.ownerDocument.fonts?.addEventListener("loadingdone", this.onFontsLoaded);
    this.unsubscribe = editor.subscribe((state) => this.update(state));
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribe();
    this.host.ownerDocument.fonts?.removeEventListener("loadingdone", this.onFontsLoaded);
    this.observer.disconnect();
    this.resizeObserver?.disconnect();
    for (const style of this.printStyles) style.remove();
    const { host } = this;
    host.removeEventListener("beforeinput", this.onBeforeInput);
    host.removeEventListener("focus", this.onFocus);
    host.removeEventListener("keydown", this.onKeyDown);
    host.removeEventListener("input", this.onInput);
    host.removeEventListener("compositionstart", this.onCompositionStart);
    host.removeEventListener("compositionend", this.onCompositionEnd);
    host.removeEventListener("blur", this.onBlur);
    host.removeEventListener("mousedown", this.onMouseDown);
    host.removeEventListener("copy", this.onCopy);
    host.removeEventListener("cut", this.onCut);
    host.removeEventListener("paste", this.onPaste);
    host.removeEventListener("click", this.onClick);
    host.removeEventListener("auxclick", this.onClick);
    host.ownerDocument.removeEventListener("selectionchange", this.onSelectionChange);
    const owned = [
      "contenteditable",
      "role",
      "aria-multiline",
      "aria-readonly",
      "aria-placeholder",
      VIEW_ATTR,
    ];
    if (this.addedTabIndex) owned.push("tabindex");
    for (const name of owned) host.removeAttribute(name);
    host.style.removeProperty("white-space");
    host.style.removeProperty("overflow-wrap");
    if (!host.getAttribute("style")) host.removeAttribute("style");
    host.replaceChildren();
  }

  /** Focuses the host, shows the model selection in it and scrolls it into view. */
  focus(): void {
    this.host.focus();
    this.writeSelection(true);
    // The focus handler scrolls only when it writes the selection itself, and a DOM selection
    // that already shows the model's (Firefox keeps one in an unfocused host) skips that.
    this.scrollToSelection();
  }

  /** Changes the given options; the others keep their value. */
  setOptions(options: EditorViewOptions): void {
    const { host } = this;
    if (options.editable !== undefined) {
      // Finish a running composition while its text can still go into the model.
      if (!options.editable && this.composing) this.onCompositionEnd();
      this.editable = options.editable;
    }
    if (options.placeholder !== undefined) this.placeholder = options.placeholder;
    // Read-only: no caret and no browser editing; the text stays selectable and copyable.
    host.setAttribute("contenteditable", String(this.editable));
    if (this.editable) host.removeAttribute("aria-readonly");
    else host.setAttribute("aria-readonly", "true");
    if (this.placeholder) host.setAttribute("aria-placeholder", this.placeholder);
    else host.removeAttribute("aria-placeholder");
    this.showPlaceholder();
  }

  /**
   * Marks the only block while the document is one empty textblock; CSS shows the text. Hidden
   * during a composition, whose text the model does not have yet.
   */
  private showPlaceholder(): void {
    const { doc } = this.state;
    const empty =
      doc.childCount === 1 && doc.firstChild?.isTextblock && !doc.firstChild.content.size;
    const target =
      this.placeholder && empty && !this.composing ? (this.blocks[0]?.dom ?? null) : null;
    if (this.placeholderDom !== target) this.placeholderDom?.removeAttribute(PLACEHOLDER_ATTR);
    if (target) {
      injectStyles(this.host);
      target.setAttribute(PLACEHOLDER_ATTR, this.placeholder);
    }
    this.placeholderDom = target;
  }

  // ---------- rendering ----------

  private update(state: EditorState): void {
    const docChanged = state.doc !== this.state.doc;
    const selectionChanged = !state.selection.eq(this.state.selection);
    this.state = state;
    if (docChanged) this.render();
    this.showSelectedNode();
    this.writeSelection(docChanged);
    // shortcut: scrolls for every change while focused; once remote or plugin changes exist, scroll only for local input (a transaction flag).
    if (docChanged || selectionChanged) this.scrollToSelection();
  }

  /**
   * Scrolls the selection head into view. Browsers do it for their own edits and caret moves,
   * not when the view changes the DOM and sets the selection (typing, Enter, undo, paste).
   */
  private scrollToSelection(): void {
    if (this.composing || !this.hasFocus()) return;
    const doc = this.host.ownerDocument;
    const sel = doc.getSelection();
    const node = sel?.focusNode;
    if (!sel || !node || !this.host.contains(node)) return;
    const range = doc.createRange();
    range.setStart(node, sel.focusOffset);
    // An element point (next to a <br>, in an empty block) has no box of its own: measure the
    // <br> after it, else the one before, else the element (never a whole tall block).
    const near = node.childNodes[sel.focusOffset] ?? node.childNodes[sel.focusOffset - 1];
    const element =
      near instanceof Element
        ? near
        : node.nodeType === Node.ELEMENT_NODE
          ? (node as Element)
          : node.parentElement;
    const rect = range.getClientRects?.()[0] ?? element?.getBoundingClientRect();
    if (rect) scrollRectIntoView(this.host, rect);
  }

  /**
   * Renders the document into pages, reusing the DOM of blocks whose model node is unchanged.
   * Blocks are first placed where they were (a new block joins the page of the block before
   * it), then measured and flowed: a block that does not fit is split at a line boundary into
   * fragments on consecutive pages. During a composition nothing moves, since moving or
   * re-splitting the DOM the browser is composing in would break the IME.
   *
   * Measurements are cached by node and the flow restarts at the first changed block (5.4).
   */
  private render(): void {
    const { doc } = this.state;
    const ownerDocument = this.host.ownerDocument;
    const previous = new Map(
      this.blocks.filter((desc) => !this.dirty.has(desc)).map((desc) => [desc.node, desc]),
    );
    const previousPages = this.fragmentPages;
    this.dirty.clear();
    const dropLines = this.linesStale && !this.composing;
    if (dropLines) {
      this.linesStale = false;
      this.flowed = null;
    }
    let blocks: BlockDesc[] = [];
    const starts: number[] = [];
    const chains: (readonly Container[])[] = [];
    // Leaf blocks at any depth, in document order, with the containers around each.
    const open: Container[] = [];
    // The chain of the open containers and its key, rebuilt only when they change (blocks in
    // the same container share one array).
    let chain: readonly Container[] = [];
    let chainKey = "";
    const changed = () => {
      chain = open.slice();
      chainKey = open.map((container) => container.node.type.name).join(">");
    };
    doc.descendants((node, pos, _parent, index) => {
      let popped = false;
      while (open.length) {
        const last = open[open.length - 1] as Container;
        if (pos < last.pos + last.node.nodeSize) break;
        open.pop();
        popped = true;
      }
      if (!node.isTextblock && !node.isLeaf) {
        open.push({ node, pos, index, firstBlock: blocks.length });
        changed();
        return true;
      }
      if (popped) changed();
      // A block moved into or out of a container (wrapped in a list, indented, lifted) keeps its
      // node but not its line width or margins: measure it again, and re-flow from it.
      const before = this.chainKeys.get(node);
      if (before !== undefined && before !== chainKey) this.stale.add(node);
      this.chainKeys.set(node, chainKey);
      let reused = previous.get(node);
      // A split block about to be measured again (fonts, CSS) is rendered whole first: each
      // fragment's end breaks its line, so its lines would depend on where it was split before.
      const remeasure = dropLines || !this.measures.has(node) || this.stale.has(node);
      if (reused && reused.fragments.length > 1 && remeasure && !this.composing) reused = undefined;
      if (reused) previous.delete(node);
      blocks.push(reused ?? renderBlock(node, ownerDocument));
      starts.push(pos);
      chains.push(chain);
      return false;
    });
    for (const stale of previous.values())
      for (const fragment of stale.fragments) fragment.remove();
    this.applyGeometry();
    let last = 0;
    let pages = blocks.map((desc) => {
      const before = previousPages.get(desc);
      return desc.fragments.map((_, f) => (last = Math.max(last, before?.[f] ?? last)));
    });
    this.place(blocks, pages, chains);
    if (!this.composing) {
      // DOM reads only for blocks without a valid measurement (new, changed or stale ones).
      let scale: number | undefined;
      const layoutPx = () => {
        scale ??= layoutScale(this.pages[0] as HTMLElement, this.editor.settings);
        return scale;
      };
      if (dropLines)
        for (const desc of blocks) {
          const measure = this.measures.get(desc.node);
          if (measure) delete measure.lines;
        }
      const nodes = blocks.map((desc) => desc.node);
      const reuse = this.flowed ? reuseOf(this.flowed, nodes, this.stale) : undefined;
      const measureOf = (desc: BlockDesc) => {
        let found = this.measures.get(desc.node);
        // A stale block is measured again once per render.
        if (!found || this.stale.delete(desc.node)) {
          found = measureBox(desc, layoutPx());
          this.measures.set(desc.node, found);
        }
        return found;
      };
      const lines = (desc: BlockDesc) => {
        const found = measureOf(desc);
        found.lines ??= measureLines(desc, layoutPx());
        return found.lines;
      };
      const boxes = blocks.map((desc) => blockBox(desc, measureOf(desc), () => lines(desc)));
      const result = flowFrom(boxes, contentHeight(this.editor.settings), DEFAULT_RULES, reuse);
      this.flowed = { nodes, result };
      this.stale.clear();
      const flowed = result.fragments;
      blocks = blocks.map((desc, i) => {
        const fragments = flowed[i] ?? [];
        const contentStart = (starts[i] as number) + 1;
        const splits = fragments.slice(1).map((fragment) => {
          const offset = lines(desc).starts[fragment.fromLine] as number;
          // Never split a grapheme cluster across pages.
          return clusterBoundary(doc, contentStart + offset, false) - contentStart;
        });
        const same =
          splits.length === desc.splits.length && splits.every((at, k) => at === desc.splits[k]);
        return same ? desc : renderBlock(desc.node, ownerDocument, splits);
      });
      pages = flowed.map((fragments) => fragments.map((fragment) => fragment.page));
      this.place(blocks, pages, chains);
    }
    this.blocks = blocks;
    this.starts = starts;
    this.chains = chains;
    this.indexOf = new Map(blocks.map((desc, i) => [desc, i]));
    this.fragmentPages = new Map(blocks.map((desc, i) => [desc, pages[i] ?? []]));
    this.owner = new Map(
      blocks.flatMap((desc) => desc.fragments.map((fragment) => [fragment, desc] as const)),
    );
    this.unflowed = this.composing;
    this.observeSizes();
    this.showPlaceholder();
    this.showSelectedNode();
    // The view's own DOM changes are not input. During a composition, keep what the browser
    // changed before this render: the touched blocks are read back at compositionend.
    const records = this.observer.takeRecords();
    if (this.composing) this.pending.push(...records);
  }

  /**
   * Puts each fragment of each block into its page (pages are non-decreasing in document
   * order), inside the elements of the block's containers (lists, list items), creating and
   * removing pages as needed. A page reuses the container elements already at the same place
   * (same tag, in order), so an edit inside a list moves no DOM. Anything else in the host, a
   * page or a container (stray DOM) is removed.
   */
  private place(
    blocks: readonly BlockDesc[],
    pages: readonly (readonly number[])[],
    chains: readonly (readonly Container[])[],
  ): void {
    const { host } = this;
    const items = blocks.flatMap((desc, i) =>
      desc.fragments.map((dom, f) => ({ dom, page: pages[i]?.[f] ?? 0, block: i, fragment: f })),
    );
    const count = (items[items.length - 1]?.page ?? 0) + 1;
    while (this.pages.length < count) this.pages.push(this.createPage());
    // Pages first, in order; anything else in the host ends up after them.
    let cursor = host.firstChild;
    for (const page of this.pages.slice(0, count)) {
      if (page === cursor) cursor = cursor.nextSibling;
      else host.insertBefore(page, cursor);
    }
    const ownerDocument = host.ownerDocument;
    /** Removes what is left after the last placed child (strays, and blocks of later pages). */
    const closeLevel = (level: { at: ChildNode | null }) => {
      let at = level.at;
      while (at) {
        const next: ChildNode | null = at.nextSibling;
        at.remove();
        at = next;
      }
    };
    // Block fragments not placed yet, and their blocks. A container element whose first block is
    // still to be placed, in another container at that level, belongs to that later container: a
    // block before it gets a new element instead of taking it (which would move every later block
    // into the next element along, e.g. when one list item moves to the next page).
    const pending = new Map<Node, number>(items.map((item) => [item.dom, item.block]));
    /** Container elements placed in this pass (never taken twice). */
    const claimed = new Set<Node>();
    let i = 0;
    for (let p = 0; p < count; p++) {
      const page = this.pages[p] as HTMLElement;
      const stack: { el: HTMLElement; at: ChildNode | null; pos: number }[] = [
        { el: page, at: page.firstChild, pos: -1 },
      ];
      for (; i < items.length && items[i]?.page === p; i++) {
        const item = items[i] as (typeof items)[number];
        const chain = chains[item.block] ?? [];
        // Keep the open containers this block shares with the previous one on this page.
        let common = 0;
        while (
          common < chain.length &&
          common + 1 < stack.length &&
          stack[common + 1]?.pos === (chain[common] as Container).pos
        )
          common++;
        while (stack.length > common + 1) closeLevel(stack.pop() as (typeof stack)[number]);
        for (let k = common; k < chain.length; k++) {
          const container = chain[k] as Container;
          const parent = stack[stack.length - 1] as (typeof stack)[number];
          let element: HTMLElement;
          const candidate = parent.at;
          const later = isWrapperFor(candidate, container.node)
            ? pending.get(firstBlockIn(candidate) as Node)
            : undefined;
          // The element that holds this block now, at the innermost level: a list item whose
          // block moves to another page takes its element along (as a paragraph does), instead
          // of a new one replacing it on every page an edit shifts.
          const own = k === chain.length - 1 ? item.dom.parentNode : null;
          if (
            isWrapperFor(candidate, container.node) &&
            !claimed.has(candidate) &&
            (later === undefined || chains[later]?.[k]?.pos === container.pos)
          ) {
            element = candidate;
            parent.at = element.nextSibling;
          } else if (
            isWrapperFor(own, container.node) &&
            !claimed.has(own) &&
            !own.contains(parent.el)
          ) {
            element = own;
            for (const level of stack) if (level.at === element) level.at = element.nextSibling;
            parent.el.insertBefore(element, parent.at);
          } else {
            element = createWrapper(container.node, ownerDocument);
            parent.el.insertBefore(element, parent.at);
          }
          claimed.add(element);
          styleContainer(element, container, chain[k - 1], item);
          stack.push({ el: element, at: element.firstChild, pos: container.pos });
        }
        const top = stack[stack.length - 1] as (typeof stack)[number];
        if (item.dom === top.at) top.at = top.at.nextSibling;
        else {
          // A cursor of an outer level may point at this block (it moves into a new container):
          // step it past, or it would point into the container.
          for (const level of stack) if (level.at === item.dom) level.at = item.dom.nextSibling;
          top.el.insertBefore(item.dom, top.at);
        }
        pending.delete(item.dom);
      }
      while (stack.length) closeLevel(stack.pop() as (typeof stack)[number]);
    }
    // Pages no longer needed and stray DOM in the host: all after the last page by now.
    let rest = (this.pages[count - 1] as HTMLElement).nextSibling;
    while (rest) {
      const next: ChildNode | null = rest.nextSibling;
      rest.remove();
      rest = next;
    }
    this.pages.length = count;
  }

  private createPage(): HTMLElement {
    const page = this.host.ownerDocument.createElement("section");
    page.className = "foli-page";
    page.style.cssText = this.pageStyle;
    return page;
  }

  /** Page size and margins from the document settings, applied to every page when they change. */
  private applyGeometry(): void {
    const { pageSize, margins } = this.editor.settings;
    const style =
      `box-sizing: border-box; width: ${pageSize.width}mm; min-height: ${pageSize.height}mm; ` +
      `padding: ${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm;`;
    if (style === this.pageStyle) return;
    this.pageStyle = style;
    for (const page of this.pages) page.style.cssText = style;
    // shortcut: written when the page settings change; a host moved to another document or shadow root keeps them where they were until then.
    for (const style of this.printStyles) style.remove();
    const doc = this.host.ownerDocument;
    const root = this.host.getRootNode();
    const parents: ParentNode[] = [doc.head ?? doc.documentElement];
    if (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE) parents.push(root as ShadowRoot);
    this.printStyles = parents.map((parent) => {
      const style = doc.createElement("style");
      style.setAttribute("data-foli-print", "");
      style.textContent = printStyles(this.editor.settings, this.id);
      parent.append(style);
      return style;
    });
    this.invalidateLayout();
  }

  /** Forgets every measurement: the next flow measures the whole document again. */
  private invalidateLayout(): void {
    this.measures = new WeakMap();
    this.flowed = null;
  }

  /** Re-flows the pages once web fonts have loaded: line heights and wrapping change. */
  private onFontsLoaded = (): void => {
    this.invalidateLayout();
    this.scheduleRelayout();
  };

  /** Observes the size of every rendered block element (and only those). */
  private observeSizes(): void {
    if (!this.resizeObserver) return;
    for (const element of this.observed) {
      if (this.owner.has(element)) continue;
      this.resizeObserver.unobserve(element);
      this.observed.delete(element);
    }
    for (const element of this.owner.keys()) {
      if (!(element instanceof Element) || this.observed.has(element)) continue;
      this.resizeObserver.observe(element);
      this.observed.add(element);
    }
  }

  /**
   * A block whose height no longer matches its measurement changed without an edit (CSS, a web
   * font, the content width): measure it again and re-flow, once per frame.
   */
  private onResize = (entries: ResizeObserverEntry[]): void => {
    let scale: number | undefined;
    for (const entry of entries) {
      const desc = this.owner.get(entry.target);
      const measured = desc && this.measures.get(desc.node);
      if (!desc || !measured || this.stale.has(desc.node)) continue;
      // A hidden host (display: none) reports every block as 0x0: nothing to re-flow.
      if (!entry.contentRect.width) continue;
      scale ??= layoutScale(this.pages[0] as HTMLElement, this.editor.settings);
      let height = 0;
      for (const fragment of desc.fragments) height += fragment.getBoundingClientRect().height;
      // A block is measured whole; each fragment of a split one keeps its padding and border,
      // and each split may round by up to a pixel. Compared with the whole height alone, its
      // fragments would re-flow it every frame.
      const splits = desc.fragments.length - 1;
      const expected = measured.height + splits * measured.box;
      if (Math.abs(height / scale - expected) > 0.5 + splits) {
        this.stale.add(desc.node);
        this.linesStale = true;
      }
    }
    if (this.stale.size) this.scheduleRelayout();
  };

  /** Re-flows in the next animation frame (several requests in one frame make one pass). */
  private scheduleRelayout(): void {
    if (this.relayoutPending) return;
    this.relayoutPending = true;
    const win = this.host.ownerDocument.defaultView;
    const nextFrame = (callback: () => void) =>
      win?.requestAnimationFrame ? win.requestAnimationFrame(callback) : setTimeout(callback);
    const run = () => {
      this.relayoutPending = false;
      if (this.destroyed) return;
      // compositionend flows what a composition kept from moving.
      if (this.composing) {
        this.unflowed = true;
        return;
      }
      this.render();
      this.writeSelection(false);
    };
    nextFrame(run);
  }

  // ---------- position mapping ----------

  /** The block element (a fragment of a rendered block) that contains `node`, or null. */
  private blockElement(node: Node | null): Node | null {
    for (let element = node; element && element !== this.host; element = element.parentNode) {
      if (this.owner.has(element)) return element;
    }
    return null;
  }

  /** Whether `node` holds blocks rather than content: the host, a page or a container. */
  private holdsBlocks(node: Node): boolean {
    return node === this.host || this.pages.includes(node as HTMLElement) || isWrapper(node);
  }

  /** Index of the first block that starts at or after `pos` (the block count if none). */
  private blockFrom(pos: number): number {
    let lo = 0;
    let hi = this.starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.starts[mid] as number) < pos) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Model position of a DOM point inside the host, or null if it is outside. */
  posFromDOM(node: Node, offset: number): number | null {
    const { host } = this;
    if (this.holdsBlocks(node)) {
      // Between fragments: the start of the first one after the point (a block start, or
      // where a continuation starts), else the document end.
      const range = host.ownerDocument.createRange();
      range.setStart(node, offset);
      for (const [i, desc] of this.blocks.entries()) {
        const f = desc.fragments.findIndex((fragment) => range.comparePoint(fragment, 0) >= 0);
        if (f === 0) return this.starts[i] as number;
        if (f > 0) return (this.starts[i] as number) + 1 + (desc.splits[f - 1] as number);
      }
      return this.state.doc.content.size;
    }
    const element = this.blockElement(node);
    const owner = element ? this.owner.get(element) : undefined;
    const index = owner ? (this.indexOf.get(owner) ?? -1) : -1;
    const desc = this.blocks[index];
    if (!desc) return null;
    // A point in or at a block leaf (a rule): before it, or after it at its end.
    if (!desc.node.isTextblock) {
      const after = node === desc.dom && offset > 0;
      return (this.starts[index] as number) + (after ? desc.node.nodeSize : 0);
    }
    const contentStart = (this.starts[index] as number) + 1;
    const leaf = desc.leaves.find((l) => l.dom === node);
    if (leaf && node.nodeType === Node.TEXT_NODE)
      return contentStart + leaf.offset + Math.min(offset, leaf.size);
    // An element point: the start of the first leaf at or after it, else the end of the block.
    const range = host.ownerDocument.createRange();
    range.setStart(node, offset);
    for (const l of desc.leaves) {
      if (range.comparePoint(l.dom, 0) >= 0) return contentStart + l.offset;
    }
    return contentStart + desc.node.content.size;
  }

  /** DOM point for a model position. At a mark boundary the caret stays in the text before it. */
  domFromPos(pos: number): DomPoint {
    const { doc } = this.state;
    const $pos = doc.resolve(pos);
    if (!$pos.parent.isTextblock) {
      // Between blocks: the start of the next block (before a rule), else the document end.
      const next = this.blocks[this.blockFrom(pos)];
      if (next) return next.node.isTextblock ? fragmentStart(next, 0) : before(next.dom);
      const last = this.blocks[this.blocks.length - 1] as BlockDesc;
      if (!last.node.isTextblock) {
        const point = before(last.dom);
        return { node: point.node, offset: point.offset + 1 };
      }
      return fragmentEnd(last, last.fragments.length - 1);
    }
    const desc = this.blocks[this.blockFrom($pos.before())] as BlockDesc;
    const offset = $pos.parentOffset;
    // Where a fragment starts, show the caret at the start of the next page's fragment, as a
    // browser shows it at the start of the next line at a soft wrap.
    const split = desc.splits.indexOf(offset);
    if (split >= 0) return fragmentStart(desc, split + 1);
    for (const leaf of desc.leaves) {
      if (
        leaf.dom.nodeType === Node.TEXT_NODE &&
        leaf.offset <= offset &&
        offset <= leaf.offset + leaf.size
      )
        return { node: leaf.dom, offset: offset - leaf.offset };
    }
    const next = desc.leaves.find((leaf) => leaf.offset >= offset);
    if (next) return before(next.dom);
    const last = desc.leaves[desc.leaves.length - 1];
    if (last) {
      const point = before(last.dom);
      return { node: point.node, offset: point.offset + 1 };
    }
    return { node: desc.dom, offset: 0 };
  }

  // ---------- selection ----------

  /** The live DOM selection as a model selection, or null if it is not inside the host. */
  private readSelection(): Selection | null {
    const sel = this.host.ownerDocument.getSelection();
    if (!sel?.anchorNode || !sel.focusNode) return null;
    // A range around exactly one block leaf element (a rule): the node selection that wrote it.
    // (Its end, mapped alone, would be the start of the next block, not the end of the rule.)
    if (sel.anchorNode === sel.focusNode && Math.abs(sel.anchorOffset - sel.focusOffset) === 1) {
      const child = sel.anchorNode.childNodes[Math.min(sel.anchorOffset, sel.focusOffset)];
      const owner = child && this.owner.get(child);
      const index = owner ? (this.indexOf.get(owner) ?? -1) : -1;
      if (owner && !owner.node.isTextblock && NodeSelection.isSelectable(owner.node))
        return NodeSelection.create(this.state.doc, this.starts[index] as number);
    }
    const anchor = this.posFromDOM(sel.anchorNode, sel.anchorOffset);
    const head = this.posFromDOM(sel.focusNode, sel.focusOffset);
    if (anchor === null || head === null) return null;
    const { doc } = this.state;
    // Exactly around a selectable block leaf (a rule): the node selection that wrote it.
    const from = Math.min(anchor, head);
    const node = doc.nodeAt(from);
    if (
      node &&
      node.isBlock &&
      node.isAtom &&
      Math.max(anchor, head) === from + node.nodeSize &&
      NodeSelection.isSelectable(node)
    )
      return NodeSelection.create(doc, from);
    return TextSelection.between(doc.resolve(anchor), doc.resolve(head));
  }

  /** The rendered block a node selection selects, if it selects one. */
  private selectedBlock(): BlockDesc | null {
    const { selection } = this.state;
    if (!(selection instanceof NodeSelection)) return null;
    const desc = this.blocks[this.blockFrom(selection.from)];
    return desc && this.starts[this.indexOf.get(desc) ?? -1] === selection.from ? desc : null;
  }

  /** Marks the element of a node-selected block, for styling (the DOM selection is around it). */
  private showSelectedNode(): void {
    const dom = this.selectedBlock()?.dom ?? null;
    if (dom === this.selectedDom) return;
    this.selectedDom?.classList.remove(SELECTED_CLASS);
    dom?.classList.add(SELECTED_CLASS);
    this.selectedDom = dom;
  }

  /**
   * Brings the model selection up to date with the DOM. `selectionchange` is asynchronous, so
   * every input handler calls this first instead of trusting the last event.
   */
  private syncSelection(): void {
    const selection = this.readSelection();
    if (!selection || this.shows(selection)) return;
    // A caret moved by the user drops marks toggled at the old position.
    this.dispatch(this.state.tr.setSelection(selection).setStoredMarks(null));
  }

  /**
   * Whether a selection read from the DOM already shows the model selection. An AllSelection is
   * shown as the text range between its snapped ends, so reading it back must not replace it.
   */
  private shows(dom: Selection): boolean {
    const { selection } = this.state;
    const shown =
      selection instanceof AllSelection
        ? TextSelection.between(selection.$anchor, selection.$head)
        : selection;
    return dom.anchor === shown.anchor && dom.head === shown.head;
  }

  private hasFocus(): boolean {
    const active = this.host.ownerDocument.activeElement;
    return active === this.host || this.host.contains(active);
  }

  /** Writes the model selection to the DOM unless the DOM already shows it (keeps native affinity). */
  private writeSelection(force: boolean): void {
    if (this.composing || !this.hasFocus()) return;
    const sel = this.host.ownerDocument.getSelection();
    if (!sel) return;
    const { selection, doc } = this.state;
    if (!force) {
      const current = this.readSelection();
      if (current && this.shows(current)) return;
    }
    const selected = this.selectedBlock();
    if (selected) {
      const point = before(selected.dom);
      sel.setBaseAndExtent(point.node, point.offset, point.node, point.offset + 1);
      return;
    }
    // Never show a caret inside a grapheme cluster (the core snaps only out of surrogate pairs).
    // The model takes the snapped selection back on its next read of the DOM.
    const from = clusterBoundary(doc, selection.from, false);
    const to = selection.empty ? from : clusterBoundary(doc, selection.to, true);
    const forward = selection.anchor <= selection.head;
    const anchor = this.domFromPos(forward ? from : to);
    const head = this.domFromPos(forward ? to : from);
    sel.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
  }

  // ---------- input ----------

  private run(command: Command): boolean {
    return command(this.state, (tr) => this.dispatch(tr));
  }

  /**
   * Every change from user input goes through here. Read-only mode drops document changes and
   * newly stored marks (Mod+B on a caret); selection changes, and clearing stored marks, still
   * apply. Code can always change the document through the editor.
   */
  private dispatch(tr: Transaction): boolean {
    const marksAdded = tr.storedMarks !== null && tr.storedMarks !== this.state.storedMarks;
    if (!this.editable && (tr.docChanged || marksAdded)) return false;
    this.editor.dispatch(tr);
    return true;
  }

  /** Selects the event's target range when the browser gives a non-empty one (spellcheck, deletes). */
  private selectTargetRange(event: InputEvent): void {
    const range = event.getTargetRanges?.()[0];
    if (!range || range.collapsed) return;
    const from = this.posFromDOM(range.startContainer, range.startOffset);
    const to = this.posFromDOM(range.endContainer, range.endOffset);
    if (from === null || to === null) return;
    const { doc } = this.state;
    const selection = TextSelection.between(doc.resolve(from), doc.resolve(to));
    if (!selection.eq(this.state.selection)) this.dispatch(this.state.tr.setSelection(selection));
  }

  private onBeforeInput = (event: InputEvent): void => {
    // During composition the browser owns the DOM; it is reconciled at compositionend. A
    // composition event that arrives after it must not fall through to a delete or insert.
    if (event.isComposing || this.composing || COMPOSITION_INPUT.has(event.inputType)) return;
    event.preventDefault();
    this.syncSelection();
    const type = event.inputType;
    const text = event.data ?? event.dataTransfer?.getData("text/plain") ?? "";
    switch (type) {
      case "insertText":
        this.run(insertText(text));
        return;
      case "insertReplacementText":
        this.selectTargetRange(event);
        this.run(insertText(text));
        return;
      case "insertParagraph":
        // The same as Enter (a list item splits or ends), for keyboards that send no keydown.
        if (!this.runKey("Enter")) this.run(splitBlock);
        return;
      case "insertLineBreak":
        this.run(insertHardBreak);
        return;
      case "historyUndo":
        this.run(undo);
        return;
      case "historyRedo":
        this.run(redo);
        return;
      case "formatBold":
      case "formatItalic":
      case "formatUnderline":
      case "formatStrikeThrough": {
        const mark = type === "formatStrikeThrough" ? "strike" : type.slice(6).toLowerCase();
        this.run(toggleMark(mark));
        return;
      }
    }
    if (!type.startsWith("delete") || type === "deleteByDrag") return;
    this.selectTargetRange(event);
    if (this.state.selection.empty && type.includes("Line")) {
      // No target range: let the browser find the line edge, never delete a character instead.
      // shortcut: hard-line deletes also stop at the visual line edge here; Chromium, Firefox and WebKit all give a range.
      const sel = this.host.ownerDocument.getSelection();
      if (type === "deleteEntireSoftLine") {
        sel?.modify?.("move", "backward", "lineboundary");
        sel?.modify?.("extend", "forward", "lineboundary");
      } else {
        sel?.modify?.("extend", type.endsWith("Forward") ? "forward" : "backward", "lineboundary");
      }
      this.syncSelection();
      this.run(deleteSelection);
      return;
    }
    if (!this.state.selection.empty || type === "deleteByCut" || type === "deleteContent") {
      this.run(deleteSelection);
      return;
    }
    const unit = type.startsWith("deleteWord") ? "word" : "char";
    // A one-character delete goes through the key bindings first (Backspace at a list item's
    // start lifts it), as the key itself would.
    if (unit === "char" && this.runKey(type.endsWith("Forward") ? "Delete" : "Backspace")) return;
    this.run(type.endsWith("Forward") ? deleteForward(unit) : deleteBackward(unit));
  };

  /** Runs the first command bound to `name` that applies, through the view's dispatch. */
  private runKey(name: string): boolean {
    return this.state.plugins.some((plugin) => {
      const command = plugin.spec.keymap?.[name];
      return command ? this.run(command) : false;
    });
  }

  /**
   * Triple-click selects the clicked block's content. Chromium and WebKit natively extend the
   * selection to the start of the next block, so typing over it would merge the two blocks.
   */
  private onMouseDown = (event: MouseEvent): void => {
    this.pointerFocus = !this.hasFocus();
    // Focus from a mousedown happens in its default action, before this timer. A mousedown that
    // focuses nothing (prevented, middle button) must not skip the next keyboard focus.
    if (this.pointerFocus) setTimeout(() => (this.pointerFocus = false));
    if (event.button !== 0) return;
    const element = this.blockElement(event.target as Node | null);
    const owner = element ? this.owner.get(element) : undefined;
    const index = owner ? (this.indexOf.get(owner) ?? -1) : -1;
    const desc = this.blocks[index];
    if (!desc) return;
    const { doc } = this.state;
    const start = this.starts[index] as number;
    let selection: Selection;
    if (!desc.node.isTextblock) {
      // A click on a rule selects it (the browser would put the caret beside it); Shift+click
      // extends the selection natively.
      if (event.shiftKey || !NodeSelection.isSelectable(desc.node)) return;
      selection = NodeSelection.create(doc, start);
    } else if (event.detail === 3) {
      selection = TextSelection.create(doc, start + 1, start + 1 + desc.node.content.size);
    } else return;
    event.preventDefault();
    this.host.focus();
    this.dispatch(this.state.tr.setSelection(selection).setStoredMarks(null));
    this.writeSelection(true);
  };

  /**
   * A click on a link in the document does not navigate (it places the caret, also in read-only
   * mode); Ctrl+click (Cmd+click on Apple platforms) opens it in a new tab, without `opener`.
   */
  private onClick = (event: MouseEvent): void => {
    const target = event.target;
    const element = target instanceof Element ? target.closest("a") : null;
    if (!element || !this.host.contains(element)) return;
    event.preventDefault();
    if (event.type !== "click" || !(IS_MAC ? event.metaKey : event.ctrlKey)) return;
    const href = this.linkHref(element);
    if (href) this.host.ownerDocument.defaultView?.open(href, "_blank", "noopener,noreferrer");
  };

  /** The href of the link an `<a>` shows, read from the model (the DOM is never the truth). */
  private linkHref(element: Element): string | null {
    const pos = this.posFromDOM(element, 0);
    const type = this.state.schema.marks.link;
    if (pos === null || !type) return null;
    const $pos = this.state.doc.resolve(pos);
    const node = $pos.parent.maybeChild($pos.index());
    const href = node && type.isInSet(node.marks)?.attrs.href;
    return typeof href === "string" ? href : null;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing || this.composing) return;
    this.syncSelection();
    if (this.crossFragmentEdge(event)) {
      event.preventDefault();
      return;
    }
    const name = keyName(event);
    // Ctrl/Cmd+Shift+V: the paste event that follows uses only the plain text.
    this.plainPaste = name === "Mod-Shift-v";
    // Like `editor.handleKey`, but through the view's dispatch, so read-only mode drops edits.
    // A key no command takes keeps its default (Tab outside a list moves the focus on).
    if (this.runKey(name)) {
      event.preventDefault();
      return;
    }
    // Up/Down on a textblock's first/last line next to a rule select it (only the view knows
    // lines; measured only when a rule is beside the block); else the browser moves the caret.
    const vertical = name === "ArrowUp" ? -1 : name === "ArrowDown" ? 1 : 0;
    const across = vertical ? arrowAcrossLeaf(vertical, "line") : null;
    if (across?.(this.state) && this.caretOnEdgeLine(vertical as -1 | 1) && this.run(across)) {
      event.preventDefault();
    }
  };

  /**
   * Whether the caret is on the first (`dir` -1) or last (1) line of its textblock, in the
   * block's first or last fragment (a block split across pages has several).
   */
  private caretOnEdgeLine(dir: -1 | 1): boolean {
    const sel = this.host.ownerDocument.getSelection();
    if (!sel?.rangeCount || !sel.isCollapsed || !sel.focusNode) return false;
    const element = this.blockElement(sel.focusNode);
    const desc = element ? this.owner.get(element) : undefined;
    if (!desc?.node.isTextblock) return false;
    const fragment = desc.fragments[dir < 0 ? 0 : desc.fragments.length - 1];
    if (!fragment || element !== fragment) return false;
    if (!desc.node.content.size) return true;
    const caret = sel.getRangeAt(0).getClientRects()[0];
    const lines = this.host.ownerDocument.createRange();
    lines.selectNodeContents(fragment);
    const rects = lines.getClientRects();
    const edge = rects[dir < 0 ? 0 : rects.length - 1];
    // No caret box (some positions next to a line break): leave the move to the browser.
    if (!caret || !edge) return false;
    return dir < 0 ? caret.top + 1 < edge.bottom : caret.bottom - 1 > edge.top;
  }

  /**
   * Caret affinity at a page break. The end of one fragment and the start of the next are two
   * DOM caret stops for one model position, so a native Left/Right (or word move) there would
   * seem to do nothing. Step over the edge first, then let the browser make the move.
   *
   * shortcut: left-to-right only (ArrowRight is forward); bidi text needs visual order here and in the line measurement.
   */
  private crossFragmentEdge(event: KeyboardEvent): boolean {
    const forward = event.key === "ArrowRight";
    if (!forward && event.key !== "ArrowLeft") return false;
    // Word moves are Alt on Apple platforms and Ctrl elsewhere; other modifiers are not moves
    // this view knows (Cmd+arrows go to the line edge, Alt+arrows navigate history on Windows).
    const word = IS_MAC ? event.altKey : event.ctrlKey;
    if (event.metaKey || (IS_MAC ? event.ctrlKey : event.altKey)) return false;
    const sel = this.host.ownerDocument.getSelection();
    if (!sel?.focusNode || !sel.anchorNode || !sel.modify) return false;
    if (!event.shiftKey && !sel.isCollapsed) return false;
    const element = this.blockElement(sel.focusNode);
    const desc = element ? this.owner.get(element) : undefined;
    if (!desc || desc.fragments.length < 2) return false;
    const f = desc.fragments.indexOf(element as HTMLElement);
    const head = this.posFromDOM(sel.focusNode, sel.focusOffset);
    if (head === null) return false;
    const offset = head - (this.starts[this.indexOf.get(desc) ?? -1] as number) - 1;
    let target: DomPoint | null = null;
    // Stepping back over an edge after a hard break lands before the <br>: the point after it
    // is still the split, and browsers would show it before the <br> anyway. That step is
    // already the one-character move.
    let moved = false;
    if (forward && f < desc.fragments.length - 1 && offset === desc.splits[f])
      target = fragmentStart(desc, f + 1);
    else if (!forward && f > 0 && offset === desc.splits[f - 1]) {
      const fragment = desc.fragments[f - 1] as HTMLElement;
      const inside = desc.leaves.filter((l) => fragment.contains(l.dom));
      const last = inside[inside.length - 1];
      if (last && last.dom.nodeType !== Node.TEXT_NODE && last.offset + last.size === offset) {
        target = before(last.dom);
        moved = !word;
      } else target = fragmentEnd(desc, f - 1);
    }
    if (!target) return false;
    if (event.shiftKey)
      sel.setBaseAndExtent(sel.anchorNode, sel.anchorOffset, target.node, target.offset);
    else sel.collapse(target.node, target.offset);
    if (!moved)
      sel.modify(
        event.shiftKey ? "extend" : "move",
        forward ? "forward" : "backward",
        word ? "word" : "character",
      );
    this.syncSelection();
    return true;
  }

  /** Safety net: a DOM change that was not prevented is read back into the model. */
  private onInput = (): void => {
    if (!this.composing) this.flush();
  };

  private onCompositionStart = (): void => {
    this.syncSelection();
    this.composing = true;
    this.showPlaceholder();
  };

  private onCompositionEnd = (): void => {
    this.composing = false;
    this.flush();
    // A render during the composition did not flow; if the read-back rendered nothing, flow now.
    if (this.unflowed) {
      this.render();
      this.writeSelection(false);
    }
    this.showPlaceholder();
  };

  /**
   * Focus from the keyboard or from code shows the model selection: once the page selection has
   * moved elsewhere, browsers put the caret at the start of the host instead. A DOM selection
   * that already shows the model selection (the window or tab regaining focus) is left alone,
   * and so is the scroll position.
   */
  private onFocus = (): void => {
    const pointer = this.pointerFocus;
    this.pointerFocus = false;
    if (pointer) return;
    const current = this.readSelection();
    if (current && this.shows(current)) return;
    this.writeSelection(true);
    this.scrollToSelection();
  };

  /** Some browsers drop compositionend when focus leaves mid-composition; never stay stuck in it. */
  private onBlur = (): void => {
    this.pointerFocus = false;
    if (this.composing) this.onCompositionEnd();
  };

  private onMutations = (records: MutationRecord[]): void => {
    this.pending.push(...records);
    if (!this.composing) this.flush();
  };

  /** Reads back every DOM change recorded so far. */
  private flush(): void {
    const records = [...this.pending, ...this.observer.takeRecords()];
    this.pending = [];
    if (records.length) this.readBack(records);
  }

  /**
   * Turns DOM changes into a transaction: diffs the DOM text with the model text (blocks joined
   * by a separator, hard breaks as one character) and replaces the minimal changed range. The
   * DOM caret only breaks ties, so typing "a" after "a" lands where the browser put it. Blocks
   * whose DOM was touched are re-rendered even if their text is unchanged.
   *
   * shortcut: diffs the whole document text (O(document) per composition); limit it to the
   * touched blocks if it shows in profiles.
   */
  private readBack(records: readonly MutationRecord[]): void {
    for (const record of records) {
      const node = this.blockElement(record.target);
      const desc = node && this.owner.get(node);
      if (desc) this.dirty.add(desc);
    }
    const hardBreaks = new Set<Node>();
    for (const desc of this.blocks)
      for (const leaf of desc.leaves)
        if (leaf.dom.nodeType !== Node.TEXT_NODE) hardBreaks.add(leaf.dom);

    const sel = this.host.ownerDocument.getSelection();
    let caret = -1;
    let domText = "";
    const walk = (node: Node): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node === sel?.focusNode) caret = domText.length + sel.focusOffset;
        domText += (node as Text).data;
      } else if (hardBreaks.has(node)) domText += HARD_BREAK;
      else node.childNodes.forEach(walk);
    };
    let first = true;
    // Block-level nodes in order: inside pages and containers, and anything else in the host.
    const blockLevel: Node[] = [];
    const collect = (parent: Node) => {
      for (const child of parent.childNodes) {
        if (this.holdsBlocks(child)) collect(child);
        else blockLevel.push(child);
      }
    };
    collect(this.host);
    let previousOwner: BlockDesc | undefined;
    for (const child of blockLevel) {
      const owner = this.owner.get(child);
      // An empty stray node (an extension's marker) holds no text; the re-render removes it.
      if (!owner && !child.textContent) continue;
      // The fragments of one block are one text; anything else starts a new block.
      if (!first && !(owner && owner === previousOwner)) domText += BLOCK_SEPARATOR;
      first = false;
      previousOwner = owner;
      walk(child);
    }

    const { doc } = this.state;
    const lineStarts: number[] = [];
    let modelText = "";
    this.blocks.forEach(({ node: block }, i) => {
      if (i > 0) modelText += BLOCK_SEPARATOR;
      lineStarts.push(modelText.length);
      modelText += block.textBetween(0, block.content.size, "", HARD_BREAK);
    });
    /** Model position of an offset in `modelText`. */
    const posAt = (offset: number): number => {
      let i = lineStarts.length - 1;
      while (i > 0 && (lineStarts[i] as number) > offset) i--;
      return (this.starts[i] as number) + 1 + offset - (lineStarts[i] as number);
    };

    if (domText === modelText) {
      this.rerender();
      return;
    }
    // The minimal change: common prefix, then common suffix (never overlapping the prefix).
    let start = 0;
    const shorter = Math.min(modelText.length, domText.length);
    while (start < shorter && modelText[start] === domText[start]) start++;
    let end = modelText.length;
    let domEnd = domText.length;
    while (end > start && domEnd > start && modelText[end - 1] === domText[domEnd - 1]) {
      end--;
      domEnd--;
    }
    // A pure insertion or deletion inside repeated text ("aa" → "aaa") could sit at several
    // offsets; slide it back to where the DOM caret says it happened.
    const insertion = end === start;
    if (caret >= 0 && insertion !== (domEnd === start)) {
      while (
        start > 0 &&
        (insertion ? domEnd > caret : start > caret) &&
        modelText[start - 1] === (insertion ? domText[domEnd - 1] : modelText[end - 1])
      ) {
        start--;
        end--;
        domEnd--;
      }
    }
    // Never split a surrogate pair.
    if (start > 0 && isHighSurrogate(modelText.charCodeAt(start - 1))) start--;
    if (end < modelText.length && isHighSurrogate(modelText.charCodeAt(end - 1))) {
      end++;
      domEnd++;
    }
    const inserted = domText.slice(start, domEnd);
    if (inserted.includes(BLOCK_SEPARATOR) || inserted.includes(HARD_BREAK)) {
      // shortcut: a change that adds blocks or line breaks cannot be read back yet; it is dropped.
      console.warn("Foli: discarded a DOM change that adds blocks or line breaks");
      this.rerender();
      return;
    }
    // One transaction: the command runs on a state with the changed range selected.
    const range = TextSelection.create(doc, posAt(start), posAt(end));
    const selected = this.state.apply(this.state.tr.setSelection(range));
    const command = inserted ? insertText(inserted) : deleteSelection;
    // A filtered or read-only transaction renders nothing: still drop the browser's DOM.
    let applied = false;
    command(selected, (tr) => {
      applied = this.dispatch(tr);
    });
    if (!applied || this.dirty.size) this.rerender();
  }

  /** Rebuilds every block that is not reused and puts the selection back. */
  private rerender(): void {
    this.render();
    this.writeSelection(true);
  }

  // ---------- clipboard ----------

  /** Copy writes the model's content (plain text, HTML, Foli JSON), never the browser's DOM. */
  private onCopy = (event: ClipboardEvent): void => {
    this.syncSelection();
    const { selection, doc } = this.state;
    if (selection.empty || !event.clipboardData) return;
    event.preventDefault();
    const { text, html, json } = serializeRange(
      doc,
      selection.from,
      selection.to,
      this.host.ownerDocument,
    );
    event.clipboardData.setData("text/plain", text);
    event.clipboardData.setData("text/html", html);
    event.clipboardData.setData(FOLI_MIME, json);
  };

  private onCut = (event: ClipboardEvent): void => {
    this.onCopy(event);
    if (!event.defaultPrevented) return;
    // Its own undo step, not merged with the typing before it.
    deleteSelection(this.state, (tr) => this.dispatch(tr.setMeta(closeHistory, true)));
  };

  private onPaste = (event: ClipboardEvent): void => {
    if (!event.clipboardData) return;
    event.preventDefault();
    const plain = this.plainPaste;
    this.plainPaste = false;
    // The browser owns the DOM during a composition; a model change now would be overwritten.
    if (this.composing) return;
    this.syncSelection();
    const data = event.clipboardData;
    this.paste(
      plain ? { getData: (type) => (type === "text/plain" ? data.getData(type) : "") } : data,
      !plain,
    );
  };

  /**
   * Replaces the selection with clipboard content (Foli JSON, else HTML, else plain text). The
   * paste starts a new undo step (typing right after it joins that step). Closed content (whole
   * blocks) goes into an empty textblock whole, so a pasted heading stays a heading; open
   * content, and anything pasted into a non-empty block, joins the text around the selection,
   * so the target block keeps its type. Plain text that is one URL becomes a link (`autolink`,
   * not for paste as plain text): over selected text inside one block, that text is linked;
   * otherwise the URL is inserted as linked text. Returns whether anything was inserted.
   */
  paste(data: Pick<DataTransfer, "getData">, autolink = true): boolean {
    const { state } = this;
    const text = autolink && !data.getData(FOLI_MIME) ? data.getData("text/plain") : "";
    const href = text ? autolinkHref(text) : null;
    if (href) {
      const { selection } = state;
      const inside =
        !selection.empty &&
        selection.$from.sameParent(selection.$to) &&
        selection.$from.parent.inlineContent;
      let applied = false;
      const command = inside ? setLink(href) : insertLink(href, text.trim());
      const dispatch = (tr: Transaction) => {
        applied = this.dispatch(tr.setMeta(closeHistory, true));
      };
      if (command(state, dispatch)) return applied;
    }
    const marks = (state.storedMarks ?? marksAt(state.selection.$from)).map((m) => m.toJSON());
    const pasted = docFromClipboard(data, marks);
    // One empty block: nothing to paste.
    if (!pasted || pasted.doc.content.size <= 2) return false;
    const { doc, open } = pasted;
    // As a slice (text joins the text around the caret); where the schema refuses that (a
    // list in a paragraph), as whole blocks fitted at the caret.
    const asSlice = (tr: Transaction) => {
      const $pos = tr.selection.$from;
      if (!open && $pos.depth === 1 && $pos.parent.isTextblock && !$pos.parent.content.size) {
        const from = $pos.before();
        tr.replace(from, $pos.after(), new Slice(doc.content, 0, 0));
        tr.setSelection(Selection.near(tr.doc.resolve(from + doc.content.size), -1));
      } else {
        tr.replaceSelection(doc.slice(1, doc.content.size - 1));
      }
    };
    const asBlocks = (tr: Transaction) => {
      if (open) throw new TransformError("Open content is pasted as a slice");
      insertBlocks(tr, doc);
    };
    const strategies = [asSlice, asBlocks];
    for (const strategy of strategies) {
      const tr = state.tr;
      try {
        tr.deleteSelection();
        strategy(tr);
      } catch (error) {
        if (error instanceof TransformError) continue;
        throw error;
      }
      return this.dispatch(tr.setMeta(closeHistory, true));
    }
    return false;
  }

  private onSelectionChange = (): void => {
    if (!this.composing && this.hasFocus()) this.syncSelection();
  };
}

/**
 * Pastes whole blocks at the caret (after deleting the selection), for content a slice cannot
 * fit (lists): a single pasted list inside a list item joins that list (its items replace an
 * empty item, go before or after the item, or between its two halves); other blocks go before
 * or after the caret's textblock (replacing it when empty) where its parent takes them, else
 * between its two halves. Throws TransformError where the schema does not allow it.
 */
function insertBlocks(tr: Transaction, doc: ModelNode): void {
  const $pos = tr.selection.$from;
  if (!$pos.parent.isTextblock) throw new TransformError("No textblock at the caret");
  const atStart = $pos.parentOffset === 0;
  const atEnd = $pos.parentOffset === $pos.parent.content.size;
  const only = doc.childCount === 1 ? doc.firstChild : null;
  const itemType = tr.doc.type.schema.nodes.listItem;
  const inItem = $pos.depth >= 2 && $pos.node(-1).type === itemType;
  let at: number;
  let content = doc.content;
  if (only && inItem && only.firstChild?.type === itemType) {
    content = only.content;
    const depth = $pos.depth - 1;
    const item = $pos.node(depth);
    if (atStart && atEnd && item.childCount === 1) {
      at = $pos.before(depth);
      tr.delete(at, $pos.after(depth));
    } else if (atEnd && $pos.indexAfter(depth) === item.childCount) at = $pos.after(depth);
    else if (atStart && $pos.index(depth) === 0) at = $pos.before(depth);
    else {
      tr.split($pos.pos, 2);
      at = $pos.pos + 2;
    }
  } else {
    // Before, after, or in place of the textblock where its parent takes the blocks there (a
    // list item's first paragraph must stay first); else between its two halves.
    const parent = $pos.node(-1);
    const index = $pos.index(-1);
    if (atStart && atEnd && parent.canReplace(index, index + 1, content)) {
      at = $pos.before();
      tr.delete(at, $pos.after());
    } else if (atStart && parent.canReplace(index, index, content)) at = $pos.before();
    else if (atEnd && parent.canReplace(index + 1, index + 1, content)) at = $pos.after();
    else {
      tr.split($pos.pos);
      at = $pos.pos + 1;
    }
  }
  tr.insert(at, content);
  tr.setSelection(Selection.near(tr.doc.resolve(at + content.size), -1));
}

/** The first block element inside a container element (through nested containers), or null. */
function firstBlockIn(element: Element): Element | null {
  let child = element.firstElementChild;
  while (isWrapper(child)) child = child.firstElementChild;
  return child;
}

/**
 * Sets what a container element shows on a page: an ordered list item's number (so numbering
 * continues across pages), and no marker on an item continued from the previous page (its
 * first block is on an earlier page, or this is a continued fragment of it).
 */
function styleContainer(
  element: HTMLElement,
  container: Container,
  parent: Container | undefined,
  item: { block: number; fragment: number },
): void {
  if (element.localName !== "li") return;
  const continued = item.block !== container.firstBlock || item.fragment > 0;
  const start = parent?.node.type.name === "orderedList" ? parent.node.attrs.start : undefined;
  const value = typeof start === "number" ? String(start + container.index) : null;
  // Written only when they change (checked against what was written last, without reading the
  // DOM): this runs for every list item on every render, and every write invalidates style.
  const state = `${continued}|${value}`;
  if (containerStates.get(element) === state) return;
  containerStates.set(element, state);
  element.style.listStyleType = continued ? "none" : "";
  if (value === null) element.removeAttribute("value");
  else element.setAttribute("value", value);
}

/** What `styleContainer` last wrote on each list item element. */
const containerStates = new WeakMap<HTMLElement, string>();

/**
 * Client rects are scaled by CSS `zoom` or a `transform` on an ancestor, while margins and the
 * page geometry are in layout px: the ratio between the two for a page. From the page's width
 * as set in mm (`offsetWidth` is rounded to a pixel: off by up to 0.1%, a pixel per page).
 */
function layoutScale(page: HTMLElement, settings: DocumentSettings): number {
  return page.getBoundingClientRect().width / (settings.pageSize.width * PX_PER_MM) || 1;
}

/** A block's measurement: border-box height across its fragments (layout px), margins, lines. */
interface Measure {
  height: number;
  marginTop: number;
  marginBottom: number;
  /** Vertical padding and border, which every fragment of a split block repeats. */
  box: number;
  lines?: Lines;
}

/** Reads a block's height (in layout px) and vertical margins from the DOM. */
function measureBox(desc: BlockDesc, scale: number): Measure {
  let height = 0;
  for (const fragment of desc.fragments) height += fragment.getBoundingClientRect().height;
  // A split block's first fragment has no bottom margin and its last no top margin (inline).
  const first = getComputedStyle(desc.dom);
  const last = getComputedStyle(desc.fragments[desc.fragments.length - 1] as HTMLElement);
  // jsdom and detached nodes report no margins.
  const px = (value: string) => Number.parseFloat(value) || 0;
  return {
    height: height / scale,
    marginTop: px(first.marginTop),
    marginBottom: px(last.marginBottom),
    box:
      px(first.paddingTop) +
      px(first.paddingBottom) +
      px(first.borderTopWidth) +
      px(first.borderBottomWidth),
  };
}

/**
 * What the flow needs of a block: its measurement, its lines (on demand), and what the rules
 * need: headings keep with the next block; page breaks end their line's page.
 */
function blockBox(desc: BlockDesc, measure: Measure, lines: () => Lines): BlockBox {
  return {
    height: measure.height,
    marginTop: measure.marginTop,
    marginBottom: measure.marginBottom,
    lines: () => lines().bottoms,
    keepWithNext: desc.node.type.name === "heading",
    breaksAfter: () => {
      const breaks = desc.leaves.filter(
        (leaf) =>
          leaf.dom.nodeType !== Node.TEXT_NODE &&
          (leaf.dom as Element).hasAttribute(PAGE_BREAK_ATTR),
      );
      if (!breaks.length) return [];
      const { starts } = lines();
      // The line holding the break: the last one starting at or before it.
      return breaks.map((leaf) => {
        let line = starts.length - 1;
        while (line > 0 && (starts[line] as number) > leaf.offset) line--;
        return line;
      });
    },
  };
}

/**
 * What the next flow can reuse of the last one: the unchanged blocks before the first changed
 * (or stale) one, and the unchanged tail after the last.
 */
function reuseOf(
  last: { nodes: readonly ModelNode[]; result: FlowResult },
  nodes: readonly ModelNode[],
  stale: ReadonlySet<ModelNode>,
): Reuse {
  const before = last.nodes;
  const same = (a: ModelNode | undefined, b: ModelNode | undefined) =>
    a !== undefined && a === b && !stale.has(a);
  let from = 0;
  while (from < nodes.length && from < before.length && same(nodes[from], before[from])) from++;
  let tail = 0;
  while (
    tail < nodes.length - from &&
    tail < before.length - from &&
    same(nodes[nodes.length - 1 - tail], before[before.length - 1 - tail])
  )
    tail++;
  const delta = nodes.length - before.length;
  return {
    previous: last.result,
    from,
    previousIndex: (i) => (i >= nodes.length - tail ? i - delta : -1),
  };
}

interface Lines {
  /** Content offset where each line starts. */
  starts: number[];
  /** Bottom of each line box, in layout px from the block's top, as if it were not split. */
  bottoms: number[];
}

const NO_RECT = { top: 0, bottom: 0, height: 0 } as DOMRect;

interface LineItem {
  offset: number;
  rect: () => DOMRect;
}

/**
 * The lines of a rendered block, across its fragments. A line ends where the next character
 * (or <br>) starts below the vertical middle of the line's first one; a binary search finds each line's
 * first item. Between two lines the boundary is halfway between the first line's first item
 * bottom and the next line's first item top, which is exact for equal line heights (equal
 * half-leading above and below).
 *
 * shortcut: assumes left-to-right lines without vertical-align offsets (schema v1 has neither); bidi and superscripts need line boxes from the layout instead.
 */
function measureLines(desc: BlockDesc, scale: number): Lines {
  const starts: number[] = [];
  const bottoms: number[] = [];
  const range = desc.dom.ownerDocument.createRange();
  let base = 0;
  for (const [f, fragment] of desc.fragments.entries()) {
    const box = fragment.getBoundingClientRect();
    const items: LineItem[] = [];
    for (const leaf of desc.leaves) {
      if (!fragment.contains(leaf.dom)) continue;
      if (leaf.dom.nodeType !== Node.TEXT_NODE) {
        const br = leaf.dom as Element;
        items.push({ offset: leaf.offset, rect: () => br.getBoundingClientRect() });
        continue;
      }
      for (let k = 0; k < leaf.size; k++) {
        items.push({
          offset: leaf.offset + k,
          rect: () => {
            range.setStart(leaf.dom, k);
            range.setEnd(leaf.dom, k + 1);
            // jsdom has no range rects: every block is then one line.
            return range.getBoundingClientRect?.() ?? NO_RECT;
          },
        });
      }
    }
    // The extra <br> that shows an empty last line (no leaf of its own).
    const tail = fragment.lastChild;
    if (
      tail instanceof Element &&
      tail.tagName === "BR" &&
      !desc.leaves.some((l) => l.dom === tail)
    )
      items.push({ offset: desc.node.content.size, rect: () => tail.getBoundingClientRect() });
    const from = f ? (desc.splits[f - 1] as number) : 0;
    if (!items.length) {
      starts.push(from);
      bottoms.push((base + box.height) / scale);
      base += box.height;
      continue;
    }
    const firsts: DOMRect[] = [];
    let i = 0;
    while (i < items.length) {
      // The line's reference: its first item with a box (zero-width characters have none).
      let reference = (items[i] as LineItem).rect();
      for (let k = i + 1; !reference.height && k < items.length; k++)
        reference = (items[k] as LineItem).rect();
      starts.push((items[i] as LineItem).offset);
      firsts.push(reference);
      const middle = (reference.top + reference.bottom) / 2;
      const below = (j: number) => {
        const rect = (items[j] as LineItem).rect();
        // Below the middle of the line's first item: holds when glyph boxes of consecutive
        // lines overlap (line-height smaller than the font's content area) and for items of
        // different heights on one line.
        return rect.height > 0 && rect.top >= middle;
      };
      let lo = i + 1;
      let hi = items.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (below(mid)) hi = mid;
        else lo = mid + 1;
      }
      i = lo;
    }
    for (let line = 0; line < firsts.length; line++) {
      const next = firsts[line + 1];
      const y = next ? ((firsts[line] as DOMRect).bottom + next.top) / 2 : box.bottom;
      bottoms.push((base + y - box.top) / scale);
    }
    base += box.height;
  }
  return { starts, bottoms };
}

/** The DOM point at the start of a block's fragment `f`. */
function fragmentStart(desc: BlockDesc, f: number): DomPoint {
  const fragment = desc.fragments[f] as HTMLElement;
  const offset = f ? (desc.splits[f - 1] as number) : 0;
  const leaf = desc.leaves.find((l) => l.offset === offset && fragment.contains(l.dom));
  if (!leaf) return { node: fragment, offset: 0 };
  return leaf.dom.nodeType === Node.TEXT_NODE ? { node: leaf.dom, offset: 0 } : before(leaf.dom);
}

/** The DOM point at the end of a block's fragment `f`. */
function fragmentEnd(desc: BlockDesc, f: number): DomPoint {
  const fragment = desc.fragments[f] as HTMLElement;
  const inside = desc.leaves.filter((l) => fragment.contains(l.dom));
  const last = inside[inside.length - 1];
  if (!last) return { node: fragment, offset: fragment.childNodes.length };
  if (last.dom.nodeType === Node.TEXT_NODE) return { node: last.dom, offset: last.size };
  const point = before(last.dom);
  return { node: point.node, offset: point.offset + 1 };
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** `pos`, or the start (`forward`: the end) of the grapheme cluster it falls inside. */
function clusterBoundary(doc: ModelNode, pos: number, forward: boolean): number {
  const { parent, parentOffset } = doc.resolve(pos);
  if (!parent.inlineContent || parentOffset === 0 || parentOffset === parent.content.size)
    return pos;
  // Leaves count as one character, a line feed (it never joins a cluster), as in the core.
  const text = parent.textBetween(0, parent.content.size, "", "\n");
  const cluster = graphemes.segment(text).containing(parentOffset);
  if (!cluster || cluster.index === parentOffset) return pos;
  return pos - parentOffset + cluster.index + (forward ? cluster.segment.length : 0);
}

/**
 * Scrolls every scrollable ancestor of `from`, then the window, so that `rect` is inside its
 * visible area (minus `scroll-padding`, e.g. for a sticky toolbar). Vertical only: text wraps.
 */
function scrollRectIntoView(from: HTMLElement, rect: DOMRect): void {
  const doc = from.ownerDocument;
  const win = doc.defaultView;
  if (!win) return;
  let { top, bottom } = rect;
  const delta = (low: number, high: number) =>
    top < low ? top - low : bottom > high ? Math.min(bottom - high, top - low) : 0;
  const last = new Set<Element>([doc.body, doc.documentElement]); // they scroll as the window
  for (let el: HTMLElement | null = from; el && !last.has(el); el = el.parentElement) {
    const style = win.getComputedStyle(el);
    if (!/auto|scroll|overlay/.test(style.overflowY) || el.scrollHeight <= el.clientHeight)
      continue;
    const edge = el.getBoundingClientRect().top + el.clientTop;
    const low = edge + (Number.parseFloat(style.scrollPaddingTop) || 0);
    const high = edge + el.clientHeight - (Number.parseFloat(style.scrollPaddingBottom) || 0);
    const before = el.scrollTop;
    el.scrollTop += delta(low, high);
    top -= el.scrollTop - before;
    bottom -= el.scrollTop - before;
  }
  const root = win.getComputedStyle(doc.documentElement);
  const move = delta(
    Number.parseFloat(root.scrollPaddingTop) || 0,
    win.innerHeight - (Number.parseFloat(root.scrollPaddingBottom) || 0),
  );
  if (move) win.scrollBy(0, move);
}

function before(node: Node): DomPoint {
  const parent = node.parentNode as Node;
  return { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, node) };
}

/** Stand-ins used when diffing DOM text with model text. */
const BLOCK_SEPARATOR = "\n";
const HARD_BREAK = "\uFFFC";

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

const COMPOSITION_INPUT = new Set([
  "insertCompositionText",
  "deleteCompositionText",
  "insertFromComposition",
]);

const IS_MAC = typeof navigator !== "undefined" && /Mac|iP(hone|[oa]d)/.test(navigator.platform);

/**
 * Normalizes a key event to a keymap name: modifiers in the order `Mod-Ctrl-Meta-Alt-Shift-`,
 * then the key (single characters lower-cased). `Mod` is Cmd on Apple platforms, Ctrl elsewhere.
 */
export function keyName(event: KeyboardEvent): string {
  let key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const mod = IS_MAC ? event.metaKey : event.ctrlKey;
  // Non-Latin layouts: Ctrl+B still means "b" (use the physical key when the character is not a-z);
  // with Shift, Ctrl+Shift+7 still means "7" (the character is "&" or "/" depending on layout).
  if (mod && !/^[a-z0-9]$/.test(key) && /^(Key[A-Z]|Digit[0-9])$/.test(event.code))
    key = event.code.slice(-1).toLowerCase();
  let name = key;
  if (event.shiftKey && key !== "Shift") name = `Shift-${name}`;
  if (event.altKey) name = `Alt-${name}`;
  if (IS_MAC ? event.ctrlKey : event.metaKey) name = `${IS_MAC ? "Ctrl" : "Meta"}-${name}`;
  if (mod) name = `Mod-${name}`;
  return name;
}
