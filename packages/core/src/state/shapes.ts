/**
 * Shapes (Phase 34, ADR-0017): Insert ▸ Shapes. A new shape is a `shape` node floating in front
 * of the text, placed from its paragraph and column, filled and lined as Word's default style
 * draws one (the theme's first accent), selected.
 */

import { closeHistory } from "./history.js";
import { NodeSelection, Selection } from "./selection.js";
import type { Command } from "./state.js";
import { storyBody, wordContext } from "./word.js";

/** Lines Word draws without a fill, from corner to corner. */
const LINES = new Set(["line", "straightConnector1", "bentConnector3", "curvedConnector3"]);

/** What `insertShape` makes. */
export interface InsertShapeOptions {
  /** In EMU (default an inch square: Word's size for a click without dragging). */
  width?: number;
  height?: number;
  /** From its paragraph's column (`horizontal`) and top (`vertical`), in EMU (default 0). */
  horizontal?: number;
  vertical?: number;
  /** A line drawn right to left or bottom to top: mirrored (a line goes from corner to corner). */
  flipH?: boolean;
  flipV?: boolean;
  /** Where its anchor goes (a paragraph's inline position; default: the selection's end). */
  pos?: number;
}

const INCH = 914_400;

/** `hex` darkened to `factor` of each channel (DrawingML's `a:shade`, sRGB). */
const shade = (hex: string, factor: number) =>
  [0, 2, 4]
    .map((i) =>
      Math.floor(Number.parseInt(hex.slice(i, i + 2), 16) * factor)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase();

/**
 * Inserts a shape of DrawingML preset `geometry` (Insert ▸ Shapes, 34.3): floating in front of
 * the text, placed from its paragraph's column and top, filled with the theme's first accent and
 * lined with its dark shade (a line: the accent, 0.5 pt; an arrow with its end), one undo step.
 * Selects it. Not in a story (shortcut: Word also puts shapes in headers; as `insertTextBox`).
 */
export function insertShape(geometry: string, options: InsertShapeOptions = {}): Command {
  return (state, dispatch) => {
    if (!wordContext(state) || storyBody(state)) return false;
    const pos = options.pos ?? state.selection.to;
    if (pos < 0 || pos > state.doc.content.size) return false;
    // Not in a paragraph (a cell selection's end): the nearest one.
    const $at = state.doc.resolve(pos);
    const $pos = $at.parent.inlineContent ? $at : Selection.near($at).$to;
    if (!$pos.parent.inlineContent) return false;
    const width = Math.max(0, Math.round(options.width ?? INCH));
    const height = Math.max(0, Math.round(options.height ?? INCH));
    const accent = wordContext(state)?.envelope.theme?.colors?.accent1 ?? "156082";
    const line = LINES.has(geometry);
    let node: ReturnType<typeof state.schema.node>;
    try {
      node = state.schema.node("shape", {
        geometry,
        width,
        height,
        float: {
          horizontal: { relativeTo: "column", offset: Math.round(options.horizontal ?? 0) },
          vertical: { relativeTo: "paragraph", offset: Math.round(options.vertical ?? 0) },
          wrap: "inFront",
          distance: { top: 0, bottom: 0, left: 114_300, right: 114_300 },
        },
        ...(options.flipH ? { flipH: true } : {}),
        ...(options.flipV ? { flipV: true } : {}),
        fill: line ? null : accent,
        outline: line
          ? {
              color: accent,
              width: 6350,
              ...(geometry === "straightConnector1" ? { tail: { type: "triangle" } } : {}),
            }
          : { color: shade(accent, 0.15), width: 12_700 },
      });
      node.check();
    } catch {
      return false;
    }
    if (!dispatch) return true;
    const tr = state.tr.setMeta(closeHistory, true);
    tr.insert($pos.pos, node);
    tr.setSelection(NodeSelection.create(tr.doc, $pos.pos));
    dispatch(tr);
    return true;
  };
}
