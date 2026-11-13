/** What an import could not turn into editable content: the coverage report. */
export interface ImportReport {
  /** Opaque nodes (kept verbatim, not editable yet) by element name: `{ "w:tbl": 1 }`. */
  readonly opaque: Readonly<Record<string, number>>;
  /**
   * Things not imported because Word recomputes them or they show nothing: spelling and grammar
   * marks (`w:proofErr`), Word's last page breaks (`w:lastRenderedPageBreak`), editing session
   * ids on runs (`w:r@w:rsidR`…), and runs with properties but no content (`w:r (empty)`).
   */
  readonly dropped: Readonly<Record<string, number>>;
  /**
   * Values the model could not hold (out of range, a unit it does not read), as
   * `part: element: reason`. Each stays in its element's verbatim `ext`, so export keeps it;
   * it is only not editable. At most 100 are listed; `unmodeledCount` counts all.
   */
  readonly unmodeled: readonly string[];
  readonly unmodeledCount: number;
}

export class Recorder {
  // Maps, not objects: element names such as `constructor` are only names.
  readonly #opaque = new Map<string, number>();
  readonly #dropped = new Map<string, number>();
  readonly #unmodeled: string[] = [];
  #unmodeledCount = 0;
  /** The part being read, for messages. */
  part = "";

  opaque(name: string): void {
    this.#opaque.set(name, (this.#opaque.get(name) ?? 0) + 1);
  }

  dropped(name: string): void {
    this.#dropped.set(name, (this.#dropped.get(name) ?? 0) + 1);
  }

  unmodeled(element: string, reason: string): void {
    this.#unmodeledCount++;
    if (this.#unmodeled.length < 100) this.#unmodeled.push(`${this.part}: ${element}: ${reason}`);
  }

  report(): ImportReport {
    return {
      opaque: sorted(this.#opaque),
      dropped: sorted(this.#dropped),
      unmodeled: [...this.#unmodeled],
      unmodeledCount: this.#unmodeledCount,
    };
  }
}

/** Counts as a plain object sorted by name, each name an own property. */
function sorted(counts: ReadonlyMap<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, n] of [...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    Object.defineProperty(out, name, {
      value: n,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}
