/**
 * Pictures (10.8, 10.9, ADR-0006): a `w:drawing` holding one DrawingML picture (`pic:pic`),
 * inline (`wp:inline`) or floating (`wp:anchor`, its position and wrapping as `float`), becomes
 * a `picture` node; its image part becomes a resource of the envelope, keyed by part name.
 * Charts, shapes and anything else stay opaque.
 */
import type { ResourceJSON } from "@folijs/core";
import type { XmlElement } from "../xml.js";
import { A, attr, integer, R, textOf } from "./ooxml.js";
import { type Context, sourceOf } from "./properties.js";

export const WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
export const PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const ADEC = "http://schemas.microsoft.com/office/drawing/2017/decorative";
const IMAGE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
/** The largest EMU the schema takes. */
const MAX_EMU = 2_147_483_647;
/** `wp:wrap*` to the model's wrapping (`wp:wrapNone` is behind or in front, by `behindDoc`). */
const WRAPS: Record<string, string> = {
  wrapSquare: "square",
  wrapTight: "tight",
  wrapThrough: "through",
  wrapTopAndBottom: "topAndBottom",
};
const SIDES = new Set(["bothSides", "left", "right", "largest"]);

export interface PictureContext extends Context {
  /** The part's relationship with this id. */
  readonly relationship: (
    id: string,
  ) => { type: string; external: boolean; partName?: string } | undefined;
  /** A part of the package by name. */
  readonly partOf: (name: string) => { contentType: string; data: Uint8Array } | undefined;
}

const kid = (el: XmlElement | undefined, ns: string, local: string) =>
  el?.children.find(
    (c): c is XmlElement => c.kind === "element" && c.ns === ns && c.local === local,
  );

function descendant(el: XmlElement | undefined, ns: string, local: string): XmlElement | undefined {
  if (!el) return undefined;
  for (const c of el.children) {
    if (c.kind !== "element") continue;
    if (c.ns === ns && c.local === local) return c;
    const found = descendant(c, ns, local);
    if (found) return found;
  }
  return undefined;
}

/** An attribute without a prefix (DrawingML's own). */
const plain = (el: XmlElement | undefined, local: string) =>
  el?.attributes.find((a) => a.local === local && !a.prefix)?.value;

const emu = (value: string | undefined) => {
  const n = integer(value);
  return n !== undefined && n >= 0 && n <= MAX_EMU ? n : undefined;
};

const flag = (value: string | undefined) =>
  value === "1" || value === "true" ? true : value === "0" || value === "false" ? false : undefined;

/** A `wp:positionH`/`wp:positionV`: where it is from, and its offset or alignment. */
function position(el: XmlElement | undefined) {
  const relativeTo = plain(el, "relativeFrom");
  if (!el || !relativeTo) return undefined;
  const offsetEl = kid(el, WP, "posOffset");
  const offset = offsetEl ? integer(textOf(offsetEl).trim()) : undefined;
  const align = kid(el, WP, "align");
  if (offset !== undefined && Math.abs(offset) <= MAX_EMU) return { relativeTo, offset };
  if (align) return { relativeTo, align: textOf(align).trim() };
  return undefined;
}

/** The `float` of a `wp:anchor`: undefined for one the model cannot hold (kept opaque). */
export function floatOf(anchor: XmlElement): Record<string, unknown> | undefined {
  const horizontal = position(kid(anchor, WP, "positionH"));
  const vertical = position(kid(anchor, WP, "positionV"));
  // `simplePos`: a position from the page's corner, which Word itself ignores unless set.
  if (!horizontal || !vertical || flag(plain(anchor, "simplePos")) === true) return undefined;
  const wrapEl = anchor.children.find(
    (c): c is XmlElement => c.kind === "element" && c.ns === WP && c.local.startsWith("wrap"),
  );
  const wrap = !wrapEl
    ? undefined
    : wrapEl.local === "wrapNone"
      ? flag(plain(anchor, "behindDoc"))
        ? "behind"
        : "inFront"
      : WRAPS[wrapEl.local];
  if (!wrap) return undefined;
  const side = plain(wrapEl, "wrapText");
  const distance = {
    top: emu(plain(anchor, "distT")) ?? 0,
    bottom: emu(plain(anchor, "distB")) ?? 0,
    left: emu(plain(anchor, "distL")) ?? 0,
    right: emu(plain(anchor, "distR")) ?? 0,
  };
  const allowOverlap = flag(plain(anchor, "allowOverlap"));
  const layoutInCell = flag(plain(anchor, "layoutInCell"));
  return {
    horizontal,
    vertical,
    wrap,
    ...(side && SIDES.has(side) ? { side } : {}),
    distance,
    ...(allowOverlap !== undefined ? { allowOverlap } : {}),
    ...(layoutInCell !== undefined ? { layoutInCell } : {}),
  };
}

/**
 * The picture node's attributes for `drawing`, its image added to `resources`; undefined for
 * a drawing Foli keeps opaque (not one inline picture, no embedded image part).
 */
export function pictureAttrs(
  drawing: XmlElement,
  context: PictureContext,
  /** Filled with the image's resource key and entry. */
  resource: [string?, ResourceJSON?] = [],
): Record<string, unknown> | undefined {
  const children = drawing.children.filter((c) => c.kind === "element");
  const inline = kid(drawing, WP, "inline") ?? kid(drawing, WP, "anchor");
  if (!inline || children.length !== 1) return undefined;
  const float = inline.local === "anchor" ? floatOf(inline) : null;
  if (float === undefined) return undefined;
  const data = descendant(inline, A, "graphicData");
  if (plain(data, "uri") !== PIC) return undefined;
  const blip = descendant(data, A, "blip");
  const id = attr(blip, "embed", R);
  const relationship = id === undefined ? undefined : context.relationship(id);
  if (!relationship || relationship.type !== IMAGE || relationship.external) return undefined;
  const name = relationship.partName;
  const part = name ? context.partOf(name) : undefined;
  if (!name || !part?.contentType.startsWith("image/")) return undefined;
  const extent = kid(inline, WP, "extent");
  const width = emu(plain(extent, "cx"));
  const height = emu(plain(extent, "cy"));
  if (width === undefined || height === undefined) return undefined;
  const key = name.replace(/^\//, "");
  // Added by the caller once the node is valid (a drawing kept opaque has no resource).
  resource.push(key, { contentType: part.contentType, size: part.data.length, part: key });
  const docPr = kid(inline, WP, "docPr");
  const alt = plain(docPr, "descr");
  const title = plain(docPr, "title");
  const decorative = plain(descendant(docPr, ADEC, "decorative"), "val");
  return {
    resource: key,
    width,
    height,
    // An empty description is kept as it is (it is not Word's missing one).
    ...(alt !== undefined ? { alt } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(decorative === "1" || decorative === "true" ? { decorative: true } : {}),
    ...(float ? { float } : {}),
    ext: sourceOf(context, drawing),
  };
}
