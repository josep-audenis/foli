/**
 * What an app adds at runtime around the spec: a plugin with commands and keys, and how the
 * node and mark are drawn. `__foliSpikeViews` is the spike's stand-in for 12.4's node views and
 * mark views (see vite.config.ts).
 */
import { type Command, Fragment, Plugin, PluginKey, Slice, toggleMark } from "@folijs/core";
import { MENTION, mentionText, TOPIC } from "./spec.js";

/** Inserts a mention at the selection (with the stored marks, if any). */
export const insertMention =
  (id: string, label: string): Command =>
  (state, dispatch) => {
    const type = state.schema.nodes[MENTION];
    if (!type || !state.selection.$from.parent.isTextblock) return false;
    const node = type.create({ id, label }, null, state.storedMarks ?? []);
    dispatch?.(state.tr.replaceSelection(new Slice(Fragment.from(node), 0, 0)));
    return true;
  };

export const toggleTopic = (topic: string): Command => toggleMark(TOPIC, { topic });

/** User plugins run before the built-ins: these keys win over any built-in binding. */
export const extensionPlugin = new Plugin({
  key: new PluginKey("acme"),
  keymap: {
    "Mod-Shift-m": insertMention("u-42", "Ada Lovelace"),
    "Mod-Shift-k": toggleTopic("finance"),
  },
});

declare global {
  var __foliSpikeViews: {
    nodes: Record<string, (attrs: Record<string, unknown>, dom: HTMLElement) => void>;
    marks: Record<string, (attrs: Record<string, unknown>, dom: HTMLElement) => void>;
  };
}

export function installViews(): void {
  globalThis.__foliSpikeViews = {
    nodes: {
      [MENTION]: (attrs, dom) => {
        dom.textContent = mentionText(attrs);
        dom.dataset.mention = String(attrs.id);
        dom.style.background = "#dbeafe";
        dom.style.borderRadius = "0.6em";
        dom.style.padding = "0 0.3em";
      },
    },
    marks: {
      [TOPIC]: (attrs, dom) => {
        dom.dataset.topic = String(attrs.topic);
        dom.style.textDecoration = "underline dotted #2563eb";
      },
    },
  };
}
