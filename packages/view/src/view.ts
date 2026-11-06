import {
  AllSelection,
  type Command,
  closeHistory,
  deleteBackward,
  deleteForward,
  deleteSelection,
  type Editor,
  type EditorState,
  insertHardBreak,
  insertText,
  type Node as ModelNode,
  marksAt,
  redo,
  Selection,
  Slice,
  splitBlock,
  TextSelection,
  type Transaction,
  TransformError,
  toggleMark,
  undo,
} from "@foli/core";
import { docFromClipboard, FOLI_MIME, serializeRange } from "./clipboard.js";
import { type BlockBox, contentHeight, flow } from "./layout/flow.js";
import { type BlockDesc, PAGE_BREAK_ATTR, renderBlock } from "./render.js";

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

/**
 * The editable view of an `Editor` from `@foli/core`: renders its state into one
 * `contenteditable` host and turns DOM input into core commands. The model is the source of
 * truth; the DOM is rebuilt from it (unchanged blocks are reused by node identity).
 *
 * The browser edits the DOM itself only during composition (IME, dead keys) and for changes the
 * view cannot prevent (Android keyboards, extensions). A MutationObserver records those; the view
 * then reads the changed text back into a transaction (`readBack`) and re-renders.
 *
 * shortcut: assumes schema v1 (doc > textblocks > inline); nested blocks arrive with lists in Phase 7.
 */
