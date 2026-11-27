/**
 * Shapes drawn (Phase 34, ADR-0017): a `shape` node's geometry as SVG paths in its box, filled
 * with its color or gradient, stroked with its line (width, dash, ends), flipped as it says.
 * The box itself (size, turn, text) is `shapeElement`'s (`blocks.ts`).
 */

import { definitionOf, drawPaths, textRect } from "./geometry.js";

const SVG = "http://www.w3.org/2000/svg";
const EMU_PER_PX = 9525;

type Attrs = Record<string, unknown>;
interface Outline {
  color?: string;
  width?: number;
  dash?: string;
  head?: { type?: string; width?: string; length?: string };
  tail?: { type?: string; width?: string; length?: string };
}
interface Gradient {
  stops?: { position: number; color: string }[];
  angle?: number;
  path?: string;
}

/** `prstDash` as SVG dashes, in line widths (Word's patterns). */
const DASHES: Record<string, number[]> = {
  dot: [1, 1],
  dash: [4, 3],
  lgDash: [8, 3],
  dashDot: [4, 3, 1, 3],
  lgDashDot: [8, 3, 1, 3],
  lgDashDotDot: [8, 3, 1, 3, 1, 3],
  sysDash: [3, 1],
  sysDot: [1, 1],
  sysDashDot: [3, 1, 1, 1],
  sysDashDotDot: [3, 1, 1, 1, 1, 1],
};
/** A line end's size, in line widths. */
const END_SIZE: Record<string, number> = { sm: 2, med: 3, lg: 5 };

/** Ids of SVG definitions: unique in the page, whatever bundles share it. */
let unique = 0;
const PREFIX = `foli-shape-${Math.random().toString(36).slice(2, 8)}-`;

/**
 * `copy` (a drawing cloned for another page: a header's) with its shapes' SVG ids made its own,
 * and what points at them: a gradient or line end otherwise names the first copy's, which may be
 * hidden (a header open on its page).
 * @internal
 */
