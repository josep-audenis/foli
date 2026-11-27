/**
 * A schema v3 document on pages, as Word lays it out (8.6b, read-only): each section's page
 * size and margins, the blocks of `blocks.ts` measured in the page's width and flowed with
 * Word's spacing, keep rules, widow and orphan control and explicit breaks. Editing moves to
 * v3 in 8.7.
 */

import {
  type Extension,
  type FieldLayout,
  type FoliDocument,
  noteNumbers,
  noteProperties,
  noteTexts,
  parseContent,
  type ResourceJSON,
  type ReviewView,
  type SectionJSON,
} from "@folijs/core";
import { Resolver } from "@folijs/core/internal";
import { customDrawing } from "../extension.js";
import {
  type BlockBox,
  type FlowNote,
  type FlowSection,
  type Fragment,
  flowFrom,
  notePieces,
  pagesOf,
  spaceAfterText,
} from "../layout/flow.js";
import { printStyles, SHEET_ATTR } from "../print.js";
import {
  type BlockOptions,
  NOTE_REF_ATTR,
  PICTURE_ATTR,
  PX_PER_TWIP,
  renderBlocks,
  WORD_COLUMN_BREAK_ATTR,
  WORD_PAGE_BREAK_ATTR,
  type WordBlock,
} from "./blocks.js";
import { bandElement, type ColumnsPx, columnsPx } from "./columns.js";
import { pageBordersElement, pageColor } from "./decoration.js";
import { lineBottoms, type NoteGroup, PageNotes } from "./notes.js";
import { PageRegions } from "./regions.js";

export type { ReviewView } from "./blocks.js";

/** The class of each page element. */
export const WORD_PAGE_CLASS = "foli-word-page";
/** The breaks that keep a paragraph from being one line to the flow. */
const BREAKS = `br[${WORD_PAGE_BREAK_ATTR}],br[${WORD_COLUMN_BREAK_ATTR}]`;

export interface DocumentPages {
  /** The page elements, in order. */
  readonly pages: readonly HTMLElement[];
  /** The page (0-based) where the top-level node at `index` starts; undefined if not shown. */
  pageOf(index: number): number | undefined;
  /**
   * The line on its page (1-based, counting every line of the blocks above it on the page)
   * where the top-level node at `index` starts, as Word numbers lines; undefined if not shown.
   */
  lineOf(index: number): number | undefined;
  /**
   * Every paragraph in table cells, in document order (nested tables' included; none for a cell
   * a vertical merge covers, as Word lists none), with the page (0-based) it starts on.
   */
  cellParagraphs(): { page: number; text: string }[];
  /**
   * Where body positions are on these pages, for `updateFields` (`PAGE`, `NUMPAGES`, `PAGEREF`,
   * a table of contents' page numbers).
   * shortcut: a position's page is the one its top-level block starts on (a bookmark in a paragraph or table carried to the next page gets the page it starts on); use the lines when a document needs it.
   */
  readonly fieldLayout: FieldLayout;
  /**
   * Print rules for these pages, as the editor's: one sheet of its section's size per page (named
   * pages where sections differ), no gaps. For a web page holding these pages only (`@page`
   * applies to the whole web page).
   */
  printStyles(): string;
  /** Removes the pages. */
  destroy(): void;
}

/** Which `renderDocument` call drew a page: its print rules are scoped to it. */
const OUTPUT_ATTR = "data-foli-output";
let outputs = 0;

/** Word's defaults for what a section leaves out: Letter, 1 inch margins. */
const PAGE_DEFAULTS = { width: 12240, height: 15840, margin: 1440 };

