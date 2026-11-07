# Getting started

Foli is a document editor for the web: a document on real pages (A4 or Letter, with margins),
edited in the browser, stored as JSON. This guide uses the React package. Without React, see
[Using the view without React](#using-the-view-without-react).

> **Before 0.1.0** the packages are not on npm and the API may still change. To try them now,
> build the tarballs the way [`pnpm examples`](../examples/README.md) does, or work inside this
> repository (`pnpm dev` runs the playground).

## Install

```bash
npm install @foli/react @foli/core react react-dom
```

`@foli/react` works with React 18.2+ and 19. `@foli/core` holds the document functions
(`createDocument`, `parseDocument`); import it directly rather than relying on it being a
dependency of `@foli/react`.

## Show an editor

```tsx
import { FoliEditor } from "@foli/react";
import "@foli/react/styles.css";

export function App() {
  return <FoliEditor placeholder="Start writing…" />;
}
```

That gives an empty A4 document with a formatting toolbar (bold, italic, underline,
strikethrough, paragraph, headings 1–3, undo, redo, page break). The stylesheet holds the
default theme; see [styling.md](styling.md) to change it.

## Load and save

A saved document is a `FoliDocument`: a versioned envelope with the page settings and the
content tree ([document-model.md](document-model.md)). Store it as JSON.

```tsx
import { createDocument, type FoliDocument, parseDocument } from "@foli/core";
import { type FoliChange, FoliEditor } from "@foli/react";
import "@foli/react/styles.css";

const KEY = "my-document";

/** The saved document, or a new one (also when the saved one no longer parses). */
function load(): FoliDocument {
  const saved = localStorage.getItem(KEY);
  try {
    if (saved) return parseDocument(JSON.parse(saved));
  } catch (error) {
    console.warn("Ignoring the saved document:", error);
  }
  return createDocument();
}

// Save once typing pauses: `change.document` is serialized only when read.
let latest: FoliChange | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
function save(): void {
  if (latest) localStorage.setItem(KEY, JSON.stringify(latest.document));
  latest = undefined;
}
function onChange(change: FoliChange): void {
  latest = change;
  clearTimeout(timer);
  timer = setTimeout(save, 300);
}
addEventListener("pagehide", save);

const initial = load();

export function App() {
  return <FoliEditor initialContent={initial} onChange={onChange} />;
}
```

- `parseDocument` is the trust boundary: it validates input against the schema and throws
  `FoliDocumentError` (with a JSON path) instead of dropping content it does not understand.
- `onChange` runs after every change to the content (typing, commands, undo), not for selection
  changes. Read `change.document` when you save, not on every keystroke: it serializes the
  whole document.
- `initialContent` is read once, on mount. To load another document later, call
  `editor.setDocument(doc)` through a ref (below), or give `FoliEditor` a new `key`.

## Reach the editor from outside

A `ref` on `FoliEditor` gives its `editor` and `focus()`:

```tsx
import { parseDocument } from "@foli/core";
import { FoliEditor, type FoliEditorHandle } from "@foli/react";
import { useRef } from "react";

export function App() {
  const ref = useRef<FoliEditorHandle>(null);
  async function open(file: File) {
    const doc = parseDocument(JSON.parse(await file.text()));
    ref.current?.editor.setDocument(doc); // replaces the document and clears undo history
    ref.current?.focus();
  }
  return (
    <>
      <input
        type="file"
        accept=".json"
        onChange={(e) => e.target.files?.[0] && open(e.target.files[0])}
      />
      <FoliEditor ref={ref} />
    </>
  );
}
```

`setDocument` does not call `onChange` (its caller already has the document). Through
`editor.commands` code can also edit: `editor.commands.toggleMark("bold")`,
`editor.commands.setBlockType("heading", { level: 2 })`, `editor.commands.undo()`; see
[api.md](api.md#editor).

## Read-only

```tsx
<FoliEditor initialContent={doc} readOnly />;
```

The text stays selectable and copyable; the toolbar is disabled. Code can still change the
document through `editor`.

## Your own layout and buttons

`FoliEditor` is a shortcut for the parts below. Use them for your own toolbar or layout:

```tsx
import {
  FoliCanvas,
  FoliEditorProvider,
  FoliToolbar,
  useCurrentEditor,
  useEditorState,
  useFoliEditor,
} from "@foli/react";

function BoldButton() {
  const editor = useCurrentEditor();
  // Re-renders this button only when the value changes, not on every keystroke.
  const active = useEditorState((_state, editor) => editor.isMarkActive("bold"));
  return (
    <button
      type="button"
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()} // keep the selection in the document
      onClick={() => editor.commands.toggleMark("bold")}
    >
      Bold
    </button>
  );
}

export function App() {
  const editor = useFoliEditor(); // or useFoliEditor({ initialContent: doc })
  return (
    <FoliEditorProvider editor={editor}>
      <BoldButton />
      <FoliToolbar />
      <FoliCanvas placeholder="Start writing…" />
    </FoliEditorProvider>
  );
}
```

`useEditorState`'s selector runs after every transaction: keep it cheap (no `editor.can(...)`
dry runs over a large selection). With `<FoliCanvas readOnly />`, pass `<FoliToolbar disabled />`
too. `FoliEditor` itself takes `children`, rendered between its toolbar and the pages, inside
its context.

## Keyboard

| Keys (Ctrl on Windows/Linux, Cmd on macOS) | Does                      |
| ------------------------------------------ | ------------------------- |
| Ctrl+B, Ctrl+I, Ctrl+U                     | bold, italic, underline   |
| Ctrl+Z; Ctrl+Shift+Z or Ctrl+Y             | undo; redo                |
| Enter; Shift+Enter                         | new paragraph; line break |
| Ctrl+Enter                                 | page break                |
| Ctrl+A                                     | select all                |

Word and line deletion use the platform's own keys (Ctrl+Backspace, Option+Backspace,
Cmd+Backspace…). In the toolbar, arrow keys move between buttons and Tab leaves it.

