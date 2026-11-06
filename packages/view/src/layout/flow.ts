import type { DocumentSettings } from "@foli/core";

/** CSS pixels per millimetre (CSS fixes 1in = 96px = 25.4mm). */
export const PX_PER_MM = 96 / 25.4;

/** A rendered block's border-box height and vertical margins, in CSS px. */
export interface BlockBox {
  height: number;
  marginTop: number;
  marginBottom: number;
  /**
   * The bottom of each line box, from the block's top (the last one is `height`). Only called
   * for a block that does not fit where it is, since measuring lines is expensive.
   */
  lines(): readonly number[];
}

/** The lines `[fromLine, toLine)` of a block, placed on one page (`toLine` Infinity: to the end). */
export interface Fragment {
  page: number;
  fromLine: number;
  toLine: number;
}

/** Height of a page's content box (page height minus top and bottom margins), in CSS px. */
export function contentHeight({ pageSize, margins }: DocumentSettings): number {
  return (pageSize.height - margins.top - margins.bottom) * PX_PER_MM;
}

// Half a pixel of slack: measured heights are fractional and rounding must not add a page.
const SLACK = 0.5;

/**
 * Page flow: the fragments of each block, in order. Blocks fill a page in order; a block that
 * does not fit is split at a line boundary, the lines that fit staying on the page, the rest
 * continuing at the top of the next one (as many pages as it takes). A page with room for no
 * line of the next block ends; an empty page always takes at least one line.
 *
 * Spacing follows CSS inside a padded page: the first block keeps its top margin, adjacent
 * margins collapse to the larger, and the last block's bottom margin stays inside the page
 * (it does not collapse into the padding), so it must fit too. Fragments are rendered without
 * the margins at their split edges: a continued fragment has no bottom margin, a continuation
 * no top margin.
 *
 * shortcut: positive margins only (negative margins collapse differently); no widow/orphan or keep-with-next rules yet (5.3).
 */
export function flow(boxes: readonly BlockBox[], pageHeight: number): Fragment[][] {
  const result: Fragment[][] = [];
  let page = 0;
  let used = 0;
  let previousMargin = 0;
  let onPage = 0;
  const newPage = () => {
    page++;
    used = 0;
    onPage = 0;
  };
  for (const box of boxes) {
    const above = previousMargin;
    previousMargin = box.marginBottom;
    const gap = () => (onPage ? Math.max(above, box.marginTop) : box.marginTop);
    const fragments: Fragment[] = [];
    result.push(fragments);
    if (used + gap() + box.height + box.marginBottom <= pageHeight + SLACK) {
      used += gap() + box.height;
      onPage++;
      fragments.push({ page, fromLine: 0, toLine: Infinity });
      continue;
    }
    const lines = box.lines();
    const count = lines.length;
    let line = 0;
    while (line < count) {
      const top = line ? (lines[line - 1] as number) : 0;
      // Only the block's first fragment has the gap above it.
      const spacing = line === 0 ? gap() : 0;
      let end = line;
      while (end < count) {
        const bottom = (lines[end] as number) - top + (end + 1 === count ? box.marginBottom : 0);
        if (used + spacing + bottom > pageHeight + SLACK) break;
        end++;
      }
      if (end === line) {
        if (onPage) {
          newPage();
          continue;
        }
        end = line + 1; // a line taller than a page is placed anyway
      }
      fragments.push({ page, fromLine: line, toLine: end });
      used += spacing + (lines[end - 1] as number) - top;
      onPage++;
      line = end;
      if (line < count) newPage();
    }
    // Moved whole to a later page: not split.
    const [only] = fragments;
    if (fragments.length === 1 && only) only.toLine = Infinity;
  }
  return result;
}
