import type { DocumentSettings } from "@foli/core";

/** CSS pixels per millimetre (CSS fixes 1in = 96px = 25.4mm). */
export const PX_PER_MM = 96 / 25.4;

/** A rendered block's border-box height and vertical margins, in CSS px. */
export interface BlockBox {
  height: number;
  marginTop: number;
  marginBottom: number;
}

/** Height of a page's content box (page height minus top and bottom margins), in CSS px. */
export function contentHeight({ pageSize, margins }: DocumentSettings): number {
  return (pageSize.height - margins.top - margins.bottom) * PX_PER_MM;
}

/**
 * Page flow for whole blocks: the page index of each block. Blocks fill a page in order; one
 * that would end below the content box starts the next page. Spacing follows CSS inside a
 * padded page: the first block keeps its top margin, adjacent margins collapse to the larger.
 * A block taller than a page gets a page of its own (the page grows; splitting comes in 5.2).
 *
 * shortcut: positive margins only (negative margins collapse differently); add them when a
 * block style uses one.
 */
export function flowBlocks(boxes: readonly BlockBox[], pageHeight: number): number[] {
  const pages: number[] = [];
  let page = 0;
  let used = 0;
  let previousMargin = 0;
  let onPage = 0;
  for (const box of boxes) {
    const gap = onPage ? Math.max(previousMargin, box.marginTop) : box.marginTop;
    // Half a pixel of slack: measured heights are fractional and rounding must not add a page.
    if (onPage && used + gap + box.height > pageHeight + 0.5) {
      page++;
      used = box.marginTop + box.height;
      onPage = 1;
    } else {
      used += gap + box.height;
      onPage++;
    }
    previousMargin = box.marginBottom;
    pages.push(page);
  }
  return pages;
}
