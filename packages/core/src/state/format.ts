import { type Alignment, isColor } from "../schema.js";
import type { Command, EditorState } from "./state.js";
import {
  setWordAlign,
  setWordHighlight,
  setWordTextColor,
  wordAlignAt,
  wordHighlightAt,
  wordTextColorAt,
} from "./wordformat.js";

/** The alignment all selected paragraphs show, or null (mixed, or no paragraph). */
export const alignAt: (state: EditorState) => Alignment | null = wordAlignAt;

/** Aligns the selected paragraphs (`start` is the default). */
export const setAlign: (align: Alignment) => Command = setWordAlign;

/** Colors are lowercase `#rrggbb` (an uppercase one is lowered); others do not apply. */
const colored =
  (set: (color: string | null) => Command) =>
  (color: string | null): Command => {
    const value = color?.toLowerCase() ?? null;
    return value !== null && !isColor(value) ? () => false : set(value);
  };

/** Text color (`#rrggbb`) for the selected or next typed text; `null` is Word's Automatic. */
export const setTextColor = colored(setWordTextColor);

/** Highlight (`#rrggbb`) for the selected or next typed text; `null` removes it. */
export const setHighlight = colored(setWordHighlight);

/** The text color or highlight all selected text shows (at a caret, typing's), or null. */
export function colorAt(state: EditorState, name: "textColor" | "highlight"): string | null {
  return name === "highlight" ? wordHighlightAt(state) : wordTextColorAt(state);
}
