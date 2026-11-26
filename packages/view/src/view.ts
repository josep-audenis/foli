import {
  AllSelection,
  arrowAcrossLeaf,
  autolinkHref,
  CellSelection,
  type Command,
  type ControlRange,
  cellsAsTable,
  changeIndent,
  closeHistory,
  controlAt,
  controlProperties,
  type DocumentSettings,
  type DocumentTarget,
  deleteBackward,
  deleteForward,
  deleteSelection,
  type Editor,
  type EditorState,
  ensureStory,
  extendCellSelection,
  type Field,
  type FieldLayout,
  type FieldsReport,
  type FindMatch,
  type FoundMatches,
  fieldCodesShown,
  fieldsIn,
  formatPainterState,
  formattingMarksShown,
  goToCellVertically,
  insertControlText,
  insertHardBreak,
  insertLink,
  insertNote,
  insertPicture,
  insertText,
  isSafeHref,
  joinHistory,
  listBookmarks,
  type Node as ModelNode,
  marksAt,
  type NavigationRequest,
  NodeSelection,
  type NoteNumber,
  noteAtSelection,
  noteNumbers,
  noteProperties,
  noteTexts,
  type OpenStory,
  pageVariant,
  parseContentV2,
  parseFieldInstruction,
  pasteCells,
  pasteFormat,
  presence,
  type ResourceJSON,
  type ReviewView,
  redo,
  revealSelection,
  type SectionJSON,
  Selection,
  Slice,
  type StorySide,
  type StoryView,
  sectionSettings,
  setColumnWidth,
  setLink,
  setPictureSize,
  splitBlock,
  stopFormatPainter,
  storyOfSection,
  TextSelection,
  type Transaction,
  TransformError,
  toggleFieldCodes,
  toggleMark,
  trackState,
  type UpdateFieldsOptions,
  undo,
  updateFields,
  type WordSettingsJSON,
} from "@folijs/core";
import {
  caretStop,
  controlSpot,
  deleteSelectionKeepingTables,
  fitPaste,
  fitPastedV2,
  isCommentOnly,
  keepTablesApart,
  referencesIn,
  resolvedCommentIds,
  StoryStep,
  sameSpot,
  setComments,
  typedMarks,
  viewKeys,
  type WordContext,
  withEnvelope,
  wordContext,
} from "@folijs/core/internal";
import { docFromClipboard, FOLI_MIME, serializeRange } from "./clipboard.js";
import {
  checkAttrs,
  customDrawing,
  type Decoration,
  type Drawn,
  decorationsByBlock,
  type PluginView,
  reportError,
  type ViewExtension,
  type Views,
  viewsOf,
} from "./extension.js";
import {
  type BlockBox,
  contentHeight,
  DEFAULT_RULES,
  type FlowNote,
  type FlowPage,
  type FlowResult,
  type FlowRules,
  type FlowSection,
  type Fragment,
  flowFrom,
  notePieces,
  type PageFacts,
  PX_PER_MM,
  pagesOf,
  type Reuse,
  spaceAfterText,
} from "./layout/flow.js";
import { printStyles, SHEET_ATTR } from "./print.js";
import { type BlockDesc, type LeafDesc, PAGE_BREAK_ATTR } from "./render.js";
import {
  EMU_PER_PX,
  imageSource,
  NOTE_NUMBER_ATTR,
  NOTE_REF_ATTR,
  PICTURE_ATTR,
  PICTURE_IMAGE_ATTR,
  WORD_COLUMN_BREAK_ATTR,
} from "./word/blocks.js";
import {
  BAND_CLASS,
  bandElement,
  COLUMN_CLASS,
  type ColumnsPx,
  columnsKey,
  columnsPx,
} from "./word/columns.js";
import {
  type Box,
  boxOf,
  CONTROL_STYLES,
  CONTROL_UI_ATTR,
  ControlChrome,
} from "./word/controls.js";
import {
  FLOAT_ANCHORS,
  spacing,
  type WordBlockDesc,
  type WordInfo,
  WordRenderer,
} from "./word/edit.js";
import { FormattingMarks, MARK_TEXT, type MarkGlyph } from "./word/marks.js";
import { HintMarks, MATCH_STYLES, MatchMarks, rangesInCopy, rangesInText } from "./word/matches.js";
import { NOTE_ATTR, type NoteGroup, PageNotes } from "./word/notes.js";
import { measureLineRatio } from "./word/pages.js";
import { type PeerDrawing, PeerMarks } from "./word/presence.js";
import { PageRegions, REGION_CONTENT_CLASS } from "./word/regions.js";
import {
  collect,
  drawnColumns,
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
  empty: false,
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

/**
 * A table's measurement, in layout px from the table's top (drawn whole).
 * @internal
 */
export interface TableMeasure {
  rows: { top: number; bottom: number }[];
  /** The top of each of its units (by index into the units), null for one not shown (covered). */
  tops: Map<number, number | null>;
  /** Where the table may break: inside rows that may split, and between rows (sorted). */
  breaks?: number[];
  /**
   * An autofit table's columns as the whole table drew them, in twips (19.4): its parts on the
   * pages are drawn at these, so they lay out as measured; undefined for a fixed table.
   */
  columns?: number[] | undefined;
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
  /**
   * The URL to show a picture's image from (`key` in the document's `resources`): an image in
   * the .docx package it came from has none of its own (`packageImages` in `@folijs/docx` gives
   * object URLs). Undefined for a key: the resource's own image `data:` URL or web URL (fetched
   * as it is shown), else a box of the picture's size; `null` (or "") for a key: that box (an
   * app that does not fetch web URLs found in documents says so here). `null` clears it.
   */
  resource?: ((key: string, resource: ResourceJSON) => string | null | undefined) | null;
  /**
   * Where pasted and dropped image files go (ADR-0006's upload hook): the URL the app stores the
   * file at (or a `data:` URL, opting in), and the alt text if it has asked for it. Without it,
   * image files are not pasted or dropped. A picture inserted without alt text is marked, as an
   * imported one is.
   */
  upload?:
    | ((file: File) => Promise<string | { src: string; alt?: string; decorative?: boolean }>)
    | null;
  /**
   * `false`: the content in one flow, without pages, headers or print rules (a story being edited
   * on its page, ADR-0007). Set when the view is made. Default true.
   */
  paged?: boolean;
  /** What a note's own mark shows, for the view of a note being edited. */
  noteMark?: () => string;
}

const PLACEHOLDER_ATTR = "data-foli-placeholder";
/** On the span of a selected picture (it holds the resize handle). */
const PICTURE_SELECTED_ATTR = "data-foli-picture-selected";
/** On what shows a field the selection is in: Word shades it. */
const FIELD_SELECTED_ATTR = "data-foli-field-selected";
/** The smallest a picture gets by dragging its handle, in px. */
const MIN_PICTURE = 8;
// Generated content is not document text: no caret stops inside it, a zero-height float keeps
// the caret at the line start, and the empty alt text keeps screen readers on aria-placeholder.
/** How long a hint takes to fade, after its time (18.1). */
const HINT_FADE = 400;

const STYLES = `.foli-format-painter [contenteditable=true]{cursor:copy}[${FIELD_SELECTED_ATTR}]{background-color:rgba(0,0,0,.14)}@media print{[${FIELD_SELECTED_ATTR}]{background-color:transparent}}.foli-in-story>.foli-page>:not(.foli-region){opacity:.45}.foli-story-mount{pointer-events:auto;outline:1px dashed GrayText;outline-offset:2px}.foli-story-mount>[contenteditable=true]:focus{outline:none}@media print{.foli-in-story>.foli-page>:not(.foli-region){opacity:1}.foli-story-mount{outline:none}}.${CELL_CLASS}{box-shadow:inset 0 0 0 9999px rgba(0,120,215,.22)}[${CELLS_ATTR}] ::selection{background:transparent}[data-foli-no-alt]{outline:2px dashed #b45309;outline-offset:-2px}@media print{[data-foli-no-alt]{outline:none}}[${PICTURE_SELECTED_ATTR}]{position:relative;outline:2px solid Highlight}[${PICTURE_SELECTED_ATTR}] [data-foli-resize]{position:absolute;right:-5px;bottom:-5px;width:10px;height:10px;box-sizing:border-box;border:1px solid Canvas;background:Highlight;cursor:nwse-resize;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;forced-color-adjust:none}@media (any-pointer:coarse){[${PICTURE_SELECTED_ATTR}] [data-foli-resize]{right:-12px;bottom:-12px;width:24px;height:24px}}@media print{[${PICTURE_SELECTED_ATTR}]{outline:none}[${PICTURE_SELECTED_ATTR}] [data-foli-resize]{display:none}}[${PLACEHOLDER_ATTR}]::before{content:attr(${PLACEHOLDER_ATTR});content:attr(${PLACEHOLDER_ATTR}) / "";float:inline-start;height:0;pointer-events:none;color:GrayText}${CONTROL_STYLES}${MATCH_STYLES}`;

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
 * Print rules for the page settings of the view whose host has `VIEW_ATTR` = `id` (`print.ts`,
 * shared with the read-only renderer and so with `@folijs/pdf`).
 * shortcut: `@page` is per document: with several editors of different page sizes on one web page, the last one's sheet size wins (each keeps its own page rules); print one editor per document until that is needed.
 */
function viewPrintStyles(settings: DocumentSettings, sheets: readonly Sheet[], id: string): string {
  const mm = ({ width, height }: { width: number; height: number }) => ({
    width: `${width}mm`,
    height: `${height}mm`,
  });
  return printStyles(
    `[${VIEW_ATTR}="${id}"]>.foli-page`,
    mm(settings.pageSize),
    sheets.map(({ settings: { pageSize }, index }) => ({ ...mm(pageSize), index })),
    id,
  );
}

/** Whether `node` is inside an element of `stop` that is not displayed (hidden deleted text). */
function hiddenIn(node: Node, stop: Node): boolean {
  for (let el = node.parentElement; el && el !== stop; el = el.parentElement)
    if (el.style.display === "none") return true;
  return false;
}

/** The fields whose results depend on where things fall on the pages. */
const PAGE_DEPENDENT = new Set(["PAGE", "NUMPAGES", "SECTIONPAGES", "PAGEREF"]);

/** A page setup: its settings (mm), the page style it gives, its index among the document's. */
interface Sheet {
  readonly settings: DocumentSettings;
  readonly css: string;
  readonly index: number;
}

function sheetOf(settings: DocumentSettings, index: number): Sheet {
  const { pageSize, margins } = settings;
  const css =
    // The containing block, stacking context and formatting context of floating pictures: one
    // reaching past the page's text makes the page taller, never overlaps the next page.
    "position: relative; isolation: isolate; display: flow-root; " +
    `box-sizing: border-box; width: ${pageSize.width}mm; min-height: ${pageSize.height}mm; ` +
    `padding: ${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm;`;
  return { settings, css, index };
}

/** The style each page element was last given (its `cssText` reads back normalized). */
const pageSheets = new WeakMap<HTMLElement, string>();
/** The margins a header or footer gave each page element, as last written. */
const pagePads = new WeakMap<HTMLElement, string>();
/** What a view without pages gives its one flow of content. */
const UNPAGED_CSS = "display: flow-root; position: relative;";

/** A section as laid out: its page setup, its columns, what the flow needs of it. */
interface SectionLayout {
  readonly sheet: Sheet;
  readonly columns: ColumnsPx;
  /** Columns of different widths: a block is measured in the one it lands in. */
  readonly unequal: boolean;
  readonly flow: FlowSection;
  /** What a block's place depends on, besides its own content. */
  readonly key: string;
}

/** A block's section, and whether it is the section's first block. */
interface BlockLayout {
  readonly sheet: Sheet;
  readonly section: SectionLayout;
  readonly first: boolean;
}

/** A page's header or footer as drawn. */
interface RegionElement {
  element: HTMLElement;
  /** What it shows: the same object, the same drawing. */
  drawing: object;
  section: number;
  /** Its story. */
  id: string;
}

/** What a page shows of notes: at its feet, and after the text of each column. */
interface PageNoteElements {
  foot: HTMLElement[];
  flow: Map<string, HTMLElement[]>;
}

/** A story being edited on its page. */
interface StoryMount extends OpenStory {
  /** The page and the region it is open in. */
  page: number;
  region: RegionElement;
  wrapper: HTMLElement;
  view: EditorView;
  /** Moved to another page by a new layout: the focus went with the DOM. */
  moved: boolean;
}

/** A header or footer being edited. */
type HeaderMount = StoryMount & { side: StorySide };

/** A fragment's place on its page. */
interface Slot {
  band: number;
  column: number;
  /** The space above its band, when it opens one. */
  lead: number | undefined;
  /** A section's empty last paragraph: on the page, taking no room. */
  mark: boolean;
}

const slotOf = (fragment: Fragment): Slot => ({
  band: fragment.band ?? 0,
  column: fragment.column ?? 0,
  lead: fragment.lead,
  mark: !!fragment.mark,
});

/** The document's sections and the blocks of each. */
function sectionSpans(doc: ModelNode, last: SectionJSON) {
  const spans: { setup: SectionJSON; from: number; to: number }[] = [];
  let from = 0;
  doc.forEach((node, _, i) => {
    const own = node.attrs.section as SectionJSON | null | undefined;
    if (!own) return;
    spans.push({ setup: own, from, to: i + 1 });
    from = i + 1;
  });
  if (from < doc.childCount || !spans.length) spans.push({ setup: last, from, to: doc.childCount });
  return spans;
}

/**
 * The section of each top-level block (the section a paragraph's `section` ends; the
 * envelope's for the blocks after the last such paragraph), as `renderDocument` lays sections
 * out. By position: two paragraphs may end sections with one object. `box` gives a page's text
 * height: null for a view without pages.
 */
function sectionLayouts(
  spans: ReturnType<typeof sectionSpans>,
  box: ((section: number, page: FlowPage) => number) | null,
): BlockLayout[] {
  const sheets = new Map<string, Sheet>();
  const bySection = new Map<SectionJSON, Sheet>();
  const sheet = (section: SectionJSON) => {
    let found = bySection.get(section);
    if (!found) {
      const settings = sectionSettings(section);
      const css = box ? sheetOf(settings, 0).css : UNPAGED_CSS;
      found = sheets.get(css) ?? { ...sheetOf(settings, sheets.size), css };
      sheets.set(css, found);
      bySection.set(section, found);
    }
    return found;
  };
  const sheetByFlow = new Map<FlowSection, Sheet>();
  const out: BlockLayout[] = [];
  spans.forEach(({ setup, from: start, to }, s) => {
    // Indexes in document order: the first page setup is 0.
    const own = sheet(setup);
    const next = spans[s + 1]?.setup;
    const columns = columnsPx(setup);
    const count = columns.widths.length;
    const balanced =
      !!next && count > 1 && next.type === "continuous" && sheet(next).css === own.css;
    const flow: FlowSection = {
      index: s,
      start: setup.type ?? "nextPage",
      columns: count,
      balanced,
      pageStart: setup.pageNumbers?.start,
      box: (page) => ({ height: box ? box(s, page) : Number.POSITIVE_INFINITY }),
      samePage: (other) => sheetByFlow.get(other)?.css === own.css,
    };
    sheetByFlow.set(flow, own);
    const section: SectionLayout = {
      sheet: own,
      columns,
      unequal: new Set(columns.widths).size > 1,
      flow,
      key: `${own.css}|${flow.start}|${flow.pageStart ?? ""}|${balanced}|${columnsKey(columns)}`,
    };
    for (let i = start; i < to; i++) out[i] = { sheet: own, section, first: i === start };
  });
  return out;
}

/**
 * Where blocks are before a flow: where they were (`known`), moved where needed so that each
 * page holds blocks of one page setup and each section has a band of its own: a block is
 * measured in a column of its own section's width.
 */
function initialPlaces(
  pages: readonly (readonly number[])[],
  layout: readonly BlockLayout[],
  known: readonly (readonly Slot[] | undefined)[],
): { pages: number[][]; slots: Slot[][] } {
  let page = 0;
  let band = 0;
  let column = 0;
  let section: SectionLayout | undefined;
  const slots: Slot[][] = [];
  const placed = pages.map((list, i) => {
    const own = (layout[i] as BlockLayout).section;
    const out: Slot[] = [];
    slots[i] = out;
    return list.map((p, f) => {
      let target = Math.max(p, page);
      if (target === page && section && section !== own) {
        // Only the last page used so far has a setup: the next one is free.
        if (section.sheet.css !== own.sheet.css) target++;
        else {
          band++;
          column = 0;
        }
      }
      if (target > page) {
        page = target;
        band = 0;
        column = 0;
      }
      section = own;
      const was = known[i]?.[f];
      column = Math.min(Math.max(column, was?.column ?? 0), own.columns.widths.length - 1);
      out.push({
        band,
        column,
        lead: was?.band === band ? was.lead : undefined,
        mark: was?.mark ?? false,
      });
      return page;
    });
  });
  return { pages: placed, slots };
}

/** Makes `list` the children of `parent`, moving as little as possible; returns what it removed. */
function fillElement(parent: HTMLElement, list: readonly HTMLElement[], removed: WeakSet<Node>) {
  let at = parent.firstChild;
  for (const dom of list) {
    if (dom === at) at = at.nextSibling;
    else parent.insertBefore(dom, at);
  }
  // What is left after the last placed one: strays, and blocks of later pages.
  while (at) {
    const next: ChildNode | null = at.nextSibling;
    at.remove();
    removed.add(at);
    at = next;
  }
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
  /** Where on its page each of those is (band and column). */
  private itemSlots = new Map<ModelNode, readonly Slot[]>();
  /** Each page's band elements, as last placed. */
  private bands = new WeakMap<
    HTMLElement,
    { key: string; band: HTMLElement; columns: HTMLElement[] }[]
  >();
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
  /** A composition runs in this view. */
  composing = false;
  /** Set by Ctrl/Cmd+Shift+V for the paste event it triggers. */
  private plainPaste = false;
  /** How deep `renumberNotes` has rendered again. */
  private renumbering = 0;
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
  /** The host's own `translate`, given back on `destroy`. */
  private readonly ownTranslate: string | null;
  /** Renders the document's blocks; made by the first render. */
  private word: WordRenderer | null = null;
  /** Where pasted and dropped image files go (`EditorViewOptions.upload`). */
  private upload: EditorViewOptions["upload"];
  /** The selected picture's span (with its resize handle). */
  private selectedPicture: HTMLElement | null = null;
  /** A picture being resized: its position, element, size at the press, scale, the press. */
  private resize: {
    pos: number;
    img: HTMLElement;
    width: number;
    height: number;
    scale: number;
    /** The widest it may get (layout px). */
    max: number;
    x: number;
    y: number;
    style: string;
    /** The pointer resizing: a touch's or pen's id, or any mouse (a start from mousedown). */
    pointer: number | "mouse";
  } | null = null;
  /** The app's URLs for pictures' images (`EditorViewOptions.resource`). */
  private resource: EditorViewOptions["resource"];
  /** How tracked changes show. */
  private review: ReviewView = "markup";
  /** Whether fields show their codes (`toggleFieldCodes`). */
  private fieldCodes = false;
  /** The elements shaded for the fields the selection is in. */
  private shadedFields: Element[] = [];
  /** Fonts' normal line height ratios, measured once per family (Word's single spacing). */
  private readonly ratios = new Map<string, number>();
  /** Web fonts loaded since the v3 blocks were drawn: the next render draws them again. */
  private fontsChanged = false;
  /** Whether content goes on pages (`EditorViewOptions.paged`). */
  private readonly paged: boolean;
  /** The headers and footers of the pages; none without pages. */
  private readonly regions: PageRegions | null;
  /** Each page as last flowed. */
  private facts: PageFacts[] = [];
  /** The header and footer element of each page, as last drawn. */
  private pageRegions: { header?: RegionElement; footer?: RegionElement }[] = [];
  /** Each page's margins, when a header or footer pushes them. */
  private pageMargins: { top: string; bottom: string }[] = [];
  /** What the header and footer heights were when last laid out (`PageRegions.key`). */
  private regionsKey = "";
  /** What `regionsKey` was computed from. */
  private regionsFor: { stories: unknown; settings: unknown; sections: SectionJSON[] } | null =
    null;
  /** Footnotes and endnotes on the pages; none without pages. */
  private readonly notes: PageNotes | null;
  /** What each page shows of them. */
  private pageNotes: PageNoteElements[] = [];
  /** Their elements by what they show. */
  private noteElements = new Map<string, HTMLElement>();
  /** The page each note starts on, as last flowed: numbers can restart on each. */
  private notePages = new Map<string, number>();
  /** What the note references showed when last drawn. */
  private shownNotes = "";
  /** The layout and boxes of the last flow, to draw notes again from. */
  private flowLayout: readonly BlockLayout[] = [];
  private flowBoxes: readonly BlockBox[] = [];
  /** What this view's note mark shows (`EditorViewOptions.noteMark`). */
  private readonly noteMark: (() => string) | undefined;
  /** Puts everything on its page again, as the last render left it. */
  private placeAgain: (() => void) | null = null;
  /** The story being edited on its page, if any (ADR-0007). */
  private mount: StoryMount | null = null;
  /** What find shows, and which tree this view draws of it (a mounted story's view: its own). */
  private found: FoundMatches | null = null;
  private matchStory: string | null = null;
  private readonly matchMarks: MatchMarks;
  /** Other people's selections and carets (22.9). */
  private readonly peerMarks: PeerMarks;
  private peerFrame = 0;
  private peersShown = false;
  /** Word's Show/Hide ¶ (29.5): the marks drawn over the text, while shown. */
  private readonly formattingMarks: FormattingMarks;
  private marksShown = false;
  private marksFrame = 0;
  private readonly hintMarks: HintMarks;
  /** The hint shown, as positions of the body (18.1). */
  private shownHint: {
    /** null: the body; a story's id: its copies drawn on the pages are marked. */
    story: string | null;
    from: number;
    to: number;
    fading: boolean;
    timers: number[];
  } | null = null;
  /** The pages marked, as a key; the frame waiting to look again. */
  private matchPages = "";
  private matchFrame = 0;
  /** The body's selection before the press of a double click in a page's margin. */
  private pressSelection: Selection | null = null;
  /** The listeners on the host, to remove them. */
  private readonly listeners: [string, EventListener][] = [];
  /** The frames, titles and pop-ups of content controls. */
  private readonly controlChrome: ControlChrome;
  /** The editor's view extensions' node and mark views, decorations and plugin views. */
  private readonly views: Views;
  private readonly decorators: ViewExtension["decorations"][];
  private decorations: readonly Decoration[] = [];
  private decorationKey = "";
  private pluginViews: PluginView[] = [];
  /** What node views drew and the view still shows (their `destroy` when it no longer does). */
  private readonly drawn: Drawn[] = [];

  constructor(
    readonly host: HTMLElement,
    readonly editor: Editor,
    options: EditorViewOptions = {},
  ) {
    this.state = editor.state;
    this.matchMarks = new MatchMarks(host.ownerDocument);
    this.peerMarks = new PeerMarks(host.ownerDocument);
    this.formattingMarks = new FormattingMarks(host.ownerDocument);
    this.hintMarks = new HintMarks(host.ownerDocument);
    this.paged = options.paged !== false;
    this.noteMark = options.noteMark;
    const view = this;
    this.controlChrome = new ControlChrome({
      host,
      editor,
      state: () => view.state,
      editable: () => view.editable && !view.mount,
      pages: () => view.pages,
      scale: () => view.scale(),
      rects: (range) => view.controlRects(range),
      contentRects: (range) => view.controlContentRects(range),
      posFromDOM: (node, offset) => view.posFromDOM(node, offset),
      focus: () => view.focus(),
      injectStyles: () => injectStyles(host),
    });
    const storyOptions = {
      get review() {
        return view.review;
      },
      get fieldCodes() {
        return view.fieldCodes;
      },
      lineRatio: (family: string) => this.lineRatio(family),
      resource: (key: string, resource: ResourceJSON) => this.resource?.(key, resource),
      measureIn: () => this.pages[0] ?? host,
      scale: () => this.scale(),
      // Headers, footers and notes as the pages show them draw custom content too (19.3).
      custom: customDrawing(editor.extensions),
    };
    this.regions = this.paged
      ? new PageRegions(host.ownerDocument, storyOptions, new WeakMap())
      : null;
    this.notes = this.paged ? new PageNotes(host.ownerDocument, storyOptions, new WeakMap()) : null;
    host.setAttribute("role", "textbox");
    host.setAttribute("aria-multiline", "true");
    // A page translator would rewrite the text, which reading it back takes for typing.
    this.ownTranslate = host.getAttribute("translate");
    host.setAttribute("translate", "no");
    host.setAttribute(VIEW_ATTR, this.id);
    this.addedTabIndex = !host.hasAttribute("tabindex");
    if (this.addedTabIndex) host.tabIndex = 0;
    // Spaces typed into the model must stay visible and caret-addressable.
    host.style.whiteSpace = "pre-wrap";
    host.style.overflowWrap = "break-word";
    host.replaceChildren();
    this.review = trackState(this.state)?.view ?? "markup";
    this.fieldCodes = fieldCodesShown(this.state);
    this.resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(this.onResize);
    this.observer = new MutationObserver(this.onMutations);
    this.observer.observe(host, { childList: true, characterData: true, subtree: true });
    // The picture resolver before the first render: no image drawn from a URL the app refuses.
    this.resource = options.resource ?? undefined;
    const extensions = editor.extensions as readonly ViewExtension[];
    this.views = viewsOf(extensions);
    this.decorators = extensions.flatMap((e) => (e.decorations ? [e.decorations.bind(e)] : []));
    this.decorate(this.state);
    this.render();
    this.setOptions(options);

    this.listen("beforeinput", this.onBeforeInput);
    this.listen("focus", this.onFocus);
    this.listen("keydown", this.onKeyDown);
    // Ctrl/Cmd+Shift+V's paste event comes before any key is let go: none came (the browser or
    // a keymap took the key), so a later paste is an ordinary one.
    this.listen("keyup", () => {
      this.plainPaste = false;
    });
    this.listen("input", this.onInput);
    this.listen("compositionstart", this.onCompositionStart);
    this.listen("compositionend", this.onCompositionEnd);
    this.listen("blur", this.onBlur);
    this.listen("mousedown", this.onPress);
    this.listen("mouseup", this.onPaint);
    this.listen("pointerdown", this.onPointerDown);
    this.listen("mousemove", this.onMouseMove);
    this.listen("mouseleave", () => this.controlChrome.hover(null));
    this.listen("copy", this.onCopy);
    this.listen("cut", this.onCut);
    this.listen("paste", this.onPaste);
    this.listen("dragstart", this.onDragStart);
    this.listen("dragend", this.onTextDragEnd);
    this.listen("dragover", this.onDragOver);
    this.listen("drop", this.onDrop);
    this.listen("click", this.onClick);
    this.listen("auxclick", this.onClick);
    this.claimStories();
    host.ownerDocument.addEventListener("selectionchange", this.onSelectionChange);
    host.ownerDocument.fonts?.addEventListener("loadingdone", this.onFontsLoaded);
    this.unsubscribe = editor.subscribe((state, transactions) => {
      this.mapHint(state, transactions);
      this.update(state);
      // Gone to a change: with room around it, as find shows a match.
      if (transactions.some((tr) => tr.getMeta(revealSelection)))
        this.scrollToRange(state.selection.from, state.selection.to, REVEAL_ABOVE);
      this.drawPeers();
    });
    for (const extension of extensions) {
      try {
        if (extension.view) this.pluginViews.push(extension.view(this));
      } catch (error) {
        reportError(error);
      }
    }
  }

  /** Calls `hook` for each plugin view, reporting what throws. */
  private eachPluginView(hook: (view: PluginView) => void): void {
    for (const view of this.pluginViews) {
      try {
        hook(view);
      } catch (error) {
        reportError(error);
      }
    }
  }

  /** Destroys node views' drawings the host no longer holds (all of them: `all`). */
  private dropDrawn(all: boolean): void {
    let kept = 0;
    for (const drawn of this.drawn) {
      if (!all && this.host.contains(drawn.box)) {
        this.drawn[kept++] = drawn;
        continue;
      }
      try {
        drawn.view.destroy?.(drawn.root);
      } catch (error) {
        reportError(error);
      }
    }
    this.drawn.length = kept;
  }

  /** Asks the extensions for `state`'s decorations; whether they changed. */
  private decorate(state: EditorState): boolean {
    if (!this.decorators.length) return false;
    // A failing extension, or a decoration with a refused attribute, is reported and left out.
    const decorations = this.decorators.flatMap((decorate) => {
      try {
        return (decorate?.(state) ?? []).filter((decoration) => {
          try {
            checkAttrs(decoration.attrs);
            return true;
          } catch (error) {
            reportError(error);
            return false;
          }
        });
      } catch (error) {
        reportError(error);
        return [];
      }
    });
    const key = JSON.stringify(decorations);
    if (key === this.decorationKey) return false;
    this.decorations = decorations;
    this.decorationKey = key;
    return true;
  }

  /** Adds a listener for the body's events: a story open on a page has its own view. */
  private listen<E extends Event>(type: string, handler: (event: E) => void): void {
    const listener: EventListener = (event) => {
      if (!this.mount?.wrapper.contains(event.target as Node | null)) handler(event as E);
    };
    this.host.addEventListener(type, listener);
    this.listeners.push([type, listener]);
  }

  destroy(): void {
    this.eachPluginView((view) => view.destroy?.());
    this.pluginViews = [];
    this.closeStory(false);
    this.showFound(null);
    this.endHint();
    this.controlChrome.destroy();
    if (this.editor.storyView === this.stories) this.editor.storyView = null;
    this.destroyed = true;
    this.unsubscribe();
    this.peerMarks.clear();
    if (this.peersShown) this.showPeers(false);
    this.showMarks(false);
    if (this.peerFrame) this.host.ownerDocument.defaultView?.cancelAnimationFrame(this.peerFrame);
    this.host.ownerDocument.fonts?.removeEventListener("loadingdone", this.onFontsLoaded);
    this.observer.disconnect();
    this.resizeObserver?.disconnect();
    for (const style of this.printStyles) style.remove();
    const { host } = this;
    for (const [type, listener] of this.listeners) host.removeEventListener(type, listener);
    this.endDrag();
    // The pointer on a column border, no drag: the cursor is the view's.
    if (this.resizeCursor) host.style.removeProperty("cursor");
    this.endResize();
    host.ownerDocument.removeEventListener("selectionchange", this.onSelectionChange);
    const owned = [
      CELLS_ATTR,
      "contenteditable",
      "role",
      "aria-multiline",
      "aria-readonly",
      "aria-placeholder",
      VIEW_ATTR,
    ];
    if (this.addedTabIndex) owned.push("tabindex");
    if (this.ownTranslate === null) owned.push("translate");
    else host.setAttribute("translate", this.ownTranslate);
    for (const name of owned) host.removeAttribute(name);
    host.style.removeProperty("white-space");
    host.style.removeProperty("overflow-wrap");
    if (!host.getAttribute("style")) host.removeAttribute("style");
    host.replaceChildren();
    this.dropDrawn(true);
  }

  /** Focuses the host, shows the model selection in it and scrolls it into view. */
  focus(): void {
    if (this.mount) {
      this.mount.view.focus();
      return;
    }
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
      if (!this.editable) this.closeStory(false);
      // A selected picture's handle only while it can be resized.
      this.endResize();
      this.showSelectedPicture();
    }
    if (options.placeholder !== undefined) this.placeholder = options.placeholder;
    if (options.upload !== undefined) this.upload = options.upload ?? undefined;
    this.mount?.view.setOptions({
      ...(options.upload !== undefined ? { upload: options.upload } : {}),
      ...(options.resource !== undefined ? { resource: options.resource } : {}),
    });
    // null clears the resolver (stored as none): the same as none is no change.
    const resource = options.resource ?? undefined;
    if (options.resource !== undefined && resource !== this.resource) {
      this.resource = resource;
      // Every picture again, from the new URLs: after a running composition, keeping the
      // selection.
      if (this.word) {
        if (this.composing) this.onCompositionEnd();
        this.word = null;
        this.render();
        this.writeSelection(false);
      }
    }

    // Read-only: no caret and no browser editing; the text stays selectable and copyable.
    host.setAttribute("contenteditable", String(this.editable && !this.mount));
    if (this.editable && !this.mount) host.removeAttribute("aria-readonly");
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
    this.showMarks(formattingMarksShown(state));
    // The format painter armed: Word's brush cursor over the text (`.foli-format-painter`).
    this.host.classList.toggle("foli-format-painter", formatPainterState(state).armed !== null);
    // A resize is of the picture at its position when it started: the document changed, over.
    if (state.doc !== this.state.doc) this.onResizeCancel();
    const review = trackState(state)?.view ?? "markup";
    // Another review view (`setReviewView`): every block drawn again, by a new renderer.
    const reviewChanged = review !== this.review;
    if (reviewChanged) {
      this.review = review;
      this.word = null;
    }
    // Codes shown or hidden: every block and story drawn again.
    const codes = fieldCodesShown(state);
    const codesChanged = codes !== this.fieldCodes;
    if (codesChanged) {
      this.fieldCodes = codes;
      this.word = null;
    }
    const before = wordContext(this.state)?.envelope;
    const envelope = wordContext(state)?.envelope;
    // The last section's setup and the settings live in the envelope: changing them leaves the
    // tree as it is. So does a story's change, which only its occurrences show.
    const docChanged =
      state.doc !== this.state.doc ||
      reviewChanged ||
      codesChanged ||
      envelope?.section !== before?.section ||
      envelope?.settings !== before?.settings;
    const storiesChanged = envelope?.stories !== before?.stories;
    // A thread resolved or reopened: its text's shading goes or comes back.
    const resolvedChanged =
      envelope?.comments !== before?.comments &&
      String([...resolvedCommentIds(envelope?.comments ?? [])]) !==
        String([...resolvedCommentIds(before?.comments ?? [])]);
    const selectionChanged = !state.selection.eq(this.state.selection);
    // Another document: the story being edited closes.
    const lost = !!this.mount && wordContext(state)?.id !== wordContext(this.state)?.id;
    const previous = this.state;
    this.state = state;
    // Decorations that changed redraw their blocks (the others are reused).
    const decorated = this.decorate(state);
    const redrawn = docChanged || decorated || resolvedChanged;
    if (redrawn || (storiesChanged && !this.redrawRegions())) this.render();
    // Blocks drawn again hold new text nodes: the hint's ranges are made again on them (and
    // during a composition, when the pages are not placed again).
    if (this.shownHint && redrawn) this.drawHint();
    if (lost) this.closeStory(true);
    // The open story has its own editor, which hears nothing of this.
    if (codesChanged) this.mount?.view.update(this.mount.view.editor.state);
    this.showSelectedNode();
    // Redrawn blocks may have held the DOM selection.
    this.writeSelection(redrawn);
    // shortcut: scrolls for every change while focused; once remote or plugin changes exist, scroll only for local input (a transaction flag).
    if (docChanged || selectionChanged) this.scrollToSelection();
    this.eachPluginView((view) => view.update?.(this, previous));
  }

  /**
   * Scrolls the selection head into view. Browsers do it for their own edits and caret moves,
   * not when the view changes the DOM and sets the selection (typing, Enter, undo, paste).
   */
  private scrollToSelection(): void {
    if (this.composing || !this.hasFocus()) return;
    const doc = this.host.ownerDocument;
    const sel = this.domSelection();
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
    try {
      this.renderPages();
      if (this.drawn.length) this.dropDrawn(false);
    } catch (error) {
      // What it had changed is not input: read back, it would render and fail again, for ever.
      this.observer.takeRecords();
      this.pending = [];
      // Half drawn: nothing of it is reused, the next render draws every block again.
      this.word = null;
      throw error;
    }
  }

  private renderPages(): void {
    const { doc } = this.state;
    const ownerDocument = this.host.ownerDocument;
    // A new document (envelope) gets its renderer; nothing rendered before is reused then. An
    // editor's state always has one (`createEditor`).
    const context = wordContext(this.state) as WordContext;
    // Fonts loaded: a new renderer (new line heights), but not while a composition runs in a
    // block it would redraw. What only stories or the settings changed leaves blocks as they are.
    const drawn = this.word?.context;
    const renewed =
      !drawn ||
      drawn.id !== context.id ||
      drawn.resolver !== context.resolver ||
      drawn.envelope.section !== context.envelope.section ||
      drawn.envelope.resources !== context.envelope.resources ||
      drawn.envelope.comments !== context.envelope.comments ||
      (this.fontsChanged && !this.composing);
    if (renewed) this.fontsChanged = false;
    let word = this.word as WordRenderer;
    if (!renewed) word.context = context;
    if (renewed) {
      // A document with pictures: the mark of one without alt text is the view's stylesheet's.
      if (context.envelope.resources) injectStyles(this.host);
      word = this.word = new WordRenderer(
        context,
        ownerDocument,
        this.lineRatio,
        false,
        this.review,
        imageSource(context.envelope.resources, this.resource ?? undefined),
        this.fieldCodes,
      );
      word.views = this.views;
      word.drawn = this.drawn;
      this.invalidateLayout();
    }
    const references = this.noteReferences();
    word.setNotes(noteTexts(references), this.noteMark?.());
    // The blocks the view renders (paragraphs in table cells among them) and the page flow's
    // items (top-level paragraphs and opaque blocks, and tables).
    const { units, items } = collect(doc, context.resolver);
    word.decorations = this.decorations.length ? decorationsByBlock(units, this.decorations) : [];
    word.prepare(
      units.map((unit) => unit.node),
      (i) => {
        const unit = units[i] as Unit;
        const previous = units[i - 1];
        // Siblings: one ends where the other starts.
        return unit.cell && previous && previous.pos + previous.node.nodeSize === unit.pos
          ? { node: previous.node, cell: unit.cell }
          : null;
      },
    );
    // A story's view has none of the body's sections: its one flow is not a page's.
    const spans = sectionSpans(doc, this.paged ? context.envelope.section : {});
    const { regions } = this;
    regions?.setDocument(
      context.envelope,
      spans.map((span) => span.setup),
      context.resolver,
    );
    const { notes } = this;
    notes?.setDocument(
      context.envelope,
      spans.map((span) => span.setup),
      context.resolver,
      references,
    );
    const layout = sectionLayouts(
      spans,
      regions && ((section, page) => regions.boxHeight(section, page)),
    );
    doc.forEach((node, _, i) => {
      const { section, first } = layout[i] as BlockLayout;
      const key = `${section.key}${first ? "|first" : ""}`;
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
    this.staleAroundFloats(
      doc,
      previousPages,
      new Set(units.filter((_, i) => !reusable[i]).map((unit) => unit.node)),
    );
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
    const initial = initialPlaces(
      pages,
      layout,
      items.map((_, i) => this.itemSlots.get(doc.child(i))),
    );
    pages = initial.pages;
    let slots = initial.slots;
    const elementsOf = (item: FlowItem, i: number): readonly HTMLElement[] =>
      item.frame
        ? (frames.get(doc.child(i)) as FrameState).wrappers
        : (blocks[item.unit] as WordBlockDesc).fragments;
    this.place(
      items.map((item, i) => elementsOf(item, i)),
      pages,
      slots,
      layout,
    );
    if (!this.composing) {
      // DOM reads only for blocks without a valid measurement (new, changed or stale ones).
      let scale: number | undefined;
      const layoutPx = () => {
        scale ??= this.scale();
        return scale;
      };
      // A header or footer of another height moves every page's text: no flow is reused.
      if (regions && this.regionsChanged(regions, spans)) this.flowed = null;
      if (dropLines)
        for (const desc of blocks) {
          const measure = this.measures.get(desc.node);
          if (measure) {
            delete measure.lines;
            delete measure.widths;
          }
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
      /** A block's height and lines at a column's width, wherever it is now. */
      const atWidth = (desc: BlockDesc, width: number, kept: boolean): WidthMeasure => {
        const measure = measureOf(desc);
        const widths = measure.widths ?? new Map<number, WidthMeasure>();
        measure.widths = widths;
        const known = widths.get(width);
        if (known) return known;
        const read = <T>(measure: () => T): T => {
          for (const { style } of desc.fragments) {
            style.boxSizing = "border-box";
            style.width = `${width}px`;
          }
          const value = measure();
          for (const { style } of desc.fragments) {
            style.boxSizing = "";
            style.width = "";
          }
          return value;
        };
        const { height } = read(() => measureBox(desc, layoutPx()));
        let all: Lines | undefined;
        const found: WidthMeasure = {
          height,
          all: () => {
            all ??= read(() => measureLines(desc, layoutPx()));
            return all;
          },
          lines: () => (kept ? [height] : found.all().bottoms),
        };
        widths.set(width, found);
        return found;
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
      const endnotes = notes?.endnotes();
      const boxes = items.map((item, i) => {
        const own = layout[i] as BlockLayout;
        const pageHeight = contentHeight(own.sheet.settings);
        const index = own.section.flow.index ?? 0;
        const noteOf = (story: string) => notes?.footnote(story, index) ?? null;
        // Endnotes follow the last block of their section, or of the document.
        const after =
          (layout[i + 1] as BlockLayout | undefined)?.section !== own.section
            ? { endnotes: endnotes?.get(index) }
            : {};
        if (item.frame) {
          const frame = item.frame;
          const measure = tableOf(frame, i);
          const breaks = () => breaksOf(frame, measure, blocks, pageHeight, lines);
          // A page break before the next paragraph ends its page.
          return {
            ...tableBox(frame, measure, pageHeight, !!words[i + 1]?.pageBreakBefore, breaks),
            section: own.section.flow,
            notes: tableNotes(frame, measure, blocks, lines, breaks, noteOf),
            ...after,
          };
        }
        const desc = blocks[item.unit] as WordBlockDesc;
        return {
          ...wordBox(
            words,
            i,
            desc,
            measureOf(desc),
            () => lines(desc),
            own,
            atWidth,
            context.resolver.addsParagraphSpacing,
            noteOf,
          ),
          ...after,
        };
      });
      const rules = {
        ...WORD_RULES,
        addSpacing: context.resolver.addsParagraphSpacing,
        evenAndOddHeaders: context.envelope.settings?.evenAndOddHeaders === true,
        notes: notes?.flowRules(),
      };
      const flowHeight = contentHeight(this.editor.settings);
      let result = flowFrom(boxes, flowHeight, rules, reuse);
      let facts = pagesOf(boxes, result);
      // The page count is known once flowed; a header holding it can change what fits.
      for (let pass = 0; regions && pass < 2 && regions.settle(facts); pass++) {
        result = flowFrom(boxes, flowHeight, rules);
        facts = pagesOf(boxes, result);
      }
      this.facts = facts;
      this.flowed = { nodes, result };
      this.flowLayout = layout;
      this.flowBoxes = boxes;
      this.stale.clear();
      const flowed = result.fragments;
      slots = flowed.map((fragments) => fragments.map(slotOf));
      // Paragraphs: split where their fragments start. Tables: the rows each fragment shows,
      // and their blocks split where a row is.
      const splitsOf = new Map<number, number[]>();
      const parts = new Map<number, { parts: TablePart[]; partOf: Map<number, number[]> }>();
      items.forEach((item, i) => {
        const fragments = flowed[i] ?? [];
        if (item.unit !== undefined) {
          const desc = blocks[item.unit] as WordBlockDesc;
          const contentStart = ((units[item.unit] as Unit).pos as number) + 1;
          const { section } = layout[i] as BlockLayout;
          // A node view splits where its part's line ends (layout px).
          if (desc.parts) {
            const { bottoms } = lines(desc);
            splitsOf.set(
              item.unit,
              fragments.slice(1).map((fragment) => bottoms[fragment.fromLine - 1] as number),
            );
            return;
          }
          splitsOf.set(
            item.unit,
            fragments.slice(1).map((fragment) => {
              // Line numbers are those of the column the fragment is in.
              const measured = section.unequal
                ? atWidth(desc, section.columns.widths[fragment.column ?? 0] as number, false).all()
                : lines(desc);
              const offset = measured.starts[fragment.fromLine] as number;
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
        const columns = this.measures.get(node)?.table?.columns;
        const wrappers = cut.parts.map((part, k) =>
          frameElement(
            item.frame,
            part.rows,
            part.headers,
            (r, c) =>
              this.cellContent(item.frame, r, c, blocks, (u, f) => cut.partOf.get(u)?.[f] === k),
            doc_,
            columns,
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
      applyGaps(firsts, result.gaps);
      this.drawRegions();
      this.drawNotes();
      this.place(
        items.map((item, i) => elementsOf(item, i)),
        pages,
        slots,
        layout,
      );
      this.afterPlace();
    }
    const placed = items.map((item, i) => elementsOf(item, i));
    const placedPages = pages;
    const placedSlots = slots;
    this.placeAgain = () => this.place(placed, placedPages, placedSlots, layout);
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
    this.itemSlots = new Map(items.map((_, i) => [doc.child(i), slots[i] ?? []]));
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
    this.renumberNotes();
  }

  /** The note references shown, with their numbers as the last flow's pages make them. */
  private noteReferences(): NoteNumber[] {
    if (!this.paged) return [];
    const { doc } = this.state;
    const { envelope } = wordContext(this.state) as WordContext;
    const hideDeleted = this.review !== "markup";
    const all = noteNumbers(doc, envelope, {
      hideDeleted,
      pageOf: (_pos, story) => this.notePages.get(story),
    });
    this.shownNotes = JSON.stringify(all.map((n) => n.text));
    return hideDeleted ? all.filter((n) => !n.deleted) : all;
  }

  /**
   * Numbers that restart on each page depend on the flow just made: when they came out otherwise,
   * once more with them (their width can move a line), at most twice.
   */
  private renumberNotes(): void {
    if (!this.notes || this.composing || this.renumbering > 1) return;
    const { envelope } = wordContext(this.state) as WordContext;
    const each = this.sections().some(
      (section) => noteProperties(envelope, "footnote", section).restart === "eachPage",
    );
    if (!each) return;
    const shown = this.shownNotes;
    this.noteReferences();
    if (this.shownNotes === shown) return;
    this.renumbering++;
    try {
      this.renderPages();
    } finally {
      this.renumbering = 0;
    }
  }

  /** The section of each page's bands in the last flow, and each note's place on the pages. */
  private drawNotes(): void {
    const { notes, flowed, facts, mount } = this;
    if (!notes) return;
    const pieces = flowed ? notePieces(flowed.result) : [];
    const notePages = new Map<string, number>();
    for (const piece of pieces)
      if (!piece.fromLine && !notePages.has(piece.id)) notePages.set(piece.id, piece.page);
    this.notePages = notePages;
    const bandSections = new Map<string, number>();
    flowed?.result.fragments.forEach((fragments, i) => {
      const index = (this.flowLayout[i] as BlockLayout | undefined)?.section.flow.index ?? 0;
      for (const f of fragments) bandSections.set(`${f.page}|${f.band ?? 0}`, index);
    });
    const groups: NoteGroup[] = notes.groups(
      pieces,
      (page, band) =>
        bandSections.get(`${page}|${band}`) ??
        bandSections.get(`${page}|0`) ??
        facts[page]?.section ??
        0,
    );
    const foot = groups.filter((group) => !group.inFlow);
    const known = this.noteElements;
    const elements = new Map<string, HTMLElement>();
    const shown: PageNoteElements[] = [];
    const note = mount?.side === "note" ? mount : null;
    for (const group of groups) {
      const { settings } = this.sheetOfPage(group.page);
      const fact = facts[group.page];
      const bottom = fact?.sectionPages
        ? (this.regions as PageRegions).margins(fact.section, fact).bottom
        : settings.margins.bottom * PX_PER_MM;
      const place = group.inFlow
        ? null
        : notes.footPlace(
            { left: settings.margins.left * PX_PER_MM, bottom },
            notes.stacked(group, foot),
          );
      // Footnotes beneath the text keep the space after the paragraph above them.
      const lead =
        group.inFlow && !group.pieces[0]?.end && flowed
          ? spaceAfterText(this.flowBoxes, flowed.result, group.page, group.band, group.column)
          : 0;
      const key = `${group.page}|${group.band}|${group.column}|${group.inFlow}|${place?.left}|${place?.bottom}|${lead}|${notes.keyOf(group)}`;
      let element = known.get(key);
      if (!element) {
        element = notes.groupElement(
          group,
          place,
          (piece) =>
            piece.id === note?.id && !piece.fromLine
              ? note.region.element
              : notes.pieceElement(piece, group),
          lead,
        );
        if (note && element.contains(note.wrapper)) note.moved = true;
      }
      elements.set(key, element);
      const page = shown[group.page] ?? { foot: [], flow: new Map<string, HTMLElement[]>() };
      shown[group.page] = page;
      if (!group.inFlow) page.foot.push(element);
      else {
        const slot = `${group.band}|${group.column}`;
        page.flow.set(slot, [...(page.flow.get(slot) ?? []), element]);
      }
    }
    this.noteElements = elements;
    this.pageNotes = Array.from(
      { length: shown.length },
      (_, p) => shown[p] ?? { foot: [], flow: new Map() },
    );
    if (!note) return;
    // Its reference went (undone, or hidden with the changes): the note closes.
    const page = notePages.get(note.id);
    if (page === undefined) queueMicrotask(() => this.closeStory(true));
    else note.page = page;
  }

  /** Layout px per px on screen: what a scaled ancestor (`transform`, `zoom`) multiplies by. */
  private scale(): number {
    const page = this.pages[0];
    if (!page) return 1;
    return this.paged
      ? layoutScale(page, (this.sheets[0] as Sheet).settings)
      : page.getBoundingClientRect().width / page.offsetWidth || 1;
  }

  /** Whether the headers' and footers' heights differ from when the pages were last flowed. */
  private regionsChanged(regions: PageRegions, spans: readonly { setup: SectionJSON }[]): boolean {
    const { stories, settings } = (wordContext(this.state) as WordContext).envelope;
    const sections = spans.map((span) => span.setup);
    const known = this.regionsFor;
    if (
      known &&
      known.stories === stories &&
      known.settings === settings &&
      known.sections.length === sections.length &&
      known.sections.every((section, i) => section === sections[i])
    )
      return false;
    this.regionsFor = { stories, settings, sections };
    const key = `${regions.key()}|${this.notes?.key() ?? ""}`;
    // Even and odd headers also decide the blank pages: the flow depends on them.
    const changed =
      key !== this.regionsKey ||
      (known?.settings !== settings &&
        (known?.settings as WordSettingsJSON | undefined)?.evenAndOddHeaders !==
          settings?.evenAndOddHeaders);
    this.regionsKey = key;
    return changed;
  }

  /**
   * Gives every page the header and footer the last flow says, redrawing those that changed. The
   * one holding the story being edited stays; it follows the story if its page no longer shows it.
   */
  private drawRegions(): void {
    const { regions, facts } = this;
    // A note open for editing is `drawNotes`' to look after.
    const mount = this.mount?.side === "note" ? null : (this.mount as HeaderMount | null);
    if (!regions) return;
    const sides = ["header", "footer"] as const;
    const wanted = facts.map((page) =>
      // Word's blank page before an even or odd page section has neither.
      page.sectionPages
        ? {
            header: regions.drawing(page.section, "header", page),
            footer: regions.drawing(page.section, "footer", page),
          }
        : { header: null, footer: null },
    );
    const shows = (p: number) => !!mount && wanted[p]?.[mount.side]?.id === mount.id;
    // Its page, while it shows it. Replaced there (the section unlinked, another variant turned
    // on) it does not follow the old story to another page: the page's own opens.
    const replaced = !!mount && facts[mount.page]?.section === mount.section;
    const home = !mount
      ? -1
      : shows(mount.page)
        ? mount.page
        : replaced
          ? -1
          : wanted.findIndex((_, p) => shows(p));
    this.pageRegions = facts.map((page, p) => {
      const own: EditorView["pageRegions"][number] = {};
      for (const side of sides) {
        const drawing = wanted[p]?.[side];
        if (!drawing) continue;
        if (mount && p === home && side === mount.side) {
          own[side] = mount.region;
          if (mount.region.drawing !== drawing.content) {
            mount.region.drawing = drawing.content;
            const copy = drawing.content.content.cloneNode(true) as HTMLElement;
            copy.style.display = "none";
            mount.region.element
              .querySelector(`:scope > .${REGION_CONTENT_CLASS}`)
              ?.replaceWith(copy);
            mount.wrapper.style.paddingBottom = copy.style.paddingBottom;
          }
          continue;
        }
        const known = this.pageRegions[p]?.[side];
        if (known?.drawing === drawing.content && known.section === page.section) {
          own[side] = known;
          continue;
        }
        const element = regions.element(page.section, side);
        element.append(drawing.content.content.cloneNode(true));
        own[side] = { element, drawing: drawing.content, section: page.section, id: drawing.id };
      }
      return own;
    });
    this.pageMargins = facts.map((page, p) => {
      if (!page.sectionPages) return { top: "", bottom: "" };
      const { top, bottom } = regions.margins(page.section, page);
      const { margins } = this.sheetOfPage(p).settings;
      return {
        top: Math.abs(top - margins.top * PX_PER_MM) < 0.01 ? "" : `${top}px`,
        bottom: Math.abs(bottom - margins.bottom * PX_PER_MM) < 0.01 ? "" : `${bottom}px`,
      };
    });
    if (!mount) return;
    // Not shown anywhere any more (a variant turned on or off): the page's own story opens.
    if (home < 0) queueMicrotask(this.reopenStory);
    else if (home !== mount.page) {
      mount.page = home;
      mount.moved = true;
    }
  }

  /** The page setup page `p` has, or will have once placed. */
  private sheetOfPage(p: number): Sheet {
    return this.sheets[p] ?? this.sheets[this.sheets.length - 1] ?? this.lastSheet();
  }

  /**
   * After a story changed: its occurrences redrawn. False when a height changed, which takes a
   * new flow (`render`), or during a composition.
   */
  private redrawRegions(): boolean {
    const { regions } = this;
    if (!regions) return true;
    if (this.composing) return true;
    const context = wordContext(this.state) as WordContext;
    const spans = sectionSpans(this.state.doc, context.envelope.section);
    regions.setDocument(
      context.envelope,
      spans.map((span) => span.setup),
      context.resolver,
    );
    this.notes?.setDocument(
      context.envelope,
      spans.map((span) => span.setup),
      context.resolver,
      this.noteReferences(),
    );
    if (this.regionsChanged(regions, spans)) {
      this.flowed = null;
      return false;
    }
    this.drawRegions();
    this.drawNotes();
    this.placeAgain?.();
    this.afterPlace();
    this.observer.takeRecords();
    return true;
  }

  /** The story being edited, moved with its region: the focus goes back to it. */
  private afterPlace(): void {
    this.drawControls();
    this.drawMatches();
    this.drawHint();
    if (!this.mount?.moved) return;
    this.mount.moved = false;
    this.mount.view.focus();
  }

  // ---------- stories on their pages (ADR-0007) ----------

  /** What the toolbar and code open stories through (`Editor.storyView`). */
  private readonly stories: StoryView = ((view: EditorView) => ({
    get open(): OpenStory | null {
      const { mount } = view;
      return mount
        ? { id: mount.id, side: mount.side, variant: mount.variant, section: mount.section }
        : null;
    },
    edit: (side, page) => view.openStory(side, page),
    editNote: (id) => view.openNote(id),
    toReference: () => view.toReference(),
    close: () => view.closeStory(),
    get fieldLayout() {
      return view.fieldLayout();
    },
    updateFields: (options, editor) => view.updateFields(options, editor),
    showMatches: (found) => view.showMatches(found),
    reveal: (target, options) => view.reveal(target, options),
    hint: (target, options) => view.hint(target, options),
    goToPage: (page, options) => view.goToPage(page, options),
    focus: () => view.focus(),
  }))(this);

  /** Makes this view the one `Editor.storyView` speaks for, telling listeners if it was not. */
  private claimStories(): void {
    if (!this.paged || this.editor.storyView === this.stories) return;
    const first = !this.editor.storyView;
    this.editor.storyView = this.stories;
    if (!first) this.editor.storyChanged();
  }

  // ---------- a hint: a place shown for a few seconds (18.1) ----------

  /**
   * Scrolls `target` into view and marks it for `ms` milliseconds (default 2000), then lets the
   * mark fade. The document, the selection, undo and the focus stay as they are. The range
   * follows edits made while it shows, and goes when its text is deleted; a new hint replaces
   * it. False when no page shows the target.
   */
  hint({ story, from, to }: DocumentTarget, { ms = 2000 } = {}): boolean {
    this.endHint();
    // One in the open story, shown by its own view, is replaced too.
    this.mount?.view.endHint();
    if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
    // The story being edited shows its own hint, in its own view.
    if (story !== null && story === this.mount?.id)
      return this.mount.view.hint({ story: null, from, to }, { ms });
    const tree = story === null ? this.state.doc : wordContext(this.state)?.stories.get(story)?.doc;
    if (!tree || !(from >= 0 && from <= to && to <= tree.content.size)) return false;
    // A point (a bookmark that holds nothing) shows its paragraph: there is no text to mark.
    if (from === to) {
      const $at = tree.resolve(from);
      if ($at.parent.isTextblock) [from, to] = [$at.start(), $at.end()];
    }
    // A story is shown where a page draws it; one no page draws is not shown.
    const copies = story === null ? [] : this.storyCopies(story, false);
    if (story !== null && !copies.length) return false;
    this.shownHint = { story, from, to, fading: false, timers: [] };
    injectStyles(this.host);
    if (story === null) this.scrollToRange(from, to);
    else if (!this.storyCopies(story, true).length) {
      const rect = copies[0]?.getBoundingClientRect();
      if (rect)
        scrollRectIntoView(this.host, { top: rect.top - REVEAL_ABOVE, bottom: rect.bottom + 48 });
    }
    this.drawHint();
    const win = this.host.ownerDocument.defaultView;
    const still = win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const later = (wait: number, run: () => void) =>
      this.shownHint?.timers.push(win?.setTimeout(run, wait) ?? 0);
    // Fading is one lighter colour before it goes; with reduced motion it just goes.
    if (still) later(ms, () => this.endHint());
    else {
      later(ms, () => {
        if (this.shownHint) this.shownHint.fading = true;
        this.drawHint();
      });
      later(ms + HINT_FADE, () => this.endHint());
    }
    return true;
  }

  /** The drawn copies of story `id` on the pages (near the window only, when `near`). */
  private storyCopies(id: string, near: boolean): Element[] {
    const pages = near ? this.pagesNearView() : null;
    const out: Element[] = [];
    this.pages.forEach((page, p) => {
      if (pages && !pages.has(p)) return;
      for (const region of [this.pageRegions[p]?.header, this.pageRegions[p]?.footer])
        if (region?.id === id) {
          const content = region.element.querySelector(`:scope > .${REGION_CONTENT_CLASS}`);
          if (content) out.push(content);
        }
      for (const note of page.querySelectorAll(`[${NOTE_ATTR}]`))
        if (note.getAttribute(NOTE_ATTR) === id) out.push(note);
    });
    return out;
  }

  /** The hint taken off, its timers stopped. */
  private endHint(): void {
    const shown = this.shownHint;
    if (!shown) return;
    const win = this.host.ownerDocument.defaultView;
    for (const timer of shown.timers) win?.clearTimeout(timer);
    this.shownHint = null;
    this.hintMarks.set([]);
  }

  /** The hint's range through `transactions`; gone when what it marked is. */
  private mapHint(state: EditorState, transactions: readonly Transaction[]): void {
    const shown = this.shownHint;
    if (!shown) return;
    // A document replaced tells without a transaction: nothing of the old one holds.
    if (!transactions.length && state.doc !== this.state.doc) {
      this.endHint();
      return;
    }
    // A story's positions are not mapped through the body's steps: a change to it ends the hint.
    if (shown.story !== null) {
      const story = (from: EditorState) =>
        wordContext(from)?.stories.get(shown.story as string)?.doc;
      if (story(state) !== story(this.state)) this.endHint();
      return;
    }
    for (const tr of transactions) {
      shown.from = tr.mapping.map(shown.from, 1);
      shown.to = tr.mapping.map(shown.to, -1);
    }
    if (shown.from >= shown.to && transactions.some((tr) => tr.docChanged)) this.endHint();
  }

  /** The hint's ranges on the pages, after each render: a paragraph's text at a time. */
  private drawHint(): void {
    const shown = this.shownHint;
    if (!shown) return;
    const { story, from, to, fading } = shown;
    const ranges: Range[] = [];
    if (story !== null) {
      // Each paragraph of the story it covers, by its index and its text's characters.
      const tree = wordContext(this.state)?.stories.get(story)?.doc;
      const spans: { block: number; from: number; to: number }[] = [];
      // What the copy draws, as `renderBlocks` draws it: no cell a merge covers; outside the
      // markup view no deleted text, and a paragraph whose mark is deleted joined to the next.
      const hidden = this.review !== "markup";
      let block = 0;
      /** The text of paragraphs joined into the one drawn next: its characters come after it. */
      let carry = 0;
      tree?.descendants((node, pos, parent, index) => {
        if (node.type.name === "tableCell" && node.attrs.vMerge === "continue") return false;
        if (!node.isTextblock) return true;
        const start = pos + 1;
        const end = start + node.content.size;
        /** The characters drawn before position `a`: text, and a tab as one. */
        const shown = (a: number) => {
          let n = 0;
          node.forEach((child, offset) => {
            const at = start + offset;
            if (at >= a) return;
            if (hidden && child.marks.some((m) => m.type.name === "deletion")) return;
            if (child.isText) n += Math.min(child.nodeSize, a - at);
            else if (child.type.name === "tab") n += 1;
          });
          return n;
        };
        if (end >= from && start <= to)
          spans.push({ block, from: carry + shown(from), to: carry + shown(to) });
        const revision = node.attrs.revision as { deletion?: unknown } | null;
        const joins =
          hidden &&
          node.type.name === "paragraph" &&
          !!revision?.deletion &&
          // Only the story's own paragraphs: a cell's are drawn apart, joined or not.
          parent === tree &&
          parent.maybeChild(index + 1)?.type.name === "paragraph";
        if (joins) carry += shown(end);
        else {
          block++;
          carry = 0;
        }
        return false;
      });
      for (const copy of this.storyCopies(story, true)) ranges.push(...rangesInCopy(copy, spans));
    }
    // shortcut: a range of the whole document marks every page at each render while it shows
    // (2.4 s); mark only pages near the window, as find does, if a hint of that size matters.
    else
      this.state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isTextblock) return true;
        const start = pos + 1;
        ranges.push(
          ...this.rangesOf(Math.max(from, start), Math.min(to, start + node.content.size)),
        );
        return false;
      });
    this.hintMarks.set(ranges, fading);
  }

  // ---------- find, and going places (11.11) ----------

  /**
   * Marks what find found: on the pages, in the story open, and in the drawn copies of the others.
   * Nothing of it is in the document or the pages' DOM, and it does not print. The current match is
   * scrolled to when it is where the view can show it.
   */
  showMatches(found: FoundMatches | null): void {
    this.showFound(found);
    const { current, scroll } = found ?? {};
    if (!current || !scroll) return;
    if (current.story === this.matchStory) this.scrollToRange(current.from, current.to);
    else if (current.story === this.mount?.id)
      this.mount?.view.scrollToRange(current.from, current.to);
  }

  /** The screen ranges of `from..to` in one paragraph: one per text node it covers. */
  private rangesOf(from: number, to: number): Range[] {
    const { doc } = this.state;
    if (to > doc.content.size) return [];
    const $from = doc.resolve(from);
    if (!$from.parent.isTextblock) return [];
    const desc = this.blocks[this.blockFrom($from.before())];
    if (!desc) return [];
    const start = $from.start();
    const out: Range[] = [];
    for (const leaf of desc.leaves) {
      const at = start + leaf.offset;
      const a = Math.max(from, at);
      const b = Math.min(to, at + leaf.size);
      if (a >= b || hiddenIn(leaf.dom, desc.dom)) continue;
      const range = this.host.ownerDocument.createRange();
      if (leaf.dom.nodeType === Node.TEXT_NODE) {
        range.setStart(leaf.dom, a - at);
        range.setEnd(leaf.dom, b - at);
      } else range.selectNodeContents(leaf.dom);
      out.push(range);
    }
    return out;
  }

  /** The pages on the screen and a screen around it: only these carry marks. */
  private pagesNearView(): Set<number> {
    const height = this.host.ownerDocument.defaultView?.innerHeight ?? 0;
    const near = new Set<number>();
    this.pages.forEach((page, i) => {
      const { top, bottom } = page.getBoundingClientRect();
      if (bottom >= -height && top <= 2 * height) near.add(i);
    });
    return near;
  }

  private drawMatches(): void {
    const { found, mount } = this;
    if (mount) {
      mount.view.matchStory = mount.id;
      mount.view.showFound(found);
    }
    if (!found) {
      this.matchMarks.set([], []);
      this.matchPages = "";
      return;
    }
    injectStyles(this.host);
    const { doc } = this.state;
    const near = this.pagesNearView();
    this.matchPages = [...near].join();
    // What the near pages hold, as positions: of the body's top-level nodes on them.
    let low = 0;
    let high = doc.content.size;
    if (this.paged) {
      low = high + 1;
      high = -1;
      doc.forEach((node, offset) => {
        const pages = this.itemPages.get(node);
        if (pages && !pages.some((page) => near.has(page))) return;
        low = Math.min(low, offset);
        high = Math.max(high, offset + node.nodeSize);
      });
    }
    // A tree's matches stand together, in order: those near are found by halving.
    const { matches } = found;
    let start = matches.findIndex((m) => m.story === this.matchStory);
    if (start < 0) start = matches.length;
    let end = start;
    while (end < matches.length && matches[end]?.story === this.matchStory) end++;
    let first = start;
    for (let last = end; first < last; ) {
      const mid = (first + last) >> 1;
      if ((matches[mid] as FindMatch).to <= low) first = mid + 1;
      else last = mid;
    }
    const all: Range[] = [];
    for (let i = first; i < end && (matches[i] as FindMatch).from < high; i++) {
      const { from, to } = matches[i] as FindMatch;
      all.push(...this.rangesOf(from, to));
    }
    const others = new Set<string>();
    for (const [i, { story }] of matches.entries())
      if ((i < start || i >= end) && story !== null && story !== mount?.id) others.add(story);
    const { current, query, matchCase, wholeWord } = found;
    const here = current?.story === this.matchStory ? current : null;
    if (others.size) {
      const options = { matchCase, wholeWord };
      const add = (root: Element | null | undefined) => {
        if (root) all.push(...rangesInText(root, query, options));
      };
      for (const p of near) {
        const { header, footer } = this.pageRegions[p] ?? {};
        for (const region of [header, footer])
          if (region && others.has(region.id))
            add(region.element.querySelector(`:scope > .${REGION_CONTENT_CLASS}`));
        for (const note of this.pages[p]?.querySelectorAll(`[${NOTE_ATTR}]`) ?? [])
          if (others.has(note.getAttribute(NOTE_ATTR) as string)) add(note);
      }
    }
    this.matchMarks.set(all, here ? this.rangesOf(here.from, here.to) : []);
  }

  /** Other people's selections marked and carets with their names (22.9); nothing in the document. */
  private drawPeers(): void {
    const peers = presence(this.state);
    if (!peers.length && !this.peersShown) return;
    this.showPeers(peers.length > 0);
    const size = this.state.doc.content.size;
    const drawings: PeerDrawing[] = [];
    const near = this.paged ? this.pagesNearView() : null;
    const box = this.host.getBoundingClientRect();
    for (const { name, color, selection } of peers) {
      if (!selection) continue;
      const from = Math.min(selection.anchor, selection.head, size);
      const to = Math.min(Math.max(selection.anchor, selection.head), size);
      const ranges: Range[] = [];
      try {
        // Each paragraph the selection crosses, those on pages near the screen only.
        if (from < to)
          this.state.doc.nodesBetween(from, to, (node, pos) => {
            if (!node.isTextblock) return true;
            const start = Math.max(from, pos + 1);
            const end = Math.min(to, pos + node.nodeSize - 1);
            if (start < end && this.blockNear(pos, near)) ranges.push(...this.rangesOf(start, end));
            return false;
          });
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
      }
      const caret = this.caretAt(selection.head);
      // Not over the rest of the app: only where the editor shows.
      const shown =
        caret &&
        caret.top + caret.height >= box.top &&
        caret.top <= box.bottom &&
        caret.left >= box.left &&
        caret.left <= box.right;
      drawings.push({ name, color, ranges, caret: shown ? caret : null });
    }
    this.peerMarks.draw(drawings);
  }

  /** Formatting marks on or off: drawn after each change, scroll and resize while on. */
  private showMarks(on: boolean): void {
    const doc = this.host.ownerDocument;
    const win = doc.defaultView;
    if (on !== this.marksShown) {
      this.marksShown = on;
      const listen = on ? "addEventListener" : "removeEventListener";
      doc[listen]("scroll", this.onMarksMove, SCROLL_OPTIONS);
      win?.[listen]("resize", this.onMarksMove);
      if (!on) {
        if (this.marksFrame) win?.cancelAnimationFrame(this.marksFrame);
        this.marksFrame = 0;
        this.formattingMarks.clear();
        return;
      }
    }
    // After this change's layout, which an earlier frame request runs first.
    if (on) this.onMarksMove();
  }

  private readonly onMarksMove = (): void => {
    const win = this.host.ownerDocument.defaultView;
    if (this.marksFrame || !win) return;
    this.marksFrame = win.requestAnimationFrame(() => {
      this.marksFrame = 0;
      if (!this.destroyed && this.marksShown) this.drawMarks();
    });
  };

  /** The marks of the paragraphs on pages near the screen: where each space, tab, break and end is. */
  private drawMarks(): void {
    const near = this.paged ? this.pagesNearView() : null;
    const glyphs: MarkGlyph[] = [];
    const rectOf = (from: number, to: number, last = false) => {
      const ranges = this.rangesOf(from, to);
      const range = last ? ranges.at(-1) : ranges[0];
      const rects = range ? [...range.getClientRects()].filter((r) => r.height > 0) : [];
      return last ? rects.at(-1) : rects[0];
    };
    try {
      this.state.doc.descendants((node, pos) => {
        if (!node.isTextblock) return true;
        if (!this.blockNear(pos, near)) return false;
        node.forEach((child, offset) => {
          const at = pos + 1 + offset;
          if (child.isText) {
            const text = child.text ?? "";
            for (let i = 0; i < text.length; i++) {
              const mark = MARK_TEXT[text[i] as string];
              const rect = mark && rectOf(at + i, at + i + 1);
              if (mark && rect)
                glyphs.push({
                  text: mark,
                  x: rect.left + rect.width / 2,
                  top: rect.top,
                  height: rect.height,
                  align: "center",
                });
            }
            return;
          }
          const name = child.type.name;
          const mark =
            name === "hardBreak"
              ? "↵"
              : name === "pageBreak"
                ? "···· Page Break ····"
                : name === "columnBreak"
                  ? "···· Column Break ····"
                  : null;
          const rect = mark && (rectOf(at, at + 1) ?? rectOf(pos + 1, at, true));
          if (mark && rect)
            glyphs.push({
              text: mark,
              x: rect.width ? rect.left : rect.right,
              top: rect.top,
              height: rect.height,
              align: "start",
            });
        });
        // The paragraph mark after its last line (an empty paragraph: where its line starts).
        const end = pos + node.nodeSize - 1;
        const last = end > pos + 1 ? rectOf(pos + 1, end, true) : undefined;
        if (last)
          glyphs.push({
            text: "¶",
            x: last.right + 1,
            top: last.top,
            height: last.height,
            align: "start",
          });
        else {
          const dom = this.blocks[this.blockFrom(pos)]?.dom;
          if (dom instanceof HTMLElement) {
            const box = dom.getBoundingClientRect();
            const style = getComputedStyle(dom);
            const line = Number.parseFloat(style.fontSize) * 1.2 || 16;
            const left =
              box.left +
              (Number.parseFloat(style.paddingLeft) || 0) +
              (Number.parseFloat(style.textIndent) || 0);
            const top = box.top + (Number.parseFloat(style.paddingTop) || 0);
            glyphs.push({ text: "¶", x: left, top, height: line, align: "start" });
          }
        }
        return false;
      });
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
    this.formattingMarks.draw(glyphs, this.host.getBoundingClientRect());
  }

  /** Whether the block at `pos` is on a page in `near` (always, unpaged). */
  private blockNear(pos: number, near: ReadonlySet<number> | null): boolean {
    if (!near) return true;
    const top = this.state.doc.resolve(pos);
    const item = top.depth ? top.node(1) : this.state.doc.nodeAt(pos);
    const pages = item && this.itemPages.get(item);
    return !pages || pages.some((page) => near.has(page));
  }

  /** Where the caret at `pos` is drawn, in viewport coordinates; null where none shows. */
  private caretAt(pos: number): PeerDrawing["caret"] {
    const size = this.state.doc.content.size;
    try {
      const after = pos < size ? this.rangesOf(pos, pos + 1)[0]?.getClientRects?.()[0] : undefined;
      if (after?.height) return { left: after.left, top: after.top, height: after.height };
      const before = pos > 0 ? this.rangesOf(pos - 1, pos)[0]?.getClientRects?.() : undefined;
      const rect = before?.[before.length - 1];
      if (rect?.height) return { left: rect.right, top: rect.top, height: rect.height };
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
    return null;
  }

  /** While peers show, scrolling and resizing move their carets, once per frame. */
  private showPeers(on: boolean): void {
    if (on === this.peersShown) return;
    this.peersShown = on;
    const doc = this.host.ownerDocument;
    const win = doc.defaultView;
    const listen = on ? "addEventListener" : "removeEventListener";
    doc[listen]("scroll", this.onPeerScroll, SCROLL_OPTIONS);
    win?.[listen]("resize", this.onPeerScroll);
  }

  private readonly onPeerScroll = (): void => {
    const win = this.host.ownerDocument.defaultView;
    if (this.peerFrame || !win) return;
    this.peerFrame = win.requestAnimationFrame(() => {
      this.peerFrame = 0;
      if (!this.destroyed) this.drawPeers();
    });
  };

  /** Scrolling brings other pages near: their marks are drawn, once per frame. */
  private readonly onMatchScroll = (): void => {
    const win = this.host.ownerDocument.defaultView;
    if (this.matchFrame || !win) return;
    this.matchFrame = win.requestAnimationFrame(() => {
      this.matchFrame = 0;
      if (this.found && [...this.pagesNearView()].join() !== this.matchPages) this.drawMatches();
    });
  };

  /** What find shows here, marked; a story's view is told by its page's view. */
  private showFound(found: FoundMatches | null): void {
    const doc = this.host.ownerDocument;
    if (this.paged && !this.found !== !found) {
      if (found) doc.addEventListener("scroll", this.onMatchScroll, SCROLL_OPTIONS);
      else doc.removeEventListener("scroll", this.onMatchScroll, SCROLL_OPTIONS);
    }
    this.found = found;
    this.drawMatches();
  }

  /** `below`: room kept under it, in px (a change gone to gets as much as above). */
  private scrollToRange(from: number, to: number, below = 48): void {
    let rect = this.rangesOf(from, to)[0]?.getClientRects?.()[0];
    if (!rect) {
      // A place, not a stretch of text: what holds it.
      const { node } = this.domFromPos(from);
      rect = (node instanceof Element ? node : node.parentElement)?.getBoundingClientRect();
    }
    // With room around it: a panel may float over the top of the window.
    if (rect)
      scrollRectIntoView(this.host, { top: rect.top - REVEAL_ABOVE, bottom: rect.bottom + below });
  }

  /** Opens story `id` where a page shows it, leaving the focus where it is. */
  private openForReveal(id: string): boolean {
    const kind = wordContext(this.state)?.stories.get(id)?.kind;
    if (kind === "footnote" || kind === "endnote") return this.openNote(id, false);
    if (kind !== "header" && kind !== "footer") return false;
    const page = this.pageRegions.findIndex((regions) => regions[kind]?.id === id);
    return page >= 0 && this.openStory(kind, page, false, false);
  }

  /**
   * Selects `target` and scrolls to it: in the body (leaving a story that is open), or in its story,
   * opened where it is. `focus`: the document takes the focus. False when no page shows it.
   */
  reveal({ story, from, to }: DocumentTarget, { focus = false } = {}): boolean {
    if (story === null) {
      this.closeStory(false);
      const { doc } = this.state;
      if (to > doc.content.size) return false;
      this.editor.dispatch(this.state.tr.setSelection(TextSelection.create(doc, from, to)));
      if (focus) this.focus();
      this.scrollToRange(from, to);
      return true;
    }
    if (this.mount?.id !== story && !this.openForReveal(story)) return false;
    const { mount } = this;
    if (!mount) return false;
    mount.view.editor.select(from, to);
    if (focus) mount.view.focus();
    mount.view.scrollToRange(from, to);
    return true;
  }

  /** The caret to the start of page `page` (1-based) and the page into view. */
  goToPage(page: number, { focus = false } = {}): boolean {
    const element = this.pages[page - 1];
    if (!element) return false;
    this.closeStory(false);
    search: for (const [i, desc] of this.blocks.entries()) {
      for (const [f, fragment] of desc.fragments.entries()) {
        if (fragment.closest(".foli-page") !== element) continue;
        // A block leaf's parts (a node view split across pages) are all before it.
        const start = desc.node.isTextblock
          ? (this.starts[i] as number) + 1 + (f ? (desc.splits[f - 1] as number) : 0)
          : (this.starts[i] as number);
        const { doc } = this.state;
        this.editor.dispatch(
          this.state.tr.setSelection(
            Selection.near(doc.resolve(Math.min(start, doc.content.size))),
          ),
        );
        break search;
      }
    }
    if (focus) this.focus();
    scrollRectIntoView(this.host, element.getBoundingClientRect());
    return true;
  }

  /** Word's keys for finding and going places, when the app shows something for them. */
  private navigationKey(name: string): boolean {
    const request = Object.hasOwn(NAVIGATION_KEYS, name) ? NAVIGATION_KEYS[name] : undefined;
    return !!request && this.editor.navigation?.(request) === true;
  }

  // ---------- content controls ----------

  /** The frames of content controls, drawn again (a render takes them off the pages). */
  private drawControls(): void {
    if (!this.composing) this.controlChrome.draw(!this.mount);
  }

  /** Where a control's content is on the screen: its lines, or its blocks by page. */
  private controlRects(range: ControlRange): Box[] {
    if (range.level !== "inline") {
      const byPage = new Map<Element | null, Box>();
      for (let i = this.blockFrom(range.from); i < this.blocks.length; i++) {
        if ((this.starts[i] as number) >= range.to) break;
        for (const fragment of (this.blocks[i] as WordBlockDesc).fragments) {
          if (!this.host.contains(fragment)) continue;
          const rect = fragment.getBoundingClientRect();
          const page = fragment.closest(".foli-page,.foli-story-flow");
          const known = byPage.get(page);
          const left = Math.min(known?.left ?? rect.left, rect.left);
          const top = Math.min(known?.top ?? rect.top, rect.top);
          byPage.set(
            page,
            boxOf(
              left,
              top,
              Math.max(known?.right ?? rect.right, rect.right) - left,
              Math.max(known?.bottom ?? rect.bottom, rect.bottom) - top,
            ),
          );
        }
      }
      return [...byPage.values()];
    }
    return this.controlContentRects(range);
  }

  /** Where what a control's content shows is on the screen. */
  private controlContentRects(range: ControlRange): Box[] {
    const dom = this.host.ownerDocument.createRange();
    const start = this.domFromPos(range.contentFrom);
    const end = this.domFromPos(range.contentTo);
    dom.setStart(start.node, start.offset);
    dom.setEnd(end.node, end.offset);
    const rects = [...(dom.getClientRects?.() ?? [])].filter((rect) => rect.width > 0);
    if (rects.length) return rects;
    // Nothing in it: a thin box where it is.
    const element =
      start.node.nodeType === Node.ELEMENT_NODE
        ? (start.node as Element)
        : start.node.parentElement;
    const rect = dom.getBoundingClientRect?.();
    const box = rect?.height ? rect : element?.getBoundingClientRect();
    return box ? [boxOf(box.left, box.top, 4, box.height)] : [];
  }

  /**
   * Left and Right stop on each side of a content control's edge, as Word's caret does (browsers
   * cannot see the difference). Alt+Down, which opens a list or date picker, is in `viewKey`.
   */
  private controlKey(name: string): boolean {
    if (name !== "ArrowLeft" && name !== "ArrowRight") return false;
    const { selection, doc } = this.state;
    if (!(selection instanceof TextSelection) || !wordContext(this.state)?.envelope.controls)
      return false;
    const forward = name === "ArrowRight";
    const range = controlAt(doc, selection.from);
    if (!selection.empty) {
      // A placeholder is one thing: the arrows go past it.
      if (
        range?.level !== "inline" ||
        !controlProperties(this.state, range.id)?.placeholder?.showing ||
        selection.from !== range.contentFrom ||
        selection.to !== range.contentTo
      )
        return false;
      this.dispatch(
        this.state.tr.setSelection(TextSelection.create(doc, forward ? range.to : range.from)),
      );
      return true;
    }
    const { $from } = selection;
    const next = forward ? $from.nodeAfter : $from.nodeBefore;
    if (next?.type.name !== "controlStart" && next?.type.name !== "controlEnd") return false;
    this.dispatch(
      this.state.tr.setSelection(TextSelection.create(doc, $from.pos + (forward ? 1 : -1))),
    );
    return true;
  }

  // ---------- fields ----------

  /** The pages as last flowed, as fields need them; null without pages. */
  private fieldLayout(): FieldLayout | null {
    if (!this.regions || !this.facts.length) return null;
    return {
      pages: this.facts.length,
      pageAt: (pos) => {
        const { node } = this.domFromPos(Math.min(pos, this.state.doc.content.size));
        const element =
          node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
        const page = this.facts[this.pages.indexOf(element?.closest(".foli-page") as HTMLElement)];
        if (!page) return null;
        const format = this.sections()[page.section]?.pageNumbers?.format;
        return { number: page.number, sectionPages: page.sectionPages, format };
      },
    };
  }

  /**
   * Updates fields from the pages shown: all of them, or those `options.only` says, of the body or
   * of `editor` (a story's). What that does to the pages is taken in by a second pass over what
   * depends on them, in the same undo step.
   */
  updateFields(options: UpdateFieldsOptions = {}, editor: Editor = this.editor): FieldsReport {
    // A story's view has no pages: the view of the body has.
    const main = this.regions ? null : this.editor.storyView;
    if (main) return main.updateFields(options, editor);
    if (this.composing) this.onCompositionEnd();
    const report = updateFields(editor, { ...options, layout: this.fieldLayout() });
    const { only } = options;
    const range = !!only && typeof only !== "function";
    if (!report.updated || (range && !report.rebuilt)) return report;
    const follows = (field: Field) =>
      range
        ? field.parent?.name === "TOC"
        : PAGE_DEPENDENT.has(field.name) && (typeof only !== "function" || only(field));
    const again = updateFields(editor, {
      ...options,
      layout: this.fieldLayout(),
      only: follows,
      continues: true,
    });
    return { ...report, updated: report.updated + again.updated };
  }

  /**
   * Prints what the document is now: fields updated (one undo step), then the browser's dialog.
   */
  print(): void {
    try {
      this.updateFields();
    } finally {
      this.host.ownerDocument.defaultView?.print();
    }
  }

  /**
   * Left and Right next to a field's markers: the browser's move starts where something can be
   * seen, or the markers (empty elements) cost WebKit a key press each. With codes shown the
   * view makes the move itself, over the whole field; whether it did.
   */
  private skipFieldParts(event: KeyboardEvent): boolean {
    const forward = event.key === "ArrowRight";
    if ((!forward && event.key !== "ArrowLeft") || event.ctrlKey || event.altKey || event.metaKey)
      return false;
    const { selection, doc } = this.state;
    // Shift extends by itself: an extended DOM selection would lose its anchor to the same spot.
    if (!(selection instanceof TextSelection) || event.shiftKey || !selection.empty) return false;
    const stop = caretStop(this.state, selection.head, forward);
    const sel = this.domSelection();
    if (stop === selection.head || !sel) return false;
    if (this.fieldCodes) {
      this.dispatch(this.state.tr.setSelection(TextSelection.create(doc, stop)));
      return true;
    }
    const { node, offset } = this.domFromPos(stop);
    sel.collapse(node, offset);
    return false;
  }

  /** F9 and Alt+F9, as in Word. */
  private fieldKey(name: string): boolean {
    if (name === "Alt-F9") {
      this.run(toggleFieldCodes);
      return true;
    }
    if (name !== "F9") return false;
    if (!this.editable) return true;
    const { selection } = this.state;
    this.updateFields(
      selection instanceof AllSelection ? {} : { only: { from: selection.from, to: selection.to } },
    );
    return true;
  }

  /** Shades what shows the fields the selection is in (not printed): the outermost of each. */
  private showSelectedFields(): void {
    const { selection, doc } = this.state;
    const wanted = new Set<Element>();
    const fields = selection instanceof TextSelection ? fieldsIn(doc) : [];
    const touched = (field: Field) =>
      selection.empty
        ? field.from < selection.from && selection.from < field.to
        : field.from < selection.to && field.to > selection.from;
    for (const field of fields) {
      if (!touched(field) || (field.parent && touched(field.parent))) continue;
      const [from, to] = this.fieldCodes
        ? [field.from, field.codeEnd + 1]
        : [field.resultFrom, field.resultTo];
      const first = Math.max(this.blockFrom(from) - 1, 0);
      for (let i = first; i < this.blocks.length; i++) {
        const start = (this.starts[i] as number) + 1;
        if (start > to) break;
        const desc = this.blocks[i] as WordBlockDesc;
        for (const leaf of desc.leaves) {
          const at = start + leaf.offset;
          if (at + leaf.size <= from || at >= to || !leaf.size) continue;
          if (hiddenIn(leaf.dom, desc.dom)) continue;
          const element = leaf.dom.nodeType === Node.TEXT_NODE ? leaf.dom.parentElement : leaf.dom;
          if (element instanceof Element && element.textContent) wanted.add(element);
        }
      }
    }
    for (const element of this.shadedFields)
      if (!wanted.has(element)) element.removeAttribute(FIELD_SELECTED_ATTR);
    if (wanted.size) injectStyles(this.host);
    for (const element of wanted) element.setAttribute(FIELD_SELECTED_ATTR, "");
    this.shadedFields = [...wanted];
  }

  /** The sections of the document, in order. */
  private sections(): SectionJSON[] {
    const { envelope } = wordContext(this.state) as WordContext;
    return sectionSpans(this.state.doc, envelope.section).map((span) => span.setup);
  }

  /** The page the selection's head is on. */
  private selectionPage(): number {
    const { node } = this.domFromPos(this.state.selection.head);
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    return Math.max(this.pages.indexOf(element?.closest(".foli-page") as HTMLElement), 0);
  }

  /**
   * Opens the header or footer of page `at` (by default the selection's) for editing where it is;
   * made first when the page has none. Whether it is open now.
   */
  openStory(side: StorySide, at = this.selectionPage(), create = true, focus = true): boolean {
    if (!this.regions || !this.editable || this.composing) return false;
    // Word's blank page has none: the next page's.
    let p = at;
    while (this.facts[p] && !this.facts[p]?.sectionPages) p++;
    const page = this.facts[p];
    if (!page) return false;
    const context = wordContext(this.state) as WordContext;
    const setup = this.sections()[page.section] as SectionJSON;
    const even = context.envelope.settings?.evenAndOddHeaders === true;
    const variant = pageVariant(setup, page, even);
    const before = storyOfSection(this.sections(), page.section, side, variant);
    if (this.mount?.id === before?.id && this.mount?.side === side && this.mount?.page === p) {
      if (focus) this.mount?.view.focus();
      return true;
    }
    this.closeStory(false);
    if (!before && (!create || !this.editor.run(ensureStory(side, variant, page.section))))
      return false;
    const found = storyOfSection(this.sections(), page.section, side, variant);
    const editor = found && this.editor.story(found.id);
    const region = this.pageRegions[p]?.[side];
    if (!found || !editor || !region) return false;
    this.mountStory(
      editor,
      { id: found.id, side, variant, section: page.section, page: p, region },
      side === "header" ? "Header" : "Footer",
      undefined,
      focus,
    );
    return true;
  }

  /**
   * Opens note `id`, or the one whose reference is at the selection, in place: shown whole at its
   * reference's page. Whether it is open now.
   */
  openNote(id?: string, focus = true): boolean {
    const { notes } = this;
    if (!notes || !this.editable || this.composing) return false;
    const story = id ?? noteAtSelection(this.state)?.story;
    if (!story) return false;
    if (this.mount?.id === story) {
      if (focus) this.mount.view.focus();
      return true;
    }
    this.closeStory(false);
    const editor = this.editor.story(story);
    if (!editor) return false;
    notes.open = story;
    this.flowed = null;
    this.render();
    const element = this.host.querySelector<HTMLElement>(`[${NOTE_ATTR}="${CSS.escape(story)}"]`);
    const page = this.notePages.get(story);
    if (!element || page === undefined) {
      notes.open = null;
      this.flowed = null;
      this.render();
      return false;
    }
    const region = { element, drawing: {}, section: 0, id: story };
    const texts = () =>
      noteTexts(noteNumbers(this.state.doc, (wordContext(this.state) as WordContext).envelope));
    try {
      this.mountStory(
        editor,
        { id: story, side: "note", variant: "default", section: 0, page, region },
        "Note",
        () => texts().get(story) ?? "",
        focus,
      );
    } catch (error) {
      // Not open after all: the note drawn closed again.
      notes.open = null;
      this.flowed = null;
      this.render();
      throw error;
    }
    editor.select(Selection.atEnd(editor.state.doc).from);
    return true;
  }

  /** From the note being edited back to its reference, the caret after it. */
  private toReference(): boolean {
    const { mount } = this;
    if (mount?.side !== "note") return false;
    const reference = noteNumbers(
      this.state.doc,
      (wordContext(this.state) as WordContext).envelope,
    ).find((n) => n.story === mount.id);
    this.closeStory(false);
    if (reference)
      this.dispatch(
        this.state.tr.setSelection(TextSelection.create(this.state.doc, reference.pos + 1)),
      );
    this.focus();
    return true;
  }

  /** Puts `editor`'s story on its page, in `place`, the body read-only and dimmed around it. */
  private mountStory(
    editor: Editor,
    place: Omit<StoryMount, "wrapper" | "view" | "moved">,
    label: string,
    noteMark?: () => string,
    focus = true,
  ): void {
    const { region } = place;
    injectStyles(this.host);
    this.observer.disconnect();
    this.host.setAttribute("contenteditable", "false");
    this.host.setAttribute("aria-readonly", "true");
    this.host.classList.add("foli-in-story");
    const doc = this.host.ownerDocument;
    const wrapper = doc.createElement("div");
    wrapper.className = "foli-story-mount";
    wrapper.setAttribute("contenteditable", "false");
    wrapper.style.userSelect = "text";
    wrapper.style.setProperty("-webkit-user-select", "text");
    const inner = doc.createElement("div");
    inner.setAttribute("aria-label", label);
    wrapper.append(inner);
    const shown = region.element.querySelector<HTMLElement>(`:scope > .${REGION_CONTENT_CLASS}`);
    if (shown) {
      shown.style.display = "none";
      wrapper.style.paddingBottom = shown.style.paddingBottom;
    }
    region.element.append(wrapper);
    let view: EditorView;
    try {
      view = new EditorView(inner, editor, {
        paged: false,
        upload: this.upload ?? null,
        resource: this.resource ?? null,
        ...(noteMark ? { noteMark } : {}),
      });
    } catch (error) {
      // No story open after all: the body as it was, editable.
      wrapper.remove();
      if (shown) shown.style.display = "";
      this.bodyEditable();
      throw error;
    }
    wrapper.addEventListener("keydown", (event) => {
      if (event.isComposing || view.composing) return;
      // Unless the story's view ran a user's binding of the key.
      if (!event.defaultPrevented && keyName(event) === NOTE_KEY && this.toReference()) {
        // Not on to the body, which would open the note again.
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key !== "Escape") return;
      event.preventDefault();
      this.closeStory(true);
    });
    this.mount = { ...place, wrapper, view, moved: false };
    // With several views of the editor, the one in use answers for its story.
    wrapper.addEventListener("focusin", () => this.claimStories());
    this.claimStories();
    if (focus) view.focus();
    this.drawMatches();
    this.editor.storyChanged();
  }

  /** Finishes a running composition, its text going into the model. */
  endComposition(): void {
    if (this.composing) this.onCompositionEnd();
  }

  /** Leaves the story being edited; `focus`: the body takes the focus, with its selection back. */
  closeStory(focus = true): void {
    const { mount } = this;
    if (!mount) return;
    mount.view.endComposition();
    this.mount = null;
    mount.view.destroy();
    mount.wrapper.remove();
    const shown = mount.region.element.querySelector<HTMLElement>(
      `:scope > .${REGION_CONTENT_CLASS}`,
    );
    if (shown) shown.style.display = "";
    if (mount.side === "note" && this.notes) {
      this.notes.open = null;
      this.flowed = null;
      if (!this.destroyed) this.render();
    }
    this.bodyEditable();
    if (focus && !this.destroyed) this.focus();
    if (!this.destroyed) this.drawMatches();
    this.editor.storyChanged();
  }

  /** The host editable again, its changes read back, as before a story opened. */
  private bodyEditable(): void {
    this.host.classList.remove("foli-in-story");
    this.host.setAttribute("contenteditable", String(this.editable));
    if (this.editable) this.host.removeAttribute("aria-readonly");
    this.observer.takeRecords();
    this.observer.observe(this.host, { childList: true, characterData: true, subtree: true });
  }

  /** The page's own story, after what was open is shown nowhere any more. */
  private reopenStory = (): void => {
    const { mount } = this;
    if (!mount || mount.side === "note" || this.facts.length === 0) return;
    const { side, page, id } = mount;
    // A story that went (undone) is not made again.
    const create = !!wordContext(this.state)?.stories.has(id);
    this.closeStory(false);
    if (!this.openStory(side, Math.min(page, this.facts.length - 1), create)) this.focus();
  };

  /** The margin of a page a mouse event is in, if it is on the page itself. */
  private marginAt(event: MouseEvent): { side: StorySide; page: number } | null {
    const element = event.target as Element | null;
    const page = this.pages.indexOf(element as HTMLElement);
    if (page < 0 || !this.regions) return null;
    const box = (element as Element).getBoundingClientRect();
    const scale = this.scale();
    const style = getComputedStyle(element as Element);
    const y = (event.clientY - box.top) / scale;
    if (y < Number.parseFloat(style.paddingTop)) return { side: "header", page };
    return y > box.height / scale - Number.parseFloat(style.paddingBottom)
      ? { side: "footer", page }
      : null;
  }

  /**
   * A press outside the story being edited leaves it. The second press of a double click in a
   * page's margin opens its header or footer, the body's selection kept: on the press, since the
   * first click may have scrolled the page (Firefox) and the double click would land elsewhere.
   */
  private onPress = (event: MouseEvent): void => {
    this.closeStory(false);
    // A note on the page, or the number of its reference: the second press opens the note.
    const target = event.target instanceof Element ? event.target : null;
    const onNote = target?.closest(`[${NOTE_ATTR}]`);
    const number = target?.closest(`[${NOTE_REF_ATTR}]`);
    const story = onNote?.getAttribute(NOTE_ATTR) ?? number?.getAttribute(NOTE_REF_ATTR);
    if (story && event.button === 0 && !event.shiftKey) {
      const opens = event.detail === 2 && this.editable && isNoteStory(this.state, story);
      if (onNote || opens) event.preventDefault();
      if (opens) {
        if (this.openNote(story) && onNote)
          this.mount?.view.placeCaret(event.clientX, event.clientY);
        return;
      }
      if (onNote) return;
    }
    const margin = event.button === 0 && !event.shiftKey ? this.marginAt(event) : null;
    if (margin && event.detail > 1) {
      event.preventDefault();
      if (event.detail > 2 || !this.editable) return;
      const selection = this.pressSelection;
      this.pressSelection = null;
      if (selection && !selection.eq(this.state.selection))
        this.editor.dispatch(this.state.tr.setSelection(selection));
      if (this.openStory(margin.side, margin.page))
        this.mount?.view.placeCaret(event.clientX, event.clientY);
      return;
    }
    // What the body shows now is what leaving the story comes back to (`selectionchange` comes
    // late, and the browser may select something on the way to the second press).
    if (margin && this.hasFocus()) this.syncSelection();
    this.pressSelection = margin ? this.state.selection : null;
    // On a header or footer a press is not for the body: it places no caret.
    if (margin && this.pageRegions[margin.page]?.[margin.side]) {
      event.preventDefault();
      if (!this.hasFocus()) {
        this.pointerFocus = true;
        this.host.focus({ preventScroll: true });
        this.writeSelection(true);
      }
      return;
    }
    this.onMouseDown(event);
  };

  /** Puts the caret at a point of the window, if it is on this view's content. */
  placeCaret(x: number, y: number): void {
    const pos = this.posAtPoint(x, y);
    if (pos !== null)
      this.editor.dispatch(
        this.state.tr.setSelection(TextSelection.near(this.state.doc.resolve(pos))),
      );
  }

  /** The model position at a point of the window, or null. */
  private posAtPoint(x: number, y: number): number | null {
    const doc = this.host.ownerDocument as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
        options?: { shadowRoots: ShadowRoot[] },
      ) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const root = this.host.getRootNode();
    // Inside a shadow root the engine stops at its host unless it is told of the root.
    const shadow =
      root.nodeType === Node.DOCUMENT_FRAGMENT_NODE
        ? { shadowRoots: [root as ShadowRoot] }
        : undefined;
    const point = doc.caretPositionFromPoint?.(x, y, shadow);
    const range = point ? null : doc.caretRangeFromPoint?.(x, y);
    const node = point?.offsetNode ?? range?.startContainer;
    const offset = point?.offset ?? range?.startOffset ?? 0;
    return node && this.host.contains(node) ? this.posFromDOM(node, offset) : null;
  }

  /**
   * A floating picture reaches into the blocks after its paragraph (their lines go around it):
   * a block that changed (new, drawn again or stale) on a page holding one has the blocks after
   * it on that page and the next measured again. A new block counts on the page of the block
   * before it, where `place` first puts it, and the next (it may have been that page's first);
   * only blocks that changed reach on, not the ones this marks, so an edit re-measures three
   * pages at most.
   */
  private staleAroundFloats(
    doc: ModelNode,
    pagesOf: ReadonlyMap<ModelNode, readonly number[]>,
    redrawn: ReadonlySet<ModelNode>,
  ): void {
    const blocks: { node: ModelNode; pages: readonly number[]; changed: boolean }[] = [];
    let last = 0;
    doc.forEach((node) => {
      const known = pagesOf.get(node);
      const pages = known?.length ? known : [last, last + 1];
      last = known?.length ? (known[known.length - 1] as number) : last;
      blocks.push({ node, pages, changed: !known || redrawn.has(node) || this.stale.has(node) });
    });
    // The pages floats are on now, and were on before (a float deleted or made inline leaves
    // lines that went around it).
    const floatPages = new Set<number>();
    for (const { node, pages } of blocks)
      if (holdsFloat(node)) for (const p of pages) floatPages.add(p);
    for (const [node, pages] of pagesOf)
      if (holdsFloat(node)) for (const p of pages) floatPages.add(p);
    if (!floatPages.size) return;
    let reach = -1;
    for (const { node, pages, changed } of blocks) {
      if ((pages[0] as number) <= reach) this.stale.add(node);
      if (changed && pages.some((p) => floatPages.has(p)))
        reach = Math.max(reach, (pages[pages.length - 1] as number) + 1);
    }
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
   * order) and, on a page with several sections or columns, into its band's column, creating
   * and removing pages as needed, and gives each page the page setup of its first section.
   * Anything else in the host or a page (stray DOM) is removed.
   */
  private place(
    elements: readonly (readonly HTMLElement[])[],
    pages: readonly (readonly number[])[],
    slots: readonly (readonly Slot[])[],
    layout: readonly BlockLayout[],
  ): void {
    const { host } = this;
    const items = elements.flatMap((list, i) =>
      list.map((dom, f) => ({
        dom,
        page: pages[i]?.[f] ?? 0,
        slot: slots[i]?.[f] as Slot,
        section: (layout[i] as BlockLayout).section,
      })),
    );
    // A note can reach pages no text is on.
    const count = Math.max((items[items.length - 1]?.page ?? 0) + 1, this.pageNotes.length);
    const sheets: Sheet[] = [];
    pages.forEach((list, i) => {
      for (const p of list) sheets[p] ??= (layout[i] as BlockLayout).sheet;
    });
    // A page no block is on has the setup of the page after it (Word's blank page before an
    // even or odd page section); the last, one with no blocks yet, of the page before it.
    for (let p = count - 1; p >= 0; p--) if (sheets[p + 1]) sheets[p] ??= sheets[p + 1] as Sheet;
    for (let p = 0; p < count; p++)
      sheets[p] ??=
        sheets[p - 1] ?? (layout[0] as BlockLayout | undefined)?.sheet ?? this.lastSheet();
    this.sheets = sheets.slice(0, count);
    while (this.pages.length < count) this.pages.push(this.createPage());
    this.sheets.forEach((sheet, p) => {
      const page = this.pages[p] as HTMLElement;
      const key = `${sheet.index} ${sheet.css}`;
      if (pageSheets.get(page) !== key) {
        pageSheets.set(page, key);
        pagePads.delete(page);
        page.style.cssText = sheet.css;
        page.setAttribute(SHEET_ATTR, String(sheet.index));
      }
      const { top = "", bottom = "" } = this.pageMargins[p] ?? {};
      const pads = `${top} ${bottom}`;
      if ((pagePads.get(page) ?? " ") !== pads) {
        pagePads.set(page, pads);
        page.style.paddingTop = top;
        page.style.paddingBottom = bottom;
      }
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
      const first = i;
      while (i < items.length && items[i]?.page === p) i++;
      const onPage = items.slice(first, i);
      const { header, footer } = this.pageRegions[p] ?? {};
      const notes = this.pageNotes[p];
      /** What follows the text of a column: its endnotes. */
      const after = (band: number, column: number) => notes?.flow.get(`${band}|${column}`) ?? [];
      /** A page's children: its header, what it holds, its notes, its footer. */
      const framed = (list: readonly HTMLElement[]) => [
        ...(header ? [header.element] : []),
        ...list,
        ...(notes?.foot ?? []),
        ...(footer ? [footer.element] : []),
      ];
      for (const { dom, slot } of onPage) {
        const position = slot.mark ? "absolute" : "";
        if (dom.style.position !== position) dom.style.position = position;
      }
      // One section in one column: the blocks are the page's children.
      const last = onPage[onPage.length - 1];
      if (!last || (!last.slot.band && last.section.columns.widths.length === 1)) {
        fillElement(
          page,
          framed([...onPage.map((item) => item.dom), ...after(0, 0)]),
          this.viewRemoved,
        );
        this.bands.delete(page);
        continue;
      }
      const known = this.bands.get(page) ?? [];
      const bands: typeof known = [];
      for (const { section, slot } of onPage) {
        if (bands[slot.band]) continue;
        const key = columnsKey(section.columns);
        const reused = known[slot.band];
        bands[slot.band] =
          reused?.key === key
            ? reused
            : { key, ...bandElement(host.ownerDocument, section.columns) };
      }
      this.bands.set(page, bands);
      fillElement(page, framed(bands.map((b) => b.band)), this.viewRemoved);
      bands.forEach((band, b) => {
        const inBand = onPage.filter((item) => item.slot.band === b);
        const lead = inBand[0]?.slot.lead;
        const margin = lead ? `${lead}px` : "";
        if (band.band.style.marginTop !== margin) band.band.style.marginTop = margin;
        band.columns.forEach((column, c) => {
          fillElement(
            column,
            [
              ...inBand.filter((item) => item.slot.column === c).map((item) => item.dom),
              ...after(b, c),
            ],
            this.viewRemoved,
          );
        });
      });
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
    page.className = this.paged ? "foli-page" : "foli-story-flow";
    return page;
  }

  /** The last section's page setup (the envelope's), for an empty document. */
  private lastSheet(): Sheet {
    return sheetOf(this.editor.settings, 0);
  }

  /** The print rules for the document's page setups, written when they change. */
  private applyPrintStyles(layout: readonly BlockLayout[]): void {
    if (!this.paged) return;
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
      style.textContent = viewPrintStyles(this.editor.settings, sheets, this.id);
      parent.append(style);
      return style;
    });
  }

  /** Forgets every measurement: the next flow measures the whole document again. */
  private invalidateLayout(): void {
    this.measures = new WeakMap();
    this.flowed = null;
    this.regionsFor = null;
    if (this.regions) this.regions.cache = new WeakMap();
    if (this.notes) this.notes.cache = new WeakMap();
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
      scale ??= this.scale();
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
      if (this.composing || this.mount?.view.composing) {
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
   * Whether `node` holds blocks rather than content: the host, a page, a band or column of one,
   * or a table's wrapper, table, rows and cells.
   */
  private holdsBlocks(node: Node): boolean {
    if (node === this.host || this.pages.includes(node as HTMLElement)) return true;
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const element = node as Element;
    return (
      element.classList.contains(BAND_CLASS) ||
      element.classList.contains(COLUMN_CLASS) ||
      (element.hasAttribute(FRAME_ATTR) && !element.closest(`[${REPEATED_ATTR}]`))
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
        f === 0 || !(this.blocks[i] as BlockDesc).node.isTextblock
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
    const sel = this.domSelection();
    if (!sel?.anchorNode || !sel.focusNode) return null;
    if (this.mount?.wrapper.contains(sel.anchorNode)) return null;
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
      (node.isBlock || node.type.name === "picture") &&
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

  /** The span of the picture a node selection selects, if it selects one. */
  private pictureSpan(pos: number): HTMLElement | null {
    for (const img of this.host.querySelectorAll(`[${PICTURE_ATTR}]`)) {
      const span = img.parentElement;
      // A floating picture's place in the text is its anchor.
      if (span && this.posFromDOM(FLOAT_ANCHORS.get(span) ?? span, 0) === pos) return span;
    }
    return null;
  }

  /** Marks the selected picture and gives it a resize handle (when the document is editable). */
  private showSelectedPicture(): void {
    const { selection } = this.state;
    const span =
      selection instanceof NodeSelection && selection.node.type.name === "picture"
        ? this.pictureSpan(selection.from)
        : null;
    const handled = !!span?.querySelector("[data-foli-resize]");
    if (span === this.selectedPicture && (!span || handled === this.editable)) return;
    this.selectedPicture?.removeAttribute(PICTURE_SELECTED_ATTR);
    this.selectedPicture?.querySelector("[data-foli-resize]")?.remove();
    this.selectedPicture = span;
    if (!span) return;
    injectStyles(this.host);
    span.setAttribute(PICTURE_SELECTED_ATTR, "");
    if (!this.editable) return;
    const handle = this.host.ownerDocument.createElement("span");
    handle.setAttribute("data-foli-resize", "");
    handle.setAttribute("aria-hidden", "true");
    span.append(handle);
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
    this.showSelectedPicture();
    this.showSelectedFields();
    this.drawControls();
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
    if (dom.anchor === shown.anchor && dom.head === shown.head) return true;
    // Field markers take no room, and a control's edge is one place to the browser: the DOM
    // cannot tell their two sides apart.
    const { doc } = this.state;
    const texts = shown instanceof TextSelection && dom instanceof TextSelection;
    const same = (a: number, b: number) =>
      controlSpot(doc, a, b) ||
      (texts && doc.resolve(a).parent.inlineContent && sameSpot(doc, a, b));
    return same(dom.anchor, shown.anchor) && same(dom.head, shown.head);
  }

  /**
   * The selection the host's text is in. In a shadow root the document's is retargeted to the
   * shadow host: the root's own where the engine has one (Chromium). Firefox's document
   * selection reaches inside.
   * shortcut: WebKit has neither; `getComposedRanges` would give the range there, not the
   * selection's direction or `modify`: editing in a shadow root is not supported in WebKit.
   */
  private domSelection(): ReturnType<Document["getSelection"]> {
    const root = this.host.getRootNode() as Partial<Pick<Document, "getSelection">>;
    return root !== this.host.ownerDocument && typeof root.getSelection === "function"
      ? root.getSelection()
      : this.host.ownerDocument.getSelection();
  }

  private hasFocus(): boolean {
    // A shadow root's own: the document's is the shadow host.
    const root = this.host.getRootNode() as Partial<Pick<Document, "activeElement">>;
    const active = root.activeElement ?? this.host.ownerDocument.activeElement;
    return (
      (active === this.host || this.host.contains(active)) && !this.mount?.wrapper.contains(active)
    );
  }

  /** Writes the model selection to the DOM unless the DOM already shows it (keeps native affinity). */
  private writeSelection(force: boolean): void {
    if (this.composing || !this.hasFocus()) return;
    const sel = this.domSelection();
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
   * apply. In comment-only mode (core's `commentOnly()`) document changes go to the editor, whose
   * filter keeps only comment changes (undo and redo of them). Code can always change the
   * document through the editor.
   */
  private dispatch(tr: Transaction): boolean {
    const marksAdded = tr.storedMarks !== null && tr.storedMarks !== this.state.storedMarks;
    const commenting = !this.editable && !this.mount && !marksAdded && isCommentOnly(this.state);
    if ((!this.editable || this.mount) && (tr.docChanged || marksAdded) && !commenting)
      return false;
    this.editor.dispatch(tr);
    return true;
  }

  /**
   * Whether the event's target range holds nothing but the boundary between the caret's block
   * and the one before or after it (no text in between): a one-character delete at a caret.
   */
  private boundaryOnly(event: InputEvent, forward: boolean): boolean {
    const range = event.getTargetRanges?.()[0];
    const { selection, doc } = this.state;
    if (!range || range.collapsed || !selection.empty) return false;
    const from = this.posFromDOM(range.startContainer, range.startOffset);
    const to = this.posFromDOM(range.endContainer, range.endOffset);
    if (from === null || to === null || from >= to) return false;
    // Backward: the boundary before the caret; forward: the one after it.
    if (selection.head !== (forward ? from : to)) return false;
    const $from = doc.resolve(from);
    const $to = doc.resolve(to);
    return (
      $from.parent.isTextblock &&
      $to.parent.isTextblock &&
      $from.parent !== $to.parent &&
      $from.parentOffset === $from.parent.content.size &&
      $to.parentOffset === 0 &&
      doc.textBetween(from, to) === ""
    );
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

  /** The `beforeinput` types already warned about (`onBeforeInput`). */
  private readonly unhandledInput = new Set<string>();

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
      // macOS's Ctrl+Y: what Ctrl+K cut, as text.
      case "insertFromYank":
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
      case "formatIndent":
      case "formatOutdent":
        this.run(changeIndent(type === "formatIndent" ? 1 : -1));
        return;
    }
    if (!type.startsWith("delete")) {
      // The browser's own editing would change the DOM, which is never the truth: said, once.
      if (!ELSEWHERE_INPUT.has(type) && !this.unhandledInput.has(type)) {
        this.unhandledInput.add(type);
        console.warn(`Foli: the browser's "${type}" input is not supported; nothing was changed.`);
      }
      return;
    }
    if (type === "deleteByDrag") return;
    // Android keyboards send Backspace at a paragraph's start as a delete of the boundary
    // before it (a target range from the paragraph before's end to the caret): that is the key
    // at a caret, so a numbered paragraph loses its number rather than joining the one before.
    const char = type === "deleteContentBackward" || type === "deleteContentForward";
    if (!(char && this.boundaryOnly(event, type === "deleteContentForward")))
      this.selectTargetRange(event);
    if (this.state.selection.empty && type.includes("Line")) {
      // No target range: let the browser find the line edge, never delete a character instead.
      // shortcut: hard-line deletes also stop at the visual line edge here; Chromium, Firefox and WebKit all give a range.
      const sel = this.domSelection();
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

  /**
   * Runs the first command bound to `name` that applies, through the view's dispatch; the view's
   * own keys where core's `viewKeys` plugin stands (after the user's plugins, before the
   * built-in keymaps).
   */
  private runKey(name: string): boolean {
    return this.state.plugins.some((plugin) => {
      if (plugin.key === viewKeys) return this.viewKey(name);
      const command = plugin.spec.keymap?.[name];
      return command ? this.run(command) : false;
    });
  }

  /**
   * The view's own overridable keys (ADR-0008, `docs/keyboard.md`): they need the pages, the
   * stories or the app's navigation UI, so they are not core commands. A user keymap binding the
   * same name runs first.
   */
  private viewKey(name: string): boolean {
    return (
      this.documentEdgeKey(name) ||
      this.fieldKey(name) ||
      (name === "Alt-ArrowDown" && this.controlChrome.open()) ||
      this.noteKey(name) ||
      this.navigationKey(name)
    );
  }

  // ---------- column borders (10.7c) ----------

  /** A column border being dragged: its table and column, the column's width, the press, the guide. */
  private drag: {
    table: ModelNode;
    column: number;
    width: number;
    startX: number;
    perTwip: number;
    guide: HTMLElement;
  } | null = null;
  /** Whether this view set the host's cursor (an embedder's own cursor is left alone). */
  private resizeCursor = false;

  /**
   * The column border of a top-level table near the pointer (within 4 px): an edge of the cell
   * under it (a grid line through a merged cell is no border), or the table's right edge from
   * outside; as the grid column left of it, with the table's px per twip. None in read-only
   * mode, during a composition, or while tracking (column widths do not change then).
   */
  private columnBorder(
    event: MouseEvent,
  ): { table: ModelNode; column: number; perTwip: number; rect: DOMRect; width: number } | null {
    if (!this.editable || this.composing || trackState(this.state)?.on) return null;
    const target = event.target as Element | null;
    const wrapper = target?.closest?.(`[${FRAME_ATTR}="table"]`);
    const element = wrapper?.querySelector(`:scope > table[${FRAME_ATTR}]`);
    if (!wrapper || !element || !this.host.contains(wrapper)) return null;
    let table: ModelNode | undefined;
    for (const [node, frame] of this.frames)
      if (frame.wrappers.includes(wrapper as HTMLElement)) table = node;
    // As drawn: an autofit table's measured columns, else its grid.
    const grid =
      (table && this.measures.get(table)?.table?.columns) ??
      (table?.attrs.grid as number[] | undefined) ??
      [];
    const total = grid.reduce((a, b) => a + b, 0);
    if (!table || !total) return null;
    const rect = element.getBoundingClientRect();
    const perTwip = rect.width / total;
    const edges: number[] = [];
    let x = rect.left;
    for (const width of grid) {
      x += width * perTwip;
      edges.push(x);
    }
    const near = (column: number) => Math.abs(event.clientX - (edges[column] as number)) <= 4;
    // The grid lines that are borders here: the cell's own edges, the table's right edge from
    // outside it, any line on the table's own border area (none in a row's empty places).
    const cell = target?.closest("td");
    let columns: number[];
    if (cell && element.contains(cell)) {
      const box = cell.getBoundingClientRect();
      const at = (line: number) => edges.findIndex((edge) => Math.abs(edge - line) <= 3);
      columns = [at(box.left), at(box.right)].filter((c) => c >= 0);
    } else if (target === element) columns = grid.map((_w, i) => i);
    else if (element.contains(target)) columns = [];
    else columns = [grid.length - 1];
    const column = columns.find(near);
    return column === undefined
      ? null
      : { table, column, perTwip, rect, width: grid[column] as number };
  }

  /** The pointer over a column border shows that it can be dragged. */
  private onMouseMove = (event: MouseEvent): void => {
    if (this.drag) return;
    if (event.buttons === 0) this.controlChrome.hover(event.target);
    const near = event.buttons === 0 && this.columnBorder(event) !== null;
    if (near === this.resizeCursor) return;
    this.resizeCursor = near;
    this.host.style.cursor = near ? "col-resize" : "";
  };

  /**
   * A press on a column border (no Shift: Shift-click extends the selection) starts dragging it:
   * a guide line follows the pointer and the release moves the border by as much as the pointer
   * moved (`setColumnWidth`); a press without a move changes nothing; Escape, the button let go
   * elsewhere or the window losing the focus cancel.
   */
  private startColumnDrag(event: MouseEvent): boolean {
    this.endDrag();
    if (event.shiftKey) return false;
    const border = this.columnBorder(event);
    if (!border) return false;
    // No caret or text selection from this press. Focus taken by it keeps the selection the
    // model has (the press places none).
    event.preventDefault();
    if (!this.hasFocus()) {
      this.host.focus({ preventScroll: true });
      this.writeSelection(true);
    }
    const doc = this.host.ownerDocument;
    const guide = doc.createElement("div");
    guide.setAttribute("aria-hidden", "true");
    Object.assign(guide.style, {
      position: "fixed",
      top: `${border.rect.top}px`,
      height: `${border.rect.height}px`,
      left: `${event.clientX}px`,
      width: "0",
      borderLeft: "1px dashed GrayText",
      pointerEvents: "none",
      zIndex: "2147483647",
    });
    doc.body.append(guide);
    this.drag = { ...border, startX: event.clientX, guide };
    doc.addEventListener("mousemove", this.onDragMove);
    doc.addEventListener("mouseup", this.onDragEnd);
    doc.addEventListener("keydown", this.onDragKey, true);
    doc.defaultView?.addEventListener("blur", this.onDragBlur);
    return true;
  }

  private onDragMove = (event: MouseEvent): void => {
    if (!this.drag) return;
    // The button let go where no mouseup reached the page (another window, a menu): cancelled.
    if ((event.buttons & 1) === 0) this.endDrag();
    else this.drag.guide.style.left = `${event.clientX}px`;
  };

  private onDragEnd = (event: MouseEvent): void => {
    const drag = this.endDrag();
    if (!drag) return;
    const moved = event.clientX - drag.startX;
    // A click on a border (no real move) is no resize.
    if (Math.abs(moved) < 2) return;
    // The table's position: a top-level block's.
    let pos = -1;
    this.state.doc.forEach((node, offset) => {
      if (node === drag.table) pos = offset;
    });
    if (pos >= 0) this.run(setColumnWidth(pos, drag.column, drag.width + moved / drag.perTwip));
  };

  private onDragKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.endDrag();
  };

  private onDragBlur = (): void => {
    this.endDrag();
  };

  /** Ends a drag (its guide and listeners gone) and returns it. */
  private endDrag(): NonNullable<EditorView["drag"]> | null {
    const { drag } = this;
    if (!drag) return null;
    this.drag = null;
    drag.guide.remove();
    const doc = this.host.ownerDocument;
    doc.removeEventListener("mousemove", this.onDragMove);
    doc.removeEventListener("mouseup", this.onDragEnd);
    doc.removeEventListener("keydown", this.onDragKey, true);
    doc.defaultView?.removeEventListener("blur", this.onDragBlur);
    if (this.resizeCursor) {
      this.resizeCursor = false;
      this.host.style.cursor = "";
    }
    return drag;
  }

  // ---------- pictures (10.8d) ----------

  /**
   * A press on a picture selects it (a node selection); on the selected picture's handle it
   * starts a resize that keeps its aspect ratio (`setPictureSize` on release, Escape cancels).
   */
  private pictureMouseDown(event: MouseEvent): boolean {
    this.endResize();
    if (event.shiftKey || this.composing) return false;
    const target = event.target as Element | null;
    const span = target?.closest?.(`[${PICTURE_ATTR}], [data-foli-resize]`)?.parentElement ?? null;
    if (!span || !this.host.contains(span)) return false;
    const pos = this.posFromDOM(FLOAT_ANCHORS.get(span) ?? span, 0);
    if (pos === null) return false;
    event.preventDefault();
    if (!this.hasFocus()) this.host.focus({ preventScroll: true });
    if (!(this.state.selection instanceof NodeSelection && this.state.selection.from === pos))
      this.dispatch(this.state.tr.setSelection(NodeSelection.create(this.state.doc, pos)));
    // Already selected: written again (the focus may have put a caret in the host).
    else this.writeSelection(true);
    const img = span.querySelector(`[${PICTURE_ATTR}]`) as HTMLElement | null;
    if (!img || !target?.closest("[data-foli-resize]") || !this.editable) return true;
    // Its unrotated box (a rotated picture's rect is the rotated one's bounds).
    const turned = img.style.transform;
    img.style.transform = "";
    const rect = img.getBoundingClientRect();
    img.style.transform = turned;
    const width = Number.parseFloat(img.style.width) || rect.width;
    const scale = rect.width / width || 1;
    this.resize = {
      pointer:
        "pointerId" in event && (event as PointerEvent).pointerType !== "mouse"
          ? (event as PointerEvent).pointerId
          : "mouse",
      pos,
      img,
      width: rect.width,
      height: rect.height,
      scale,
      // No wider than the page's text (layout px).
      max: Math.max(this.textWidthEmu() / EMU_PER_PX, MIN_PICTURE),
      x: event.clientX,
      y: event.clientY,
      style: img.getAttribute("style") ?? "",
    };
    const doc = this.host.ownerDocument;
    // Pointer events (19.5c): a mouse, a pen and a finger move the handle alike.
    doc.addEventListener("pointermove", this.onResizeMove);
    doc.addEventListener("pointerup", this.onResizeEnd);
    doc.addEventListener("pointercancel", this.onResizeCancel);
    doc.addEventListener("contextmenu", this.onResizeMenu, true);
    doc.addEventListener("keydown", this.onResizeKey, true);
    doc.defaultView?.addEventListener("blur", this.onResizeCancel);
    return true;
  }

  /** A long press while resizing brings no menu (it would cancel the touch). */
  private onResizeMenu = (event: Event): void => {
    event.preventDefault();
  };

  /** When a touch or pen last pressed the resize handle (its emulated mouse events follow). */
  private touchedResize = Number.NEGATIVE_INFINITY;

  /**
   * A touch or pen on a selected picture's resize handle starts a resize, as a mouse does (the
   * page does not scroll under it: `touch-action: none`); the mouse events the browser emulates
   * afterwards are then not a second press.
   */
  private onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" || !event.isPrimary || event.button !== 0) return;
    const target = event.target as Element | null;
    if (!target?.closest?.("[data-foli-resize]")) return;
    this.touchedResize = event.timeStamp;
    if (this.pictureMouseDown(event)) event.preventDefault();
  };

  /** The size (layout px) a resize gives at the pointer: the larger move, the ratio kept. */
  private resizedTo(event: MouseEvent): { width: number; height: number } {
    const r = this.resize as NonNullable<EditorView["resize"]>;
    const ratio = r.height / r.width;
    const dx = event.clientX - r.x;
    const dy = (event.clientY - r.y) / ratio;
    const width = Math.min(
      Math.max((r.width + (Math.abs(dx) > Math.abs(dy) ? dx : dy)) / r.scale, MIN_PICTURE),
      r.max,
    );
    return { width, height: width * ratio };
  }

  /** Whether `event` is the resizing pointer's (another finger, or a mouse beside a pen, is not). */
  private resizing(event: PointerEvent): boolean {
    const pointer = this.resize?.pointer;
    if (pointer === undefined) return false;
    return pointer === "mouse" ? event.pointerType === "mouse" : event.pointerId === pointer;
  }

  private onResizeMove = (event: PointerEvent): void => {
    if (!this.resize || !this.resizing(event)) return;
    if ((event.buttons & 1) === 0) {
      this.onResizeCancel();
      return;
    }
    const { width, height } = this.resizedTo(event);
    this.resize.img.style.width = `${width}px`;
    this.resize.img.style.height = `${height}px`;
  };

  private onResizeEnd = (event: PointerEvent): void => {
    if (!this.resize || !this.resizing(event)) return;
    const { width, height } = this.resizedTo(event);
    const r = this.endResize();
    if (!r) return;
    // No real move: nothing changes (a jiggle drawn while moving goes back).
    const moved = Math.abs(event.clientX - r.x) >= 2 || Math.abs(event.clientY - r.y) >= 2;
    const applied =
      moved &&
      this.run(
        setPictureSize(r.pos, Math.round(width * EMU_PER_PX), Math.round(height * EMU_PER_PX)),
      );
    // Not applied (no move, tracking, the picture gone): as it was.
    if (!applied) r.img.setAttribute("style", r.style);
  };

  private onResizeKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.onResizeCancel();
  };

  private onResizeCancel = (event?: Event): void => {
    // Another pointer's cancel (a second finger's pan) is not this resize's.
    if (event && "pointerId" in event && !this.resizing(event as PointerEvent)) return;
    const r = this.endResize();
    if (r) r.img.setAttribute("style", r.style);
  };

  /** Ends a resize (its listeners gone) and returns it. */
  private endResize(): NonNullable<EditorView["resize"]> | null {
    const r = this.resize;
    if (!r) return null;
    this.resize = null;
    const doc = this.host.ownerDocument;
    doc.removeEventListener("pointermove", this.onResizeMove);
    doc.removeEventListener("pointerup", this.onResizeEnd);
    doc.removeEventListener("pointercancel", this.onResizeCancel);
    doc.removeEventListener("contextmenu", this.onResizeMenu, true);
    doc.removeEventListener("keydown", this.onResizeKey, true);
    doc.defaultView?.removeEventListener("blur", this.onResizeCancel);
    return r;
  }

  private textWidthEmu(): number {
    return textWidthEmu(this.state);
  }

  /** Image files in a transfer (paste or drop), when the app takes uploads. */
  private imageFiles(data: DataTransfer | null): File[] {
    if (!this.upload || !this.editable || !data) return [];
    // A clipboard object from code may have no files.
    return [...(data.files ?? [])].filter((file) => file.type.startsWith("image/"));
  }

  /** Whether a drag carries files (from outside the page). */
  private static carriesFiles = (event: DragEvent) =>
    [...(event.dataTransfer?.types ?? [])].includes("Files");

  private onDragOver = (event: DragEvent): void => {
    if (!EditorView.carriesFiles(event)) {
      if (EditorView.carriesText(event)) this.dragTextOver(event);
      return;
    }
    // Files dropped here never open in the page (unsaved work would be lost).
    event.preventDefault();
    const images = [...(event.dataTransfer?.items ?? [])].some((i) => i.type.startsWith("image/"));
    if (event.dataTransfer)
      event.dataTransfer.dropEffect = images && this.upload && this.editable ? "copy" : "none";
  };

  private onDrop = (event: DragEvent): void => {
    if (!EditorView.carriesFiles(event)) {
      if (EditorView.carriesText(event)) this.dropText(event);
      return;
    }
    event.preventDefault();
    const files = this.imageFiles(event.dataTransfer);
    if (!files.length || this.composing) return;
    // The place the files were dropped.
    const pos = this.posAtPoint(event.clientX, event.clientY);
    if (pos !== null)
      this.dispatch(this.state.tr.setSelection(TextSelection.near(this.state.doc.resolve(pos))));
    void this.insertFiles(files);
  };

  /**
   * Inserts image files where the selection is now, one picture each, in order: each measured
   * first (one the browser cannot show is skipped, not uploaded), then given to the `upload`
   * option, then inserted at its natural size (96 px per inch) no wider than the page's text,
   * where the selection was, however the document changed meanwhile (after a composition that
   * runs then). A file whose upload fails is skipped (reported on the console). Resolves to
   * the number inserted (none without `upload`); never rejects.
   */
  async insertFiles(files: readonly File[]): Promise<number> {
    const upload = this.upload;
    if (!upload || !this.editable) return 0;
    // The insertion point, mapped through every change until the pictures go in.
    let at = this.state.selection.from;
    const replace = !this.state.selection.empty;
    // Another document (`setDocument` notifies with no transaction): the files are not for it.
    let lost = false;
    let mapped = this.state.doc;
    // The user's own selection while a picture goes in, mapped, to give back after it.
    let user: Selection | null = null;
    const unsubscribe = this.editor.subscribe((state, transactions) => {
      for (const tr of transactions) {
        at = tr.mapping.map(at);
        if (user) user = user.map(tr.doc, tr.mapping);
      }
      if (!transactions.length && state.doc !== mapped) lost = true;
      mapped = state.doc;
    });
    let inserted = 0;
    try {
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        const size = await measureImageFile(file, this.host.ownerDocument);
        if (this.destroyed) return inserted;
        if (!size) continue;
        let answer: Awaited<ReturnType<NonNullable<EditorViewOptions["upload"]>>>;
        try {
          answer = await upload(file);
        } catch (error) {
          console.warn(`Foli: the upload of ${file.name} failed`, error);
          continue;
        }
        const { src, alt, decorative } =
          typeof answer === "string" ? { src: answer } : (answer ?? { src: "" });
        if (typeof src !== "string" || !src) continue;
        // The browser owns the DOM during a composition: the picture goes in after it.
        while (this.composing && !this.destroyed) await new Promise((r) => setTimeout(r, 50));
        if (this.destroyed || !this.editable || lost) return inserted;
        const scale = Math.min(1, this.textWidthEmu() / (size.width * EMU_PER_PX));
        // A `data:` URL says its own type (an app may have converted the file).
        const type = /^data:([^;,]+)/i.exec(src)?.[1]?.toLowerCase() ?? file.type;
        const picture = {
          contentType: type,
          ...(src.startsWith("data:") ? { data: src } : { url: src }),
          width: Math.max(1, Math.round(size.width * EMU_PER_PX * scale)),
          height: Math.max(1, Math.round(size.height * EMU_PER_PX * scale)),
          ...(typeof alt === "string" && alt.trim() ? { alt } : {}),
          ...(decorative === true ? { decorative } : {}),
        };
        const { doc, selection } = this.state;
        const pos = Math.min(at, doc.content.size);
        // The first picture replaces what was selected at the paste (still selected there).
        const here = replace && inserted === 0 && selection.from === pos;
        // A caret the user moved elsewhere meanwhile stays there.
        const elsewhere = !here && !(selection.empty && selection.from === pos);
        user = elsewhere ? selection : null;
        if (!here) this.dispatch(this.state.tr.setSelection(TextSelection.near(doc.resolve(pos))));
        if (this.run(insertPicture(picture, { requireAlt: false }))) inserted++;
        if (user) this.dispatch(this.state.tr.setSelection(user));
        user = null;
      }
      return inserted;
    } finally {
      unsubscribe();
    }
  }

  /**
   * Triple-click selects the clicked block's content. Chromium and WebKit natively extend the
   * selection to the start of the next block, so typing over it would merge the two blocks.
   */
  /**
   * A selection made with the pointer while the format painter is armed gets the copied
   * formatting, once the browser's selection has reached the state (after this event).
   */
  private onPaint = (event: MouseEvent): void => {
    if (event.button !== 0 || !this.editable || !formatPainterState(this.state).armed) return;
    setTimeout(() => {
      const armed = formatPainterState(this.state).armed;
      if (this.destroyed || !armed) return;
      this.syncSelection();
      this.run(pasteFormat);
      // Dropped (comment-only, a locked control): the painter is put away all the same.
      if (armed === "once" && formatPainterState(this.state).armed) this.run(stopFormatPainter);
    });
  };

  private onMouseDown = (event: MouseEvent): void => {
    this.pointerFocus = !this.hasFocus();
    // Focus from a mousedown happens in its default action, before this timer. A mousedown that
    // focuses nothing (prevented, middle button) must not skip the next keyboard focus.
    if (this.pointerFocus) setTimeout(() => (this.pointerFocus = false));
    if (event.button !== 0) return;
    if (this.startColumnDrag(event)) return;
    // The mouse events a touch on the resize handle brings after it: already handled.
    const target = event.target as Element | null;
    if (event.timeStamp - this.touchedResize < 1000 && target?.closest?.("[data-foli-resize]"))
      return;
    if (this.pictureMouseDown(event)) return;
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
    // Word's blank page before an even or odd page section holds nothing: the caret goes to the
    // section after it (the browser would put it at the document's start).
    const blank = event.target as HTMLElement;
    if (!event.shiftKey && this.pages.includes(blank) && !blank.firstChild) {
      const pos = this.posFromDOM(blank, 0);
      if (pos !== null) {
        event.preventDefault();
        if (!this.hasFocus()) this.host.focus({ preventScroll: true });
        this.dispatch(this.state.tr.setSelection(Selection.near(this.state.doc.resolve(pos))));
        this.writeSelection(true);
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
   * mode); Ctrl+click (Cmd+click on Apple platforms) opens it in a new tab, without `opener`,
   * and goes to the bookmark a link to one names (a table of contents' entry, a cross-reference).
   */
  private onClick = (event: MouseEvent): void => {
    const target = event.target;
    if (event.type === "click" && !event.shiftKey && this.controlChrome.click(event)) return;
    const element = target instanceof Element ? target.closest("a") : null;
    if (!element && event.type === "click" && (IS_MAC ? event.metaKey : event.ctrlKey)) {
      const name = target instanceof Node ? this.bookmarkLinked(target) : null;
      if (name !== null) {
        event.preventDefault();
        // By name, capitals not counting, as Word finds a bookmark; its hidden ones too (`_Toc…`).
        const found = listBookmarks(this.editor, { hidden: true }).find(
          (b) => b.name.toLowerCase() === name.toLowerCase(),
        );
        if (found) this.reveal(found, { focus: true });
      }
      return;
    }
    if (!element || !this.host.contains(element)) return;
    event.preventDefault();
    if (event.type !== "click" || !(IS_MAC ? event.metaKey : event.ctrlKey)) return;
    const href = this.linkHref(element);
    if (href) this.host.ownerDocument.defaultView?.open(href, "_blank", "noopener,noreferrer");
  };

  /**
   * The bookmark `node` links to, read from the model: a link to a bookmark (`w:anchor`), a
   * `HYPERLINK \l` field's result, a `REF`, `PAGEREF` or `NOTEREF` field's with `\h`.
   */
  private bookmarkLinked(node: Node): string | null {
    if (!this.host.contains(node)) return null;
    const pos = this.posFromDOM(node, 0);
    if (pos === null) return null;
    const $pos = this.state.doc.resolve(pos);
    const anchor = this.state.schema.marks.link?.isInSet(
      $pos.parent.maybeChild($pos.index())?.marks ?? [],
    )?.attrs.anchor;
    if (typeof anchor === "string" && anchor) return anchor;
    // The innermost field around it: a table of contents' entry is a HYPERLINK inside the TOC.
    let found: string | null = null;
    let size = Number.POSITIVE_INFINITY;
    for (const field of fieldsIn(this.state.doc)) {
      if (pos < field.resultFrom || pos > field.resultTo || field.to - field.from >= size) continue;
      const { args, switches } = parseFieldInstruction(field.instruction);
      const name =
        field.name === "HYPERLINK"
          ? switches.get("l")?.[0]
          : ["REF", "PAGEREF", "NOTEREF"].includes(field.name) && switches.has("h")
            ? args[0]
            : undefined;
      if (name === undefined) continue;
      found = name;
      size = field.to - field.from;
    }
    return found;
  }

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
    // The host itself focused while a story is open (Shift+Tab): it is read-only, and its selection
    // is what leaving the story comes back to.
    if (this.mount) {
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeStory(true);
      }
      return;
    }
    if (event.isComposing || this.composing) return;
    this.syncSelection();
    if (this.crossFragmentEdge(event) || this.crossListNumber(event)) {
      event.preventDefault();
      return;
    }
    if (this.skipFieldParts(event)) {
      event.preventDefault();
      return;
    }
    const name = keyName(event);
    if (this.controlKey(name)) {
      event.preventDefault();
      return;
    }
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

  /** Word's keys for notes, and Shift+Alt+N from a reference to its note. */
  private noteKey(name: string): boolean {
    if (name === NOTE_KEY) return this.openNote();
    const kind = name === "Mod-Alt-f" ? "footnote" : name === "Mod-Alt-d" ? "endnote" : null;
    if (!kind || !this.editable || !this.notes) return false;
    return this.run(insertNote(kind)) && this.openNote();
  }

  /**
   * Ctrl+Home and Ctrl+End (with Shift, extending) on pages with headers and footers: the browser
   * stops at the first or last place before what it cannot edit, so the model says where.
   */
  private documentEdgeKey(name: string): boolean {
    const shift = name.startsWith("Mod-Shift-");
    const key = name.replace("Mod-Shift-", "Mod-");
    if ((key !== "Mod-Home" && key !== "Mod-End") || !this.editable) return false;
    if (!this.pageRegions.some((page) => page.header || page.footer)) return false;
    const { doc, selection } = this.state;
    const edge = key === "Mod-Home" ? Selection.atStart(doc) : Selection.atEnd(doc);
    const next = shift ? TextSelection.between(selection.$anchor, edge.$head) : edge;
    this.dispatch(this.state.tr.setSelection(next).setStoredMarks(null));
    return true;
  }

  /**
   * Whether the caret is on the first (`dir` -1) or last (1) line of its textblock, in the
   * block's first or last fragment (a block split across pages has several).
   */
  private caretOnEdgeLine(dir: -1 | 1, focusOnly = false): boolean {
    const sel = this.domSelection();
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
    const sel = this.domSelection();
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
    this.claimStories();
    const pointer = this.pointerFocus;
    this.pointerFocus = false;
    if (pointer || this.mount) return;
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
    this.pending.push(...records.filter((r) => !handleOnly(r) && !inNodeView(r)));
    if (!this.composing && this.pending.length) this.flush();
  };

  /** Reads back every DOM change recorded so far. */
  private flush(): void {
    const records = [
      ...this.pending,
      ...this.observer.takeRecords().filter((r) => !handleOnly(r) && !inNodeView(r)),
    ];
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

    const sel = this.domSelection();
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
    const strays = new Set<Node>();
    const collect = (parent: Node) => {
      for (const child of parent.childNodes) {
        if (this.owner.has(child)) continue;
        // Drawn, not document content (a repeated header row): no text of the model.
        if ((child as Element).getAttribute?.("contenteditable") === "false") continue;
        if (this.holdsBlocks(child)) collect(child);
        // Text outside every block (an element the browser added): a block the model does not
        // have. An empty stray node (an extension's marker) holds none; the re-render removes it.
        else if (child.textContent) strays.add(child);
      }
    };
    collect(this.host);
    // A block the browser split off one of ours (Enter on a keyboard that sends no
    // `beforeinput`): the element right after it, read as the next block. Any other stray
    // element is a block the model does not have.
    const splitOff = new Map<Node, Node[]>();
    for (const node of strays) {
      let before = node.previousSibling;
      const chain = [node];
      while (before && strays.has(before)) {
        chain.unshift(before);
        before = before.previousSibling;
      }
      const desc = before ? this.owner.get(before) : undefined;
      if (!before || !desc || splitOff.has(before)) continue;
      // After the block's last fragment only (a fragment's tail is not the paragraph's), and
      // holding exactly what the block lost (an element an extension or a translator put
      // there holds text of its own: still discarded).
      const shown = desc.fragments.filter((fragment) => this.host.contains(fragment));
      if (shown[shown.length - 1] !== before) continue;
      const kept = shown.map((fragment) => this.textIn(fragment, hardBreaks)).join("");
      const moved = chain.map((part) => this.textIn(part, hardBreaks)).join("");
      if (kept + moved === textOfBlock(desc.node)) splitOff.set(before, chain);
    }
    const placed = new Set([...splitOff.values()].flat());
    if ([...strays].some((node) => !placed.has(node))) {
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
      // What the browser split off its last fragment, as blocks of their own.
      for (const node of splitOff.get(shown[shown.length - 1] as Node) ?? []) {
        domText += BLOCK_SEPARATOR;
        walk(node);
      }
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
    // One transaction: the command runs on a state with the changed range selected.
    const range = TextSelection.create(doc, posAt(start), posAt(end));
    if (inserted.includes(BLOCK_SEPARATOR) && !inserted.includes(HARD_BREAK)) {
      // A paragraph split the browser made without `beforeinput` (some Android keyboards): its
      // text and Enter, replayed on the model (Enter as the key does it: a list item splits).
      this.replaySplit(range, inserted.split(BLOCK_SEPARATOR));
      return;
    }
    if (inserted.includes(HARD_BREAK)) {
      // shortcut: a change that adds line breaks cannot be read back yet; it is dropped.
      console.warn("Foli: discarded a DOM change that adds blocks or line breaks");
      this.rerender();
      return;
    }
    const selected = this.state.apply(this.state.tr.setSelection(range));
    const command = inserted ? insertText(inserted) : deleteSelection;
    // A filtered or read-only transaction renders nothing: still drop the browser's DOM.
    let applied = false;
    command(selected, (tr) => {
      applied = this.dispatch(tr);
    });
    if (!applied || this.dirty.size) this.rerender();
  }

  /** The document text DOM `node` shows, as `readBack` reads it (hard breaks one character). */
  private textIn(node: Node, hardBreaks: ReadonlySet<Node>): string {
    if (node.nodeType === Node.TEXT_NODE) return (node as Text).data;
    if (hardBreaks.has(node)) return HARD_BREAK;
    if ((node as Element).getAttribute?.("contenteditable") === "false") return "";
    return [...node.childNodes].map((child) => this.textIn(child, hardBreaks)).join("");
  }

  /**
   * Replays a split read back from the DOM: `parts[0]` in place of `range`, then for each next
   * part Enter and its text. The browser's DOM is then drawn again from the model.
   */
  private replaySplit(range: TextSelection, parts: readonly string[]): void {
    const was = this.state.doc;
    this.dispatch(this.state.tr.setSelection(range));
    parts.forEach((part, i) => {
      if (i > 0 && !this.runKey("Enter")) this.run(splitBlock);
      if (part) this.run(insertText(part));
      else if (i === 0 && !range.empty) this.run(deleteSelection);
    });
    if (this.state.doc === was)
      console.warn("Foli: a paragraph split from the keyboard was refused");
    this.rerender();
  }

  /** Rebuilds every block that is not reused and puts the selection back. */
  private rerender(): void {
    this.render();
    this.writeSelection(true);
  }

  // ---------- clipboard ----------

  /**
   * A copied picture's image as another document can show and save it: its own `data:` or web
   * URL, else the image this view shows, as a `data:` URL (read from the drawn image when it is
   * an object URL: its bytes live in this page only). Nothing lasting known (an image not loaded
   * yet): as it is, and the paste brings the picture without its image.
   */
  private portableResource(context: WordContext) {
    const shown = imageSource(context.envelope.resources, this.resource ?? undefined);
    return (key: string, resource: ResourceJSON): ResourceJSON => {
      if (resource.data !== undefined || /^https?:/i.test(resource.url ?? "")) return resource;
      const url = shown(key);
      if (url?.startsWith("data:image/")) return { contentType: resource.contentType, data: url };
      // A cropped picture's image is inside its box (`PICTURE_IMAGE_ATTR`).
      const img = [
        ...this.host.querySelectorAll(`img[${PICTURE_ATTR}], img[${PICTURE_IMAGE_ATTR}]`),
      ].find(
        (element) =>
          (element.getAttribute(PICTURE_ATTR) ?? element.getAttribute(PICTURE_IMAGE_ATTR)) === key,
      ) as HTMLImageElement | undefined;
      if (img?.complete && img.naturalWidth > 0) {
        try {
          const canvas = this.host.ownerDocument.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext("2d")?.drawImage(img, 0, 0);
          // PNG: the browser's encoding, the same pixels (JPEG's own bytes cannot be read here).
          return { contentType: "image/png", data: canvas.toDataURL("image/png") };
        } catch {} // a cross-origin image taints the canvas: keep what is known
      }
      // An image the page shows over the web lasts; an object URL does not (the paste then comes
      // without its image).
      return url && /^https?:/i.test(url) ? { contentType: resource.contentType, url } : resource;
    };
  }

  /** Copy writes the model's content (plain text, HTML, Foli JSON), never the browser's DOM. */
  private onCopy = (event: ClipboardEvent): void => {
    this.syncSelection();
    if (this.state.selection.empty || !event.clipboardData) return;
    event.preventDefault();
    this.writeSelectionData(event.clipboardData);
  };

  /** The selection as a copy gives it (plain text, HTML, Foli JSON), into `data`. */
  private writeSelectionData(data: DataTransfer): void {
    const { selection, doc } = this.state;
    const context = wordContext(this.state) as WordContext;
    // Selected cells are copied as a table of their own (ADR-0006).
    const table = selection instanceof CellSelection ? cellsAsTable(selection) : null;
    const source = table ? doc.type.create(null, table) : doc;
    const { text, html, json } = serializeRange(
      source,
      table ? 0 : selection.from,
      table ? source.content.size : selection.to,
      this.host.ownerDocument,
      { context, ratio: this.lineRatio, portable: this.portableResource(context) },
    );
    data.setData("text/plain", table ? cellsText(table) : text);
    data.setData("text/html", html);
    data.setData(FOLI_MIME, json);
  }

  /** The text being dragged from this view (19.6): its range, while the drag lasts. */
  private dragged: { from: number; to: number; doc: ModelNode; selection: Selection } | null = null;

  /**
   * Dragging the selection (the browser starts it on selected text): the drag carries what a
   * copy would. Selected cells are not dragged (their table cannot be cut from the grid).
   */
  private onDragStart = (event: DragEvent): void => {
    this.syncSelection();
    const { selection, doc } = this.state;
    // Selected cells are not dragged (their table cannot be cut from the grid).
    if (selection instanceof CellSelection) {
      event.preventDefault();
      return;
    }
    // Not the selected text (a link or an image the browser drags): the browser's own drag.
    const range = this.domSelection();
    const target = event.target as Node | null;
    const fromSelection =
      !!target &&
      !!range?.rangeCount &&
      !range.isCollapsed &&
      range.getRangeAt(0).intersectsNode(target);
    if (!event.dataTransfer || selection.empty || !fromSelection) return;
    this.writeSelectionData(event.dataTransfer);
    event.dataTransfer.effectAllowed = this.editable ? "copyMove" : "copy";
    this.dragged = { from: selection.from, to: selection.to, doc, selection };
  };

  /** A drag of this view's text that ended without a drop here: its selection back. */
  private onTextDragEnd = (): void => {
    const dragged = this.dragged;
    this.dragged = null;
    if (dragged && this.state.doc === dragged.doc && !this.state.selection.eq(dragged.selection))
      this.dispatch(this.state.tr.setSelection(dragged.selection));
  };

  /** Whether a drop copies rather than moves: Ctrl (Windows, Linux) or Option (Apple), as Word. */
  private static copies(event: DragEvent): boolean {
    return IS_MAC ? event.altKey : event.ctrlKey;
  }

  /** What a drag over the document carries that a drop takes: text, HTML or Foli's own. */
  private static carriesText(event: DragEvent): boolean {
    const types = [...(event.dataTransfer?.types ?? [])];
    return types.some((t) => t === "text/plain" || t === "text/html" || t === FOLI_MIME);
  }

  /** Where a drop of text would go: the caret shown there, the drop's effect said. */
  private dragTextOver(event: DragEvent): void {
    event.preventDefault();
    const data = event.dataTransfer;
    // Nothing goes into the body while a header, footer or note is open on its page.
    const pos = this.editable && !this.mount ? this.posAtPoint(event.clientX, event.clientY) : null;
    if (data)
      data.dropEffect =
        pos === null ? "none" : this.dragged && !EditorView.copies(event) ? "move" : "copy";
    // The drop caret: the selection at the pointer (the dragged range is kept apart).
    if (pos !== null && !this.composing && this.state.selection.head !== pos)
      this.dispatch(this.state.tr.setSelection(TextSelection.near(this.state.doc.resolve(pos))));
  }

  /**
   * A drop of text: pasted where it lands (as a paste is: Foli's own content, else HTML, else
   * plain text). Text dragged from here moves unless Ctrl or Option is held: pasted, then
   * deleted where it was, one undo step (tracked as an insertion and a deletion while
   * tracking). A drop inside the dragged text changes nothing.
   */
  private dropText(event: DragEvent): void {
    event.preventDefault();
    const dragged = this.dragged;
    const data = event.dataTransfer;
    const pos =
      data && this.editable && !this.mount && !this.composing
        ? this.posAtPoint(event.clientX, event.clientY)
        : null;
    // Refused here: `dragend` puts the dragged selection back.
    if (pos === null) return;
    this.dragged = null;
    const move = !!dragged && dragged.doc === this.state.doc && !EditorView.copies(event);
    if (move && pos >= dragged.from && pos <= dragged.to) {
      this.dispatch(this.state.tr.setSelection(dragged.selection));
      return;
    }
    this.dispatch(this.state.tr.setSelection(TextSelection.near(this.state.doc.resolve(pos))));
    if (!move) {
      this.paste(data as DataTransfer);
      return;
    }
    // The dragged range, followed through the paste's transactions.
    let { from, to } = dragged;
    const before = this.state.doc;
    const unsubscribe = this.editor.subscribe((_state, transactions) => {
      for (const tr of transactions) {
        from = tr.mapping.map(from, 1);
        to = tr.mapping.map(to, -1);
      }
    });
    try {
      this.paste(data as DataTransfer, false);
    } finally {
      unsubscribe();
    }
    // Deleted only once it is where it was dropped: a target that refused it (a locked control,
    // a change that could not be tracked) leaves the text where it was.
    if (this.state.doc === before) {
      this.dispatch(
        this.state.tr.setSelection(dragged.selection.map(this.state.doc, this.state.tr.mapping)),
      );
      return;
    }
    if (to <= from) return;
    // What was pasted stays selected, the place it left emptied: one undo step with the paste.
    const { selection } = this.state;
    const tr = this.state.tr.delete(from, to).setMeta(joinHistory, true);
    tr.setSelection(selection.map(tr.doc, tr.mapping));
    this.dispatch(tr);
  }

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
    // An image alone (a screenshot, an image copied from a page): a picture.
    const files = plain ? [] : this.imageFiles(data);
    if (files.length && !data.getData(FOLI_MIME) && !data.getData("text/plain").trim()) {
      void this.insertFiles(files);
      return;
    }
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
    // A text control takes the text alone.
    const plainText = data.getData("text/plain");
    if (plainText && this.run(insertControlText(plainText))) return true;
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
    // A rule is an empty paragraph with a border: content, and a block of its own.
    const rule = (node: ModelNode | null | undefined) =>
      !!node?.isTextblock && !node.content.size && !!node.attrs.borders;
    if (!pasted || (only?.isTextblock && !only.content.size && !rule(only))) return false;
    const { doc, open, envelope, notes } = pasted;
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
        if (
          doc.firstChild?.isLeaf ||
          doc.lastChild?.isLeaf ||
          rule(doc.firstChild) ||
          rule(doc.lastChild)
        ) {
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
        for (const { id, story } of notes ?? []) tr.step(new StoryStep(id, null, story));
      } catch (error) {
        if (error instanceof TransformError) continue;
        throw error;
      }
      return this.dispatch(tr.setMeta(closeHistory, true));
    }
    return false;
  }

  private onSelectionChange = (): void => {
    if (!this.composing && !this.mount && this.hasFocus()) this.syncSelection();
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

/**
 * A block's measurement: border-box height across its fragments (layout px), margins, lines.
 * @internal
 */
export interface Measure {
  height: number;
  marginTop: number;
  marginBottom: number;
  /** Vertical padding and border, which every fragment of a split block repeats. */
  box: number;
  lines?: Lines;
  /** At the widths of columns it may land in, when a section's columns differ. */
  widths?: Map<number, WidthMeasure>;
  /** A table's rows and blocks. */
  table?: TableMeasure;
}

/** A block measured at a width other than where it is. */
interface WidthMeasure {
  height: number;
  lines(): readonly number[];
  all(): Lines;
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
    table: { rows, tops, columns: drawnColumns(frame, wrapper, scale) },
  };
}

/**
 * Where a table may break across pages (from its top, sorted): after each row, and inside a row
 * at its cells' line ends, unless the row may not split (`cantSplit`, unless taller than a
 * page), is part of a vertical merge or holds a nested table (shortcut: those split only
 * between rows; a nested table stays whole within its row).
 * @internal
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
 * @internal
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
 * taller than a page, or one with a break in it), page and column breaks ending their line's
 * page or column, and a page break before the next block ending this one's page.
 */
function wordBox(
  words: readonly WordInfo[],
  i: number,
  desc: WordBlockDesc,
  measure: Measure,
  lines: () => Lines,
  layout: BlockLayout,
  atWidth: (desc: BlockDesc, width: number, kept: boolean) => WidthMeasure,
  adds: boolean,
  noteOf: (story: string) => FlowNote | null,
): BlockBox {
  const pageHeight = contentHeight(layout.sheet.settings);
  const { section } = layout;
  // Without pages nothing is kept off the next one, and a page break ends nothing.
  const paged = layout.sheet.css !== UNPAGED_CSS;
  const next = words[i + 1] ? { word: words[i + 1] as WordInfo } : undefined;
  const { before, after } = spacing(words[i - 1], desc.word, next?.word, adds);
  const leavesWith = (attr: string) =>
    desc.leaves.filter(
      (leaf) => leaf.dom.nodeType !== Node.TEXT_NODE && (leaf.dom as Element).hasAttribute(attr),
    );
  const pageBreaks = leavesWith(PAGE_BREAK_ATTR);
  const columnBreaks = leavesWith(WORD_COLUMN_BREAK_ATTR);
  const hasBreak = pageBreaks.length + columnBreaks.length > 0;
  const keep = desc.word.keepLines && !hasBreak;
  const kept = keep && measure.height <= pageHeight;
  const bottoms = () => (kept ? [measure.height] : lines().bottoms);
  /** The block as it is in `column`, when the columns' widths differ. */
  const inColumn = (column: number) =>
    atWidth(desc, section.columns.widths[column] as number, keep);
  // The line holding a break, among the column's lines: the last starting at or before it.
  const linesOf = (leaves: readonly LeafDesc[], column = 0) => {
    if (!leaves.length) return [];
    const { starts } = section.unequal ? inColumn(column).all() : lines();
    return leaves.map((leaf) => {
      let line = starts.length - 1;
      while (line > 0 && (starts[line] as number) > leaf.offset) line--;
      return line;
    });
  };
  const references = referencesIn(desc.node);
  const notes = references.flatMap((ref) => {
    const note = noteOf(ref.story);
    return note ? [{ note, offset: ref.offset - 1 }] : [];
  });
  return {
    notes: notes.length
      ? (column) => {
          if (kept) return notes.map(({ note }) => ({ line: 0, note }));
          const { starts } = section.unequal ? inColumn(column).all() : lines();
          return notes.map(({ note, offset }) => {
            let line = starts.length - 1;
            while (line > 0 && (starts[line] as number) > offset) line--;
            return { line, note };
          });
        }
      : undefined,
    height: measure.height,
    marginTop: before,
    marginBottom: after,
    keepWithNext: desc.word.keepNext,
    // A node view's parts are not lines, and `w:widowControl="0"` turns it off: any line.
    anyLine: !!desc.parts || desc.word.widowControl === false,
    pageHeight,
    section: section.flow,
    sectionMark: !!desc.node.attrs.section && desc.word.empty,
    inColumn: section.unequal ? inColumn : undefined,
    lines: bottoms,
    columnBreaksAfter: (column) => linesOf(columnBreaks, column),
    breaksAfter: (column = 0) => {
      if (!paged) return [];
      const breaks = linesOf(pageBreaks, column);
      if (next?.word.pageBreakBefore)
        breaks.push((section.unequal ? inColumn(column).lines() : bottoms()).length - 1);
      return breaks;
    },
  };
}

/** The footnotes a table refers to, each on the break at or after its reference's line. */
function tableNotes(
  frame: Frame,
  measure: Measure,
  blocks: readonly WordBlockDesc[],
  lines: (desc: BlockDesc) => Lines,
  breaks: () => number[],
  noteOf: (story: string) => FlowNote | null,
): BlockBox["notes"] {
  const t = measure.table as TableMeasure;
  const found: { note: FlowNote; unit: number; offset: number }[] = [];
  for (let unit = frame.first; unit < frame.end; unit++)
    for (const ref of referencesIn((blocks[unit] as WordBlockDesc).node)) {
      const note = noteOf(ref.story);
      if (note && t.tops.get(unit) != null) found.push({ note, unit, offset: ref.offset - 1 });
    }
  if (!found.length) return undefined;
  return () => {
    const list = breaks();
    return found.map(({ note, unit, offset }) => {
      const { starts, bottoms } = lines(blocks[unit] as WordBlockDesc);
      let k = starts.length - 1;
      while (k > 0 && (starts[k] as number) > offset) k--;
      const y = (t.tops.get(unit) as number) + (bottoms[k] as number);
      const line = list.findIndex((b) => b >= y - 0.5);
      return { line: line < 0 ? list.length - 1 : line, note };
    });
  };
}

/**
 * Writes Word's space above each v3 block, as the flow worked it out, as its top margin. Written
 * only when it changes.
 */
function applyGaps(firsts: readonly HTMLElement[], spaces: readonly number[]): void {
  firsts.forEach((dom, i) => {
    const gap = spaces[i] ?? 0;
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

/** @internal */
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
        // A raised number says nothing about where its line is.
        if (br.hasAttribute(NOTE_NUMBER_ATTR)) continue;
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
    const parts = (desc as WordBlockDesc).parts;
    if (!items.length && parts && desc.fragments.length === 1) {
      // A node view drawn whole: it may break after each of its root's children.
      for (const bottom of parts()) {
        starts.push(0);
        bottoms.push(bottom / scale);
      }
      base += box.height;
      continue;
    }
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
function scrollRectIntoView(from: HTMLElement, rect: Pick<DOMRect, "top" | "bottom">): void {
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

const SCROLL_OPTIONS = { capture: true, passive: true };
/** Room kept above what is scrolled to for find, in px. */
const REVEAL_ABOVE = 200;

/** Word's keys for finding and going places. */
const NAVIGATION_KEYS: Readonly<Record<string, NavigationRequest>> = {
  "Mod-f": "find",
  "Mod-h": "replace",
  "Mod-g": "goTo",
  F3: "next",
  "Shift-F3": "previous",
  "Mod-Shift-F5": "bookmarks",
};

/** Shift+Alt+N (Shift+Option+N): from a note's reference to the note, and back. */
const NOTE_KEY = "Alt-Shift-n";

/** Whether story `id` of `state`'s document exists (a number can outlive its note on screen). */
const isNoteStory = (state: EditorState, id: string) => !!wordContext(state)?.stories.has(id);

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

/** `beforeinput` types the view's paste and drop handlers carry out. */
const ELSEWHERE_INPUT = new Set([
  "insertFromPaste",
  "insertFromPasteAsQuotation",
  "insertFromDrop",
]);

const COMPOSITION_INPUT = new Set([
  "insertCompositionText",
  "deleteCompositionText",
  "insertFromComposition",
]);

const IS_MAC = typeof navigator !== "undefined" && /Mac|iP(hone|[oa]d)/.test(navigator.platform);

/** What a US keyboard types on these keys, without and with Shift. */
const US_PUNCTUATION: Readonly<Record<string, readonly [string, string]>> = {
  Equal: ["=", "+"],
  Period: [".", ">"],
  Comma: [",", "<"],
};

/**
 * Normalizes a key event to a keymap name: modifiers in the order `Mod-Ctrl-Meta-Alt-Shift-`,
 * then the key (single characters lower-cased). `Mod` is Cmd on Apple platforms, Ctrl elsewhere.
 */
export function keyName(event: KeyboardEvent): string {
  let key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const mod = IS_MAC ? event.metaKey : event.ctrlKey;
  // Non-Latin layouts: Ctrl+B still means "b" (use the physical key when the character is not a-z);
  // with Shift, Ctrl+Shift+7 still means "7" (the character is "&" or "/" depending on layout).
  // Option on macOS types a character (Option+N is a dead key): Alt+N still means "n". But AltGr
  // (Ctrl+Alt on Windows) typing a character is that character: "[" is AltGr+F on a Hungarian
  // layout, and must not be read as Ctrl+Alt+F (a footnote).
  // (macOS has no AltGr: some browsers report Option as AltGraph, and Option is handled above.)
  // shortcut: Ctrl+Alt giving any other character counts as AltGr (not all browsers report its
  // state), so Ctrl+Alt+F on a non-Latin layout is not Mod-Alt-f; drop the guess if they all do.
  const altGraph =
    !IS_MAC &&
    (event.getModifierState?.("AltGraph") ||
      (event.ctrlKey && event.altKey && key.length === 1 && !/^[a-z0-9]$/i.test(key)));
  if (
    (mod || event.altKey) &&
    !altGraph &&
    !/^[a-z0-9]$/.test(key) &&
    /^(Key[A-Z]|Digit[0-9])$/.test(event.code)
  )
    key = event.code.slice(-1).toLowerCase();
  // Word's keys on =, period and comma (superscript, subscript, grow and shrink the font): named
  // by the key's place, as a US keyboard types it, whatever the layout types there.
  else if (mod && !altGraph && event.code in US_PUNCTUATION)
    key = (US_PUNCTUATION[event.code] as readonly [string, string])[event.shiftKey ? 1 : 0];
  let name = key;
  if (event.shiftKey && key !== "Shift") name = `Shift-${name}`;
  if (event.altKey) name = `Alt-${name}`;
  if (IS_MAC ? event.ctrlKey : event.metaKey) name = `${IS_MAC ? "Ctrl" : "Meta"}-${name}`;
  if (mod) name = `Mod-${name}`;
  return name;
}

/**
 * The text width of a document's (last) section in EMU (635 per twip; Word's Letter page and
 * margins where it does not say): the widest a picture is inserted or resized.
 * shortcut: the last section's, not the caret's section or table cell; use the caret's when
 * documents mix page sizes.
 */
export function textWidthEmu(state: EditorState): number {
  const section = wordContext(state)?.envelope.section;
  return (
    ((section?.pageSize?.width ?? 12_240) -
      (section?.margins?.left ?? 1440) -
      (section?.margins?.right ?? 1440)) *
    635
  );
}

/** A file's image's natural size (CSS px) from a local object URL, before any upload. */
export async function measureImageFile(
  file: File,
  doc: Document,
): Promise<{ width: number; height: number } | null> {
  if (typeof URL.createObjectURL !== "function") return null;
  const url = URL.createObjectURL(file);
  try {
    return await naturalSize(url, doc);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** An image's natural size (CSS px), or null when it does not load. */
async function naturalSize(
  src: string,
  doc: Document,
): Promise<{ width: number; height: number } | null> {
  const img = doc.createElement("img");
  // Load events, not decode(): WebKit rejects decode() for an image outside the document.
  const loaded = new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
  });
  img.src = src;
  if (!(await loaded)) return null;
  return img.naturalWidth && img.naturalHeight
    ? { width: img.naturalWidth, height: img.naturalHeight }
    : null;
}

/** Whether a block holds a floating picture (cached per node: nodes do not change). */
const floats = new WeakMap<ModelNode, boolean>();
function holdsFloat(node: ModelNode): boolean {
  let found = floats.get(node);
  if (found === undefined) {
    found = false;
    node.descendants((child) => {
      if (child.type.name === "picture" && child.attrs.float) found = true;
      return !found;
    });
    floats.set(node, found);
  }
  return found;
}

/**
 * A change a node view made to its own drawing (content loaded later, a chart drawn): not input,
 * never read back. Inside a custom node's box, which is not editable.
 */
function inNodeView(record: MutationRecord): boolean {
  const { target } = record;
  const element = target.nodeType === 1 ? (target as Element) : target.parentElement;
  return !!element?.closest('[data-foli-custom][contenteditable="false"]');
}

/** A change that only adds or removes the view's own marks (a resize handle, a control's frame). */
function handleOnly(record: MutationRecord): boolean {
  const nodes = [...record.addedNodes, ...record.removedNodes];
  return (
    record.type === "childList" &&
    nodes.length > 0 &&
    nodes.every(
      (n) =>
        n.nodeType === 1 &&
        ((n as Element).hasAttribute("data-foli-resize") ||
          (n as Element).hasAttribute(CONTROL_UI_ATTR)),
    )
  );
}
