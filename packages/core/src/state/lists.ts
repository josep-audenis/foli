// The list commands follow the design of prosemirror-schema-list (MIT, see THIRD_PARTY_NOTICES.md);
// independent implementation on Foli's model.
import {
  type Attrs,
  Fragment,
  type Node,
  NodeRange,
  type NodeType,
  type ResolvedPos,
  Slice,
} from "../model/index.js";
import { ReplaceAroundStep } from "../transform/steps.js";
import { canJoin, canSplit, findWrapping, liftTarget } from "../transform/structure.js";
import { TransformError } from "../transform/transform.js";
import { closeHistory } from "./history.js";
import { Selection, TextSelection } from "./selection.js";
import { type Command, type EditorState, Plugin, type Transaction } from "./state.js";

/** The list node types this module treats as lists (any node holding list items). */
const isList = (node: Node, item: NodeType) => node.firstChild?.type === item && !node.isTextblock;

function itemTypeOf(state: EditorState): NodeType | null {
  return state.schema.nodes.listItem ?? null;
}

function nodeTypeOf(state: EditorState, type: string | NodeType): NodeType | null {
  return typeof type === "string" ? (state.schema.nodes[type] ?? null) : type;
}

/**
 * Runs `build`; a TransformError means the command does not apply (nothing dispatched). A list
 * change is its own undo step (it never merges with the edit before it).
 */
function apply(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  build: (tr: Transaction) => boolean,
): boolean {
  const tr = state.tr;
  try {
    if (!build(tr)) return false;
  } catch (error) {
    if (error instanceof TransformError) return false;
    throw error;
  }
  dispatch?.(tr.setMeta(closeHistory, true));
  return true;
}

/** The range of whole list items the selection covers (in text), or null outside a list. */
function itemRange(state: EditorState, item: NodeType): NodeRange | null {
  const $from = textStart(state);
  const { $to } = state.selection;
  const $end = $to.parent.inlineContent ? $to : Selection.near($to, -1).$to;
  return $from.blockRange($end, (node) => node.childCount > 0 && node.firstChild?.type === item);
}

/** The depth of the innermost list around `$pos`, or -1. */
function listDepth($pos: ResolvedPos, item: NodeType): number {
  for (let depth = $pos.depth; depth > 0; depth--) {
    if (isList($pos.node(depth), item)) return depth;
  }
  return -1;
}

/**
 * Where the selection starts, in text: a selection of everything starts before the first block,
 * outside every list; its first text position is in the first block.
 */
function textStart(state: EditorState): ResolvedPos {
  const { $from } = state.selection;
  return $from.parent.inlineContent ? $from : Selection.near($from, 1).$from;
}

/** The type of the innermost list around the selection's start, or null (for the toolbar). */
export function listTypeAt(state: EditorState): NodeType | null {
  const item = itemTypeOf(state);
  if (!item) return null;
  const $from = textStart(state);
  const depth = listDepth($from, item);
  return depth < 0 ? null : $from.node(depth).type;
}

/** Wraps the selected blocks in a list of `listType` (each run of blocks becomes one item). */
export function wrapInList(listType: string | NodeType, attrs: Attrs | null = null): Command {
  return (state, dispatch) => {
    const type = nodeTypeOf(state, listType);
    if (!type) return false;
    const { $from, $to } = state.selection;
    const range = $from.blockRange($to);
    const wrappers = range && findWrapping(range, type, attrs);
    if (!range || !wrappers) return false;
    return apply(state, dispatch, (tr) => {
      tr.wrap(range, wrappers);
      return true;
    });
  };
}

/**
 * Enter in a list item: splits the item at the selection (the rest of the paragraph and the
 * blocks after it start a new item). In an empty paragraph that is the item's only content,
 * the item is lifted instead (out of a nested list, or out of the list), as word processors do.
 */
