/**
 * The preset geometries Foli draws (Phase 34, ADR-0017): Word's Shapes gallery's Lines,
 * Rectangles, Basic Shapes, Block Arrows, Stars and Callouts (and the flowchart shapes that are
 * the same), as ECMA-376's `presetShapeDefinitions.xml` defines them, written compactly:
 *
 * - `av`: adjust values and their defaults, `name value;…`;
 * - `gd`: guides in order, `name formula;…` (`x1 *\/ ss a 100000`);
 * - `path`: paths separated by `|`, each optionally starting with `[w h fill stroke]` flags
 *   (`[fill=none]`, `[stroke=0]`, `[w=21600 h=21600]`, `[fill=darkenLess stroke=0]`), then
 *   commands `M x y`, `L x y`, `C x1 y1 x2 y2 x y`, `Q x1 y1 x y`, `A wR hR stAng swAng`, `Z`;
 * - `ah`: adjustment handles separated by `|`: `x ref min max @ px py`, `y ref min max @ px py`,
 *   `xy refX minX maxX refY minY maxY @ px py`;
 * - `text`: the text rectangle `l t r b`.
 *
 * Any other preset is drawn as its bounding rectangle (`geometry.ts`).
 */

import type {
  GeometryCommand,
  GeometryDefinition,
  GeometryHandle,
  GeometryPath,
} from "./geometry.js";

interface Compact {
  av?: string;
  gd?: string;
  path: string;
  ah?: string;
  text?: string;
}

const ARITY: Record<string, number> = { M: 2, L: 2, C: 6, Q: 4, A: 4, Z: 0 };

function parsePath(source: string): GeometryPath {
  let rest = source.trim();
  const flags: Record<string, string> = {};
  const head = /^\[([^\]]*)\]/.exec(rest);
  if (head) {
    for (const flag of (head[1] ?? "").split(/\s+/).filter(Boolean)) {
      const [key, value] = flag.split("=");
      if (key) flags[key] = value ?? "";
    }
    rest = rest.slice(head[0].length);
  }
  const tokens = rest.split(/\s+/).filter(Boolean);
  const commands: GeometryCommand[] = [];
  for (let i = 0; i < tokens.length; ) {
    const op = tokens[i++] as GeometryCommand["op"];
    const count = ARITY[op] ?? 0;
    commands.push(count ? { op, args: tokens.slice(i, i + count) } : { op });
    i += count;
  }
  return {
    ...(flags.w ? { width: Number(flags.w), height: Number(flags.h) } : {}),
    ...(flags.fill ? { fill: flags.fill as NonNullable<GeometryPath["fill"]> } : {}),
    ...(flags.stroke === "0" ? { stroke: false } : {}),
    commands,
  };
}

function parseHandle(source: string): GeometryHandle {
  const [axes = "", at = ""] = source.split("@");
  const [kind, ...refs] = axes.trim().split(/\s+/);
  const [px = "l", py = "t"] = at.trim().split(/\s+/);
  const triple = (i: number) => [refs[i] ?? "", refs[i + 1] ?? "0", refs[i + 2] ?? "0"] as const;
  if (kind === "x") return { x: triple(0), pos: [px, py] };
  if (kind === "y") return { y: triple(0), pos: [px, py] };
  return { x: triple(0), y: triple(3), pos: [px, py] };
}

function definition(compact: Compact): GeometryDefinition {
  const list = (s: string | undefined) =>
    (s ?? "")
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean);
  const adjust = Object.fromEntries(
    list(compact.av).map((entry) => {
      const [name, value] = entry.split(/\s+/);
      return [name ?? "", Number(value)];
    }),
  );
  const [l = "l", t = "t", r = "r", b = "b"] = (compact.text ?? "l t r b").split(/\s+/);
  return {
    adjust,
    guides: list(compact.gd).map((entry) => {
      const at = entry.indexOf(" ");
      return { name: entry.slice(0, at), formula: entry.slice(at + 1).trim() };
    }),
    paths: compact.path.split("|").map(parsePath),
    handles: (compact.ah ?? "")
      .split("|")
      .filter((h) => h.trim())
      .map(parseHandle),
    text: { l, t, r, b },
  };
}

const ELLIPSE = "M l vc A wd2 hd2 cd2 cd4 A wd2 hd2 3cd4 cd4 A wd2 hd2 0 cd4 A wd2 hd2 cd4 cd4 Z";
const ELLIPSE_GD =
  "idx cos wd2 2700000; idy sin hd2 2700000; il +- hc 0 idx; ir +- hc idx 0; it +- vc 0 idy; ib +- vc idy 0";

