import { Plugin } from "@folijs/core";
import { insertMention } from "./mention.js";

const openSearch = () => document.querySelector<HTMLInputElement>("#acme-search")?.focus();

export const keys = new Plugin({
  keymap: {
    // A key of the app's own: Ctrl+Shift+M (Cmd+Shift+M on a Mac). Where the command returns
    // false (no text block at the selection), the key goes on to the next binding.
    "Mod-Shift-m": insertMention("u-42", "Ada Lovelace"),
    // A built-in key taken over: Ctrl+F opens the app's search instead of Foli's find panel.
    "Mod-f": () => {
      openSearch();
      return true;
    },
  },
});
