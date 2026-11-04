# Document model

> Status: implemented in `@foli/core` (`packages/core/src/document.ts`), schema version 1.

## Canonical form

A persisted Foli document is a small versioned **envelope** around ProseMirror-compatible JSON:

```ts
interface FoliDocument {
  schemaVersion: 1;
  settings: {
    pageSize: { width: number; height: number }; // mm
    margins: { top: number; right: number; bottom: number; left: number }; // mm
  };
  content: JSONContent; // ProseMirror JSON, root node type "doc"
}
```

Rules:

1. `content` is the **only** source of truth for document content. The rendered DOM is never
   parsed back as truth; pages are never stored.
2. The content is one continuous `doc` regardless of how many pages it occupies.
3. `content` must validate against the schema produced by `createExtensions()`. Editor,
   validation and serialization all use that same extension set.
4. `parseDocument(input)` is the trust boundary for loading. It throws `FoliDocumentError`
   instead of dropping or "repairing" content silently.

## Why page size is width/height, not a preset name

`pageSize` stores resolved dimensions. `PAGE_SIZES.A4` / `PAGE_SIZES.Letter` are helpers.
This avoids invalid states such as `"custom"` without dimensions or `orientation` that
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

`schemaVersion` is bumped whenever the envelope or the content schema changes incompatibly
(renamed node, changed attribute meaning). `parseDocument` then gains a migration step
`vN → vN+1` before validation. Old documents must keep loading.

## Planned additions (not implemented)

Added only when a feature needs them, each with a migration:

- `metadata` (title, author, timestamps, app-defined fields).
- `styles` (named paragraph/character styles) — Phase 5.
- `headers` / `footers` as separate ProseMirror docs (they are genuinely separate content) — Phase 3.
- `resources` (image references by id, so binary data is not inlined) — Phase 5.
- Extension-owned data under a namespaced key.

## Open questions

- Deterministic serialization (stable key order) for diff-friendly storage: `JSON.stringify`
  of ProseMirror's `toJSON()` is already stable in practice; confirm and add a test before
  promising it.
- Whether to validate with a JSON schema (for non-JS consumers / Rust) in addition to the
  ProseMirror schema check.
