# Foli

An open-source document-editing engine for the web, built from the ground up: its own document
model, transactions, view and layout, designed around native pagination, with first-class React
integration.

> **Status: pre-alpha — engine under construction.** Foli edits documents with its own model,
> engine and view (no ProseMirror/Tiptap/Lexical) on real pages: paragraphs split across pages
> at a line, explicit page breaks, widow/orphan and keep-with-next rules, incremental reflow,
> print with one sheet per page. Typing, Enter, Backspace, bold/italic/underline shortcuts,
> undo/redo, IME and dead keys (automated tests only; manual checks pending, also at page
> breaks), copy/cut/paste (HTML mapped to the schema; pastes from real Word and Google Docs not
> yet verified). React components with a toolbar, server rendering, and per-package docs. Next:
> the first release, 0.1.0 (Phase 6). See [docs/roadmap.md](docs/roadmap.md).
> Not published to npm yet.

## Usage

```bash
npm install @foli/react @foli/core react react-dom
```

```tsx
import { createDocument, parseDocument } from "@foli/core";
import { type FoliChange, FoliEditor } from "@foli/react";
import "@foli/react/styles.css";

// Load: parseDocument validates the saved JSON (throws FoliDocumentError when invalid).
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

| Package                              | Purpose                                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| [`@foli/core`](packages/core)        | Document model and headless editing engine: schema, nodes, steps, history, commands. No DOM. |
| [`@foli/view`](packages/view)        | Framework-agnostic editable DOM view (`EditorView`): rendering, input, selection.            |
| [`@foli/react`](packages/react)      | React components and default stylesheet.                                                     |
| [`apps/playground`](apps/playground) | Demo app; consumes the packages like a third party would.                                    |

## Documentation

Using Foli:

- [Getting started](docs/getting-started.md)
- [API reference](docs/api.md)
- [Styling](docs/styling.md) — CSS variables, dark theme, print
- [Known limitations](docs/limitations.md)

Design and development:

- [Roadmap](docs/roadmap.md) — phases, gates, acceptance criteria
- [Architecture](docs/architecture.md) — subsystems, packages, dependency policy, risks
- [ADR-0002: Foli owns its editing engine](docs/decisions/ADR-0002-own-editing-engine.md)
- [Document model](docs/document-model.md) — persisted format, schema v1, units, migrations
- [Benchmarks](docs/benchmarks.md) — model build/serialize and pagination (layout, keystroke, re-flow) timings, bundle sizes, with method
- [Examples](examples/README.md) — Vite + React 18 and Next.js + React 19 apps installing the packed packages
- [Pagination](docs/pagination.md) — native multi-page editing: design and what is built (Phase 5)
- [Contributing](docs/contributing.md)

## Development

```bash
pnpm install
pnpm dev     # playground
pnpm check   # lint + typecheck + test + build
```

## License

MIT
