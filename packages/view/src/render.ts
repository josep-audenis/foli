import type { Node as ModelNode } from "@folijs/core";

/**
 * Marks the <br> of an explicit page break.
 * @internal
 */
export const PAGE_BREAK_ATTR = "data-page-break";

/**
 * A rendered inline leaf (a text node or hard break) and where it sits in its block's content.
 * A text node split across fragments is two leaves, one per fragment.
 * @internal
 */
export interface LeafDesc {
  readonly dom: Node;
  readonly offset: number;
  readonly size: number;
}

/**
 * View descriptor of one block: the model node, its elements and its leaves. A block split
 * across pages has one element per page (its fragments, in order); `dom` is the first.
 * @internal
 */
export interface BlockDesc {
  readonly node: ModelNode;
  readonly dom: HTMLElement;
  readonly fragments: readonly HTMLElement[];
  /** Content offsets where each fragment after the first starts (sorted, inside the content). */
  readonly splits: readonly number[];
  readonly leaves: readonly LeafDesc[];
}
