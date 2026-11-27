# @folijs/react

React components for [Foli](https://github.com/josep-audenis/foli), a document editor for the
web: documents on real pages (A4, Letter), edited in the browser, stored as JSON. Its own
editing engine, no third-party editor engine underneath.

> Stable since 1.0.0: the public API and the saved format follow semver ([versions and deprecation](https://foli.josepaudenis.com/docs/deprecation/)); changes in `CHANGELOG.md`. Docs: [foli.josepaudenis.com/docs](https://foli.josepaudenis.com/docs/).

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
run, a menu, a box, a color menu, a dialog or your own control), or tabs of groups
(`defaultToolbarTabs`: Home, Insert, Layout, Review), or Word's ribbon whole:
`<FoliEditor toolbar={wordRibbonTabs} />` (captioned groups, Table and Picture tabs that come with
the selection, large buttons, dialog launchers, a ribbon that collapses, KeyTips on Alt, icons
and a Styles gallery). `useCommand("undo")` takes a command's name too. Word's status bar (page,
words, tracking, zoom), right-click menu and mini toolbar: `statusBar`, `contextMenu` and
`miniToolbar` on `FoliEditor`, or `FoliStatusBar`, `FoliContextMenu` and `FoliMiniToolbar` in
your own layout. Word's Font and Paragraph dialogs open from the ribbon's launchers, the
right-click menu and `openDialog`, the Tabs dialog from the Paragraph dialog's Tabs…; the Layout tab has Word's Margins, Orientation, Size, Columns
and Breaks menus; lengths show in `units` (inches or centimetres, the locale's by default). Word's rulers:
`FoliEditor` draws them while the View tab's Ruler is on (`ruler` turns it on at first), or
`FoliRuler` in your own layout (with `ruler={false}`) (indents, tab stops, table columns and margins dragged, or moved with the arrow keys).

Roles: `readOnly` reads (select, copy, find); `commentOnly` comments and changes nothing else (a
read-only canvas, a toolbar of comment and review items, core's `commentOnly()` plugin refusing
every other change). Neither is access control: your server checks who may save, and with
`@folijs/collab` its `authorize` refuses a commenter's other steps (`onlyCommentSteps(doc, steps, { author })`).
React 18.2+ and 19; server rendering gives the editor's shell, the document appears on
hydration.

- [Getting started](https://github.com/josep-audenis/foli/blob/main/docs/getting-started.md): loading and saving, read-only, Next.js, your own toolbar and toolbar items
- [API reference](https://github.com/josep-audenis/foli/blob/main/docs/api.md#folijsreact)
- [Styling](https://github.com/josep-audenis/foli/blob/main/docs/styling.md): CSS variables, dark theme, print
- [Known limitations](https://github.com/josep-audenis/foli/blob/main/docs/limitations.md)

MIT
