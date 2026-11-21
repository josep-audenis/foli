import type { Editor, Node } from "@folijs/core";

/**
 * @internal
 * Names for blocks that outlive edits: `b1`, `b2`… in the order they were first read.
 *
 * A handle is the position after its block, moved through every transaction's mapping: the
 * block's closing, which for a paragraph is Word's paragraph mark, what a paragraph is in Word.
 * Enter in a paragraph gives the text before the caret a new mark, so the handle stays with what
 * comes after it; a paragraph joined with the next one loses its mark, and its handle; accepting
 * a deleted paragraph or rejecting an inserted one leaves the paragraphs around under their
 * handles. `w14:paraId` cannot do this: paragraphs Foli creates have none (roadmap, Phase 13).
 *
 * A block that is removed and comes back by undo comes back without its handle.
 */
export class Handles {
  readonly #editor: Editor;
  /** Each handle's position: after its block. */
  readonly #ends = new Map<string, number>();
  #byEnd: Map<number, string> | null = null;
  #issued = 0;

  constructor(editor: Editor) {
    this.#editor = editor;
    let last = editor.state.doc;
    editor.subscribe((state, transactions) => {
      // `setDocument` tells without a transaction: no position of the old document holds.
      if (!transactions.length && state.doc !== last) this.#ends.clear();
      last = state.doc;
      for (const tr of transactions) {
        if (!tr.steps.length) continue;
        for (const [handle, end] of this.#ends) {
          // The two sides of the block's closing. A block removed, or joined with the next,
          // loses one of them or sees them part, and the handle goes.
          const before = tr.mapping.mapResult(end - 1, 1);
          const after = tr.mapping.mapResult(end, -1);
          if (before.deleted || after.deleted || after.pos !== before.pos + 1)
            this.#ends.delete(handle);
          else this.#ends.set(handle, after.pos);
        }
      }
      this.#byEnd = null;
    });
  }

  /** The handle of the block `node` at `pos` (before it), a new one if it has none yet. */
  at(pos: number, node: Node): string {
    const end = pos + node.nodeSize;
    this.#byEnd ??= new Map([...this.#ends].map(([handle, at]) => [at, handle]));
    let handle = this.#byEnd.get(end);
    if (!handle) {
      handle = `b${++this.#issued}`;
      this.#ends.set(handle, end);
      this.#byEnd.set(end, handle);
    }
    return handle;
  }

  /**
   * Where every handle is now, to put back with `restore` once the document is again as it
   * is now. Handles issued in between stay issued, and name nothing: none is given twice.
   */
  snapshot(): ReadonlyMap<string, number> {
    return new Map(this.#ends);
  }

  restore(ends: ReadonlyMap<string, number>): void {
    this.#ends.clear();
    for (const [handle, end] of ends) this.#ends.set(handle, end);
    this.#byEnd = null;
  }

  /** Whether `handle` was ever issued. */
  issued(handle: string): boolean {
    const n = /^b([1-9]\d*)$/.exec(handle);
    return !!n && Number(n[1]) <= this.#issued;
  }

  /** Where the block `handle` names is now (before it), with the block; null when it is gone. */
  resolve(handle: string): { pos: number; node: Node } | null {
    const end = this.#ends.get(handle);
    const doc = this.#editor.state.doc;
    if (end === undefined || end > doc.content.size) return null;
    const node = doc.resolve(end).nodeBefore;
    return node?.isBlock ? { pos: end - node.nodeSize, node } : null;
  }
}
