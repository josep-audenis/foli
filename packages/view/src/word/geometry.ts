/**
 * DrawingML geometry (Phase 34, ADR-0017): a shape's guides evaluated and its paths turned into
 * SVG path data. One interpreter for the presets (`presets.ts`, ECMA-376's definitions) and a
 * file's custom geometry (`a:custGeom`); 34.4's adjustment handles read the same guides.
 */

import { PRESETS } from "./presets.js";

/**
 * A path command: `M x y`, `L x y`, `C x1 y1 x2 y2 x y`, `Q x1 y1 x y`, `A wR hR stAng swAng`, `Z`.
 * @internal
 */
export interface GeometryCommand {
  readonly op: "M" | "L" | "C" | "Q" | "A" | "Z";
  readonly args?: readonly string[];
}

/**
 * A path: its own coordinate space (missing: the shape's), how it is filled and stroked.
 * @internal
 */
export interface GeometryPath {
  readonly width?: number;
  readonly height?: number;
  readonly fill?: "norm" | "none" | "lighten" | "lightenLess" | "darken" | "darkenLess";
  readonly stroke?: boolean;
  readonly commands: readonly GeometryCommand[];
}

/**
 * An adjustment handle (`a:ahXY`): the guides it moves on each axis, between bounds, and where it is.
 * @internal
 */
export interface GeometryHandle {
  readonly x?: readonly [ref: string, min: string, max: string];
  readonly y?: readonly [ref: string, min: string, max: string];
  readonly pos: readonly [x: string, y: string];
}

/**
 * A geometry as DrawingML defines one: adjust defaults, guides, paths, handles, text rectangle.
 * @internal
 */
export interface GeometryDefinition {
  readonly adjust?: Readonly<Record<string, number>>;
  readonly guides?: readonly { readonly name: string; readonly formula: string }[];
  readonly paths: readonly GeometryPath[];
  readonly handles?: readonly GeometryHandle[];
  readonly text?: {
    readonly l: string;
    readonly t: string;
    readonly r: string;
    readonly b: string;
  };
}

const DEGREE = 60_000;
const rad = (angle: number) => (angle / DEGREE) * (Math.PI / 180);
const MAX_GUIDES = 2000;

/**
 * The guides of `def` for a `w` by `h` shape (any unit) with `adjust` over its defaults: the
 * built-in names (`w`, `hc`, `ss`, `cd4`…) and each guide in order.
 * @internal
 */
export function guides(
  def: GeometryDefinition,
  w: number,
  h: number,
  adjust?: Readonly<Record<string, number>> | null,
): Map<string, number> {
  const ss = Math.min(w, h);
  const ls = Math.max(w, h);
  const values = new Map<string, number>([
    ["l", 0],
    ["t", 0],
    ["r", w],
    ["b", h],
    ["w", w],
    ["h", h],
    ["hc", w / 2],
    ["vc", h / 2],
    ["ss", ss],
    ["ls", ls],
    ["cd2", 10_800_000],
    ["cd4", 5_400_000],
    ["cd8", 2_700_000],
    ["3cd4", 16_200_000],
    ["3cd8", 8_100_000],
    ["5cd8", 13_500_000],
    ["7cd8", 18_900_000],
  ]);
  for (const n of [2, 3, 4, 5, 6, 8, 10, 12, 32]) {
    values.set(`wd${n}`, w / n);
    values.set(`hd${n}`, h / n);
  }
  for (const n of [2, 4, 6, 8, 16, 32]) values.set(`ssd${n}`, ss / n);
  for (const [name, value] of Object.entries(def.adjust ?? {}))
    values.set(name, adjust && Number.isFinite(adjust[name]) ? (adjust[name] as number) : value);
  // A file's adjust value for a name its definition does not list still counts (custom ones).
  for (const [name, value] of Object.entries(adjust ?? {}))
    if (!values.has(name) && Number.isFinite(value)) values.set(name, value);
  for (const { name, formula } of (def.guides ?? []).slice(0, MAX_GUIDES))
    values.set(name, evaluate(formula, values));
  return values;
}

