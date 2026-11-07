# @foli/react

React components for [Foli](https://github.com/josep-audenis/foli), a document editor for the
web: documents on real pages (A4, Letter), edited in the browser, stored as JSON. Its own
editing engine, no ProseMirror or similar underneath.

> Pre-release: the API may change in any 0.x version.

```bash
npm install @foli/react @foli/core react react-dom
```

```tsx
import { createDocument } from "@foli/core";
import { type FoliChange, FoliEditor } from "@foli/react";
import "@foli/react/styles.css";

function onChange(change: FoliChange) {
  // Debounce this: reading `change.document` serializes the whole document.
  localStorage.setItem("doc", JSON.stringify(change.document));
}

export function App() {
  return <FoliEditor initialContent={createDocument()} onChange={onChange} />;
}
```

`FoliEditor` shows the pages with a formatting toolbar. For your own layout: `useFoliEditor`,
`FoliEditorProvider`, `FoliCanvas`, `FoliToolbar`, `useCurrentEditor` and
`useEditorState(selector)`. React 18.2+ and 19; server rendering gives the editor's shell, the
document appears on hydration.

- [Getting started](https://github.com/josep-audenis/foli/blob/main/docs/getting-started.md): load, save, read-only, Next.js, your own toolbar
- [API reference](https://github.com/josep-audenis/foli/blob/main/docs/api.md#folireact)
- [Styling](https://github.com/josep-audenis/foli/blob/main/docs/styling.md): CSS variables, dark theme, print
- [Known limitations](https://github.com/josep-audenis/foli/blob/main/docs/limitations.md)

MIT
