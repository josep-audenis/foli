/**
 * Text boxes back to WordprocessingML (Phase 33, ADR-0016). One read from a file is its run
 * content as read (`mc:AlternateContent`, `w:drawing` or `w:pict`) with the story's text written
 * into each `w:txbxContent` and only what the model changed written into the DrawingML (size,
 * position, wrapping, fill, outline, alt text: the frame edited in place as a picture's is).
 * Word's VML fallback copy gets the text too; once the box itself changed it is left out (Word
 * 2010 and later read the DrawingML), as it is for a copy. A VML-only box that changed, and a
 * new box, are written as a DrawingML text box.
 */

import { A } from "../import/ooxml.js";
import { WP } from "../import/pictures.js";
import { Recorder } from "../import/report.js";
import { drawnShapeOf } from "../import/shapes.js";
import { boxOf, DEFAULT_INSET, WPS } from "../import/textboxes.js";
import type { XmlElement } from "../xml.js";
import { applyEdits, attrOf, type Edit, frameEdits, setAttr } from "./frames.js";
import type { Media } from "./pictures.js";
import { same } from "./properties.js";
import {
  fillXml,
  frameOpen,
  freshShapeXml,
  geometryXml,
  lnXml,
  solid,
  textColorEdits,
  xfrmXml,
} from "./shapes.js";
import { escapeAttribute, fragment, type Namespaces } from "./xmlout.js";

type Json = Record<string, unknown>;

const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const WP14 = "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing";
const O = "urn:schemas-microsoft-com:office:office";

const kid = (el: XmlElement | undefined, ns: string, local: string) =>
  el?.children.find(
    (c): c is XmlElement => c.kind === "element" && c.ns === ns && c.local === local,
  );

/** The outermost `w:txbxContent`s in `el` (not one inside another's text). */
function contents(el: XmlElement, out: XmlElement[] = []): XmlElement[] {
  for (const c of el.children) {
    if (c.kind !== "element") continue;
    if (c.ns === W && c.local === "txbxContent") out.push(c);
    else contents(c, out);
  }
  return out;
}

function descendants(el: XmlElement, test: (e: XmlElement) => boolean, out: XmlElement[] = []) {
  for (const c of el.children) {
    if (c.kind !== "element") continue;
    if (test(c)) out.push(c);
    descendants(c, test, out);
  }
  return out;
}

/** What the box is drawn as, to compare the model's with the file's. */
const LOOK = ["width", "height", "float", "fill", "outline", "inset", "verticalAlign", "autoFit"];
/** And a shape (Phase 34). */
const SHAPE_LOOK = [
  ...LOOK,
  "geometry",
  "adjust",
  "custom",
  "rotation",
  "flipH",
  "flipV",
  "gradient",
  "textColor",
];
const look = (attrs: Json, keys = LOOK) =>
  Object.fromEntries(
    keys
      .map((key) => [key, attrs[key] ?? null])
      // No rotation or flip is as good as said so.
      .filter(([, v]) => v !== null && v !== false && v !== 0),
  );

/** `xml` with `edits`, the part of it `element` was. */
function edited(source: string, element: XmlElement, edits: readonly Edit[]): string {
  const shift = edits.reduce((sum, e) => sum + e.text.length - (e.to - e.from), 0);
  return applyEdits(source, edits).slice(element.start, element.end + shift);
}

/**
 * The run content for text box `attrs` whose story's blocks are `inner` (already written for
 * this part; undefined: the text its `ext` has, the story unchanged).
 * @internal
 */
