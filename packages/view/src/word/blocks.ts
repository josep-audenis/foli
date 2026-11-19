/**
 * Schema v3 blocks as DOM, formatted as Word formats them (8.6b): every paragraph's and run's
 * effective formatting from `Resolver` as inline CSS, list markers, tracked changes, comment
 * anchors, and content the model keeps opaque shown as text. Read-only: built with
 * createElement/textContent only (never innerHTML); the page layout is in `pages.ts`.
 */
import {
  type FieldDisplay,
  type FoliDocument,
  fieldDisplay,
  type MarkJSON,
  type NodeJSON,
  type ResourceJSON,
  type SectionJSON,
} from "@folijs/core";
import {
  CUSTOM_TYPE,
  foreignTextOf,
  type ListMarker,
  type ParagraphFormat,
  Resolver,
  type RunFormat,
} from "@folijs/core/internal";

/**
 * Marks the <br> of an explicit page break (the page flow ends the page after its line).
 * @internal
 */
export const WORD_PAGE_BREAK_ATTR = "data-page-break";
/**
 * Marks the <br> of an explicit column break (the flow ends the column after its line).
 * @internal
 */
export const WORD_COLUMN_BREAK_ATTR = "data-column-break";

/**
 * CSS px per twip (1/1440 inch; CSS: 96 px per inch).
 * @internal
 */
export const PX_PER_TWIP = 96 / 1440;
/** EMU (DrawingML's unit: 914 400 per inch) per CSS px. */
export const EMU_PER_PX = 914_400 / 96;

/**
 * The URL to show a picture's image from (its resource key), if one is known.
 * @internal
 */
export type ImageSource = (key: string) => string | undefined;

/**
 * Marks a picture's element (its resource key).
 * @internal
 */
export const PICTURE_ATTR = "data-foli-picture";

/**
 * The accessible name of a picture with no alt text that is not decorative.
 * @internal
 */
export const NO_ALT_LABEL = "Picture without alt text";

/**
 * The URL a resource gives on its own: an image `data:` URL, or a web or `blob:` URL; none for
 * an image in a package part (the app's resolver gives one) or anything else.
 * @internal
 */
