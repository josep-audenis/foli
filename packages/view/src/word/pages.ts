/**
 * A schema v3 document on pages, as Word lays it out (8.6b, read-only): each section's page
 * size and margins, the blocks of `blocks.ts` measured in the page's width and flowed with
 * Word's spacing, keep rules, widow and orphan control and explicit breaks. Editing moves to
 * v3 in 8.7.
 */
import type { FoliDocumentV3, SectionJSON } from "@folijs/core";
import { type BlockBox, flow } from "../layout/flow.js";
import {
  type BlockOptions,
  PX_PER_TWIP,
  renderBlocks,
  WORD_PAGE_BREAK_ATTR,
  type WordBlock,
} from "./blocks.js";

export type { ReviewView } from "./blocks.js";

/** The class of each page element. */
export const WORD_PAGE_CLASS = "foli-word-page";

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
  /** Removes the pages. */
  destroy(): void;
}

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
  const { style } = page;
  style.boxSizing = "border-box";
  style.position = "relative";
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
 * The bottom of each line of a rendered block, from its top. Lines are the vertical clusters of
 * its contents' client rects; a boundary is halfway between one line's content and the next's,
 * the last line ends at the block's bottom.
 *
 * shortcut: line boxes are inferred from content rects (exact for even line heights); a
 * superscript or a much larger run on a line moves that line's boundaries slightly.
 */
export function lineBottoms(element: HTMLElement): number[] {
  const box = element.getBoundingClientRect();
  const doc = element.ownerDocument;
  const range = doc.createRange();
  const rects: { rect: DOMRect; text: boolean }[] = [];
  // Text and line breaks only: a range over the whole block also has the boxes of the
  // elements inside it (a table's), which span many lines.
  const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) rects.push({ rect, text: true });
    } else if (node.nodeName === "BR")
      rects.push({ rect: (node as Element).getBoundingClientRect(), text: false });
  }
  rects.sort((a, b) => a.rect.top - b.rect.top);
  type Line = { top: number; bottom: number; text: boolean };
  const lines: Line[] = [];
  for (const { rect, text } of rects) {
    if (rect.height <= 0) continue;
    const last = lines[lines.length - 1];
    // Same line: it starts above the middle of the line so far.
    if (last && rect.top < (last.top + last.bottom) / 2) {
      // A line's text says where it is; a <br> only for a line without text (engines size
      // its box differently).
      if (text && !last.text) Object.assign(last, { top: rect.top, bottom: rect.bottom, text });
      else if (text === last.text) {
        last.top = Math.min(last.top, rect.top);
        last.bottom = Math.max(last.bottom, rect.bottom);
      }
    } else lines.push({ top: rect.top, bottom: rect.bottom, text });
  }
  const bottoms = lines.slice(1).map((line, i) => {
    const above = lines[i] as { bottom: number };
    return (above.bottom + line.top) / 2 - box.top;
  });
  bottoms.push(box.height);
  return bottoms;
}

/** The height of a table's leading header rows (repeated on each page it continues on), or 0. */
function headerHeight(element: HTMLElement): number {
  let bottom = 0;
  // The table's own rows: not those of a table nested in a cell.
  for (const row of element.querySelectorAll(":scope > table > tbody > tr")) {
    if (!(row as HTMLElement).dataset || !("foliHeader" in (row as HTMLElement).dataset)) break;
    bottom = row.getBoundingClientRect().bottom;
  }
  return bottom ? bottom - element.getBoundingClientRect().top : 0;
}

/** The lines that end with an explicit page break, by the break's position. */
function breakLines(element: HTMLElement, bottoms: readonly number[]): number[] {
  const top = element.getBoundingClientRect().top;
  return [...element.querySelectorAll(`br[${WORD_PAGE_BREAK_ATTR}]`)].map((br) => {
    const y = br.getBoundingClientRect().top - top;
    const line = bottoms.findIndex((bottom) => y < bottom);
    return line < 0 ? bottoms.length - 1 : line;
  });
}

/**
 * Lays a v3 document out on pages inside `container`. Headers, footers, footnotes and floating
 * content are not laid out yet (Phase 11); tables are shown from their verbatim XML until
 * Phase 10.
 */
