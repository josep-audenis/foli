import { type Command, type EditorState, Plugin } from "./state.js";
import {
  endWordList,
  type ListKind,
  liftWordList,
  removeWordListNumber,
  sinkWordList,
  toggleWordList,
  wordListKindAt,
  wrapInWordList,
} from "./wordformat.js";

/** The kind of list all selected paragraphs are in ("bulletList", "orderedList"), or null. */
export const listKindAt: (state: EditorState) => ListKind | null = wordListKindAt;

/** Numbers the selected paragraphs as a list of `kind` (one right before goes on). */
export const wrapInList: (kind: ListKind) => Command = wrapInWordList;

/** The list buttons: removes the selection's numbering when it is a list of `kind`, else numbers it. */
export const toggleList: (kind: ListKind) => Command = toggleWordList;

/** Enter in an empty numbered paragraph: one level up, or at the top level ends the list. */
export const splitListItem: Command = endWordList;

/** Tab at the start of a numbered paragraph, or over several paragraphs: one level deeper. */
export const sinkListItem: Command = sinkWordList;

/** Shift+Tab in a list: one level up (out of the list at the top). */
export const liftListItem: Command = liftWordList;

/** Backspace at the start of a numbered paragraph: removes its number, keeping the text in place. */
export const liftListItemAtStart: Command = removeWordListNumber;

/**
 * The list key bindings, as Word's: Enter and Backspace in a numbered paragraph, Tab and
 * Shift+Tab for levels (elsewhere Tab types a tab), Mod-Shift-7 / Mod-Shift-8 toggle a
 * numbered / bulleted list.
 */
export function listKeymap(): Plugin {
  return new Plugin({
    keymap: {
      Enter: splitListItem,
      Backspace: liftListItemAtStart,
      Tab: sinkListItem,
      "Shift-Tab": liftListItem,
      "Mod-Shift-7": toggleList("orderedList"),
      "Mod-Shift-8": toggleList("bulletList"),
    },
  });
}