/** A guide reference or a number. */
function value(token: string | undefined, values: ReadonlyMap<string, number>): number {
  if (token === undefined) return 0;
  const known = values.get(token);
  if (known !== undefined) return known;
  const n = Number(token);
  return Number.isFinite(n) ? n : 0;
}

/**
 * A DrawingML guide formula (`*\/ w adj 100000`, `?: x y z`…) with `values`.
 * @internal
 */
export function evaluate(formula: string, values: ReadonlyMap<string, number>): number {
  const [op, ...rest] = formula.trim().split(/\s+/);
  const [x, y, z] = rest.map((t) => value(t, values)) as [number, number, number];
  let out: number;
  switch (op) {
    case "*/":
      out = z === 0 ? 0 : (x * y) / z;
      break;
    case "+-":
      out = x + y - z;
      break;
    case "+/":
      out = z === 0 ? 0 : (x + y) / z;
      break;
    case "?:":
      out = x > 0 ? y : z;
      break;
    case "abs":
      out = Math.abs(x);
      break;
    case "at2":
      out = (Math.atan2(y, x) * 180 * DEGREE) / Math.PI;
      break;
    case "cat2":
      out = x * Math.cos(Math.atan2(z, y));
      break;
    case "cos":
      out = x * Math.cos(rad(y));
      break;
    case "max":
      out = Math.max(x, y);
      break;
    case "min":
      out = Math.min(x, y);
      break;
    case "mod":
      out = Math.sqrt(x * x + y * y + z * z);
      break;
    case "pin":
      out = y < x ? x : y > z ? z : y;
      break;
    case "sat2":
      out = x * Math.sin(Math.atan2(z, y));
      break;
    case "sin":
      out = x * Math.sin(rad(y));
      break;
    case "sqrt":
      out = Math.sqrt(Math.max(x, 0));
      break;
    case "tan":
      out = x * Math.tan(rad(y));
      break;
    case "val":
      out = x;
      break;
    default:
      out = 0;
  }
  return Number.isFinite(out) ? out : 0;
}

/**
 * A drawn path: its SVG data in the shape's box, and how it is filled and stroked.
 * @internal
 */
export interface DrawnPath {
  readonly d: string;
  readonly fill: NonNullable<GeometryPath["fill"]>;
  readonly stroke: boolean;
}

const n = (v: number) => String(Math.round(v * 100) / 100);

/**
 * The paths of `def` drawn in a `w` by `h` box (px): each command's coordinates scaled from the
 * path's own space, arcs (`a:arcTo`: from the current point, on an ellipse, angles clockwise as
 * seen) as SVG arcs.
 * @internal
 */
export function drawPaths(
  def: GeometryDefinition,
  w: number,
  h: number,
  adjust?: Readonly<Record<string, number>> | null,
  /** The space of a path without a size of its own (a custom geometry's: the shape's EMU). */
  space?: readonly [number, number],
): DrawnPath[] {
  const values = guides(def, w, h, adjust);
  return def.paths.map((path) => {
    // A path with its own size (0 is none) is drawn in it, its guides evaluated at that size.
    const pw = path.width || space?.[0] || 0;
    const ph = path.height || space?.[1] || 0;
    const own = pw > 0 && ph > 0;
    const local = own ? guides(def, pw, ph, adjust) : values;
    const sx = own ? w / pw : 1;
    const sy = own ? h / ph : 1;
    const parts: string[] = [];
    let x = 0;
    let y = 0;
    let startX = 0;
    let startY = 0;
    // Points are kept in the path's own space and scaled as they are written.
    const at = (args: readonly string[] | undefined, i: number): [number, number] => [
      value(args?.[i], local),
      value(args?.[i + 1], local),
    ];
    const p = (px: number, py: number) => `${n(px * sx)} ${n(py * sy)}`;
    for (const c of path.commands) {
      switch (c.op) {
        case "M":
          [x, y] = at(c.args, 0);
          [startX, startY] = [x, y];
          parts.push(`M${p(x, y)}`);
          break;
        case "L":
          [x, y] = at(c.args, 0);
          parts.push(`L${p(x, y)}`);
          break;
        case "C": {
          const [x1, y1] = at(c.args, 0);
          const [x2, y2] = at(c.args, 2);
          [x, y] = at(c.args, 4);
          parts.push(`C${p(x1, y1)} ${p(x2, y2)} ${p(x, y)}`);
          break;
        }
        case "Q": {
          const [x1, y1] = at(c.args, 0);
          [x, y] = at(c.args, 2);
          parts.push(`Q${p(x1, y1)} ${p(x, y)}`);
          break;
        }
        case "A": {
          const wR = value(c.args?.[0], local);
          const hR = value(c.args?.[1], local);
          const start = value(c.args?.[2], local);
          const sweep = value(c.args?.[3], local);
          [x, y] = arc(parts, x, y, wR, hR, start, sweep, sx, sy);
          break;
        }
        case "Z":
          parts.push("Z");
          [x, y] = [startX, startY];
          break;
      }
    }
    return { d: parts.join(""), fill: path.fill ?? "norm", stroke: path.stroke !== false };
  });
}

