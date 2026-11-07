# API reference

The public API of the three packages, as of 0.1.0. Not stable before 1.0: anything may change
in a minor version until then (changes are listed in each package's changelog). Exports not
listed here (model classes, steps, `Transform`, `Plugin`, `Transaction` metadata, mapping) are
public for advanced use but are not a stable API yet.

- [`@folijs/react`](#folireact): components and hooks
- [`@folijs/core`](#folicore): documents, the headless editor, commands
- [`@folijs/view`](#foliview): the editable DOM view without React

## `@folijs/react`

Peer dependencies: `react` and `react-dom` 18.2+ or 19. Stylesheet: `@folijs/react/styles.css`
([styling.md](styling.md)).

### `<FoliEditor>`

An editable document on pages, with a toolbar. Creates its own editor and provides it to its
`children`. Uncontrolled: the editor owns the document.

| Prop             | Type                           | Default      | Notes                                                                                             |
| ---------------- | ------------------------------ | ------------ | ------------------------------------------------------------------------------------------------- |
| `initialContent` | `FoliDocument`                 | empty A4     | Read once, on mount. Later: `editor.setDocument()` or a new `key`.                                |
| `plugins`        | `readonly Plugin[]`            | `[]`         | Read once, on mount. Unstable API.                                                                |
| `onChange`       | `(change: FoliChange) => void` | —            | After every content change made through transactions. Not for selection changes or `setDocument`. |
| `toolbar`        | `boolean`                      | `true`       | Show `FoliToolbar` above the pages.                                                               |
| `readOnly`       | `boolean`                      | `false`      | Read, select, copy; no editing. Disables the toolbar.                                             |
| `placeholder`    | `string`                       | `""`         | Shown while the document is empty.                                                                |
| `label`          | `string`                       | `"Document"` | Accessible name of the editable area.                                                             |
| `className`      | `string`                       | —            | Added to the `.foli-canvas` element.                                                              |
| `children`       | `ReactNode`                    | —            | Rendered between the toolbar and the pages, inside the editor's context.                          |

`ref` → `FoliEditorHandle`: `{ editor: Editor; focus(): void }`.

`FoliChange`:

- `editor: Editor`
- `transactions: readonly Transaction[]`: this change's transactions (several when plugins
  append their own).
- `document: FoliDocument`: the document right after this change, serialized on first read.
  Read it when you save, not on every change. Save `change.document`, never `change`:
  `JSON.stringify(change)` gives `{ editor, transactions, document }`, which `parseDocument`
  rejects.

### `<FoliCanvas>`

The pages alone, for your own layout. Props: `editor` (default: the nearest
`FoliEditorProvider`'s), `readOnly`, `placeholder`, `label`, `className`, as above.
`ref` → `FoliCanvasHandle`: `{ focus(): void }` (focuses the document, shows the editor's
selection and scrolls it into view).

### `<FoliToolbar>`

The default toolbar: bold, italic, underline, strikethrough · paragraph, H1–H3 · undo, redo ·
page break. A WAI-ARIA toolbar: one Tab stop, arrow keys, Home and End move between buttons;
toggle buttons have `aria-pressed`; buttons stay focusable when disabled (`aria-disabled`).
Clicking a button keeps the document's selection.

| Prop             | Type         | Default        | Notes                                                               |
| ---------------- | ------------ | -------------- | ------------------------------------------------------------------- |
| `editor`         | `Editor`     | context        |                                                                     |
| `disabled`       | `boolean`    | `false`        | Pass it whenever the canvas is `readOnly`.                          |
| `onClickCommand` | `() => void` | —              | After a click ran a command (`FoliEditor` focuses its canvas here). |
| `label`          | `string`     | `"Formatting"` | Accessible name.                                                    |
| `className`      | `string`     | —              | Added to `.foli-toolbar`.                                           |

### Hooks and provider

- `useFoliEditor({ initialContent?, plugins? }): Editor`: creates an editor on the first render
  and keeps it for the component's lifetime. Later option changes are ignored.
- `<FoliEditorProvider editor={editor}>`: makes `editor` the one the components and hooks
  below it use.
- `useCurrentEditor(): Editor`: the nearest provider's (or `FoliEditor`'s) editor. Throws
  outside one.
- `useEditorState(selector, { editor?, isEqual? })`: a slice of the state; the component
  re-renders only when it changes (`isEqual`, default `Object.is`). The selector
  `(state, editor) => T` runs after every transaction: keep it cheap.

## `@folijs/core`

No DOM: runs in Node, workers and the browser.

### Documents

- `createDocument(content?, settings?): FoliDocument`: a new document (default: one empty
  paragraph, A4 with 25.4 mm margins). Neither argument is validated, and `settings` is merged
  shallowly: pass a whole `margins` object, not part of one.
- `parseDocument(input: unknown): FoliDocument`: validates untrusted input (e.g. parsed JSON)
  and returns it in canonical form: content against the schema, settings (positive page size,
  margins that leave a content area). Throws `FoliDocumentError`, whose message names the place
  (`content.content[2].marks[0].type: …`); never drops content silently.
- `FoliDocument`: `{ schemaVersion, settings: { pageSize, margins }, content }`; sizes in
  millimetres. Format: [document-model.md](document-model.md).
- `SCHEMA_VERSION`, `PAGE_SIZES` (`A4`, `Letter`), `DEFAULT_SETTINGS`, `schema`, `MARK_TYPES`
  (`bold`, `italic`, `underline`, `strike`), `HEADING_LEVELS` (1–6), and the JSON types
  (`DocJSON`, `ParagraphJSON`, `HeadingJSON`, `TextJSON`…).

### Editor

`createEditor({ document?, plugins? }): Editor`: a headless editor (state, commands, undo
history, change notifications). Its content is validated (as by `parseDocument`); its
settings are not, so pass a document from `parseDocument` or `createDocument`.
`setDocument` behaves the same way.

| Member                         | Notes                                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`                        | Current immutable `EditorState` (`state.doc`, `state.selection`).                                                                                                                                                                                                                                                             |
| `settings`                     | Page size and margins of the current document.                                                                                                                                                                                                                                                                                |
| `commands.*`                   | Run a command, return whether it applied: `insertText(text)`, `deleteSelection()`, `deleteBackward(unit?)`, `deleteForward(unit?)`, `joinBackward()`, `joinForward()`, `splitBlock()`, `insertHardBreak()`, `insertPageBreak()`, `toggleMark(type, attrs?)`, `setBlockType(type, attrs?)`, `selectAll()`, `undo()`, `redo()`. |
| `isMarkActive(type)`           | Whether the mark is active at the selection (or stored for the next typed text).                                                                                                                                                                                                                                              |
| `select(anchor, head?)`        | Places a text selection (positions clamped into the document).                                                                                                                                                                                                                                                                |
| `run(command)`, `can(command)` | Run any `Command`, or dry-run it. `can` builds the whole transaction: not per keystroke.                                                                                                                                                                                                                                      |
| `handleKey(key)`               | Runs the first bound command for a key name such as `"Mod-b"`.                                                                                                                                                                                                                                                                |
| `dispatch(tr)`                 | Applies a transaction (`state.tr`).                                                                                                                                                                                                                                                                                           |
| `getDocument()`                | The current document as a `FoliDocument`.                                                                                                                                                                                                                                                                                     |
| `setDocument(doc)`             | Replaces the document and settings, clears undo history. Listeners get an empty transaction list.                                                                                                                                                                                                                             |
| `subscribe(listener)`          | `(state, transactions) => void` after every change (selection included); returns unsubscribe. `transactions.some(tr => tr.docChanged)` tells content changes apart.                                                                                                                                                           |

Headings: `setBlockType("heading", { level: 2 })`; back to text: `setBlockType("paragraph")`.

### Commands

Commands are `(state, dispatch?) => boolean` and run with `editor.run(command)`:
`insertText(text)`, `deleteSelection`, `deleteBackward(unit?)`, `deleteForward(unit?)` (unit
`"char"` or `"word"`), `joinBackward`, `joinForward`, `splitBlock`, `insertHardBreak`,
`insertPageBreak`, `selectAll`, `toggleMark(type, attrs?)`, `setBlockType(type, attrs?)`,
`undo`, `redo`. Helpers: `isMarkActive(state, type)`, `undoDepth(state)`, `redoDepth(state)`,
`marksAt`. `baseKeymap()` is the default key binding plugin (keys in
[getting-started.md](getting-started.md#keyboard)).

## `@folijs/view`

The editable view without a framework. Needs a browser DOM.

```ts
const view = new EditorView(host, editor, { editable: true, placeholder: "" });
```

- Makes `host` a `contenteditable` textbox (`role="textbox"`, `aria-multiline`) and renders the
  editor's state into it as `section.foli-page` elements sized from the document settings.
  Removes the host's children. Give the host an accessible name yourself.
- `view.setOptions({ editable?, placeholder? })`: changes the given options.
- `view.focus()`: focuses the host, shows the editor's selection, scrolls it into view.
- `view.destroy()`: removes listeners, injected styles and the attributes it added; empties the
  host.
- Clipboard: copy writes Foli JSON (`FOLI_MIME`), HTML and plain text; paste prefers Foli JSON,
  then HTML (`htmlToDoc`, mapped to the schema, never `innerHTML`), then text (`textToDoc`).
- `keyName(event)`: the key name `handleKey` expects (`"Mod-b"`, `"Shift-Enter"`).
