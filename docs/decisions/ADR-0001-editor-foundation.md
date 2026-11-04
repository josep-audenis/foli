# ADR-0001: Editor foundation

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

Foli needs a mature rich-text engine (selection, IME, transactions, undo, clipboard) so we
can spend our effort on the differentiator: paginated, Word-like document editing. Building
our own editing engine is an explicit non-goal.

The engine must allow a **single continuous document** to be shown as multiple pages without
fragmenting selection, undo history, or the document model (see [pagination.md](../pagination.md)).
That requires low-level control over rendering: injecting non-document visual elements
(page gaps, spacers, page chrome) that the engine ignores for editing and history purposes.

## Options

Versions and licenses checked on npm on 2026-11-04.

| Criterion               | Tiptap 3 (OSS parts)                                                                                                  | Direct ProseMirror                                                          | Lexical                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Version / maturity      | 3.32, stable, large ecosystem                                                                                         | prosemirror-model 1.25 / view 1.42, very stable, ~10 years                  | 0.53, **still pre-1.0**, API churn between minors                                                                              |
| License                 | MIT (core, react, starter-kit, extensions). **Pro features (Pages, DOCX import/export, comments, AI) are commercial** | MIT                                                                         | MIT                                                                                                                            |
| Editing capabilities    | Everything ProseMirror has, plus ready nodes/marks/commands                                                           | Complete, but every node/command/input rule hand-built                      | Complete; different model (own node classes, own reconciler)                                                                   |
| Pagination feasibility  | Good: full access to ProseMirror decorations, plugins, node views                                                     | Good: same primitives, no wrapper                                           | Weaker: Lexical owns DOM reconciliation; injecting layout-only DOM between blocks is less supported; thin pagination ecosystem |
| Extension model         | Strong (`Extension`, `Node`, `Mark`, commands, keyboard shortcuts, priority)                                          | Plugins/schema composition; we would have to design our own extension layer | Plugins + node classes; reasonable                                                                                             |
| React integration       | Official `@tiptap/react` (`useEditor`, `EditorContent`, node views)                                                   | Community bindings only; we would write our own                             | Excellent, React-first                                                                                                         |
| Serialization           | ProseMirror JSON (schema-checked)                                                                                     | ProseMirror JSON                                                            | Lexical JSON (different shape)                                                                                                 |
| Maintenance cost for us | Low; risk is vendor direction and features moving to paid tiers                                                       | Highest (we maintain the glue Tiptap gives for free)                        | Medium; pre-1.0 churn                                                                                                          |
| Long-term flexibility   | High: we can always drop down to raw ProseMirror APIs (`@tiptap/pm`)                                                  | Highest                                                                     | Medium                                                                                                                         |

Prior art for pagination (open source, verified licenses):

- `tiptap-pagination-plus` (MIT), `tiptap-extension-pagination` (ISC), `prosemirror-pagination` (MIT):
  decoration-based approaches on a single document. Useful references; quality and edge-case
  coverage to be evaluated before reuse.
- SuperDoc (`@harbour-enterprises/superdoc`): **AGPL-3.0**, not usable as a dependency for an
  MIT library.
- CKEditor 5 pagination: commercial license. Tiptap Pages: commercial. Not usable.

## Decision

Use **Tiptap 3 (MIT packages only) on top of ProseMirror**. Implement pagination ourselves as
ProseMirror plugins/decorations, using `@tiptap/pm` directly where Tiptap has no abstraction.

- We never depend on a Tiptap Pro / paid package.
- Our extension API **is** the Tiptap extension API for now. We do not wrap it; a wrapper
  would be a premature abstraction with no user. Consequence: a Tiptap major version is a Foli
  breaking change.
- `@tiptap/core` and `@tiptap/pm` are **peer dependencies** of our packages so applications
  get exactly one copy of ProseMirror.

## Consequences

- Fast start: StarterKit gives paragraphs, headings, marks, lists, links, undo/redo.
- Pagination risk stays ours, but the primitives (decorations excluded from the doc and the
  undo history) fit the "continuous document, paginated presentation" design.
- Reconsider if: Tiptap moves core capabilities we rely on behind a paid tier, or
  decoration-based pagination proves unworkable (see open questions in pagination.md).
