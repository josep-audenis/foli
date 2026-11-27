/**
 * Shapes back to WordprocessingML (Phase 34, ADR-0017): what `textBoxXml` writes into a shape
 * read from a file (its transform, geometry, fill and line), and a new shape as DrawingML.
 */

import { A } from "../import/ooxml.js";
import { WP } from "../import/pictures.js";
import { DEFAULT_INSET, kid, WPS } from "../import/textboxes.js";
import type { XmlElement } from "../xml.js";
import { type Edit, positionXml, wrapXml } from "./frames.js";
import type { Media } from "./pictures.js";
import { escapeAttribute } from "./xmlout.js";

type Json = Record<string, unknown>;

/**
 * A color as DrawingML's solid fill (`a` the DrawingML prefix).
 * @internal
 */
export const solid = (color: unknown, a: string) =>
  `<${a}:solidFill><${a}:srgbClr val="${escapeAttribute(String(color))}"/></${a}:solidFill>`;

/**
 * A shape's `a:xfrm`: its turn and flips, at its size.
 * @internal
 */
export function xfrmXml(attrs: Json, a: string): string {
  const rot = attrs.rotation ? ` rot="${attrs.rotation}"` : "";
  const flips = `${attrs.flipH ? ' flipH="1"' : ""}${attrs.flipV ? ' flipV="1"' : ""}`;
  return (
    `<${a}:xfrm${rot}${flips}><${a}:off x="0" y="0"/>` +
    `<${a}:ext cx="${attrs.width}" cy="${attrs.height}"/></${a}:xfrm>`
  );
}

const q = (value: unknown) => escapeAttribute(String(value));

/**
 * A shape's geometry: `a:prstGeom` with its adjust values, or `a:custGeom` from its paths.
 * @internal
 */
export function geometryXml(attrs: Json, a: string): string {
  const custom = attrs.custom as Json | null | undefined;
  const guides = (list: readonly Json[]) =>
    list.map((g) => `<${a}:gd name="${q(g.name)}" fmla="${q(g.formula)}"/>`).join("");
  if (attrs.geometry !== "custom" || !custom) {
    const adjust = Object.entries((attrs.adjust ?? {}) as Record<string, number>).map(
      ([name, value]) => ({ name, formula: `val ${value}` }),
    );
    const prst = attrs.geometry === "custom" ? "rect" : String(attrs.geometry ?? "rect");
    return `<${a}:prstGeom prst="${q(prst)}"><${a}:avLst>${guides(adjust)}</${a}:avLst></${a}:prstGeom>`;
  }
  const pt = (x: unknown, y: unknown) => `<${a}:pt x="${q(x)}" y="${q(y)}"/>`;
  const command = (c: Json) => {
    const args = (c.args ?? []) as string[];
    switch (c.op) {
      case "M":
        return `<${a}:moveTo>${pt(args[0], args[1])}</${a}:moveTo>`;
      case "L":
        return `<${a}:lnTo>${pt(args[0], args[1])}</${a}:lnTo>`;
      case "C":
        return `<${a}:cubicBezTo>${pt(args[0], args[1])}${pt(args[2], args[3])}${pt(args[4], args[5])}</${a}:cubicBezTo>`;
      case "Q":
        return `<${a}:quadBezTo>${pt(args[0], args[1])}${pt(args[2], args[3])}</${a}:quadBezTo>`;
      case "A":
        return `<${a}:arcTo wR="${q(args[0])}" hR="${q(args[1])}" stAng="${q(args[2])}" swAng="${q(args[3])}"/>`;
      default:
        return `<${a}:close/>`;
    }
  };
  const paths = ((custom.paths ?? []) as Json[])
    .map((path) => {
      const w = typeof path.width === "number" ? ` w="${path.width}"` : "";
      const h = typeof path.height === "number" ? ` h="${path.height}"` : "";
      const fill = typeof path.fill === "string" ? ` fill="${q(path.fill)}"` : "";
      const stroke = path.stroke === false ? ' stroke="0"' : "";
      const commands = ((path.commands ?? []) as Json[]).map(command).join("");
      return `<${a}:path${w}${h}${fill}${stroke}>${commands}</${a}:path>`;
    })
    .join("");
  const text = (custom.text ?? { l: "l", t: "t", r: "r", b: "b" }) as Record<string, string>;
  return (
    `<${a}:custGeom><${a}:avLst/><${a}:gdLst>${guides((custom.guides ?? []) as Json[])}</${a}:gdLst>` +
    `<${a}:ahLst/><${a}:cxnLst/><${a}:rect l="${q(text.l)}" t="${q(text.t)}" r="${q(text.r)}" b="${q(text.b)}"/>` +
    `<${a}:pathLst>${paths}</${a}:pathLst></${a}:custGeom>`
  );
}

