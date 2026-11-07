import { deepEqual } from "../model/attrs.js";
import type { Attrs, MarkType, NodeType, ResolvedPos } from "../model/index.js";
import { TransformError } from "../transform/transform.js";
import { redo, undo } from "./history.js";
import { AllSelection, marksAt, TextSelection } from "./selection.js";
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

/** Runs `build`; a TransformError means the command does not apply. */
function attempt(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  build: (tr: Transaction) => void,
): boolean {
  const tr = state.tr;
  try {
    build(tr);
  } catch (error) {
    if (error instanceof TransformError) return false;
    throw error;
  }
  if (!tr.docChanged && tr.selection.eq(state.selection) && tr.storedMarks === state.storedMarks) {
    return false;
  }
  dispatch?.(tr);
  return true;
}

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
  return false;
};

/** At the end of a textblock: merges the next textblock into it, or deletes a next leaf block. */
export const joinForward: Command = (state, dispatch) => {
  const $pos = caret(state);
  if (!$pos?.parent.isTextblock || $pos.parentOffset < $pos.parent.content.size || $pos.depth < 1) {
    return false;
  }
  const parent = $pos.node($pos.depth - 1);
  const after = parent.maybeChild($pos.index($pos.depth - 1) + 1);
  const boundary = $pos.after();
  if (after?.isTextblock) return attempt(state, dispatch, (tr) => tr.join(boundary));
  if (after?.isLeaf)
    return attempt(state, dispatch, (tr) => tr.delete(boundary, boundary + after.nodeSize));
  return false;
};

/**
 * Enter: splits the textblock at the selection. Splitting at the end of a non-default block
 * (a heading) starts a normal paragraph. Formatting carries over to the new block.
 */
export const splitBlock: Command = (state, dispatch) => {
  const { selection } = state;
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
      dispatch?.(
        state.tr.setStoredMarks(
          existing ? existing.removeFromSet(marks) : mark.create(attrs).addToSet(marks),
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
    return attempt(state, dispatch, (tr) => {
      if (rangeHasMark(state, selection.from, selection.to, mark)) {
        tr.removeMark(selection.from, selection.to, mark);
      } else {
        tr.addMark(selection.from, selection.to, mark.create(attrs));
      }
    });
  };
}

/** Whether the mark is active: in stored marks at a caret, or on all selected text. */
export function isMarkActive(state: EditorState, type: string | MarkType): boolean {
  const mark = markType(state, type);
  if (!mark) return false;
  const $caret = caret(state);
  if ($caret) return mark.isInSet(state.storedMarks ?? marksAt($caret)) !== undefined;
  return rangeHasMark(state, state.selection.from, state.selection.to, mark);
}

/** Changes the textblocks in the selection to `type` (e.g. heading level 2, or paragraph). */
export function setBlockType(type: string | NodeType, attrs: Attrs | null = null): Command {
  return (state, dispatch) => {
    const nodeType = typeof type === "string" ? state.schema.nodes[type] : type;
    if (!nodeType?.isTextblock) return false;
    const { from, to } = state.selection;
    let changes = false;
    state.doc.nodesBetween(from, to, (node) => {
      if (node.isTextblock && (node.type !== nodeType || !deepEqual(node.attrs, attrs ?? {})))
        changes = true;
      return !node.isTextblock;
    });
    if (!changes) return false;
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
      "Mod-a": selectAll,
      "Mod-z": undo,
      "Mod-Shift-z": redo,
      "Mod-y": redo,
    },
  });
}