export function ownImageUrl(resource: ResourceJSON | undefined): string | undefined {
  const data = resource?.data;
  if (data && /^data:image\//i.test(data)) return data;
  const url = resource?.url;
  return url && /^(https?|blob):/i.test(url) ? url : undefined;
}

/**
 * A picture as shown: its image at its size, or, when no URL is known for it, a box of that size
 * with its alt text. A picture with no alt text that is not decorative is marked (`data-foli-
 * no-alt`); a decorative one has an empty alt.
 * @internal
 */
export function pictureElement(
  attrs: Record<string, unknown>,
  doc: Document,
  image?: ImageSource,
): HTMLElement {
  const key = String(attrs.resource ?? "");
  const width = `${Number(attrs.width) / EMU_PER_PX}px`;
  const height = `${Number(attrs.height) / EMU_PER_PX}px`;
  const decorative = attrs.decorative === true;
  const own = String(attrs.alt ?? "");
  // Only a decorative picture is silent; one missing its alt text says so.
  const alt = decorative ? "" : own || NO_ALT_LABEL;
  const src = image?.(key);
  let element: HTMLElement;
  if (src) {
    const img = doc.createElement("img");
    img.src = src;
    img.alt = alt;
    img.draggable = false;
    // A web URL in a document is fetched as it is shown: no referrer to go with it.
    img.referrerPolicy = "no-referrer";
    element = img;
  } else {
    element = doc.createElement("span");
    element.setAttribute("role", "img");
    if (alt) element.setAttribute("aria-label", alt);
    else element.setAttribute("aria-hidden", "true");
    element.style.boxSizing = "border-box";
    element.style.border = "1px dashed GrayText";
  }
  element.setAttribute(PICTURE_ATTR, key);
  if (!own && !decorative) element.dataset.foliNoAlt = "";
  if (attrs.title) element.title = String(attrs.title);
  // In the line at its size, whatever the app's CSS says of images (`display: block`…).
  const style = element.style;
  style.display = src ? "inline" : "inline-block";
  style.verticalAlign = "baseline";
  style.maxWidth = "none";
  style.maxHeight = "none";
  style.width = width;
  style.height = height;
  return element;
}

/**
 * Marks the element holding a floating picture (its wrapping), drawn at its paragraph's start.
 * @internal
 */
export const FLOAT_ATTR = "data-foli-float";

/**
 * A section's page, in CSS px: what a floating picture is positioned against.
 * @internal
 */
export interface FloatGeometry {
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly marginLeft: number;
  readonly marginTop: number;
  readonly textWidth: number;
  readonly textHeight: number;
}

/**
 * The page geometry of `section` (Word's Letter page and margins where it does not say).
 * @internal
 */
export function floatGeometry(section: SectionJSON | undefined): FloatGeometry {
  const m = section?.margins ?? {};
  const width = section?.pageSize?.width ?? 12_240;
  const height = section?.pageSize?.height ?? 15_840;
  const left = (m.left ?? 1440) + (m.gutter ?? 0);
  const top = Math.abs(m.top ?? 1440);
  return {
    pageWidth: width * PX_PER_TWIP,
    pageHeight: height * PX_PER_TWIP,
    marginLeft: left * PX_PER_TWIP,
    marginTop: top * PX_PER_TWIP,
    textWidth: (width - left - (m.right ?? 1440)) * PX_PER_TWIP,
    textHeight: (height - top - Math.abs(m.bottom ?? 1440)) * PX_PER_TWIP,
  };
}

type FloatPosition = { relativeTo: string; offset?: number; align?: string };

/** Where a float's position is measured from, and the box its alignment is in (px). */
function horizontalBox(relativeTo: string, g: FloatGeometry): [start: number, size: number] {
  const right = g.pageWidth - g.marginLeft - g.textWidth;
  switch (relativeTo) {
    case "page":
      return [0, g.pageWidth];
    case "leftMargin":
    case "insideMargin":
      return [0, g.marginLeft];
    case "rightMargin":
    case "outsideMargin":
      return [g.marginLeft + g.textWidth, right];
    default:
      // margin, column, character (shortcut: the column).
      return [g.marginLeft, g.textWidth];
  }
}

function verticalBox(relativeTo: string, g: FloatGeometry): [start: number, size: number] {
  const bottom = g.pageHeight - g.marginTop - g.textHeight;
  switch (relativeTo) {
    case "page":
      return [0, g.pageHeight];
    case "topMargin":
    case "insideMargin":
      return [0, g.marginTop];
    case "bottomMargin":
    case "outsideMargin":
      return [g.pageHeight - bottom, bottom];
    default:
      return [g.marginTop, g.textHeight];
  }
}

/** Where `size` px goes in `[start, start + box)` by offset (EMU) or alignment. */
function placed(position: FloatPosition, [start, box]: [number, number], size: number): number {
  if (typeof position.offset === "number") return start + position.offset / EMU_PER_PX;
  const { align } = position;
  if (align === "right" || align === "bottom" || align === "outside") return start + box - size;
  if (align === "center") return start + (box - size) / 2;
  return start;
}

/** Where a float's left edge is, in px from the column's left edge. */
function floatLeft(h: FloatPosition, width: number, g: FloatGeometry): number {
  return placed(h, horizontalBox(h.relativeTo, g), width) - g.marginLeft;
}

/**
 * Where a float's top edge is: from its paragraph's top (`paragraph`), or from the page's top
 * (`page`) for a position against the page or its margins.
 */
function floatTop(
  v: FloatPosition,
  height: number,
  g: FloatGeometry,
): { paragraph?: number; page?: number } {
  if (v.relativeTo === "paragraph" || v.relativeTo === "line")
    return { paragraph: typeof v.offset === "number" ? v.offset / EMU_PER_PX : 0 };
  return { page: placed(v, verticalBox(v.relativeTo, g), height) };
}

/**
 * A floating picture (10.9, ADR-0006) as CSS floats lay it out, put first in its anchor
 * paragraph: `holder` holds the picture (`FLOAT_ATTR`), `nodes` go in the paragraph (a
 * zero-width spacer float before it gives its offset from the paragraph's top).
 * - Square (tight and through shown as square): a float on the side the picture is on, its
 *   distance from the text as its margin; text goes on the other side only.
 * - Top and bottom: a float as wide as the paragraph, the picture in it at its position.
 * - Behind and in front of text: absolutely positioned on the page (z-index -1 or 1; the page is
 *   the containing block and its own stacking context).
 * shortcut: a wrapping picture placed against the page or its margins vertically is drawn at
 * its paragraph's top; horizontal positions are against the paragraph's box (its indents in);
 * all against `geometry` (one section's page), not each page's. A float's top is never above an
 * earlier float's (CSS), and `clear` stacks it below earlier floats on its side: several floats
 * in a paragraph, or one above a float of an earlier paragraph, add their offsets down and do
 * not sit side by side.
 * @internal
 */
export function floatElements(
  attrs: Record<string, unknown>,
  doc: Document,
  image: ImageSource | undefined,
  geometry: FloatGeometry,
): { nodes: HTMLElement[]; holder: HTMLElement } {
  const float = attrs.float as {
    horizontal: FloatPosition;
    vertical: FloatPosition;
    wrap: string;
    side?: string;
    distance?: { top?: number; bottom?: number; left?: number; right?: number };
  };
  const width = Number(attrs.width) / EMU_PER_PX;
  const height = Number(attrs.height) / EMU_PER_PX;
  const distance = (side: "top" | "bottom" | "left" | "right") =>
    (float.distance?.[side] ?? 0) / EMU_PER_PX;
  const picture = pictureElement(attrs, doc, image);
  picture.style.display = "block";
  const holder = doc.createElement("span");
  holder.setAttribute(FLOAT_ATTR, float.wrap);
  holder.append(picture);
  const style = holder.style;
  style.display = "block";
  const x = floatLeft(float.horizontal, width, geometry);
  const top = floatTop(float.vertical, height, geometry);
  if (float.wrap === "behind" || float.wrap === "inFront") {
    style.position = "absolute";
    style.zIndex = float.wrap === "behind" ? "-1" : "1";
    style.left = `${geometry.marginLeft + x}px`;
    // Against the paragraph: where it would be (its static position), moved by its offset.
    if (top.page !== undefined) style.top = `${top.page}px`;
    else style.marginTop = `${top.paragraph}px`;
    return { nodes: [holder], holder };
  }
  // Its distance from the text above and below as its margins: lines there go around it too.
  const above = distance("top");
  const down = (top.paragraph ?? 0) - above;
  const spacer = doc.createElement("span");
  spacer.setAttribute("aria-hidden", "true");
  spacer.style.width = "0";
  spacer.style.height = `${Math.max(0, down)}px`;
  style.marginTop = `${above + Math.min(0, down)}px`;
  style.marginBottom = `${distance("bottom")}px`;
  if (float.wrap === "topAndBottom") {
    spacer.style.float = "left";
    style.float = "left";
    style.clear = "both";
    style.width = "100%";
    picture.style.marginLeft = `${x}px`;
    return { nodes: [spacer, holder], holder };
  }
  // Text on the side with more room (or the side `side` names): the picture floats on the other.
  const right =
    float.side === "left" || (float.side !== "right" && x + width / 2 > geometry.textWidth / 2);
  const side = right ? "right" : "left";
  spacer.style.float = side;
  style.float = side;
  style.clear = side;
  if (right) {
    style.marginRight = `${geometry.textWidth - x - width}px`;
    style.marginLeft = `${distance("left")}px`;
  } else {
    style.marginLeft = `${x}px`;
    style.marginRight = `${distance("right")}px`;
  }
  return { nodes: [spacer, holder], holder };
}

/** Which version of tracked changes to show. */
/** How tracked changes show (`@folijs/core`'s, for `renderDocument` too). */
export type { ReviewView } from "@folijs/core";

import type { ReviewView } from "@folijs/core";

/** Colors for the authors of changes (contrast 4.5:1 or more on white), picked by name. */
const AUTHOR_COLORS = [
  "#B5082E",
  "#1F5FAD",
  "#2E7D32",
  "#8E24AA",
  "#A64B00",
  "#00737F",
  "#AD1457",
  "#5D4037",
];

/**
 * The color of `author`'s changes: always the same for a name.
 * @internal
 */
export function authorColor(author: string): string {
  let hash = 0;
  for (const c of author) hash = (hash * 31 + (c.codePointAt(0) ?? 0)) >>> 0;
  return AUTHOR_COLORS[hash % AUTHOR_COLORS.length] as string;
}

/**
 * The bar beside a paragraph with changes (`markup` and `simple`), drawn in the margin.
 * @internal
 */
export const CHANGE_BAR = "-4px 0 0 0 #6B6B6B";

/**
 * The element around an inserted or deleted run: `ins` or `del` (named for screen readers by
 * its title), styled for `review`. Deleted text not shown is hidden, not left out: the editable
 * view maps positions through it.
 * @internal
 */
export function changeElement(
  doc: Document,
  inserted: boolean,
  author: string,
  date: string | null,
  review: ReviewView,
): HTMLElement {
  const element = doc.createElement(inserted ? "ins" : "del");
  const when = date ? `, ${date.slice(0, 10)}` : "";
  element.title = `${inserted ? "Inserted" : "Deleted"} by ${author || "an unknown author"}${when}`;
  if (review === "markup") {
    element.style.color = authorColor(author);
    element.style.textDecorationLine = inserted ? "underline" : "line-through";
  } else {
    element.style.textDecorationLine = "none";
    if (!inserted) element.style.display = "none";
  }
  return element;
}

/** @internal */
export interface BlockOptions {
  /** `markup` (the default): insertions underlined, deletions struck through; `simple`, `final`: as if accepted. */
  review?: ReviewView;
  /** Fields show their codes instead of their results (Word's Alt+F9). */
  fieldCodes?: boolean;
  /**
   * The ratio of a font's normal line height to its size (`fontFamily`: a CSS font-family
   * list). Word's single line spacing is the font's own line height; multiples scale it.
   * Measured by the page layout; 1.2 when nothing measures (no layout engine).
   */
  lineRatio?: (fontFamily: string) => number;
  /**
   * The URL to show a picture's image from (`key` in `resources`): the app's (a package part's
   * object URL…); `null` (or "") shows the picture's box. Left out, or undefined for a key: the
   * resource's own image `data:` URL or web URL (fetched as it is shown).
   */
  resource?: (key: string, resource: ResourceJSON) => string | null | undefined;
  /** The document's resolver, when the caller has one (a story of it, drawn per page). */
  resolver?: Resolver;
  /** What note references show, by story, and what a note's own mark shows (never stored). */
  notes?: { references?: ReadonlyMap<string, string>; mark?: string };
}

/**
 * On the element showing a note reference's number: the note's story.
 * @internal
 */
export const NOTE_REF_ATTR = "data-foli-note-ref";
/**
 * On a number drawn for a note, at its reference or its mark: not text of the document.
 * @internal
 */
export const NOTE_NUMBER_ATTR = "data-foli-note-number";

/** Word's footnote separator is two inches long; its continuation line here is the same. */
const SEPARATOR_WIDTH = 192;

/**
 * The line a separator run draws, when `xml` is one (`w:separator`, `w:continuationSeparator`).
 * @internal
 */
export function separatorElement(xml: Element | null, doc: Document): HTMLElement | null {
  if (!xml) return null;
  const found = [xml, ...xml.getElementsByTagName("*")].some(
    (e) => e.localName === "separator" || e.localName === "continuationSeparator",
  );
  if (!found) return null;
  const line = doc.createElement("span");
  line.dataset.foliSeparator = "";
  const { style } = line;
  style.display = "inline-block";
  style.width = `${SEPARATOR_WIDTH}px`;
  style.maxWidth = "100%";
  style.height = "0";
  style.borderTop = "1px solid #000";
  style.verticalAlign = "middle";
  return line;
}

/**
 * The source for a document's pictures: the app's URL, else the resource's own.
 * @internal
 */
export function imageSource(
  resources: Readonly<Record<string, ResourceJSON>> | undefined,
  resolve?: (key: string, resource: ResourceJSON) => string | null | undefined,
): ImageSource {
  return (key) => {
    const resource = resources && Object.hasOwn(resources, key) ? resources[key] : undefined;
    if (!resource) return undefined;
    const url = resolve?.(key, resource);
    // The app's answer stands, a refusal (null, "") included.
    return url === undefined ? ownImageUrl(resource) : url || undefined;
  };
}

/**
 * A rendered block and what the page flow needs to know about it.
 * @internal
 */
export interface WordBlock {
  element: HTMLElement;
  /** Indices in the document's content of the nodes it shows (several when paragraphs merged). */
  nodes: number[];
  /** Space before and after, in CSS px (Word adds them: the flow places them). */
  before: number;
  after: number;
  keepNext: boolean;
  keepLines: boolean;
  pageBreakBefore: boolean;
  /** The page setup of the section this block ends (null: the section goes on). */
  section: SectionJSON | null;
}

/**
 * Metric-compatible open fonts for Word's common fonts: the same advance widths and line
 * heights, so text breaks into the same lines where the original is not installed.
 */
const SUBSTITUTES: Record<string, string[]> = {
  calibri: ["Carlito"],
  cambria: ["Caladea"],
  arial: ["Liberation Sans", "Arimo"],
  "times new roman": ["Liberation Serif", "Tinos"],
  "courier new": ["Liberation Mono", "Cousine"],
  georgia: ["Gelasio"],
};
const SERIF = new Set(["cambria", "times new roman", "georgia", "garamond", "book antiqua"]);
const MONOSPACE = new Set(["courier new", "consolas", "courier"]);

/**
 * A CSS font-family list for a Word font name: the font, its substitutes, a generic family.
 * @internal
 */
export function fontStack(name: string | null): string {
  const font = name ?? "Times New Roman";
  const key = font.toLowerCase();
  const generic = SERIF.has(key) ? "serif" : MONOSPACE.has(key) ? "monospace" : "sans-serif";
  const quote = (f: string) => `"${f.replace(/["\\]/g, "")}"`;
  const substitutes = Object.hasOwn(SUBSTITUTES, key) ? (SUBSTITUTES[key] as string[]) : [];
  return [font, ...substitutes].map(quote).concat(generic).join(", ");
}

/** Word's highlight colors (`w:highlight`). */
const HIGHLIGHTS: Record<string, string> = {
  black: "#000000",
  blue: "#0000FF",
  cyan: "#00FFFF",
  green: "#00FF00",
  magenta: "#FF00FF",
  red: "#FF0000",
  yellow: "#FFFF00",
  white: "#FFFFFF",
  darkBlue: "#000080",
  darkCyan: "#008080",
  darkGreen: "#008000",
  darkMagenta: "#800080",
  darkRed: "#800000",
  darkYellow: "#808000",
  darkGray: "#808080",
  lightGray: "#C0C0C0",
};

const UNDERLINES: Record<string, string> = {
  double: "double",
  dotted: "dotted",
  dottedHeavy: "dotted",
  dash: "dashed",
  dashedHeavy: "dashed",
  dashLong: "dashed",
  wave: "wavy",
  wavyHeavy: "wavy",
  wavyDouble: "wavy",
};

const ALIGN: Record<string, string> = {
  left: "left",
  start: "left",
  right: "right",
  end: "right",
  center: "center",
  both: "justify",
  distribute: "justify",
};

const BORDER_STYLES: Record<string, string> = {
  double: "double",
  dotted: "dotted",
  dashed: "dashed",
  dashSmallGap: "dashed",
  none: "none",
  nil: "none",
};

/**
 * The one font name a run shows for Latin text.
 * @internal
 */
export const latin = (run: RunFormat) => run.font.ascii ?? run.font.hAnsi;

/**
 * A line height in CSS for text in `run` (`ratio`: its font's normal line height ratio).
 * @internal
 */
export function lineHeight(paragraph: ParagraphFormat, run: RunFormat, ratio: number): string {
  const sizePx = (run.size / 2) * (96 / 72);
  const { line, lineRule } = paragraph.spacing;
  if (line === null) return String(ratio);
  if (lineRule === "exact") return `${line * PX_PER_TWIP}px`;
  if (lineRule === "atLeast") return `${Math.max(line * PX_PER_TWIP, ratio * sizePx)}px`;
  return String((ratio * line) / 240);
}

/**
 * Run formatting as inline CSS on `element`.
 * @internal
 */
export function styleRun(element: HTMLElement, run: RunFormat, line: string): void {
  const { style } = element;
  style.fontFamily = fontStack(latin(run));
  style.fontSize = `${run.size / 2}pt`;
  style.lineHeight = line;
  style.fontWeight = run.bold ? "700" : "400";
  style.fontStyle = run.italic ? "italic" : "normal";
  const decorations = [];
  if (run.underline) decorations.push("underline");
  if (run.strike || run.doubleStrike) decorations.push("line-through");
  if (decorations.length) {
    style.textDecorationLine = decorations.join(" ");
    if (run.doubleStrike || run.underline === "double") style.textDecorationStyle = "double";
    else if (run.underline && UNDERLINES[run.underline])
      style.textDecorationStyle = UNDERLINES[run.underline] as string;
    if (run.underlineColor && run.underlineColor !== "auto")
      style.textDecorationColor = `#${run.underlineColor}`;
  }
  if (run.caps) style.textTransform = "uppercase";
  if (run.smallCaps) style.fontVariant = "small-caps";
  if (run.color) style.color = `#${run.color}`;
  const background = run.highlight ? HIGHLIGHTS[run.highlight] : run.shading && `#${run.shading}`;
  if (background) style.backgroundColor = background;
  if (run.verticalAlign !== "baseline") {
    // Word raises or lowers a smaller copy without growing the line.
    style.verticalAlign = run.verticalAlign === "superscript" ? "super" : "sub";
    style.fontSize = `${(run.size / 2) * (2 / 3)}pt`;
    style.lineHeight = "0";
  }
  if (run.characterSpacing) style.letterSpacing = `${run.characterSpacing * PX_PER_TWIP}px`;
  if (run.hidden) style.display = "none";
}

/**
 * Paragraph properties as inline CSS on `element` (spacing is the flow's).
 * @internal
 */
export function styleParagraph(element: HTMLElement, paragraph: ParagraphFormat): void {
  const { style } = element;
  style.margin = "0";
  style.whiteSpace = "pre-wrap";
  style.overflowWrap = "break-word";
  // Word's default tab stops: every half inch.
  style.tabSize = `${720 * PX_PER_TWIP}px`;
  const { left, right, firstLine, hanging } = paragraph.indent;
  style.paddingLeft = `${left * PX_PER_TWIP}px`;
  style.paddingRight = `${right * PX_PER_TWIP}px`;
  style.textIndent = `${(firstLine - hanging) * PX_PER_TWIP}px`;
  const align = paragraph.justification && ALIGN[paragraph.justification];
  if (align) style.textAlign = align;
  if (paragraph.shading?.fill && paragraph.shading.fill !== "auto")
    style.backgroundColor = `#${paragraph.shading.fill}`;
  for (const [side, border] of Object.entries(paragraph.borders ?? {})) {
    if (!border || side === "between" || side === "bar") continue;
    const kind = BORDER_STYLES[border.style] ?? "solid";
    // Sizes in eighths of a point; the space between text and border in points.
    const width = kind === "none" ? 0 : Math.max(((border.size ?? 4) / 8) * (96 / 72), 1);
    const color = border.color && border.color !== "auto" ? `#${border.color}` : "currentColor";
    style.setProperty(`border-${side}`, `${width}px ${kind} ${color}`);
    style.setProperty(`padding-${side}`, `${((border.space ?? 0) * 96) / 72}px`);
  }
}

/**
 * Opaque XML not shown in the line: a text box's content (it floats; shortcut: not shown until
 * Phase 11 lays out drawings) and the fallback copy of alternate content (`mc:Fallback`, the
 * same drawing again for older readers).
 */
const NOT_INLINE = new Set(["txbxContent", "Fallback"]);

/**
 * Text a run of opaque XML shows: its `w:t` elements (field results, content controls).
 * @internal
 */
export function opaqueText(element: Element): string {
  let text = "";
  for (const node of element.children) {
    if (NOT_INLINE.has(node.localName)) continue;
    if (node.localName === "t") text += node.textContent;
    else if (node.localName === "tab") text += "\t";
    else text += opaqueText(node);
  }
  return text;
}

/**
 * Opaque XML's text, a line per paragraph (`w:p`), or its runs' text when it has none.
 * @internal
 */
export function opaqueParagraphsText(element: Element): string {
  const paragraphs = [...element.getElementsByTagName("*")].filter((e) => e.localName === "p");
  if (element.localName === "p") paragraphs.unshift(element);
  return paragraphs.length ? paragraphs.map(opaqueText).join("\n") : opaqueText(element);
}

/**
 * The outermost descendants of opaque XML with one of `names` (local names), in order: not those
 * inside a match (a run's text box, a cell's nested table) or content not shown in the line.
 */
function outermost(element: Element, names: ReadonlySet<string>): Element[] {
  const found: Element[] = [];
  for (const node of element.children) {
    if (names.has(node.localName)) found.push(node);
    else if (!NOT_INLINE.has(node.localName)) found.push(...outermost(node, names));
  }
  return found;
}
const PARAGRAPHS = new Set(["p"]);
const RUNS = new Set(["r"]);
const ROWS = new Set(["tr"]);
const CELLS = new Set(["tc"]);
const CELL_CONTENT = new Set(["p", "tbl"]);

/**
 * Parses verbatim WordprocessingML (opaque content) into an inert XML document, declaring the
 * prefixes it uses; null when it is not well-formed.
 * @internal
 */
export function parseOpaque(xml: string, doc: Document): Element | null {
  const view = doc.defaultView;
  if (!view?.DOMParser) return null;
  const prefixes = new Set<string>();
  for (const match of xml.matchAll(/<\/?([A-Za-z_][\w.-]*):|\s([A-Za-z_][\w.-]*):[\w.-]+\s*=/g)) {
    const prefix = match[1] ?? match[2];
    if (prefix && prefix !== "xml" && prefix !== "xmlns") prefixes.add(prefix);
  }
  const declarations = [...prefixes].map((p) => ` xmlns:${p}="urn:foli:${p}"`).join("");
  const parsed = new view.DOMParser().parseFromString(
    `<foli${declarations}>${xml}</foli>`,
    "application/xml",
  );
  const root = parsed.documentElement;
  if (root.localName !== "foli" || parsed.getElementsByTagName("parsererror").length) return null;
  return root.firstElementChild;
}

/**
 * Renders a document's blocks. `final` review merges a paragraph whose mark was deleted into
 * the next one, as accepting the deletion does.
 * @internal
 */
export function renderBlocks(
  document: FoliDocument,
  doc: Document,
  options: BlockOptions = {},
): WordBlock[] {
  const review = options.review ?? "markup";
  const codes = options.fieldCodes === true;
  const ratios = new Map<string, number>();
  const ratio = (family: string) => {
    let value = ratios.get(family);
    if (value === undefined) {
      value = options.lineRatio?.(family) ?? 1.2;
      ratios.set(family, value);
    }
    return value;
  };
  const resolver = options.resolver ?? new Resolver(document);
  const image = imageSource(document.resources, options.resource);
  // shortcut: floating pictures are placed against the last section's page.
  const geometry = floatGeometry(document.section);
  const content = document.content.content ?? [];
  const attrsOf = (node: NodeJSON) => (node.attrs ?? {}) as Record<string, unknown>;
  // In the final and simple views a paragraph whose mark was deleted joins the next paragraph
  // (not a table, and the document's last mark cannot be deleted).
  const joins = (index: number) => {
    const node = content[index];
    const revision = node && (attrsOf(node).revision as { deletion?: unknown } | null | undefined);
    return (
      review !== "markup" &&
      node?.type === "paragraph" &&
      !!revision?.deletion &&
      content[index + 1]?.type === "paragraph"
    );
  };
  // A joined paragraph is numbered once, with the first paragraph's marker.
  const markers = resolver.markers(
    content.map((node, index) =>
      node.type === "paragraph" && !joins(index - 1) ? attrsOf(node) : { numbering: { id: 0 } },
    ),
  );
  const blocks: WordBlock[] = [];
  const displays = fieldDisplay(content.map(inlineTypes), codes);
  let carried: { nodes: number[]; inline: NodeJSON[]; display: FieldDisplay } | null = null;
  /** Comment ranges open at this point of the document. */
  const comments = new Set<number>();

  content.forEach((node, index) => {
    if (node.type !== "paragraph") {
      blocks.push(
        opaqueBlock(node, index, resolver, doc, ratio, image, geometry, codes, options.notes),
      );
      return;
    }
    const attrs = attrsOf(node);
    const own = displays[index] as FieldDisplay;
    if (joins(index)) {
      const previous = carried ?? { nodes: [], inline: [], display: NO_DISPLAY };
      carried = {
        nodes: [...previous.nodes, index],
        inline: [...previous.inline, ...(node.content ?? [])],
        display: joinDisplays(previous.display, previous.inline.length, own),
      };
      return;
    }
    const merged = carried ?? { nodes: [], inline: [] as NodeJSON[], display: NO_DISPLAY };
    carried = null;
    const display = joinDisplays(merged.display, merged.inline.length, own);
    const { paragraph, run } = resolver.paragraph(attrs);
    const element = doc.createElement(tagOf(paragraph));
    styleParagraph(element, paragraph);
    // The line's own height is the paragraph mark's (Word has none but its runs' and the mark's).
    const mark = resolver.run(run, (attrs.markFormat ?? []) as MarkJSON[]);
    styleRun(element, mark, lineHeight(paragraph, mark, ratio(fontStack(latin(mark)))));
    const marker = markers[index];
    const firstMerged = merged.nodes[0];
    const shownMarker = firstMerged !== undefined ? (markers[firstMerged] ?? null) : marker;
    if (shownMarker) element.append(markerElement(shownMarker, paragraph, doc, ratio));
    const inline = [...merged.inline, ...(node.content ?? [])];
    renderInline(element, inline, run, paragraph, {
      resolver,
      doc,
      review,
      comments,
      ratio,
      image,
      geometry,
      codes,
      display,
      notes: options.notes,
    });
    if (display.gone) element.style.display = "none";
    if (
      onlyPictures(
        inline,
        (node) => node.type,
        (node) => !!node.attrs?.float,
      )
    )
      for (const picture of element.querySelectorAll<HTMLElement>(`[${PICTURE_ATTR}]`))
        picture.style.verticalAlign = "bottom";
    // An empty paragraph, or one ending in a line break, shows its last (empty) line; after a
    // page break the paragraph mark stays on the break's line, as in Word.
    const last = element.lastChild as Element | null;
    const endsInBreak = last?.nodeName === "BR";
    if (
      (endsInBreak && !last?.hasAttribute(WORD_PAGE_BREAK_ATTR)) ||
      (!endsInBreak && !element.textContent)
    )
      element.append(doc.createElement("br"));
    const pt = (twips: number) => twips * PX_PER_TWIP;
    const { before, after } = paragraph.spacing;
    // Word's automatic spacing (HTML): 14 pt.
    const spaceBefore = paragraph.spacing.beforeAutospacing ? 280 : before;
    const spaceAfter = paragraph.spacing.afterAutospacing ? 280 : after;
    blocks.push({
      element,
      nodes: [...merged.nodes, index],
      before: display.gone ? 0 : pt(spaceBefore),
      after: display.gone ? 0 : pt(spaceAfter),
      keepNext: paragraph.keepNext,
      keepLines: paragraph.keepLines,
      pageBreakBefore: paragraph.pageBreakBefore,
      section: (attrs.section as SectionJSON | null | undefined) ?? null,
    });
    element.dataset.style = paragraph.style ?? "";
    if (paragraph.contextualSpacing) element.dataset.contextual = "";
  });
  applyContextualSpacing(blocks, resolver.addsParagraphSpacing);
  return blocks;
}

const NO_DISPLAY = fieldDisplay([[]], false)[0] as FieldDisplay;
const inlineTypes = (node: NodeJSON) =>
  node.type === "paragraph" ? (node.content ?? []).map((child) => child.type) : [];

/** `after`, whose nodes follow `length` others, added to `before` (paragraphs drawn as one). */
function joinDisplays(before: FieldDisplay, length: number, after: FieldDisplay): FieldDisplay {
  if (!length) return after;
  return {
    hidden: new Set([...before.hidden, ...[...after.hidden].map((i) => i + length)]),
    braces: new Map([
      ...before.braces,
      ...[...after.braces].map(([i, b]) => [i + length, b] as const),
    ]),
    gone: before.gone && after.gone,
  };
}

/**
 * Whether a paragraph's line holds nothing but inline pictures: Word's line then ends at the
 * picture's foot (its PDFs of the corpus: no room below it for the text it does not have).
 * @internal
 */
export function onlyPictures<T>(
  inline: Iterable<T>,
  type: (node: T) => string,
  floats: (node: T) => boolean,
): boolean {
  let found = false;
  for (const node of inline) {
    const name = type(node);
    if (name === "picture") found ||= !floats(node);
    else if (!INVISIBLE.has(name)) return false;
  }
  return found;
}

const INVISIBLE = new Set([
  "bookmarkStart",
  "bookmarkEnd",
  "commentStart",
  "commentEnd",
  "commentReference",
  "controlStart",
  "controlEnd",
  "fieldStart",
  "fieldCode",
  "fieldSeparator",
  "fieldEnd",
]);

/**
 * The top margin of a paragraph after another (whose space after is `above`) in a box the page
 * flow does not lay out (a table cell). Adjacent margins collapse to the larger: Word's rule. In
 * a document where the two spaces add up this margin holds both, so the collapse gives the sum
 * and no paragraph's shading or border grows.
 * @internal
 */
export function marginAbove(before: number, above: number, resolver: Resolver): number {
  return resolver.addsParagraphSpacing ? before + above : before;
}

/**
 * A paragraph's element: a heading of its outline level (1-6), else a paragraph.
 * @internal
 */
export function tagOf(paragraph: ParagraphFormat): string {
  const level = paragraph.outlineLevel;
  return level !== null && level >= 0 && level < 6 ? `h${level + 1}` : "p";
}

/**
 * Word ignores the space between paragraphs of the same style that ask for it. When only the
 * first asks, its space after still eats into the second's space before, unless the document
 * adds the two (`adds`).
 */
function applyContextualSpacing(blocks: WordBlock[], adds: boolean): void {
  for (let i = 1; i < blocks.length; i++) {
    const a = blocks[i - 1] as WordBlock;
    const b = blocks[i] as WordBlock;
    const style = a.element.dataset.style;
    if (style === undefined || style !== b.element.dataset.style) continue;
    const first = "contextual" in a.element.dataset;
    const second = "contextual" in b.element.dataset;
    if (second) b.before = 0;
    else if (first && !adds) b.before = Math.max(0, b.before - a.after);
    if (first) a.after = 0;
  }
}

/** Symbol and Wingdings bullets (`w:lvlText`, private-use code points) as Unicode. */
const SYMBOLS: Record<string, string> = {
  "\uF0B7": "\u2022", // Symbol: bullet
  "\uF0A7": "\u25AA", // Wingdings: small black square
  "\uF0A8": "\u25FB", // Wingdings: white medium square
  "\uF06C": "\u25CF", // Wingdings: black circle
  "\uF06E": "\u25A0", // Wingdings: black square
  "\uF071": "\u2751", // Wingdings: shadowed white square
  "\uF075": "\u25C6", // Wingdings: black diamond
  "\uF076": "\u2756", // Wingdings: black diamond minus white X
  "\uF0D8": "\u27A2", // Wingdings: arrowhead
  "\uF0FC": "\u2713", // Wingdings: check mark
};

/**
 * A list marker: its text, then what follows it (a tab to the text's indent, a space).
 * @internal
 */
export function markerElement(
  marker: ListMarker,
  paragraph: ParagraphFormat,
  doc: Document,
  ratio: (family: string) => number,
): HTMLElement {
  const span = doc.createElement("span");
  span.dataset.foliMarker = "";
  span.setAttribute("aria-hidden", "true");
  styleRun(
    span,
    marker.run,
    lineHeight(paragraph, marker.run, ratio(fontStack(latin(marker.run)))),
  );
  span.textContent = marker.text;
  // Bullets in Symbol and Wingdings are private-use code points: shown as the Unicode
  // character they draw, in a font that has it.
  const font = latin(marker.run)?.toLowerCase();
  const glyph =
    font === "symbol" || font?.startsWith("wingdings") ? SYMBOLS[marker.text] : undefined;
  if (glyph) {
    span.textContent = glyph;
    span.style.fontFamily = "sans-serif";
  }
  const hanging = paragraph.indent.hanging * PX_PER_TWIP;
  if (marker.suffix === "tab" && hanging > 0) {
    // shortcut: a marker wider than the hanging indent goes to the next default tab stop in
    // Word; here the text follows it directly.
    span.style.display = "inline-block";
    span.style.minWidth = `${hanging}px`;
    span.style.textIndent = "0";
  } else if (marker.suffix === "tab") span.textContent += "\t";
  else if (marker.suffix === "space") span.textContent += " ";
  return span;
}

interface InlineContext {
  resolver: Resolver;
  doc: Document;
  review: ReviewView;
  comments: Set<number>;
  ratio: (family: string) => number;
  image?: ImageSource | undefined;
  /** The page floating pictures are positioned against. */
  geometry: FloatGeometry;
  /** Whether fields show their codes. */
  codes: boolean;
  /** What these nodes show of their fields. */
  display: FieldDisplay;
  notes: BlockOptions["notes"] | undefined;
}

/** A paragraph's inline content: runs as spans, breaks, comment anchors, opaque inline content. */
function renderInline(
  parent: HTMLElement,
  inline: readonly NodeJSON[],
  paragraphRun: RunFormat,
  paragraph: ParagraphFormat,
  context: InlineContext,
): void {
  const { resolver, doc, review, comments, ratio, image, codes, display } = context;
  const floats: HTMLElement[] = [];
  for (const [index, node] of inline.entries()) {
    if (display.hidden.has(index)) continue;
    const marks = (node.marks ?? []) as MarkJSON[];
    const inserted = marks.some((m) => m.type === "insertion");
    const deleted = marks.some((m) => m.type === "deletion");
    if (deleted && review !== "markup") continue;
    const attrs = (node.attrs ?? {}) as Record<string, unknown>;
    switch (node.type) {
      case "commentStart":
        comments.add(attrs.id as number);
        continue;
      case "commentEnd":
        comments.delete(attrs.id as number);
        continue;
      case "commentReference": {
        const anchor = doc.createElement("span");
        anchor.dataset.foliCommentReference = String(attrs.id);
        parent.append(anchor);
        continue;
      }
      case "bookmarkStart": {
        // Where a link to it goes (`@folijs/pdf`); out of the flow, so no line changes.
        const mark = doc.createElement("span");
        mark.dataset.foliBookmark = String(attrs.name ?? "");
        mark.style.position = "absolute";
        parent.append(mark);
        continue;
      }
      case "bookmarkEnd":
      case "controlStart":
      case "controlEnd":
        continue;
      case "picture":
        if (attrs.float) floats.push(...floatElements(attrs, doc, image, context.geometry).nodes);
        else parent.append(pictureElement(attrs, doc, image));
        continue;
      case "hardBreak":
        parent.append(doc.createElement("br"));
        continue;
      case "columnBreak": {
        const br = doc.createElement("br");
        br.setAttribute(WORD_COLUMN_BREAK_ATTR, "");
        parent.append(br);
        continue;
      }
      case "pageBreak": {
        const br = doc.createElement("br");
        br.setAttribute(WORD_PAGE_BREAK_ATTR, "");
        parent.append(br);
        continue;
      }
      default:
    }
    const code =
      display.braces.get(index) ?? (codes && node.type === "fieldCode" ? String(attrs.text) : "");
    let text: string;
    if (code) text = code;
    else if (node.type === "text") text = node.text ?? "";
    else if (node.type === "tab") text = "\t";
    else if (node.type === "noteReference")
      text = context.notes?.references?.get(String(attrs.story)) ?? "";
    else if (node.type === "noteMark") text = context.notes?.mark ?? "";
    // A custom node without its extension here (ADR-0008): its `.docx` text, else its type.
    else if (CUSTOM_TYPE.test(node.type)) text = foreignTextOf(node) ?? `[${node.type}]`;
    else if (node.type === "opaqueInline") {
      const xml = parseOpaque(String(attrs.xml ?? ""), doc);
      const separator = separatorElement(xml, doc);
      if (separator) {
        parent.append(separator);
        continue;
      }
      // A run's content (a drawing, a field character) shows as nothing; a content control or
      // simple field as its text.
      text = xml ? opaqueText(xml) : "";
      if (!text) {
        const placeholder = doc.createElement("span");
        placeholder.dataset.foliOpaque = String(attrs.label ?? "");
        parent.append(placeholder);
        continue;
      }
    } else continue;
    const run = resolver.run(paragraphRun, marks);
    let element: HTMLElement = doc.createElement("span");
    styleRun(element, run, lineHeight(paragraph, run, ratio(fontStack(latin(run)))));
    element.textContent = text;
    if (node.type === "noteReference") element.setAttribute(NOTE_REF_ATTR, String(attrs.story));
    if (node.type === "noteReference" || node.type === "noteMark")
      element.setAttribute(NOTE_NUMBER_ATTR, "");
    const link = marks.find((m) => m.type === "link");
    if (link) element.dataset.href = String(link.attrs?.href ?? `#${String(link.attrs?.anchor)}`);
    if (comments.size) {
      element.dataset.foliComments = [...comments].join(" ");
      if (!run.highlight && !run.shading)
        element.style.backgroundColor = "rgba(255, 213, 79, 0.35)";
    }
    if (review === "markup" && (inserted || deleted)) {
      // Inserted, then deleted: shown as deleted, in the deleting author's color.
      const change = marks.find((m) => m.type === (deleted ? "deletion" : "insertion"))?.attrs;
      const author = String(change?.author ?? "");
      const date = (change?.date as string | null | undefined) ?? null;
      const wrapper = changeElement(doc, !deleted, author, date, review);
      wrapper.append(element);
      element = wrapper;
    }
    parent.append(element);
  }
  // Floating pictures first in the paragraph, in order: lines from its top go around them.
  parent.prepend(...floats);
}

/**
 * A block the model keeps opaque (tables until Phase 10, block content controls), shown from
 * its XML: a table as a table of its cells' paragraphs, anything else as its paragraphs. Only
 * text is read: no formatting beyond the paragraph styles.
 * @internal
 */
export function opaqueBlock(
  node: NodeJSON,
  index: number,
  resolver: Resolver,
  doc: Document,
  ratio: (family: string) => number,
  image?: ImageSource,
  /** The page floating pictures in its cells are placed against. */
  geometry: FloatGeometry = floatGeometry(undefined),
  codes = false,
  notes?: BlockOptions["notes"],
): WordBlock {
  const attrs = (node.attrs ?? {}) as Record<string, unknown>;
  const element = doc.createElement("div");
  element.dataset.foliOpaque = String(attrs.label ?? "");
  element.style.margin = "0";
  element.style.display = "flow-root";
  const xml = node.type === "table" ? null : parseOpaque(String(attrs.xml ?? ""), doc);
  let after = 0;
  if (node.type === "table")
    element.append(modelTable(node, resolver, doc, ratio, image, geometry, codes, notes));
  else if (xml?.localName === "tbl") element.append(opaqueTable(xml, resolver, doc, ratio));
  else if (xml) {
    const paragraphs = outermost(xml, PARAGRAPHS);
    let above = 0;
    paragraphs.forEach((p, i) => {
      const rendered = opaqueParagraph(p, resolver, doc, ratio, above);
      if (i < paragraphs.length - 1) rendered.element.style.marginBottom = `${rendered.after}px`;
      else after = rendered.after;
      above = rendered.after;
      element.append(rendered.element);
    });
  }
  if (!element.firstChild) {
    // Nothing to show: a placeholder line.
    element.style.minHeight = "1em";
    element.style.outline = "1px dashed #999";
  }
  return {
    element,
    nodes: [index],
    before: 0,
    after,
    keepNext: false,
    keepLines: false,
    pageBreakBefore: false,
    section: null,
  };
}

/** The value of a WordprocessingML child's `w:val` (by local names). */
function childValue(element: Element | null | undefined, name: string, attribute = "val") {
  for (const child of element?.children ?? []) {
    if (child.localName !== name) continue;
    for (const a of child.attributes) if (a.localName === attribute) return a.value;
  }
  return undefined;
}
function child(element: Element | null | undefined, name: string): Element | undefined {
  for (const c of element?.children ?? []) if (c.localName === name) return c;
  return undefined;
}

/** A paragraph of opaque XML: its style's formatting and its text. */
function opaqueParagraph(
  p: Element,
  resolver: Resolver,
  doc: Document,
  ratio: (family: string) => number,
  /** The space after the paragraph before it in its box. */
  above = 0,
): { element: HTMLElement; after: number } {
  const pPr = child(p, "pPr");
  const style = childValue(pPr, "pStyle");
  const justification = childValue(pPr, "jc");
  const { paragraph, run } = resolver.paragraph({
    ...(style ? { style } : {}),
    ...(justification ? { justification } : {}),
  });
  const element = doc.createElement(tagOf(paragraph));
  styleParagraph(element, paragraph);
  styleRun(element, run, lineHeight(paragraph, run, ratio(fontStack(latin(run)))));
  for (const r of outermost(p, RUNS)) {
    // Deleted text is `w:delText`: not read, in markup too (shortcut: shown as accepted).
    const text = opaqueText(r);
    const formatted = resolver.run(run, runMarks(child(r, "rPr")));
    const span = doc.createElement("span");
    styleRun(span, formatted, lineHeight(paragraph, formatted, ratio(fontStack(latin(formatted)))));
    span.textContent = text;
    element.append(span);
  }
  if (!element.textContent) element.append(doc.createElement("br"));
  const top = marginAbove(paragraph.spacing.before * PX_PER_TWIP, above, resolver);
  if (top) element.style.marginTop = `${top}px`;
  return { element, after: paragraph.spacing.after * PX_PER_TWIP };
}

/** The run properties of verbatim XML Foli reads for showing it (`w:rPr`) as marks. */
function runMarks(rPr: Element | undefined): MarkJSON[] {
  const marks: MarkJSON[] = [];
  const on = (name: string) => {
    const value = childValue(rPr, name);
    return value === undefined || !["0", "false", "off"].includes(value);
  };
  const style = childValue(rPr, "rStyle");
  if (style) marks.push({ type: "characterStyle", attrs: { id: style } });
  for (const [name, type] of [
    ["b", "bold"],
    ["i", "italic"],
    ["caps", "caps"],
    ["smallCaps", "smallCaps"],
    ["strike", "strike"],
  ] as const)
    if (child(rPr, name)) marks.push({ type, attrs: { value: on(name) } });
  const underline = childValue(rPr, "u");
  if (underline) marks.push({ type: "underline", attrs: { style: underline } });
  const color = childValue(rPr, "color");
  if (color) marks.push({ type: "color", attrs: { value: color } });
  const size = Number(childValue(rPr, "sz"));
  if (size > 0) marks.push({ type: "fontSize", attrs: { value: size } });
  const highlight = childValue(rPr, "highlight");
  if (highlight) marks.push({ type: "highlight", attrs: { value: highlight } });
  return marks;
}

/** A WordprocessingML border (`w:top`, `w:insideH`…) as CSS; undefined when it says none. */
function borderCss(border: Element | undefined): string | undefined {
  if (!border) return undefined;
  const value = childValueOf(border, "val") ?? "single";
  if (value === "nil" || value === "none") return "none";
  const size = Number(childValueOf(border, "sz") ?? 4);
  const color = childValueOf(border, "color");
  const kind = BORDER_STYLES[value] ?? "solid";
  // Sizes in eighths of a point.
  const width = Math.max((size / 8) * (96 / 72), 0.5);
  return `${width}px ${kind} ${color && color !== "auto" ? `#${color}` : "#000"}`;
}

/** Cell margins (`w:tblCellMar`, `w:tcMar`) in px by side, over `base`. */
function margins(element: Element | undefined, base: Record<string, number>) {
  const out = { ...base };
  for (const side of element?.children ?? []) {
    const name =
      side.localName === "start" ? "left" : side.localName === "end" ? "right" : side.localName;
    const width = Number(childValueOf(side, "w"));
    if (name in out && Number.isFinite(width)) out[name] = width * PX_PER_TWIP;
  }
  return out;
}

/** A table of opaque XML: rows, cells (spans, widths, margins, borders, shading) and their paragraphs. */
function opaqueTable(
  tbl: Element,
  resolver: Resolver,
  doc: Document,
  ratio: (family: string) => number,
): HTMLElement {
  const table = doc.createElement("table");
  const { style } = table;
  style.borderCollapse = "collapse";
  style.tableLayout = "fixed";
  const tblPr = child(tbl, "tblPr");
  const borders = child(tblPr, "tblBorders");
  for (const side of ["top", "left", "bottom", "right"]) {
    const css = borderCss(child(borders, side));
    if (css) style.setProperty(`border-${side}`, css);
  }
  // Word's default cell margins: 0.08 inch left and right.
  const tableMargins = margins(child(tblPr, "tblCellMar"), {
    top: 0,
    bottom: 0,
    left: 108 * PX_PER_TWIP,
    right: 108 * PX_PER_TWIP,
  });
  const grid = [...(child(tbl, "tblGrid")?.children ?? [])]
    .filter((c) => c.localName === "gridCol")
    .map((c) => Number(childValueOf(c, "w")) || 0);
  const total = grid.reduce((a, b) => a + b, 0);
  if (total) style.width = `${total * PX_PER_TWIP}px`;
  const colgroup = doc.createElement("colgroup");
  for (const width of grid) {
    const col = doc.createElement("col");
    col.style.width = `${width * PX_PER_TWIP}px`;
    colgroup.append(col);
  }
  table.append(colgroup);
  const inside = {
    horizontal: borderCss(child(borders, "insideH")),
    vertical: borderCss(child(borders, "insideV")),
  };
  const body = doc.createElement("tbody");
  for (const tr of outermost(tbl, ROWS)) {
    const row = doc.createElement("tr");
    const trPr = child(tr, "trPr");
    // A header row, repeated at the top of each page the table continues on.
    const header = childValue(trPr, "tblHeader");
    if (child(trPr, "tblHeader") && header !== "0" && header !== "false")
      row.dataset.foliHeader = "";
    const rowMargins = margins(child(child(tr, "tblPrEx"), "tblCellMar"), tableMargins);
    for (const tc of outermost(tr, CELLS)) {
      const tcPr = child(tc, "tcPr");
      const cell = doc.createElement("td");
      const span = Number(childValue(tcPr, "gridSpan"));
      if (span > 1) cell.colSpan = span;
      const fill = childValue(tcPr, "shd", "fill");
      if (fill && fill !== "auto") cell.style.backgroundColor = `#${fill}`;
      const m = margins(child(tcPr, "tcMar"), rowMargins);
      cell.style.padding = `${m.top}px ${m.right}px ${m.bottom}px ${m.left}px`;
      cell.style.verticalAlign = "top";
      if (inside.horizontal) cell.style.borderTop = cell.style.borderBottom = inside.horizontal;
      if (inside.vertical) cell.style.borderLeft = cell.style.borderRight = inside.vertical;
      const own = child(tcPr, "tcBorders");
      for (const side of ["top", "left", "bottom", "right"]) {
        const css = borderCss(child(own, side));
        if (css) cell.style.setProperty(`border-${side}`, css);
      }
      // A cell merged into the one above shows nothing of its own.
      if (child(tcPr, "vMerge") && childValue(tcPr, "vMerge") !== "restart") {
        row.append(cell);
        continue;
      }
      let above = 0;
      for (const p of outermost(tc, CELL_CONTENT)) {
        if (p.localName === "tbl") {
          cell.append(opaqueTable(p, resolver, doc, ratio));
          above = 0;
          continue;
        }
        // Word counts the space after a cell's last paragraph in the row's height too.
        const rendered = opaqueParagraph(p, resolver, doc, ratio, above);
        rendered.element.style.marginBottom = `${rendered.after}px`;
        above = rendered.after;
        cell.append(rendered.element);
      }
      row.append(cell);
    }
    body.append(row);
  }
  table.append(body);
  return table;
}

/**
 * A border of the model (`BorderJSON`) as CSS; undefined when it says none.
 * @internal
 */
export function borderJsonCss(
  border: { style?: string; size?: number; color?: string } | undefined,
) {
  if (!border) return undefined;
  if (border.style === "nil" || border.style === "none") return "none";
  const width = Math.max(((border.size ?? 4) / 8) * (96 / 72), 0.5);
  const color = border.color && border.color !== "auto" ? `#${border.color}` : "#000";
  return `${width}px ${BORDER_STYLES[border.style ?? "single"] ?? "solid"} ${color}`;
}

/**
 * A table of the model (schema v4), read-only, as opaque tables are shown: rows, cells with
 * their table style's formatting (`Resolver.cell`), their paragraphs and nested tables.
 *
 * shortcut: `renderDocument`'s tables (the editing view draws its own, `table.ts`): one block,
 * split across pages as clips; a cell merged into the one above is shown empty, as opaque
 * tables are.
 */
function modelTable(
  node: NodeJSON,
  resolver: Resolver,
  doc: Document,
  ratio: (family: string) => number,
  image: ImageSource | undefined,
  geometry: FloatGeometry,
  codes: boolean,
  notes: BlockOptions["notes"],
): HTMLElement {
  const attrs = (node.attrs ?? {}) as Record<string, unknown>;
  const table = doc.createElement("table");
  table.style.borderCollapse = "collapse";
  table.style.tableLayout = "fixed";
  const grid = (attrs.grid as number[] | undefined) ?? [];
  const total = grid.reduce((a, b) => a + b, 0);
  if (total) table.style.width = `${total * PX_PER_TWIP}px`;
  const colgroup = doc.createElement("colgroup");
  for (const width of grid) {
    const col = doc.createElement("col");
    col.style.width = `${width * PX_PER_TWIP}px`;
    colgroup.append(col);
  }
  table.append(colgroup);
  const body = doc.createElement("tbody");
  const rows = node.content ?? [];
  const context = {
    resolver,
    doc,
    review: "markup" as const,
    comments: new Set<number>(),
    ratio,
    image,
    // shortcut: a floating picture in a cell is placed against the page, not its cell.
    geometry,
    codes,
  };
  rows.forEach((rowNode, r) => {
    const rowAttrs = (rowNode.attrs ?? {}) as Record<string, unknown>;
    const row = doc.createElement("tr");
    if (rowAttrs.header) row.dataset.foliHeader = "";
    if (rowAttrs.cantSplit) row.dataset.foliCantSplit = "";
    const cells = rowNode.content ?? [];
    cells.forEach((cellNode, c) => {
      const cellAttrs = (cellNode.attrs ?? {}) as Record<string, unknown>;
      const format = resolver.cell(attrs, rowAttrs, cellAttrs, {
        row: r,
        rows: rows.length,
        cell: c,
        cells: cells.length,
      });
      const cell = doc.createElement("td");
      const span = cellAttrs.gridSpan as number | undefined;
      if (span && span > 1) cell.colSpan = span;
      if (format.shading) cell.style.backgroundColor = `#${format.shading}`;
      const m = format.margins;
      cell.style.padding = `${m.top * PX_PER_TWIP}px ${m.right * PX_PER_TWIP}px ${m.bottom * PX_PER_TWIP}px ${m.left * PX_PER_TWIP}px`;
      cell.style.verticalAlign =
        format.verticalAlign === "center" ? "middle" : format.verticalAlign;
      for (const side of ["top", "left", "bottom", "right"] as const) {
        const css = borderJsonCss(format.borders[side]);
        if (css) cell.style.setProperty(`border-${side}`, css);
      }
      row.append(cell);
      if (cellAttrs.vMerge === "continue") return;
      let above = 0;
      const blocks = cellNode.content ?? [];
      const displays = fieldDisplay(blocks.map(inlineTypes), codes);
      for (const [b, block] of blocks.entries()) {
        if (block.type === "table") {
          cell.append(modelTable(block, resolver, doc, ratio, image, geometry, codes, notes));
          above = 0;
          continue;
        }
        if (block.type !== "paragraph") {
          cell.append(
            opaqueBlock(block, 0, resolver, doc, ratio, image, geometry, codes, notes).element,
          );
          above = 0;
          continue;
        }
        const { paragraph, run } = resolver.paragraph(block.attrs ?? {}, format);
        const element = doc.createElement(tagOf(paragraph));
        // A cell's paragraph: where it is on pages is measured too (`cellParagraphs`).
        element.dataset.foliCell = "";
        styleParagraph(element, paragraph);
        styleRun(element, run, lineHeight(paragraph, run, ratio(fontStack(latin(run)))));
        const display = displays[b] as FieldDisplay;
        renderInline(element, block.content ?? [], run, paragraph, {
          ...context,
          display,
          notes,
        });
        if (display.gone) element.style.display = "none";
        if (!element.textContent) element.append(doc.createElement("br"));
        const before = paragraph.spacing.before * PX_PER_TWIP;
        element.style.marginTop = `${marginAbove(before, above, resolver)}px`;
        // Word counts the space after a cell's last paragraph in the row's height too.
        above = paragraph.spacing.after * PX_PER_TWIP;
        element.style.marginBottom = `${above}px`;
        cell.append(element);
      }
    });
    body.append(row);
  });
  table.append(body);
  return table;
}

function childValueOf(element: Element, attribute: string): string | undefined {
  for (const a of element.attributes) if (a.localName === attribute) return a.value;
  return undefined;
}