export class EditorView {
  private state: EditorState;
  private blocks: BlockDesc[] = [];
  /** Position before each block, parallel to `blocks`. */
  private starts: number[] = [];
  /** The page of each fragment of each block. */
  private fragmentPages = new Map<BlockDesc, readonly number[]>();
  /** The block each fragment element belongs to. */
  private owner = new Map<Node, BlockDesc>();
  /** The page elements, in order; the host's only children. */
  private pages: HTMLElement[] = [];
  private pageStyle = "";
  private destroyed = false;
  /** Set by a render during a composition, which places blocks but does not flow them. */
  private unflowed = false;
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
    this.addedTabIndex = !host.hasAttribute("tabindex");
    if (this.addedTabIndex) host.tabIndex = 0;
    // Spaces typed into the model must stay visible and caret-addressable.
    host.style.whiteSpace = "pre-wrap";
    host.style.overflowWrap = "break-word";
    host.replaceChildren();
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
    host.ownerDocument.addEventListener("selectionchange", this.onSelectionChange);
    host.ownerDocument.fonts?.addEventListener("loadingdone", this.onFontsLoaded);
    this.unsubscribe = editor.subscribe((state) => this.update(state));
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribe();
    this.host.ownerDocument.fonts?.removeEventListener("loadingdone", this.onFontsLoaded);
    this.observer.disconnect();
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
    host.ownerDocument.removeEventListener("selectionchange", this.onSelectionChange);
    const owned = [
      "contenteditable",
      "role",
      "aria-multiline",
      "aria-readonly",
      "aria-placeholder",
    ];
    if (this.addedTabIndex) owned.push("tabindex");
    for (const name of owned) host.removeAttribute(name);
    host.style.removeProperty("white-space");
    host.style.removeProperty("overflow-wrap");
    if (!host.getAttribute("style")) host.removeAttribute("style");
    host.replaceChildren();
  }

  /** Focuses the host and shows the model selection in it. */
  focus(): void {
    this.host.focus();
    this.writeSelection(true);
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
   * shortcut: measures every block on every render (O(document) per keystroke), and the lines of every block that crosses a page; the measurement cache and reflow from the first changed page come in 5.4.
   */
  private render(): void {
    const { doc } = this.state;
    const ownerDocument = this.host.ownerDocument;
    const previous = new Map(
      this.blocks.filter((desc) => !this.dirty.has(desc)).map((desc) => [desc.node, desc]),
    );
    const previousPages = this.fragmentPages;
    this.dirty.clear();
    let blocks: BlockDesc[] = [];
    const starts: number[] = [];
    doc.forEach((node, offset) => {
      const reused = previous.get(node);
      if (reused) previous.delete(node);
      blocks.push(reused ?? renderBlock(node, ownerDocument));
      starts.push(offset);
    });
    for (const stale of previous.values())
      for (const fragment of stale.fragments) fragment.remove();
    this.applyGeometry();
    let last = 0;
    let pages = blocks.map((desc) => {
      const before = previousPages.get(desc);
      return desc.fragments.map((_, f) => (last = Math.max(last, before?.[f] ?? last)));
    });
    this.place(blocks, pages);
    if (!this.composing) {
      const scale = layoutScale(this.pages[0] as HTMLElement);
      const measured = new Map<BlockDesc, Lines>();
      const lines = (desc: BlockDesc) => {
        let found = measured.get(desc);
        if (!found) {
          found = measureLines(desc, scale);
          measured.set(desc, found);
        }
        return found;
      };
      const boxes = blocks.map((desc) => measureBox(desc, scale, () => lines(desc)));
      const flowed = flow(boxes, contentHeight(this.editor.settings));
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
      this.place(blocks, pages);
    }
    this.blocks = blocks;
    this.starts = starts;
    this.fragmentPages = new Map(blocks.map((desc, i) => [desc, pages[i] ?? []]));
    this.owner = new Map(
      blocks.flatMap((desc) => desc.fragments.map((fragment) => [fragment, desc] as const)),
    );
    this.unflowed = this.composing;
    this.showPlaceholder();
    // The view's own DOM changes are not input. During a composition, keep what the browser
    // changed before this render: the touched blocks are read back at compositionend.
    const records = this.observer.takeRecords();
    if (this.composing) this.pending.push(...records);
  }

  /**
   * Puts each fragment of each block into its page (pages are non-decreasing in document
   * order), creating and removing pages as needed. Anything else in the host or a page (stray
   * DOM) is removed.
   */
  private place(blocks: readonly BlockDesc[], pages: readonly (readonly number[])[]): void {
    const { host } = this;
    const items = blocks.flatMap((desc, i) =>
      desc.fragments.map((dom, f) => ({ dom, page: pages[i]?.[f] ?? 0 })),
    );
    const count = (items[items.length - 1]?.page ?? 0) + 1;
    while (this.pages.length < count) this.pages.push(this.createPage());
    // Pages first, in order; anything else in the host ends up after them.
    let cursor = host.firstChild;
    for (const page of this.pages.slice(0, count)) {
      if (page === cursor) cursor = cursor.nextSibling;
      else host.insertBefore(page, cursor);
    }
    const blockDoms = new Set<Node>(items.map((item) => item.dom));
    let i = 0;
    for (let p = 0; p < count; p++) {
      const page = this.pages[p] as HTMLElement;
      let at = page.firstChild;
      for (; i < items.length && items[i]?.page === p; i++) {
        const dom = (items[i] as { dom: HTMLElement }).dom;
        if (dom === at) at = at.nextSibling;
        else page.insertBefore(dom, at);
      }
      // What is left: strays go; fragments of a later page are moved there next.
      while (at) {
        const next: ChildNode | null = at.nextSibling;
        if (!blockDoms.has(at)) at.remove();
        at = next;
      }
    }
    // Pages no longer needed and stray DOM in the host: all after the last page by now. Taken
    // after the block loop, since a block found loose in the host has just moved into a page.
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
  }

  /** Re-flows the pages once web fonts have loaded: line heights and wrapping change. */
  private onFontsLoaded = (): void => {
    if (this.destroyed) return;
    this.render();
    this.writeSelection(false);
  };

  // ---------- position mapping ----------

  /** The block element that contains `node` (the child of a page it sits in), or null. */
  private blockElement(node: Node | null): Node | null {
    let element = node;
    while (element?.parentNode && !this.pages.includes(element.parentNode as HTMLElement)) {
      if (element.parentNode === this.host) return null;
      element = element.parentNode;
    }
    return element?.parentNode ? element : null;
  }

  /** Model position of a DOM point inside the host, or null if it is outside. */
  posFromDOM(node: Node, offset: number): number | null {
    const { host } = this;
    if (node === host || this.pages.includes(node as HTMLElement)) {
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
    const index = owner ? this.blocks.indexOf(owner) : -1;
    const desc = this.blocks[index];
    if (!desc) return null;
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
    let $pos = doc.resolve(pos);
    // Between blocks: use the nearest block edge (schema v1 has only textblocks at depth 1).
    if ($pos.depth === 0) $pos = doc.resolve($pos.nodeAfter ? pos + 1 : pos - 1);
    const desc = this.blocks[$pos.index(0)] as BlockDesc;
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
    const anchor = this.posFromDOM(sel.anchorNode, sel.anchorOffset);
    const head = this.posFromDOM(sel.focusNode, sel.focusOffset);
    if (anchor === null || head === null) return null;
    const { doc } = this.state;
    return TextSelection.between(doc.resolve(anchor), doc.resolve(head));
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
        this.run(splitBlock);
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
    this.run(type.endsWith("Forward") ? deleteForward(unit) : deleteBackward(unit));
  };

  /**
   * Triple-click selects the clicked block's content. Chromium and WebKit natively extend the
   * selection to the start of the next block, so typing over it would merge the two blocks.
   */
  private onMouseDown = (event: MouseEvent): void => {
    this.pointerFocus = !this.hasFocus();
    // Focus from a mousedown happens in its default action, before this timer. A mousedown that
    // focuses nothing (prevented, middle button) must not skip the next keyboard focus.
    if (this.pointerFocus) setTimeout(() => (this.pointerFocus = false));
    if (event.detail !== 3 || event.button !== 0) return;
    const element = this.blockElement(event.target as Node | null);
    const owner = element ? this.owner.get(element) : undefined;
    const index = owner ? this.blocks.indexOf(owner) : -1;
    const desc = this.blocks[index];
    if (!desc) return;
    event.preventDefault();
    const from = (this.starts[index] as number) + 1;
    const { doc } = this.state;
    this.host.focus();
    this.dispatch(
      this.state.tr
        .setSelection(TextSelection.create(doc, from, from + desc.node.content.size))
        .setStoredMarks(null),
    );
    this.writeSelection(true);
  };

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
    const handled = this.state.plugins.some((plugin) => {
      const command = plugin.spec.keymap?.[name];
      return command ? this.run(command) : false;
    });
    if (handled) event.preventDefault();
  };

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
    const offset = head - (this.starts[this.blocks.indexOf(desc)] as number) - 1;
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
    // Block-level nodes in order: the children of each page, and anything else in the host.
    const blockLevel = [...this.host.childNodes].flatMap((child) =>
      this.pages.includes(child as HTMLElement) ? [...child.childNodes] : [child],
    );
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
    doc.forEach((block, _offset, i) => {
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
    );
  };

  /**
   * Replaces the selection with clipboard content (Foli JSON, else HTML, else plain text). The
   * paste starts a new undo step (typing right after it joins that step). Closed content (whole
   * blocks) goes into an empty textblock whole, so a pasted heading stays a heading; open
   * content, and anything pasted into a non-empty block, joins the text around the selection,
   * so the target block keeps its type. Returns whether anything was inserted.
   */
  paste(data: Pick<DataTransfer, "getData">): boolean {
    const { state } = this;
    const marks = (state.storedMarks ?? marksAt(state.selection.$from)).map((m) => m.toJSON());
    const pasted = docFromClipboard(data, marks);
    // One empty block: nothing to paste.
    if (!pasted || pasted.doc.content.size <= 2) return false;
    const { doc, open } = pasted;
    try {
      const tr = state.tr.deleteSelection();
      const $pos = tr.selection.$from;
      if (!open && $pos.depth === 1 && $pos.parent.isTextblock && !$pos.parent.content.size) {
        const from = $pos.before();
        tr.replace(from, $pos.after(), new Slice(doc.content, 0, 0));
        tr.setSelection(Selection.near(tr.doc.resolve(from + doc.content.size), -1));
      } else {
        tr.replaceSelection(doc.slice(1, doc.content.size - 1));
      }
      return this.dispatch(tr.setMeta(closeHistory, true));
    } catch (error) {
      // shortcut: content the schema cannot fit at the selection is not pasted; general fitting comes with nested blocks (Phase 7).
      if (error instanceof TransformError) return false;
      throw error;
    }
  }

  private onSelectionChange = (): void => {
    if (!this.composing && this.hasFocus()) this.syncSelection();
  };
}