/** The point at visual angle `angle` (60 000ths of a degree) on an ellipse of radii `wR`, `hR`. */
function onEllipse(wR: number, hR: number, angle: number): [number, number] {
  const a = rad(angle);
  // The parametric angle whose point is seen at `a`.
  const t = Math.atan2(wR * Math.sin(a), hR * Math.cos(a));
  return [wR * Math.cos(t), hR * Math.sin(t)];
}

/** An `a:arcTo` from (`x`, `y`) appended to `parts` as SVG arcs; the point it ends at. */
function arc(
  parts: string[],
  x: number,
  y: number,
  wR: number,
  hR: number,
  start: number,
  sweep: number,
  sx = 1,
  sy = 1,
): [number, number] {
  if (wR <= 0 || hR <= 0 || sweep === 0) return [x, y];
  const [ox, oy] = onEllipse(wR, hR, start);
  const cx = x - ox;
  const cy = y - oy;
  // An SVG arc covers less than a turn: a long sweep is drawn in pieces of at most half a turn.
  const pieces = Math.ceil(Math.abs(sweep) / 10_800_000);
  let angle = start;
  let px = x;
  let py = y;
  for (let i = 0; i < pieces; i++) {
    const step = sweep / pieces;
    angle += step;
    const [ex, ey] = onEllipse(wR, hR, angle);
    px = cx + ex;
    py = cy + ey;
    // An axis-aligned ellipse scaled is one with scaled radii.
    parts.push(`A${n(wR * sx)} ${n(hR * sy)} 0 0 ${step > 0 ? 1 : 0} ${n(px * sx)} ${n(py * sy)}`);
  }
  return [px, py];
}

/**
 * The text rectangle of `def` in a `w` by `h` box: left, top, right, bottom.
 * @internal
 */
export function textRect(
  def: GeometryDefinition,
  w: number,
  h: number,
  adjust?: Readonly<Record<string, number>> | null,
): [number, number, number, number] {
  if (!def.text) return [0, 0, w, h];
  const values = guides(def, w, h, adjust);
  const { l, t, r, b } = def.text;
  return [value(l, values), value(t, values), value(r, values), value(b, values)];
}

/**
 * The definition a shape's attributes name: its preset, its custom geometry, or a rectangle.
 * @internal
 */
export function definitionOf(attrs: Record<string, unknown>): GeometryDefinition | undefined {
  const geometry = String(attrs.geometry ?? "rect");
  if (geometry === "custom") return (attrs.custom as GeometryDefinition | null) ?? undefined;
  return Object.hasOwn(PRESETS, geometry) ? PRESETS[geometry] : undefined;
}

/**
 * Whether Foli draws preset `name` (ADR-0017: others are drawn as their bounding rectangle).
 * @internal
 */
export const drawsPreset = (name: string): boolean => Object.hasOwn(PRESETS, name);
