# Extensions

How an app adds its own content and behaviour to Foli: a custom inline node, a custom mark, a
custom block node, a plugin, commands, keys and toolbar items. The rules behind it are in
[ADR-0008](../decisions/ADR-0008-1.0-contract-and-extensions.md); every name is in the
[API reference](../api.md#custom-nodes-and-marks).

The samples build one extension set, `acme`, step by step. They are the files of
[`apps/site/src/guides/`](../../apps/site/src/guides/), typechecked with the docs site and
run by its tests, so they compile against the current API. The site's
[custom node](../../apps/site/src/examples/custom-node.md) and
[plugin](../../apps/site/src/examples/plugin.md) examples run similar code live, and
[`examples/extension`](../../examples/extension) is an app doing it from the published packages
(a mention, a topic mark, a plugin's command, key and decorations, toolbar items, `.docx` both
ways).

## What an extension is

An `Extension` (`@folijs/core`) is `{ name, nodes?, marks?, plugins? }`. A `ViewExtension`
(`@folijs/view`) adds how the view draws them: `nodeViews`, `markViews`, `decorations` and
`view`. Give the same list everywhere a document is read or written:

- `createEditor({ extensions })`, or the `extensions` prop of `FoliEditor` and `useFoliEditor`;
- `parseDocument(json, { extensions })` and `parseContent(json, { extensions })`;
- `exportDocx(document, package, { extensions })`.

An editor reads the list once, when it is made. React compares it element by element and warns
in development when it changes; give `FoliEditor` a new `key` to use another list. Keep the list
in a module constant.

Custom types are added to Word's schema; they never replace it. In 1.x a type is an inline leaf,
a block leaf or a mark: no custom containers. Names have a namespace, `<namespace>:<name>`
(lowercase letters, digits and `-`): `acme:mention`. A name without one, or declared twice, makes
`createEditor` throw a `RangeError`. Custom types never change `SCHEMA_VERSION`.

## A custom inline node

`acme:mention` is a mention of a user, drawn as a chip. It is one caret position, selected and
deleted whole, and undone, copied, pasted and saved like Word's own content.

```ts
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
```

- `attrs` are as in `NodeSpec`: `validate` returns an error message or `undefined`; an attribute
  without `default` is required. `parseDocument` refuses a document whose attributes fail, with
  a `FoliDocumentError` naming the place.
- `text(attrs)` is required. It is the node in plain text, what find matches (one position:
  replace leaves it alone), its text in `.docx`, and how the view draws it without a node view.
- A command is `(state, dispatch?) => boolean`. Without `dispatch` it is a dry run: the toolbar
  and `editor.can` call it so. Use `state.schema`, never a schema of your own: the editor's schema
  is Word's plus the extensions'. Typing within half a second of a change joins its undo step;
  the `closeHistory` meta makes the insertion an undo step of its own.
- The view puts what `render` returns in an element with `data-foli-custom="acme:mention"` and
  `contenteditable="false"`. An inline node view sits in its line, which wraps around it as the
  browser sizes it.

## A custom mark

`acme:topic` tags a run of text with a topic. A mark view puts classes and attributes on every
run of it; the app's CSS gives them their look ([theming](theming.md#extension-content)).

```ts
import { type Command, toggleMark } from "@folijs/core";
import type { ViewExtension } from "@folijs/view";

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
```

A mark is a `MarkSpec` (`attrs`, `inclusive`, `excludes`, `group`). Without a mark view a run
of a custom mark is still named for CSS: `data-foli-mark` holds its custom marks' types, space
separated (`[data-foli-mark~="acme:topic"]`).

## A custom block node

`acme:card` is a block leaf: a sibling of paragraphs, with a node view the page flow measures
and places.

```ts
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
```

**Split or kept whole.** A block node view that may split (the default) gives its root
element's children as its lines. When the node does not fit in what is left of a page, the view
draws it again on the next page (`render` runs once per part) and clips each part to its lines.
The parts after the first are `aria-hidden` and `inert`, so their links and buttons are not
second tab stops. Lines take no widow or orphan control. With `split: false` the node moves whole
to the next page; one taller than a page is then cut by the page. A block in a table cell is kept
whole.

`destroy(dom)`, if given, gets what `render` returned once the view no longer shows it (the node
changed, was deleted or split again, or the view was destroyed). The view never reads a node
view's DOM back: it may change after `render` (an image loading, a chart drawn), and that is not
input. A block node cannot be inserted or deleted as a tracked change
([limitations](../limitations.md#content)).

## A plugin

A `Plugin` holds state beside the document, filters and appends transactions, binds keys and adds
commands. User plugins (`createEditor({ plugins })`, then each extension's `plugins`) run before
the built-in ones. `PluginSpec` is frozen for 1.x.

**State.** `init` makes the value; `apply` gives the next one for each transaction. Read it with
`key.getState(state)`. Keeping derived data here means computing it once per change, not on every
read:

```ts
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
```

**`appendTransaction`** runs after transactions are applied and may return a follow-up
transaction. It is called again with the transactions added since, until no plugin appends (more
than 100 rounds throws a `RangeError`). Return `null` when there is nothing to do:

```ts
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
```

**`filterTransaction`** returning false drops a transaction; it also sees what other plugins
append. Here a plugin's state, set by a transaction's metadata, locks the document (for a
read-only editor use `readOnly` or `editable: false`; this shows the hooks):

```ts
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
```

**Decorations and a plugin view.** A `ViewExtension` turns the plugin state into decorations and
keeps a word count beside the editor:

```ts
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
```

- A `Decoration` is `{ from, to, node?, attrs }` in body positions: the text and inline leaves
  from `from` to `to`, or with `node: true` the node at `from` (a paragraph on every page it is
  on, a custom block, an inline leaf). Tables, rows and cells take none.
- `attrs` (`DecorationAttrs`): `class` is added, `style` appended, any other attribute set. They
  are checked as `h` checks them ([below](#safety-what-is-trusted)); a decoration with a refused
  attribute is left out and reported on the console.
- Decorations never change the document, the clipboard or what is saved. Only the blocks whose
  decorations changed are drawn and measured again, so a decoration that changes a size re-flows
  the pages.
- `view(editorView)` is called for every `EditorView` of the editor, a header, footer or note
  open on its page included. `update(view, previous)` runs after each change the view drew;
  `destroy()` when the view is destroyed.
- A hook that throws is reported with `console.error` and left out; the editor goes on.

## A command

A plugin's `commands` maps names to command factories, `(...args) => Command`. The editor adds
each one to `editor.commands`, on the body's editor and on the stories' editors. Type the names
by augmenting `FoliCommands`:

```ts
import { createEditor, Plugin } from "@folijs/core";
import type { ViewExtension } from "@folijs/view";
import { card, insertCard } from "./card.js";
import { insertMention, mention } from "./mention.js";
import { review, setLocked } from "./plugin.js";
import { toggleTopic, topic } from "./topic.js";

declare module "@folijs/core" {
  interface FoliCommands {
    insertMention(id: string, name: string): boolean;
    toggleTopic(name: string): boolean;
    insertCard(title: string, list: string[]): boolean;
    setLocked(locked: boolean): boolean;
  }
}

const commands: ViewExtension = {
  name: "acme-commands",
  plugins: [new Plugin({ commands: { insertMention, toggleTopic, insertCard, setLocked } })],
};

/** Everything above, for `createEditor`, `parseDocument`, `exportDocx` and `FoliEditor`. */
export const acme: readonly ViewExtension[] = [mention, topic, card, review, commands];
```

Then:

```ts
export function demo() {
  const editor = createEditor({ extensions: acme });
  editor.commands.insertText("Ask ");
  editor.commands.insertMention("u-7", "Grace Hopper"); // true: it applied
  editor.can(insertMention("u-7", "Grace Hopper")); // a dry run, as a toolbar asks
  editor.run(toggleTopic("finance")); // the same as editor.commands.toggleTopic("finance")
  return editor;
}
```

A name taken twice, or by a built-in command (`undo`, `toggleMark`…), makes `createEditor` throw
a `RangeError`. A command an app does not declare in `FoliCommands` still runs, untyped. In React,
`useCommand("insertMention", "u-7", "Grace Hopper")` gives `{ enabled, run }` ([below](#toolbar-items-and-menus)).

## A keymap

A plugin's `keymap` maps key names to commands. Names are those of `keyName` (`Mod-b`,
`Shift-Enter`, `F9`; [keyboard.md](../keyboard.md#key-names)): `Mod` is Ctrl on Windows and
Linux, Cmd on macOS.

```ts
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
```

- A user plugin's binding runs before every built-in key, the view's own keys included (Ctrl+F,
  F9, Ctrl+Home…). A command that returns true takes the key; false passes it on.
- The reserved keys are the view's and a keymap cannot stop them: the caret fixes at page splits,
  Escape out of a header, footer or note, Tab after Escape, Ctrl+Shift+V, the keys of a drag or a
  pop-up, and every key during IME composition. The list, and every built-in key per platform:
  [keyboard.md](../keyboard.md#reserved).
- Do not bind `Alt-` or `Mod-Alt-` plus a letter or digit: Option on macOS and AltGr on Windows
  type characters with them on many layouts.
- `editor.handleKey(name)` runs the plugins' keymaps from code; it does not run the view's own
  keys.

## Toolbar items and menus

`FoliToolbar`'s `items` (or `FoliEditor`'s `toolbar`) takes groups of items. The built-in items
are in `toolbarItems` by name and the default toolbar is `defaultToolbarItems`, so an app adds,
removes and regroups them:

```tsx
import {
  defaultToolbarItems,
  FoliEditor,
  type ToolbarAction,
  type ToolbarButton,
  type ToolbarMenu,
  toolbarItems,
  useCommand,
} from "@folijs/react";
import { insertCard } from "./card.js";
import { acme } from "./commands.js";
import { keys } from "./keymap.js";
import { insertMention } from "./mention.js";
import { toggleTopic } from "./topic.js";

/** A button: enabled while its command's dry run says it would apply. */
const mentionButton: ToolbarButton = {
  key: "acme-mention",
  label: "Mention Ada Lovelace",
  text: "@Ada",
  command: insertMention("u-42", "Ada Lovelace"),
};

/** A menu button: its entries are dry-run when it opens. */
const topicMenu: ToolbarMenu = {
  key: "acme-topic",
  label: "Topic",
  actions: ["finance", "legal"].map(
    (name): ToolbarAction => ({ key: name, label: `Topic: ${name}`, command: toggleTopic(name) }),
  ),
};

/** A built-in menu with one more entry: Controls takes a list. */
const controls = toolbarItems.controls.actions as readonly ToolbarAction[];
const controlsWithCard: ToolbarMenu = {
  ...toolbarItems.controls,
  actions: [
    ...controls,
    { key: "acme-card", label: "Card", command: insertCard("Checklist", ["Owner", "Due date"]) },
  ],
};

/** The default toolbar, Controls swapped for the menu above, and a group of the app's own. */
const toolbar = [
  ...defaultToolbarItems.map((group) =>
    group.map((item) => (item === toolbarItems.controls ? controlsWithCard : item)),
  ),
  [mentionButton, topicMenu],
];

/** A button outside the toolbar, through a named command (typed by `FoliCommands`). */
function MentionGrace() {
  const { enabled, run } = useCommand("insertMention", "u-7", "Grace Hopper");
  return (
    <button type="button" disabled={!enabled} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      Mention Grace
    </button>
  );
}

export function AcmeEditor() {
  return (
    <FoliEditor extensions={acme} plugins={[keys]} toolbar={toolbar} label="Document">
      <MentionGrace />
    </FoliEditor>
  );
}
```

- A `ToolbarButton` runs its `command` on the editor of the header, footer or note open on its
  page, else the body's. It is enabled by the command's dry run after every transaction, unless
  `enabled(state, editor)` says otherwise; `pressed(state, editor)` makes it a toggle. Keep both
  cheap. `icon` shows instead of the text; `label` is then its accessible name.
- A `ToolbarMenu` has `actions` (`{ key, label, command, checked? }`), or a function of the
  editor making them. Table, Section and Controls take a list; Header, Fields, Navigate and Notes
  a function ([api.md](../api.md#toolbar-items)).
- App items keep the toolbar's keyboard use (one tab stop, arrow keys, Home, End),
  `aria-pressed`, `aria-disabled`, and the document's focus and selection on click (a
  `ToolbarCustom` does the last three for itself). They can
  be boxes (`ToolbarSelect`), color menus (`ToolbarColorMenu`), buttons opening the app's own
  dialog under the toolbar (`ToolbarDialog`) and controls the app renders (`ToolbarCustom`) too
  ([api.md](../api.md#toolbar-items)).
- `useCommand(command)` or `useCommand(name, ...args)` gives a button of the app's own
  `{ enabled, run }`. Make its command outside the component, or memoize it: a new command on each
  render is dry-run on each render.

Without React, read `editor.can(command)` in an `editor.subscribe` listener and call
`editor.run(command)` on click.

## Saving, loading and .docx

Custom nodes and marks are stored as ordinary node and mark JSON in the envelope's content,
stories and comments, by type name:
[document-model.md](../document-model.md#custom-nodes-and-marks).

```ts
import { createEditor, type Editor, parseDocument } from "@folijs/core";
import { type DocxPackage, exportDocx, importDocx } from "@folijs/docx";
import { acme } from "./commands.js";

/** JSON: custom nodes and marks are ordinary node and mark JSON, by type name. */
export const save = (editor: Editor): string => JSON.stringify(editor.getDocument());

/** Validated against the Word schema and the extensions' types and attributes. */
export const load = (json: string): Editor =>
  createEditor({
    document: parseDocument(JSON.parse(json), { extensions: acme }),
    extensions: acme,
  });

/** .docx: each custom node and marked run becomes a content control tagged with its JSON. */
export const toDocx = (editor: Editor, original?: DocxPackage): Promise<Uint8Array> =>
  exportDocx(editor.getDocument(), original, { extensions: acme });

/** The tagged controls are read back as the same nodes and marks. */
export async function fromDocx(bytes: Uint8Array) {
  const { document, package: original } = await importDocx(bytes);
  return { editor: createEditor({ document, extensions: acme }), original };
}
```

**In `.docx`** each custom type is a content control whose tag is `foli:` and
`{"node"|"mark": type, "attrs": …}` as JSON:

- an inline node: a plain text control, its contents locked, showing `text(attrs)`;
- a block node: a block control around one paragraph of its text;
- a run of a custom mark: a rich text control around the run, one per paragraph it crosses.

Word users see the controls: a locked chip they can delete, a frame around a marked run. Text
they type inside a marked run is read back under the mark. `importDocx` turns a tagged control
back into its node or mark whether or not the app has the extension, but only when nothing would
be lost: a control that came back holding more (a bookmark, a field, another control, formatting
around it, a tracked change) stays an ordinary content control, its tag kept.

A tag holds at most 255 characters. A node or mark whose tag would be longer makes `exportDocx`
throw a `DocxError` naming it; nothing is cut. Keep large data elsewhere and an id in the
attributes. Anyone with the file can read the tags: put no secrets in attributes.

**Without the extension** (another app, an older build, a server without it) a custom type is
never dropped and does not stop the document from loading. `parseDocument` and the editor keep a
namespaced type they do not know as a foreign node (`foreignInline`, `foreignBlock`) or a
foreign mark, its attributes checked only as plain JSON (65,536 characters of JSON at most). A
foreign node is drawn as its `.docx` text, or as its type in brackets (`[acme:mention]`) when it
came from JSON; it is selected and deleted whole, and written back exactly by
`getDocument`, `onChange` and `exportDocx`. Pasted into an editor that has the extension, it is
the custom type again. In `.docx` a foreign node shows the text its control had when it was
imported, while the document stays in memory; one loaded from JSON shows `[acme:mention]`.

**Where views are not drawn.** `renderDocument` and `exportPdf` take no extensions: they draw a
custom node as its text and a custom mark not at all. So do the headers, footers and notes as the
pages show them, until one is opened for editing.

## Safety: what is trusted

Extension code is trusted: it runs with the page's rights. A document's content is not: the
attributes of a custom node or mark come from saved JSON, pastes and `.docx` tags, which anyone
can write.

- Validate every attribute (`validate`): `parseDocument`, `parseContent` and the editor check
  them whenever they read a document.
- Build node views with `h(tag, attrs?, ...children)`, never from HTML (`innerHTML`,
  `insertAdjacentHTML`). Strings given as children become text nodes.
- `h` makes only content elements (text-level and flow elements, lists, tables, `details`,
  `figure`, `img`, `picture`, `video`, `audio`, `canvas`, `button`). It throws a `TypeError` for
  `script`, `style`, `base`, `meta`, `link`, `form`, frames, `template` and SVG, and for `on*`
  handlers, `contenteditable`, `srcdoc`, the view's own `data-foli-*` attributes, URL attributes
  (`href`, `src`, `action`, `formaction`, `poster`, `background`, `srcset`, `ping`) that are not
  safe links (`isSafeHref`), a `style` that fetches or runs anything (`url(`, `image-set`,
  `expression`, `@import`, backslash escapes) and classes starting with `foli-`.
- Decorations and mark views are checked the same way; a refused one is left out and reported.
- What `render` returns is used as it is: a node built without `h` is not checked. Check a URL
  from an attribute with `isSafeHref` before you set it yourself.
- Do not put attribute values in `id` or `name`: an element with a document-chosen `id` or
  `name` can shadow globals and `document` properties (DOM clobbering).
- Do not trust a foreign node's JSON either: it is whatever the document held.
