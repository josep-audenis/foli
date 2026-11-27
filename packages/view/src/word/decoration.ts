/**
 * Page decoration (Phase 32, ADR-0015): the page color and a section's page borders, drawn on
 * each page by the editing view and by `renderDocument` (so in print and `exportPdf` too).
 */
import type { PageBordersJSON, WordSettingsJSON } from "@folijs/core";
import { borderJsonCss } from "./blocks.js";

/**
 * Marks the element holding a page's borders.
 * @internal
 */
export const PAGE_BORDERS_ATTR = "data-foli-page-borders";

/**
 * The page color as CSS (`#RRGGBB`), undefined when the document has none (or `auto`).
 * @internal
 */
export function pageColor(settings: WordSettingsJSON | undefined): string | undefined {
  const color = settings?.background?.color;
  return color && color !== "auto" ? `#${color}` : undefined;
}

/**
 * A page box in px: its size and its margins (the left one with the gutter).
 * @internal
 */
export interface PageBox {
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const SIDES = ["top", "right", "bottom", "left"] as const;
const PX_PER_PT = 96 / 72;

/** A border's width in px as `borderJsonCss` draws it; 0 for none. */
const widthOf = (border: { style?: string; size?: number } | undefined) =>
  !border || border.style === "nil" || border.style === "none"
    ? 0
    : Math.max(((border.size ?? 4) / 8) * PX_PER_PT, 0.5);

/**
 * Whether a page shows its section's borders: `first` is the section's first page.
 * @internal
 */
export function showsPageBorders(borders: PageBordersJSON, first: boolean): boolean {
  if (borders.display === "firstPage") return first;
  if (borders.display === "notFirstPage") return !first;
  return true;
}

/**
 * The borders of a page as an element over it (pointer events pass through), placed as Word
 * places them: each side `space` points from the page's edge (`offsetFrom` page) or outside the
 * text (Word's default, from the margins), behind the text when `zOrder` is back. Null when the
 * page shows none.
 *
 * shortcut: art borders (apples, stars…) are drawn as a solid line of their width; draw their
 * pictures when a document needs them.
 * @internal
 */
export function pageBordersElement(
  doc: Document,
  borders: PageBordersJSON | undefined,
  box: PageBox,
  first: boolean,
): HTMLElement | null {
  if (!borders || !showsPageBorders(borders, first)) return null;
  if (!SIDES.some((side) => widthOf(borders[side]))) return null;
  const element = doc.createElement("div");
  element.setAttribute(PAGE_BORDERS_ATTR, "");
  element.setAttribute("aria-hidden", "true");
  const { style } = element;
  style.position = "absolute";
  style.boxSizing = "border-box";
  style.pointerEvents = "none";
  style.zIndex = borders.zOrder === "back" ? "-1" : "1";
  for (const side of SIDES) {
    const border = borders[side];
    const space = (border?.space ?? 0) * PX_PER_PT;
    const inset =
      borders.offsetFrom === "page" ? space : Math.max(box[side] - space - widthOf(border), 0);
    style.setProperty(side, `${inset}px`);
    const css = borderJsonCss(border);
    if (css) style.setProperty(`border-${side}`, css);
  }
  return element;
}

/**
 * A key for what `pageBordersElement` draws: the same key, the same element.
 * @internal
 */
export function pageBordersKey(
  borders: PageBordersJSON | undefined,
  box: PageBox,
  first: boolean,
): string {
  if (!borders || !showsPageBorders(borders, first)) return "";
  return JSON.stringify([borders, box]);
}
