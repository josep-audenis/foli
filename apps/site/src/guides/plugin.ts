import { type Command, type EditorState, type Node, Plugin, PluginKey } from "@folijs/core";
import type { Decoration, ViewExtension } from "@folijs/view";

/** Every "TODO" in the text, as decorations. */
function todos(doc: Node): Decoration[] {
  const found: Decoration[] = [];
  doc.descendants((node, pos) => {
    for (const match of node.text?.matchAll(/TODO/g) ?? [])
      found.push({
        from: pos + match.index,
        to: pos + match.index + 4,
        attrs: { class: "acme-todo" },
      });
  });
  return found;
}

const todoKey = new PluginKey<Decoration[]>("acme-todo");

/** State: the decorations, found again only when the document changes. */
export const todo = new Plugin<Decoration[]>({
  key: todoKey,
  state: {
    init: (state) => todos(state.doc),
    apply: (tr, value) => (tr.docChanged ? todos(tr.doc) : value),
  },
});

/** A follow-up transaction: "(c)" typed before the caret becomes "©". */
export const copyright = new Plugin({
  appendTransaction(transactions, _before, state) {
    if (!transactions.some((tr) => tr.docChanged)) return null;
    const { $head, empty } = state.selection;
    if (!empty || !$head.parent.isTextblock || $head.parentOffset < 3) return null;
    const typed = $head.parent.textBetween($head.parentOffset - 3, $head.parentOffset);
    return typed === "(c)" ? state.tr.insertText("©", $head.pos - 3, $head.pos) : null;
  },
});

const lockKey = new PluginKey<boolean>("acme-lock");

/** A filter: while locked, every change to the document is dropped (the selection still moves). */
export const lock = new Plugin<boolean>({
  key: lockKey,
  state: {
    init: () => false,
    apply: (tr, locked) => (tr.getMeta(lockKey) as boolean | undefined) ?? locked,
  },
  filterTransaction: (tr, state) => !tr.docChanged || !lockKey.getState(state),
});

/** Locks or unlocks the document: a transaction carrying only metadata. */
export const setLocked =
  (locked: boolean): Command =>
  (state, dispatch) => {
    dispatch?.(state.tr.setMeta(lockKey, locked));
    return true;
  };

const words = (state: EditorState) => state.doc.textContent.split(/\s+/).filter(Boolean).length;

export const review: ViewExtension = {
  name: "acme-review",
  plugins: [todo, copyright, lock],
  // Asked after every transaction: read what the plugin state already holds.
  decorations: (state) => todoKey.getState(state) ?? [],
  // A plugin view: made with each EditorView of the editor, told of its updates, destroyed with it.
  view(view) {
    const status = view.host.ownerDocument.createElement("p");
    status.setAttribute("role", "status");
    const show = () => {
      status.textContent = `${words(view.editor.state)} words`;
    };
    show();
    view.host.before(status);
    return { update: show, destroy: () => status.remove() };
  },
};