export function textBoxXml(
  attrs: Json,
  given: string | undefined,
  namespaces: Namespaces,
  media: Media,
  /** A shape's (Phase 34, ADR-0017): its geometry, turn, flips, gradient and line ends too. */
  isShape = false,
): string {
  // A shape's geometry left out of its JSON is the default, a rectangle.
  if (isShape) attrs = { ...attrs, geometry: attrs.geometry ?? "rect" };
  const ext = typeof attrs.ext === "string" ? attrs.ext : undefined;
  const fresh = (inner: string | undefined) =>
    isShape ? freshShapeXml(attrs, inner, media) : freshXml(attrs, inner ?? "<w:p/>", media);
  if (!ext) return fresh(given);
  const { element, source } = fragment(ext, namespaces);
  const context = {
    source,
    report: new Recorder(),
    pkg: media.pkg,
    colors: media.doc.theme?.colors,
  };
  const read = isShape ? drawnShapeOf(element, context) : boxOf(element, context);
  const txbxs = contents(element);
  const inner =
    given ?? (txbxs[0] ? source.slice(txbxs[0].openEnd, txbxs[0].closeStart) : "<w:p/>");
  if (!read) return fresh(isShape && !attrs.story ? undefined : inner);
  const alternate = element.ns === MC && element.local === "AlternateContent";
  const choice = alternate ? kid(element, MC, "Choice") : undefined;
  const drawing = choice
    ? kid(choice, W, "drawing")
    : element.local === "drawing"
      ? element
      : undefined;
  const keys = isShape ? SHAPE_LOOK : LOOK;
  const changed = !same(look(read.attrs, keys), look(attrs, keys));
  // A VML-only box Foli changed: written as DrawingML.
  if (!drawing && changed) return fresh(inner);
  const frame = drawing ? (kid(drawing, WP, "inline") ?? kid(drawing, WP, "anchor")) : undefined;
  const docPr = kid(frame, WP, "docPr");
  const id = attrOf(docPr, "id")?.value;
  const copy = !!docPr && !media.claim(id === undefined ? undefined : Number(id));
  const fallback = alternate ? kid(element, MC, "Fallback") : undefined;
  const addsText = isShape && given !== undefined && !txbxs.length;
  // Word's VML copy, once the box changed or was copied: left out, not written stale.
  const dropped = fallback && (changed || copy || addsText) ? fallback : undefined;
  const edits: Edit[] = dropped ? [{ from: dropped.start, to: dropped.end, text: "" }] : [];
  let contentChanged = false;
  for (const txbx of given === undefined ? [] : contents(dropped && choice ? choice : element)) {
    const was = source.slice(txbx.openEnd, txbx.closeStart);
    if (was === inner) continue;
    contentChanged = true;
    if (txbx.openEnd === txbx.closeStart && source[txbx.openEnd - 2] === "/")
      edits.push({ from: txbx.start, to: txbx.end, text: `<${txbx.name}>${inner}</${txbx.name}>` });
    else edits.push({ from: txbx.openEnd, to: txbx.closeStart, text: inner });
  }
  if (copy && docPr) {
    // A copy of a box (pasted twice): its own id, Word's anchor ids left to Word.
    setAttr(source, docPr, "id", String(media.freshId()), edits);
    setAttr(source, frame, "anchorId", undefined, edits, WP14);
    setAttr(source, frame, "editId", undefined, edits, WP14);
  }
  for (const [local, value] of [
    ["descr", attrs.alt],
    ["title", attrs.title],
  ] as const) {
    const wanted = typeof value === "string" ? value : undefined;
    if (docPr && attrOf(docPr, local)?.value !== wanted)
      setAttr(source, docPr, local, wanted, edits);
  }
  const shape = drawing
    ? descendants(drawing, (e) => e.ns === WPS && e.local === "wsp")[0]
    : undefined;
  const spPr = kid(shape, WPS, "spPr");
  const bodyPr = kid(shape, WPS, "bodyPr");
  if (changed && spPr) lookEdits(source, spPr, bodyPr, read.attrs, attrs, edits);
  // A shape's text color (a style's: Shape Format ▸ Shape Styles) in its `a:fontRef`.
  if (isShape && shape && spPr && (read.attrs.textColor ?? null) !== (attrs.textColor ?? null))
    textColorEdits(source, shape, spPr, attrs.textColor, edits);
  // Text given to a shape that had none: its `wps:txbx` before `wps:bodyPr`.
  // A connector holds no text (Word's `wps:cNvCnPr`): it is not given any.
  if (addsText && bodyPr && !kid(shape, WPS, "cNvCnPr")) {
    contentChanged = true;
    const p = shape?.prefix ? `${shape.prefix}:` : "";
    edits.push({
      from: bodyPr.start,
      to: bodyPr.start,
      text: `<${p}txbx><w:txbxContent>${inner}</w:txbxContent></${p}txbx>`,
    });
  }
  if (!dropped && contentChanged)
    // Word's cached DrawingML of the VML copy would show the old text to Word 2007.
    for (const shape of descendants(element, (e) => attrOf(e, "gfxdata", O) !== undefined))
      setAttr(source, shape, "gfxdata", undefined, edits, O);
  const out = edited(source, element, edits);
  if (!changed || !drawing) return out;
  // The frame last: it may be written anew from its children (in line or floating).
  const again = fragment(out, namespaces);
  const choice2 = alternate ? kid(again.element, MC, "Choice") : undefined;
  const drawing2 = choice2 ? kid(choice2, W, "drawing") : again.element;
  const frame2 = kid(drawing2, WP, "inline") ?? kid(drawing2, WP, "anchor");
  if (!frame2) return out;
  const frameChanges: Edit[] = [];
  frameEdits(
    again.source,
    frame2,
    (attrs.float as Json | null | undefined) ?? null,
    String(attrs.width),
    String(attrs.height),
    frameChanges,
  );
  return frameChanges.length ? edited(again.source, again.element, frameChanges) : out;
}

