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
> yet verified). Next: the React API and the first release (Phase 6). See
> [docs/roadmap.md](docs/roadmap.md).
> Not published to npm yet.

## Usage

```tsx
import { createDocument, parseDocument } from "@foli/core";
import { type FoliChange, FoliEditor } from "@foli/react";
import "@foli/react/styles.css";

const doc = parseDocument(JSON.parse(saved)); // throws FoliDocumentError on invalid input
// or: createDocument({ type: "doc", content: [{ type: "paragraph" }] })

// `change.document` is serialized when read: read it when saving, not on every keystroke.
let latest: FoliChange | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
function onChange(change: FoliChange) {
  latest = change;
  clearTimeout(timer);
  timer = setTimeout(() => save(JSON.stringify(latest?.document)), 500);
}

export function App() {
  return <FoliEditor initialContent={doc} onChange={onChange} />;
}
```

`FoliEditor` shows a formatting toolbar (`toolbar={false}` hides it); a `ref` gives its
`editor` (e.g. `ref.current.editor.setDocument(doc)`) and `focus()`. Build your own layout from
the parts: `useFoliEditor()` creates an editor, `<FoliEditorProvider editor>` shares it,
`<FoliToolbar />` and `<FoliCanvas />` show it (with `<FoliCanvas readOnly />`, pass
`<FoliToolbar disabled />` too), `useCurrentEditor()` reads it and
`useEditorState(selector)` re-renders a component only when its slice of the state changes.
Server rendering works (the editor appears on hydration; its content is not in the server
HTML). The API is not stable before 0.1.0.

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
