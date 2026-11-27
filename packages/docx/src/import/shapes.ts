/**
 * Shapes (Phase 34, ADR-0017): a run's `mc:AlternateContent` whose Choice is a DrawingML shape
 * (`wps:wsp`), or a bare such `w:drawing`, that is not Word's plain text box (Phase 33 reads
 * those). The `shape` node keeps its geometry (a preset with its adjust values, or a custom
 * geometry's paths), size, position, wrapping, rotation, flips, fill, gradient and line, a theme
 * style resolved to colors, its text as a story of kind `textBox`, and the run content verbatim.
 * A group, a canvas, a shape filled with a picture or a pattern, a linked text box, vertical
 * text, a shape in a note, a comment or a text box, and a VML-only shape stay opaque.
 */
import type { NodeJSON } from "@folijs/core";
import type { DocxPackage } from "../package.js";
import type { XmlElement } from "../xml.js";
import { A, elements, integer, isW, REL } from "./ooxml.js";
import { floatOf, WP } from "./pictures.js";
import { sourceOf } from "./properties.js";
import {
  addStory,
  colorOf,
  DEFAULT_INSET,
  descendant,
  emu,
  firstColor,
  holdsBoxes,
  kid,
  MC,
  plain,
  sameInset,
  type TextBoxContext,
  WPS,
} from "./textboxes.js";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const ADEC = "http://schemas.microsoft.com/office/drawing/2017/decorative";
const MAX_COORDINATE = 27_273_042_316_900;

type Json = Record<string, unknown>;

/** The theme's line and fill styles (`a:fmtScheme`), read once per package. */
interface Styles {
  readonly lines: readonly XmlElement[];
  readonly fills: readonly XmlElement[];
  readonly backgrounds: readonly XmlElement[];
}
const NO_STYLES: Styles = { lines: [], fills: [], backgrounds: [] };
const cached = new WeakMap<DocxPackage, Styles>();

function themeStyles(context: TextBoxContext): Styles {
  const pkg = context.pkg;
  if (!pkg) return NO_STYLES;
  let found = cached.get(pkg);
  if (!found) {
    found = NO_STYLES;
    try {
      const rel = pkg
        .relationships(pkg.mainDocument)
        .find((r) => r.type === REL.theme && !r.external);
      const root = rel?.partName ? pkg.xml(rel.partName).root : undefined;
      const scheme = kid(kid(root, A, "themeElements"), A, "fmtScheme");
      const list = (local: string) => {
        const el = kid(scheme, A, local);
        return el ? elements(el) : [];
      };
      if (scheme)
        found = {
          lines: list("lnStyleLst"),
          fills: list("fillStyleLst"),
          backgrounds: list("bgFillStyleLst"),
        };
    } catch {}
    cached.set(pkg, found);
  }
  return found;
}

/** A style reference's (`a:fillRef`, `a:lnRef`) index and color. */
function reference(el: XmlElement | undefined, context: TextBoxContext) {
  const idx = integer(plain(el, "idx"));
  return { idx: idx ?? 0, color: colorOf(firstColor(el), context) };
}

/** A gradient (`a:gradFill`) as the node's `gradient`; `placeholder` for a theme style's `phClr`. */
function gradientOf(
  grad: XmlElement,
  context: TextBoxContext,
  placeholder?: string,
): Json | undefined {
  const stops: Json[] = [];
  for (const gs of elements(kid(grad, A, "gsLst") ?? grad).filter((e) => e.local === "gs")) {
    const position = integer(plain(gs, "pos"));
    const color = colorOf(firstColor(gs), context, placeholder);
    if (position === undefined || position < 0 || position > 100_000 || !color) return undefined;
    stops.push({ position, color });
  }
  if (stops.length < 2 || stops.length > 32) return undefined;
  const path = plain(kid(grad, A, "path"), "path");
  const angle = integer(plain(kid(grad, A, "lin"), "ang"));
  return {
    stops,
    ...(path === "circle" || path === "rect" || path === "shape" ? { path } : {}),
    ...(angle !== undefined && angle >= 0 && angle < 21_600_000 && !path ? { angle } : {}),
  };
}

/** What a fill element says: a color, a gradient, none; undefined for a fill Foli does not draw. */
type Fill = { fill: string | null; gradient?: Json } | undefined;

