# Architecture

Foli is an embeddable, Word-like document editor for React: structured documents, real pages,
an extensible core, and (later, where measured to help) Rust/WASM processing.

This document describes **what exists** and **what is decided**. Planned work is marked as such.

## Foundation

Tiptap 3 (MIT packages only) on ProseMirror. Rationale and comparison with direct
ProseMirror and Lexical: [ADR-0001](decisions/ADR-0001-editor-foundation.md).

ProseMirror owns: selection, IME, transactions, undo/redo, clipboard parsing, DOM rendering of
content. Foli owns: the document envelope, the extension set, pagination, React integration, UI.

## Packages

```
foli/
├── apps/
│   └── playground/        Vite demo. Consumes packages by name only; no editing logic lives here.
├── packages/
│   ├── core/    @foli/core    Framework-agnostic: document envelope, schema (extension set),
│   │                          validation/parsing, page geometry. No DOM required.
│   └── react/   @foli/react   React components + default stylesheet (@foli/react/styles.css).
└── docs/
```

Dependency direction: `playground → react → core → @tiptap/*`. Never the reverse.

### Deliberately not created yet

| Proposed                            | Decision                                                                                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/pagination`               | Created in Phase 2 with the first pagination code. It is a ProseMirror plugin (DOM-bound but framework-agnostic), so it belongs neither in `core` (no DOM) nor in `react`. |
| `packages/ui`                       | Folded into `@foli/react`. The toolbar/menus are React components; a separate package has no consumer until a non-React UI exists.                                         |
| `packages/wasm`, `crates/*`         | Deferred until a feature with benchmarks justifies Rust (see below).                                                                                                       |
| `apps/docs`, `examples/nextjs`      | Phase 6. A Next.js example is useful earlier as an SSR smoke test; may move up.                                                                                            |
| `tests/`, `benchmarks/` (top level) | Unit tests live next to code. Playwright e2e and benchmarks get folders when introduced.                                                                                   |

## Build and dev wiring

- Each package exports an `@foli/source` condition pointing at `src/index.ts`. The playground
  (Vite), Vitest and `tsc --noEmit` resolve that condition, so dev and tests run on source with
  no build step, while still importing through package names.
- `pnpm build` runs `tsc` per package (topological order) to `dist/` with `.d.ts`. Build configs
  drop the custom condition so published types point at `dist`.
- Packages are ESM-only, `sideEffects` declared, React/Tiptap as peers.

## React integration

Current: `<DocumentEditor initialContent onChange />`, **uncontrolled**. The editor owns
document state; the parent observes changes. `initialContent` is read once; load another
document by remounting with a new `key`.

Planned (Phase 1):

- `useDocumentEditor(options)` → editor handle; `DocumentEditorProvider`, `DocumentCanvas`,
  `DocumentToolbar` for composition; `<DocumentEditor>` stays as the batteries-included wrapper.
- External replacement via an imperative `setDocument()` (no history entry) rather than
  controlled props.
- **Not supported:** a fully controlled `value` prop. Re-feeding the document on each keystroke
  forces whole-document diffing and parent re-renders; it is the main performance trap of
  React editors.
- `onChange` receives transaction metadata later (origin, whether doc changed) for autosave.
- SSR: Tiptap needs `immediatelyRender: false` under Next.js; add with the Next.js example.

## Styling

Plain CSS with custom properties (`--foli-*`) scoped to `.foli-canvas`. No CSS framework.
Page geometry is applied in `mm` units straight from document settings.

## Rust / WebAssembly strategy

No Rust today. Rules for introducing it:

1. A concrete feature needs it, and a TypeScript baseline has been benchmarked (including
   serialization across the JS/WASM boundary, WASM init time, memory).
2. Coarse-grained API (whole operations, batches), run in a Web Worker where it can block.
3. Never for selection, DOM events, rendering, or text measurement.

Realistic first candidates, in order: DOCX import/export (zip + XML processing, also usable
server-side), batch transformations/validation for server pipelines. Pagination math is not a
candidate (DOM measurement dominates). Note: `docx` (MIT) already covers JS-side DOCX generation
and must be the baseline to beat.

## Risk register

| Area                   | Risk                                                                                  | Mitigation                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Pagination feasibility | Decoration-based layout may hit edge cases (caret over spacers, justified lines, IME) | Staged: block-level first, line-level after; Playwright tests in 3 engines; see [pagination.md](pagination.md)             |
| Cross-page selection   | Must work by construction (one doc); risk is spacer widgets interfering               | Widgets with `ignoreSelection`, `aria-hidden`, e2e tests dragging selection across pages                                   |
| Undo history           | Layout transactions must never enter history                                          | All layout dispatches set `addToHistory: false`; unit test that undo after repagination restores the edit, not the layout  |
| DOM measurement        | Layout thrash; measuring before fonts/images load                                     | rAF-batched read phase, then one write; repaginate on font/image load                                                      |
| Font metrics           | Different fonts per OS → different pagination                                         | Bundle default fonts; visual tests in pinned containers; document that pagination is per-environment                       |
| Large documents        | O(n) measurement and decoration sets                                                  | Node-identity height cache, incremental recompute; benchmarks at 1/10/50/100+ pages before any optimization                |
| DOCX compatibility     | Word layout is not reproducible in browsers; DOCX features are vast                   | Target content fidelity, not pagination fidelity; test against real Word/LibreOffice files; never claim full compatibility |
| Dependencies           | Tiptap features moving to paid tiers; Lexical alternative is pre-1.0                  | Use only MIT packages; we can always drop to raw ProseMirror                                                               |
| Tooling                | TypeScript 7 (native) and Vite 8 (Rolldown) are new majors                            | Both pass today; if a tool breaks, pin TypeScript 5.9 / Vite 7 rather than work around                                     |
