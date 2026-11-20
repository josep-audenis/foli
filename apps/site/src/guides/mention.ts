import { type Command, closeHistory, Fragment, Slice } from "@folijs/core";
import type { ViewExtension } from "@folijs/view";

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