/** A callout's tail guides (`wedgeRectCallout` and `wedgeRoundRectCallout`). */
const TAIL =
  "dxPos */ w adj1 100000; dyPos */ h adj2 100000; xPos +- hc dxPos 0; yPos +- vc dyPos 0;" +
  "dx */ dxPos h 1; dy */ dyPos w 1; adx abs dx; ady abs dy; dq +- adx 0 ady;" +
  "xg1 ?: dxPos 7 2; xg2 ?: dxPos 10 5; x1 */ w xg1 12; x2 */ w xg2 12;" +
  "yg1 ?: dyPos 7 2; yg2 ?: dyPos 10 5; y1 */ h yg1 12; y2 */ h yg2 12;" +
  "t1 ?: dxPos l xPos; xl ?: dq t1 l; t2 ?: dyPos x1 xPos; xt ?: dq x1 t2;" +
  "t3 ?: dxPos xPos r; xr ?: dq t3 r; t4 ?: dyPos xPos x1; xb ?: dq x1 t4;" +
  "t5 ?: dxPos y1 yPos; yl ?: dq t5 y1; t6 ?: dyPos t yPos; yt ?: dq t t6;" +
  "t7 ?: dxPos yPos y1; yr ?: dq t7 y1; t8 ?: dyPos yPos b; yb ?: dq b t8";
const TAIL_AH = "xy adj1 -2147483647 2147483647 adj2 -2147483647 2147483647 @ xPos yPos";

