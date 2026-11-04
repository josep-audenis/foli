# Foli

An open-source, embeddable, Word-like document editor for React: structured documents,
real pages, extensible core.

> **Status: pre-alpha (Phase 0 done).** The current editor is a walking skeleton: StarterKit
> formatting via keyboard shortcuts, one A4-sized page, JSON load/save. No toolbar or
> pagination yet. See [docs/roadmap.md](docs/roadmap.md). Not published to npm yet.

## Usage (current API)

```tsx
import { createDocument, parseDocument } from "@foli/core";
import { DocumentEditor } from "@foli/react";
import "@foli/react/styles.css";

export function App() {
  return (
    <DocumentEditor
      initialContent={createDocument()} // or parseDocument(JSON.parse(saved))
      onChange={(doc) => save(JSON.stringify(doc))}
    />
  );
}
```

Peer dependencies: `react`, `react-dom`, `@tiptap/core`, `@tiptap/pm`.

## Packages

| Package                              | Purpose                                                       |
| ------------------------------------ | ------------------------------------------------------------- |
| [`@foli/core`](packages/core)        | Document envelope, schema, validation, page geometry. No DOM. |
| [`@foli/react`](packages/react)      | React components and default stylesheet.                      |
| [`apps/playground`](apps/playground) | Demo app; consumes the packages like a third party would.     |

## Documentation

- [Architecture](docs/architecture.md) — packages, boundaries, React and Rust strategy, risks
- [ADR-0001: editor foundation](docs/decisions/ADR-0001-editor-foundation.md) — Tiptap vs ProseMirror vs Lexical
- [Document model](docs/document-model.md) — persisted format, units, migrations
- [Pagination](docs/pagination.md) — design for multi-page editing (not implemented yet)
- [Roadmap](docs/roadmap.md) — phases and acceptance criteria
- [Contributing](docs/contributing.md)

## Development

```bash
pnpm install
pnpm dev     # playground
pnpm check   # lint + typecheck + test + build
```

## License

MIT
