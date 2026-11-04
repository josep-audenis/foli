# Foli — agent notes

Independent document-editing engine for the web (own model, transactions, view, layout) with
React integration. Read `docs/architecture.md` before structural changes, `docs/roadmap.md` for
the current phase and its gates, ADR-0002 for why there is no editor-engine dependency.

## Starting a session

1. Fresh checkout or worktree: run `pnpm install` (node_modules is not shared). `graphify-out/`
   and `.claude/settings.local.json` are local and may be missing; if so, skip graphify or run
   `graphify update .` to build the graph.
2. Read the **Status** table in `docs/roadmap.md`. Work only on a phase marked `Ready` or one
   you were explicitly assigned; follow "Working on a phase" there (claim → plan → build → close).
3. Work on the phase branch `phase-<n>/<slug>`, never directly on `main`. Merge via PR.
4. Before finishing: `pnpm check` green, docs updated to match reality, roadmap status and task
   checklist updated, commit pushed.

## Commands

- `pnpm check` — lint + typecheck + test + build. Runs as a local pre-push hook (installed by `pnpm install`; no GitHub CI). Run before declaring done.
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm dev`.

## Conventions

- Packages: `packages/core` (no DOM), `packages/view` (DOM, framework-agnostic), `packages/react`.
  Playground holds no engine logic.
- Imports between packages go through package names; the `@foli/source` export condition maps
  them to `src/` in dev/test/typecheck. Relative imports inside a package use `.js` extensions (NodeNext).
- Document content = `{type, attrs, content, text, marks}` JSON inside the `FoliDocument`
  envelope. Never parse the DOM as truth. Never use `innerHTML` with document or pasted data.
- Format changes bump `SCHEMA_VERSION` + migration (after first release). Never silently drop content.
- No editor-engine dependencies (ProseMirror, Tiptap, Lexical, Slate, Quill, CKEditor…). Reading
  their source is fine; copied code needs an entry in `THIRD_PARTY_NOTICES.md`. Check licenses
  for any new dependency.
- Do not start a roadmap phase whose gate predecessor has not passed.
- No Rust/WASM until a benchmarked feature needs it.
- Keep docs truthful: planned ≠ implemented.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