function fillElement(
  el: XmlElement | undefined,
  context: TextBoxContext,
  placeholder?: string,
): Fill | "unknown" {
  if (!el) return undefined;
  if (el.local === "noFill") return { fill: null };
  if (el.local === "solidFill") {
    const color = colorOf(firstColor(el), context, placeholder);
    return color ? { fill: color } : "unknown";
  }
  if (el.local === "gradFill") {
    const gradient = gradientOf(el, context, placeholder);
    if (!gradient) return "unknown";
    return { fill: (gradient.stops as Json[])[0]?.color as string, gradient };
  }
  // A picture, a pattern, the group's fill: not drawn.
  return "unknown";
}

const FILLS = new Set(["noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"]);
const fillChild = (parent: XmlElement | undefined) =>
  parent?.children.find(
    (c): c is XmlElement => c.kind === "element" && c.ns === A && FILLS.has(c.local),
  );

/** The shape's fill: its own, else its style's (`a:fillRef` into the theme). */
function shapeFill(spPr: XmlElement, style: XmlElement | undefined, context: TextBoxContext) {
  const own = fillElement(fillChild(spPr), context);
  if (own !== undefined) return own;
  const ref = kid(style, A, "fillRef");
  if (!ref) return { fill: null };
  const { idx, color } = reference(ref, context);
  if (idx === 0) return { fill: null };
  const styles = themeStyles(context);
  const list = idx >= 1001 ? styles.backgrounds : styles.fills;
  const themed = list[(idx >= 1001 ? idx - 1001 : idx - 1) as number];
  // No theme to say (a new package): the reference's color as a solid fill, as Word's default.
  if (!themed) return color ? { fill: color } : { fill: null };
  return fillElement(themed, context, color) ?? { fill: null };
}

const DASHES = new Set([
  "solid",
  "dot",
  "dash",
  "lgDash",
  "dashDot",
  "lgDashDot",
  "lgDashDotDot",
  "sysDash",
  "sysDot",
  "sysDashDot",
  "sysDashDotDot",
]);
const ENDS = new Set(["triangle", "stealth", "diamond", "oval", "arrow"]);
const SIZES = new Set(["sm", "med", "lg"]);

function lineEnd(el: XmlElement | undefined): Json | undefined {
  const type = plain(el, "type");
  if (!type || !ENDS.has(type)) return undefined;
  const w = plain(el, "w");
  const len = plain(el, "len");
  return {
    type,
    ...(w && SIZES.has(w) ? { width: w } : {}),
    ...(len && SIZES.has(len) ? { length: len } : {}),
  };
}

/** The shape's line: its own `a:ln` over its style's (`a:lnRef` into the theme); null for none. */
function shapeLine(
  spPr: XmlElement,
  style: XmlElement | undefined,
  context: TextBoxContext,
): Json | null | "unknown" {
  const ln = kid(spPr, A, "ln");
  const ref = kid(style, A, "lnRef");
  const { idx, color: refColor } = reference(ref, context);
  const themed = ref && idx > 0 ? themeStyles(context).lines[idx - 1] : undefined;
  // What the line is filled with: its own, else the style's (`phClr` its reference's color).
  let fill = fillElement(fillChild(ln), context);
  if (fill === undefined && ref && idx > 0)
    fill = themed ? fillElement(fillChild(themed), context, refColor) : undefined;
  if (fill === undefined) fill = ref && idx > 0 && refColor ? { fill: refColor } : { fill: null };
  if (fill === "unknown") return "unknown";
  if (!fill.fill) return null;
  const width = emu(plain(ln, "w")) ?? emu(plain(themed, "w")) ?? 9525;
  const dash = plain(kid(ln, A, "prstDash") ?? kid(themed, A, "prstDash"), "val");
  // A custom dash (`a:custDash`) is drawn solid, kept in `ext`.
  const head = lineEnd(kid(ln, A, "headEnd") ?? kid(themed, A, "headEnd"));
  const tail = lineEnd(kid(ln, A, "tailEnd") ?? kid(themed, A, "tailEnd"));
  return {
    color: fill.fill,
    width,
    ...(dash && dash !== "solid" && DASHES.has(dash) ? { dash } : {}),
    ...(head ? { head } : {}),
    ...(tail ? { tail } : {}),
  };
}

/** A path coordinate or guide reference as the file has it: a number or a guide's name. */
const arg = (value: string | undefined) => (value && value.length <= 64 ? value : undefined);

