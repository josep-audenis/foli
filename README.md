<p align="center">
  <img src="apps/site/public/favicon.svg" alt="" width="72" height="82">
</p>

<h1 align="center">Foli</h1>

<p align="center">
  A document-editing engine for the web with real pages and Word's document model.<br>
  Its own model, transactions, view and layout. No ProseMirror, Tiptap or Lexical underneath.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@folijs/react"><img src="https://img.shields.io/npm/v/@folijs/react?label=%40folijs%2Freact&color=1d1d1b" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/josep-audenis/foli?color=1d1d1b" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-1d1d1b?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/.docx-lossless-1d1d1b" alt="Lossless .docx">
  <a href="https://foli.josepaudenis.com/docs/"><img src="https://img.shields.io/badge/docs-foli.josepaudenis.com-1d1d1b" alt="Docs"></a>
</p>

<p align="center">
  <a href="https://foli.josepaudenis.com/docs/">Docs</a> ·
  <a href="https://foli.josepaudenis.com/test/">Try the editor</a> ·
  <a href="docs/getting-started.md">Getting started</a> ·
  <a href="docs/limitations.md">Known limitations</a>
</p>

## Features

- **Real pages.** Paragraphs split across pages at a line; explicit page breaks; widow/orphan,
  keep-with-next and keep-lines-together; incremental reflow; print with one sheet per page.