/**
 * A fill: the gradient when there is one, else the color, else none.
 * @internal
 */
export function fillXml(attrs: Json, a: string): string {
  const gradient = attrs.gradient as Json | null | undefined;
  if (gradient) {
    const stops = ((gradient.stops ?? []) as Json[])
      .map(
        (stop) =>
          `<${a}:gs pos="${stop.position}"><${a}:srgbClr val="${q(stop.color)}"/></${a}:gs>`,
      )
      .join("");
    const shade =
      typeof gradient.path === "string"
        ? `<${a}:path path="${q(gradient.path)}"><${a}:fillToRect l="50000" t="50000" r="50000" b="50000"/></${a}:path>`
        : `<${a}:lin ang="${typeof gradient.angle === "number" ? gradient.angle : 0}" scaled="0"/>`;
    return `<${a}:gradFill rotWithShape="1"><${a}:gsLst>${stops}</${a}:gsLst>${shade}</${a}:gradFill>`;
  }
  return attrs.fill ? solid(attrs.fill, a) : `<${a}:noFill/>`;
}

const JOINS = new Set(["round", "bevel", "miter"]);

/**
 * A line (`a:ln`) for `outline` (null: none). Written over `was` (the file's), its other
 * attributes (cap, compound line) and its join are kept.
 * @internal
 */
export function lnXml(
  outline: Json | null | undefined,
  a: string,
  source?: string,
  was?: XmlElement,
): string {
  const p = was?.prefix || a;
  const kept = (was?.attributes ?? [])
    .filter((x) => !(x.local === "w" && !x.prefix))
    .map((x) => ` ${x.name}="${q(x.value)}"`)
    .join("");
  const join = was?.children.find(
    (c): c is XmlElement => c.kind === "element" && c.ns === A && JOINS.has(c.local),
  );
  const joinXml = join && source ? source.slice(join.start, join.end) : "";
  if (!outline) return `<${p}:ln${kept}><${p}:noFill/>${joinXml}</${p}:ln>`;
  const end = (local: string, value: unknown) => {
    const e = value as Json | undefined;
    if (!e) return "";
    const w = typeof e.width === "string" ? ` w="${q(e.width)}"` : "";
    const len = typeof e.length === "string" ? ` len="${q(e.length)}"` : "";
    return `<${p}:${local} type="${q(e.type)}"${w}${len}/>`;
  };
  // A file's custom dash stays while the model says `custom`; no dash replaces any the line had.
  const custom = kid(was, A, "custDash");
  const dash =
    outline.dash === "custom"
      ? custom && source
        ? source.slice(custom.start, custom.end)
        : ""
      : typeof outline.dash === "string"
        ? `<${p}:prstDash val="${q(outline.dash)}"/>`
        : custom || kid(was, A, "prstDash")
          ? `<${p}:prstDash val="solid"/>`
          : "";
  return (
    `<${p}:ln w="${outline.width}"${kept}>${solid(outline.color, p)}${dash}${joinXml}` +
    `${end("headEnd", outline.head)}${end("tailEnd", outline.tail)}</${p}:ln>`
  );
}

/** Line geometries Word draws as connectors (`wps:cNvCnPr`), which hold no text. */
const CONNECTORS = new Set([
  "line",
  "straightConnector1",
  "bentConnector2",
  "bentConnector3",
  "bentConnector4",
  "bentConnector5",
  "curvedConnector2",
  "curvedConnector3",
  "curvedConnector4",
  "curvedConnector5",
]);

/**
 * The frame of a new drawing (`wp:anchor` or `wp:inline`) up to its `wp:docPr`, and its close.
 * @internal
 */
export function frameOpen(attrs: Json): { open: string; close: string } {
  const width = String(attrs.width);
  const height = String(attrs.height);
  const float = attrs.float && typeof attrs.float === "object" ? (attrs.float as Json) : undefined;
  const dist = (side: string) => {
    const d = (float?.distance ?? {}) as Json;
    return typeof d[side] === "number" ? d[side] : side === "left" || side === "right" ? 114300 : 0;
  };
  const flag = (value: unknown) => (value === false ? "0" : "1");
  const extent = `<wp:extent cx="${width}" cy="${height}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>`;
  const open = float
    ? `<wp:anchor xmlns:wp="${WP}" distT="${dist("top")}" distB="${dist("bottom")}" ` +
      `distL="${dist("left")}" distR="${dist("right")}" simplePos="0" relativeHeight="${typeof float.zOrder === "number" ? float.zOrder : 251659264}" ` +
      `behindDoc="${float.wrap === "behind" ? 1 : 0}" locked="0" ` +
      `layoutInCell="${flag(float.layoutInCell)}" allowOverlap="${flag(float.allowOverlap)}">` +
      `<wp:simplePos x="0" y="0"/>${positionXml("H", float.horizontal as Json)}` +
      `${positionXml("V", float.vertical as Json)}${extent}${wrapXml(float)}`
    : `<wp:inline xmlns:wp="${WP}" distT="0" distB="0" distL="0" distR="0">${extent}`;
  return { open, close: float ? "</wp:anchor>" : "</wp:inline>" };
}

