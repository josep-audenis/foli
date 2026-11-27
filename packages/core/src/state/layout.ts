/**
 * Word's Layout Options for pictures and text boxes (33.4): how text wraps around an object, in
 * line with it or floating, whether it moves with its paragraph or stays fixed on the page, and
 * where it is (Position's presets, the Layout dialog's values). One undo step each; not while
 * tracking (Foli does not record an object's layout change, as it does not its size).
 */

import type { Node } from "../model/index.js";
import { attempt } from "./attempt.js";
import { closeHistory } from "./history.js";
import { NodeSelection } from "./selection.js";
import type { Command, EditorState } from "./state.js";
import { trackState } from "./track.js";

/** How text goes around an object: `inline` is in line with text (no `float`). */
export type ObjectWrap =
  | "inline"
  | "square"
  | "tight"
  | "through"
  | "topAndBottom"
  | "behind"
  | "inFront";

/** Word's wrapping options, in its menu's order. */
export const OBJECT_WRAPS: readonly ObjectWrap[] = [
  "inline",
  "square",
  "tight",
  "through",
  "topAndBottom",
  "behind",
  "inFront",
];

/** Where an object's float says it is on one axis: from what, by an offset (EMU) or aligned. */
export interface ObjectAxis {
  relativeTo: string;
  offset?: number;
  align?: string;
}

/**
 * Where an object is drawn, in CSS px from its page's top left corner, with its paragraph's top
 * and its column's left edge: what a change of layout keeps it at (`view.objectPlacement`).
 */
export interface ObjectPlacement {
  left: number;
  top: number;
  paragraphTop: number;
  columnLeft: number;
}

/** EMU per CSS px. */
const EMU_PER_PX = 9525;
const emu = (px: number) => Math.round(px * EMU_PER_PX);

/** The selected picture or text box (a node selection of one) and its position, if any. */
export function selectedObject(state: EditorState): { node: Node; pos: number } | null {
  const { selection } = state;
  const name = selection instanceof NodeSelection ? selection.node.type.name : "";
  return name === "picture" || name === "textBox"
    ? { node: (selection as NodeSelection).node, pos: selection.from }
    : null;
}

/** How text goes around `node` (a picture or a text box). */
export function objectWrap(node: Node): ObjectWrap {
  const float = node.attrs.float as { wrap?: ObjectWrap } | null;
  return float?.wrap ?? "inline";
}

/** Whether `node` moves with its paragraph (false: fixed on the page; in line: true). */
export function objectMovesWithText(node: Node): boolean {
  const float = node.attrs.float as { vertical?: ObjectAxis } | null;
  const from = float?.vertical?.relativeTo;
  return !float || from === "paragraph" || from === "line";
}

const objectAt = (state: EditorState, pos: number) => {
  const node = pos >= 0 && pos < state.doc.content.size ? state.doc.nodeAt(pos) : null;
  return node && (node.type.name === "picture" || node.type.name === "textBox") ? node : null;
};

/** The object at `pos` with `float` (null: in line), kept selected if it was. */
function setFloat(pos: number, float: (node: Node) => Record<string, unknown> | null): Command {
  return (state, dispatch) => {
    const node = objectAt(state, pos);
    if (!node || trackState(state)?.on === true) return false;
    const next = float(node);
    if (JSON.stringify(next) === JSON.stringify(node.attrs.float ?? null)) return false;
    return attempt(state, dispatch, (tr) => {
      tr.setMeta(closeHistory, true);
      tr.setNodeMarkup(pos, node.type, { ...node.attrs, float: next });
      if (state.selection instanceof NodeSelection && state.selection.from === pos)
        tr.setSelection(NodeSelection.create(tr.doc, pos));
    });
  };
}

/** Word's distance from text for a new floating object: 0.125" left and right. */
const DISTANCE = { top: 0, bottom: 0, left: 114_300, right: 114_300 };

/**
 * Wraps the object at `pos` as `wrap`. Floating from in line, it stays where `placement` says it
 * is drawn (else at its paragraph's top left), moving with its paragraph; in line, it loses its
 * position. Between floating kinds only the wrapping changes.
 */
export function setObjectWrap(pos: number, wrap: ObjectWrap, placement?: ObjectPlacement): Command {
  return setFloat(pos, (node) => {
    if (wrap === "inline") return null;
    const float = node.attrs.float as Record<string, unknown> | null;
    if (float) return { ...float, wrap };
    return {
      horizontal: {
        relativeTo: "column",
        offset: placement ? emu(placement.left - placement.columnLeft) : 0,
      },
      vertical: {
        relativeTo: "paragraph",
        offset: placement ? emu(placement.top - placement.paragraphTop) : 0,
      },
      wrap,
      side: "bothSides",
      distance: DISTANCE,
      allowOverlap: true,
      layoutInCell: true,
    };
  });
}

