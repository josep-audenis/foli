import type { Editor, Node } from "@folijs/core";

/**
 * @internal
 * Names for blocks that outlive edits: `b1`, `b2`… in the order they were first read. A handle
 * is the position before its block, moved through every transaction's mapping. `w14:paraId`
 * cannot do this: paragraphs Foli creates have none (roadmap, Phase 13).
 */
export class Handles {
  readonly #editor: Editor;
  readonly #positions = new Map<string, number>();
  #byPosition: Map<number, string> | null = null;
  #issued = 0;

  constructor(editor: Editor) {
    this.#editor = editor;
    editor.subscribe((_state, transactions) => {
      for (const tr of transactions) {
        if (!tr.steps.length) continue;
        for (const [handle, pos] of this.#positions) {
          // The block's two edges: before it, and after its opening. A block removed or joined
          // into the one before loses one of them or sees them part, and the handle goes.
          const start = tr.mapping.mapResult(pos, 1);
          const inside = tr.mapping.mapResult(pos + 1, -1);
          if (start.deleted || inside.deleted || inside.pos !== start.pos + 1)
            this.#positions.delete(handle);
          else this.#positions.set(handle, start.pos);
        }
        this.#byPosition = null;
      }
    });
  }

  /** The handle of the block at `pos` (before it), a new one if it has none yet. */
  at(pos: number): string {
    this.#byPosition ??= new Map([...this.#positions].map(([handle, at]) => [at, handle]));
    let handle = this.#byPosition.get(pos);
    if (!handle) {
      handle = `b${++this.#issued}`;
      this.#positions.set(handle, pos);
      this.#byPosition.set(pos, handle);
    }
    return handle;
  }

  /** Whether `handle` was ever issued. */
  issued(handle: string): boolean {
    const n = /^b([1-9]\d*)$/.exec(handle);
    return !!n && Number(n[1]) <= this.#issued;
  }

  /** Where the block `handle` names is now, with the block; null when it is gone. */
  resolve(handle: string): { pos: number; node: Node } | null {
    const pos = this.#positions.get(handle);
    if (pos === undefined) return null;
    const doc = this.#editor.state.doc;
    if (pos > doc.content.size) return null;
    const node = doc.resolve(pos).nodeAfter;
    return node?.isBlock ? { pos, node } : null;
  }
}
