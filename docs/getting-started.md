# Getting started

Foli is a document editor for the web: a document on real pages (A4 or Letter, with margins),
edited in the browser, stored as JSON. This guide uses the React package. Without React, see
[Using the view without React](#using-the-view-without-react).

> **0.x:** the API may change in any minor version (0.1 → 0.2); changes are listed in each
> package's `CHANGELOG.md`. Read the [known limitations](limitations.md) before you ship.

## Install

```bash
npm install @folijs/react @folijs/view @folijs/core react react-dom
```

`@folijs/react` works with React 18.2+ and 19. `@folijs/core` holds the document functions
(`createDocument`, `parseDocument`). After 0.6.0, `@folijs/react`, `@folijs/view`, `@folijs/docx`
and `@folijs/pdf` take `@folijs/core` (and `@folijs/react` also `@folijs/view`) as peer
dependencies at exactly their own version, so the app has one copy of the engine: install all
`@folijs/*` packages at the same version and upgrade them together (npm 7+ and pnpm install
peers themselves; with other package managers list them as above).

## Show an editor

```tsx
import { FoliEditor } from "@folijs/react";
import "@folijs/react/styles.css";

export function App() {
  return <FoliEditor placeholder="Start writing…" />;
}
```

That gives an empty A4 document with Word's formatting toolbar (paragraph style, font, size,
bold, italic, underline, strikethrough, link, text color, highlight, alignment, line spacing,
bulleted and numbered lists, indent, undo, redo, page break). The stylesheet holds the
default theme; see [styling.md](styling.md) to change it.

## Load and save

