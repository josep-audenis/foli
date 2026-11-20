import { createDocument, insertText, type Node, Plugin, PluginKey } from "@folijs/core";
import { defaultToolbarItems, FoliEditor, type ToolbarButton } from "@folijs/react";
import type { Decoration, ViewExtension } from "@folijs/view";
import "@folijs/react/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

declare module "@folijs/core" {
  interface FoliCommands {
    /** Inserts "TODO " at the selection (this example's command). */
    insertTodo(): boolean;
  }
}

const insertTodo = () => insertText("TODO ");

/** Every "TODO" in the text. */
const todos = (doc: Node): Decoration[] => {
  const found: Decoration[] = [];
  doc.descendants((node, pos) => {
    for (const match of node.text?.matchAll(/TODO/g) ?? [])
      found.push({
        from: pos + match.index,
        to: pos + match.index + 4,
        attrs: { class: "example-todo" },
      });
  });
  return found;
};

const todoKey = new PluginKey<Decoration[]>("todo");

const todo: ViewExtension = {
  name: "todo",
  plugins: [
    new Plugin<Decoration[]>({
      key: todoKey,
      commands: { insertTodo },
      keymap: { "Mod-Shift-o": insertTodo() },
      // Found again only when the document changes, not on every caret move.
      state: {
        init: (state) => todos(state.doc),
        apply: (tr, value) => (tr.docChanged ? todos(tr.doc) : value),
      },
    }),
  ],
  decorations: (state) => todoKey.getState(state) ?? [],
};

const button: ToolbarButton = { key: "todo", label: "Insert TODO", command: insertTodo() };

const initial = createDocument({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "TODO check the figures in section 2." }],
    },
    { type: "paragraph", content: [{ type: "text", text: "The rest is done." }] },
  ],
});

createRoot(document.getElementById("example") as HTMLElement).render(
  <StrictMode>
    <FoliEditor
      initialContent={initial}
      extensions={[todo]}
      toolbar={[...defaultToolbarItems, [button]]}
      label="Example document"
    />
  </StrictMode>,
);
