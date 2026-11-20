import type { Command } from "@folijs/core";
import type { ViewExtension } from "@folijs/view";

const items = (value: unknown) =>
  Array.isArray(value) && value.length <= 12 && value.every((v) => typeof v === "string")
    ? undefined
    : "must be at most 12 strings";

export const card: ViewExtension = {
  name: "acme-card",
  nodes: {
    // No `inline`: a block leaf, a paragraph's sibling.
    "acme:card": {
      attrs: {
        title: { validate: (v) => (typeof v === "string" ? undefined : "a string") },
        items: { validate: items },
      },
      text: (attrs) => `${attrs.title}: ${(attrs.items as string[]).join(", ")}`,
    },
  },
  nodeViews: {
    "acme:card": {
      // Each child of the root is a line: a card taller than the room left on a page splits
      // between them. `split: false` would move it whole to the next page instead.
      render: (node, { h }) =>
        h(
          "div",
          { class: "acme-card", role: "group", "aria-label": String(node.attrs.title) },
          h("div", { class: "acme-card-title" }, String(node.attrs.title)),
          ...(node.attrs.items as string[]).map((item) =>
            h("div", { class: "acme-card-item" }, item),
          ),
        ),
    },
  },
};

/** Inserts a card after the top-level block the selection starts in. */
export const insertCard =
  (title: string, list: string[]): Command =>
  (state, dispatch) => {
    const type = state.schema.nodes["acme:card"];
    const { $from } = state.selection;
    if (!type || $from.depth < 1) return false;
    dispatch?.(state.tr.insert($from.after(1), type.create({ title, items: list })));
    return true;
  };