/**
 * A new DrawingML shape (no VML fallback: Word 2010 and later read it), with its text, if any,
 * already written (`inner`).
 * @internal
 */
export function freshShapeXml(attrs: Json, inner: string | undefined, media: Media): string {
  const id = media.freshId();
  const { open, close } = frameOpen(attrs);
  const alt = typeof attrs.alt === "string" ? ` descr="${q(attrs.alt)}"` : "";
  const title = typeof attrs.title === "string" ? ` title="${q(attrs.title)}"` : "";
  const connector = CONNECTORS.has(String(attrs.geometry));
  const text = !connector && inner !== undefined && !!attrs.story;
  const inset = (attrs.inset ?? DEFAULT_INSET) as Json;
  const anchor =
    { top: "t", center: "ctr", bottom: "b" }[String(attrs.verticalAlign ?? "top")] ?? "t";
  const name = connector ? "Straight Connector" : "Shape";
  return (
    `<w:drawing>${open}<wp:docPr id="${id}" name="${name} ${id}"${alt}${title}/>` +
    `<wp:cNvGraphicFramePr/><a:graphic xmlns:a="${A}"><a:graphicData uri="${WPS}"><wps:wsp xmlns:wps="${WPS}">` +
    `${connector ? "<wps:cNvCnPr/>" : "<wps:cNvSpPr/>"}<wps:spPr>${xfrmXml(attrs, "a")}${geometryXml(attrs, "a")}` +
    `${fillXml(attrs, "a")}${lnXml(attrs.outline as Json | null | undefined, "a")}</wps:spPr>` +
    `${text && typeof attrs.textColor === "string" ? styleXml(attrs.textColor, "wps", "a") : ""}` +
    `${text ? `<wps:txbx><w:txbxContent>${inner}</w:txbxContent></wps:txbx>` : ""}` +
    `<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="${inset.left}" tIns="${inset.top}" ` +
    `rIns="${inset.right}" bIns="${inset.bottom}" anchor="${anchor}" anchorCtr="0">` +
    `${attrs.autoFit ? "<a:spAutoFit/>" : "<a:noAutofit/>"}</wps:bodyPr></wps:wsp></a:graphicData></a:graphic>` +
    `${close}</w:drawing>`
  );
}

/**
 * A style (`wps:style`) whose references draw nothing (index 0) but its text's color: what a new
 * shape, or one without a style, says its text color with.
 */
const styleXml = (color: string, p: string, a: string) =>
  `<${p}:style><${a}:lnRef idx="0"><${a}:scrgbClr r="0" g="0" b="0"/></${a}:lnRef>` +
  `<${a}:fillRef idx="0"><${a}:scrgbClr r="0" g="0" b="0"/></${a}:fillRef>` +
  `<${a}:effectRef idx="0"><${a}:scrgbClr r="0" g="0" b="0"/></${a}:effectRef>` +
  `<${a}:fontRef idx="minor"><${a}:srgbClr val="${q(color)}"/></${a}:fontRef></${p}:style>`;

/**
 * The edits making shape `wsp`'s text color `color` (RRGGBB): its style's `a:fontRef` color
 * replaced, or a style that draws nothing else added after `spPr`. None given: left as it is.
 * @internal
 */
export function textColorEdits(
  source: string,
  wsp: XmlElement,
  spPr: XmlElement,
  color: unknown,
  edits: Edit[],
): void {
  if (typeof color !== "string") return;
  const style = kid(wsp, WPS, "style");
  const font = kid(style, A, "fontRef");
  if (font) {
    const a = font.prefix || "a";
    const text = `<${a}:srgbClr val="${q(color)}"/>`;
    const current = font.children.find((c): c is XmlElement => c.kind === "element");
    if (current) edits.push({ from: current.start, to: current.end, text });
    else if (source[font.openEnd - 2] === "/")
      edits.push({
        from: font.start,
        to: font.end,
        text: `${source.slice(font.start, font.openEnd - 2)}>${text}</${font.name}>`,
      });
    else edits.push({ from: font.openEnd, to: font.openEnd, text });
    return;
  }
  if (!style)
    edits.push({
      from: spPr.end,
      to: spPr.end,
      text: styleXml(color, wsp.prefix || "wps", kid(spPr, A, "xfrm")?.prefix || "a"),
    });
}
