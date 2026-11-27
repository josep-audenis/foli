/**
 * A selected shape's adjustment handles (34.4, ADR-0017): where its geometry's handles (`a:ahXY`)
 * are drawn, and the adjust values a handle dragged to a point gives, from the same guides the
 * shape is drawn with.
 */

import { definitionOf, type GeometryHandle, guides } from "./geometry.js";

type Attrs = Record<string, unknown>;
const EMU_PER_PX = 9525;

const size = (attrs: Attrs): [number, number] => [
  Number(attrs.width) / EMU_PER_PX,
  Number(attrs.height) / EMU_PER_PX,
];

/** A handle's point (px from the shape's unturned top left), flipped as the shape is. */
function pointOf(
  handle: GeometryHandle,
  values: ReadonlyMap<string, number>,
  attrs: Attrs,
): [number, number] {
  const [w, h] = size(attrs);
  const at = (token: string) => values.get(token) ?? (Number(token) || 0);
  const x = at(handle.pos[0]);
  const y = at(handle.pos[1]);
  return [attrs.flipH === true ? w - x : x, attrs.flipV === true ? h - y : y];
}

/**
 * Where shape `attrs`' adjustment handles are, in px from its unturned top left; none for a
 * custom geometry or a preset Foli draws as its box.
 * @internal
 */
export function adjustHandles(attrs: Attrs): [number, number][] {
  const def = attrs.geometry === "custom" ? undefined : definitionOf(attrs);
  if (!def?.handles?.length) return [];
  const [w, h] = size(attrs);
  const values = guides(def, w, h, attrs.adjust as Record<string, number> | null);
  return def.handles.map((handle) => pointOf(handle, values, attrs));
}

/**
 * The adjust values handle `index` of shape `attrs` gives at point (`x`, `y`) (px from its
 * unturned top left): each axis's guide set, within its bounds, to the value that puts the
 * handle nearest the point (searched, as the formulas need not be inverted).
 * @internal
 */
export function adjustAt(
  attrs: Attrs,
  index: number,
  x: number,
  y: number,
): Record<string, number> {
  const def = attrs.geometry === "custom" ? undefined : definitionOf(attrs);
  const handle = def?.handles?.[index];
  if (!def || !handle) return {};
  const [w, h] = size(attrs);
  const current = { ...((attrs.adjust ?? {}) as Record<string, number>) };
  const out: Record<string, number> = {};
  for (const [axis, spec] of [
    [0, handle.x],
    [1, handle.y],
  ] as const) {
    if (!spec) continue;
    const [ref, minToken, maxToken] = spec;
    const values = guides(def, w, h, current);
    const bound = (token: string) => values.get(token) ?? (Number(token) || 0);
    let lo = Math.min(bound(minToken), bound(maxToken));
    let hi = Math.max(bound(minToken), bound(maxToken));
    // A callout's tail may go anywhere: searched within a few shapes' size around it.
    lo = Math.max(lo, -500_000);
    hi = Math.min(hi, 500_000);
    const target = axis === 0 ? x : y;
    const distance = (v: number) => {
      const point = pointOf(handle, guides(def, w, h, { ...current, [ref]: v }), attrs);
      return Math.abs(point[axis] - target);
    };
    // Coarse steps, then finer ones around the best.
    let best = lo;
    let nearest = distance(lo);
    let step = (hi - lo) / 64;
    for (let round = 0; round < 4 && step > 0; round++) {
      const from = Math.max(lo, best - step * 64);
      const to = Math.min(hi, best + step * 64);
      for (let v = from; v <= to; v += step) {
        const d = distance(v);
        if (d < nearest) [best, nearest] = [v, d];
      }
      step /= 16;
    }
    out[ref] = Math.round(best);
    current[ref] = out[ref] as number;
  }
  return out;
}