const FILLS = new Set(["noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"]);

/** The edits writing what the model changed of the box's look into its `wps:spPr` and `wps:bodyPr`. */
function lookEdits(
  source: string,
  spPr: XmlElement,
  bodyPr: XmlElement | undefined,
  was: Json,
  now: Json,
  edits: Edit[],
): void {
  const geom = kid(spPr, A, "prstGeom") ?? kid(spPr, A, "custGeom");
  const xfrm = kid(spPr, A, "xfrm");
  const a = geom?.prefix || xfrm?.prefix || "a";
  const size = kid(xfrm, A, "ext");
  const resized = was.width !== now.width || was.height !== now.height;
  const turned =
    (was.rotation ?? 0) !== (now.rotation ?? 0) ||
    !!was.flipH !== !!now.flipH ||
    !!was.flipV !== !!now.flipV;
  // CT_ShapeProperties: the transform first.
  if (!xfrm && (turned || resized))
    edits.push({ from: spPr.openEnd, to: spPr.openEnd, text: xfrmXml(now, a) });
  if (resized) {
    setAttr(source, size, "cx", String(now.width), edits);
    setAttr(source, size, "cy", String(now.height), edits);
  }
  if (xfrm && turned) {
    setAttr(source, xfrm, "rot", now.rotation ? String(now.rotation) : undefined, edits);
    setAttr(source, xfrm, "flipH", now.flipH ? "1" : undefined, edits);
    setAttr(source, xfrm, "flipV", now.flipV ? "1" : undefined, edits);
  }
  if (
    geom &&
    (was.geometry !== now.geometry ||
      !same(was.adjust ?? null, now.adjust ?? null) ||
      !same(was.custom ?? null, now.custom ?? null))
  )
    edits.push({ from: geom.start, to: geom.end, text: geometryXml(now, a) });
  // CT_ShapeProperties: the geometry, the fill, then the line; what is missing goes after the
  // geometry, in that order.
  const fill = spPr.children.find(
    (c): c is XmlElement => c.kind === "element" && c.ns === A && FILLS.has(c.local),
  );
  const ln = kid(spPr, A, "ln");
  const after = kid(spPr, A, "prstGeom") ?? kid(spPr, A, "custGeom") ?? xfrm;
  let added = "";
  if (
    !same(was.fill ?? null, now.fill ?? null) ||
    !same(was.gradient ?? null, now.gradient ?? null)
  ) {
    const text = fillXml(now, a);
    if (fill) edits.push({ from: fill.start, to: fill.end, text });
    else added += text;
  }
  if (!same(was.outline ?? null, now.outline ?? null)) {
    const text = lnXml(now.outline as Json | null | undefined, a, source, ln);
    if (ln) edits.push({ from: ln.start, to: ln.end, text });
    else if (fill) edits.push({ from: fill.end, to: fill.end, text });
    else added += text;
  }
  if (added && after) edits.push({ from: after.end, to: after.end, text: added });
  if (!bodyPr) return;
  const inset = (now.inset ?? DEFAULT_INSET) as Json;
  const wasInset = (was.inset ?? DEFAULT_INSET) as Json;
  for (const [local, side] of [
    ["lIns", "left"],
    ["tIns", "top"],
    ["rIns", "right"],
    ["bIns", "bottom"],
  ] as const)
    if (inset[side] !== wasInset[side]) setAttr(source, bodyPr, local, String(inset[side]), edits);
  if ((was.verticalAlign ?? "top") !== (now.verticalAlign ?? "top")) {
    const anchor = { top: "t", center: "ctr", bottom: "b" }[String(now.verticalAlign ?? "top")];
    setAttr(source, bodyPr, "anchor", anchor, edits);
  }
  if (!!was.autoFit !== !!now.autoFit) {
    const fit = bodyPr.children.find(
      (c): c is XmlElement =>
        c.kind === "element" &&
        c.ns === A &&
        ["noAutofit", "spAutoFit", "normAutofit"].includes(c.local),
    );
    const text = now.autoFit ? `<${a}:spAutoFit/>` : `<${a}:noAutofit/>`;
    // CT_TextBodyProperties: the autofit after the text warp, before scene3d and the rest.
    const warp = kid(bodyPr, A, "prstTxWarp");
    if (fit) edits.push({ from: fit.start, to: fit.end, text });
    else if (source[bodyPr.openEnd - 2] === "/") {
      // The "/" removed apart from the attributes inserted before it (`applyEdits` takes a
      // range before an insertion at the same offset).
      edits.push({ from: bodyPr.openEnd - 2, to: bodyPr.openEnd - 1, text: "" });
      edits.push({ from: bodyPr.openEnd, to: bodyPr.openEnd, text: `${text}</${bodyPr.name}>` });
    } else if (warp) edits.push({ from: warp.end, to: warp.end, text });
    else edits.push({ from: bodyPr.openEnd, to: bodyPr.openEnd, text });
  }
}

