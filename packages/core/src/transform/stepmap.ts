// The design follows prosemirror-transform's StepMap/Mapping (MIT, see THIRD_PARTY_NOTICES.md);
// this is an independent implementation.

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

const FACTOR = 0x10000;
const makeRecover = (index: number, offset: number) => index + offset * FACTOR;
const recoverIndex = (value: number) => value % FACTOR;
const recoverOffset = (value: number) => (value - recoverIndex(value)) / FACTOR;

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
    let diff = 0;
    const oldIndex = this.inverted ? 2 : 1;
    const newIndex = this.inverted ? 1 : 2;
    for (let i = 0; i < this.ranges.length; i += 3) {
      const start = (this.ranges[i] as number) - (this.inverted ? diff : 0);
      if (start > pos) break;
      const oldSize = this.ranges[i + oldIndex] as number;
      const newSize = this.ranges[i + newIndex] as number;
      const end = start + oldSize;
      if (pos <= end) {
        const side = !oldSize
          ? sides?.[i / 3] || assoc
          : pos === start
            ? -1
            : pos === end
              ? 1
              : assoc;
        // Recoverable unless the position sits on the range edge it associates with; a start edge
        // with right association must be recoverable, or it drifts past re-inserted content.
        const recoverable = pos !== (assoc < 0 ? start : end);
        return {
          pos: start + diff + (side < 0 ? 0 : newSize),
          deleted: pos > start && pos < end,
          recover: recoverable ? makeRecover(i / 3, pos - start) : null,
        };
      }
      diff += newSize - oldSize;
    }
    return { pos: pos + diff, deleted: false, recover: null };
  }

  map(pos: number, assoc = 1): number {
    return this.mapResult(pos, assoc).pos;
  }

  /** Position in this map's output for a `recover` value produced by its mirror. */
  recover(value: number): number {
    let diff = 0;
    const index = recoverIndex(value);
    if (!this.inverted) {
      for (let i = 0; i < index; i++) {
        diff += (this.ranges[i * 3 + 2] as number) - (this.ranges[i * 3 + 1] as number);
      }
    }
    return (this.ranges[index * 3] as number) + diff + recoverOffset(value);
  }

  /** Calls `f` with each changed range in old and new coordinates. */
  forEach(f: (oldStart: number, oldEnd: number, newStart: number, newEnd: number) => void): void {
    const oldIndex = this.inverted ? 2 : 1;
    const newIndex = this.inverted ? 1 : 2;
    for (let i = 0, diff = 0; i < this.ranges.length; i += 3) {
      const start = this.ranges[i] as number;
      const oldStart = start - (this.inverted ? diff : 0);
      const newStart = start + (this.inverted ? 0 : diff);
      const oldSize = this.ranges[i + oldIndex] as number;
      const newSize = this.ranges[i + newIndex] as number;
      f(oldStart, oldStart + oldSize, newStart, newStart + newSize);
      diff += newSize - oldSize;
    }
  }

  /**
   * Which side of each changed range `pos` (in input coordinates) lies on: -1 at or before the
   * range, 1 at or after it, 0 strictly inside. One entry per range, in order.
   */
  sides(pos: number): (-1 | 0 | 1)[] {
    const sides: (-1 | 0 | 1)[] = [];
    this.forEach((oldStart, oldEnd) => {
      sides.push(pos <= oldStart ? -1 : pos >= oldEnd ? 1 : 0);
    });
    return sides;
  }

  invert(): StepMap {
    return new StepMap(this.ranges, !this.inverted);
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
    this.to = this.maps.push(map);
    if (mirrors !== undefined) {
      this.mirror.set(this.maps.length - 1, mirrors);
      this.mirror.set(mirrors, this.maps.length - 1);
    }
  }

  appendMapping(mapping: Mapping): void {
    const startSize = this.maps.length;
    for (let i = mapping.from; i < mapping.to; i++) {
      const mirror = mapping.getMirror(i);
      this.appendMap(
        mapping.maps[i] as StepMap,
        mirror !== undefined && mirror < i && mirror >= mapping.from
          ? startSize + mirror - mapping.from
          : undefined,
      );
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
    for (let i = this.from; i < this.to; i++) {
      const map = this.maps[i] as StepMap;
      const result = map.mapResult(pos, assoc);
      if (result.recover !== null) {
        const corr = this.getMirror(i);
        if (corr !== undefined && corr > i && corr < this.to) {
          i = corr;
          pos = (this.maps[corr] as StepMap).recover(result.recover);
          continue;
        }
      }
      deleted ||= result.deleted;
      pos = result.pos;
    }
    return { pos, deleted, recover: null };
  }
}
