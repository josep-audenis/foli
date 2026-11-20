// The app's extension, defined outside the packages with their public API only: a mention (a
// custom inline node), a topic (a custom mark), and a plugin with a command, a key and
// decorations. The same list goes to the editor and to `exportDocx`.
import {
  type Command,
  closeHistory,
  Fragment,
  type Node,
  Plugin,
  PluginKey,
  Slice,
  toggleMark,
} from "@folijs/core";
import type { Decoration, ViewExtension } from "@folijs/view";

declare module "@folijs/core" {
  interface FoliCommands {
    insertMention(id: string, name: string): boolean;
  }
}

// Attributes come from documents, pastes and .docx files: validate every one.
const userId = (value: unknown) =>
  typeof value === "string" && /^[\w-]{1,64}$/.test(value) ? undefined : "must be a user id";
const label = (value: unknown) =>
  typeof value === "string" && value.length <= 80 ? undefined : "must be a short string";

export const mention: ViewExtension = {
  name: "acme-mention",
  nodes: {
    "acme:mention": {
      inline: true,
      attrs: { id: { validate: userId }, label: { validate: label } },
      // The text it stands for: plain text copies, find, .docx, and the view without a node view.
      text: (attrs) => `@${String(attrs.label)}`,
    },
  },
  nodeViews: {
    "acme:mention": {
      render: (node, { h }) =>
        h(
          "span",
          { class: "acme-mention", title: `User ${node.attrs.id}` },
          `@${node.attrs.label}`,
        ),
    },
  },
};

/** Inserts a mention at the selection, with the stored marks (bold after Ctrl+B, say). */
export const insertMention =
  (id: string, name: string): Command =>
  (state, dispatch) => {
    const type = state.schema.nodes["acme:mention"];
    if (!type || !state.selection.$from.parent.isTextblock) return false;
    const node = type.create({ id, label: name }, null, state.storedMarks ?? []);
    // An undo step of its own, not merged with the typing around it.
    const tr = state.tr.replaceSelection(new Slice(Fragment.from(node), 0, 0));
    dispatch?.(tr.setMeta(closeHistory, true));
    return true;
  };

export const topic: ViewExtension = {
  name: "acme-topic",
  marks: {
    "acme:topic": {
      attrs: {
        topic: {
          validate: (v) =>
            typeof v === "string" && /^[a-z-]{1,32}$/.test(v) ? undefined : "must be a topic",
        },
      },
      // Text typed at the end of a marked run does not get the mark.
      inclusive: false,
    },
  },
  markViews: {
    "acme:topic": (mark) => ({ class: "acme-topic", title: `Topic: ${mark.attrs.topic}` }),
  },
};

/** Adds the topic to the selected text, or removes it. */
export const toggleTopic = (name: string): Command => toggleMark("acme:topic", { topic: name });

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

export const tools: ViewExtension = {
  name: "acme-tools",
  plugins: [
    new Plugin<Decoration[]>({
      key: todoKey,
      // `editor.commands.insertMention(id, name)`, typed by the `FoliCommands` augmentation.
      commands: { insertMention },
      // Ctrl+Shift+M (Cmd+Shift+M on a Mac).
      keymap: { "Mod-Shift-m": insertMention("u-42", "Ada Lovelace") },
      // Found again only when the document changes, not on every caret move.
      state: {
        init: (state) => todos(state.doc),
        apply: (tr, value) => (tr.docChanged ? todos(tr.doc) : value),
      },
    }),
  ],
  decorations: (state) => todoKey.getState(state) ?? [],
};

export const acme: readonly ViewExtension[] = [mention, topic, tools];