export function renderDocumentV3(
  document: FoliDocumentV3,
  container: HTMLElement,
  options: Omit<BlockOptions, "lineRatio"> = {},
): DocumentPages {
  const doc = container.ownerDocument;
  const blocks = renderBlocks(document, doc, {
    ...options,
    lineRatio: measureLineRatio(container),
  });
  // Sections: consecutive blocks with one page setup. A section starts a new page unless it is
  // continuous with the same geometry (shortcut: a continuous section with another geometry
  // starts a new page).
  const groups: { geometry: Geometry; blocks: WordBlock[] }[] = [];
  let current: WordBlock[] = [];
  const close = (section: SectionJSON) => {
    const g = geometry(section);
    const previous = groups[groups.length - 1];
    if (section.type === "continuous" && previous && sameGeometry(previous.geometry, g))
      previous.blocks.push(...current);
    else groups.push({ geometry: g, blocks: current });
    current = [];
  };
  for (const block of blocks) {
    current.push(block);
    if (block.section) close(block.section);
  }
  if (current.length || !groups.length) close(document.section);

  const pages: HTMLElement[] = [];
  const firstPage = new Map<number, number>();
  /** Every fragment placed, in order: its page and how many lines it shows (measured lazily). */
  const placements: { page: number; nodes: number[] | null; lines: () => number }[] = [];
  for (const group of groups) {
    const g = group.geometry;
    // Measure in a page of the section's width, out of view.
    const measuring = createPage(doc, g);
    measuring.page.style.position = "absolute";
    measuring.page.style.visibility = "hidden";
    measuring.page.style.height = "auto";
    container.append(measuring.page);
    for (const block of group.blocks) measuring.body.append(block.element);
    const lines = new Map<WordBlock, number[]>();
    const linesOf = (block: WordBlock) => {
      let value = lines.get(block);
      if (!value) {
        value = lineBottoms(block.element);
        lines.set(block, value);
      }
      return value;
    };
    const headers = new Map<WordBlock, number>();
    const pageHeight = g.height - g.top - g.bottom;
    const boxes: BlockBox[] = group.blocks.map((block, i) => {
      const height = block.element.getBoundingClientRect().height;
      const repeat = block.element.querySelector("tr") ? headerHeight(block.element) : 0;
      if (repeat) headers.set(block, repeat);
      const next = group.blocks[i + 1];
      const hasBreak = !!block.element.querySelector(`br[${WORD_PAGE_BREAK_ATTR}]`);
      // A paragraph kept together is one line to the flow, unless it cannot be: taller than a
      // page, or broken by a page break.
      const kept = block.keepLines && !hasBreak && height <= pageHeight;
      return {
        height,
        marginTop: block.before,
        marginBottom: block.after,
        repeat,
        keepWithNext: block.keepNext,
        lines: () => (kept ? [height] : linesOf(block)),
        breaksAfter: () => {
          const breaks = hasBreak ? breakLines(block.element, linesOf(block)) : [];
          // The next block starts a page: this one's last line ends it.
          if (next?.pageBreakBefore) breaks.push((kept ? 1 : linesOf(block).length) - 1);
          return breaks;
        },
      };
    });
    // shortcut: widow and orphan control is on for every paragraph (Word's Normal has it; a
    // paragraph turning it off is still kept to two lines).
    const fragments = flow(boxes, pageHeight, { orphans: 2, widows: 2, spacing: "word" });
    // What placing needs of the layout, read while the blocks are still laid out: the lines of
    // split blocks, and which blocks end with an explicit page break.
    const endsWithBreak = new Set<WordBlock>();
    group.blocks.forEach((block, b) => {
      if ((fragments[b]?.length ?? 0) > 1) linesOf(block);
      if (!block.element.querySelector(`br[${WORD_PAGE_BREAK_ATTR}]`)) return;
      const bottoms = linesOf(block);
      if (breakLines(block.element, bottoms).includes(bottoms.length - 1)) endsWithBreak.add(block);
    });
    measuring.page.remove();

    const count = Math.max(1, ...fragments.flat().map((f) => f.page + 1));
    const groupPages = Array.from({ length: count }, () => createPage(doc, g));
    let previousOnPage: { page: number; block: number } | null = null;
    group.blocks.forEach((block, b) => {
      const placed = fragments[b] ?? [];
      const bottoms = placed.length > 1 ? linesOf(block) : [];
      placed.forEach((fragment, f) => {
        const target = groupPages[fragment.page] as { body: HTMLElement };
        let gap = 0;
        if (fragment.fromLine === 0) {
          if (previousOnPage?.page === fragment.page)
            gap = (group.blocks[previousOnPage.block] as WordBlock).after + block.before;
          else {
            // The first block on a page: Word keeps its space before on the section's first
            // page and after an explicit break only.
            const prior = group.blocks[b - 1];
            const forced =
              fragment.page === 0 ||
              block.pageBreakBefore ||
              (prior !== undefined && endsWithBreak.has(prior));
            gap = forced ? block.before : 0;
          }
        }
        let element: HTMLElement = block.element;
        if (placed.length > 1) {
          // A split block: each fragment shows its lines of the whole block, clipped.
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
        element.style.marginTop = `${gap}px`;
        target.body.append(element);
        previousOnPage = { page: fragment.page, block: b };
        placements.push({
          page: pages.length + fragment.page,
          nodes: f === 0 ? block.nodes : null,
          lines: () =>
            (fragment.toLine === Number.POSITIVE_INFINITY
              ? linesOf(block).length
              : fragment.toLine) - fragment.fromLine,
        });
      });
      const first = placed[0];
      if (first) for (const index of block.nodes) firstPage.set(index, pages.length + first.page);
    });
    for (const { page } of groupPages) {
      container.append(page);
      pages.push(page);
    }
  }
  let firstLine: Map<number, number> | null = null;
  return {
    pages,
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
          for (const node of placement.nodes ?? []) firstLine.set(node, line);
          line += placement.lines();
        }
      }
      return firstLine.get(index);
    },
    destroy: () => {
      for (const page of pages) page.remove();
    },
  };
}