- **Word's model** ([ADR-0005](docs/decisions/ADR-0005-word-compatible-model.md)). Paragraph
  styles (headings are Word's heading styles), lists as Word's numbering, fonts, sizes, line and
  paragraph spacing, indents, bold, italic, underline, strikethrough, links, text color,
  highlight, alignment. Undo/redo, IME, copy/cut/paste (HTML from Word, Google Docs and web pages
  mapped to the model).
- **Lossless `.docx`** (`@folijs/docx`). Import and export; what the editor does not model yet is
  kept and written back.
- **Review as in Word.** Tracked changes recorded while you type (insertions, deletions,
  formatting), shown as all, simple or no markup, accepted or rejected one by one, by selection,
  by author or all. Comments with replies and resolved state in a pane beside the pages. Both
  round-trip with Word.
- **Tables and pictures.** Tables split by row with repeated header rows, merged cells, table
  styles, cell selection, a table menu, tracked row changes. Inline and floating pictures
  (square, top and bottom, behind and in front of text), resized, inserted through an upload hook;
  alt text required in the picture dialog, pictures pasted without it are marked.
- **Sections, fields and templates.** Per-section page size, margins and columns; headers and
  footers (first, even, default) edited in place; footnotes and endnotes; fields (page numbers,
  dates, cross-references, tables of contents, merge fields); content controls (text, rich text,
  drop-down, combo box, date, check box, repeating sections); bookmarks, outline, find and replace
  across every story.
- **PDF** (`@folijs/pdf`). `exportPdf` prints Foli's own pages to PDF with a headless Chromium.
- **React** components with a toolbar and server rendering; a framework-free view too.
- **Extensions.** Custom nodes and marks on Word's schema with node and mark views, saved in the
  JSON and through `.docx` as tagged content controls; plugins with commands, keymaps,
  decorations, plugin views and toolbar items.
- **Agents** (0.x). `@folijs/agent` lets an LLM edit a document by block handles, and
  `@folijs/mcp` exposes `.docx` editing to MCP clients; every edit is a tracked change.

## Stability

Each package's public API, as its entry exports it and its API report records it, changes only by
semver: nothing removed or changed before 2.0, a removal deprecated first
([ADR-0008](docs/decisions/ADR-0008-1.0-contract-and-extensions.md),
[versions and deprecation](docs/deprecation.md)). Every 1.x reads every saved format from v1
(0.1.0) on; a document is saved with the lowest version its content needs, and an older 1.x
refuses, never drops, a document that needs a newer one. Moving from 0.x: the
[migration guide](docs/guides/migrating-from-0x.md).

> [!WARNING]
> The manual IME, screen-reader, macOS, real-paste and Safari checks have not been run on real
> devices, and at 100 pages the first layout, the re-flow and Enter miss Phase 5's speed targets
> (typing meets them in Chromium, not in Firefox). Read the [known limitations](docs/limitations.md)
> before using Foli.

## Quick start

```bash
npm install @folijs/react @folijs/view @folijs/core react react-dom
```

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
  return <FoliEditor initialContent={initial} placeholder="Start writing…" onChange={onChange} />;
}
```

[Getting started](docs/getting-started.md) covers loading and saving, read-only mode, your own
toolbar, Next.js and using the view without React. Before using Foli, read the
[known limitations](docs/limitations.md).

## Packages

| Package                              | Version                                                                                                               | Purpose                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [`@folijs/core`](packages/core)      | [![npm](https://img.shields.io/npm/v/@folijs/core?label=&color=1d1d1b)](https://www.npmjs.com/package/@folijs/core)   | Document model and headless editing engine: schema, nodes, steps, history, commands. No DOM.     |
| [`@folijs/view`](packages/view)      | [![npm](https://img.shields.io/npm/v/@folijs/view?label=&color=1d1d1b)](https://www.npmjs.com/package/@folijs/view)   | Framework-agnostic editable DOM view (`EditorView`): rendering, input, selection.                |
| [`@folijs/react`](packages/react)    | [![npm](https://img.shields.io/npm/v/@folijs/react?label=&color=1d1d1b)](https://www.npmjs.com/package/@folijs/react) | React components and default stylesheet.                                                         |
| [`@folijs/docx`](packages/docx)      | [![npm](https://img.shields.io/npm/v/@folijs/docx?label=&color=1d1d1b)](https://www.npmjs.com/package/@folijs/docx)   | `.docx` import to Foli's Word model and lossless export. No DOM.                                 |
| [`@folijs/pdf`](packages/pdf)        | [![npm](https://img.shields.io/npm/v/@folijs/pdf?label=&color=1d1d1b)](https://www.npmjs.com/package/@folijs/pdf)     | PDF from Foli's pages (`exportPdf`), printed by a headless Chromium page the app supplies.       |
| [`@folijs/agent`](packages/agent)    | [![npm](https://img.shields.io/npm/v/@folijs/agent?label=&color=1d1d1b)](https://www.npmjs.com/package/@folijs/agent) | An LLM agent reads and edits a document by block handles; every edit a tracked change. 0.x.      |
| [`@folijs/mcp`](packages/mcp)        | [![npm](https://img.shields.io/npm/v/@folijs/mcp?label=&color=1d1d1b)](https://www.npmjs.com/package/@folijs/mcp)     | MCP server: an MCP client's model edits `.docx` files in a folder through tools. 0.x.            |
| [`apps/playground`](apps/playground) |                                                                                                                       | Demo app; consumes the packages like a third party would.                                        |
| [`apps/site`](apps/site)             |                                                                                                                       | Landing page, the real editor at `/test`, the docs at `/docs`; `pnpm --filter @folijs/site dev`. |

## Documentation

The docs site, [foli.josepaudenis.com/docs](https://foli.josepaudenis.com/docs/), has these
pages, the API reference per package (from the API reports), live examples, search and the
changelogs. Using Foli:

- [Getting started](docs/getting-started.md)
- [API reference](docs/api.md)
- [Keyboard](docs/keyboard.md) — every key per platform, which a plugin can override
- [Styling](docs/styling.md) — CSS variables, classes, print
- [Theming](docs/guides/theming.md) — a complete theme, dark, print colors, forced colors
- [Extensions](docs/guides/extensions.md) — custom nodes and marks, plugins, commands, keys, toolbar items
- [Migrating from 0.x](docs/guides/migrating-from-0x.md)
- [Versions and deprecation](docs/deprecation.md) — what 1.0 promises, the saved format
- [Known limitations](docs/limitations.md)
- [Security](docs/security.md) — what is checked, what is the app's job, how to report a vulnerability

Design and development:

- [Roadmap](docs/roadmap.md) — phases, gates, acceptance criteria
- [Architecture](docs/architecture.md) — subsystems, packages, dependency policy, risks
- [ADR-0002: Foli owns its editing engine](docs/decisions/ADR-0002-own-editing-engine.md)
- [Document model](docs/document-model.md) — persisted format, schema v5 (Word's model), units, migrations from v1 to v4
- [Benchmarks](docs/benchmarks.md) — model build/serialize and pagination (layout, keystroke, re-flow) timings, bundle sizes, with method
- [Examples](examples/README.md) — Vite + React 18, Next.js + React 19, an extension and a framework-free app installing the packed packages
- [Pagination](docs/pagination.md) — native multi-page editing: design and what is built (Phase 5 on; sections, columns, headers, footers and notes in Phase 11)
- [Contributing](docs/contributing.md)

## Development

```bash
pnpm install
pnpm dev     # playground
pnpm check   # lint, typecheck, tests, build, package checks, API reports, sizes
```

## License

[MIT](LICENSE) © 2026 Josep Audenis
