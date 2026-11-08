import {
  type Attrs,
  FoliDocumentError,
  Fragment,
  type Mark,
  type MarkType,
  type Node,
  type NodeType,
  type ResolvedPos,
  Slice,
} from "../model/index.js";
import { TransformError } from "../transform/transform.js";
import { attempt } from "./attempt.js";
import { redo, undo } from "./history.js";
import { openLinkEditor } from "./links.js";
import { AllSelection, marksAt, NodeSelection, Selection, TextSelection } from "./selection.js";
import {
  type Command,
  defaultTextblockType,
  type EditorState,
  Plugin,
  type Transaction,
} from "./state.js";

export type DeleteUnit = "char" | "word";

/**
 * Stands in for leaf nodes (one position each) in text measurements. A line feed, because
 * grapheme rules never join it with a following combining mark (U+FFFC would be).
 */
const LEAF = "\n";
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const words = new Intl.Segmenter(undefined, { granularity: "word" });

function caret(state: EditorState): ResolvedPos | null {
  const { selection } = state;
  return selection.empty && selection instanceof TextSelection ? selection.$head : null;
}

export const deleteSelection: Command = (state, dispatch) => {
  if (state.selection.empty) return false;
  return attempt(state, dispatch, (tr) => tr.deleteSelection());
};

/** Replaces the selection with text, using stored marks or the marks at the selection start. */
export function insertText(text: string): Command {
  return (state, dispatch) => {
    if (!text) return false;
    const { selection } = state;
    if (selectedBlock(state)) {
      // Typing over a selected block (a rule) replaces it with a paragraph of the text.
      return replaceSelectedBlock(
        state,
        dispatch,
        state.schema.text(text, state.storedMarks ?? []),
      );
    }
    if (!(selection instanceof AllSelection) && !selection.$from.parent.inlineContent) return false;
    return attempt(state, dispatch, (tr) => {
      const $from = selection.$from;
      const marks =
        state.storedMarks ??
        (selection.empty ? marksAt($from) : ($from.nodeAfter?.marks ?? marksAt($from)));
      tr.deleteSelection();
      const $pos = tr.selection.$from;
      const allowed = marks.filter((mark) => $pos.parent.type.allowsMarkType(mark.type));
      tr.insertText(text, $pos.pos, $pos.pos, allowed);
      tr.setSelection(TextSelection.create(tr.doc, $pos.pos + text.length));
    });
  };
}

/** Length (in positions) of the last grapheme or word before `$pos` in its textblock. */
function backwardExtent($pos: ResolvedPos, unit: DeleteUnit): number {
  const text = $pos.parent.textBetween(0, $pos.parentOffset, "", LEAF);
  if (unit === "char") return [...graphemes.segment(text)].pop()?.segment.length ?? 0;
  const segments = [...words.segment(text)];
  let length = 0;
  while (segments.length && !segments[segments.length - 1]?.isWordLike)
    length += segments.pop()?.segment.length ?? 0;
  return length + (segments.pop()?.segment.length ?? 0);
}

/** Length of the first grapheme or word after `$pos` in its textblock. */
function forwardExtent($pos: ResolvedPos, unit: DeleteUnit): number {
  const text = $pos.parent.textBetween($pos.parentOffset, $pos.parent.content.size, "", LEAF);
  const segments = [...(unit === "char" ? graphemes : words).segment(text)];
  if (unit === "char") return segments[0]?.segment.length ?? 0;
  let length = 0;
  while (segments.length && !segments[0]?.isWordLike)
    length += segments.shift()?.segment.length ?? 0;
  return length + (segments.shift()?.segment.length ?? 0);
}

/** Backspace: deletes the selection, else the previous character or word, else joins with the previous block. */
export function deleteBackward(unit: DeleteUnit = "char"): Command {
  return (state, dispatch) => {
    if (!state.selection.empty) return deleteSelection(state, dispatch);
    const $pos = caret(state);
    if (!$pos) return false;
    if ($pos.parentOffset === 0) return joinBackward(state, dispatch);
    const size = backwardExtent($pos, unit);
    return attempt(state, dispatch, (tr) => tr.delete($pos.pos - size, $pos.pos));
  };
}

