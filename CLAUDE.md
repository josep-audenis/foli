# Foli — agent notes

Embeddable Word-like document editor for React. Tiptap 3 (MIT only) on ProseMirror.
Read `docs/architecture.md` before structural changes; `docs/roadmap.md` for current phase.

## Commands

- `pnpm check` — lint + typecheck + test + build (what CI runs). Run before declaring done.
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm dev`.

## Conventions

- Packages: `packages/core` (no DOM), `packages/react`. Playground holds no editing logic.
- Imports between packages go through package names; the `@foli/source` export condition maps
  them to `src/` in dev/test/typecheck. Relative imports inside a package use `.js` extensions (NodeNext).
- Document content = ProseMirror JSON inside the `FoliDocument` envelope. Never parse the DOM as truth.
- Format changes bump `SCHEMA_VERSION` + migration. Never silently drop content.
- No Tiptap Pro / paid packages. Check licenses for any new dependency.
- No Rust/WASM until a benchmarked feature needs it.
- Keep docs truthful: planned ≠ implemented.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