export function splitListItem(itemType?: string | NodeType): Command {
  return (state, dispatch) => {
    const item = itemType ? nodeTypeOf(state, itemType) : itemTypeOf(state);
    const { $from, $to } = state.selection;
    if (!item || $from.depth < 2 || !$from.sameParent($to) || !$from.parent.isTextblock) {
      return false;
    }
    if ($from.node(-1).type !== item) return false;
    if (!$from.parent.content.size && $from.node(-1).childCount === $from.indexAfter(-1)) {
      // An empty last block: the whole item, or a trailing empty paragraph in it.
      if ($from.node(-1).childCount === 1) return liftListItem(item)(state, dispatch);
      const boundary = $from.before();
      if (!canSplit(state.doc, boundary, 1)) return false;
      return apply(state, dispatch, (tr) => {
        tr.split(boundary, 1);
        tr.setSelection(TextSelection.create(tr.doc, boundary + 3));
        return true;
      });
    }
    const atEnd = $to.pos === $from.end();
    const next = atEnd ? $from.node(-1).contentMatchAt(0).defaultType : null;
    return apply(state, dispatch, (tr) => {
      tr.delete($from.pos, $to.pos);
      const types = next ? [null, { type: next }] : undefined;
      if (!canSplit(tr.doc, $from.pos, 2, types)) return false;
      tr.split($from.pos, 2, types);
      tr.setSelection(TextSelection.create(tr.doc, $from.pos + 4));
      return true;
    });
  };
}

/**
 * Shift+Tab: lifts the selected list items one level: out of a nested list into the parent
 * list, or out of a top-level list (they become plain blocks).
 */
export function liftListItem(itemType?: string | NodeType): Command {
  return (state, dispatch) => {
    const item = itemType ? nodeTypeOf(state, itemType) : itemTypeOf(state);
    if (!item) return false;
    const range = itemRange(state, item);
    if (!range) return false;
    const nested = range.depth > 0 && range.$from.node(range.depth - 1).type === item;
    return apply(state, dispatch, (tr) =>
      nested ? liftToOuterList(tr, item, range) : liftOutOfList(tr, range),
    );
  };
}

function liftToOuterList(tr: Transaction, item: NodeType, initial: NodeRange): boolean {
  let range = initial;
  const end = range.end;
  const endOfList = range.$to.end(range.depth);
  if (end < endOfList) {
    // Items after the lifted ones become a list nested in the last lifted item.
    tr.step(
      new ReplaceAroundStep(
        end - 1,
        endOfList,
        end,
        endOfList,
        new Slice(Fragment.from(item.createOpen(null, range.parent.copy())), 1, 0),
        1,
        true,
      ),
    );
    range = new NodeRange(tr.doc.resolve(range.$from.pos), tr.doc.resolve(endOfList), range.depth);
  }
  const target = liftTarget(range);
  if (target === null) return false;
  tr.lift(range, target);
  const after = tr.mapping.map(end, -1) - 1;
  if (canJoin(tr.doc, after)) {
    const $after = tr.doc.resolve(after);
    if ($after.nodeBefore?.type === $after.nodeAfter?.type) tr.join(after);
  }
  return true;
}

function liftOutOfList(tr: Transaction, range: NodeRange): boolean {
  const list = range.parent;
  // Merge the lifted items into one, so that one lift takes their content out.
  for (let pos = range.end, i = range.endIndex - 1; i > range.startIndex; i--) {
    pos -= list.child(i).nodeSize;
    tr.delete(pos - 1, pos + 1);
  }
  const $start = tr.doc.resolve(range.start);
  const merged = $start.nodeAfter;
  if (!merged || tr.mapping.map(range.end) !== range.start + merged.nodeSize) return false;
  const atStart = range.startIndex === 0;
  const atEnd = range.endIndex === list.childCount;
  const parent = $start.node(-1);
  const indexBefore = $start.index(-1);
  if (
    !parent.canReplace(
      indexBefore + (atStart ? 0 : 1),
      indexBefore + 1,
      merged.content.append(atEnd ? Fragment.empty : Fragment.from(list)),
    )
  ) {
    return false;
  }
  const start = $start.pos;
  const end = start + merged.nodeSize;
  // Strip the list item and the list around it; where the list continues, close or reopen it.
  tr.step(
    new ReplaceAroundStep(
      start - (atStart ? 1 : 0),
      end + (atEnd ? 1 : 0),
      start + 1,
      end - 1,
      new Slice(
        (atStart ? Fragment.empty : Fragment.from(list.copy(Fragment.empty))).append(
          atEnd ? Fragment.empty : Fragment.from(list.copy(Fragment.empty)),
        ),
        atStart ? 0 : 1,
        atEnd ? 0 : 1,
      ),
      atStart ? 0 : 1,
      true,
    ),
  );
  return true;
}

