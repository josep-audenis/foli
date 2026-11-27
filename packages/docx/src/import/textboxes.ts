/**
 * Text boxes (Phase 33, ADR-0016): a run's `mc:AlternateContent` whose Choice is a DrawingML
 * text box (`wps:wsp` holding `wps:txbx`, a rectangle), a bare such `w:drawing`, or a VML one
 * (`w:pict` with a `v:shape` or `v:rect` holding `v:textbox`). Its `w:txbxContent` becomes a story
 * of kind `textBox`, read with the body's reader; the node keeps what it is drawn with (size,
 * position, wrapping, fill, outline, insets) and the run content verbatim. Anything else (a
 * shape that is not a rectangle, a rotated or linked box, a group, a box in a note or comment or
 * in another box) stays opaque.
 */
import type { NodeJSON, StoryJSON } from "@folijs/core";
import type { DocxPackage } from "../package.js";
import type { XmlElement } from "../xml.js";
import { A, elements, integer, isW, REL } from "./ooxml.js";
import { theme } from "./parts.js";
import { floatOf, WP } from "./pictures.js";
import { type Context, sourceOf } from "./properties.js";

/** @internal */
export const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
/** @internal */
export const WPS = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape";
/** @internal */
export const V = "urn:schemas-microsoft-com:vml";
const W10 = "urn:schemas-microsoft-com:office:word";
const MAX_EMU = 2_147_483_647;

/**
 * Word's insets when none are given: 0.1" left and right, 0.05" top and bottom.
 * @internal
 */
export const DEFAULT_INSET = { left: 91_440, top: 45_720, right: 91_440, bottom: 45_720 };

/**
 * What reading a text box needs beyond a part's context.
 * @internal
 */
export interface TextBoxContext extends Context {
  readonly pkg?: DocxPackage | undefined;
  /** The theme's colors, when known without the package (export). */
  readonly colors?: Record<string, string> | undefined;
  /** What the box is in: a box in a note, a comment or a box stays opaque. */
  readonly story?: string | undefined;
  /** Where the part's text boxes go, and the prefix of their ids (`textbox:`, `textbox:rId7/`). */
  readonly textBoxes?: { readonly stories: Map<string, StoryJSON>; readonly prefix: string };
}

/** @internal */
export const kid = (el: XmlElement | undefined, ns: string, local: string) =>
  el?.children.find(
    (c): c is XmlElement => c.kind === "element" && c.ns === ns && c.local === local,
  );

/** @internal */
export function descendant(
  el: XmlElement | undefined,
  ns: string,
  local: string,
): XmlElement | undefined {
  if (!el) return undefined;
  for (const c of el.children) {
    if (c.kind !== "element") continue;
    if (c.ns === ns && c.local === local) return c;
    const found = descendant(c, ns, local);
    if (found) return found;
  }
  return undefined;
}

/** @internal */
export const plain = (el: XmlElement | undefined, local: string) =>
  el?.attributes.find((a) => a.local === local && !a.prefix)?.value;

/** @internal */
export const emu = (value: string | undefined) => {
  const n = integer(value);
  return n !== undefined && n >= 0 && n <= MAX_EMU ? n : undefined;
};

/** The theme's colors of a package, read once. */
const themes = new WeakMap<DocxPackage, Record<string, string>>();
/** @internal */
export function themeColors(context: TextBoxContext): Record<string, string> {
  if (context.colors || !context.pkg) return context.colors ?? {};
  let found = themes.get(context.pkg);
  if (!found) {
    found = {};
    try {
      const rel = context.pkg
        .relationships(context.pkg.mainDocument)
        .find((r) => r.type === REL.theme && !r.external);
      const root = rel?.partName ? context.pkg.xml(rel.partName).root : undefined;
      if (root) found = theme(root, context)?.colors ?? {};
    } catch {}
    themes.set(context.pkg, found);
  }
  return found;
}