/** Delete: deletes the selection, else the next character or word, else joins with the next block. */
export function deleteForward(unit: DeleteUnit = "char"): Command {
  return (state, dispatch) => {
    if (!state.selection.empty) return deleteSelection(state, dispatch);
    const $pos = caret(state);
    if (!$pos) return false;
    if ($pos.parentOffset === $pos.parent.content.size) return joinForward(state, dispatch);
    const size = forwardExtent($pos, unit);
    return attempt(state, dispatch, (tr) => tr.delete($pos.pos, $pos.pos + size));
  };
}

/**
 * At the start of a textblock: merges it into the previous textblock, or deletes a previous leaf
 * block. Does nothing at the start of the first block.
 */
export const joinBackward: Command = (state, dispatch) => {
  const $pos = caret(state);
  if (!$pos?.parent.isTextblock || $pos.parentOffset > 0 || $pos.depth < 1) return false;
  const index = $pos.index($pos.depth - 1);
  if (index === 0) return false;
  const before = $pos.node($pos.depth - 1).child(index - 1);
  const boundary = $pos.before();
  if (before.isTextblock) return attempt(state, dispatch, (tr) => tr.join(boundary));
  if (before.isLeaf)
    return attempt(state, dispatch, (tr) => tr.delete(boundary - before.nodeSize, boundary));
  // After a container (a list): into its last textblock, at any depth.
  let levels = 1;
  let target: Node | null = before;
  while (target && !target.isTextblock && !target.isLeaf) {
    target = target.lastChild;
    levels++;
  }
  if (target?.isLeaf) {
    // A container ending in a leaf block (a rule): delete the leaf.
    const end = boundary - (levels - 1);
    const leaf = target;
    return attempt(state, dispatch, (tr) => tr.delete(end - leaf.nodeSize, end));
  }
  if (!target?.isTextblock) return false;
  const parent = $pos.node($pos.depth - 1);
  if (!parent.canReplace(index, index + 1)) return false;
  const joinAt = boundary - levels;
  const content = $pos.parent.content;
  return attempt(state, dispatch, (tr) => {
    tr.insert(joinAt, content);
    const start = tr.mapping.map(boundary);
    tr.delete(start, start + $pos.parent.nodeSize);
    tr.setSelection(TextSelection.create(tr.doc, joinAt));
  });
};

/**
 * At the end of a textblock: merges the next textblock into it, or deletes a next leaf block. At
 * the end of a container's last block (a list item), what follows the container comes in.
 */
export const joinForward: Command = (state, dispatch) => {
  const $pos = caret(state);
  if (!$pos?.parent.isTextblock || $pos.parentOffset < $pos.parent.content.size || $pos.depth < 1) {
    return false;
  }
  // The innermost container in which something follows the caret's block.
  let base = $pos.depth - 1;
  while (base > 0 && $pos.index(base) === $pos.node(base).childCount - 1) base--;
  const after = $pos.node(base).maybeChild($pos.index(base) + 1);
  if (!after) return false;
  const boundary = $pos.after(base + 1);
  if (after.isTextblock && base === $pos.depth - 1) {
    return attempt(state, dispatch, (tr) => tr.join(boundary));
  }
  if (after.isLeaf) {
    return attempt(state, dispatch, (tr) => tr.delete(boundary, boundary + after.nodeSize));
  }
  // Before a container (a list): its first textblock joins this one; the containers it leaves
  // empty go too (a list item, a list). Not when its container must keep it (a list item that
  // goes on with a nested list): that needs a lift first.
  let levels = 1;
  let target: Node | null = after;
  while (target && !target.isTextblock && !target.isLeaf) {
    target = target.firstChild;
    levels++;
  }
  if (!target?.isTextblock) return false;
  const $target = state.doc.resolve(boundary + levels);
  let depth = $target.depth;
  while (depth > base + 1) {
    const holder = $target.node(depth - 1);
    const at = $target.index(depth - 1);
    if (holder.canReplace(at, at + 1)) break;
    if (holder.childCount !== 1) return false;
    depth--;
  }
  const from = $target.before(depth);
  const to = $target.after(depth);
  const content = target.content;
  return attempt(state, dispatch, (tr) => {
    tr.delete(from, to);
    tr.insert($pos.pos, content);
    tr.setSelection(TextSelection.create(tr.doc, $pos.pos));
  });
};

