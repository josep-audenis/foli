import {
  AllSelection,
  arrowAcrossLeaf,
  autolinkHref,
  CellSelection,
  type Command,
  cellsAsTable,
  closeHistory,
  type DocumentSettings,
  deleteBackward,
  deleteForward,
  deleteSelection,
  deleteSelectionKeepingTables,
  type Editor,
  type EditorState,
  extendCellSelection,
  fitPaste,
  fitPastedV2,
  goToCellVertically,
  insertHardBreak,
  insertLink,
  insertText,
  isSafeHref,
  keepTablesApart,
  type Node as ModelNode,
  marksAt,
  NodeSelection,
  parseContentV2,
  pasteCells,
  type ReviewView,
  redo,
  type SectionJSON,
  Selection,
  Slice,
  sectionSettings,
  setComments,
  setLink,
  splitBlock,
  TextSelection,
  type Transaction,
  TransformError,
  toggleMark,
  trackState,
  typedMarks,
  undo,
  type WordContext,
  withEnvelope,
  wordContext,
} from "@folijs/core";
import { docFromClipboard, FOLI_MIME, serializeRange } from "./clipboard.js";
import {
  type BlockBox,
  contentHeight,
  DEFAULT_RULES,
  type FlowResult,
  type FlowRules,
  flowFrom,
  PX_PER_MM,
  type Reuse,
} from "./layout/flow.js";
import { type BlockDesc, PAGE_BREAK_ATTR } from "./render.js";

import { spacing, type WordBlockDesc, type WordInfo, WordRenderer } from "./word/edit.js";
import { measureLineRatio } from "./word/pages.js";
import {
  collect,
  type FlowItem,
  FRAME_ATTR,
  type Frame,
  frameElement,
  REPEATED_ATTR,
  type Unit,
} from "./word/table.js";

/** What the flow needs of a table: no paragraph spacing or keep rules of its own. */
const TABLE_WORD: WordInfo = {
  before: 0,
  after: 0,
  keepNext: false,
  keepLines: false,
  pageBreakBefore: false,
  style: null,
  contextual: false,
};

/** Where a table's fragment is: the rows it shows, the header rows drawn again above them. */
interface TablePart {
  rows: number[];
  headers: number[];
}

/** A table as last rendered: its wrappers (one per page it is on), their pages, how it was cut. */
interface FrameState {
  wrappers: HTMLElement[];
  pages: number[];
  /** The parts and the units' fragments in each, as a string: equal means the same DOM. */
  key: string;
}

/** A table's measurement, in layout px from the table's top (drawn whole). */
export interface TableMeasure {
  rows: { top: number; bottom: number }[];
  /** The top of each of its units (by index into the units), null for one not shown (covered). */
  tops: Map<number, number | null>;
  /** Where the table may break: inside rows that may split, and between rows (sorted). */
  breaks?: number[];
}

/** Word's paragraph spacing for a schema v3 document (`flow`'s `word` spacing). */
const WORD_RULES: FlowRules = { ...DEFAULT_RULES, spacing: "word" };

/** Class of the element of a node-selected block (a rule). */
const SELECTED_CLASS = "foli-selected-node";
/** Marks a cell of a cell selection. */
const CELL_CLASS = "foli-selected-cell";
/** On the host while cells are selected: the browser's own highlight (in DOM order) is hidden. */
const CELLS_ATTR = "data-foli-cells";

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
const STYLES = `.${CELL_CLASS}{box-shadow:inset 0 0 0 9999px rgba(0,120,215,.22)}[${CELLS_ATTR}] ::selection{background:transparent}[${PLACEHOLDER_ATTR}]::before{content:attr(${PLACEHOLDER_ATTR});content:attr(${PLACEHOLDER_ATTR}) / "";float:inline-start;height:0;pointer-events:none;color:GrayText}`;

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
 * its section's size per page (the last section's where named pages are not supported), without
 * margins (the page's padding holds them). A page is exactly as tall as a sheet (the flow keeps content inside it; the exact height absorbs its
 * half-pixel slack), with no gap after it. Content taller than a page (a line taller than a
 * page) is not cut: it prints over the next sheet.
 * shortcut: `@page` is per document: with several editors of different page sizes on one web page, the last one's sheet size wins (each keeps its own page rules); print one editor per document until that is needed.
 */
function printStyles(settings: DocumentSettings, sheets: readonly Sheet[], id: string): string {
  const { width, height } = settings.pageSize;
  const last = sheetOf(settings, 0).css;
  const pages = `[${VIEW_ATTR}="${id}"]>.foli-page`;
  // Sections with other page setups: a named page each (engines without named pages print
  // every sheet at the last section's size).
  const named = sheets.every((sheet) => sheet.css === last)
    ? ""
    : sheets
        .map(({ settings: { pageSize: size }, index }) => {
          const name = `foli-${id}-${index}`;
          return (
            `@page ${name}{size:${size.width}mm ${size.height}mm;margin:0}` +
            `${pages}[${SHEET_ATTR}="${index}"]{page:${name};height:${size.height}mm!important}`
          );
        })
        .join("");
  return (
    `@media print{@page{size:${width}mm ${height}mm;margin:0}` +
    `${pages}{height:${height}mm!important;margin-block:0!important;` +
    `break-after:page;break-inside:avoid}${pages}:last-child{break-after:auto}${named}}`
  );
}

/** Whether `node` is inside an element of `stop` that is not displayed (hidden deleted text). */
function hiddenIn(node: Node, stop: Node): boolean {
  for (let el = node.parentElement; el && el !== stop; el = el.parentElement)
    if (el.style.display === "none") return true;
  return false;
}

/** The attribute naming a page's page setup (its index among the document's) for print. */
const SHEET_ATTR = "data-foli-sheet";

/** A page setup: its settings (mm), the page style it gives, its index among the document's. */
interface Sheet {
  readonly settings: DocumentSettings;
  readonly css: string;
  readonly index: number;
}

function sheetOf(settings: DocumentSettings, index: number): Sheet {
  const { pageSize, margins } = settings;
  const css =
    `box-sizing: border-box; width: ${pageSize.width}mm; min-height: ${pageSize.height}mm; ` +
    `padding: ${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm;`;
  return { settings, css, index };
}

/** The style each page element was last given (its `cssText` reads back normalized). */
const pageSheets = new WeakMap<HTMLElement, string>();

/** A block's section: its page setup, and whether the next block starts a new page. */
interface BlockLayout {
  readonly sheet: Sheet;
  readonly breakAfter: boolean;
}

/**
 * The section of each top-level block (the section a paragraph's `section` ends; the
 * envelope's for the blocks after the last such paragraph). A section starts a new page,
 * unless it is continuous with the same page setup as the one before (shortcut: a continuous
 * section with another page setup starts a new page; Word's even and odd page sections do not
 * add a blank page), as `renderDocument` lays sections out.
 */
function sectionLayouts(doc: ModelNode, last: SectionJSON): BlockLayout[] {
  const sheets = new Map<string, Sheet>();
  const bySection = new Map<SectionJSON, Sheet>();
  const sheet = (section: SectionJSON) => {
    let found = bySection.get(section);
    if (!found) {
      const settings = sectionSettings(section);
      const css = sheetOf(settings, 0).css;
      found = sheets.get(css) ?? sheetOf(settings, sheets.size);
      sheets.set(css, found);
      bySection.set(section, found);
    }
    return found;
  };
  const sections: SectionJSON[] = [];
  let section = last;
  for (let i = doc.childCount - 1; i >= 0; i--) {
    const own = doc.child(i).attrs.section as SectionJSON | null | undefined;
    if (own) section = own;
    sections[i] = section;
  }
  // Indexes in document order: the first page setup is 0.
  sections.forEach(sheet);
  return sections.map((own, i) => {
    const next = sections[i + 1];
    // By position, as `renderDocument`: two paragraphs may end sections with one object.
    const ends = !!next && !!doc.child(i).attrs.section;
    const breakAfter = ends && !(next.type === "continuous" && sheet(next).css === sheet(own).css);
    return { sheet: sheet(own), breakAfter };
  });
}