/** Scheme names a shape uses for the theme's slots (Word's default color mapping). */
const MAPPED: Record<string, string> = { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2" };
const PRESET: Record<string, string> = { black: "000000", white: "FFFFFF" };

/** `hex` with DrawingML's luminance modifiers (`lumMod`, `lumOff`, `shade`, `tint`) applied. */
/** @internal */
export function modified(hex: string, color: XmlElement): string {
  let [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const value = (local: string) => {
    const n = integer(plain(kid(color, A, local), "val"));
    return n === undefined ? undefined : n / 100_000;
  };
  const shade = value("shade");
  const tint = value("tint");
  // Shade and tint in linear light, as Word draws them (its 15% shade of 156082 is 042433).
  const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const gamma = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
  if (shade !== undefined || tint !== undefined) {
    [r, g, b] = [r, g, b].map((c) => {
      let l = linear(c);
      if (shade !== undefined) l *= shade;
      if (tint !== undefined) l = l + (1 - l) * (1 - tint);
      return gamma(l);
    }) as [number, number, number];
  }
  const lumMod = value("lumMod");
  const lumOff = value("lumOff");
  if (lumMod !== undefined || lumOff !== undefined) {
    // In HSL, luminance scaled then offset.
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let l = (max + min) / 2;
    const d = max - min;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d + 6) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
    }
    l = Math.min(1, Math.max(0, l * (lumMod ?? 1) + (lumOff ?? 0)));
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h % 2) - 1));
    const m = l - c / 2;
    const [r1, g1, b1] =
      h < 1
        ? [c, x, 0]
        : h < 2
          ? [x, c, 0]
          : h < 3
            ? [0, c, x]
            : h < 4
              ? [0, x, c]
              : h < 5
                ? [x, 0, c]
                : [c, 0, x];
    [r, g, b] = [r1 + m, g1 + m, b1 + m];
  }
  return [r, g, b]
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, c)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase();
}

/**
 * A DrawingML color element (`a:srgbClr`, `a:schemeClr`…) as RRGGBB; `placeholder` is what a
 * theme style's `phClr` stands for.
 * @internal
 */
export function colorOf(
  color: XmlElement | undefined,
  context: TextBoxContext,
  placeholder?: string,
): string | undefined {
  if (!color || color.ns !== A) return undefined;
  const val = plain(color, "val");
  let hex: string | undefined;
  if (color.local === "srgbClr") hex = val;
  else if (color.local === "sysClr") hex = plain(color, "lastClr");
  else if (color.local === "prstClr") hex = val ? PRESET[val] : undefined;
  else if (color.local === "schemeClr" && val === "phClr") hex = placeholder;
  else if (color.local === "schemeClr" && val) hex = themeColors(context)[MAPPED[val] ?? val];
  return hex && /^[0-9A-Fa-f]{6}$/.test(hex) ? modified(hex.toUpperCase(), color) : undefined;
}

/** @internal */
export const firstColor = (el: XmlElement | undefined) =>
  el?.children.find((c) => c.kind === "element") as XmlElement | undefined;

/** A fill (`a:noFill`, `a:solidFill`, `a:gradFill`'s first stop) as RRGGBB, null for none. */
function fillOf(
  parent: XmlElement | undefined,
  context: TextBoxContext,
): string | null | undefined {
  if (kid(parent, A, "noFill")) return null;
  const solid = kid(parent, A, "solidFill");
  if (solid) return colorOf(firstColor(solid), context) ?? null;
  const gradient = kid(parent, A, "gradFill");
  if (gradient) return colorOf(firstColor(descendant(gradient, A, "gs")), context) ?? null;
  return undefined;
}

/** The text box's (or shape's) story read from `txbx` (`w:txbxContent`), added; its id. */
/** @internal */
export function addStory(
  txbx: XmlElement,
  context: TextBoxContext,
  read: (children: XmlElement["children"]) => NodeJSON[],
): string | undefined {
  const boxes = context.textBoxes;
  if (!boxes) return undefined;
  let n = 1;
  while (boxes.stories.has(`${boxes.prefix}${n}`)) n++;
  const id = `${boxes.prefix}${n}`;
  // Taken first: boxes in it (kept opaque) cannot take the id.
  const content = read(txbx.children);
  boxes.stories.set(id, {
    kind: "textBox",
    content: { type: "doc", content: content.length ? content : [{ type: "paragraph" }] },
  });
  return id;
}

/** Where text boxes may be: the body, headers and footers. */
/** @internal */
export const holdsBoxes = (context: TextBoxContext) =>
  !!context.textBoxes &&
  (context.story === undefined || context.story === "header" || context.story === "footer");

/**
 * The `textBox` node attributes of a run's child `el`, its story read and added; undefined for
 * anything Foli keeps opaque. `read` reads a text box's blocks (as a story of kind `textBox`).
 * @internal
 */
