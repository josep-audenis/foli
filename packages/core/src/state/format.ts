import { Fragment, type MarkType, type Node, Slice } from "../model/index.js";
import { type Alignment, isColor } from "../schema.js";
import { TransformError } from "../transform/transform.js";
import { attempt } from "./attempt.js";
import { marksAt, NodeSelection, TextSelection } from "./selection.js";
import { type Command, defaultTextblockType, type EditorState } from "./state.js";

/** The alignment all textblocks in the selection share, or null (mixed, or no textblock). */
export function alignAt(state: EditorState): Alignment | null {
  let align: Alignment | null | undefined;
  const { from, to } = state.selection;
  state.doc.nodesBetween(from, to, (node) => {
    if (align === null) return false;
    if (!node.isTextblock) return undefined;
    const value = typeof node.attrs.align === "string" ? (node.attrs.align as Alignment) : null;
    align = align === undefined || align === value ? value : null;
    return false;
  });
  return align ?? null;
}

/**
 * Aligns the textblocks in the selection (`start` is the default: it removes the alignment).
 * An unknown value does not apply (the schema rejects it).
 */
export function setAlign(align: Alignment): Command {
  return (state, dispatch) => {
    const { from, to } = state.selection;
    return attempt(state, dispatch, (tr) => tr.setBlockAttrs(from, to, { align }));
  };
}

/**
 * Colors the selected text with a color mark (`textColor`, `highlight`), replacing the one it
 * has; `null` removes it. At a caret, sets the mark for the text typed next. Colors are
 * lowercase `#rrggbb` (an uppercase one is lowered); others do not apply.
 */
function setColorMark(name: string, color: string | null): Command {
  return (state, dispatch) => {
    const type: MarkType | undefined = state.schema.marks[name];
    const value = color?.toLowerCase() ?? null;
    if (!type || (value !== null && !isColor(value))) return false;
    const mark = value === null ? null : type.create({ color: value });
    const { selection } = state;
    if (selection.empty && selection instanceof TextSelection) {
      const { $from } = selection;
      if (!$from.parent.type.allowsMarkType(type)) return false;
      const marks = state.storedMarks ?? marksAt($from);
      const next = mark ? mark.addToSet(marks) : type.removeFromSet(marks);
      if (next === marks) return false;
      dispatch?.(state.tr.setStoredMarks(next));
      return true;
    }
    const { from, to } = selection;
    return attempt(state, dispatch, (tr) => {
      if (mark) tr.addMark(from, to, mark);
      else tr.removeMark(from, to, type);
    });
  };
}

/** Text color (`#rrggbb`) for the selected or next typed text; `null` removes it. */
export const setTextColor = (color: string | null): Command => setColorMark("textColor", color);

/** Highlight (background color, `#rrggbb`) for the selected or next typed text; `null` removes it. */
export const setHighlight = (color: string | null): Command => setColorMark("highlight", color);

/**
 * The color of `name` (`textColor`, `highlight`) at the selection: the one all selected text
 * has (at a caret, the one typing gets), or null (none, or mixed).
 */
export function colorAt(state: EditorState, name: "textColor" | "highlight"): string | null {
  const type = state.schema.marks[name];
  if (!type) return null;
  const read = (marks: Parameters<MarkType["isInSet"]>[0]) =>
    (type.isInSet(marks)?.attrs.color as string | undefined) ?? null;
  const { selection } = state;
  if (selection.empty) return read(state.storedMarks ?? marksAt(selection.$from));
  let color: string | null | undefined;
  state.doc.nodesBetween(selection.from, selection.to, (node, _pos, parent) => {
    if (color === null) return false;
    if (!node.isInline || !parent?.type.allowsMarkType(type)) return undefined;
    const value = read(node.marks);
    color = color === undefined || color === value ? value : null;
    return false;
  });
  return color ?? null;
}

/**
 * Inserts a horizontal rule at the selection: at the start of a textblock, before it; at its
 * end, after it, with a new empty paragraph for the caret; inside it, splitting it. Where a
 * rule cannot go before the textblock (a list item's first paragraph), an empty one is treated
 * as its end and a non-empty one is split at its start. With a block selected (a rule), after
 * that block. The caret goes to the text after the rule, keeping the marks typing had.
 */
export const insertHorizontalRule: Command = (state, dispatch) => {
  const rule = state.schema.nodes.horizontalRule;
  if (!rule) return false;
  const paragraph = defaultTextblockType(state.schema);
  const { selection } = state;
  return attempt(state, dispatch, (tr) => {
    const marks = state.storedMarks ?? marksAt(selection.$from);
    let at: number;
    let newParagraph: boolean;
    if (selection instanceof NodeSelection && selection.node.isBlock) {
      at = selection.to;
      newParagraph = !tr.doc.resolve(at).nodeAfter?.isTextblock;
    } else {
      tr.deleteSelection();
      const $pos = tr.selection.$from;
      if (!$pos.parent.isTextblock) throw new TransformError("No rule here");
      const index = $pos.index(-1);
      const before = $pos.node(-1).canReplaceWith(index, index, rule);
      if ($pos.parentOffset === 0 && before) {
        at = $pos.before();
        newParagraph = false;
      } else if ($pos.parentOffset === $pos.parent.content.size) {
        at = $pos.after();
        newParagraph = true;
      } else {
        tr.split($pos.pos);
        at = $pos.pos + 1;
        newParagraph = false;
      }
    }
    const content: Node[] = [rule.create()];
    if (newParagraph) content.push(paragraph.create());
    tr.replace(at, at, new Slice(Fragment.from(content), 0, 0));
    tr.setSelection(TextSelection.create(tr.doc, at + 2));
    if (marks.length) tr.setStoredMarks(marks);
  });
};