/**
 * Enter: splits the textblock at the selection. Splitting at the end of a non-default block
 * (a heading) starts a normal paragraph. Formatting carries over to the new block.
 */
export const splitBlock: Command = (state, dispatch) => {
  const { selection } = state;
  const block = selectedBlock(state);
  if (block) {
    // Enter on a selected block (a rule): a new paragraph after it.
    return attempt(state, dispatch, (tr) => {
      tr.insert(selection.to, defaultTextblockType(state.schema).create());
      tr.setSelection(TextSelection.create(tr.doc, selection.to + 1));
    });
  }
  if (!(selection instanceof AllSelection) && !selection.$from.parent.isTextblock) return false;
  return attempt(state, dispatch, (tr) => {
    const marks = state.storedMarks ?? marksAt(selection.$from);
    tr.deleteSelection();
    const $pos = tr.selection.$from;
    const atEnd = $pos.parentOffset === $pos.parent.content.size;
    const normal = defaultTextblockType(state.schema);
    tr.split($pos.pos, 1, atEnd && $pos.parent.type !== normal ? [{ type: normal }] : undefined);
    tr.setSelection(TextSelection.create(tr.doc, $pos.pos + 2));
    if (marks.length) tr.setStoredMarks(marks);
  });
};

/** The selected block node (a rule), when the selection is a node selection of a block. */
function selectedBlock(state: EditorState): Node | null {
  const { selection } = state;
  return selection instanceof NodeSelection && selection.node.isBlock ? selection.node : null;
}

/** Replaces the selected block with a default textblock holding `content` (caret at its end). */
function replaceSelectedBlock(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  content: Node,
): boolean {
  const { from, to } = state.selection;
  const block = defaultTextblockType(state.schema).create(null, content);
  return attempt(state, dispatch, (tr) => {
    tr.replace(from, to, new Slice(Fragment.from(block), 0, 0));
    tr.setSelection(TextSelection.create(tr.doc, from + 1 + content.nodeSize));
  });
}

/**
 * The leaf block or textblock next to `pos` (a position between blocks) in direction `dir`,
 * through container boundaries (the rule ending the list item before), or null at the end.
 */
function blockBeside(doc: Node, pos: number, dir: -1 | 1): { node: Node; pos: number } | null {
  let $pos = doc.resolve(pos);
  for (;;) {
    let node = dir < 0 ? $pos.nodeBefore : $pos.nodeAfter;
    if (node) {
      let start = dir < 0 ? $pos.pos - node.nodeSize : $pos.pos;
      while (!node.isTextblock && !node.isLeaf) {
        const child: Node | null = dir < 0 ? node.lastChild : node.firstChild;
        if (!child) return null;
        start = dir < 0 ? start + node.nodeSize - 1 - child.nodeSize : start + 1;
        node = child;
      }
      return { node, pos: start };
    }
    if ($pos.depth === 0) return null;
    $pos = doc.resolve(dir < 0 ? $pos.before() : $pos.after());
  }
}

/**
 * Arrow keys around a block leaf (a rule, which has no caret stop). From a selected leaf: to the
 * text beside it (the end of the text before, the start of the text after), or the next leaf.
 * From a caret: selects the leaf beside the caret's textblock, when the caret is at its edge
 * (`"char"`: Left/Right at the textblock's first or last position) or the view found it on the
 * first or last line (`"line"`: Up/Down). `"none"` only moves from a selected leaf. `dir` -1 is
 * back (left, up), 1 forward.
 */
