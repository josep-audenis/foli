# Foli

An open-source document-editing engine for the web, built from the ground up: its own document
model, transactions, view and layout, designed around native pagination, with first-class React
integration.

> **Status: 0.6.0 ([npm](https://www.npmjs.com/package/@folijs/react)).** Foli edits documents
> with its own model, engine and view (no ProseMirror/Tiptap/Lexical) on real pages: paragraphs
> split across pages at a line, explicit page breaks, widow/orphan, keep-with-next and
> keep-lines-together rules, incremental reflow, print with one sheet per page. Documents use
> Word's model ([ADR-0005](docs/decisions/ADR-0005-word-compatible-model.md)): paragraph styles
> (headings are Word's heading styles), lists as Word's numbering, fonts, sizes, line and
> paragraph spacing, indents; bold, italic, underline, strikethrough, links, text color,
> highlight; alignment; undo/redo; IME; copy/cut/paste (HTML from Word, Google Docs and web
> pages mapped to the model). Each section is laid out with its own page size and margins.
> `.docx` import and lossless export (`@folijs/docx`): what the editor does not model yet is
> kept and written back. Review as in Word (0.4.0): tracked
> changes recorded while you type (insertions, deletions, formatting), shown as all markup, simple
> markup or no markup, accepted and rejected one by one, by selection, by author or all; comments
> with replies and resolved state in a pane beside the pages; both round-trip with Word. Tables
> and pictures as Word models them (0.5.0): tables split across pages by row with repeated
> header rows, merged cells, table styles, cell selection, table commands and a table menu,
> tracked row changes; inline and floating pictures (square, top and bottom, behind and in front
> of text), resized, inserted through an upload hook; alt text is required in the picture dialog,
> and a picture pasted or dropped without it is marked. Sections, fields, templates and PDF
> (0.6.0): sections with their own page setup and columns, section breaks; headers and footers
> (first, even and default) edited in place on the pages; footnotes and endnotes at their pages'
> foot; fields shown with their results and updated from the pages (page numbers, dates,
> cross-references, tables of contents, merge fields from data); content controls (text, rich
> text, drop-down, combo box, date, check box, repeating sections) filled from the UI or the API;
> bookmarks, the document outline, find and replace across every story; `exportPdf`
> (`@folijs/pdf`) prints Foli's own pages to PDF with a headless Chromium. React components
> with a toolbar and server rendering. Documents saved by 0.1.0 to 0.5.0 are migrated on load;
> 0.5.0 cannot read documents saved by 0.6.0. The API may change in any 0.x version. Manual IME,
> screen-reader and real-paste checks are not run yet: read the
> [known limitations](docs/limitations.md). Next: the extension API, docs site and 1.0
> (Phase 12, [roadmap](docs/roadmap.md)).

## Usage

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

| Package                              | Purpose                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| [`@folijs/core`](packages/core)      | Document model and headless editing engine: schema, nodes, steps, history, commands. No DOM.     |
| [`@folijs/view`](packages/view)      | Framework-agnostic editable DOM view (`EditorView`): rendering, input, selection.                |
| [`@folijs/react`](packages/react)    | React components and default stylesheet.                                                         |
| [`@folijs/docx`](packages/docx)      | `.docx` import to Foli's Word model and lossless export. No DOM.                                 |
| [`@folijs/pdf`](packages/pdf)        | PDF from Foli's pages (`exportPdf`), printed by a headless Chromium page the app supplies.       |
| [`apps/playground`](apps/playground) | Demo app; consumes the packages like a third party would.                                        |
| [`apps/site`](apps/site)             | Landing page, the real editor at `/test`, the docs at `/docs`; `pnpm --filter @folijs/site dev`. |

## Documentation

Using Foli:

- [Getting started](docs/getting-started.md)
- [API reference](docs/api.md)
- [Keyboard](docs/keyboard.md) — every key per platform, which a plugin can override
- [Styling](docs/styling.md) — CSS variables, classes, print
- [Theming](docs/guides/theming.md) — a complete theme, dark, print colors, forced colors
- [Extensions](docs/guides/extensions.md) — custom nodes and marks, plugins, commands, keys, toolbar items
- [Migrating from 0.x](docs/guides/migrating-from-0x.md)
- [Versions and deprecation](docs/deprecation.md) — what 1.0 promises, the saved format
- [Known limitations](docs/limitations.md)

Design and development:

- [Roadmap](docs/roadmap.md) — phases, gates, acceptance criteria
- [Architecture](docs/architecture.md) — subsystems, packages, dependency policy, risks
- [ADR-0002: Foli owns its editing engine](docs/decisions/ADR-0002-own-editing-engine.md)
- [Document model](docs/document-model.md) — persisted format, schema v5 (Word's model), units, migrations from v1 to v4
- [Benchmarks](docs/benchmarks.md) — model build/serialize and pagination (layout, keystroke, re-flow) timings, bundle sizes, with method
- [Examples](examples/README.md) — Vite + React 18 and Next.js + React 19 apps installing the packed packages
- [Pagination](docs/pagination.md) — native multi-page editing: design and what is built (Phase 5 on; sections, columns, headers, footers and notes in Phase 11)
- [Contributing](docs/contributing.md)

## Development

```bash
pnpm install
pnpm dev     # playground
pnpm check   # lint, typecheck, tests, build, package checks, API reports, sizes
```

## License

MIT