/** A rectangle with one rounded or cut corner pair (the Rectangles row). */
const COMPACT: Record<string, Compact> = {
  rect: { path: "M l t L r t L r b L l b Z" },
  roundRect: {
    av: "adj 16667",
    gd: "a pin 0 adj 50000; x1 */ ss a 100000; x2 +- r 0 x1; y2 +- b 0 x1; il */ x1 29289 100000; ir +- r 0 il; ib +- b 0 il",
    path: "M l x1 A x1 x1 cd2 cd4 L x2 t A x1 x1 3cd4 cd4 L r y2 A x1 x1 0 cd4 L x1 b A x1 x1 cd4 cd4 Z",
    ah: "x adj 0 50000 @ x1 t",
    text: "il il ir ib",
  },
  snip1Rect: {
    av: "adj 16667",
    gd: "a pin 0 adj 50000; dx1 */ ss a 100000; x1 +- r 0 dx1; it */ dx1 1 2; ir +/ x1 r 2",
    path: "M l t L x1 t L r dx1 L r b L l b Z",
    ah: "x adj 0 50000 @ x1 t",
    text: "l it ir b",
  },
  snip2SameRect: {
    av: "adj1 16667; adj2 0",
    gd: "a1 pin 0 adj1 50000; a2 pin 0 adj2 50000; tx1 */ ss a1 100000; tx2 +- r 0 tx1; bx1 */ ss a2 100000; bx2 +- r 0 bx1; by1 +- b 0 bx1; d +- tx1 0 bx1; dx ?: d tx1 bx1; il */ dx 1 2; ir +- r 0 il; it */ tx1 1 2; ib +/ by1 b 2",
    path: "M tx1 t L tx2 t L r tx1 L r by1 L bx2 b L bx1 b L l by1 L l tx1 Z",
    ah: "x adj1 0 50000 @ tx2 t|x adj2 0 50000 @ bx1 b",
    text: "il it ir ib",
  },
  round1Rect: {
    av: "adj 16667",
    gd: "a pin 0 adj 50000; dx1 */ ss a 100000; x1 +- r 0 dx1; idx */ dx1 29289 100000; ir +- r 0 idx",
    path: "M l t L x1 t A dx1 dx1 3cd4 cd4 L r b L l b Z",
    ah: "x adj 0 50000 @ x1 t",
    text: "l t ir b",
  },
  round2SameRect: {
    av: "adj1 16667; adj2 0",
    gd: "a1 pin 0 adj1 50000; a2 pin 0 adj2 50000; tx1 */ ss a1 100000; tx2 +- r 0 tx1; bx1 */ ss a2 100000; bx2 +- r 0 bx1; by1 +- b 0 bx1; d +- tx1 0 bx1; dx ?: d tx1 bx1; idx */ dx 29289 100000; ir +- r 0 idx; tdx */ tx1 29289 100000; bdx */ bx1 29289 100000; td +- tdx 0 bdx; ib +- b 0 bdx",
    path: "M tx1 t L tx2 t A tx1 tx1 3cd4 cd4 L r by1 A bx1 bx1 0 cd4 L bx1 b A bx1 bx1 cd4 cd4 L l tx1 A tx1 tx1 cd2 cd4 Z",
    ah: "x adj1 0 50000 @ tx2 t|x adj2 0 50000 @ bx1 b",
    text: "idx tdx ir ib",
  },
  ellipse: { gd: ELLIPSE_GD, path: ELLIPSE, text: "il it ir ib" },
  triangle: {
    av: "adj 50000",
    gd: "a pin 0 adj 100000; x1 */ w a 200000; x2 */ w a 100000; x3 +- x1 wd2 0",
    path: "M l b L x2 t L r b Z",
    ah: "x adj 0 100000 @ x2 t",
    text: "x1 vc x3 b",
  },
  rtTriangle: {
    gd: "it */ h 7 12; ir */ w 7 12; ib */ h 11 12",
    path: "M l b L l t L r b Z",
    text: "l it ir ib",
  },
  parallelogram: {
    av: "adj 25000",
    gd: "maxAdj */ 100000 w ss; a pin 0 adj maxAdj; x1 */ ss a 200000; x2 */ ss a 100000; x6 +- r 0 x2; x5 +- r 0 x1; il */ wd3 a maxAdj; ir +- r 0 il; it */ hd3 a maxAdj; ib +- b 0 it",
    path: "M l b L x2 t L r t L x6 b Z",
    ah: "x adj 0 maxAdj @ x2 t",
    text: "il it ir ib",
  },
  trapezoid: {
    av: "adj 25000",
    gd: "maxAdj */ 50000 w ss; a pin 0 adj maxAdj; x1 */ ss a 200000; x2 */ ss a 100000; x3 +- r 0 x2; x4 +- r 0 x1; il */ wd3 a maxAdj; it */ hd3 a maxAdj; ir +- r 0 il",
    path: "M l b L x2 t L x3 t L r b Z",
    ah: "x adj 0 maxAdj @ x2 t",
    text: "il it ir b",
  },
  diamond: {
    gd: "ir */ w 3 4; ib */ h 3 4",
    path: "M l vc L hc t L r vc L hc b Z",
    text: "wd4 hd4 ir ib",
  },
  pentagon: {
    av: "hf 105146; vf 110557",
    gd: "swd2 */ wd2 hf 100000; shd2 */ hd2 vf 100000; svc */ vc vf 100000; dx1 cos swd2 1080000; dx2 cos swd2 18360000; dy1 sin shd2 1080000; dy2 sin shd2 18360000; x1 +- hc 0 dx1; x2 +- hc 0 dx2; x3 +- hc dx2 0; x4 +- hc dx1 0; y1 +- svc 0 dy1; y2 +- svc 0 dy2; it */ y1 dx2 dx1",
    path: "M x1 y1 L hc t L x4 y1 L x3 y2 L x2 y2 Z",
    text: "x2 it x3 y2",
  },
  hexagon: {
    av: "adj 25000; vf 115470",
    gd: "maxAdj */ 50000 w ss; a pin 0 adj maxAdj; shd2 */ hd2 vf 100000; x1 */ ss a 100000; x2 +- r 0 x1; dy1 sin shd2 3600000; y1 +- vc 0 dy1; y2 +- vc dy1 0; q1 */ maxAdj -1 2; q2 +- a q1 0; q3 ?: q2 4 2; q4 ?: q2 3 2; q5 ?: q2 q1 0; q6 +/ a q5 q1; q7 */ q6 q4 -1; q8 +- q3 q7 0; il */ w q8 24; it */ h q8 24; ir +- r 0 il; ib +- b 0 it",
    path: "M l vc L x1 y1 L x2 y1 L r vc L x2 y2 L x1 y2 Z",
    ah: "x adj 0 maxAdj @ x1 t",
    text: "il it ir ib",
  },
  octagon: {
    av: "adj 29289",
    gd: "a pin 0 adj 50000; x1 */ ss a 100000; x2 +- r 0 x1; y2 +- b 0 x1; il */ x1 1 2; ir +- r 0 il; ib +- b 0 il",
    path: "M l x1 L x1 t L x2 t L r x1 L r y2 L x2 b L x1 b L l y2 Z",
    ah: "x adj 0 50000 @ x1 t",
    text: "il il ir ib",
  },
  plus: {
    av: "adj 25000",
    gd: "a pin 0 adj 50000; x1 */ ss a 100000; x2 +- r 0 x1; y2 +- b 0 x1; d +- w 0 h; il ?: d l x1; ir ?: d r x2; it ?: d x1 t; ib ?: d y2 b",
    path: "M l x1 L x1 x1 L x1 t L x2 t L x2 x1 L r x1 L r y2 L x2 y2 L x2 b L x1 b L x1 y2 L l y2 Z",
    ah: "x adj 0 50000 @ x1 t",
    text: "il it ir ib",
  },
  can: {
    av: "adj 25000",
    gd: "maxAdj */ 50000 h ss; a pin 0 adj maxAdj; y1 */ ss a 200000; y2 +- y1 y1 0; y3 +- b 0 y1",
    path:
      "[stroke=0] M l y1 A wd2 y1 cd2 -10800000 L r y3 A wd2 y1 0 cd2 Z|" +
      "[fill=lighten stroke=0] M l y1 A wd2 y1 cd2 cd2 A wd2 y1 0 cd2 Z|" +
      "[fill=none] M r y1 A wd2 y1 0 cd2 A wd2 y1 cd2 cd2 L r y3 A wd2 y1 0 cd2 L l y1",
    ah: "y adj 0 maxAdj @ hc y2",
    text: "l y2 r y3",
  },
  cube: {
    av: "adj 25000",
    gd: "a pin 0 adj 100000; y1 */ ss a 100000; y4 +- b 0 y1; y2 */ y4 1 2; y3 +/ y1 b 2; x4 +- r 0 y1; x2 */ x4 1 2; x3 +/ y1 r 2",
    path:
      "[stroke=0] M l y1 L x4 y1 L x4 b L l b Z|" +
      "[fill=darkenLess stroke=0] M x4 y1 L r t L r y4 L x4 b Z|" +
      "[fill=lightenLess stroke=0] M l y1 L y1 t L r t L x4 y1 Z|" +
      "[fill=none] M l y1 L y1 t L r t L r y4 L x4 b L l b Z M l y1 L x4 y1 L r t M x4 y1 L x4 b",
    ah: "y adj 0 100000 @ l y1",
    text: "l y1 x4 b",
  },
  donut: {
    av: "adj 25000",
    gd: `a pin 0 adj 50000; dr */ ss a 100000; iwd2 +- wd2 0 dr; ihd2 +- hd2 0 dr; ${ELLIPSE_GD}`,
    path: `${ELLIPSE} M dr vc A iwd2 ihd2 cd2 -5400000 A iwd2 ihd2 cd4 -5400000 A iwd2 ihd2 0 -5400000 A iwd2 ihd2 3cd4 -5400000 Z`,
    ah: "x adj 0 50000 @ dr vc",
    text: "il it ir ib",
  },
  frame: {
    av: "adj1 12500",
    gd: "a1 pin 0 adj1 50000; x1 */ ss a1 100000; x4 +- r 0 x1; y4 +- b 0 x1",
    path: "M l t L r t L r b L l b Z M x1 x1 L x1 y4 L x4 y4 L x4 x1 Z",
    ah: "x adj1 0 50000 @ x1 t",
    text: "x1 x1 x4 y4",
  },
  plaque: {
    av: "adj 16667",
    gd: "a pin 0 adj 50000; x1 */ ss a 100000; x2 +- r 0 x1; y2 +- b 0 x1; il */ x1 70711 100000; ir +- r 0 il; ib +- b 0 il",
    path: "M l x1 A x1 x1 cd4 -5400000 L x2 t A x1 x1 cd2 -5400000 L r y2 A x1 x1 3cd4 -5400000 L x1 b A x1 x1 0 -5400000 Z",
    ah: "x adj 0 50000 @ x1 t",
    text: "il il ir ib",
  },
  foldedCorner: {
    av: "adj 16667",
    gd: "a pin 0 adj 50000; dy2 */ ss a 100000; dy1 */ dy2 1 5; x1 +- r 0 dy2; x2 +- x1 dy1 0; y2 +- b 0 dy2; y1 +- y2 dy1 0",
    path:
      "[stroke=0] M l t L r t L r y2 L x1 b L l b Z|" +
      "[fill=darkenLess stroke=0] M x1 b L x2 y1 L r y2 Z|" +
      "[fill=none] M x1 b L x2 y1 L r y2 L x1 b L l b L l t L r t L r y2",
    ah: "x adj 0 50000 @ x1 b",
    text: "l t r y2",
  },
  heart: {
    gd: "dx1 */ w 49 48; dx2 */ w 10 48; x1 +- hc 0 dx1; x2 +- hc 0 dx2; x3 +- hc dx2 0; x4 +- hc dx1 0; y1 +- t 0 hd3; il */ w 1 6; ir */ w 5 6; ib */ h 2 3",
    path: "M hc hd4 C x3 y1 x4 hd4 hc b C x1 hd4 x2 y1 hc hd4 Z",
    text: "il hd4 ir ib",
  },
  lightningBolt: {
    gd: "x1 */ w 5022 21600; x3 */ w 8472 21600; x4 */ w 8757 21600; x5 */ w 10012 21600; x8 */ w 12860 21600; x9 */ w 13917 21600; x11 */ w 16577 21600; y1 */ h 3890 21600; y3 */ h 6080 21600; y4 */ h 6797 21600; y5 */ h 7437 21600; y6 */ h 9705 21600; y7 */ h 12007 21600; y10 */ h 14915 21600; y11 */ h 17080 21600",
    path: "[w=21600 h=21600] M 8472 0 L 12860 6080 L 11050 6797 L 16577 12007 L 14767 12877 L 21600 21600 L 10012 14915 L 12222 13987 L 5022 9705 L 7602 8382 L 0 3890 Z",
    text: "x4 y4 x9 y10",
  },
  smileyFace: {
    av: "adj 4653",
    gd: `a pin -4653 adj 4653; x1 */ w 4969 21699; x2 */ w 6215 21600; x3 */ w 13135 21600; x4 */ w 16640 21600; y1 */ h 7570 21600; y3 */ h 16515 21600; dy2 */ h a 100000; y2 +- y3 0 dy2; y4 +- y3 dy2 0; dy3 */ h a 50000; y5 +- y4 dy3 0; wR */ w 1125 21600; hR */ h 1125 21600; ${ELLIPSE_GD}`,
    path:
      "M l vc A wd2 hd2 cd2 21600000 Z|" +
      "[fill=darkenLess] M x2 y1 A wR hR cd2 21600000 M x3 y1 A wR hR cd2 21600000|" +
      "[fill=none] M x1 y2 Q hc y5 x4 y2|" +
      "[fill=none] M l vc A wd2 hd2 cd2 21600000 Z",
    ah: "y adj -4653 4653 @ hc y4",
    text: "il it ir ib",
  },
  rightArrow: {
    av: "adj1 50000; adj2 50000",
    gd: "maxAdj2 */ 100000 w ss; a1 pin 0 adj1 100000; a2 pin 0 adj2 maxAdj2; dx1 */ ss a2 100000; x1 +- r 0 dx1; dy1 */ h a1 200000; y1 +- vc 0 dy1; y2 +- vc dy1 0; dx2 */ y1 dx1 hd2; x2 +- x1 dx2 0",
    path: "M l y1 L x1 y1 L x1 t L r vc L x1 b L x1 y2 L l y2 Z",
    ah: "y adj1 0 100000 @ l y1|x adj2 0 maxAdj2 @ x1 t",
    text: "l y1 x2 y2",
  },
  leftArrow: {
    av: "adj1 50000; adj2 50000",
    gd: "maxAdj2 */ 100000 w ss; a1 pin 0 adj1 100000; a2 pin 0 adj2 maxAdj2; dx2 */ ss a2 100000; x2 +- l dx2 0; dy1 */ h a1 200000; y1 +- vc 0 dy1; y2 +- vc dy1 0; dx1 */ y1 dx2 hd2; x1 +- x2 0 dx1",
    path: "M l vc L x2 t L x2 y1 L r y1 L r y2 L x2 y2 L x2 b Z",
    ah: "y adj1 0 100000 @ r y1|x adj2 0 maxAdj2 @ x2 t",
    text: "x1 y1 r y2",
  },
  upArrow: {
    av: "adj1 50000; adj2 50000",
    gd: "maxAdj2 */ 100000 h ss; a1 pin 0 adj1 100000; a2 pin 0 adj2 maxAdj2; dy2 */ ss a2 100000; y2 +- t dy2 0; dx1 */ w a1 200000; x1 +- hc 0 dx1; x2 +- hc dx1 0; dy1 */ x1 dy2 wd2; y1 +- y2 0 dy1",
    path: "M l y2 L hc t L r y2 L x2 y2 L x2 b L x1 b L x1 y2 Z",
    ah: "x adj1 0 100000 @ x1 b|y adj2 0 maxAdj2 @ l y2",
    text: "x1 y1 x2 b",
  },
  downArrow: {
    av: "adj1 50000; adj2 50000",
    gd: "maxAdj2 */ 100000 h ss; a1 pin 0 adj1 100000; a2 pin 0 adj2 maxAdj2; dy1 */ ss a2 100000; y1 +- b 0 dy1; dx1 */ w a1 200000; x1 +- hc 0 dx1; x2 +- hc dx1 0; dy2 */ x1 dy1 wd2; y2 +- y1 dy2 0",
    path: "M l y1 L x1 y1 L x1 t L x2 t L x2 y1 L r y1 L hc b Z",
    ah: "x adj1 0 100000 @ x1 t|y adj2 0 maxAdj2 @ r y1",
    text: "x1 t x2 y2",
  },
  leftRightArrow: {
    av: "adj1 50000; adj2 50000",
    gd: "maxAdj2 */ 50000 w ss; a1 pin 0 adj1 100000; a2 pin 0 adj2 maxAdj2; x2 */ ss a2 100000; x3 +- r 0 x2; dy */ h a1 200000; y1 +- vc 0 dy; y2 +- vc dy 0; dx1 */ y1 x2 hd2; x1 +- x2 0 dx1; x4 +- x3 dx1 0",
    path: "M l vc L x2 t L x2 y1 L x3 y1 L x3 t L r vc L x3 b L x3 y2 L x2 y2 L x2 b Z",
    ah: "y adj1 0 100000 @ x3 y1|x adj2 0 maxAdj2 @ x2 t",
    text: "x1 y1 x4 y2",
  },
  upDownArrow: {
    av: "adj1 50000; adj2 50000",
    gd: "maxAdj2 */ 50000 h ss; a1 pin 0 adj1 100000; a2 pin 0 adj2 maxAdj2; y2 */ ss a2 100000; y3 +- b 0 y2; dx1 */ w a1 200000; x1 +- hc 0 dx1; x2 +- hc dx1 0; dy1 */ x1 y2 wd2; y1 +- y2 0 dy1; y4 +- y3 dy1 0",
    path: "M l y2 L hc t L r y2 L x2 y2 L x2 y3 L r y3 L hc b L l y3 L x1 y3 L x1 y2 Z",
    ah: "x adj1 0 100000 @ x1 y3|y adj2 0 maxAdj2 @ l y2",
    text: "x1 y1 x2 y4",
  },
  quadArrow: {
    av: "adj1 22500; adj2 22500; adj3 22500",
    gd: "a2 pin 0 adj2 50000; maxAdj1 */ a2 2 1; a1 pin 0 adj1 maxAdj1; q1 +- 100000 0 maxAdj1; maxAdj3 */ q1 1 2; a3 pin 0 adj3 maxAdj3; x1 */ ss a3 100000; dx2 */ ss a2 100000; x2 +- hc 0 dx2; x5 +- hc dx2 0; dx3 */ ss a1 200000; x3 +- hc 0 dx3; x4 +- hc dx3 0; x6 +- r 0 x1; y2 +- vc 0 dx2; y5 +- vc dx2 0; y3 +- vc 0 dx3; y4 +- vc dx3 0; y6 +- b 0 x1; il */ dx3 x1 dx2; ir +- r 0 il",
    path: "M l vc L x1 y2 L x1 y3 L x3 y3 L x3 x1 L x2 x1 L hc t L x5 x1 L x4 x1 L x4 y3 L x6 y3 L x6 y2 L r vc L x6 y5 L x6 y4 L x4 y4 L x4 y6 L x5 y6 L hc b L x2 y6 L x3 y6 L x3 y4 L x1 y4 L x1 y5 Z",
    ah: "x adj1 0 maxAdj1 @ x3 x1|x adj2 0 50000 @ x2 x1|y adj3 0 maxAdj3 @ r x1",
    text: "il y3 ir y4",
  },
  stripedRightArrow: {
    av: "adj1 50000; adj2 50000",
    gd: "maxAdj2 */ 84375 w ss; a1 pin 0 adj1 100000; a2 pin 0 adj2 maxAdj2; x4 */ ss 5 32; dx5 */ ss a2 100000; x5 +- r 0 dx5; dy1 */ h a1 200000; y1 +- vc 0 dy1; y2 +- vc dy1 0; dx6 */ dy1 dx5 hd2; x6 +- r 0 dx6",
    path: "M l y1 L ssd32 y1 L ssd32 y2 L l y2 Z M ssd16 y1 L ssd8 y1 L ssd8 y2 L ssd16 y2 Z M x4 y1 L x5 y1 L x5 t L r vc L x5 b L x5 y2 L x4 y2 Z",
    ah: "y adj1 0 100000 @ x5 y1|x adj2 0 maxAdj2 @ x5 t",
    text: "x4 y1 x6 y2",
  },
  notchedRightArrow: {
    av: "adj1 50000; adj2 50000",
    gd: "maxAdj2 */ 100000 w ss; a1 pin 0 adj1 100000; a2 pin 0 adj2 maxAdj2; dx2 */ ss a2 100000; x2 +- r 0 dx2; dy1 */ h a1 200000; y1 +- vc 0 dy1; y2 +- vc dy1 0; x1 */ dy1 dx2 hd2; x3 +- r 0 x1",
    path: "M l y1 L x2 y1 L x2 t L r vc L x2 b L x2 y2 L l y2 L x1 vc Z",
    ah: "y adj1 0 100000 @ r y1|x adj2 0 maxAdj2 @ x2 t",
    text: "x1 y1 x3 y2",
  },
  homePlate: {
    av: "adj 50000",
    gd: "maxAdj */ 100000 w ss; a pin 0 adj maxAdj; dx1 */ ss a 100000; x1 +- r 0 dx1; ir +/ x1 r 2",
    path: "M l t L x1 t L r vc L x1 b L l b Z",
    ah: "x adj 0 maxAdj @ x1 t",
    text: "l t ir b",
  },
  chevron: {
    av: "adj 50000",
    gd: "maxAdj */ 100000 w ss; a pin 0 adj maxAdj; x1 */ ss a 100000; x2 +- r 0 x1; dx +- x2 0 x1; il ?: dx x1 l; ir ?: dx x2 r",
    path: "M l t L x2 t L r vc L x2 b L l b L x1 vc Z",
    ah: "x adj 0 maxAdj @ x2 t",
    text: "il t ir b",
  },
  star4: {
    av: "adj 12500",
    gd: "a pin 0 adj 50000; iwd2 */ wd2 a 50000; ihd2 */ hd2 a 50000; sdx cos iwd2 2700000; sdy sin ihd2 2700000; sx1 +- hc 0 sdx; sx2 +- hc sdx 0; sy1 +- vc 0 sdy; sy2 +- vc sdy 0; yAdj +- vc 0 ihd2",
    path: "M l vc L sx1 sy1 L hc t L sx2 sy1 L r vc L sx2 sy2 L hc b L sx1 sy2 Z",
    ah: "y adj 0 50000 @ hc yAdj",
    text: "sx1 sy1 sx2 sy2",
  },
  star5: {
    av: "adj 19098; hf 105146; vf 110557",
    gd: "a pin 0 adj 50000; swd2 */ wd2 hf 100000; shd2 */ hd2 vf 100000; svc */ vc vf 100000; dx1 cos swd2 1080000; dx2 cos swd2 18360000; dy1 sin shd2 1080000; dy2 sin shd2 18360000; x1 +- hc 0 dx1; x2 +- hc 0 dx2; x3 +- hc dx2 0; x4 +- hc dx1 0; y1 +- svc 0 dy1; y2 +- svc 0 dy2; iwd2 */ swd2 a 50000; ihd2 */ shd2 a 50000; sdx1 cos iwd2 20520000; sdx2 cos iwd2 3240000; sdy1 sin ihd2 3240000; sdy2 sin ihd2 20520000; sx1 +- hc 0 sdx1; sx2 +- hc 0 sdx2; sx3 +- hc sdx2 0; sx4 +- hc sdx1 0; sy1 +- svc 0 sdy1; sy2 +- svc 0 sdy2; sy3 +- svc ihd2 0; yAdj +- svc 0 ihd2",
    path: "M x1 y1 L sx2 sy1 L hc t L sx3 sy1 L x4 y1 L sx4 sy2 L x3 y2 L hc sy3 L x2 y2 L sx1 sy2 Z",
    ah: "y adj 0 50000 @ hc yAdj",
    text: "sx1 sy1 sx4 sy3",
  },
  star6: {
    av: "adj 28868; hf 115470",
    gd: "a pin 0 adj 50000; swd2 */ wd2 hf 100000; dx1 cos swd2 1800000; x1 +- hc 0 dx1; x2 +- hc dx1 0; y2 +- vc hd4 0; iwd2 */ swd2 a 50000; ihd2 */ hd2 a 50000; sdx2 */ iwd2 1 2; sx1 +- hc 0 iwd2; sx2 +- hc 0 sdx2; sx3 +- hc sdx2 0; sx4 +- hc iwd2 0; sdy1 sin ihd2 3600000; sy1 +- vc 0 sdy1; sy2 +- vc sdy1 0; yAdj +- vc 0 ihd2",
    path: "M x1 hd4 L sx2 sy1 L hc t L sx3 sy1 L x2 hd4 L sx4 vc L x2 y2 L sx3 sy2 L hc b L sx2 sy2 L x1 y2 L sx1 vc Z",
    ah: "y adj 0 50000 @ hc yAdj",
    text: "sx1 sy1 sx4 sy2",
  },
  wedgeRectCallout: {
    av: "adj1 -20833; adj2 62500",
    gd: TAIL,
    path: "M l t L x1 t L xt yt L x2 t L r t L r y1 L xr yr L r y2 L r b L x2 b L xb yb L x1 b L l b L l y2 L xl yl L l y1 Z",
    ah: TAIL_AH,
  },
  wedgeRoundRectCallout: {
    av: "adj1 -20833; adj2 62500; adj3 16667",
    gd: `${TAIL}; u1 */ ss adj3 100000; u2 +- r 0 u1; v2 +- b 0 u1; il */ u1 29289 100000; ir +- r 0 il; ib +- b 0 il`,
    path: "M l u1 A u1 u1 cd2 cd4 L x1 t L xt yt L x2 t L u2 t A u1 u1 3cd4 cd4 L r y1 L xr yr L r y2 L r v2 A u1 u1 0 cd4 L x2 b L xb yb L x1 b L u1 b A u1 u1 cd4 cd4 L l y2 L xl yl L l y1 Z",
    ah: TAIL_AH,
    text: "il il ir ib",
  },
  wedgeEllipseCallout: {
    av: "adj1 -20833; adj2 62500",
    gd: `dxPos */ w adj1 100000; dyPos */ h adj2 100000; xPos +- hc dxPos 0; yPos +- vc dyPos 0; sdx */ dxPos h 1; sdy */ dyPos w 1; pang at2 sdx sdy; stAng +- pang 660000 0; enAng +- pang 0 660000; dx1 cos wd2 stAng; dy1 sin hd2 stAng; x1 +- hc dx1 0; y1 +- vc dy1 0; dx2 cos wd2 enAng; dy2 sin hd2 enAng; x2 +- hc dx2 0; y2 +- vc dy2 0; stAng1 at2 dx1 dy1; enAng1 at2 dx2 dy2; swAng1 +- enAng1 0 stAng1; swAng2 +- swAng1 21600000 0; swAng ?: swAng1 swAng1 swAng2; ${ELLIPSE_GD}`,
    path: "M xPos yPos L x1 y1 A wd2 hd2 stAng1 swAng Z",
    ah: TAIL_AH,
    text: "il it ir ib",
  },
  line: { path: "[fill=none] M l t L r b" },
  straightConnector1: { path: "[fill=none] M l t L r b" },
  bentConnector3: {
    av: "adj1 50000",
    gd: "x1 */ w adj1 100000",
    path: "[fill=none] M l t L x1 t L x1 b L r b",
    ah: "x adj1 -2147483647 2147483647 @ x1 vc",
  },
  curvedConnector3: {
    av: "adj1 50000",
    gd: "x2 */ w adj1 100000; x1 +/ l x2 2; x3 +/ r x2 2; y3 */ h 3 4",
    path: "[fill=none] M l t C x1 t x2 hd4 x2 vc C x2 y3 x3 b r b",
    ah: "x adj1 -2147483647 2147483647 @ x2 vc",
  },
  flowChartProcess: { path: "[w=1 h=1] M 0 0 L 1 0 L 1 1 L 0 1 Z" },
  flowChartDecision: {
    path: "[w=2 h=2] M 0 1 L 1 0 L 2 1 L 1 2 Z",
    gd: "ir */ w 3 4; ib */ h 3 4",
    text: "wd4 hd4 ir ib",
  },
  flowChartAlternateProcess: {
    gd: "x2 +- r 0 ssd6; y2 +- b 0 ssd6; il */ ssd6 29289 100000; ir +- r 0 il; ib +- b 0 il",
    path: "M l ssd6 A ssd6 ssd6 cd2 cd4 L x2 t A ssd6 ssd6 3cd4 cd4 L r y2 A ssd6 ssd6 0 cd4 L ssd6 b A ssd6 ssd6 cd4 cd4 Z",
    text: "il il ir ib",
  },
  flowChartTerminator: {
    gd: "il */ w 1018 21600; ir */ w 20582 21600; it */ h 3163 21600; ib */ h 18437 21600",
    path: "[w=21600 h=21600] M 3475 0 L 18125 0 A 3475 10800 3cd4 cd2 L 3475 21600 A 3475 10800 cd4 cd2 Z",
    text: "il it ir ib",
  },
  flowChartConnector: { gd: ELLIPSE_GD, path: ELLIPSE, text: "il it ir ib" },
};

/**
 * The preset geometries Foli draws, by DrawingML name.
 * @internal
 */
export const PRESETS: Readonly<Record<string, GeometryDefinition>> = Object.fromEntries(
  Object.entries(COMPACT).map(([name, compact]) => [name, definition(compact)]),
);