/** A new DrawingML text box (no VML fallback: Word 2010 and later read it). */
function freshXml(attrs: Json, inner: string, media: Media): string {
  const id = media.freshId();
  const width = String(attrs.width);
  const height = String(attrs.height);
  const alt = typeof attrs.alt === "string" ? ` descr="${escapeAttribute(attrs.alt)}"` : "";
  const title = typeof attrs.title === "string" ? ` title="${escapeAttribute(attrs.title)}"` : "";
  const { open, close } = frameOpen(attrs);
  const fill = attrs.fill ? solid(attrs.fill, "a") : "<a:noFill/>";
  const outline = attrs.outline as { color: string; width: number } | null | undefined;
  const ln = outline
    ? `<a:ln w="${outline.width}">${solid(outline.color, "a")}</a:ln>`
    : "<a:ln><a:noFill/></a:ln>";
  const inset = (attrs.inset ?? DEFAULT_INSET) as Json;
  const anchor =
    { top: "t", center: "ctr", bottom: "b" }[String(attrs.verticalAlign ?? "top")] ?? "t";
  return (
    `<w:drawing>${open}<wp:docPr id="${id}" name="Text Box ${id}"${alt}${title}/><wp:cNvGraphicFramePr/>` +
    `<a:graphic xmlns:a="${A}"><a:graphicData uri="${WPS}"><wps:wsp xmlns:wps="${WPS}">` +
    `<wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}${ln}</wps:spPr>` +
    `<wps:txbx><w:txbxContent>${inner}</w:txbxContent></wps:txbx>` +
    `<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="${inset.left}" tIns="${inset.top}" ` +
    `rIns="${inset.right}" bIns="${inset.bottom}" anchor="${anchor}" anchorCtr="0">` +
    `${attrs.autoFit ? "<a:spAutoFit/>" : "<a:noAutofit/>"}</wps:bodyPr></wps:wsp></a:graphicData></a:graphic>` +
    `${close}</w:drawing>`
  );
}
