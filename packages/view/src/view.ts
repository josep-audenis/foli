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
  TransformError,
  toggleMark,
  undo,
} from "@foli/core";
import { docFromClipboard, FOLI_MIME, serializeRange } from "./clipboard.js";
import { type BlockDesc, renderBlock } from "./render.js";

interface DomPoint {
  node: Node;
  offset: number;
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
  private composing = false;
  /** Set by Ctrl/Cmd+Shift+V for the paste event it triggers. */
  private plainPaste = false;
  /** Blocks whose DOM the browser changed: the next render rebuilds them. */
  private readonly dirty = new Set<BlockDesc>();
  /** DOM mutations not yet read back (kept while a composition is running). */
  private pending: MutationRecord[] = [];
  private readonly observer: MutationObserver;
  private readonly unsubscribe: () => void;

  constructor(
    readonly host: HTMLElement,
    readonly editor: Editor,
  ) {
    this.state = editor.state;
    host.setAttribute("contenteditable", "true");
    host.setAttribute("role", "textbox");
    host.setAttribute("aria-multiline", "true");
    // Spaces typed into the model must stay visible and caret-addressable.
    host.style.whiteSpace = "pre-wrap";
    host.style.overflowWrap = "break-word";
    host.replaceChildren();
    this.observer = new MutationObserver(this.onMutations);
    this.observer.observe(host, { childList: true, characterData: true, subtree: true });
    this.render();

    host.addEventListener("beforeinput", this.onBeforeInput);
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
    this.unsubscribe = editor.subscribe((state) => this.update(state));
  }

  destroy(): void {
    this.unsubscribe();
    this.observer.disconnect();
    const { host } = this;
    host.removeEventListener("beforeinput", this.onBeforeInput);
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
    for (const name of ["contenteditable", "role", "aria-multiline"]) host.removeAttribute(name);
    host.style.removeProperty("white-space");
    host.style.removeProperty("overflow-wrap");
    if (!host.getAttribute("style")) host.removeAttribute("style");
    host.replaceChildren();
  }

  focus(): void {
    this.host.focus();
    this.writeSelection(true);
  }

  // ---------- rendering ----------

  private update(state: EditorState): void {
    const docChanged = state.doc !== this.state.doc;
    const selectionChanged = !state.selection.eq(this.state.selection);
    this.state = state;
    if (docChanged) this.render();
    this.writeSelection(docChanged);
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
    // A caret in an empty block or before a <br> can have no box of its own: use its element's.
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    const rect = range.getClientRects?.()[0] ?? element?.getBoundingClientRect();
    if (rect) scrollRectIntoView(this.host, rect);
  }

  /** Renders the document, reusing the DOM of blocks whose model node is unchanged. */
  private render(): void {
    const { doc } = this.state;
    const previous = new Map(
      this.blocks.filter((desc) => !this.dirty.has(desc)).map((desc) => [desc.node, desc]),
    );
    this.dirty.clear();
    const blocks: BlockDesc[] = [];
    const starts: number[] = [];
    doc.forEach((node, offset) => {
      const reused = previous.get(node);
      if (reused) previous.delete(node);
      blocks.push(reused ?? renderBlock(node, this.host.ownerDocument));
      starts.push(offset);
    });
    for (const stale of previous.values()) stale.dom.remove();
    // Insert or move blocks into order; anything else (stray DOM) drifts to the end and is removed.
    let cursor = this.host.firstChild;
    for (const desc of blocks) {
      if (desc.dom === cursor) cursor = cursor.nextSibling;
      else this.host.insertBefore(desc.dom, cursor);
    }
    while (cursor) {
      const next: ChildNode | null = cursor.nextSibling;
      cursor.remove();
      cursor = next;
    }
    this.blocks = blocks;
    this.starts = starts;
    // The view's own DOM changes are not input. During a composition, keep what the browser
    // changed before this render: the touched blocks are read back at compositionend.
    const records = this.observer.takeRecords();
    if (this.composing) this.pending.push(...records);
  }

  // ---------- position mapping ----------

  /** Model position of a DOM point inside the host, or null if it is outside. */
  posFromDOM(node: Node, offset: number): number | null {
    const { host } = this;
    if (node === host) {
      const index = Math.min(offset, this.blocks.length);
      return index < this.blocks.length
        ? (this.starts[index] as number)
        : this.state.doc.content.size;
    }
    let element: Node | null = node;
    while (element && element.parentNode !== host) element = element.parentNode;
    const index = this.blocks.findIndex((desc) => desc.dom === element);
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
    this.editor.dispatch(this.state.tr.setSelection(selection).setStoredMarks(null));
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
    return command(this.state, (tr) => this.editor.dispatch(tr));
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
    if (!selection.eq(this.state.selection))
      this.editor.dispatch(this.state.tr.setSelection(selection));
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
    if (event.detail !== 3 || event.button !== 0) return;
    let element = event.target as Node | null;
    while (element && element.parentNode !== this.host) element = element.parentNode;
    const index = this.blocks.findIndex((desc) => desc.dom === element);
    const desc = this.blocks[index];
    if (!desc) return;
    event.preventDefault();
    const from = (this.starts[index] as number) + 1;
    const { doc } = this.state;
    this.host.focus();
    this.editor.dispatch(
      this.state.tr
        .setSelection(TextSelection.create(doc, from, from + desc.node.content.size))
        .setStoredMarks(null),
    );
    this.writeSelection(true);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing || this.composing) return;
    this.syncSelection();
    const name = keyName(event);
    // Ctrl/Cmd+Shift+V: the paste event that follows uses only the plain text.
    this.plainPaste = name === "Mod-Shift-v";
    if (this.editor.handleKey(name)) event.preventDefault();
  };

  /** Safety net: a DOM change that was not prevented is read back into the model. */
  private onInput = (): void => {
    if (!this.composing) this.flush();
  };

  private onCompositionStart = (): void => {
    this.syncSelection();
    this.composing = true;
  };

  private onCompositionEnd = (): void => {
    this.composing = false;
    this.flush();
  };

  /** Some browsers drop compositionend when focus leaves mid-composition; never stay stuck in it. */
  private onBlur = (): void => {
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
    const byDom = new Map<Node, BlockDesc>(this.blocks.map((desc) => [desc.dom, desc]));
    for (const record of records) {
      let node: Node | null = record.target;
      while (node && node.parentNode !== this.host) node = node.parentNode;
      const desc = node && byDom.get(node);
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
    for (const child of this.host.childNodes) {
      // An empty stray node (an extension's marker) holds no text; the re-render removes it.
      if (!byDom.has(child) && !child.textContent) continue;
      if (!first) domText += BLOCK_SEPARATOR;
      first = false;
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
    // A filtered transaction renders nothing: still drop the browser's DOM.
    if (!command(selected, (tr) => this.editor.dispatch(tr)) || this.dirty.size) this.rerender();
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
    deleteSelection(this.state, (tr) => this.editor.dispatch(tr.setMeta(closeHistory, true)));
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
      this.editor.dispatch(tr.setMeta(closeHistory, true));
      return true;
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
