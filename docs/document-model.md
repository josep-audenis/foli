# Document model

> Status: envelope, schema v2 (with the v1 → v2 migration) and the document model (schema from
> specs, immutable nodes, positions, slices, JSON in/out) are implemented in `@folijs/core`
> (`packages/core/src/document.ts`, `packages/core/src/schema.ts`, `packages/core/src/model/`).
> The view renders and edits all of v2 (0.2.0). Steps, transactions, history and
> commands (Phase 3) are described in [architecture.md](architecture.md#editing-engine-folicore).

## Canonical form

A persisted Foli document is a versioned **envelope** around a JSON content tree:

```ts
interface FoliDocument {
  schemaVersion: 2; // 1: documents saved by 0.1.0, migrated on load
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
3. `parseDocument(input)` is the trust boundary for loading. Content is parsed through the
   schema: unknown node types, marks, attributes or keys and content the schema does not allow
   throw `FoliDocumentError` with a JSON path
   (e.g. `content.content[2].content[0].marks[0].type: unknown mark type "code"`). Content is
   never silently dropped or "repaired"; only the lossless normalization below is applied.

## Content JSON shape

Every node is `{ type, attrs?, content?, text?, marks? }`. This shape is permanent: it is
familiar to developers who know ProseMirror-style JSON and simple for Rust and other consumers.

### Normalization (canonical form)

Input may be loose; output is canonical, so equal documents serialize to identical JSON:

- Adjacent text nodes with equal marks are merged.
- Mark sets are sorted in schema order (v2: `link`, `bold`, `italic`, `underline`, `strike`,
  `textColor`, `highlight`).
- Empty `content` and `marks` arrays are omitted. `attrs` holds only attributes that differ from
  their default (required ones always) and is omitted when none do: a start-aligned paragraph has
  no `attrs`, a heading has `{ "level": n }`. Parsing fills the defaults back in. (Until v2,
  `attrs` held every attribute; v1 content has no default-valued attribute, so it serializes
  the same.)
- `toJSON` emits keys in the fixed order `type, attrs, content, text, marks`.

`parseDocument` returns the normalized form; normalizing twice changes nothing (property-tested).

## Schema v2

| Node             | Group  | Content                                       | Attrs                                                  |
| ---------------- | ------ | --------------------------------------------- | ------------------------------------------------------ |
| `doc`            | root   | one or more blocks                            | —                                                      |
| `paragraph`      | block  | inline\*                                      | `align`: `start` (default), `center`, `end`, `justify` |
| `heading`        | block  | inline\*                                      | `level`: 1–6 (required); `align` as paragraph          |
| `bulletList`     | block  | one or more `listItem`                        | —                                                      |
| `orderedList`    | block  | one or more `listItem`                        | `start`: integer 0–99999 (default 1)                   |
| `listItem`       | —      | a `paragraph`, then any blocks (nested lists) | —                                                      |
| `horizontalRule` | block  | — (leaf)                                      | —                                                      |
| `text`           | inline | —                                             | `text`: non-empty string, `marks`                      |
| `hardBreak`      | inline | —                                             | `marks`                                                |
| `pageBreak`      | inline | —                                             | `marks`                                                |

| Mark                                    | Attrs                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| `link`                                  | `href` (required): a relative URL or an `http`, `https`, `mailto` or `tel` URL |
| `bold`, `italic`, `underline`, `strike` | —                                                                              |
| `textColor`                             | `color` (required): lowercase `#rrggbb`                                        |
| `highlight`                             | `color` (required): lowercase `#rrggbb`                                        |

Each mark at most once per node. Marks are allowed on the inline children of `paragraph` and
`heading`, and nowhere else. `link` is not inclusive: text typed right after (or before) a link
is not part of it. `hardBreak` and `pageBreak` cannot be node-selected; a `horizontalRule` can.

**Link safety.** `href` is the one value in a document a browser may act on, so it is checked
wherever a document is built (parse, paste, commands; `isSafeHref` exports the rule): absolute
URLs only with the protocols above (case-insensitive), relative URLs (`/path`, `path`,
`#fragment`, `?query`, `//host`) allowed; control characters, spaces and backslashes anywhere
are rejected (browsers drop tabs and newlines inside a scheme, so `java\tscript:` would run).
`javascript:`, `data:`, `vbscript:`, `file:` and every other scheme are rejected, not repaired.
The rule is part of the format: it may be relaxed, but never made stricter without a
migration, or saved documents would stop loading. Values the rule rejects but that are
harmless (a URL with a space or a backslash, as people paste them) are normalized before they
reach a document (`normalizeHref`: by the link commands, the link dialog and plain-text URL
paste since 7.6; HTML paste in 7.8), not stored.

**Alignment** is `start` or `end` rather than left or right, so it means the right thing in
right-to-left text (as CSS and strict OOXML do): in left-to-right text, `start` is left.
Changing a block's type keeps the alignment.

**Colors** are stored as lowercase `#rrggbb` only (`isColor`); paste and the UI convert other
CSS colors before they reach the document, so equal colors serialize equally.

`hardBreak` may carry marks (as in other ProseMirror-style models), so formatting continues
across a line break.

`pageBreak` (added in Phase 5.3, before any release) is an explicit page break. It is inline,
like `hardBreak`, rather than a block between paragraphs: DOCX stores a page break the same way
(`<w:br w:type="page"/>` inside a run), and the caret, deletion, read-back and clipboard
handle it as they handle a hard break. The line it ends is the last one on its page; the rest
of the paragraph continues at the top of the next page. In plain text it is a line feed.
A break at the end of a paragraph (Mod-Enter there, or a pasted break between blocks, which
goes to the end of the previous block) leaves that paragraph's empty last line at the top of
the next page, as a trailing hard break does; the next block follows it.

The schema is defined in `packages/core/src/schema.ts` through the same spec API extensions
will use.

### Schema v1 (0.1.0)

v1 had `doc`, `paragraph` and `heading` (without `align`), `text`, `hardBreak`, `pageBreak` and
the marks `bold`, `italic`, `underline`, `strike`. Every v1 document is a valid v2 document.

## The model (`packages/core/src/model/`)

Concepts proven by ProseMirror, implemented independently (ADR-0002).

### Schema

`new Schema({ nodes, marks, topNode? })` builds `NodeType`s and `MarkType`s from specs.

- **Node spec:** `content` (expression; empty = leaf), `group` (space-separated), `inline`,
  `marks` (allowed child marks: names/groups, `_` = all, `""` = none; default all for inline
  content, none otherwise), `attrs`.
- **Mark spec:** `attrs`, `group`, `excludes` (names/groups, `_` = all, `""` = none; default the
  mark itself, i.e. at most one mark of a type per node).
- **Attribute spec:** `default` (absent = required), `validate(value)` returning an error
  message or `undefined`.
- **Content expressions (subset):** space-separated terms; a term is a node name or group, or a
  choice `(a | b)`, optionally followed by `*`, `+` or `?`. Inline and block types cannot be mixed
  in one expression. Compiled to an NFA (`ContentMatch`) with interned states, so matching does
  not allocate once warm. More syntax (`{n,m}`, nested groups) arrives when a node needs it.

### Nodes, fragments, marks

- `Node` (and `TextNode`) and `Fragment` are immutable; `Mark` sets are canonical readonly
  arrays. Edits rebuild only the changed path and reuse every other node, so `a === b` means
  "unchanged": the cache key for rendering and layout. Immutability is enforced by `readonly`
  types, not `Object.freeze` (cost).
- `NodeType.create`, `schema.node` and `schema.text` validate attrs and content; `copy`, `cut`
  and `mark` do not (they are building blocks); `node.check()` validates a whole subtree.
- `eq` is structural equality; `sameMarkup` compares type, attrs and marks.
- Fragments are always normalized (adjacent equal-mark text merged); empty text nodes cannot
  exist.

### Positions

Every position is an integer. Position 0 is the start of the doc's content; entering or leaving
a non-leaf node counts 1, each UTF-16 code unit of text counts 1, a leaf node counts 1.

```
  0   1 2 3    4   5 6 7    8
  <p> a b </p> <p> c d </p>
```

`doc.resolve(pos)` returns a `ResolvedPos`: `depth`, `parent`, `node(d)`, `index(d)`,
`indexAfter(d)`, `start(d)`, `end(d)`, `before(d)`, `after(d)`, `parentOffset`, `textOffset`,
`nodeBefore`, `nodeAfter`, `posAtIndex`, `sharedDepth`, `sameParent` (negative depths count up
from the parent). `doc.nodeAt(pos)`, `nodesBetween`, `descendants` and `textBetween` walk by
position. Resolution is not cached; add a cache if profiling shows a need.

### Slices and replace

A `Slice` is a fragment plus `openStart`/`openEnd`: how many nodes along its first/last child
chain are cut open. `doc.slice(from, to)` returns one (`slice.size === to - from`);
`doc.replace(from, to, slice)` inserts it, joining open nodes with the nodes cut at `from` and
`to`, and validates every rebuilt node (throws `ReplaceError` otherwise). Both ends must sit at
consistent depths (`$from.depth - openStart === $to.depth - openEnd`); fitting arbitrary slices
(closing and opening nodes as needed) is not implemented: Phase 3 transforms only use
structurally compatible slices, and general fitting arrives with paste in Phase 4.
`ReplaceStep` builds on `replace`.

### JSON in/out

- `schema.nodeFromJSON(json, path?)`, `schema.markFromJSON` and `schema.sliceFromJSON` parse
  untrusted JSON strictly with JSON-path errors and normalize (see above). Slices allow
  incomplete content only in their open nodes.
- `node.toJSON()`, `mark.toJSON()` and `slice.toJSON()` emit canonical JSON
  (`SliceJSON = { content, openStart, openEnd }`).
- `parseContent(json)` parses current (v2) content into a `doc` node; `parseDocument`
  migrates the envelope first, then uses it.

### Testing

Property tests (`fast-check`, 10,000 runs each, `model.property.test.ts`) run over random
documents in a richer test schema (nested blockquotes, a block leaf, a mark with attrs, a mark
that excludes all others): `fromJSON(toJSON(x)) = x` with canonical key order; v1 normalization
is idempotent; resolve invariants at every position; slice size and JSON round trip;
`replace(from, to, slice(from, to))` is the identity; random replaces either throw
`ReplaceError` or yield a valid, normalized document of the expected size. Unit tests cover the
rest; `pnpm --filter @folijs/core coverage` fails below 95% line coverage of `src/model/` (100% at
the end of Phase 2). Timings: [benchmarks.md](benchmarks.md).

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

`schemaVersion` is bumped whenever the envelope or the content schema changes (new types
included: an older Foli cannot read them). `parseDocument` accepts every version from 1 to the
current one: it runs the migrations `vN → vN+1` in order (`MIGRATIONS` in
`packages/core/src/document.ts`), then validates against the current schema. A document from a
newer Foli is rejected with a message saying so; versions below 1 or not integers are invalid.
Migrations never drop content. A published version never changes in place.

| Version | Released in | Migration to the next                                                           |
| ------- | ----------- | ------------------------------------------------------------------------------- |
| 1       | 0.1.0       | v1 → v2: only the version changes (v2 only adds types and defaulted attributes) |
| 2       | 0.2.0       | —                                                                               |

0.1.0 reads only version 1: it rejects documents saved by 0.2.0 ("Unsupported schemaVersion: 2").
Tests load a document exactly as 0.1.0 saved it (`document.test.ts`), and the playground's e2e
fixtures are still v1 documents, loaded through the migration.

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
- Positions count UTF-16 code units, so a position can fall between the two halves of a
  surrogate pair. Deletion commands move by grapheme (`Intl.Segmenter`); the view (Phase 4)
  must do the same for caret movement. The model does not prevent it.