/**
 * Initial pages (before a flow), moved where needed so that each page holds blocks of one
 * page setup: a block is measured in a page of its own section's width.
 */
function separateSheets(
  pages: readonly (readonly number[])[],
  layout: readonly BlockLayout[],
): number[][] {
  const css: string[] = [];
  let floor = 0;
  return pages.map((list, i) =>
    list.map((p) => {
      const want = (layout[i] as BlockLayout).sheet.css;
      let page = Math.max(p, floor);
      // Only the last page used so far has a setup: the next one is free.
      if (css[page] !== undefined && css[page] !== want) page++;
      css[page] ??= want;
      floor = page;
      return page;
    }),
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
 * Blocks are the document's paragraphs and opaque blocks (a schema v3 document has no
 * containers: a list is numbered paragraphs).
 */
export class EditorView {
  private state: EditorState;
  private blocks: WordBlockDesc[] = [];
  /** Position before each block, parallel to `blocks`. */
  private starts: number[] = [];
  /** The index of each block in `blocks`. */
  private indexOf = new Map<BlockDesc, number>();
  /** The element that shows a node selection, if any. */
  private selectedDom: HTMLElement | null = null;
  /** The cells a cell selection marks, and the caret written in its head cell. */
  private selectedCells: HTMLElement[] = [];
  private cellCaret: number | null = null;
  /** The pages of each top-level item (a paragraph's fragments, a table's wrappers), by node. */
  private itemPages = new Map<ModelNode, readonly number[]>();
  /** Each table as last rendered, by node. */
  private frames = new Map<ModelNode, FrameState>();
  /** The table each wrapper element draws (part of). */
  private frameOf = new Map<Node, Frame>();
  /** Each table as last rendered, by its index among the top-level items. */
  private frameAt: ({ node: ModelNode; state: FrameState } | undefined)[] = [];
  /** Elements the view itself removed: the read-back does not take them for input. */
  private viewRemoved = new WeakSet<Node>();
  /** The block each fragment element belongs to. */
  private owner = new Map<Node, BlockDesc>();
  /** The page elements, in order; the host's only children. */
  private pages: HTMLElement[] = [];
  /** The page setup of each page (its section's), parallel to `pages`. */
  private sheets: Sheet[] = [];
  /** The page setups the print rules were written for. */
  private printKey = "";
  /**
   * Each block's page setup and whether a section break follows it, as last rendered: a block
   * whose layout changed (a section break inserted or removed around it) is measured and
   * flowed again.
   */
  private layoutKeys = new WeakMap<ModelNode, string>();
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
   * without an edit (`ResizeObserver`: CSS, fonts).
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
  /** Escape was the last key: Tab now leaves the editor. */
  private tabLeaves = false;
  private placeholder = "";
  /** The block that shows the placeholder, if any. */
  private placeholderDom: HTMLElement | null = null;
  /** Set by a mousedown that focuses the host: the click places the caret, not the view. */
  private pointerFocus = false;
  /** Whether the view added the host's tabindex (a read-only host must stay focusable). */
  private readonly addedTabIndex: boolean;
  /** Renders the document's blocks; made by the first render. */
  private word: WordRenderer | null = null;
  /** How tracked changes show. */
  private review: ReviewView = "markup";
  /** Fonts' normal line height ratios, measured once per family (Word's single spacing). */
  private readonly ratios = new Map<string, number>();
  /** Web fonts loaded since the v3 blocks were drawn: the next render draws them again. */
  private fontsChanged = false;

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
    this.review = trackState(this.state)?.view ?? "markup";
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
    const review = trackState(state)?.view ?? "markup";
    // Another review view (`setReviewView`): every block drawn again, by a new renderer.
    const reviewChanged = review !== this.review;
    if (reviewChanged) {
      this.review = review;
      this.word = null;
    }
    const docChanged = state.doc !== this.state.doc || reviewChanged;
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
    // A new document (envelope) gets its renderer; nothing rendered before is reused then. An
    // editor's state always has one (`createEditor`).
    const context = wordContext(this.state) as WordContext;
    // Fonts loaded: a new renderer (new line heights), but not while a composition runs in a
    // block it would redraw.
    const renewed =
      context !== (this.word?.context ?? null) || (this.fontsChanged && !this.composing);
    if (renewed) this.fontsChanged = false;
    let word = this.word as WordRenderer;
    if (renewed) {
      word = this.word = new WordRenderer(
        context,
        ownerDocument,
        this.lineRatio,
        false,
        this.review,
      );
      this.invalidateLayout();
    }
    // The blocks the view renders (paragraphs in table cells among them) and the page flow's
    // items (top-level paragraphs and opaque blocks, and tables).
    const { units, items } = collect(doc, context.resolver);
    word.prepare(units.map((unit) => unit.node));
    const layout = sectionLayouts(doc, context.envelope.section);
    doc.forEach((node, _, i) => {
      const { sheet, breakAfter } = layout[i] as BlockLayout;
      const key = `${sheet.css}${breakAfter ? "|break" : ""}`;
      const before = this.layoutKeys.get(node);
      if (before !== undefined && before !== key) this.stale.add(node);
      this.layoutKeys.set(node, key);
    });
    const previous = new Map(
      this.blocks.filter((desc) => !this.dirty.has(desc)).map((desc) => [desc.node, desc]),
    );
    const previousPages = this.itemPages;
    const previousFrames = this.frames;
    this.dirty.clear();
    const dropLines = this.linesStale && !this.composing;
    if (dropLines) {
      this.linesStale = false;
      this.flowed = null;
    }
    // What can be reused: a block whose list number, comment shading or cell formatting changed
    // (an edit before it) is redrawn.
    const reusable = units.map((unit, i) => {
      const found = renewed ? undefined : previous.get(unit.node);
      if (found && found.key === word.key(i, unit.cell)) return found;
      if (found) this.stale.add(unit.node);
      return undefined;
    });
    // A table is measured again (drawn whole first) when it changed, went stale, or one of its
    // blocks is redrawn or stale; its blocks with it.
    const remeasureUnit = units.map(() => false);
    for (const item of items) {
      const frame = item.frame;
      if (!frame) continue;
      let stale = dropLines || !this.measures.has(frame.node) || this.stale.has(frame.node);
      for (let u = frame.first; !stale && u < frame.end; u++)
        stale = !reusable[u] || this.stale.has((units[u] as Unit).node);
      if (!stale) continue;
      this.stale.add(frame.node);
      for (let u = frame.first; u < frame.end; u++) remeasureUnit[u] = true;
    }
    let blocks: WordBlockDesc[] = [];
    // Nodes still in the document: an old block or table at an index is only taken over (during
    // a composition) when its node is gone, never when an insertion moved it along.
    const present = new Set<ModelNode>(units.map((unit) => unit.node));
    for (const item of items) if (item.frame) present.add(item.frame.node);
    units.forEach((unit, i) => {
      const { node } = unit;
      let reused = reusable[i];
      // A split block about to be measured again (fonts, CSS) is rendered whole first: each
      // fragment's end breaks its line, so its lines would depend on where it was split before.
      const remeasure =
        remeasureUnit[i] || dropLines || !this.measures.has(node) || this.stale.has(node);
      if (reused && reused.fragments.length > 1 && remeasure && !this.composing) reused = undefined;
      if (reused) previous.delete(node);
      const desc = reused ?? word.render(node, i, [], unit.cell);
      blocks.push(desc);
      // Drawn again in a table cell: the new block takes the old one's place there, so a table
      // kept as it is (during a composition, which moves nothing) still holds it. During a
      // composition a block whose node changed takes the place of the block drawn at its index.
      const atIndex = this.blocks[i];
      const old = reused
        ? undefined
        : (previous.get(node) ??
          (this.composing &&
          atIndex &&
          !present.has(atIndex.node) &&
          previous.get(atIndex.node) === atIndex
            ? atIndex
            : undefined));
      const first = old?.fragments[0];
      if (old && first?.isConnected && first.parentElement?.closest(`[${FRAME_ATTR}]`)) {
        first.replaceWith(...desc.fragments);
        for (const fragment of old.fragments.slice(1)) fragment.remove();
        for (const fragment of old.fragments) this.viewRemoved.add(fragment);
        previous.delete(old.node);
      }
    });
    for (const stale of previous.values())
      for (const fragment of stale.fragments) {
        fragment.remove();
        this.viewRemoved.add(fragment);
      }
    this.applyPrintStyles(layout);
    const doc_ = this.host.ownerDocument;
    const frames = new Map<ModelNode, FrameState>();
    /** A table drawn whole, on one page: what is measured. */
    const whole = (frame: Frame): FrameState => {
      const rows = frame.rows.map((_, r) => r);
      const wrapper = frameElement(
        frame,
        rows,
        [],
        (r, c) => this.cellContent(frame, r, c, blocks, () => true),
        doc_,
      );
      return { wrappers: [wrapper], pages: [0], key: "" };
    };
    // Before the flow, each item where it was (a new one joins the page of the item before it);
    // a table that changed is drawn whole on that page.
    let last = 0;
    let pages = items.map((item, i) => {
      const node = doc.child(i);
      const before = previousPages.get(node);
      if (item.frame) {
        let state = previousFrames.get(node);
        // During a composition nothing moves: a table that changed keeps the wrappers drawn at
        // its place (its redrawn blocks took their old ones' places above).
        const at = this.frameAt[i];
        if (!state && this.composing && at && !present.has(at.node)) state = at.state;
        if (!state || (this.stale.has(node) && !this.composing)) state = whole(item.frame);
        frames.set(node, state);
        const pagesBefore = before ?? (state === at?.state ? state.pages : undefined);
        return state.wrappers.map((_, f) => (last = Math.max(last, pagesBefore?.[f] ?? last)));
      }
      const desc = blocks[item.unit] as WordBlockDesc;
      return desc.fragments.map((_, f) => (last = Math.max(last, before?.[f] ?? last)));
    });
    pages = separateSheets(pages, layout);
    const elementsOf = (item: FlowItem, i: number): readonly HTMLElement[] =>
      item.frame
        ? (frames.get(doc.child(i)) as FrameState).wrappers
        : (blocks[item.unit] as WordBlockDesc).fragments;
    this.place(
      items.map((item, i) => elementsOf(item, i)),
      pages,
      layout,
    );
    if (!this.composing) {
      // DOM reads only for blocks without a valid measurement (new, changed or stale ones).
      let scale: number | undefined;
      const layoutPx = () => {
        scale ??= layoutScale(this.pages[0] as HTMLElement, (this.sheets[0] as Sheet).settings);
        return scale;
      };
      if (dropLines)
        for (const desc of blocks) {
          const measure = this.measures.get(desc.node);
          if (measure) delete measure.lines;
        }
      const nodes = items.map((_, i) => doc.child(i));
      // A block's spacing depends on its neighbours' styles: reuse stops a block earlier.
      const reuse = this.flowed ? reuseOf(this.flowed, nodes, this.stale, 1) : undefined;
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
      const tableOf = (frame: Frame, i: number) => {
        let found = this.measures.get(frame.node);
        if (!found?.table || this.stale.delete(frame.node)) {
          const wrapper = (frames.get(doc.child(i)) as FrameState).wrappers[0] as HTMLElement;
          // Its blocks are measured with it (their heights, for a resize later).
          for (let u = frame.first; u < frame.end; u++) {
            const desc = blocks[u] as WordBlockDesc;
            this.stale.delete(desc.node);
            this.measures.set(desc.node, measureBox(desc, layoutPx()));
          }
          found = measureTable(frame, wrapper, blocks, layoutPx());
          this.measures.set(frame.node, found);
        }
        return found;
      };
      const words = items.map((item) =>
        item.frame ? TABLE_WORD : (blocks[item.unit] as WordBlockDesc).word,
      );
      const boxes = items.map((item, i) => {
        const pageHeight = contentHeight((layout[i] as BlockLayout).sheet.settings);
        if (item.frame) {
          const frame = item.frame;
          const measure = tableOf(frame, i);
          // A section break after it, or a page break before the next paragraph, ends its page.
          const breakAfter =
            (layout[i] as BlockLayout).breakAfter || !!words[i + 1]?.pageBreakBefore;
          return tableBox(frame, measure, pageHeight, breakAfter, () =>
            breaksOf(frame, measure, blocks, pageHeight, lines),
          );
        }
        const desc = blocks[item.unit] as WordBlockDesc;
        return wordBox(
          words,
          i,
          desc,
          measureOf(desc),
          () => lines(desc),
          layout[i] as BlockLayout,
        );
      });
      const result = flowFrom(boxes, contentHeight(this.editor.settings), WORD_RULES, reuse);
      this.flowed = { nodes, result };
      this.stale.clear();
      const flowed = result.fragments;
      // Paragraphs: split where their fragments start. Tables: the rows each fragment shows,
      // and their blocks split where a row is.
      const splitsOf = new Map<number, number[]>();
      const parts = new Map<number, { parts: TablePart[]; partOf: Map<number, number[]> }>();
      items.forEach((item, i) => {
        const fragments = flowed[i] ?? [];
        if (item.unit !== undefined) {
          const desc = blocks[item.unit] as WordBlockDesc;
          const contentStart = ((units[item.unit] as Unit).pos as number) + 1;
          splitsOf.set(
            item.unit,
            fragments.slice(1).map((fragment) => {
              const offset = lines(desc).starts[fragment.fromLine] as number;
              // Never split a grapheme cluster across pages.
              return clusterBoundary(doc, contentStart + offset, false) - contentStart;
            }),
          );
          return;
        }
        const frame = item.frame;
        const measure = this.measures.get(frame.node) as Measure;
        const cut = cutTable(frame, measure, fragments, blocks, lines);
        parts.set(i, cut);
        for (const [u, at] of cut.splits) {
          const contentStart = (units[u] as Unit).pos + 1;
          splitsOf.set(
            u,
            at.map((offset) => clusterBoundary(doc, contentStart + offset, false) - contentStart),
          );
        }
      });
      blocks = blocks.map((desc, u) => {
        const splits = splitsOf.get(u) ?? [];
        const same =
          splits.length === desc.splits.length && splits.every((at, k) => at === desc.splits[k]);
        return same ? desc : word.render(desc.node, u, splits, (units[u] as Unit).cell);
      });
      pages = items.map((item, i) => {
        const fragments = flowed[i] ?? [];
        if (!item.frame) return fragments.map((fragment) => fragment.page);
        const node = doc.child(i);
        const cut = parts.get(i) as { parts: TablePart[]; partOf: Map<number, number[]> };
        const key = JSON.stringify([cut.parts, [...cut.partOf]]);
        const kept = frames.get(node) as FrameState;
        const pagesOf = fragments.map((fragment) => fragment.page);
        // The same cut of the same table, its blocks' elements all in it: its wrappers stay.
        if (kept.key === key && holdsAll(kept, item.frame, blocks)) {
          frames.set(node, { ...kept, pages: pagesOf });
          return pagesOf;
        }
        const wrappers = cut.parts.map((part, k) =>
          frameElement(
            item.frame,
            part.rows,
            part.headers,
            (r, c) =>
              this.cellContent(item.frame, r, c, blocks, (u, f) => cut.partOf.get(u)?.[f] === k),
            doc_,
          ),
        );
        frames.set(node, { wrappers, pages: pagesOf, key });
        return pagesOf;
      });
      const firsts = items.map((item, i) =>
        item.frame
          ? ((frames.get(doc.child(i)) as FrameState).wrappers[0] as HTMLElement)
          : (blocks[item.unit] as WordBlockDesc).dom,
      );
      applyGaps(firsts, pages, boxes);
      this.place(
        items.map((item, i) => elementsOf(item, i)),
        pages,
        layout,
      );
    }
    // (Wrappers no longer drawn are not in a page: `place` removed them.)
    this.frames = frames;
    this.frameAt = items.map((item, i) => {
      const state = item.frame && frames.get(doc.child(i));
      return state ? { node: doc.child(i), state } : undefined;
    });
    this.frameOf = new Map();
    items.forEach((item, i) => {
      if (!item.frame) return;
      for (const wrapper of (frames.get(doc.child(i)) as FrameState).wrappers)
        this.frameOf.set(wrapper, item.frame);
    });
    this.blocks = blocks;
    this.starts = units.map((unit) => unit.pos);
    this.indexOf = new Map(blocks.map((desc, i) => [desc, i]));
    this.itemPages = new Map(items.map((_, i) => [doc.child(i), pages[i] ?? []]));
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

  /** A font's normal line height ratio, measured outside the host (no input to read back). */
  private lineRatio = (family: string): number => {
    let ratio = this.ratios.get(family);
    if (ratio === undefined) {
      const doc = this.host.ownerDocument;
      ratio = measureLineRatio(doc.body ?? doc.documentElement)(family);
      this.ratios.set(family, ratio);
    }
    return ratio;
  };

  /**
   * Puts each fragment of each block into its page (pages are non-decreasing in document
   * order), creating and removing pages as needed, and gives each page the page setup of its
   * blocks' section (one per page: `separateSheets`, section breaks). Anything else in the host
   * or a page (stray DOM) is removed.
   */
  private place(
    elements: readonly (readonly HTMLElement[])[],
    pages: readonly (readonly number[])[],
    layout: readonly BlockLayout[],
  ): void {
    const { host } = this;
    const items = elements.flatMap((list, i) =>
      list.map((dom, f) => ({ dom, page: pages[i]?.[f] ?? 0 })),
    );
    const count = (items[items.length - 1]?.page ?? 0) + 1;
    const sheets: Sheet[] = [];
    pages.forEach((list, i) => {
      for (const p of list) sheets[p] ??= (layout[i] as BlockLayout).sheet;
    });
    // A page no block starts on (none yet) takes the setup of the page before it.
    for (let p = 0; p < count; p++)
      sheets[p] ??=
        sheets[p - 1] ?? (layout[0] as BlockLayout | undefined)?.sheet ?? this.lastSheet();
    this.sheets = sheets.slice(0, count);
    while (this.pages.length < count) this.pages.push(this.createPage());
    this.sheets.forEach((sheet, p) => {
      const page = this.pages[p] as HTMLElement;
      const key = `${sheet.index} ${sheet.css}`;
      if (pageSheets.get(page) === key) return;
      pageSheets.set(page, key);
      page.style.cssText = sheet.css;
      page.setAttribute(SHEET_ATTR, String(sheet.index));
    });
    // Pages first, in order; anything else in the host ends up after them.
    let cursor = host.firstChild;
    for (const page of this.pages.slice(0, count)) {
      if (page === cursor) cursor = cursor.nextSibling;
      else host.insertBefore(page, cursor);
    }
    let i = 0;
    for (let p = 0; p < count; p++) {
      const page = this.pages[p] as HTMLElement;
      let at = page.firstChild;
      for (; i < items.length && items[i]?.page === p; i++) {
        const { dom } = items[i] as (typeof items)[number];
        if (dom === at) at = at.nextSibling;
        else page.insertBefore(dom, at);
      }
      // What is left after the last placed block: strays, and blocks of later pages.
      while (at) {
        const next: ChildNode | null = at.nextSibling;
        at.remove();
        this.viewRemoved.add(at);
        at = next;
      }
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

  /**
   * What a table's cell shows in one of its fragments: its blocks' elements that `takes` puts
   * there, and nested tables whole (where their first block goes).
   */
  private cellContent(
    frame: Frame,
    r: number,
    c: number,
    blocks: readonly WordBlockDesc[],
    takes: (unit: number, fragment: number) => boolean,
  ): Node[] {
    const out: Node[] = [];
    for (const item of frame.rows[r]?.cells[c]?.items ?? []) {
      if ("frame" in item) {
        const nested = item.frame;
        if (!takes(nested.first, 0)) continue;
        out.push(
          frameElement(
            nested,
            nested.rows.map((_, i) => i),
            [],
            (rr, cc) => this.cellContent(nested, rr, cc, blocks, () => true),
            this.host.ownerDocument,
          ),
        );
        continue;
      }
      (blocks[item.unit] as WordBlockDesc).fragments.forEach((fragment, f) => {
        if (takes(item.unit, f)) out.push(fragment);
      });
    }
    return out;
  }

  private createPage(): HTMLElement {
    const page = this.host.ownerDocument.createElement("section");
    page.className = "foli-page";
    return page;
  }

  /** The last section's page setup (the envelope's), for an empty document. */
  private lastSheet(): Sheet {
    return sheetOf(this.editor.settings, 0);
  }

  /** The print rules for the document's page setups, written when they change. */
  private applyPrintStyles(layout: readonly BlockLayout[]): void {
    const sheets = [...new Set(layout.map((block) => block.sheet))];
    const key = [this.lastSheet(), ...sheets].map((sheet) => sheet.css).join("\n");
    if (key === this.printKey) return;
    this.printKey = key;
    // shortcut: written when the page settings change; a host moved to another document or shadow root keeps them where they were until then.
    for (const style of this.printStyles) style.remove();
    const doc = this.host.ownerDocument;
    const root = this.host.getRootNode();
    const parents: ParentNode[] = [doc.head ?? doc.documentElement];
    if (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE) parents.push(root as ShadowRoot);
    this.printStyles = parents.map((parent) => {
      const style = doc.createElement("style");
      style.setAttribute("data-foli-print", "");
      style.textContent = printStyles(this.editor.settings, sheets, this.id);
      parent.append(style);
      return style;
    });
  }

  /** Forgets every measurement: the next flow measures the whole document again. */
  private invalidateLayout(): void {
    this.measures = new WeakMap();
    this.flowed = null;
  }

  /** Re-flows the pages once web fonts have loaded: line heights and wrapping change. */
  private onFontsLoaded = (): void => {
    // v3 line heights come from the fonts' measured ratios: render every block again.
    this.ratios.clear();
    this.fontsChanged = true;
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
      scale ??= layoutScale(this.pages[0] as HTMLElement, (this.sheets[0] as Sheet).settings);
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

  /**
   * Whether `node` holds blocks rather than content: the host, a page, or a table's wrapper,
   * table, rows and cells.
   */
  private holdsBlocks(node: Node): boolean {
    return (
      node === this.host ||
      this.pages.includes(node as HTMLElement) ||
      (node.nodeType === Node.ELEMENT_NODE &&
        (node as Element).hasAttribute(FRAME_ATTR) &&
        !(node as Element).closest(`[${REPEATED_ATTR}]`))
    );
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
    // In a header row drawn again (not document content): the first position below it.
    const at = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    const repeated = at?.closest(`[${REPEATED_ATTR}]`);
    if (repeated?.parentNode && host.contains(repeated)) {
      const parent = repeated.parentNode;
      return this.posFromDOM(parent, [...parent.childNodes].indexOf(repeated as ChildNode) + 1);
    }
    if (this.holdsBlocks(node)) {
      // Between fragments: the start of the first one after the point (a block start, or
      // where a continuation starts), else the document end.
      const range = host.ownerDocument.createRange();
      range.setStart(node, offset);
      const posOf = (i: number, f: number) =>
        f === 0
          ? (this.starts[i] as number)
          : (this.starts[i] as number) +
            1 +
            ((this.blocks[i] as BlockDesc).splits[f - 1] as number);
      // Without tables, blocks are in DOM order: the first one after the point. In a row split
      // across pages, a cell's continuation comes after the next cell: the earliest in the DOM.
      let best: { i: number; f: number; dom: HTMLElement } | null = null;
      for (const [i, desc] of this.blocks.entries()) {
        const f = desc.fragments.findIndex((fragment) => range.comparePoint(fragment, 0) >= 0);
        if (f < 0) continue;
        const dom = desc.fragments[f] as HTMLElement;
        if (!this.frames.size) return posOf(i, f);
        if (!best || dom.compareDocumentPosition(best.dom) & Node.DOCUMENT_POSITION_FOLLOWING)
          best = { i, f, dom };
      }
      return best ? posOf(best.i, best.f) : this.state.doc.content.size;
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
    // Deleted text hidden by the review view takes no caret: the shown text next to it does.
    const shown = desc.leaves.filter((leaf) => !hiddenIn(leaf.dom, desc.dom));
    for (const leaf of shown) {
      if (
        leaf.dom.nodeType === Node.TEXT_NODE &&
        leaf.offset <= offset &&
        offset <= leaf.offset + leaf.size
      )
        return { node: leaf.dom, offset: offset - leaf.offset };
    }
    const next = shown.find((leaf) => leaf.offset >= offset);
    if (next) {
      if (next.dom.nodeType === Node.TEXT_NODE) return { node: next.dom, offset: 0 };
      return before(next.dom);
    }
    const last = shown[shown.length - 1];
    if (last) {
      if (last.dom.nodeType === Node.TEXT_NODE)
        return { node: last.dom, offset: (last.dom as Text).length };
      const point = before(last.dom);
      return { node: point.node, offset: point.offset + 1 };
    }
    // An empty block: before its <br> (after a list number shown in front of it).
    const tail = desc.dom.lastChild;
    const end = tail?.nodeName === "BR" ? desc.dom.childNodes.length - 1 : 0;
    return { node: desc.dom, offset: end };
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
      // Around a table's (first) wrapper: the table selected whole.
      const table = child && this.frameOf.get(child);
      if (table) return NodeSelection.create(this.state.doc, table.pos);
      const owner = child && this.owner.get(child);
      const index = owner ? (this.indexOf.get(owner) ?? -1) : -1;
      if (owner && !owner.node.isTextblock && NodeSelection.isSelectable(owner.node))
        return NodeSelection.create(this.state.doc, this.starts[index] as number);
    }
    // Several ranges (Firefox selects table cells so, one range per cell): from the first cell
    // to the last (a range's start is in its cell; its end is after it).
    const many = sel.rangeCount > 1;
    const first = many ? sel.getRangeAt(0) : null;
    const lastRange = many ? sel.getRangeAt(sel.rangeCount - 1) : null;
    const anchor = first
      ? this.posFromDOM(first.startContainer, first.startOffset)
      : this.posFromDOM(sel.anchorNode, sel.anchorOffset);
    const head = lastRange
      ? this.posFromDOM(lastRange.startContainer, lastRange.startOffset)
      : this.posFromDOM(sel.focusNode, sel.focusOffset);
    if (anchor === null || head === null) return null;
    const { doc } = this.state;
    // The caret the view wrote for a cell selection (in its head cell): that selection.
    const current = this.state.selection;
    if (current instanceof CellSelection && anchor === head && anchor === this.cellCaret)
      return current;
    // Ends in two cells of one table: the cells between them.
    const a = cellAround(doc, anchor);
    const h = cellAround(doc, head);
    if (a && h && a.cell !== h.cell && a.table === h.table)
      return CellSelection.create(doc, a.cell, h.cell);
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

  /** Marks the cells of a cell selection (their table cell elements, on every page). */
  private showSelectedCells(): void {
    const { selection } = this.state;
    const cells: HTMLElement[] = [];
    if (selection instanceof CellSelection) {
      for (const pos of selection.cells) {
        const caret = Selection.near(this.state.doc.resolve(pos + 1), 1).from;
        const { node } = this.domFromPos(caret);
        const element =
          node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
        const td = element?.closest("td");
        if (td instanceof HTMLElement) cells.push(td);
      }
    }
    for (const td of this.selectedCells) if (!cells.includes(td)) td.classList.remove(CELL_CLASS);
    for (const td of cells) td.classList.add(CELL_CLASS);
    this.selectedCells = cells;
    this.host.toggleAttribute(CELLS_ATTR, cells.length > 0);
    if (cells.length) injectStyles(this.host);
  }

  /** The first wrapper of a node-selected table, if a table is selected. */
  private selectedTable(): HTMLElement | null {
    const { selection } = this.state;
    if (!(selection instanceof NodeSelection) || selection.node.type.name !== "table") return null;
    return this.frames.get(selection.node)?.wrappers[0] ?? null;
  }

  /** Marks the element of a node-selected block, for styling (the DOM selection is around it). */
  private showSelectedNode(): void {
    this.showSelectedCells();
    const dom = this.selectedBlock()?.dom ?? this.selectedTable();
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
    const selected = this.selectedBlock()?.dom ?? this.selectedTable();
    if (selected) {
      const point = before(selected);
      sel.setBaseAndExtent(point.node, point.offset, point.node, point.offset + 1);
      return;
    }
    // Cells: drawn by their class; the native caret stays in the head cell (ADR-0006).
    if (selection instanceof CellSelection) {
      const caret = Selection.near(doc.resolve(selection.head + 1), 1).from;
      this.cellCaret = caret;
      const point = this.domFromPos(caret);
      sel.collapse(point.node, point.offset);
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
    // A click puts a caret where it lands, even on the one a cell selection wrote.
    if (!event.shiftKey) this.cellCaret = null;
    // A header row drawn again is not document content: the caret goes below it.
    const repeated = (event.target as Element | null)?.closest?.(`[${REPEATED_ATTR}]`);
    if (repeated && this.host.contains(repeated) && !event.shiftKey) {
      const pos = this.posFromDOM(repeated, 0);
      if (pos !== null) {
        event.preventDefault();
        if (!this.hasFocus()) this.host.focus({ preventScroll: true });
        const $pos = this.state.doc.resolve(pos);
        this.dispatch(this.state.tr.setSelection(Selection.near($pos)));
      }
      return;
    }
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
    return isSafeHref(href) ? href : null;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing || this.composing) return;
    this.syncSelection();
    if (this.crossFragmentEdge(event) || this.crossListNumber(event)) {
      event.preventDefault();
      return;
    }
    const name = keyName(event);
    // Ctrl/Cmd+Shift+V: the paste event that follows uses only the plain text.
    this.plainPaste = name === "Mod-Shift-v";
    // Tab and Shift+Tab move the focus on in read-only mode, and right after Escape where Tab
    // would type a tab (no keyboard trap).
    const tab = name === "Tab" || name === "Shift-Tab";
    const leave = tab && (this.tabLeaves || !this.editable);
    if (event.key !== "Shift") this.tabLeaves = name === "Escape";
    if (leave) return;
    // Like `editor.handleKey`, but through the view's dispatch, so read-only mode drops edits.
    // A key no command takes keeps its default (Tab outside a list moves the focus on).
    if (this.runKey(name)) {
      event.preventDefault();
      return;
    }
    // Up/Down on a textblock's first/last line next to a rule select it (only the view knows
    // lines; measured only when a rule is beside the block); else the browser moves the caret.
    // Shift+arrows in a table: cells selected grow by a cell; from text in a cell, Shift+Up or
    // Down starts a cell selection once the head is on the cell's first or last line.
    const shift: Record<string, ["row" | "column", -1 | 1]> = {
      "Shift-ArrowUp": ["row", -1],
      "Shift-ArrowDown": ["row", 1],
      "Shift-ArrowLeft": ["column", -1],
      "Shift-ArrowRight": ["column", 1],
    };
    const growing = Object.hasOwn(shift, name) ? shift[name] : undefined;
    if (growing) {
      const [axis, dir] = growing;
      const grow = extendCellSelection(axis, dir);
      const leaving =
        this.state.selection instanceof CellSelection ||
        (axis === "row" && this.caretOnEdgeLine(dir, true));
      if (leaving && grow(this.state) && this.run(grow)) {
        event.preventDefault();
        return;
      }
    }
    const vertical = name === "ArrowUp" ? -1 : name === "ArrowDown" ? 1 : 0;
    // In a table, from a cell's first or last line: the cell above or below, or out of the
    // table (browsers go to the next cell in the DOM, or across pages to the wrong row).
    const cells = vertical ? goToCellVertically(vertical as -1 | 1) : null;
    // (A selection of a cell's whole content, Tab's, moves as the cell: no line to measure.)
    const onEdge = () => !this.state.selection.empty || this.caretOnEdgeLine(vertical as -1 | 1);
    if (cells?.(this.state) && onEdge() && this.run(cells)) {
      event.preventDefault();
      return;
    }
    const across = vertical ? arrowAcrossLeaf(vertical, "line") : null;
    if (across?.(this.state) && this.caretOnEdgeLine(vertical as -1 | 1) && this.run(across)) {
      event.preventDefault();
    }
  };

  /**
   * Whether the caret is on the first (`dir` -1) or last (1) line of its textblock, in the
   * block's first or last fragment (a block split across pages has several).
   */
  private caretOnEdgeLine(dir: -1 | 1, focusOnly = false): boolean {
    const sel = this.host.ownerDocument.getSelection();
    // `focusOnly`: a range's head (Shift+arrows), else only a caret.
    if (!sel?.rangeCount || (!focusOnly && !sel.isCollapsed) || !sel.focusNode) return false;
    const element = this.blockElement(sel.focusNode);
    const desc = element ? this.owner.get(element) : undefined;
    if (!desc?.node.isTextblock) return false;
    const fragment = desc.fragments[dir < 0 ? 0 : desc.fragments.length - 1];
    if (!fragment || element !== fragment) return false;
    if (!desc.node.content.size) return true;
    const at = this.host.ownerDocument.createRange();
    at.setStart(sel.focusNode, sel.focusOffset);
    at.collapse(true);
    const caret = at.getClientRects()[0];
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

  /**
   * A v3 list number is not text, but browsers stop the caret before it as well as after: Right
   * at the end of the paragraph before, or Left at a numbered paragraph's start, would seem to do
   * nothing. Moves over the paragraph boundary in one step (word moves are left to the browser).
   */
  private crossListNumber(event: KeyboardEvent): boolean {
    const forward = event.key === "ArrowRight";
    if (!this.word || (!forward && event.key !== "ArrowLeft")) return false;
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    const { selection, doc } = this.state;
    if (!(selection instanceof TextSelection) || (!event.shiftKey && !selection.empty))
      return false;
    const { $head } = selection;
    if ($head.depth !== 1 || $head.parentOffset !== (forward ? $head.parent.content.size : 0))
      return false;
    const numbered = $head.index(0) + (forward ? 1 : 0);
    const other = doc.maybeChild($head.index(0) + (forward ? 1 : -1));
    if (!other?.isTextblock || !this.word.hasMarker(numbered)) return false;
    const head = forward ? $head.after() + 1 : $head.before() - 1;
    const anchor = event.shiftKey ? selection.anchor : head;
    this.dispatch(this.state.tr.setSelection(TextSelection.create(doc, anchor, head)));
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
      // Shown but not document text (a list number, opaque content): never read back.
      else if ((node as Element).getAttribute?.("contenteditable") === "false") return;
      else node.childNodes.forEach(walk);
    };
    // Block-level nodes: inside pages and tables, and anything else in the host.
    let stray = false;
    const collect = (parent: Node) => {
      for (const child of parent.childNodes) {
        if (this.owner.has(child)) continue;
        // Drawn, not document content (a repeated header row): no text of the model.
        if ((child as Element).getAttribute?.("contenteditable") === "false") continue;
        if (this.holdsBlocks(child)) collect(child);
        // Text outside every block (an element the browser added): a block the model does not
        // have. An empty stray node (an extension's marker) holds none; the re-render removes it.
        else if (child.textContent) stray = true;
      }
    };
    collect(this.host);
    if (stray) {
      // shortcut: a change that adds blocks cannot be read back yet; it is dropped.
      console.warn("Foli: discarded a DOM change that adds blocks or line breaks");
      this.rerender();
      return;
    }
    // Each block's fragments are one text, blocks in document order (a row split across pages
    // has its cells' fragments on two pages).
    // A block whose elements the browser removed (merging it into another) has no text there.
    // One missing without a recorded removal was never placed (drawn during a composition):
    // its text counts as unchanged, never as deleted.
    const removed = new Set(
      records.flatMap((record) => [...record.removedNodes]).filter((n) => !this.viewRemoved.has(n)),
    );
    const removedByInput = (node: Node) => {
      for (let at: Node | null = node; at; at = at.parentNode) if (removed.has(at)) return true;
      return false;
    };
    let first = true;
    for (const desc of this.blocks) {
      const shown = desc.fragments.filter((fragment) => this.host.contains(fragment));
      if (!shown.length && !desc.fragments.some(removedByInput)) {
        if (!first) domText += BLOCK_SEPARATOR;
        first = false;
        domText += textOfBlock(desc.node);
        continue;
      }
      if (!shown.length) continue;
      if (!first) domText += BLOCK_SEPARATOR;
      first = false;
      for (const fragment of shown) walk(fragment);
    }

    const { doc } = this.state;
    const lineStarts: number[] = [];
    let modelText = "";
    this.blocks.forEach(({ node: block }, i) => {
      if (i > 0) modelText += BLOCK_SEPARATOR;
      lineStarts.push(modelText.length);
      modelText += textOfBlock(block);
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
    const context = wordContext(this.state) as WordContext;
    // Selected cells are copied as a table of their own (ADR-0006).
    const table = selection instanceof CellSelection ? cellsAsTable(selection) : null;
    const source = table ? doc.type.create(null, table) : doc;
    const { text, html, json } = serializeRange(
      source,
      table ? 0 : selection.from,
      table ? source.content.size : selection.to,
      this.host.ownerDocument,
      { context, ratio: this.lineRatio },
    );
    event.clipboardData.setData("text/plain", table ? cellsText(table) : text);
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
    const marks = typedMarks(state.storedMarks ?? marksAt(state.selection.$from)).map((m) =>
      m.toJSON(),
    );
    // The document takes the styles, lists and comments the content needs (HTML is read as
    // schema v2 content, then migrated).
    const pasted = docFromClipboard(data, marks, (found) =>
      found.html
        ? fitPastedV2(state, parseContentV2(found.content))
        : fitPaste(state, found.content, found.word),
    );
    // One empty paragraph: nothing to paste (a lone opaque block is something).
    const only = pasted?.doc.childCount === 1 ? pasted.doc.firstChild : null;
    if (!pasted || (only?.isTextblock && !only.content.size)) return false;
    const { doc, open, envelope } = pasted;
    // As a slice (text joins the text around the caret); where that cannot be (an opaque block
    // at an end), as whole blocks at the caret.
    const asSlice = (tr: Transaction) => {
      const $pos = tr.selection.$from;
      if (!open && $pos.depth === 1 && $pos.parent.isTextblock && !$pos.parent.content.size) {
        const from = $pos.before();
        tr.replace(from, $pos.after(), new Slice(doc.content, 0, 0));
        tr.setSelection(Selection.near(tr.doc.resolve(from + doc.content.size), -1));
      } else {
        // A slice opens into its first and last blocks: an opaque block there has no inside.
        if (doc.firstChild?.isLeaf || doc.lastChild?.isLeaf) {
          throw new TransformError("An opaque block at an end is pasted as a block");
        }
        tr.replaceSelection(doc.slice(1, doc.content.size - 1));
      }
    };
    const asBlocks = (tr: Transaction) => {
      if (open) throw new TransformError("Open content is pasted as a slice");
      insertBlocks(tr, doc);
    };
    // Rows (a table alone) into a table fill its cells from the selected one (ADR-0006).
    const intoCells = (tr: Transaction) => {
      if (only?.type.name !== "table" || !pasteCells(tr, only))
        throw new TransformError("Only rows are pasted into cells");
    };
    const strategies = [intoCells, asSlice, asBlocks];
    for (const strategy of strategies) {
      const tr = state.tr;
      try {
        // Other content over selected cells goes into the anchor cell; across a table's edge,
        // whole rows go (`deleteSelectionKeepingTables`).
        if (strategy !== intoCells && !tr.selection.empty) deleteSelectionKeepingTables(tr, true);
        strategy(tr);
        // A pasted table never ends the body nor touches another table (Word's rules).
        keepTablesApart(tr);
        const current = wordContext(state)?.envelope;
        if (envelope && current && envelope !== current) {
          withEnvelope(tr, envelope);
          setComments(tr, current.comments, envelope.comments);
        }
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

/** Copied cells as text, as spreadsheets read it: a tab between cells, a line per row. */
function cellsText(table: ModelNode): string {
  const rows: string[] = [];
  table.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => {
      cells.push(cell.textBetween(0, cell.content.size, " "));
    });
    rows.push(cells.join("\t"));
  });
  return rows.join("\n");
}

/**
 * Pastes whole blocks at the caret (after deleting the selection): before or after the caret's
 * paragraph, else between its two halves (an empty one is replaced as a slice first).
 */
function insertBlocks(tr: Transaction, doc: ModelNode): void {
  const $pos = tr.selection.$from;
  if (!$pos.parent.isTextblock) throw new TransformError("No textblock at the caret");
  const atStart = $pos.parentOffset === 0;
  const atEnd = $pos.parentOffset === $pos.parent.content.size;
  let at: number;
  if (atStart) at = $pos.before();
  else if (atEnd) at = $pos.after();
  else {
    tr.split($pos.pos);
    at = $pos.pos + 1;
  }
  tr.insert(at, doc.content);
  tr.setSelection(Selection.near(tr.doc.resolve(at + doc.content.size), -1));
}

/**
 * Client rects are scaled by CSS `zoom` or a `transform` on an ancestor, while margins and the
 * page geometry are in layout px: the ratio between the two for a page. From the page's width
 * as set in mm (`offsetWidth` is rounded to a pixel: off by up to 0.1%, a pixel per page).
 */
function layoutScale(page: HTMLElement, settings: DocumentSettings): number {
  return page.getBoundingClientRect().width / (settings.pageSize.width * PX_PER_MM) || 1;
}

/** A block's measurement: border-box height across its fragments (layout px), margins, lines. */
export interface Measure {
  height: number;
  marginTop: number;
  marginBottom: number;
  /** Vertical padding and border, which every fragment of a split block repeats. */
  box: number;
  lines?: Lines;
  /** A table's rows and blocks. */
  table?: TableMeasure;
}

/** The innermost cell around pos (the position before it) and its table's, or null. */
function cellAround(doc: ModelNode, pos: number): { cell: number; table: number } | null {
  const $pos = doc.resolve(pos);
  for (let d = $pos.depth; d > 2; d--)
    if ($pos.node(d).type.name === "tableCell")
      return { cell: $pos.before(d), table: $pos.before(d - 2) };
  return null;
}

/** A block's text as the read-back compares it: a tab "\t", other inline leaves one character. */
function textOfBlock(block: ModelNode): string {
  let text = "";
  block.forEach((child) => {
    // A tab is text in the DOM (a "\t" text node).
    text += child.isText ? (child.text ?? "") : child.type.name === "tab" ? "\t" : HARD_BREAK;
  });
  return text;
}

/** Whether a table's wrappers hold every element of its blocks (none was drawn anew). */
function holdsAll(state: FrameState, frame: Frame, blocks: readonly WordBlockDesc[]): boolean {
  for (let u = frame.first; u < frame.end; u++)
    for (const fragment of (blocks[u] as WordBlockDesc).fragments)
      if (!state.wrappers.some((wrapper) => wrapper.contains(fragment))) return false;
  return true;
}

/** Measures a table drawn whole: its height, its rows and where its blocks start. */
function measureTable(
  frame: Frame,
  wrapper: HTMLElement,
  blocks: readonly WordBlockDesc[],
  scale: number,
): Measure {
  const box = wrapper.getBoundingClientRect();
  const rows = [...wrapper.querySelectorAll(":scope > table > tbody > tr")].map((tr) => {
    const rect = tr.getBoundingClientRect();
    return { top: (rect.top - box.top) / scale, bottom: (rect.bottom - box.top) / scale };
  });
  const tops = new Map<number, number | null>();
  for (let u = frame.first; u < frame.end; u++) {
    const dom = (blocks[u] as WordBlockDesc).dom;
    // A block of a cell a merge covers is not shown: it goes with its row.
    const hidden = !!dom.closest(`[${FRAME_ATTR}="covered"]`);
    tops.set(u, hidden ? null : (dom.getBoundingClientRect().top - box.top) / scale);
  }
  return {
    height: box.height / scale,
    marginTop: 0,
    marginBottom: 0,
    box: 0,
    table: { rows, tops },
  };
}

/**
 * Where a table may break across pages (from its top, sorted): after each row, and inside a row
 * at its cells' line ends, unless the row may not split (`cantSplit`, unless taller than a
 * page), is part of a vertical merge or holds a nested table (shortcut: those split only
 * between rows; a nested table stays whole within its row).
 */
export function breaksOf(
  frame: Frame,
  measure: Measure,
  blocks: readonly WordBlockDesc[],
  pageHeight: number,
  lines: (desc: BlockDesc) => Lines,
): number[] {
  const t = measure.table as TableMeasure;
  if (t.breaks) return t.breaks;
  const out: number[] = [];
  frame.rows.forEach((row, r) => {
    const { top, bottom } = t.rows[r] ?? { top: 0, bottom: 0 };
    const merged = row.cells.some((cell) => cell.vMerge !== null);
    const nested = row.cells.some((cell) => cell.items.some((item) => "frame" in item));
    const splits = (!row.cantSplit || bottom - top > pageHeight) && !merged && !nested;
    if (splits)
      for (const cell of row.cells)
        for (const item of cell.items) {
          if ("frame" in item) continue;
          const unitTop = t.tops.get(item.unit);
          if (unitTop === null || unitTop === undefined) continue;
          for (const b of lines(blocks[item.unit] as WordBlockDesc).bottoms) {
            const y = unitTop + b;
            if (y > top + 0.5 && y < bottom - 0.5) out.push(y);
          }
        }
    out.push(r === frame.rows.length - 1 ? Math.max(bottom, measure.height) : bottom);
  });
  out.sort((a, b) => a - b);
  t.breaks = out.filter((y, k) => k === 0 || y - (out[k - 1] as number) > 0.5);
  return t.breaks;
}

/** What the flow needs of a table: its height, where it may break, its header rows' height. */
function tableBox(
  frame: Frame,
  measure: Measure,
  pageHeight: number,
  breakAfter: boolean,
  breaks: () => number[],
): BlockBox {
  const t = measure.table as TableMeasure;
  const header = frame.headers ? (t.rows[frame.headers - 1]?.bottom ?? 0) : 0;
  return {
    height: measure.height,
    marginTop: 0,
    marginBottom: 0,
    pageHeight,
    repeat: header,
    // Word keeps no lines together across a table's rows (a cell's paragraph splits anywhere).
    anyLine: true,
    lines: breaks,
    breaksAfter: () => (breakAfter ? [breaks().length - 1] : []),
  };
}

/**
 * A flowed table cut into its fragments: the rows each shows (a row split across pages in
 * both), the header rows drawn again above a continuation, the fragment of the table each
 * block's fragments go in, and where a block of a split row splits (content offsets).
 */
export function cutTable(
  frame: Frame,
  measure: Measure,
  fragments: readonly { fromLine: number; toLine: number }[],
  blocks: readonly WordBlockDesc[],
  lines: (desc: BlockDesc) => Lines,
): { parts: TablePart[]; partOf: Map<number, number[]>; splits: Map<number, number[]> } {
  const t = measure.table as TableMeasure;
  const all = frame.rows.map((_, r) => r);
  const partOf = new Map<number, number[]>();
  const splits = new Map<number, number[]>();
  if (fragments.length <= 1 || !t.breaks) {
    for (let u = frame.first; u < frame.end; u++) partOf.set(u, [0]);
    return { parts: [{ rows: all, headers: [] }], partOf, splits };
  }
  const breaks = t.breaks;
  const bounds = fragments.map((f) => [
    f.fromLine ? (breaks[f.fromLine - 1] as number) : 0,
    f.toLine === Number.POSITIVE_INFINITY ? measure.height : (breaks[f.toLine - 1] as number),
  ]) as [number, number][];
  const parts = bounds.map(([y0, y1], k): TablePart => {
    const rows = all.filter((r) => {
      const row = t.rows[r] ?? { top: 0, bottom: 0 };
      return row.top < y1 - 0.5 && row.bottom > y0 + 0.5;
    });
    const repeat = k > 0 && frame.headers > 0 && (rows[0] ?? 0) >= frame.headers;
    return { rows, headers: repeat ? all.slice(0, frame.headers) : [] };
  });
  frame.rows.forEach((row, r) => {
    const ks = parts.flatMap((part, k) => (part.rows.includes(r) ? [k] : []));
    const firstPart = ks[0] ?? 0;
    for (const cell of row.cells)
      for (const item of cell.items) {
        if ("frame" in item) {
          for (let u = item.frame.first; u < item.frame.end; u++) partOf.set(u, [firstPart]);
          continue;
        }
        const u = item.unit;
        const top = t.tops.get(u);
        if (ks.length < 2 || top === null || top === undefined) {
          partOf.set(u, [firstPart]);
          continue;
        }
        // Each line on the page its bottom fits; consecutive lines on one page are a fragment.
        const { starts, bottoms } = lines(blocks[u] as WordBlockDesc);
        const runs: number[] = [];
        const at: number[] = [];
        bottoms.forEach((b, i) => {
          const y = top + b;
          const k =
            ks.find((part) => y <= (bounds[part] as [number, number])[1] + 0.5) ??
            (ks.at(-1) as number);
          if (runs.at(-1) !== k) {
            if (runs.length) at.push(starts[i] as number);
            runs.push(k);
          }
        });
        partOf.set(u, runs.length ? runs : [firstPart]);
        if (at.length) splits.set(u, at);
      }
  });
  return { parts, partOf, splits };
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
 * What the flow needs of a block: its measurement, its lines (on demand), Word's spacing before
 * and after (next to its neighbours), keep with next, keep lines together (not for a block
 * taller than a page, or one with a page break in it), page breaks ending their line's page,
 * and a page break before the next block ending this one's page.
 */
function wordBox(
  words: readonly WordInfo[],
  i: number,
  desc: WordBlockDesc,
  measure: Measure,
  lines: () => Lines,
  layout: BlockLayout,
): BlockBox {
  const pageHeight = contentHeight(layout.sheet.settings);
  const next = words[i + 1] ? { word: words[i + 1] as WordInfo } : undefined;
  const { before, after } = spacing(words[i - 1], desc.word, next?.word);
  const pageBreaks = desc.leaves.filter(
    (leaf) =>
      leaf.dom.nodeType !== Node.TEXT_NODE && (leaf.dom as Element).hasAttribute(PAGE_BREAK_ATTR),
  );
  const hasBreak = pageBreaks.length > 0;
  const kept = desc.word.keepLines && !hasBreak && measure.height <= pageHeight;
  const bottoms = () => (kept ? [measure.height] : lines().bottoms);
  return {
    height: measure.height,
    marginTop: before,
    marginBottom: after,
    keepWithNext: desc.word.keepNext,
    pageHeight,
    lines: bottoms,
    breaksAfter: () => {
      // The line holding each break: the last one starting at or before it.
      const breaks = pageBreaks.map((leaf) => {
        const { starts } = lines();
        let line = starts.length - 1;
        while (line > 0 && (starts[line] as number) > leaf.offset) line--;
        return line;
      });
      if (next?.word.pageBreakBefore || layout.breakAfter) breaks.push(bottoms().length - 1);
      return breaks;
    },
  };
}

/**
 * Writes Word's space above each v3 block as its top margin: the space after the block above
 * and the space before this one, on the same page; at the top of a page only its space before,
 * and only on the first page or after an explicit break (a page the text flowed onto drops it).
 * Written only when it changes.
 */
function applyGaps(
  firsts: readonly HTMLElement[],
  pages: readonly (readonly number[])[],
  boxes: readonly BlockBox[],
): void {
  firsts.forEach((dom, i) => {
    const page = pages[i]?.[0] ?? 0;
    const above = pages[i - 1];
    const box = boxes[i] as BlockBox;
    let gap: number;
    if (above && above[above.length - 1] === page)
      gap = (boxes[i - 1] as BlockBox).marginBottom + box.marginTop;
    else {
      const prior = boxes[i - 1];
      const breaks = prior?.breaksAfter?.() ?? [];
      const forced =
        page === 0 || (!!prior && breaks.length > 0 && breaks.includes(prior.lines().length - 1));
      gap = forced ? box.marginTop : 0;
    }
    if (gaps.get(dom) === gap) return;
    gaps.set(dom, gap);
    dom.style.marginTop = `${gap}px`;
  });
}

/** The gap `applyGaps` last wrote on each block element (the style serializes it rounded). */
const gaps = new WeakMap<HTMLElement, number>();

/**
 * What the next flow can reuse of the last one: the unchanged blocks before the first changed
 * (or stale) one, and the unchanged tail after the last.
 */
function reuseOf(
  last: { nodes: readonly ModelNode[]; result: FlowResult },
  nodes: readonly ModelNode[],
  stale: ReadonlySet<ModelNode>,
  margin = 0,
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
  // Blocks whose box depends on a changed neighbour are not reused either.
  from = Math.max(0, from - margin);
  tail = Math.max(0, tail - margin);
  const delta = nodes.length - before.length;
  return {
    previous: last.result,
    from,
    previousIndex: (i) => (i >= nodes.length - tail ? i - delta : -1),
  };
}

export interface Lines {
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