export function arrowAcrossLeaf(dir: -1 | 1, from: "char" | "line" | "none"): Command {
  return (state, dispatch) => {
    const { selection, doc } = state;
    if (selectedBlock(state)) {
      const beside = blockBeside(doc, dir < 0 ? selection.from : selection.to, dir);
      // At the document's edge: stay (a native arrow would leave a broken DOM range).
      if (!beside) return true;
      const next = beside.node.isTextblock
        ? TextSelection.create(
            doc,
            dir < 0 ? beside.pos + beside.node.nodeSize - 1 : beside.pos + 1,
          )
        : NodeSelection.isSelectable(beside.node)
          ? NodeSelection.create(doc, beside.pos)
          : Selection.near(doc.resolve(beside.pos), dir);
      dispatch?.(state.tr.setSelection(next));
      return true;
    }
    if (from === "none" || !selection.empty || !(selection instanceof TextSelection)) return false;
    const { $from } = selection;
    if (!$from.parent.isTextblock || $from.depth < 1) return false;
    const atEdge =
      dir < 0 ? $from.parentOffset === 0 : $from.parentOffset === $from.parent.content.size;
    if (from === "char" && !atEdge) return false;
    const beside = blockBeside(doc, dir < 0 ? $from.before() : $from.after(), dir);
    if (!beside || beside.node.isTextblock || !NodeSelection.isSelectable(beside.node))
      return false;
    dispatch?.(state.tr.setSelection(NodeSelection.create(doc, beside.pos)));
    return true;
  };
}

/** Inserts a hard break (a line break inside the block) in place of the selection. */
export const insertHardBreak: Command = (state, dispatch) =>
  insertLeaf("hardBreak", state, dispatch);

/** Inserts an explicit page break in place of the selection (Mod-Enter). */
export const insertPageBreak: Command = (state, dispatch) =>
  insertLeaf("pageBreak", state, dispatch);

/** Replaces the selection with an inline leaf node of `name`, keeping the marks typing gets. */
function insertLeaf(name: string, ...[state, dispatch]: Parameters<Command>): boolean {
  const type = state.schema.nodes[name];
  const { selection } = state;
  if (!type || (!(selection instanceof AllSelection) && !selection.$from.parent.inlineContent)) {
    return false;
  }
  return attempt(state, dispatch, (tr) => {
    const marks = state.storedMarks ?? marksAt(selection.$from);
    tr.deleteSelection();
    const pos = tr.selection.from;
    tr.insert(
      pos,
      type.create(
        null,
        null,
        marks.filter((m) => tr.doc.resolve(pos).parent.type.allowsMarkType(m.type)),
      ),
    );
    tr.setSelection(TextSelection.create(tr.doc, pos + 1));
  });
}

export const selectAll: Command = (state, dispatch) => {
  dispatch?.(state.tr.setSelection(new AllSelection(state.doc)));
  return true;
};

function markType(state: EditorState, type: string | MarkType): MarkType | undefined {
  return typeof type === "string" ? state.schema.marks[type] : type;
}

/** True if every inline node overlapping `from..to` (in parents that allow the mark) has it. */
function rangeHasMark(state: EditorState, from: number, to: number, type: MarkType): boolean {
  let all = true;
  let any = false;
  state.doc.nodesBetween(from, to, (node, _pos, parent) => {
    if (!all || !node.isInline || !parent?.type.allowsMarkType(type)) return undefined;
    any = true;
    if (!type.isInSet(node.marks)) all = false;
    return false;
  });
  return any && all;
}

/**
 * Toggles a mark. At a caret it toggles the stored marks for the next typed text; on a range it
 * removes the mark if all text has it, else adds it everywhere.
 */
