# Foli

An open-source document-editing engine for the web, built from the ground up: its own document
model, transactions, view and layout, designed around native pagination, with first-class React
integration.

> **Status: pre-alpha — engine under construction.** Foli edits documents with its own model,
> engine and view (no ProseMirror/Tiptap/Lexical) on one page-sized sheet: typing, Enter,
> Backspace, bold/italic/underline shortcuts, undo/redo. Not yet: paste, IME composition,
> pagination. See [docs/roadmap.md](docs/roadmap.md). Not published to npm yet.

## Usage (current, provisional API)

```tsx
import { createDocument, parseDocument } from "@foli/core";
import { DocumentEditor } from "@foli/react";
import "@foli/react/styles.css";

const doc = parseDocument(JSON.parse(saved)); // throws FoliDocumentError on invalid input
// or: createDocument({ type: "doc", content: [{ type: "paragraph" }] })

export function App() {
  return <DocumentEditor initialContent={doc} onChange={(next) => save(JSON.stringify(next))} />;
}
```

Peer dependencies: `react`, `react-dom`.

## Packages

| Package                              | Purpose                                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| [`@foli/core`](packages/core)        | Document model and headless editing engine: schema, nodes, steps, history, commands. No DOM. |
| [`@foli/view`](packages/view)        | Framework-agnostic editable DOM view (`EditorView`): rendering, input, selection.            |
| [`@foli/react`](packages/react)      | React components and default stylesheet.                                                     |
| [`apps/playground`](apps/playground) | Demo app; consumes the packages like a third party would.                                    |

## Documentation

- [Roadmap](docs/roadmap.md) — phases, gates, acceptance criteria
- [Architecture](docs/architecture.md) — subsystems, packages, dependency policy, risks
- [ADR-0002: Foli owns its editing engine](docs/decisions/ADR-0002-own-editing-engine.md)
- [Document model](docs/document-model.md) — persisted format, schema v1, units, migrations
- [Benchmarks](docs/benchmarks.md) — model build/serialize timings with method
- [Pagination](docs/pagination.md) — design for native multi-page editing (not implemented yet)
- [Contributing](docs/contributing.md)

## Development

```bash
pnpm install
pnpm dev     # playground
pnpm check   # lint + typecheck + test + build
```

## License

MIT
