/**
 * Shapes (Phase 34, ADR-0017): Insert ▸ Shapes. A new shape is a `shape` node floating in front
 * of the text, placed from its paragraph and column, filled and lined as Word's default style
 * draws one (the theme's first accent), selected.
 */

import { parseContent } from "../v3/document.js";
import { attempt } from "./attempt.js";
import { closeHistory } from "./history.js";
import { NodeSelection, Selection } from "./selection.js";
import type { Command, EditorState } from "./state.js";
import { freshTextBoxId } from "./textboxes.js";
import { trackState } from "./track.js";
import { StoryStep, storyBody, wordContext } from "./word.js";

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

/** The shape at `pos`, or null. */
const shapeAt = (state: EditorState, pos: number) => {
  const node = pos >= 0 && pos < state.doc.content.size ? state.doc.nodeAt(pos) : null;
  return node?.type.name === "shape" ? node : null;
};

/**
 * Sets adjust values of the shape at `pos` (34.4: its yellow handles; `{ adj: 25000 }`, merged
 * with those it has), one undo step, kept selected. Not while tracking.
 */
export function setShapeAdjust(pos: number, adjust: Readonly<Record<string, number>>): Command {
  return (state, dispatch) => {
    const node = shapeAt(state, pos);
    if (!node || trackState(state)?.on === true) return false;
    const now = (node.attrs.adjust ?? {}) as Record<string, number>;
    const next = { ...now };
    for (const [name, value] of Object.entries(adjust))
      if (Number.isFinite(value)) next[name] = Math.round(value);
    if (Object.entries(next).every(([name, value]) => now[name] === value)) return false;
    return attempt(state, dispatch, (tr) => {
      tr.setMeta(closeHistory, true);
      tr.setNodeMarkup(pos, node.type, { ...node.attrs, adjust: next });
      if (state.selection instanceof NodeSelection && state.selection.from === pos)
        tr.setSelection(NodeSelection.create(tr.doc, pos));
    });
  };
}

/**
 * Gives the shape at `pos` text (34.4: typing on a selected shape, as Word does): a story of kind
 * `textBox` with an empty paragraph, the text centered in the shape as Word's new shapes have it,
 * white on its fill (black without one). One undo step; false when it has text, is a line, is in
 * a story, or while tracking.
 */
export function addShapeText(pos: number): Command {
  return (state, dispatch) => {
    const node = shapeAt(state, pos);
    if (
      !node ||
      node.attrs.story ||
      LINES.has(String(node.attrs.geometry)) ||
      storyBody(state) ||
      trackState(state)?.on === true
    )
      return false;
    if (!dispatch) return true;
    const id = freshTextBoxId(state);
    const tr = state.tr.setMeta(closeHistory, true);
    tr.setNodeMarkup(pos, node.type, {
      ...node.attrs,
      story: id,
      verticalAlign: node.attrs.verticalAlign ?? "center",
      // Light on its fill, as Word's style has it; dark on none.
      textColor: node.attrs.textColor ?? (node.attrs.fill ? "FFFFFF" : "000000"),
    });
    if (state.selection instanceof NodeSelection && state.selection.from === pos)
      tr.setSelection(NodeSelection.create(tr.doc, pos));
    tr.step(
      new StoryStep(id, null, {
        kind: "textBox",
        doc: parseContent(
          {
            type: "doc",
            content: [{ type: "paragraph", attrs: { justification: "center" } }],
          },
          { schema: state.schema },
        ),
      }),
    );
    dispatch(tr);
    return true;
  };
}

/** What `setShapeLook` sets of a shape or a text box; what is left out stays. */
export interface ShapeLook {
  /** RRGGBB, or null for no fill (a gradient goes). */
  fill?: string | null;
  /**
   * The line: null for none, else what changes of it (a line made where there was none is
   * black, ¾ pt, unless said). A text box's line has a color and a width only.
   */
  outline?: {
    color?: string;
    width?: number;
    dash?: string | null;
    head?: { type: string; width?: string; length?: string } | null;
    tail?: { type: string; width?: string; length?: string } | null;
  } | null;
  /** A shape's text color where its text sets none (a style's). */
  textColor?: string | null;
}

/**
 * Sets the fill, line and text color of the shape or text box at `pos` (34.5: Shape Format's
 * Shape Fill, Shape Outline and Shape Styles), one undo step, kept selected. Not while tracking
 * (Word records no change of a shape's look).
 */
export function setShapeLook(pos: number, look: ShapeLook): Command {
  return (state, dispatch) => {
    const node = pos >= 0 && pos < state.doc.content.size ? state.doc.nodeAt(pos) : null;
    const name = node?.type.name;
    if (!node || (name !== "shape" && name !== "textBox") || trackState(state)?.on === true)
      return false;
    const attrs: Record<string, unknown> = { ...node.attrs };
    if (look.fill !== undefined) {
      attrs.fill = look.fill;
      if (name === "shape") attrs.gradient = null;
    }
    if (look.outline !== undefined) {
      if (look.outline === null) attrs.outline = null;
      else {
        const was = (node.attrs.outline ?? { color: "000000", width: 9525 }) as Record<
          string,
          unknown
        >;
        const next: Record<string, unknown> = { ...was };
        for (const [key, value] of Object.entries(look.outline)) {
          if (value === null) delete next[key];
          else if (value !== undefined) next[key] = value;
        }
        attrs.outline = name === "textBox" ? { color: next.color, width: next.width } : next;
      }
    }
    if (look.textColor !== undefined && name === "shape") attrs.textColor = look.textColor;
    if (JSON.stringify(attrs) === JSON.stringify(node.attrs)) return false;
    return attempt(state, dispatch, (tr) => {
      tr.setMeta(closeHistory, true);
      tr.setNodeMarkup(pos, node.type, attrs);
      if (state.selection instanceof NodeSelection && state.selection.from === pos)
        tr.setSelection(NodeSelection.create(tr.doc, pos));
    });
  };
}
