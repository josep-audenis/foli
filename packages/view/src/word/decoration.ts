/**
 * Page decoration (Phase 32, ADR-0015): the page color and a section's page borders, drawn on
 * each page by the editing view and by `renderDocument` (so in print and `exportPdf` too).
 */
import type { NodeJSON, PageBordersJSON, WatermarkJSON, WordSettingsJSON } from "@folijs/core";
import { borderJsonCss, type ImageSource, PX_PER_TWIP } from "./blocks.js";

/**
 * Marks the element holding a page's borders.
 * @internal
 */
export const PAGE_BORDERS_ATTR = "data-foli-page-borders";
/**
 * Marks what is drawn on a page from its decoration (borders, watermarks), not its content.
 * @internal
 */
export const PAGE_DECORATION_ATTR = "data-foli-page-decoration";
/**
 * Marks a page's watermark.
 * @internal
 */
export const WATERMARK_ATTR = "data-foli-watermark";

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
 * shortcut: art borders (apples, stars…) are drawn as a solid line, their `size` (points for
 * art) read as eighths as a line's is: thin; draw their pictures when a document needs them.
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
  element.setAttribute(PAGE_DECORATION_ATTR, "");
  element.setAttribute("aria-hidden", "true");
  element.contentEditable = "false";
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

/**
 * The watermarks a story holds (its opaque runs' `watermark`), as a tree or as JSON.
 * @internal
 */
export function watermarksIn(
  story:
    | NodeJSON
    | {
        descendants(
          f: (node: { type: { name: string }; attrs: Record<string, unknown> }) => void,
        ): void;
      },
): WatermarkJSON[] {
  const out: WatermarkJSON[] = [];
  if ("descendants" in story) {
    story.descendants((node) => {
      const watermark = node.type.name === "opaqueInline" && node.attrs.watermark;
      if (watermark) out.push(watermark as WatermarkJSON);
    });
    return out;
  }
  const visit = (node: NodeJSON) => {
    const watermark = node.type === "opaqueInline" && node.attrs?.watermark;
    if (watermark) out.push(watermark as WatermarkJSON);
    for (const child of node.content ?? []) visit(child);
  };
  visit(story);
  return out;
}

/**
 * A watermark as Word draws it: its box centered on the page's text area, behind the text,
 * turned by its rotation; a text's letters stretched to fill the box (VML's `fitshape`), a
 * picture's image (washed out: Word's 85% brightness, 15% contrast).
 * @internal
 */
export function watermarkElement(
  doc: Document,
  watermark: WatermarkJSON,
  box: PageBox,
  image: ImageSource,
): HTMLElement {
  const width = watermark.width * PX_PER_TWIP;
  const height = watermark.height * PX_PER_TWIP;
  const element = doc.createElement("div");
  element.setAttribute(WATERMARK_ATTR, watermark.kind);
  element.setAttribute(PAGE_DECORATION_ATTR, "");
  element.setAttribute("aria-hidden", "true");
  element.contentEditable = "false";
  const { style } = element;
  style.position = "absolute";
  style.pointerEvents = "none";
  style.zIndex = "-1";
  style.width = `${width}px`;
  style.height = `${height}px`;
  style.left = `${box.left + (box.width - box.left - box.right - width) / 2}px`;
  style.top = `${box.top + (box.height - box.top - box.bottom - height) / 2}px`;
  if (watermark.rotation) style.transform = `rotate(${watermark.rotation}deg)`;
  if (watermark.kind === "picture") {
    const url = watermark.picture ? image(watermark.picture) : undefined;
    if (url) {
      const img = doc.createElement("img");
      img.src = url;
      img.alt = "";
      img.style.width = "100%";
      img.style.height = "100%";
      if (watermark.washout) img.style.filter = "brightness(1.7) contrast(0.15)";
      element.append(img);
    }
    return element;
  }
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  const text = doc.createElementNS("http://www.w3.org/2000/svg", "text");
  // shortcut: the letters fill the box's width exactly and its height by the font's cap height.
  text.setAttribute("x", "0");
  text.setAttribute("y", String(height * 0.87));
  text.setAttribute("font-size", String(height * 1.2));
  text.setAttribute("font-family", watermark.font ?? "Calibri");
  text.setAttribute("textLength", String(width));
  text.setAttribute("lengthAdjust", "spacingAndGlyphs");
  text.setAttribute("fill", `#${watermark.color ?? "C0C0C0"}`);
  if (watermark.semitransparent) text.setAttribute("fill-opacity", "0.5");
  text.textContent = watermark.text ?? "";
  svg.append(text);
  element.append(svg);
  return element;
}
