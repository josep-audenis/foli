/**
 * Custom nodes and marks (`/extension.html`, dev server only, 12.3 and 12.4): an app's extension
 * declares `acme:mention` (an inline leaf), `acme:card` (a block leaf) and `acme:topic` (a mark),
 * with keys to insert a mention (Ctrl+Shift+M) and toggle the topic (Ctrl+Shift+K); its view hooks
 * draw the mention as a chip and the card as a list of rows (split across pages), style the topic,
 * decorate every "TODO" and the paragraph holding the caret, and keep a word count beside the
 * editor (a plugin view). `?extension=0` loads the editor without it: the same content is then
 * foreign. Driven by `e2e/extension.spec.ts`.
 */
import {
  type Command,
  createEditor,
  type EditorState,
  type FoliDocument,
  Fragment,
  type Node,
  Plugin,
  PluginKey,
  parseDocument,
  Slice,
  toggleMark,
} from "@folijs/core";
import { exportDocx, importDocx } from "@folijs/docx";
import { type Decoration, EditorView, type ViewExtension } from "@folijs/view";

const id = (value: unknown) =>
  typeof value === "string" && /^[\w-]{1,64}$/.test(value) ? undefined : "must be an id";

/** Inserts a mention at the selection, with the marks typing would get. */
const insertMention =
  (mentionId: string, label: string): Command =>
  (state, dispatch) => {
    const type = state.schema.nodes["acme:mention"];
    if (!type || !state.selection.$from.parent.isTextblock) return false;
    const node = type.create({ id: mentionId, label }, null, state.storedMarks ?? []);
    dispatch?.(state.tr.replaceSelection(new Slice(Fragment.from(node), 0, 0)));
    return true;
  };

/** Every "TODO" in the text, found again only when the document changes. */
const todoKey = new PluginKey<Decoration[]>("acme-todo");
const todos = (doc: Node): Decoration[] => {
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
};

/** What the plugin view saw, for the tests. */
const lifecycle = { mounted: 0, updates: 0, destroyed: 0 };
const words = (state: EditorState) => state.doc.textContent.split(/\s+/).filter(Boolean).length;

const acme: ViewExtension = {
  name: "acme",
  nodes: {
    "acme:mention": {
      inline: true,
      attrs: {
        id: { validate: id },
        label: { validate: (v) => (typeof v === "string" ? undefined : "label") },
      },
      text: (attrs) => `@${String(attrs.label)}`,
    },
    "acme:card": { attrs: { id: { validate: id } }, text: (attrs) => `Card ${String(attrs.id)}` },
  },
  marks: { "acme:topic": { attrs: { topic: { validate: id } }, inclusive: false } },
  plugins: [
    new Plugin({
      key: new PluginKey("acme"),
      keymap: {
        "Mod-Shift-m": insertMention("u-42", "Ada Lovelace"),
        "Mod-Shift-k": toggleMark("acme:topic", { topic: "finance" }),
      },
    }),
    new Plugin<Decoration[]>({
      key: todoKey,
      state: {
        init: (state) => todos(state.doc),
        apply: (tr, value) => (tr.docChanged ? todos(tr.doc) : value),
      },
    }),
  ],
  nodeViews: {
    "acme:mention": {
      render: (node, { h }) =>
        h("span", { class: "acme-chip", title: `User ${node.attrs.id}` }, `@${node.attrs.label}`),
    },
    "acme:card": {
      // Twelve rows: taller than what is left at the foot of a page, it splits between them.
      render: (node, { h }) =>
        h(
          "div",
          { class: "acme-card", role: "group", "aria-label": `Card ${node.attrs.id}` },
          ...Array.from({ length: 12 }, (_, i) =>
            h("div", { class: "acme-card-row" }, `Card ${node.attrs.id}, row ${i + 1}`),
          ),
        ),
    },
  },
  markViews: {
    "acme:topic": (mark) => ({ class: "acme-topic", title: `Topic: ${mark.attrs.topic}` }),
  },
  decorations(state) {
    const { $head } = state.selection;
    const current: Decoration[] = $head.depth
      ? [
          {
            from: $head.before(1),
            to: $head.after(1),
            node: true,
            attrs: { class: "acme-current" },
          },
        ]
      : [];
    return [...(todoKey.getState(state) ?? []), ...current];
  },
  view(view) {
    lifecycle.mounted++;
    const status = document.createElement("p");
    status.id = "acme-status";
    status.setAttribute("role", "status");
    const show = () => {
      status.textContent = `${words(view.editor.state)} words`;
    };
    show();
    view.host.before(status);
    return {
      update() {
        lifecycle.updates++;
        show();
      },
      destroy() {
        lifecycle.destroyed++;
        status.remove();
      },
    };
  },
};

const extensions = new URLSearchParams(location.search).get("extension") === "0" ? [] : [acme];
const host = document.getElementById("editor") as HTMLElement;
host.setAttribute("aria-label", "Document");
const editor = createEditor({ extensions });
const view = new EditorView(host, editor);

/** What the e2e tests drive: save and load as JSON, and through `.docx`. */
const page = {
  save: (): FoliDocument => editor.getDocument(),
  load: (document: FoliDocument) => editor.setDocument(document),
  toDocx: async (): Promise<number[]> =>
    Array.from(await exportDocx(editor.getDocument(), undefined, { extensions })),
  fromDocx: async (bytes: number[]): Promise<void> =>
    editor.setDocument((await importDocx(new Uint8Array(bytes))).document),
  /** Throws when the document is not valid (as loading it again would). */
  check: () => void parseDocument(editor.getDocument(), { extensions }),
  selection: () => ({ anchor: editor.state.selection.anchor, head: editor.state.selection.head }),
  lifecycle,
  destroy: () => view.destroy(),
};
Object.assign(window, { __extension: page });
export type ExtensionPage = typeof page;
