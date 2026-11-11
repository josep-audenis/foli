/** What an import could not turn into editable content: the coverage report. */
export interface ImportReport {
  /** Opaque nodes (kept verbatim, not editable yet) by element name: `{ "w:tbl": 1 }`. */
  readonly opaque: Readonly<Record<string, number>>;
  /**
   * Things not imported because Word recomputes them: spelling and grammar marks
   * (`w:proofErr`), Word's last page breaks (`w:lastRenderedPageBreak`), and run attributes
   * (`w:r@w:rsidR`: editing session ids).
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
  readonly opaqueCounts: Record<string, number> = {};
  readonly droppedCounts: Record<string, number> = {};
  readonly unmodeledList: string[] = [];
  unmodeledCount = 0;
  /** The part being read, for messages. */
  part = "";

  opaque(name: string): void {
    this.opaqueCounts[name] = (this.opaqueCounts[name] ?? 0) + 1;
  }

  dropped(name: string): void {
    this.droppedCounts[name] = (this.droppedCounts[name] ?? 0) + 1;
  }

  unmodeled(element: string, reason: string): void {
    this.unmodeledCount++;
    if (this.unmodeledList.length < 100)
      this.unmodeledList.push(`${this.part}: ${element}: ${reason}`);
  }

  report(): ImportReport {
    return {
      opaque: sorted(this.opaqueCounts),
      dropped: sorted(this.droppedCounts),
      unmodeled: this.unmodeledList,
      unmodeledCount: this.unmodeledCount,
    };
  }
}

function sorted(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}
