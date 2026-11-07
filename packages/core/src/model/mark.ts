import { type Attrs, attrsToJSON, deepEqual } from "./attrs.js";
import type { MarkType } from "./schema.js";

export interface MarkJSON {
  type: string;
  attrs?: Record<string, unknown>;
}

/**
 * A mark on inline content (bold, a link…). Immutable. Mark sets are plain readonly arrays kept
 * in canonical order (the order of mark types in the schema), so equal sets are equal arrays.
 */
export class Mark {
  static readonly none: readonly Mark[] = Object.freeze([]);

  /** @internal Use MarkType.create or Schema.mark. */
  constructor(
    readonly type: MarkType,
    readonly attrs: Attrs,
  ) {}

  /**
   * Adds this mark to a set: replaces marks it excludes, does nothing if a mark in the set
   * excludes it or it is already there, and keeps canonical order. Returns `set` if unchanged.
   */
  addToSet(set: readonly Mark[]): readonly Mark[] {
    let copy: Mark[] | undefined;
    let placed = false;
    for (let i = 0; i < set.length; i++) {
      const other = set[i] as Mark;
      if (this.eq(other)) return set;
      if (this.type.excludes(other.type)) {
        copy ??= set.slice(0, i);
        continue;
      }
      if (other.type.excludes(this.type)) return set;
      if (!placed && other.type.rank > this.type.rank) {
        copy ??= set.slice(0, i);
        copy.push(this);
        placed = true;
      }
      copy?.push(other);
    }
    copy ??= set.slice();
    if (!placed) copy.push(this);
    return copy;
  }

  removeFromSet(set: readonly Mark[]): readonly Mark[] {
    return this.isInSet(set) ? set.filter((mark) => !mark.eq(this)) : set;
  }

  isInSet(set: readonly Mark[]): boolean {
    return set.some((mark) => mark.eq(this));
  }

  eq(other: Mark): boolean {
    return this === other || (this.type === other.type && deepEqual(this.attrs, other.attrs));
  }

  toJSON(): MarkJSON {
    const json: MarkJSON = { type: this.type.name };
    const attrs = attrsToJSON(this.type.spec.attrs, this.attrs);
    if (attrs) json.attrs = attrs;
    return json;
  }

  static sameSet(a: readonly Mark[], b: readonly Mark[]): boolean {
    if (a === b) return true;
    return a.length === b.length && a.every((mark, i) => mark.eq(b[i] as Mark));
  }

  /** A canonical set from loose input. Does not resolve exclusions; use addToSet for that. */
  static setFrom(marks?: Mark | readonly Mark[] | null): readonly Mark[] {
    if (!marks) return Mark.none;
    if (marks instanceof Mark) return [marks];
    if (marks.length < 2) return marks;
    return [...marks].sort((a, b) => a.type.rank - b.type.rank);
  }
}
