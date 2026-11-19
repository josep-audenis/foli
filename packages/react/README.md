# @folijs/react

React components for [Foli](https://github.com/josep-audenis/foli), a document editor for the
web: documents on real pages (A4, Letter), edited in the browser, stored as JSON. Its own
editing engine, no ProseMirror or similar underneath.

> Early release: the API may change in any 0.x minor version (changes in `CHANGELOG.md`).

```bash
npm install @folijs/react @folijs/view @folijs/core react react-dom
```

Keep all `@folijs/*` packages on the same version.

```tsx
import { createDocument, parseDocument } from "@folijs/core";
import { type FoliChange, FoliEditor } from "@folijs/react";
import "@folijs/react/styles.css";

// Load: parseDocument validates the saved JSON, migrating an older document (throws
// FoliDocumentError when invalid).
const saved = localStorage.getItem("doc");
const initial = saved ? parseDocument(JSON.parse(saved)) : createDocument();

// Save once typing pauses: reading `change.document` serializes the whole document.
let timer: ReturnType<typeof setTimeout> | undefined;
function onChange(change: FoliChange) {
  clearTimeout(timer);
  timer = setTimeout(() => localStorage.setItem("doc", JSON.stringify(change.document)), 300);
}

export function App() {
  return <FoliEditor initialContent={initial} onChange={onChange} />;
}
```

Browser-only as written; for server rendering (Next.js) and saving on page close, see
[Getting started](https://github.com/josep-audenis/foli/blob/main/docs/getting-started.md).

`FoliEditor` shows the pages with Word's toolbar (formatting, review, tables, pictures,
sections, headers and footers, fields, notes, content controls) and the find, replace and go to
panel (`FoliNavigation`). For your own layout: `useFoliEditor`, `FoliEditorProvider`,
`FoliCanvas`, `FoliToolbar`, `FoliComments`, `FoliNavigation`, `useCurrentEditor`,
`useEditorState(selector)` and `useCommand(command)`. To change the toolbar's items, pass groups
of them (`toolbar` on `FoliEditor`, `items` on `FoliToolbar`): the built-in ones by name from
`toolbarItems`, and your own (`ToolbarItem`: a button running a command, enabled by its dry
run, or a menu). `useCommand("undo")` takes a command's name too.
React 18.2+ and 19; server rendering gives the editor's shell, the document appears on
hydration.

- [Getting started](https://github.com/josep-audenis/foli/blob/main/docs/getting-started.md): loading and saving, read-only, Next.js, your own toolbar and toolbar items
- [API reference](https://github.com/josep-audenis/foli/blob/main/docs/api.md#folijsreact)
- [Styling](https://github.com/josep-audenis/foli/blob/main/docs/styling.md): CSS variables, dark theme, print
- [Known limitations](https://github.com/josep-audenis/foli/blob/main/docs/limitations.md)

MIT