/**
 * Word's "Move with text" (`moves`) or "Fix position on page": the object's vertical position
 * against its paragraph or the page, kept where `placement` says it is drawn. In line: nothing.
 */
export function setObjectMovesWithText(
  pos: number,
  moves: boolean,
  placement?: ObjectPlacement,
): Command {
  return (state, dispatch) => {
    const node = objectAt(state, pos);
    if (!node?.attrs.float || objectMovesWithText(node) === moves) return false;
    return setFloat(pos, (n) => {
      const float = n.attrs.float as Record<string, unknown>;
      const vertical = float.vertical as ObjectAxis;
      // Not drawn (no placement): its offset as it is, only what it is from changes.
      const top = placement
        ? emu(moves ? placement.top - placement.paragraphTop : placement.top)
        : (vertical.offset ?? 0);
      return { ...float, vertical: { relativeTo: moves ? "paragraph" : "page", offset: top } };
    })(state, dispatch);
  };
}

/** What the Layout dialog sets of a floating object (33.4); what is left out stays. */
export interface ObjectLayout {
  horizontal?: ObjectAxis;
  vertical?: ObjectAxis;
  side?: "bothSides" | "left" | "right" | "largest";
  /** In EMU. */
  distance?: { top?: number; bottom?: number; left?: number; right?: number };
  allowOverlap?: boolean;
  layoutInCell?: boolean;
}

/**
 * Sets what `layout` gives of the floating object at `pos`: its position, the sides text goes on,
 * its distance from text, overlap and layout in a table cell. In line: nothing (wrap it first).
 */
export function setObjectLayout(pos: number, layout: ObjectLayout): Command {
  return (state, dispatch) => {
    const node = objectAt(state, pos);
    if (!node?.attrs.float) return false;
    return setFloat(pos, (n) => {
      const float = n.attrs.float as Record<string, unknown>;
      const axis = (a: ObjectAxis | undefined, start: string) =>
        a &&
        (typeof a.offset === "number"
          ? { relativeTo: a.relativeTo, offset: Math.round(a.offset) }
          : { relativeTo: a.relativeTo, align: a.align ?? start });
      return {
        ...float,
        ...(layout.horizontal ? { horizontal: axis(layout.horizontal, "left") } : {}),
        ...(layout.vertical ? { vertical: axis(layout.vertical, "top") } : {}),
        ...(layout.side ? { side: layout.side } : {}),
        ...(layout.distance
          ? {
              distance: {
                ...DISTANCE,
                ...(float.distance as object),
                ...Object.fromEntries(
                  Object.entries(layout.distance)
                    .filter(([, v]) => typeof v === "number")
                    .map(([k, v]) => [k, Math.max(0, Math.round(v as number))]),
                ),
              },
            }
          : {}),
        ...(layout.allowOverlap !== undefined ? { allowOverlap: layout.allowOverlap } : {}),
        ...(layout.layoutInCell !== undefined ? { layoutInCell: layout.layoutInCell } : {}),
      };
    })(state, dispatch);
  };
}

/** Word's Position presets ("With Text Wrapping"): against the margins, aligned. */
export const OBJECT_POSITIONS = {
  topLeft: ["left", "top"],
  topCenter: ["center", "top"],
  topRight: ["right", "top"],
  middleLeft: ["left", "center"],
  middleCenter: ["center", "center"],
  middleRight: ["right", "center"],
  bottomLeft: ["left", "bottom"],
  bottomCenter: ["center", "bottom"],
  bottomRight: ["right", "bottom"],
} as const;

export type ObjectPosition = keyof typeof OBJECT_POSITIONS;

/**
 * Puts the object at `pos` at one of Word's Position presets: aligned in the margins, fixed on
 * the page, wrapped square (as Word's menu does; one behind or in front of text keeps that).
 */
export function setObjectPosition(pos: number, position: ObjectPosition): Command {
  const [h, v] = OBJECT_POSITIONS[position];
  return setFloat(pos, (node) => {
    const float = node.attrs.float as Record<string, unknown> | null;
    const keeps = float?.wrap === "behind" || float?.wrap === "inFront";
    return {
      ...(float ?? {
        side: "bothSides",
        distance: DISTANCE,
        allowOverlap: true,
        layoutInCell: true,
      }),
      wrap: keeps ? float?.wrap : "square",
      horizontal: { relativeTo: "margin", align: h },
      vertical: { relativeTo: "margin", align: v },
    };
  });
}

/** The preset the object at `node` is at, if any. */
export function objectPosition(node: Node): ObjectPosition | null {
  const float = node.attrs.float as { horizontal?: ObjectAxis; vertical?: ObjectAxis } | null;
  if (!float) return null;
  for (const [key, [h, v]] of Object.entries(OBJECT_POSITIONS))
    if (
      float.horizontal?.relativeTo === "margin" &&
      float.horizontal.align === h &&
      float.vertical?.relativeTo === "margin" &&
      float.vertical.align === v
    )
      return key as ObjectPosition;
  return null;
}