export function textBoxOf(
  el: XmlElement,
  context: TextBoxContext,
  read: (children: XmlElement["children"]) => NodeJSON[],
): Record<string, unknown> | undefined {
  if (!holdsBoxes(context)) return undefined;
  const found = boxOf(el, context);
  if (!found) return undefined;
  const story = addStory(found.txbx, context, read);
  if (!story) return undefined;
  return { story, ...found.attrs, ext: sourceOf(context, el) };
}

/**
 * What a text box's run content `el` says (its node's attributes but `story` and `ext`), and
 * the `w:txbxContent` Word reads; undefined for content Foli keeps opaque.
 * @internal
 */
export function boxOf(
  el: XmlElement,
  context: TextBoxContext,
): { attrs: Record<string, unknown>; txbx: XmlElement } | undefined {
  let found: { attrs: Record<string, unknown>; txbx: XmlElement } | undefined;
  if (el.ns === MC && el.local === "AlternateContent") {
    const choice = elements(el).find((c) => c.ns === MC && c.local === "Choice");
    const fallback = kid(el, MC, "Fallback");
    const drawing = choice && elements(choice).length === 1 ? elements(choice)[0] : undefined;
    if (drawing && isW(drawing, "drawing")) found = drawingBox(drawing, context);
    else if (!choice && fallback) {
      const pict = elements(fallback).length === 1 ? elements(fallback)[0] : undefined;
      if (pict && isW(pict, "pict")) found = vmlBox(pict);
    }
  } else if (isW(el, "drawing")) found = drawingBox(el, context);
  else if (isW(el, "pict")) found = vmlBox(el);
  return found;
}

/** A `w:drawing` holding one DrawingML text box. */
function drawingBox(
  drawing: XmlElement,
  context: TextBoxContext,
): { attrs: Record<string, unknown>; txbx: XmlElement } | undefined {
  const children = elements(drawing);
  const frame = kid(drawing, WP, "inline") ?? kid(drawing, WP, "anchor");
  if (!frame || children.length !== 1) return undefined;
  const float = frame.local === "anchor" ? floatOf(frame) : null;
  if (float === undefined) return undefined;
  const data = descendant(frame, A, "graphicData");
  if (plain(data, "uri") !== WPS) return undefined;
  const shape = data ? kid(data, WPS, "wsp") : undefined;
  const txbx = kid(
    kid(shape, WPS, "txbx"),
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "txbxContent",
  );
  const spPr = kid(shape, WPS, "spPr");
  const geometry = plain(kid(spPr, A, "prstGeom"), "prst");
  const xfrm = kid(spPr, A, "xfrm");
  const rotation = integer(plain(xfrm, "rot")) ?? 0;
  // A rectangle, upright: what Word's text box is. Shapes with text are Phase 34's.
  if (!txbx || !spPr || geometry !== "rect" || rotation % 21_600_000 !== 0) return undefined;
  const extent = kid(frame, WP, "extent");
  const width = emu(plain(extent, "cx"));
  const height = emu(plain(extent, "cy"));
  if (width === undefined || height === undefined) return undefined;
  const style = kid(shape, WPS, "style");
  const fill =
    fillOf(spPr, context) ?? colorOf(firstColor(kid(style, A, "fillRef")), context) ?? null;
  const ln = kid(spPr, A, "ln");
  const lnFill = ln ? fillOf(ln, context) : undefined;
  const lnColor =
    lnFill === undefined ? colorOf(firstColor(kid(style, A, "lnRef")), context) : lnFill;
  // A line with no width given is DrawingML's default, 0.75 pt (Word draws it so).
  const outline =
    lnColor && (ln || style) ? { color: lnColor, width: emu(plain(ln, "w")) ?? 9525 } : null;
  const body = kid(shape, WPS, "bodyPr");
  const inset = {
    left: emu(plain(body, "lIns")) ?? DEFAULT_INSET.left,
    top: emu(plain(body, "tIns")) ?? DEFAULT_INSET.top,
    right: emu(plain(body, "rIns")) ?? DEFAULT_INSET.right,
    bottom: emu(plain(body, "bIns")) ?? DEFAULT_INSET.bottom,
  };
  const anchor = plain(body, "anchor");
  const docPr = kid(frame, WP, "docPr");
  const alt = plain(docPr, "descr");
  const title = plain(docPr, "title");
  return {
    txbx,
    attrs: {
      width,
      height,
      ...(float ? { float } : {}),
      fill,
      outline,
      ...(sameInset(inset) ? {} : { inset }),
      ...(anchor === "ctr"
        ? { verticalAlign: "center" }
        : anchor === "b"
          ? { verticalAlign: "bottom" }
          : {}),
      ...(kid(body, A, "spAutoFit") ? { autoFit: true } : {}),
      ...(alt !== undefined ? { alt } : {}),
      ...(title !== undefined ? { title } : {}),
    },
  };
}