/**
 * Client rects are scaled by CSS `zoom` or a `transform` on an ancestor, while margins and the
 * page geometry are in layout px: the ratio between the two for a page.
 */
function layoutScale(page: HTMLElement): number {
  const layout = page.offsetHeight;
  return layout ? page.getBoundingClientRect().height / layout || 1 : 1;
}

/**
 * A block's border-box height across its fragments (in layout px), vertical margins, and what
 * the flow rules need: headings keep with the next block; page breaks end their line's page.
 */
function measureBox(desc: BlockDesc, scale: number, lines: () => Lines): BlockBox {
  let height = 0;
  for (const fragment of desc.fragments) height += fragment.getBoundingClientRect().height;
  // A split block's first fragment has no bottom margin and its last no top margin (inline).
  const first = getComputedStyle(desc.dom);
  const last = getComputedStyle(desc.fragments[desc.fragments.length - 1] as HTMLElement);
  return {
    height: height / scale,
    // jsdom and detached nodes report no margins.
    marginTop: Number.parseFloat(first.marginTop) || 0,
    marginBottom: Number.parseFloat(last.marginBottom) || 0,
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
  // Non-Latin layouts: Ctrl+B still means "b" (use the physical key when the character is not a-z).
  if (mod && !/^[a-z]$/.test(key) && /^Key[A-Z]$/.test(event.code))
    key = event.code.slice(3).toLowerCase();
  let name = key;
  if (event.shiftKey && key !== "Shift") name = `Shift-${name}`;
  if (event.altKey) name = `Alt-${name}`;
  if (IS_MAC ? event.ctrlKey : event.metaKey) name = `${IS_MAC ? "Ctrl" : "Meta"}-${name}`;
  if (mod) name = `Mod-${name}`;
  return name;
}