/** Tab: nests the selected list items in the item before them (a sublist of the same type). */
export function sinkListItem(itemType?: string | NodeType): Command {
  return (state, dispatch) => {
    const item = itemType ? nodeTypeOf(state, itemType) : itemTypeOf(state);
    if (!item) return false;
    const range = itemRange(state, item);
    if (!range || range.startIndex === 0) return false;
    const parent = range.parent;
    const before = parent.child(range.startIndex - 1);
    if (before.type !== item) return false;
    return apply(state, dispatch, (tr) => {
      // Join a nested list that already ends the item before, else open a new one.
      const nestedBefore = before.lastChild?.type === parent.type;
      const inner = Fragment.from(nestedBefore ? item.createOpen() : null);
      const slice = new Slice(
        Fragment.from(item.createOpen(null, Fragment.from(parent.type.createOpen(null, inner)))),
        nestedBefore ? 3 : 1,
        0,
      );
      const { start, end } = range;
      tr.step(
        new ReplaceAroundStep(start - (nestedBefore ? 3 : 1), end, start, end, slice, 1, true),
      );
      return true;
    });
  };
}

/**
 * Backspace at the start of a list item's first paragraph: lifts the item (one level), as word
 * processors do, instead of merging it into the item before.
 */
export function liftListItemAtStart(itemType?: string | NodeType): Command {
  return (state, dispatch) => {
    const item = itemType ? nodeTypeOf(state, itemType) : itemTypeOf(state);
    const { $from, empty } = state.selection;
    if (!item || !empty || $from.parentOffset > 0 || $from.depth < 2) return false;
    if ($from.node(-1).type !== item || $from.index(-1) !== 0) return false;
    return liftListItem(item)(state, dispatch);
  };
}

/**
 * The list buttons: in a list of `listType`, lifts the selected items out of it; in a list of
 * another type, changes that list's type; elsewhere, wraps the selection in a new list.
 */
export function toggleList(listType: string | NodeType, attrs: Attrs | null = null): Command {
  return (state, dispatch) => {
    const type = nodeTypeOf(state, listType);
    const item = itemTypeOf(state);
    if (!type || !item) return false;
    const $from = textStart(state);
    const depth = listDepth($from, item);
    if (depth < 0) return wrapInList(type, attrs)(state, dispatch);
    const list = $from.node(depth);
    if (list.type !== type) {
      return apply(state, dispatch, (tr) => {
        tr.setNodeMarkup($from.before(depth), type, attrs);
        return true;
      });
    }
    // Out of every level of lists of this type around the selection, in one undo step.
    return apply(state, dispatch, (tr) => {
      let lifted = false;
      for (let guard = 0; guard < 32; guard++) {
        const current = state.apply(tr);
        const $at = textStart(current);
        const at = listDepth($at, item);
        if (at < 0 || $at.node(at).type !== type) break;
        const appended = (next: Transaction) => {
          for (const step of next.steps) tr.step(step);
        };
        if (!liftListItem(item)(current, appended)) break;
        lifted = true;
      }
      return lifted;
    });
  };
}

/**
 * The list key bindings: Enter splits or leaves a list item, Backspace at an item's start lifts
 * it, Tab and Shift+Tab nest and lift items (outside lists they do nothing here, so Tab still
 * moves focus), Mod-Shift-7 / Mod-Shift-8 toggle a numbered / bulleted list.
 */
export function listKeymap(): Plugin {
  return new Plugin({
    keymap: {
      Enter: splitListItem(),
      Backspace: liftListItemAtStart(),
      Tab: sinkListItem(),
      "Shift-Tab": liftListItem(),
      "Mod-Shift-7": toggleList("orderedList"),
      "Mod-Shift-8": toggleList("bulletList"),
    },
  });
}