/** @internal */
export const sameInset = (inset: Record<string, number>) =>
  inset.left === DEFAULT_INSET.left &&
  inset.top === DEFAULT_INSET.top &&
  inset.right === DEFAULT_INSET.right &&
  inset.bottom === DEFAULT_INSET.bottom;

/** A VML `style` as its properties. */
function styleOf(value: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (value ?? "").split(";")) {
    const at = part.indexOf(":");
    if (at > 0) out.set(part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim());
  }
  return out;
}

const UNITS: Record<string, number> = {
  pt: 12_700,
  in: 914_400,
  cm: 360_000,
  mm: 36_000,
  px: 9525,
  pc: 152_400,
  "": 9525,
  emu: 1,
};

/** A VML length (`170pt`, `0.1in`, `12`) in EMU. */
function lengthOf(value: string | undefined): number | undefined {
  const match = /^(-?\d*\.?\d+)\s*([a-z]*)$/i.exec((value ?? "").trim());
  const unit = match ? UNITS[(match[2] ?? "").toLowerCase()] : undefined;
  if (!match || unit === undefined) return undefined;
  const n = Math.round(Number(match[1]) * unit);
  return Math.abs(n) <= MAX_EMU ? n : undefined;
}

const NAMED: Record<string, string> = {
  black: "000000",
  white: "FFFFFF",
  silver: "C0C0C0",
  gray: "808080",
  red: "FF0000",
  maroon: "800000",
  yellow: "FFFF00",
  olive: "808000",
  lime: "00FF00",
  green: "008000",
  aqua: "00FFFF",
  teal: "008080",
  blue: "0000FF",
  navy: "000080",
  fuchsia: "FF00FF",
  purple: "800080",
};

