/**
 * A drawing's frame (`wp:inline`, `wp:anchor`) as the model's size and `float` say, edited in
 * place: what the model does not hold (the wrap polygon of an unchanged wrapping, effect
 * extents, z-order, locks, Word's ids) stays as the file has it. Shared by pictures and text
 * boxes (Phase 33).
 */

import { A } from "../import/ooxml.js";
import { floatOf, WP } from "../import/pictures.js";
import type { XmlElement } from "../xml.js";
import { same } from "./properties.js";
import { escapeAttribute } from "./xmlout.js";

type Json = Record<string, unknown>;

/**
 * Edits to a source string: replace `[from, to)` with `text`.
 * @internal
 */
export type Edit = { from: number; to: number; text: string };

const kid = (el: XmlElement | undefined, ns: string, local: string) =>
  el?.children.find(
    (c): c is XmlElement => c.kind === "element" && c.ns === ns && c.local === local,
  );

/**
 * An attribute of `el`: `ns` given, in it; else one without a prefix.
 * @internal
 */
export const attrOf = (el: XmlElement | undefined, local: string, ns?: string) =>
  el?.attributes.find((x) => x.local === local && (ns ? x.ns === ns : !x.prefix));

/**
 * The edits setting (or, undefined, removing) attribute `local` (`ns`: none for plain) of `el`.
 * @internal
 */
export function setAttr(
  source: string,
  el: XmlElement | undefined,
  local: string,
  value: string | undefined,
  edits: Edit[],
  ns?: string,
  qualified = local,
): void {
  if (!el) return;
  const a = attrOf(el, local, ns);
  if (a) {
    if (value === undefined) edits.push({ from: a.start - 1, to: a.end, text: "" });
    else if (a.value !== value)
      edits.push({ from: a.valueStart, to: a.valueEnd, text: escapeAttribute(value) });
  } else if (value !== undefined) {
    const at = source[el.openEnd - 2] === "/" ? el.openEnd - 2 : el.openEnd - 1;
    edits.push({ from: at, to: at, text: ` ${qualified}="${escapeAttribute(value)}"` });
  }
}

/**
 * `source` with `edits` made (none overlapping).
 * @internal
 */
export function applyEdits(source: string, edits: readonly Edit[]): string {
  let out = source;
  // At one offset a range goes first, then the text inserted there, so the insertion stays;
  // texts inserted at one offset stay in the order given.
  const order = new Map(edits.map((edit, i) => [edit, i]));
  const rank = (edit: Edit) => order.get(edit) ?? 0;
  for (const edit of [...edits].sort((a, b) => b.from - a.from || b.to - a.to || rank(b) - rank(a)))
    out = out.slice(0, edit.from) + edit.text + out.slice(edit.to);
  return out;
}

/** `relativeFrom` values Word reads, horizontal and vertical (the first is the default). */
const RELATIVE = {
  H: [
    "column",
    "margin",
    "page",
    "character",
    "leftMargin",
    "rightMargin",
    "insideMargin",
    "outsideMargin",
  ],
  V: [
    "paragraph",
    "margin",
    "page",
    "line",
    "topMargin",
    "bottomMargin",
    "insideMargin",
    "outsideMargin",
  ],
};
const ALIGN = {
  H: ["left", "right", "center", "inside", "outside"],
  V: ["top", "bottom", "center", "inside", "outside"],
};

/**
 * A `wp:positionH`/`wp:positionV` for a float's position, values Word cannot read replaced.
 * @internal
 */
export function positionXml(axis: "H" | "V", position: Json | undefined, p = "wp"): string {
  const from = String(position?.relativeTo);
  const relativeTo = RELATIVE[axis].includes(from) ? from : RELATIVE[axis][0];
  const offset = position?.offset;
  const align = String(position?.align);
  const value =
    typeof offset !== "number" && ALIGN[axis].includes(align)
      ? `<${p}:align>${align}</${p}:align>`
      : `<${p}:posOffset>${typeof offset === "number" ? offset : 0}</${p}:posOffset>`;
  return `<${p}:position${axis} relativeFrom="${relativeTo}">${value}</${p}:position${axis}>`;
}

const SIDES = ["bothSides", "left", "right", "largest"];

/**
 * The `wp:wrap*` element for a float's wrapping.
 * @internal
 */
export function wrapXml(float: Json, p = "wp"): string {
  const side = SIDES.includes(String(float.side)) ? String(float.side) : "bothSides";
  switch (float.wrap) {
    case "topAndBottom":
      return `<${p}:wrapTopAndBottom/>`;
    case "behind":
    case "inFront":
      return `<${p}:wrapNone/>`;
    case "tight":
    case "through": {
      // The frame's rectangle as the wrap polygon (21600 is the full side).
      const tag = float.wrap === "tight" ? `${p}:wrapTight` : `${p}:wrapThrough`;
      return (
        `<${tag} wrapText="${side}"><${p}:wrapPolygon edited="0"><${p}:start x="0" y="0"/>` +
        `<${p}:lineTo x="0" y="21600"/><${p}:lineTo x="21600" y="21600"/><${p}:lineTo x="21600" y="0"/>` +
        `<${p}:lineTo x="0" y="0"/></${p}:wrapPolygon></${tag}>`
      );
    }
    default:
      return `<${p}:wrapSquare wrapText="${side}"/>`;
  }
}

