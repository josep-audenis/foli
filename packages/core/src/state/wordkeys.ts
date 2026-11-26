import { toggleList } from "./lists.js";
import { Plugin } from "./state.js";
import { changeCase, copyFormat, pasteFormat, toggleFormattingMarks } from "./wordformat.js";

/**
 * Word's own meaning for keys Foli gives to something else by default (docs/keyboard.md): add it
 * to `createEditor`'s plugins for an editor that behaves as Word. Shift+F3 changes case (not
 * find's previous result), Ctrl+Shift+L is the bulleted list, Ctrl+Shift+C copies formatting and
 * Ctrl+Shift+V pastes it while some is copied (else the key goes on to the plain-text paste),
 * Ctrl+Shift+8 shows or hides formatting marks.
 */
export function wordKeymap(): Plugin {
  return new Plugin({
    keymap: {
      "Shift-F3": changeCase("cycle"),
      "Mod-Shift-l": toggleList("bulletList"),
      "Mod-Shift-c": copyFormat(),
      "Mod-Shift-v": pasteFormat,
      // Ctrl+* on a US keyboard; the numbered list keeps Ctrl+Shift+7.
      "Mod-Shift-8": toggleFormattingMarks,
    },
  });
}
