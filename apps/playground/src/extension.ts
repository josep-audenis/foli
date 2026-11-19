/**
 * Custom nodes and marks (`/extension.html`, dev server only, 12.3): an app's extension declares
 * `acme:mention` (an inline leaf), `acme:card` (a block leaf) and `acme:topic` (a mark), with keys
 * to insert a mention (Ctrl+Shift+M) and toggle the topic (Ctrl+Shift+K). `?extension=0` loads the
 * editor without it: the same content is then foreign. Driven by `e2e/extension.spec.ts`.
 */
import {
  type Command,
  createEditor,
  type Extension,
  type FoliDocument,
  Fragment,
  Plugin,
  PluginKey,
  Slice,
  toggleMark,
} from "@folijs/core";
import { exportDocx, importDocx } from "@folijs/docx";
import { EditorView } from "@folijs/view";

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

const acme: Extension = {
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
  ],
};

const extensions = new URLSearchParams(location.search).get("extension") === "0" ? [] : [acme];
const host = document.getElementById("editor") as HTMLElement;
const editor = createEditor({ extensions });
new EditorView(host, editor);

/** What the e2e tests drive: save and load as JSON, and through `.docx`. */
const page = {
  save: (): FoliDocument => editor.getDocument(),
  load: (document: FoliDocument) => editor.setDocument(document),
  toDocx: async (): Promise<number[]> =>
    Array.from(await exportDocx(editor.getDocument(), undefined, { extensions })),
  fromDocx: async (bytes: number[]): Promise<void> =>
    editor.setDocument((await importDocx(new Uint8Array(bytes))).document),
};
Object.assign(window, { __extension: page });
export type ExtensionPage = typeof page;