/** A custom geometry (`a:custGeom`) as the node's `custom`; undefined when not drawable. */
function customOf(geom: XmlElement): Json | undefined {
  const guides: Json[] = [];
  for (const list of ["avLst", "gdLst"])
    for (const gd of elements(kid(geom, A, list) ?? geom).filter((e) => e.local === "gd")) {
      const name = plain(gd, "name");
      const formula = plain(gd, "fmla");
      if (!name || !formula || name.length > 64 || formula.length > 1024) return undefined;
      guides.push({ name, formula });
    }
  const paths: Json[] = [];
  for (const path of elements(kid(geom, A, "pathLst") ?? geom).filter((e) => e.local === "path")) {
    const commands: Json[] = [];
    for (const c of elements(path)) {
      const points = elements(c)
        .filter((p) => p.local === "pt")
        .flatMap((p) => [arg(plain(p, "x")), arg(plain(p, "y"))]);
      if (points.some((p) => p === undefined)) return undefined;
      const op = { moveTo: "M", lnTo: "L", cubicBezTo: "C", quadBezTo: "Q" }[c.local];
      if (op) {
        const count = { M: 2, L: 2, C: 6, Q: 4 }[op];
        if (points.length !== count) return undefined;
        commands.push({ op, args: points });
      } else if (c.local === "arcTo") {
        const args = ["wR", "hR", "stAng", "swAng"].map((k) => arg(plain(c, k)));
        if (args.some((a) => a === undefined)) return undefined;
        commands.push({ op: "A", args });
      } else if (c.local === "close") commands.push({ op: "Z" });
      else return undefined;
    }
    const w = integer(plain(path, "w"));
    const h = integer(plain(path, "h"));
    const fill = plain(path, "fill");
    const stroke = plain(path, "stroke");
    if (commands.length > 100_000) return undefined;
    paths.push({
      ...(w !== undefined && w >= 0 && w <= 2_147_483_647 ? { width: w } : {}),
      ...(h !== undefined && h >= 0 && h <= 2_147_483_647 ? { height: h } : {}),
      ...(fill && fill !== "norm" ? { fill } : {}),
      ...(stroke === "0" || stroke === "false" ? { stroke: false } : {}),
      commands,
    });
  }
  if (!paths.length || paths.length > 100) return undefined;
  const rect = kid(geom, A, "rect");
  const text = rect && ["l", "t", "r", "b"].map((k) => arg(plain(rect, k)));
  return {
    ...(guides.length ? { guides } : {}),
    paths,
    // The whole shape (`l t r b`, the default) is left out.
    ...(text?.every(Boolean) && text.join(" ") !== "l t r b"
      ? { text: { l: text[0], t: text[1], r: text[2], b: text[3] } }
      : {}),
  };
}