export function toggleMark(type: string | MarkType, attrs?: Attrs | null): Command {
  return (state, dispatch) => {
    const mark = markType(state, type);
    if (!mark) return false;
    const { selection } = state;
    const $caret = caret(state);
    if ($caret) {
      if (!$caret.parent.type.allowsMarkType(mark)) return false;
      const marks = state.storedMarks ?? marksAt($caret);
      const existing = mark.isInSet(marks);
      const created = existing ? null : createMark(mark, attrs);
      if (!existing && !created) return false;
      dispatch?.(
        state.tr.setStoredMarks(
          existing ? existing.removeFromSet(marks) : (created as Mark).addToSet(marks),
        ),
      );
      return true;
    }
    let applicable = false;
    state.doc.nodesBetween(selection.from, selection.to, (node) => {
      if (node.isTextblock && node.type.allowsMarkType(mark)) applicable = true;
      return !applicable;
    });
    if (!applicable) return false;
    const remove = rangeHasMark(state, selection.from, selection.to, mark);
    const created = remove ? null : createMark(mark, attrs);
    if (!remove && !created) return false;
    return attempt(state, dispatch, (tr) => {
      if (remove) tr.removeMark(selection.from, selection.to, mark);
      else tr.addMark(selection.from, selection.to, created as Mark);
    });
  };
}

/** The mark, or null when `attrs` are invalid for it (e.g. a link with an unsafe href). */
function createMark(type: MarkType, attrs?: Attrs | null): Mark | null {
  try {
    return type.create(attrs);
  } catch (error) {
    if (error instanceof FoliDocumentError) return null;
    throw error;
  }
}

/** Whether the mark is active: in stored marks at a caret, or on all selected text. */
export function isMarkActive(state: EditorState, type: string | MarkType): boolean {
  const mark = markType(state, type);
  if (!mark) return false;
  const $caret = caret(state);
  if ($caret) return mark.isInSet(state.storedMarks ?? marksAt($caret)) !== undefined;
  return rangeHasMark(state, state.selection.from, state.selection.to, mark);
}

/**
 * Changes the textblocks in the selection to `type` (e.g. heading level 2, or paragraph),
 * keeping attributes both types have (alignment). Does not apply when nothing would change.
 */
export function setBlockType(type: string | NodeType, attrs: Attrs | null = null): Command {
  return (state, dispatch) => {
    const nodeType = typeof type === "string" ? state.schema.nodes[type] : type;
    if (!nodeType?.isTextblock) return false;
    const { from, to } = state.selection;
    // A transaction with no step (every block already like that) does not apply.
    return attempt(state, dispatch, (tr) => tr.setBlockType(from, to, nodeType, attrs));
  };
}

/**
 * Default key bindings. Key names follow the view's normalization ("Mod" = Ctrl or Cmd). Word and
 * line deletion are not bound: their keys differ per platform (Ctrl+Backspace, Option+Backspace,
 * Cmd+Backspace), so the view takes them from the browser's `beforeinput` types.
 */
export function baseKeymap(): Plugin {
  return new Plugin({
    keymap: {
      Enter: splitBlock,
      "Shift-Enter": insertHardBreak,
      "Mod-Enter": insertPageBreak,
      Backspace: deleteBackward(),
      Delete: deleteForward(),
      "Mod-b": toggleMark("bold"),
      "Mod-i": toggleMark("italic"),
      "Mod-u": toggleMark("underline"),
      "Mod-k": openLinkEditor,
      "Mod-a": selectAll,
      // Up/Down from a caret need the view's line geometry: it runs arrowAcrossLeaf(dir, "line").
      ArrowLeft: arrowAcrossLeaf(-1, "char"),
      ArrowRight: arrowAcrossLeaf(1, "char"),
      ArrowUp: arrowAcrossLeaf(-1, "none"),
      ArrowDown: arrowAcrossLeaf(1, "none"),
      "Mod-z": undo,
      "Mod-Shift-z": redo,
      "Mod-y": redo,
    },
  });
}
