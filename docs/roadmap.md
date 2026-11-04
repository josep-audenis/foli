# Roadmap

Each phase ends with a working, tested playground. Later phases do not start until the
previous phase's acceptance criteria pass.

## Phase 0 — Foundation ✅

- [x] Architecture, ADR-0001, document model, pagination design.
- [x] pnpm monorepo, TypeScript strict, Biome, Vitest, CI.
- [x] Walking skeleton: `@foli/core` (envelope, schema, `parseDocument`), `@foli/react`
  (`DocumentEditor`, A4 page styling), playground with localStorage autosave.

## Phase 1 — Core editor MVP

**MVP definition:** the smallest version a developer would install. A developer can install
`@foli/react`, render an editor, create formatted content, undo, serialize, and reload without
losing content.

Essential (in MVP):

- Paragraphs, headings 1–3, bold, italic, underline, strikethrough, text color, highlight,
  alignment, ordered/bullet lists, links, horizontal rule, `pageBreak` node (stored; honored
  visually in Phase 2), hard breaks.
- Undo/redo, keyboard shortcuts, paste sanitized by the schema.
- Toolbar (accessible: roving tabindex, `aria-pressed`, labels, visible focus).
- `useDocumentEditor`, provider, `DocumentCanvas`, `DocumentToolbar`, `DocumentEditor`.
- JSON serialization via `FoliDocument`.

Not in MVP: tables, images, styles, headers/footers, DOCX, PDF export, collaboration, AI.

Tasks, in order (each leaves the build green):

1. Extend `createExtensions()`: TextAlign, TextStyle + Color, Highlight; custom `pageBreak`
   node. Round-trip tests for every node/mark.
2. `useDocumentEditor` + `DocumentEditorProvider` + `DocumentCanvas`; rebuild `DocumentEditor`
   on top of them. `setDocument()` for external replacement (no history entry).
3. `DocumentToolbar` with active-state tracking (`useEditorState` to avoid re-render storms).
4. Command tests (formatting, undo/redo) in Vitest via headless editor.
5. Paste tests: hostile HTML (scripts, styles, unknown tags) is reduced to schema content.
6. Playwright: typing, shortcuts, undo/redo, reload-preserves-content in the playground.
7. Packaging check: `pnpm pack`, install tarballs into a fresh Vite app, render + type.
   Add Changesets for versioning.
8. README usage docs for the public API.

Acceptance: all of the above tested; the packaging check passes; no editing logic in the
playground.

## Phase 2 — Initial document layout

Depends on Phase 1. Creates `@foli/pagination`.

- Page gap spacers between top-level blocks, page chrome layer, explicit page breaks.
- Configurable page size/margins from settings (A4, Letter, custom).
- Tests: `computePageBreaks` unit tests with fixtures (short, multi-page, headings near
  boundaries, explicit breaks, mixed font sizes, margins); Playwright for caret movement,
  selection and undo across page boundaries.

Acceptance: multi-page documents with block-level breaks; selection/undo/copy across pages
pass e2e in Chromium, Firefox, WebKit; known limitations documented.

## Phase 3 — Mature pagination

Line-level paragraph splitting, keep-with-next, widow/orphan, incremental repagination,
page numbers, headers/footers, print consistency, benchmarks at 1/10/50/100+ pages
(reported with hardware, browser, dataset, method).

## Phase 4 — First Rust/WASM capability

Only with a benchmark-backed candidate (likely DOCX processing). TS baseline first; WASM in a
worker; before/after numbers published.

## Phase 5 — Professional document features

Tables (with page continuation), images, named styles, navigation/outline, richer import/export.

## Phase 6 — Developer ecosystem

Docs site, Next.js example, stable API (1.0), theming guide, custom extension guide, release
automation, contributor onboarding.

## Phase 7 — Optional

Collaboration (Yjs), comments, tracked changes, AI-assisted editing, server-side processing.