/** `a:prstGeom`'s adjust values (`a:gd name="adj" fmla="val 25000"`); undefined if not numbers. */
function adjustOf(geom: XmlElement): Json | null | undefined {
  const out: Json = {};
  const gds = elements(kid(geom, A, "avLst") ?? geom).filter((e) => e.local === "gd");
  if (gds.length > 32) return undefined;
  for (const gd of gds) {
    const name = plain(gd, "name");
    const match = /^val\s+(-?\d+)$/.exec(plain(gd, "fmla")?.trim() ?? "");
    const value = match ? Number(match[1]) : Number.NaN;
    if (
      !name ||
      name.length > 64 ||
      !Number.isSafeInteger(value) ||
      Math.abs(value) > MAX_COORDINATE
    )
      return undefined;
    out[name] = value;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * What a shape's run content `el` says (its node's attributes but `story` and `ext`) and its
 * `w:txbxContent` if it has text; undefined for content Foli keeps opaque (or a text box).
 * @internal
 */
export function drawnShapeOf(
  el: XmlElement,
  context: TextBoxContext,
): { attrs: Json; txbx: XmlElement | undefined } | undefined {
  let drawing: XmlElement | undefined;
  if (el.ns === MC && el.local === "AlternateContent") {
    const choice = elements(el).find((c) => c.ns === MC && c.local === "Choice");
    const only = choice && elements(choice).length === 1 ? elements(choice)[0] : undefined;
    if (only && isW(only, "drawing")) drawing = only;
  } else if (isW(el, "drawing")) drawing = el;
  return drawing ? shapeIn(drawing, context) : undefined;
}

function shapeIn(
  drawing: XmlElement,
  context: TextBoxContext,
): { attrs: Json; txbx: XmlElement | undefined } | undefined {
  const frame = kid(drawing, WP, "inline") ?? kid(drawing, WP, "anchor");
  if (!frame || elements(drawing).length !== 1) return undefined;
  const float = frame.local === "anchor" ? floatOf(frame) : null;
  if (float === undefined) return undefined;
  const data = descendant(frame, A, "graphicData");
  if (plain(data, "uri") !== WPS) return undefined;
  const shape = data ? kid(data, WPS, "wsp") : undefined;
  const spPr = kid(shape, WPS, "spPr");
  if (!shape || !spPr || kid(shape, WPS, "linkedTxbx")) return undefined;
  const txbx = kid(kid(shape, WPS, "txbx"), W, "txbxContent");
  const prst = kid(spPr, A, "prstGeom");
  const cust = kid(spPr, A, "custGeom");
  const geometry = prst ? plain(prst, "prst") : cust ? "custom" : undefined;
  if (!geometry || !/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(geometry)) return undefined;
  const adjust = prst ? adjustOf(prst) : null;
  const custom = cust ? customOf(cust) : null;
  if (adjust === undefined || custom === undefined) return undefined;
  const extent = kid(frame, WP, "extent");
  const width = emu(plain(extent, "cx"));
  const height = emu(plain(extent, "cy"));
  if (width === undefined || height === undefined) return undefined;
  const xfrm = kid(spPr, A, "xfrm");
  const rot = integer(plain(xfrm, "rot")) ?? 0;
  const rotation = ((rot % 21_600_000) + 21_600_000) % 21_600_000;
  const flag = (local: string) => {
    const v = plain(xfrm, local);
    return v === "1" || v === "true";
  };
  const style = kid(shape, WPS, "style");
  const fill = shapeFill(spPr, style, context);
  const outline = shapeLine(spPr, style, context);
  if (fill === "unknown" || outline === "unknown") return undefined;
  const body = kid(shape, WPS, "bodyPr");
  // Vertical or turned text, drawn across, would be wrong: kept opaque.
  const vert = plain(body, "vert");
  if (txbx && vert && vert !== "horz") return undefined;
  if (txbx && (integer(plain(body, "rot")) ?? 0) % 21_600_000 !== 0) return undefined;
  const inset = {
    left: emu(plain(body, "lIns")) ?? DEFAULT_INSET.left,
    top: emu(plain(body, "tIns")) ?? DEFAULT_INSET.top,
    right: emu(plain(body, "rIns")) ?? DEFAULT_INSET.right,
    bottom: emu(plain(body, "bIns")) ?? DEFAULT_INSET.bottom,
  };
  const anchor = plain(body, "anchor");
  const textColor = colorOf(firstColor(kid(style, A, "fontRef")), context);
  const docPr = kid(frame, WP, "docPr");
  const alt = plain(docPr, "descr");
  const title = plain(docPr, "title");
  const decorative = plain(descendant(docPr, ADEC, "decorative"), "val");
  return {
    txbx,
    attrs: {
      geometry,
      ...(adjust ? { adjust } : {}),
      ...(custom ? { custom } : {}),
      width,
      height,
      ...(float ? { float } : {}),
      ...(rotation ? { rotation } : {}),
      ...(flag("flipH") ? { flipH: true } : {}),
      ...(flag("flipV") ? { flipV: true } : {}),
      fill: fill.fill,
      ...(fill.gradient ? { gradient: fill.gradient } : {}),
      outline,
      ...(txbx && !sameInset(inset) ? { inset } : {}),
      ...(txbx && anchor === "ctr"
        ? { verticalAlign: "center" }
        : txbx && anchor === "b"
          ? { verticalAlign: "bottom" }
          : {}),
      ...(txbx && kid(body, A, "spAutoFit") ? { autoFit: true } : {}),
      ...(txbx && textColor ? { textColor } : {}),
      ...(alt !== undefined ? { alt } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(decorative === "1" || decorative === "true" ? { decorative: true } : {}),
    },
  };
}

/**
 * The `shape` node attributes of a run's child `el`, its text read as a story and added;
 * undefined for anything Foli keeps opaque. `read` reads a shape's blocks.
 * @internal
 */
export function shapeOf(
  el: XmlElement,
  context: TextBoxContext,
  read: (children: XmlElement["children"]) => NodeJSON[],
): Json | undefined {
  if (!holdsBoxes(context)) return undefined;
  const found = drawnShapeOf(el, context);
  if (!found) return undefined;
  const story = found.txbx ? addStory(found.txbx, context, read) : undefined;
  if (found.txbx && !story) return undefined;
  return { ...found.attrs, ...(story ? { story } : {}), ext: sourceOf(context, el) };
}
