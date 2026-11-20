import { type Command, createDocument, Fragment, Slice } from "@folijs/core";
import { defaultToolbarItems, FoliEditor, type ToolbarButton } from "@folijs/react";
import type { ViewExtension } from "@folijs/view";
import "@folijs/react/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

/** Inserts a mention of user `id` at the selection, with the marks typing would get. */
const insertMention =
  (id: string, label: string): Command =>
  (state, dispatch) => {
    const type = state.schema.nodes["acme:mention"];
    if (!type || !state.selection.$from.parent.isTextblock) return false;
    const node = type.create({ id, label }, null, state.storedMarks ?? []);
    dispatch?.(state.tr.replaceSelection(new Slice(Fragment.from(node), 0, 0)));
    return true;
  };

const acme: ViewExtension = {
  name: "acme",
  nodes: {
    "acme:mention": {
      inline: true,
      attrs: {
        // Attributes come from documents and pastes: validate them.
        id: {
          validate: (v) => (typeof v === "string" && /^[\w-]{1,64}$/.test(v) ? undefined : "an id"),
        },
        label: { validate: (v) => (typeof v === "string" ? undefined : "a string") },
      },
      // What the node is as text: copied as plain text, and drawn so without the node view.
      text: (attrs) => `@${String(attrs.label)}`,
    },
  },
  nodeViews: {
    "acme:mention": {
      render: (node, { h }) =>
        h(
          "span",
          { class: "example-chip", title: `User ${node.attrs.id}` },
          `@${node.attrs.label}`,
        ),
    },
  },
};

const mention: ToolbarButton = {
  key: "mention",
  label: "Insert mention",
  command: insertMention("u-42", "Ada Lovelace"),
};

const initial = createDocument({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Ask " },
        { type: "acme:mention", attrs: { id: "u-7", label: "Grace Hopper" } },
        { type: "text", text: " about the schedule." },
      ],
    },
  ],
});

createRoot(document.getElementById("example") as HTMLElement).render(
  <StrictMode>
    <FoliEditor
      initialContent={initial}
      extensions={[acme]}
      toolbar={[...defaultToolbarItems, [mention]]}
      label="Example document"
    />
  </StrictMode>,
);
