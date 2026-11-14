/**
 * What Word keeps on a paragraph's mark, and the marks typed text must not take: shared by the
 * transaction (deleting across paragraphs) and the commands. No imports from the state module
 * (it is imported by it).
 */
import type { Mark, Node } from "../model/index.js";
import type { Transform } from "../transform/transform.js";

/**
 * Attributes the paragraph mark carries in Word (schema v3): the section break, the mark's
 * tracked change and the paragraph's own attributes (`w14:paraId`). Whichever paragraph keeps
 * the mark keeps them.
 */
export const MARK_ATTRS = ["section", "revision", "formatChange", "attributes"] as const;

/**
 * After a join, or a deletion across paragraphs, the merged paragraph at `pos` ends with the
 * last paragraph's mark, as in Word: it takes that paragraph's mark attributes (deleting a
 * section break merges its section into the next one). Nothing for a schema without them (v2).
 */
export function keepLastMark(tr: Transform, pos: number, last: Node): void {
  const merged = tr.doc.nodeAt(pos);
  if (!merged?.isTextblock) return;
  const attrs = { ...merged.attrs };
  let changed = false;
  for (const key of MARK_ATTRS) {
    // Schema v2 has none of them: both sides null, nothing changes.
    const value = last.attrs[key] ?? null;
    if (JSON.stringify(attrs[key] ?? null) === JSON.stringify(value)) continue;
    attrs[key] = value;
    changed = true;
  }
  if (changed) tr.setNodeMarkup(pos, merged.type, attrs);
}

/** Tracked-change marks: typed or pasted text is not part of someone's recorded change. */
const REVIEW_MARKS = new Set(["insertion", "deletion", "formatChange"]);

/**
 * The marks text typed among `marks` gets: without tracked-change marks.
 * shortcut: until Phase 9 records changes, typed text is never marked as one.
 */
export function typedMarks(marks: readonly Mark[]): readonly Mark[] {
  return marks.some((m) => REVIEW_MARKS.has(m.type.name))
    ? marks.filter((m) => !REVIEW_MARKS.has(m.type.name))
    : marks;
}
