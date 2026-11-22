export interface MapResult {
  /** The mapped position. */
  pos: number;
  /** True when the position was strictly inside replaced content. */
  deleted: boolean;
  /** @internal Lets a mirrored map restore a position inside replaced content. */
  recover: number | null;
}

/** Anything positions can be mapped through. `assoc` < 0 sticks left at insertions, > 0 right. */
export interface Mappable {
  map(pos: number, assoc?: number): number;
  mapResult(pos: number, assoc?: number): MapResult;
}

// A `recover` value packs which range of a map a position fell in and how far into it.
const RANGE_UNIT = 2 ** 32;
const packRecover = (range: number, offset: number) => range * RANGE_UNIT + offset;

/**
 * How one step moved positions: a sorted flat list of `[start, oldSize, newSize]` triples in the
 * pre-step coordinates. Everything outside the ranges shifts by the accumulated size difference.
 */
export class StepMap implements Mappable {
  static readonly empty = new StepMap([]);

  constructor(
    readonly ranges: readonly number[],
    readonly inverted = false,
  ) {}

  /**
   * Maps `pos`. `sides` (from `sides()` of a map with the same ranges) overrides `assoc` per
   * range at pure insertions, where the side decides which side of the new content `pos` ends up.
   */
  mapResult(pos: number, assoc = 1, sides?: readonly number[]): MapResult {
    const { ranges, inverted } = this;
    // How far output positions are ahead of input positions after the ranges seen so far.
    let shift = 0;
    for (let i = 0; i < ranges.length; i += 3) {
      const inSize = ranges[i + (inverted ? 2 : 1)] as number;
      const outSize = ranges[i + (inverted ? 1 : 2)] as number;
      // `ranges` use the coordinates before the step: an inverted map's output coordinates.
      const inStart = (ranges[i] as number) - (inverted ? shift : 0);
      if (pos < inStart) break;
      const inEnd = inStart + inSize;
      if (pos > inEnd) {
        shift += outSize - inSize;
        continue;
      }
      // `pos` touches this range: it goes before or after the range's new content.
      let after: boolean;
      if (inSize === 0) after = (sides?.[i / 3] || assoc) >= 0;
      else if (pos === inStart) after = false;
      else if (pos === inEnd) after = true;
      else after = assoc >= 0;
      // The edge `pos` sticks to maps exactly; anywhere else a mirror can restore it.
      const exact = pos === (assoc < 0 ? inStart : inEnd);
      return {
        pos: inStart + shift + (after ? outSize : 0),
        deleted: pos > inStart && pos < inEnd,
        recover: exact ? null : packRecover(i / 3, pos - inStart),
      };
    }
    return { pos: pos + shift, deleted: false, recover: null };
  }

  map(pos: number, assoc = 1): number {
    return this.mapResult(pos, assoc).pos;
  }

  /** Position in this map's output for a `recover` value produced by its mirror. */
  recover(value: number): number {
    const range = Math.floor(value / RANGE_UNIT);
    let start = 0;
    eachRange(this, (index, _inStart, _inEnd, outStart) => {
      if (index === range) start = outStart;
      return index === range;
    });
    return start + (value - range * RANGE_UNIT);
  }

  /** Calls `f` with each changed range in old and new coordinates. */
  forEach(f: (oldStart: number, oldEnd: number, newStart: number, newEnd: number) => void): void {
    eachRange(this, (_index, inStart, inEnd, outStart, outEnd) => {
      f(inStart, inEnd, outStart, outEnd);
    });
  }

  /**
   * Which side of each changed range `pos` (in input coordinates) lies on: -1 at or before the
   * range, 1 at or after it, 0 strictly inside. One entry per range, in order.
   */
  sides(pos: number): (-1 | 0 | 1)[] {
    const sides: (-1 | 0 | 1)[] = [];
    this.forEach((start, end) => {
      sides.push(pos <= start ? -1 : pos >= end ? 1 : 0);
    });
    return sides;
  }

  invert(): StepMap {
    return new StepMap(this.ranges, !this.inverted);
  }
}

/** Visits `map`'s ranges in order with their bounds in input and output coordinates; `true` stops. */
function eachRange(
  map: StepMap,
  f: (index: number, inStart: number, inEnd: number, outStart: number, outEnd: number) => unknown,
): void {
  const { ranges, inverted } = map;
  let shift = 0;
  for (let i = 0; i < ranges.length; i += 3) {
    const inSize = ranges[i + (inverted ? 2 : 1)] as number;
    const outSize = ranges[i + (inverted ? 1 : 2)] as number;
    const inStart = (ranges[i] as number) - (inverted ? shift : 0);
    const outStart = inStart + shift;
    if (f(i / 3, inStart, inStart + inSize, outStart, outStart + outSize) === true) return;
    shift += outSize - inSize;
  }
}

/**
 * A sequence of step maps. A pair of maps can be marked as mirrors (one undoes the other, e.g.
 * an inverted step and its rebased copy): a position deleted by the first is recovered at the
 * second instead of collapsing, which keeps positions inside rebased content exact.
 */
export class Mapping implements Mappable {
  constructor(
    /** Shared with slices; append through `appendMap`, never mutate directly. */
    readonly maps: StepMap[] = [],
    /** Mirror pairs, stored in both directions for O(1) lookup. */
    private readonly mirror = new Map<number, number>(),
    private readonly from = 0,
    private to = maps.length,
  ) {}

  /** A view of maps `from..to` (shares storage; do not append to a slice). */
  slice(from = 0, to = this.maps.length): Mapping {
    return new Mapping(this.maps, this.mirror, from, to);
  }

  appendMap(map: StepMap, mirrors?: number): void {
    const index = this.maps.length;
    this.maps.push(map);
    this.to = index + 1;
    if (mirrors === undefined) return;
    this.mirror.set(index, mirrors);
    this.mirror.set(mirrors, index);
  }

  appendMapping(mapping: Mapping): void {
    const shift = this.maps.length - mapping.from;
    for (let i = mapping.from; i < mapping.to; i++) {
      // Keep a pair only when both maps are in `mapping`'s view: the earlier one is copied by now.
      const partner = mapping.getMirror(i);
      const keep = partner !== undefined && partner >= mapping.from && partner < i;
      this.appendMap(mapping.maps[i] as StepMap, keep ? partner + shift : undefined);
    }
  }

  getMirror(n: number): number | undefined {
    return this.mirror.get(n);
  }

  map(pos: number, assoc = 1): number {
    return this.mapResult(pos, assoc).pos;
  }

  mapResult(pos: number, assoc = 1): MapResult {
    let deleted = false;
    let current = pos;
    for (let i = this.from; i < this.to; i++) {
      const result = (this.maps[i] as StepMap).mapResult(current, assoc);
      const partner = result.recover === null ? undefined : this.mirror.get(i);
      if (partner !== undefined && partner > i && partner < this.to) {
        // The mirror re-creates what this map removed: continue from the restored position.
        current = (this.maps[partner] as StepMap).recover(result.recover as number);
        i = partner;
        continue;
      }
      deleted ||= result.deleted;
      current = result.pos;
    }
    return { pos: current, deleted, recover: null };
  }
}