A saved document is a schema v5 document (`FoliDocument`, Word's model): its content tree
with the styles, numbering, comments, page setup, headers, footers, notes and content controls'
properties beside it ([document-model.md](document-model.md)). Store it as JSON. Documents saved
by 0.1.0 to 0.5.0 still load: `parseDocument` and `FoliEditor` migrate them. 0.5.0 cannot read
documents saved by 0.6.0.

```tsx
import { createDocument, type EditorDocument, parseDocument } from "@folijs/core";
import { type FoliChange, FoliEditor } from "@folijs/react";
import "@folijs/react/styles.css";

const KEY = "my-document";

/** The saved document, or a new one (also when the saved one no longer parses). */
function load(): EditorDocument {
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

This runs in the browser only (module-level `localStorage` and `addEventListener`). With server
rendering, see [Next.js](#server-rendering-nextjs-and-others).

- `parseDocument` is the trust boundary: it validates input (content, styles, numbering,
  comments and page setup; an older document before it is migrated) and throws
  `FoliDocumentError`, whose message names where the problem is
  (`content.content[2]...`), instead of dropping content it does not understand.
- Save `change.document`, never `change` itself: `JSON.stringify(change)` gives
  `{ editor, transactions, document }`, which `parseDocument` rejects.
- `onChange` runs after every change to the content (typing, commands, undo), not for selection
  changes. Read `change.document` when you save, not on every keystroke: it serializes the
  whole document.
- `initialContent` is read once, on mount. To load another document later, call
  `editor.setDocument(doc)` through a ref (below), or give `FoliEditor` a new `key`.

## Reach the editor from outside

A `ref` on `FoliEditor` gives its `editor` and `focus()`:

```tsx
import { parseDocument } from "@folijs/core";
import { FoliEditor, type FoliEditorHandle } from "@folijs/react";
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
import type { Editor } from "@folijs/core";
import {
  FoliCanvas,
  FoliEditorProvider,
  FoliToolbar,
  useCurrentEditor,
  useEditorState,
  useFoliEditor,
} from "@folijs/react";
import { useEffect } from "react";

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

// What FoliEditor's onChange does, for an editor you created yourself.
function useSave(editor: Editor, save: (json: string) => void) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = editor.subscribe((_state, transactions) => {
      if (!transactions.some((tr) => tr.docChanged)) return; // a selection change
      clearTimeout(timer);
      timer = setTimeout(() => save(JSON.stringify(editor.getDocument())), 300);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [editor, save]);
}

const saveToStorage = (json: string) => localStorage.setItem("my-document", json);

export function App() {
  const editor = useFoliEditor(); // or useFoliEditor({ initialContent: doc })
  useSave(editor, saveToStorage);
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

| Keys (Ctrl on Windows/Linux, Cmd on macOS)                  | Does                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------- |
| Ctrl+B, Ctrl+I, Ctrl+U                                      | bold, italic, underline                                     |
| Ctrl+Z; Ctrl+Shift+Z or Ctrl+Y                              | undo; redo                                                  |
| Enter; Shift+Enter                                          | new paragraph; line break                                   |
| Ctrl+Enter                                                  | page break                                                  |
| Ctrl+A                                                      | select all                                                  |
| Ctrl+Shift+V                                                | paste as plain text                                         |
| Ctrl+K                                                      | add or edit a link (the toolbar's link dialog)              |
| Ctrl+click on a link                                        | open it in a new tab                                        |
| Arrows next to a table or other content Foli keeps as it is | select it (a click does too); arrows again: past it         |
| Typing, Backspace on selected content                       | replace it with text; delete it                             |
| Ctrl+Shift+8; Ctrl+Shift+7                                  | bulleted list; numbered list (again: back to paragraphs)    |
| Tab; Shift+Tab at a list paragraph's start                  | one level deeper; one level up (out of the list at the top) |
| Enter on an empty list paragraph                            | one level up; at the top, leave the list                    |
| Backspace at a list paragraph's start                       | remove its number (the text stays where it was)             |
| Tab elsewhere                                               | type a tab, as in Word                                      |
| F9                                                          | update the field at the caret, or those selected            |
| Ctrl+A, then F9                                             | update every field                                          |
| Alt+F9                                                      | show or hide field codes                                    |
| Backspace after, or Delete before, a field                  | select it; the same key again deletes it                    |
| Escape, then Tab or Shift+Tab                               | move the focus on (out of the editor)                       |

Word and line deletion use the platform's own keys (Ctrl+Backspace, Option+Backspace,
Cmd+Backspace…). In a read-only editor, Tab and Shift+Tab move the focus on. In the toolbar,
arrow keys move between controls and Tab leaves it.

## Server rendering (Next.js and others)

The editor needs the browser. On the server, `FoliEditor` renders its shell (toolbar and an
empty editable area); the document appears on hydration. Its content is not in the server HTML.

With the Next.js App Router, put the editor in a client component and the stylesheet in the
layout:

```jsx
// app/Editor.jsx
"use client";
import { createDocument, parseDocument } from "@folijs/core";
import { FoliEditor } from "@folijs/react";
import { useState } from "react";

const KEY = "my-document";

/** The saved document in the browser; a new one on the server, which renders no content. */
function load() {
  // `window`, not `localStorage`: recent Node versions have a server-side `localStorage`.
  const saved = typeof window === "undefined" ? null : window.localStorage.getItem(KEY);
  try {
    if (saved) return parseDocument(JSON.parse(saved));
  } catch (error) {
    console.warn("Ignoring the saved document:", error);
  }
  return createDocument();
}

// Browser-only code (localStorage, addEventListener) runs in onChange, never during render.
let latest;
let timer;
function save() {
  if (latest) localStorage.setItem(KEY, JSON.stringify(latest.document));
  latest = undefined;
}

export function Editor() {
  const [initial] = useState(load);
  return (
    <FoliEditor
      initialContent={initial}
      onChange={(change) => {
        latest = change;
        clearTimeout(timer);
        timer = setTimeout(save, 300);
        addEventListener("pagehide", save, { once: true });
      }}
    />
  );
}
```

```jsx
// app/layout.jsx
import "@folijs/react/styles.css";
```

Complete apps: [examples/vite](../examples/vite) (React 18, TypeScript) and
[examples/next](../examples/next) (Next.js 16, React 19).

## Printing

`window.print()` prints one sheet per page at the document's page size; the stylesheet hides
the toolbar and page shadows in print. Hide the rest of your page in print yourself
([styling.md](styling.md#print)). The view's `print()` updates the fields first (page numbers,
tables of contents) and then opens the dialog.

## PDF on a server

`@folijs/pdf` prints a document to PDF from the same pages, with a headless Chromium page you
supply (Playwright 1.42+ or Puppeteer), without a browser dependency of its own:

```bash
npm install @folijs/pdf @folijs/core playwright
```

```ts
import { exportPdf } from "@folijs/pdf";
import { chromium } from "playwright";

const browser = await chromium.launch();
const { pdf } = await exportPdf(document, { page: await browser.newPage() });
await browser.close();
```

The machine that prints needs the document's fonts (or `@font-face` rules with `data:` URLs in
`styles`: the page loads nothing from the network), and the
pictures' images come through `resources`: see the
[package README](../packages/pdf/README.md).

## Using the view without React

`@folijs/view` renders an editor into any element:

```ts
import { createDocument, createEditor } from "@folijs/core";
import { EditorView } from "@folijs/view";
import "@folijs/react/styles.css"; // optional, see below

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
It does not name the textbox: set `aria-label` (or `aria-labelledby`) yourself. The default
theme ships in `@folijs/react` (which lists `react` as a peer dependency); without React, copy its
`styles.css` into your project instead. See [api.md](api.md#folijsview).

## Next

- [API reference](api.md)
- [Styling](styling.md): CSS variables, dark theme, print
- [Known limitations](limitations.md): read before shipping