/** A VML color (`#f2f2f2`, `#fff`, `white [3212]`) as RRGGBB. */
function vmlColor(value: string | undefined, fallback: string): string | undefined {
  const v = (value ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!v) return fallback;
  if (/^#[0-9a-f]{6}$/.test(v)) return v.slice(1).toUpperCase();
  if (/^#[0-9a-f]{3}$/.test(v))
    return [...v.slice(1)]
      .map((c) => c + c)
      .join("")
      .toUpperCase();
  return NAMED[v];
}

const off = (value: string | undefined) => value === "f" || value === "false";

/** VML's `mso-position-*-relative` to DrawingML's `relativeFrom`. */
const RELATIVE_H: Record<string, string> = {
  margin: "margin",
  page: "page",
  text: "column",
  char: "character",
  "left-margin-area": "leftMargin",
  "right-margin-area": "rightMargin",
  "inner-margin-area": "insideMargin",
  "outer-margin-area": "outsideMargin",
};
const RELATIVE_V: Record<string, string> = {
  margin: "margin",
  page: "page",
  text: "paragraph",
  line: "line",
  "top-margin-area": "topMargin",
  "bottom-margin-area": "bottomMargin",
  "inner-margin-area": "insideMargin",
  "outer-margin-area": "outsideMargin",
};
const ALIGNS = new Set(["left", "right", "center", "inside", "outside", "top", "bottom"]);
const VML_WRAPS: Record<string, string> = {
  square: "square",
  tight: "tight",
  through: "through",
  topAndBottom: "topAndBottom",
};

/** A VML text box: `w:pict` holding a text box shape (and its shape type) only. */
function vmlBox(
  pict: XmlElement,
): { attrs: Record<string, unknown>; txbx: XmlElement } | undefined {
  const shapes = elements(pict).filter((c) => !(c.ns === V && c.local === "shapetype"));
  const shape = shapes.length === 1 ? shapes[0] : undefined;
  if (!shape || shape.ns !== V || (shape.local !== "shape" && shape.local !== "rect"))
    return undefined;
  const type = plain(shape, "type");
  if (shape.local === "shape" && type !== "#_x0000_t202") return undefined;
  const textbox = kid(shape, V, "textbox");
  const txbx = kid(
    textbox,
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "txbxContent",
  );
  // Pictures and WordArt in the shape, or a linked box: kept opaque.
  if (!txbx || kid(shape, V, "imagedata") || kid(shape, V, "textpath")) return undefined;
  const style = styleOf(plain(shape, "style"));
  if (style.has("rotation") && Number.parseFloat(style.get("rotation") ?? "0") % 360 !== 0)
    return undefined;
  const width = lengthOf(style.get("width"));
  const height = lengthOf(style.get("height"));
  if (width === undefined || height === undefined || width < 0 || height < 0) return undefined;
  let float: Record<string, unknown> | null = null;
  if (style.get("position") === "absolute") {
    const axis = (
      relative: Record<string, string>,
      fallback: string,
      side: "horizontal" | "vertical",
      offsetKey: string,
    ) => {
      const relativeTo = relative[style.get(`mso-position-${side}-relative`) ?? "text"] ?? fallback;
      const align = style.get(`mso-position-${side}`);
      if (align && align !== "absolute" && ALIGNS.has(align)) return { relativeTo, align };
      const offset = lengthOf(style.get(`margin-${offsetKey}`) ?? style.get(offsetKey) ?? "0");
      return offset === undefined ? undefined : { relativeTo, offset };
    };
    const horizontal = axis(RELATIVE_H, "column", "horizontal", "left");
    const vertical = axis(RELATIVE_V, "paragraph", "vertical", "top");
    if (!horizontal || !vertical) return undefined;
    const wrapEl = kid(shape, W10, "wrap");
    const wrapType = plain(wrapEl, "type");
    const behind = Number.parseInt(style.get("z-index") ?? "0", 10) < 0;
    const wrap = wrapType ? VML_WRAPS[wrapType] : undefined;
    if (wrapType && wrapType !== "none" && !wrap) return undefined;
    const sideOf: Record<string, string> = {
      both: "bothSides",
      left: "left",
      right: "right",
      largest: "largest",
    };
    const side = sideOf[plain(wrapEl, "side") ?? ""];
    const distance = (key: string) =>
      Math.max(lengthOf(style.get(`mso-wrap-distance-${key}`)) ?? 0, 0);
    float = {
      horizontal,
      vertical,
      wrap: wrap ?? (behind ? "behind" : "inFront"),
      ...(side ? { side } : {}),
      distance: {
        top: distance("top"),
        bottom: distance("bottom"),
        left: distance("left"),
        right: distance("right"),
      },
    };
  }
  const fill = off(plain(shape, "filled"))
    ? null
    : (vmlColor(plain(shape, "fillcolor"), "FFFFFF") ?? null);
  const stroke = off(plain(shape, "stroked"))
    ? null
    : vmlColor(plain(shape, "strokecolor"), "000000");
  const outline = stroke
    ? {
        color: stroke,
        width: Math.max(lengthOf(plain(shape, "strokeweight") ?? "0.75pt") ?? 9525, 0),
      }
    : null;
  const insets = (plain(textbox, "inset") ?? "").split(",");
  const inset = {
    left: lengthOf(insets[0]) ?? DEFAULT_INSET.left,
    top: lengthOf(insets[1]) ?? DEFAULT_INSET.top,
    right: lengthOf(insets[2]) ?? DEFAULT_INSET.right,
    bottom: lengthOf(insets[3]) ?? DEFAULT_INSET.bottom,
  };
  const valid = Object.values(inset).every((n) => n >= 0);
  const boxStyle = styleOf(plain(textbox, "style"));
  const anchor = style.get("v-text-anchor");
  const alt = plain(shape, "alt");
  return {
    txbx,
    attrs: {
      width,
      height,
      ...(float ? { float } : {}),
      fill,
      outline,
      ...(valid && !sameInset(inset) ? { inset } : {}),
      ...(anchor === "middle"
        ? { verticalAlign: "center" }
        : anchor === "bottom"
          ? { verticalAlign: "bottom" }
          : {}),
      ...(boxStyle.get("mso-fit-shape-to-text") === "t" ? { autoFit: true } : {}),
      ...(alt !== undefined ? { alt } : {}),
    },
  };
}