interface Geometry {
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function geometry(section: SectionJSON): Geometry {
  const m = section.margins ?? {};
  // A negative top or bottom margin is measured the same way in Word (text may overlap headers).
  return {
    width: (section.pageSize?.width ?? PAGE_DEFAULTS.width) * PX_PER_TWIP,
    height: (section.pageSize?.height ?? PAGE_DEFAULTS.height) * PX_PER_TWIP,
    top: Math.abs(m.top ?? PAGE_DEFAULTS.margin) * PX_PER_TWIP,
    right: (m.right ?? PAGE_DEFAULTS.margin) * PX_PER_TWIP,
    bottom: Math.abs(m.bottom ?? PAGE_DEFAULTS.margin) * PX_PER_TWIP,
    left: ((m.left ?? PAGE_DEFAULTS.margin) + (m.gutter ?? 0)) * PX_PER_TWIP,
  };
}

const sameGeometry = (a: Geometry, b: Geometry) =>
  a.width === b.width &&
  a.height === b.height &&
  a.top === b.top &&
  a.bottom === b.bottom &&
  a.left === b.left &&
  a.right === b.right;

/** An empty page: the page box with its margins as padding, and its content box. */
function createPage(doc: Document, g: Geometry): { page: HTMLElement; body: HTMLElement } {
  const page = doc.createElement("div");
  page.className = WORD_PAGE_CLASS;
  // The document as written: a page translator leaves it (and a print of it) alone.
  page.setAttribute("translate", "no");
  const { style } = page;
  style.boxSizing = "border-box";
  style.position = "relative";
  // The stacking context pictures behind text are drawn in (over the page's background).
  style.isolation = "isolate";
  style.width = `${g.width}px`;
  style.height = `${g.height}px`;
  style.padding = `${g.top}px ${g.right}px ${g.bottom}px ${g.left}px`;
  style.background = "#fff";
  style.color = "#000";
  style.overflow = "hidden";
  const body = doc.createElement("div");
  body.style.display = "flow-root";
  page.append(body);
  return { page, body };
}

/**
 * The ratio of a font's normal line height to its size, measured: a line of 100 px text with
 * `line-height: normal` (the font's own ascent, descent and gap, as Word's single spacing).
 * @internal
 */
export function measureLineRatio(container: HTMLElement): (family: string) => number {
  return (family) => {
    const probe = container.ownerDocument.createElement("div");
    const { style } = probe;
    style.position = "absolute";
    style.visibility = "hidden";
    style.fontFamily = family;
    style.fontSize = "100px";
    style.lineHeight = "normal";
    style.whiteSpace = "nowrap";
    probe.textContent = "x";
    container.append(probe);
    const height = probe.getBoundingClientRect().height;
    probe.remove();
    return height > 0 ? height / 100 : 1.2;
  };
}

/**
 * A table block's line ends without those inside a row that may not split (`cantSplit`), unless
 * the row is taller than a page.
 */
function keepRows(element: HTMLElement, bottoms: number[], pageHeight: number): number[] {
  const rows = element.querySelectorAll(":scope > table > tbody > tr[data-foli-cant-split]");
  if (!rows.length) return bottoms;
  const top = element.getBoundingClientRect().top;
  const kept = [...rows]
    .map((row) => {
      const box = row.getBoundingClientRect();
      return [box.top - top, box.bottom - top] as const;
    })
    .filter(([from, to]) => to - from <= pageHeight);
  return bottoms.filter((y) => !kept.some(([from, to]) => y > from + 0.5 && y < to - 0.5));
}

/**
 * The height of a table's leading header rows (repeated on each page it continues on), or 0.
 * @internal
 */
export function headerHeight(element: HTMLElement): number {
  let bottom = 0;
  // The table's own rows: not those of a table nested in a cell.
  for (const row of element.querySelectorAll(":scope > table > tbody > tr")) {
    if (!(row as HTMLElement).dataset || !("foliHeader" in (row as HTMLElement).dataset))
      return bottom ? bottom - element.getBoundingClientRect().top : 0;
    bottom = row.getBoundingClientRect().bottom;
  }
  // Word repeats header rows only while some body row follows them (as `tableFrame`).
  return 0;
}

/** The lines that end with one of the explicit breaks `attr` marks, by the break's position. */
function breakLines(element: HTMLElement, bottoms: readonly number[], attr: string): number[] {
  const top = element.getBoundingClientRect().top;
  return [...element.querySelectorAll(`br[${attr}]`)].map((br) => {
    const y = br.getBoundingClientRect().top - top;
    const line = bottoms.findIndex((bottom) => y < bottom);
    return line < 0 ? bottoms.length - 1 : line;
  });
}

/** A section on pages: its setup, its blocks and where they are measured. */
interface Section {
  setup: SectionJSON;
  geometry: Geometry;
  columns: ColumnsPx;
  blocks: WordBlock[];
  flow: FlowSection;
  /** A hidden page of the section's, and in it a column holding its blocks. */
  measuring: HTMLElement;
  column: HTMLElement;
}

/** `renderDocument`'s options. */
export interface RenderDocumentOptions {
  /** `markup` (the default): insertions underlined, deletions struck through; `simple`, `final`: as if accepted. */
  review?: ReviewView;
  /** Fields show their codes instead of their results (Word's Alt+F9). */
  fieldCodes?: boolean;
  /**
   * The URL to show a picture's image from (`key` in `resources`): the app's (a package part's
   * object URL…); `null` (or "") shows the picture's box. Left out, or undefined for a key: the
   * resource's own image `data:` URL or web URL (fetched as it is shown).
   */
  resource?: (key: string, resource: ResourceJSON) => string | null | undefined;
  /**
   * The editor's extensions: custom nodes and marks drawn by their node and mark views (19.3),
   * else as their `.docx` text. Give the same array the document was read with.
   */
  extensions?: readonly Extension[];
}

/**
 * Lays a v3 document out on pages inside `container`: every section's page setup, its columns
 * (a band per section on a page), continuous sections, Word's blank pages, headers and footers
 * with their page fields, footnotes at their columns' feet and endnotes after the text.
 */
export function renderDocument(
  document: FoliDocument,
  container: HTMLElement,
  given: RenderDocumentOptions = {},
): DocumentPages {
  const { extensions, ...rest } = given;
  const options = { ...rest, custom: customDrawing(extensions) };
  const doc = container.ownerDocument;
  const output = String(++outputs);
  // What notes show: numbers depend on the pages only where they restart on each.
  const model = document.stories ? parseContent(document.content) : null;
  const hideDeleted = (options.review ?? "markup") !== "markup";
  const numbersOf = (pageOf?: (pos: number, story: string) => number | undefined) =>
    model
      ? noteNumbers(model, document, { hideDeleted, ...(pageOf ? { pageOf } : {}) }).filter(
          (n) => !hideDeleted || !n.deleted,
        )
      : [];
  let references = numbersOf();
  const noteTextsNow = noteTexts(references);
  const blocks = renderBlocks(document, doc, {
    ...options,
    lineRatio: measureLineRatio(container),
    notes: { references: noteTextsNow },
  });
  const sections: Section[] = [];
  const setups: SectionJSON[] = [];
  const lineRatio = measureLineRatio(container);
  const regions = new PageRegions(
    doc,
    { ...options, lineRatio, measureIn: () => container },
    new WeakMap(),
  );
  const resolver = new Resolver(document);
  regions.setDocument(document, setups, resolver);
  const notes = new PageNotes(
    doc,
    { ...options, lineRatio, measureIn: () => container },
    new WeakMap(),
  );
  const geometryOf = new Map<FlowSection, Geometry>();
  const sectionOf = new Map<WordBlock, Section>();
  let current: WordBlock[] = [];
  const close = (setup: SectionJSON) => {
    const g = geometry(setup);
    const columns = columnsPx(setup);
    const index = setups.length;
    setups.push(setup);
    const flow: FlowSection = {
      index,
      start: setup.type ?? "nextPage",
      columns: columns.widths.length,
      pageStart: setup.pageNumbers?.start,
      box: (page) => ({ height: regions.boxHeight(index, page) }),
      samePage: (other) => sameGeometry(g, geometryOf.get(other) as Geometry),
    };
    geometryOf.set(flow, g);
    // Measured in a page of the section's width, out of view, in its first column's width.
    const { page, body } = createPage(doc, g);
    page.style.position = "absolute";
    page.style.visibility = "hidden";
    page.style.height = "auto";
    const column = doc.createElement("div");
    column.style.display = "flow-root";
    column.style.width = `${columns.widths[0]}px`;
    body.append(column);
    container.append(page);
    column.append(...current.map((block) => block.element));
    const section = { setup, geometry: g, columns, blocks: current, flow, measuring: page, column };
    for (const block of current) sectionOf.set(block, section);
    sections.push(section);
    current = [];
  };
  for (const block of blocks) {
    current.push(block);
    if (block.section) close(block.section);
  }
  if (current.length || !sections.length) close(document.section);
  notes.setDocument(document, setups, resolver, references);
  sections.forEach((section, i) => {
    const next = sections[i + 1];
    section.flow.balanced =
      !!next &&
      section.flow.columns > 1 &&
      next.setup.type === "continuous" &&
      sameGeometry(section.geometry, next.geometry);
  });

  /** A block's height and lines at each column width it was asked for. */
  type Measured = Pick<BlockBox, "height" | "lines"> & {
    shown(): number[];
    /** The lines, at this width, that end with a break `attr` marks. */
    breaks(attr: string): number[];
    /** The footnotes referred to in the block, each with the line holding its reference. */
    references(): { story: string; line: number }[];
  };
  const measured = new Map<WordBlock, Map<number, Measured>>();
  const inWidth = (block: WordBlock, width: number) => {
    const section = sectionOf.get(block) as Section;
    const widths: Map<number, Measured> = measured.get(block) ?? new Map();
    measured.set(block, widths);
    const known = widths.get(width);
    if (known) return known;
    const { column, geometry: g } = section;
    const pageHeight = g.height - g.top - g.bottom;
    const atWidth = <T>(read: () => T): T => {
      const before = column.style.width;
      column.style.width = `${width}px`;
      const value = read();
      column.style.width = before;
      return value;
    };
    const height = atWidth(() => block.element.getBoundingClientRect().height);
    const hasBreak = !!block.element.querySelector(BREAKS);
    // A paragraph kept together is one line to the flow, unless it cannot be: taller than a
    // page, or broken by a page break.
    const kept = block.keepLines && !hasBreak && height <= pageHeight;
    let lines: number[] | undefined;
    const shown = () => {
      lines ??= atWidth(() => keepRows(block.element, lineBottoms(block.element), pageHeight));
      return lines;
    };
    const entry: Measured = {
      height,
      shown,
      lines: () => (kept ? [height] : shown()),
      breaks: (attr) => atWidth(() => breakLines(block.element, entry.lines(), attr)),
      references: () =>
        atWidth(() => {
          const top = block.element.getBoundingClientRect().top;
          const bottoms = entry.lines();
          return [...block.element.querySelectorAll(`[${NOTE_REF_ATTR}]`)].map((element) => {
            const y = element.getBoundingClientRect().bottom - top;
            const line = bottoms.findIndex((bottom) => y <= bottom + 1);
            return {
              story: element.getAttribute(NOTE_REF_ATTR) as string,
              line: line < 0 ? bottoms.length - 1 : line,
            };
          });
        }),
    };
    widths.set(width, entry);
    return entry;
  };
  const widthIn = (section: Section, fragment: Fragment) =>
    section.columns.widths[fragment.column ?? 0] as number;

  // Each cell paragraph's top in its block, measured while the blocks are laid out whole.
  const cellTops = new Map<WordBlock, { top: number; text: string }[]>();
  for (const block of blocks) {
    const cells = block.element.querySelectorAll("[data-foli-cell]");
    if (!cells.length) continue;
    const top = block.element.getBoundingClientRect().top;
    cellTops.set(
      block,
      [...cells].map((cell) => ({
        top: cell.getBoundingClientRect().top - top,
        text: cell.textContent ?? "",
      })),
    );
  }
  const headers = new Map<WordBlock, number>();
  const endnotes = notes.endnotes();
  const lastOfSection = (block: WordBlock, i: number) =>
    !blocks[i + 1] || sectionOf.get(blocks[i + 1] as WordBlock) !== sectionOf.get(block);
  const boxes: BlockBox[] = blocks.map((block, i) => {
    const section = sectionOf.get(block) as Section;
    const { widths } = section.columns;
    const whole = inWidth(block, widths[0] as number);
    const repeat = block.element.querySelector("tr") ? headerHeight(block.element) : 0;
    if (repeat) headers.set(block, repeat);
    const next = blocks[i + 1];
    const has = (attr: string) => !!block.element.querySelector(`br[${attr}]`);
    const hasPageBreak = has(WORD_PAGE_BREAK_ATTR);
    const hasColumnBreak = has(WORD_COLUMN_BREAK_ATTR);
    const index = section.flow.index ?? 0;
    const refers = !!block.element.querySelector(`[${NOTE_REF_ATTR}]`);
    return {
      notes: refers
        ? (column: number) =>
            inWidth(block, widths[column] as number)
              .references()
              .flatMap(({ story, line }) => {
                const note: FlowNote | null = notes.footnote(story, index);
                return note ? [{ line, note }] : [];
              })
        : undefined,
      endnotes: lastOfSection(block, i) ? endnotes.get(index) : undefined,
      height: whole.height,
      marginTop: block.before,
      marginBottom: block.after,
      repeat,
      // A table splits between rows; a paragraph without widow control at any line.
      anyLine: !!block.element.querySelector(":scope > table") || block.widowControl === false,
      keepWithNext: block.keepNext,
      section: section.flow,
      sectionMark:
        !!block.section &&
        !block.element.textContent &&
        !block.element.querySelector(`[${PICTURE_ATTR}]`),
      lines: whole.lines,
      inColumn: widths.every((width) => width === widths[0])
        ? undefined
        : (column) => inWidth(block, widths[column] as number),
      breaksAfter: (column = 0) => {
        const measure = inWidth(block, widths[column] as number);
        const breaks = hasPageBreak ? measure.breaks(WORD_PAGE_BREAK_ATTR) : [];
        // The next block starts a page: this one's last line ends it.
        if (next?.pageBreakBefore) breaks.push(measure.lines().length - 1);
        return breaks;
      },
      columnBreaksAfter: (column = 0) =>
        hasColumnBreak
          ? inWidth(block, widths[column] as number).breaks(WORD_COLUMN_BREAK_ATTR)
          : [],
    };
  });
  // shortcut: widow and orphan control is on for every paragraph (Word's Normal has it; a
  // paragraph turning it off is still kept to two lines).
  const rules = {
    orphans: 2,
    widows: 2,
    spacing: "word",
    addSpacing: document.settings?.doNotUseHTMLParagraphAutoSpacing === true,
    evenAndOddHeaders: document.settings?.evenAndOddHeaders === true,
    notes: notes.flowRules(),
  } as const;
  let flowed = flowFrom(boxes, 0, rules);
  let facts = pagesOf(boxes, flowed);
  // The page count is known once flowed; a header holding it can change what fits.
  for (let pass = 0; pass < 2 && regions.settle(facts); pass++) {
    flowed = flowFrom(boxes, 0, rules);
    facts = pagesOf(boxes, flowed);
  }
  // Numbers restarting on each page: known once flowed; a wider one is left as it is measured.
  if (setups.some((setup) => noteProperties(document, "footnote", setup).restart === "eachPage")) {
    const pages = new Map<string, number>();
    for (const piece of notePieces(flowed))
      if (!piece.fromLine && !pages.has(piece.id)) pages.set(piece.id, piece.page);
    references = numbersOf((_pos, story) => pages.get(story));
    const texts = noteTexts(references);
    notes.setDocument(document, setups, resolver, references);
    for (const block of blocks)
      for (const element of block.element.querySelectorAll(`[${NOTE_REF_ATTR}]`))
        element.textContent = texts.get(element.getAttribute(NOTE_REF_ATTR) as string) ?? "";
    flowed = flowFrom(boxes, 0, rules);
    facts = pagesOf(boxes, flowed);
  }
  const { fragments, gaps } = flowed;
  const pieces = notePieces(flowed);
  // What placing needs of the layout, read while the blocks are still laid out: split blocks' lines.
  blocks.forEach((block, b) => {
    const placed = fragments[b] ?? [];
    if (placed.length < 2) return;
    const section = sectionOf.get(block) as Section;
    for (const fragment of placed) inWidth(block, widthIn(section, fragment)).lines();
  });
  for (const section of sections) section.measuring.remove();

  // Each page's bands, from what is on it; a page with nothing (Word's blank page before an even
  // or odd page section) has the setup of the page after it.
  const bandsOf: Section[][] = [];
  blocks.forEach((block, b) => {
    for (const fragment of fragments[b] ?? []) {
      const bands = bandsOf[fragment.page] ?? [];
      bandsOf[fragment.page] = bands;
      bands[fragment.band ?? 0] ??= sectionOf.get(block) as Section;
    }
  });
  // A note can reach pages no text is on.
  const count = Math.max(1, bandsOf.length, ...pieces.map((piece) => piece.page + 1));
  const pageSetups: Section[] = [];
  for (let p = count - 1; p >= 0; p--)
    pageSetups[p] = bandsOf[p]?.[0] ?? pageSetups[p + 1] ?? (sections.at(-1) as Section);
  const color = pageColor(document.settings);
  const created = pageSetups.map((section, p) => {
    const made = createPage(doc, section.geometry);
    made.page.setAttribute(SHEET_ATTR, String(section.flow.index ?? 0));
    made.page.setAttribute(OUTPUT_ATTR, output);
    const page = facts[p];
    if (color) {
      made.page.style.background = color;
      made.page.style.setProperty("print-color-adjust", "exact");
      made.page.style.setProperty("-webkit-print-color-adjust", "exact");
    }
    const frame = pageBordersElement(
      doc,
      section.setup.pageBorders,
      section.geometry,
      !!page?.first,
    );
    if (frame) made.page.append(frame);
    // Word's blank page before an even or odd page section has no header or footer (its PDF).
    if (!page?.sectionPages) return made;
    const { top, bottom } = regions.margins(page.section, page);
    made.page.style.paddingTop = `${top}px`;
    made.page.style.paddingBottom = `${bottom}px`;
    for (const side of ["header", "footer"] as const) {
      const drawing = regions.drawing(page.section, side, page);
      if (!drawing) continue;
      const region = regions.element(page.section, side);
      region.append(drawing.content.content.cloneNode(true));
      made.page.append(region);
    }
    return made;
  });
  const bandElements = new Map<string, { band: HTMLElement; columns: HTMLElement[] }>();
  /** Where a fragment goes: the page's body, or its column when the page has bands. */
  const holder = (
    fragment: Pick<Fragment, "page" | "band" | "column" | "lead">,
    section: Section,
  ) => {
    const { body } = created[fragment.page] as { body: HTMLElement };
    const bands = bandsOf[fragment.page] ?? [section];
    if (bands.length === 1 && section.flow.columns === 1) return body;
    const band = fragment.band ?? 0;
    // Bands in order: one that nothing starts in yet still comes before the later ones.
    for (let b = 0; b <= band; b++) {
      const key = `${fragment.page} ${b}`;
      if (bandElements.has(key)) continue;
      const made = bandElement(doc, (bands[b] as Section).columns);
      bandElements.set(key, made);
      body.append(made.band);
    }
    const made = bandElements.get(`${fragment.page} ${band}`) as {
      band: HTMLElement;
      columns: HTMLElement[];
    };
    if (fragment.lead) made.band.style.marginTop = `${fragment.lead}px`;
    return made.columns[fragment.column ?? 0] as HTMLElement;
  };

  /** The section a page's band is in: the one of the page's blocks, or of the page. */
  const sectionAt = (page: number, band: number) =>
    (bandsOf[page]?.[band] ?? pageSetups[page])?.flow.index ?? 0;
  const groupsOf = (list: Parameters<typeof notes.groups>[0]): NoteGroup[] =>
    notes.groups(list, sectionAt);
  const footGroups = groupsOf(pieces).filter((group) => !group.inFlow);

  const firstPage = new Map<number, number>();
  /** Every fragment placed, in order: its page and how many lines it shows (measured lazily). */
  const placements: {
    page: number;
    nodes: number[] | null;
    mark: boolean;
    lines: () => number;
  }[] = [];
  const cellPages: { page: number; text: string }[] = [];
  blocks.forEach((block, b) => {
    const section = sectionOf.get(block) as Section;
    const placed = fragments[b] ?? [];
    const bottomsOf = (fragment: Fragment) =>
      inWidth(block, widthIn(section, fragment)).lines() as number[];
    placed.forEach((fragment, f) => {
      const target = holder(fragment, section);
      let element: HTMLElement = block.element;
      if (placed.length > 1) {
        // A split block: each fragment shows its lines of the whole block, clipped.
        const bottoms = bottomsOf(fragment);
        const top = fragment.fromLine ? (bottoms[fragment.fromLine - 1] ?? 0) : 0;
        const end =
          fragment.toLine === Number.POSITIVE_INFINITY
            ? (bottoms[bottoms.length - 1] ?? 0)
            : (bottoms[fragment.toLine - 1] ?? 0);
        const clip = doc.createElement("div");
        clip.style.overflow = "hidden";
        clip.style.height = `${end - top}px`;
        const inner = f === 0 ? block.element : (block.element.cloneNode(true) as HTMLElement);
        if (f > 0) inner.setAttribute("aria-hidden", "true");
        inner.style.marginTop = `${-top}px`;
        clip.append(inner);
        element = clip;
        const repeat = f > 0 ? (headers.get(block) ?? 0) : 0;
        if (repeat) {
          // The header rows again above the continuation.
          const header = doc.createElement("div");
          header.style.overflow = "hidden";
          header.style.height = `${repeat}px`;
          const copy = block.element.cloneNode(true) as HTMLElement;
          copy.setAttribute("aria-hidden", "true");
          copy.style.marginTop = "0";
          header.append(copy);
          element = doc.createElement("div");
          element.append(header, clip);
        }
      }
      // A section's empty last paragraph takes no room.
      if (fragment.mark) element.style.position = "absolute";
      element.style.marginTop = `${fragment.fromLine === 0 ? (gaps[b] ?? 0) : 0}px`;
      target.append(element);
      placements.push({
        page: fragment.page,
        nodes: f === 0 ? block.nodes : null,
        mark: !!fragment.mark,
        lines: () =>
          (fragment.toLine === Number.POSITIVE_INFINITY
            ? inWidth(block, widthIn(section, fragment)).shown().length
            : fragment.toLine) - fragment.fromLine,
      });
    });
    // Its cell paragraphs: on the page of the fragment their top is in.
    for (const cell of cellTops.get(block) ?? []) {
      let at = placed[0]?.page ?? 0;
      for (const fragment of placed) {
        const start = fragment.fromLine ? (bottomsOf(fragment)[fragment.fromLine - 1] ?? 0) : 0;
        if (cell.top + 0.5 >= start) at = fragment.page;
      }
      cellPages.push({ page: at, text: cell.text });
    }
    const first = placed[0];
    if (first) for (const index of block.nodes) firstPage.set(index, first.page);
  });
  // Endnotes and footnotes set beneath the text come after the last block of their column.
  for (const group of groupsOf(pieces))
    if (group.inFlow)
      holder(
        { page: group.page, band: group.band, column: group.column },
        sections[group.section] as Section,
      ).append(
        notes.groupElement(
          group,
          null,
          undefined,
          group.pieces[0]?.end
            ? 0
            : spaceAfterText(boxes, flowed, group.page, group.band, group.column),
        ),
      );
  for (const group of groupsOf(pieces)) {
    if (group.inFlow) continue;
    const { page } = created[group.page] as { page: HTMLElement };
    const section = sections[group.section] as Section;
    const fact = facts[group.page];
    const margin = fact?.sectionPages
      ? regions.margins(fact.section, fact).bottom
      : section.geometry.bottom;
    const place = notes.footPlace(
      { left: section.geometry.left, bottom: margin },
      notes.stacked(group, footGroups),
    );
    page.append(notes.groupElement(group, place));
  }
  const pages = created.map(({ page }) => {
    container.append(page);
    return page;
  });
  let firstLine: Map<number, number> | null = null;
  let starts: number[] | null = null;
  const fieldLayout: FieldLayout = {
    pages: facts.length,
    pageAt: (pos) => {
      if (!starts) {
        const list: number[] = [];
        (model ?? parseContent(document.content)).forEach((_node, offset) => {
          list.push(offset);
        });
        starts = list;
      }
      // The top-level node holding `pos`, or the nearest one before it that is shown.
      let index = starts.length - 1;
      while (index > 0 && (starts[index] as number) > pos) index--;
      while (index > 0 && !firstPage.has(index)) index--;
      const fact = facts[firstPage.get(index) ?? -1];
      if (!fact) return null;
      const format = setups[fact.section]?.pageNumbers?.format;
      return { number: fact.number, sectionPages: fact.sectionPages, format };
    },
  };
  const px = (n: number) => `${n}px`;
  return {
    pages,
    fieldLayout,
    printStyles: () => {
      const last = (sections.at(-1) as Section).geometry;
      // This output's pages only: another `renderDocument` in the web page keeps its own sizes.
      return printStyles(
        `.${WORD_PAGE_CLASS}[${OUTPUT_ATTR}="${output}"]`,
        { width: px(last.width), height: px(last.height) },
        sections.map(({ geometry: g, flow }) => ({
          width: px(g.width),
          height: px(g.height),
          index: flow.index ?? 0,
        })),
        `word-${output}`,
        true,
      );
    },
    pageOf: (index) => firstPage.get(index),
    lineOf: (index) => {
      if (!firstLine) {
        firstLine = new Map();
        let page = -1;
        let line = 1;
        for (const placement of placements) {
          if (placement.page !== page) {
            page = placement.page;
            line = 1;
          }
          // A section's mark is on the line before it, as Word numbers it.
          for (const node of placement.nodes ?? [])
            firstLine.set(node, placement.mark ? Math.max(line - 1, 1) : line);
          if (!placement.mark) line += placement.lines();
        }
      }
      return firstLine.get(index);
    },
    cellParagraphs: () => cellPages,
    destroy: () => {
      for (const page of pages) page.remove();
    },
  };
}