const distance = (float: Json, side: string) => {
  const d = (float.distance ?? {}) as Json;
  return typeof d[side] === "number" ? String(d[side]) : "0";
};

/** Children an inline frame may hold (CT_Inline), in its order. */
const INLINE_KIDS = ["extent", "effectExtent", "docPr", "cNvGraphicFramePr", "graphic"];
/** CT_Anchor's children after its wrapping, in order. */
const AFTER_WRAP = ["docPr", "cNvGraphicFramePr", "graphic"];

/**
 * The edits making `frame` say `float` (null: inline) at `width` by `height` EMU. Its position,
 * wrapping and distances are rewritten only when the float differs from the file's; a wrapping
 * of the same kind and side keeps its element (its polygon). Changing between inline and
 * floating writes the frame anew from its children. `z`: the anchor's `relativeHeight` for a frame
 * made floating.
 * @internal
 */
export function frameEdits(
  source: string,
  frame: XmlElement,
  float: Json | null | undefined,
  width: string,
  height: string,
  edits: Edit[],
  z = "251658240",
): void {
  const p = frame.prefix || "wp";
  const extent = kid(frame, WP, "extent");
  const child = (local: string) => {
    // `a:graphic` is DrawingML's; the rest the frame's own.
    const el = kid(frame, local === "graphic" ? A : WP, local);
    return el ? source.slice(el.start, el.end) : "";
  };
  const sized = (xml: string) =>
    xml.replace(/\bcx="\d+"/, `cx="${width}"`).replace(/\bcy="\d+"/, `cy="${height}"`);
  if (frame.local === "anchor" && !float) {
    const kids = INLINE_KIDS.map((local) =>
      local === "extent" ? sized(child(local)) : child(local),
    );
    edits.push({
      from: frame.start,
      to: frame.end,
      text: `<${p}:inline distT="0" distB="0" distL="0" distR="0">${kids.join("")}</${p}:inline>`,
    });
    return;
  }
  if (frame.local === "inline" && float) {
    const flag = (value: unknown) => (value === false ? "0" : "1");
    edits.push({
      from: frame.start,
      to: frame.end,
      text:
        `<${p}:anchor distT="${distance(float, "top")}" distB="${distance(float, "bottom")}" ` +
        `distL="${distance(float, "left")}" distR="${distance(float, "right")}" simplePos="0" ` +
        `relativeHeight="${typeof float.zOrder === "number" ? float.zOrder : z}" behindDoc="${float.wrap === "behind" ? 1 : 0}" locked="0" ` +
        `layoutInCell="${flag(float.layoutInCell)}" allowOverlap="${flag(float.allowOverlap)}">` +
        `<${p}:simplePos x="0" y="0"/>${positionXml("H", float.horizontal as Json, p)}` +
        `${positionXml("V", float.vertical as Json, p)}${sized(child("extent"))}${child("effectExtent")}` +
        `${wrapXml(float, p)}${AFTER_WRAP.map(child).join("")}</${p}:anchor>`,
    });
    return;
  }
  if (attrOf(extent, "cx")?.value !== width || attrOf(extent, "cy")?.value !== height) {
    setAttr(source, extent, "cx", width, edits);
    setAttr(source, extent, "cy", height, edits);
  }
  if (frame.local !== "anchor" || !float) return;
  // Its place front to back (33.6), when the model says one.
  if (typeof float.zOrder === "number")
    setAttr(source, frame, "relativeHeight", String(float.zOrder), edits);
  const read = floatOf(frame);
  const { zOrder: _z, ...rest } = float;
  if (read && same(read, rest)) return;
  for (const [local, side] of [
    ["distT", "top"],
    ["distB", "bottom"],
    ["distL", "left"],
    ["distR", "right"],
  ] as const)
    setAttr(source, frame, local, distance(float, side), edits);
  setAttr(source, frame, "behindDoc", float.wrap === "behind" ? "1" : "0", edits);
  for (const local of ["allowOverlap", "layoutInCell"] as const)
    if (typeof float[local] === "boolean")
      setAttr(source, frame, local, float[local] ? "1" : "0", edits);
  for (const [axis, key] of [
    ["H", "horizontal"],
    ["V", "vertical"],
  ] as const) {
    const el = kid(frame, WP, `position${axis}`);
    if (el && !same(read?.[key], float[key]))
      edits.push({ from: el.start, to: el.end, text: positionXml(axis, float[key] as Json, p) });
  }
  const wrapEl = frame.children.find(
    (c): c is XmlElement => c.kind === "element" && c.ns === WP && c.local.startsWith("wrap"),
  );
  const keeps =
    read && read.wrap === float.wrap && (read.side ?? "bothSides") === (float.side ?? "bothSides");
  if (wrapEl && !keeps) edits.push({ from: wrapEl.start, to: wrapEl.end, text: wrapXml(float, p) });
}