export function withOwnIds<T extends Node>(copy: T): T {
  if (!(copy instanceof Element || copy instanceof DocumentFragment)) return copy;
  const renamed = new Map<string, string>();
  for (const element of copy.querySelectorAll(`[id^="${PREFIX}"]`)) {
    const id = `${PREFIX}${++unique}`;
    renamed.set(element.id, id);
    element.id = id;
  }
  if (!renamed.size) return copy;
  for (const element of copy.querySelectorAll("[fill^='url(#'], [marker-start], [marker-end]"))
    for (const name of ["fill", "marker-start", "marker-end"]) {
      const value = element.getAttribute(name);
      const id = value?.match(/^url\(#(.+)\)$/)?.[1];
      const to = id && renamed.get(id);
      if (to) element.setAttribute(name, `url(#${to})`);
    }
  return copy;
}

const el = (doc: Document, name: string, attrs: Record<string, string | number> = {}) => {
  const e = doc.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

/** A gradient's SVG element in a `w` by `h` box; its id. */
function gradientElement(doc: Document, gradient: Gradient, w: number, h: number, id: string) {
  const stops = [...(gradient.stops ?? [])].sort((a, b) => a.position - b.position);
  let g: SVGElement;
  if (gradient.path) {
    // From the center out (`a:path` with its fill-to rectangle at the middle).
    g = el(doc, "radialGradient", {
      id,
      gradientUnits: "userSpaceOnUse",
      cx: w / 2,
      cy: h / 2,
      r: Math.hypot(w, h) / 2,
    });
  } else {
    // Clockwise from left to right, not scaled with the box (`a:lin scaled="0"`).
    const a = (((gradient.angle ?? 0) / 60_000) * Math.PI) / 180;
    const half = (Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))) / 2;
    const dx = Math.cos(a) * half;
    const dy = Math.sin(a) * half;
    g = el(doc, "linearGradient", {
      id,
      gradientUnits: "userSpaceOnUse",
      x1: w / 2 - dx,
      y1: h / 2 - dy,
      x2: w / 2 + dx,
      y2: h / 2 + dy,
    });
  }
  for (const stop of stops)
    g.append(el(doc, "stop", { offset: stop.position / 100_000, "stop-color": `#${stop.color}` }));
  return g;
}

/** A line end as an SVG marker (sized in line widths); its id. */
function markerElement(
  doc: Document,
  end: NonNullable<Outline["head"]>,
  color: string,
  id: string,
  start: boolean,
  lineWidth: number,
) {
  // In px: Word sizes an end from the line's width, but not below a thin line's (about 1.5 pt).
  const unit = Math.max(lineWidth, 2);
  const length = (END_SIZE[end.length ?? "med"] ?? 3) * unit;
  const width = (END_SIZE[end.width ?? "med"] ?? 3) * unit;
  const center = end.type === "oval" || end.type === "diamond";
  const marker = el(doc, "marker", {
    id,
    viewBox: "0 0 10 10",
    refX: center ? 5 : 10,
    refY: 5,
    markerWidth: length,
    markerHeight: width,
    markerUnits: "userSpaceOnUse",
    orient: start ? "auto-start-reverse" : "auto",
    preserveAspectRatio: "none",
  });
  const fill = { fill: `#${color}`, stroke: "none" };
  switch (end.type) {
    case "stealth":
      marker.append(el(doc, "path", { d: "M0 0L10 5L0 10L3 5Z", ...fill }));
      break;
    case "diamond":
      marker.append(el(doc, "path", { d: "M0 5L5 0L10 5L5 10Z", ...fill }));
      break;
    case "oval":
      marker.append(el(doc, "ellipse", { cx: 5, cy: 5, rx: 5, ry: 5, ...fill }));
      break;
    case "arrow":
      // Open: two strokes of the line's width.
      marker.append(
        el(doc, "path", {
          d: "M1 1L10 5L1 9",
          fill: "none",
          stroke: `#${color}`,
          "stroke-width": (10 * lineWidth) / Math.max(width, length),
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        }),
      );
      break;
    default:
      marker.append(el(doc, "path", { d: "M0 0L10 5L0 10Z", ...fill }));
  }
  return marker;
}

/** What a path's `fill` mode lays over its paint: shade or light, and how much. */
const OVERLAY: Record<string, [string, number]> = {
  darken: ["#000", 0.4],
  darkenLess: ["#000", 0.2],
  lighten: ["#fff", 0.4],
  lightenLess: ["#fff", 0.2],
};

/**
 * The SVG drawing of shape `attrs` in its box (`width` by `height`, EMU): its geometry's paths
 * (a preset Foli does not draw, or a custom geometry it cannot read: the box), filled and
 * stroked, flipped. Strokes and ends drawn over the box's edge.
 * @internal
 */
export function shapeSvg(attrs: Attrs, doc: Document): SVGSVGElement {
  const w = Number(attrs.width) / EMU_PER_PX;
  const h = Number(attrs.height) / EMU_PER_PX;
  const svg = el(doc, "svg", {
    // In px, no viewBox; a line's box may have no height (or width), which SVG would not draw.
    width: Math.max(w, 1),
    height: Math.max(h, 1),
    "aria-hidden": "true",
    focusable: "false",
  }) as SVGSVGElement;
  svg.style.position = "absolute";
  svg.style.left = "0";
  svg.style.top = "0";
  svg.style.overflow = "visible";
  svg.style.pointerEvents = "none";
  const def = definitionOf(attrs) ?? definitionOf({ geometry: "rect" });
  const adjust = attrs.adjust as Record<string, number> | null | undefined;
  // A custom path without a size of its own is in the shape's EMU (`a:path` w and h).
  const space =
    attrs.geometry === "custom"
      ? ([Number(attrs.width), Number(attrs.height)] as [number, number])
      : undefined;
  const paths = def ? drawPaths(def, w, h, adjust, space) : [];
  const defs = el(doc, "defs");
  const id = `${PREFIX}${++unique}`;
  const gradient = attrs.gradient as Gradient | null | undefined;
  let paint = typeof attrs.fill === "string" ? `#${attrs.fill}` : "none";
  if (gradient?.stops?.length) {
    defs.append(gradientElement(doc, gradient, w, h, `${id}-g`));
    paint = `url(#${id}-g)`;
  }
  const outline = attrs.outline as Outline | null | undefined;
  const line = outline?.color ? outline : null;
  const lineWidth = line ? Math.max((line.width ?? 9525) / EMU_PER_PX, 0.5) : 0;
  const ends: Record<string, string> = {};
  if (line?.head?.type && line.color) {
    defs.append(markerElement(doc, line.head, line.color, `${id}-h`, true, lineWidth));
    ends["marker-start"] = `url(#${id}-h)`;
  }
  if (line?.tail?.type && line.color) {
    defs.append(markerElement(doc, line.tail, line.color, `${id}-t`, false, lineWidth));
    ends["marker-end"] = `url(#${id}-t)`;
  }
  if (defs.childNodes.length) svg.append(defs);
  const group = el(doc, "g");
  // Flipped about the box's middle (the turn is the box's own, `shapeElement`).
  if (attrs.flipH === true || attrs.flipV === true)
    group.setAttribute(
      "transform",
      `translate(${attrs.flipH === true ? w : 0} ${attrs.flipV === true ? h : 0}) scale(${attrs.flipH === true ? -1 : 1} ${attrs.flipV === true ? -1 : 1})`,
    );
  for (const path of paths) {
    if (path.fill !== "none" && paint !== "none") {
      group.append(
        el(doc, "path", {
          d: path.d,
          fill: paint,
          stroke: "none",
          ...(attrs.geometry === "custom" ? { "fill-rule": "evenodd" } : {}),
        }),
      );
      const overlay = OVERLAY[path.fill];
      if (overlay)
        group.append(
          el(doc, "path", {
            d: path.d,
            fill: overlay[0],
            "fill-opacity": overlay[1],
            stroke: "none",
          }),
        );
    }
    if (path.stroke && line?.color) {
      const dash = line.dash ? DASHES[line.dash] : undefined;
      const open = !/Z\s*$/i.test(path.d);
      group.append(
        el(doc, "path", {
          d: path.d,
          fill: "none",
          stroke: `#${line.color}`,
          "stroke-width": lineWidth,
          "stroke-linejoin": "miter",
          "stroke-miterlimit": 8,
          ...(dash ? { "stroke-dasharray": dash.map((d) => d * lineWidth).join(" ") } : {}),
          // Line ends on an open path (lines, connectors, arcs).
          ...(open ? ends : {}),
        }),
      );
    }
  }
  svg.append(group);
  return svg;
}

/**
 * The text rectangle of shape `attrs` in px: left, top, width, height.
 * @internal
 */
export function shapeTextRect(attrs: Attrs): [number, number, number, number] {
  const w = Number(attrs.width) / EMU_PER_PX;
  const h = Number(attrs.height) / EMU_PER_PX;
  const def = definitionOf(attrs);
  const [l, t, r, b] = def
    ? textRect(def, w, h, attrs.adjust as Record<string, number> | null)
    : [0, 0, w, h];
  const left = attrs.flipH === true ? w - r : l;
  const top = attrs.flipV === true ? h - b : t;
  return [left, top, Math.max(r - l, 0), Math.max(b - t, 0)];
}
