# Document model

> Status: envelope and schema v1 validation implemented in `@foli/core`
> (`packages/core/src/document.ts`, `packages/core/src/schema.ts`). The full model (immutable
> nodes, positions, steps) is Phase 2–3 of the [roadmap](roadmap.md).

## Canonical form

A persisted Foli document is a versioned **envelope** around a JSON content tree:

```ts
interface FoliDocument {
  schemaVersion: 1;
  settings: {
    pageSize: { width: number; height: number }; // mm
    margins: { top: number; right: number; bottom: number; left: number }; // mm
  };
  content: DocJSON; // root node of type "doc"
}
```

Rules:

1. `content` is the **only** source of truth for document content. The rendered DOM is never
   parsed back as truth; pages are never stored.
2. The content is one continuous `doc` regardless of how many pages it occupies.
3. `parseDocument(input)` is the trust boundary for loading. Unknown node types, marks,
   attributes or keys throw `FoliDocumentError` with a JSON path
   (e.g. `content.content[2].content[0].marks[0].type: unknown mark type "code"`). Content is
   never silently dropped or "repaired".

## Content JSON shape

Every node is `{ type, attrs?, content?, text?, marks? }`. This shape is permanent: it is
familiar to developers who know ProseMirror-style JSON and simple for Rust and other consumers.

## Schema v1

| Node        | Group  | Content            | Attrs                             |
| ----------- | ------ | ------------------ | --------------------------------- |
| `doc`       | root   | one or more blocks | —                                 |
| `paragraph` | block  | inline\*           | —                                 |
| `heading`   | block  | inline\*           | `level`: 1–6 (required)           |
| `text`      | inline | —                  | `text`: non-empty string, `marks` |
| `hardBreak` | inline | —                  | —                                 |

Marks: `bold`, `italic`, `underline`, `strike` (no attributes; each at most once per text node).

v1 may still change until the first published release (nothing has been published, so no
migration is owed yet). Planned before 0.1: `pageBreak` block node.

## Model concepts (Phase 2–3, not implemented)

- **Immutable tree** with structural sharing: an edit creates new nodes along the changed path;
  unchanged nodes are reused, which makes identity a free cache key for rendering and layout.
- **Integer positions**: every position in the document is a number. Entering or leaving a
  non-leaf node counts 1; each character counts 1; a leaf node counts 1. `ResolvedPos` gives the
  tree context (depth, parent, index, offset) for a position.
- **Steps**: every change is a step (replace, add/remove mark, set attribute) that can be
  applied, inverted, and produces a **position map**. Mapping keeps selections, undo history,
  cursor positions across reflow, and future collaboration consistent.
- **Normalization**: adjacent text nodes with equal marks merge; marks are kept in canonical
  order. The serialized form is therefore canonical.

## Why page size is width/height, not a preset name

`pageSize` stores resolved dimensions. `PAGE_SIZES.A4` / `PAGE_SIZES.Letter` are helpers.
This avoids invalid states such as `"custom"` without dimensions or an `orientation` that
contradicts the numbers. Orientation is derived (`width > height` = landscape).

## Units

Canonical unit: **millimetres** for all page geometry.

| Target               | Conversion                                                                              |
| -------------------- | --------------------------------------------------------------------------------------- |
| CSS                  | use `mm` directly (`210mm`); browsers map 1mm = 96/25.4 px ≈ 3.7795 CSS px at 100% zoom |
| CSS px (layout math) | `px = mm × 96 / 25.4`                                                                   |
| DOCX (twips)         | `twip = mm × 1440 / 25.4` (≈ 56.69 per mm)                                              |
| DOCX drawings (EMU)  | `emu = mm × 36000`                                                                      |
| PDF (points)         | `pt = mm × 72 / 25.4`                                                                   |

Font sizes inside content use points (pt), matching word processors.

## Versioning and migrations

After the first release, `schemaVersion` is bumped whenever the envelope or content schema
changes incompatibly (renamed node, changed attribute meaning). `parseDocument` then runs
migrations `vN → vN+1` before validation. Old documents must keep loading. The first planned
migration is v1 → v2 for lists and links (Phase 7).

## Planned envelope additions (not implemented)

Each added only when a feature needs it, with a migration:

- `metadata` (title, author, timestamps, app-defined fields).
- `styles` (named paragraph/character styles) — Phase 9.
- `headers` / `footers` as separate content trees — Phase 9.
- `resources` (image references by id, no inline binary) — Phase 8.
- Extension-owned data under a namespaced key.

## Open questions

- Generate a JSON Schema from the TypeScript schema so Rust and other consumers validate the
  same format (Phase 10).
- Key order in serialized JSON for diff-friendly storage: make `toJSON` emit a fixed order and
  test it (Phase 2).