## Server rendering (Next.js and others)

The editor needs the browser. On the server, `FoliEditor` renders its shell (toolbar and an
empty editable area); the document appears on hydration. Its content is not in the server HTML.

With the Next.js App Router, put the editor in a client component and the stylesheet in the
layout:

```jsx
// app/Editor.jsx
"use client";
import { createDocument, parseDocument } from "@foli/core";
import { FoliEditor } from "@foli/react";
import { useState } from "react";

function load() {
  // `window`, not `localStorage`: recent Node versions have a server-side `localStorage`.
  const saved = typeof window === "undefined" ? null : window.localStorage.getItem("doc");
  try {
    if (saved) return parseDocument(JSON.parse(saved));
  } catch {}
  return createDocument();
}

export function Editor() {
  const [initial] = useState(load);
  return <FoliEditor initialContent={initial} />;
}
```

```jsx
// app/layout.jsx
import "@foli/react/styles.css";
```

Complete apps: [examples/vite](../examples/vite) (React 18, TypeScript) and
[examples/next](../examples/next) (Next.js 16, React 19).

## Printing

`window.print()` prints one sheet per page at the document's page size; the stylesheet hides
the toolbar and page shadows in print. Hide the rest of your page in print yourself
([styling.md](styling.md#print)).

## Using the view without React

`@foli/view` renders an editor into any element:

```ts
import { createDocument, createEditor } from "@foli/core";
import { EditorView } from "@foli/view";
import "@foli/react/styles.css"; // optional: the default theme's page styles

const editor = createEditor({ document: createDocument() });
const host = document.querySelector<HTMLElement>("#editor")!;
host.classList.add("foli-content");
host.setAttribute("aria-label", "Document");
const view = new EditorView(host, editor, { placeholder: "Start writing…" });

editor.subscribe((_state, transactions) => {
  if (!transactions.some((tr) => tr.docChanged)) return; // a selection change
  // Debounce this in a real app: getDocument() serializes the whole document.
  localStorage.setItem("doc", JSON.stringify(editor.getDocument()));
});
// later: view.destroy();
```

The view makes `host` a `contenteditable` textbox and renders `.foli-page` sections into it.
It does not name the textbox: set `aria-label` (or `aria-labelledby`) yourself. See [api.md](api.md#foliview).

## Next

- [API reference](api.md)
- [Styling](styling.md): CSS variables, dark theme, print
- [Known limitations](limitations.md): read before shipping
