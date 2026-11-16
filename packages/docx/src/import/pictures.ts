/**
 * Pictures (10.8, ADR-0006): a `w:drawing` holding one inline DrawingML picture (`wp:inline`,
 * `pic:pic`) becomes a `picture` node; its image part becomes a resource of the envelope, keyed
 * by part name. Anchored (floating) pictures, charts, shapes and anything else stay opaque.
 */
import type { ResourceJSON } from "@folijs/core";
import type { XmlElement } from "../xml.js";
import { A, attr, integer, R } from "./ooxml.js";
import { type Context, sourceOf } from "./properties.js";

export const WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
export const PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const ADEC = "http://schemas.microsoft.com/office/drawing/2017/decorative";
const IMAGE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
/** The largest EMU the schema takes. */
const MAX_EMU = 2_147_483_647;

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
  const inline = kid(drawing, WP, "inline");
  // shortcut: anchored pictures stay opaque until floating pictures (10.9).
  if (!inline || children.length !== 1) return undefined;
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
    ext: sourceOf(context, drawing),
  };
}
