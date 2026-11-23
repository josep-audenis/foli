# Document model

> Status: the Word model (`packages/core/src/v3/`) is the current schema (`SCHEMA_VERSION` 5:
> schema v3 plus tables, pictures and `resources`, ADR-0006, 0.5.0; plus stories (headers,
> footers, notes), fields, content controls, note references, columns and `settings`, ADR-0007,
> 0.6.0): the editor and view edit all of it, and `@folijs/docx` reads and writes it. 0.5.0
> cannot read documents saved by 0.6.0. Schema v2 (0.2.0, `packages/core/src/document.ts`,
> `packages/core/src/schema.ts`) and v1 (0.1.0) are kept to read and migrate documents saved
> with them, and v2 to read pasted HTML. The document model (schema from specs, immutable nodes,
> positions, slices, JSON in/out) is `packages/core/src/model/`. Steps, transactions, history and
> commands (Phase 3) are described in [architecture.md](architecture.md#editing-engine-folijscore).

## Canonical form

A persisted Foli document is a versioned **envelope** around a JSON content tree:

```ts
interface FoliDocument {
  schemaVersion: 5; // 1 to 4: documents saved by 0.1.0 to 0.5.0, migrated on load
  section: SectionJSON; // page setup, in twips
  defaults: { paragraph?: ParagraphPropertiesJSON; run?: MarkJSON[] };
  styles: StyleJSON[];
  numbering: { abstracts: AbstractNumberingJSON[]; instances: NumberingInstanceJSON[] };
  theme?: ThemeJSON;
  comments: CommentJSON[];
  resources?: Record<string, ResourceJSON>; // pictures' bytes, by key
  stories?: Record<string, StoryJSON>; // headers, footers and notes, by id
  controls?: Record<string, ControlJSON>; // content controls' properties, by id
  settings?: WordSettingsJSON; // even and odd headers, note options
  content: NodeJSON; // root node of type "doc"
}
```

The parts are described under [Schema v3](#schema-v3-the-word-model).

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
familiar to developers who know tree-shaped rich-text JSON and simple for Rust and other consumers.

### Normalization (canonical form)

Input may be loose; output is canonical, so equal documents serialize to identical JSON:

- Adjacent text nodes with equal marks are merged.
- Mark sets are sorted in schema order (v3: the order of `schema.marks`; v2: `link`, `bold`,
  `italic`, `underline`, `strike`, `textColor`, `highlight`).
- Empty `content` and `marks` arrays are omitted. `attrs` holds only attributes that differ from
  their default (required ones always) and is omitted when none do: a start-aligned paragraph has
  no `attrs`, a v2 heading has `{ "level": n }`. Parsing fills the defaults back in. (Until v2,
  `attrs` held every attribute; v1 content has no default-valued attribute, so it serializes
  the same.)
- `toJSON` emits keys in the fixed order `type, attrs, content, text, marks`.

`parseDocument` returns the normalized form; normalizing twice changes nothing (property-tested
on v2 content in `model.property.test.ts`, unit-tested on v3 in `v3.test.ts`).

## Schema v2 (0.2.0: read and migrated)

The 0.2.0 format, kept to read documents saved with it (`FoliDocumentV2`, `parseContentV2`;
the schema itself, `schemaV2`, is internal) and pasted HTML (read as v2, then fitted to the
document).

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

`hardBreak` may carry marks (as in other tree-shaped rich-text models), so formatting continues
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

## Schema v3: the Word model

[ADR-0005](decisions/ADR-0005-word-compatible-model.md)'s model, in
`packages/core/src/v3/`: `schema`, the envelope `FoliDocument`, `parseDocument` (also reads v1
and v2, validating then migrating them), `migrateToV3` and `createDocument`. It is the current
schema (`SCHEMA_VERSION` 3, released in 0.3.0): the editor and the view work on it.

The shape follows Word, in Word's units (twips = 1/20 pt for geometry, indentation, spacing
and tab stops; half-points for font sizes; eighths of a point for borders: `units.ts` converts),
so values survive a DOCX round trip exactly. An unset property is `null` and omitted from the
JSON: the style, then the defaults, decide (`Resolver` in `v3/resolve.ts`, 8.6).

| Node                                                                                                                     | Content / attrs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `doc`                                                                                                                    | one or more blocks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `paragraph`                                                                                                              | inline\*; Word's paragraph properties: `style`, `justification`, `indent`, `spacing`, `keepNext`, `keepLines`, `widowControl`, `pageBreakBefore`, `contextualSpacing`, `outlineLevel`, `numbering` (`id` and/or `level`), `tabs`, `borders`, `shading`, `markFormat`, `ext`; `section`, `revision`, `formatChange`, `attributes`                                                                                                                                                                                                                                                                                                                 |
| `table` (v4)                                                                                                             | `tableRow`+; Word's table properties (`w:tblPr`): `style`, `width`, `justification`, `indent`, `layout`, `borders` (with `insideH`/`insideV`), `cellMargins`, `cellSpacing`, `shading`, `look`, `rowBandSize`, `columnBandSize`, `ext`; `grid` (column widths, twips), `gridExt`                                                                                                                                                                                                                                                                                                                                                                 |
| `tableRow` (v4)                                                                                                          | `tableCell`+; `height` (`value`, `rule`), `cantSplit`, `header`, `gridBefore`/`widthBefore`, `gridAfter`/`widthAfter`, `ext`; `revision` (row inserted/deleted), `exceptions` (`w:tblPrEx`: table properties), `attributes`                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `tableCell` (v4)                                                                                                         | blocks ending with a paragraph; `width`, `gridSpan`, `vMerge` (`restart`/`continue`: a merged cell is present in every row it covers, as Word writes it), `borders`, `shading`, `margins`, `verticalAlign`, `textDirection`, `noWrap`, `ext`                                                                                                                                                                                                                                                                                                                                                                                                     |
| `opaqueBlock`                                                                                                            | `xml` (verbatim), `label`: block content Foli does not model (a table inside a content control…)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `text`, `tab`, `hardBreak` (`clear`), `pageBreak`, `columnBreak`                                                         | inline                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `bookmarkStart` (`id`, `name`), `bookmarkEnd` (`id`)                                                                     | a bookmark's ends: what cross-references and internal links point at                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `commentStart`, `commentEnd`, `commentReference`                                                                         | `id`: a comment's range and its reference mark, as Word places them (ranges overlap freely, so they are points, not marks)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `picture` (v4)                                                                                                           | inline; `resource` (a key of the envelope's `resources`), `width`, `height` (EMU), `alt` (optional, as Word allows), `title`, `decorative`, `float` (null inline; else `horizontal`/`vertical` (`relativeTo`, `offset` or `align`), `wrap`, `side`, `distance`, `allowOverlap`, `layoutInCell`), `rotation` (v6: clockwise, 60 000ths of a degree, `a:xfrm/@rot`; 0 is none), `crop` (v6: `left`, `top`, `right`, `bottom` cut off, 1000ths of a percent, `a:srcRect`; `{}` is none); either missing means as the drawing in `ext` has it (1.0 to 1.3 kept a file's there only, and so does 1.4 for one it cannot hold), `ext` (the `w:drawing`) |
| `fieldStart` (`dirty`, `locked`, `simple`, `ext`), `fieldCode` (`text`, `attributes`), `fieldSeparator`, `fieldEnd` (v5) | a field as Word has it (ADR-0007): the code from the start to the separator (or the end), hidden with any field nested in it; the result as ordinary content after the separator, written by `updateFields`                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `controlStart`, `controlEnd` (`id`, v5)                                                                                  | an inline content control's ends; its properties are `controls[id]`. Blocks, rows and cells list theirs in `controls`, outermost first                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `noteReference` (`story`, `customMark`, `attributes`, v5), `noteMark` (v5)                                               | a note's reference, and where a note shows its number                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `opaqueInline`                                                                                                           | `xml`, `label`, `run` (content of a run, written back inside one): charts, shapes, symbols… until modeled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Marks, in canonical order: `link` (`href` as the file has it, `anchor`, `tooltip`,
`attributes`), `insertion` and `deletion` (`id`, `author`, `date`, `move`: tracked changes and
moves; deleted text stays in the content, marked), `characterStyle`, `bold` and `italic`
(`value`, `complexScript`), `underline` (`style`, `color`), `strike`, `doubleStrike`, `caps`,
`smallCaps`, `hidden`, `font` (per script, theme fonts, `hint`), `fontSize` (half-points, and
complex script), `color` (`RRGGBB` or `auto`, theme color), `highlight` (Word's 16 named colors),
`shading` (any fill), `verticalAlign`, `characterSpacing`, `formatChange` (the run properties
before a tracked formatting change), `runExt`. Toggles take `value: false` to turn off what a
style turns on (`<w:b w:val="0"/>`). A style's, a paragraph mark's or a recorded change's run
properties may hold only the marks that describe how text looks (`RUN_PROPERTY_MARKS`).

- **Headings** are paragraphs with a heading style (`Heading1`…); **lists** are numbered
  paragraphs (`numbering` references an instance of the envelope's numbering).
- **Stories** (v5): `stories` holds headers and footers by relationship id (what a section's
  `headers` and `footers` name) and notes as `footnote:<id>` and `endnote:<id>` (what a
  `noteReference` names), each a `doc` of blocks. A story ends no section and holds no note
  reference or comment; a note holds no page or column break. A note's number is never stored: it
  comes from document order and the `footnotes` and `endnotes` properties of the settings and each
  section (a section's first). New notes take the next number of their kind. New headers and
  footers get ids `rIdFoli` and a random part, never reused. In the editor a story changes through `StoryStep`s of the body's history.
- **Settings** (v5): `settings.evenAndOddHeaders` (absent: as the file says; `false` is written
  back as off), `footnotes` and `endnotes`, and `doNotUseHTMLParagraphAutoSpacing` (`w:compat`:
  a paragraph's space after and the next one's space before add up; without it Word takes the
  larger), from `word/settings.xml`, whose other content is kept verbatim. They change through
  `EnvelopeStep`s.
- **Sections:** a paragraph's `section` ends a section with that page setup (Word's `w:sectPr`
  in the paragraph's properties); the envelope's `section` is the last one. Every part of a
  section is optional (Word's defaults apply). `type` says how the section starts; `columns`
  (`w:cols`: `count`, `space`, `separator`, and `widths` when `equalWidth` is false),
  `pageNumbers` (`w:pgNumType`), `footnotes` and `endnotes` (`w:footnotePr`, `w:endnotePr`) are
  read and written since 11.6. `change` (`w:sectPrChange`: `id`, `author`, `date`, `previous`) is
  a tracked change of the setup; accepting drops it, rejecting restores `previous` with the
  section's header and footer references.
- **Links:** `href` keeps the target as the file has it (`file:` and network paths included):
  whether a link may be opened is decided where it is opened (`isSafeHref`, at rendering), so
  real documents load and keep their links.
- **Lossless:** `ext` holds the element the properties were read from (`w:pPr`, `w:rPr` as
  `runExt`, `w:sectPr`, `w:style`, `w:lvl`, `w:abstractNum`, `w:num`), verbatim. Export (8.5)
  writes it back as it was while the modeled values still match it, and otherwise writes the
  modeled values into it, keeping its unknown children (in the order Word requires) and
  unknown attributes. `attributes` holds an element's own unknown attributes (`w14:paraId`,
  revision save ids on a paragraph; `w:history` on a link; `w16du:dateUtc` on a tracked change;
  any on a bookmark or comment anchor). The defaults keep their `w:docDefaults` (`ext`), a
  comment its start tag. Opaque nodes hold whole elements.
  The parts of `styles.xml` and `numbering.xml` the envelope does not hold (latent styles,
  picture bullets) are written back from the original package, which import keeps (8.4).

- **Tables** (v4, ADR-0006): rows of cells holding blocks, Word's properties as attributes and
  `ext`. Beyond the content expressions, `parseContent` keeps Word's rules: a table never
  follows a table (Word would merge them) and never ends the document; a paragraph in a cell
  ends no section and holds no page or column break. A table Foli cannot hold (rows inside a
  content control) stays an `opaqueBlock`.
- **Pictures** (v4): a `picture` refers to `resources[key]`: `contentType` (an `image/` type),
  `size`, and where the bytes are, at least one of `part` (the package's media part), `url`
  (the app's: relative, `http(s):` or `blob:`, never a scheme that runs code) or `data` (a
  `data:image/…` URL, when the app opts into it). No base64 in the JSON by default. A key with
  no resource is allowed (the picture shows as missing); code looks keys up with `Object.hasOwn`
  (`resources.constructor` is not a resource), and `__proto__` is refused as a key.
- **Depth:** parsed JSON nests at most `MAX_NODE_DEPTH` (300) levels, about a hundred tables
  inside each other: deeper input is refused with its path rather than overflowing the stack.

```ts
interface FoliDocument {
  schemaVersion: 5;
  section: SectionJSON; // page size, orientation, margins (twips), headers/footers by relationship id, columns, page numbers
  defaults: { paragraph?: ParagraphPropertiesJSON; run?: MarkJSON[] }; // w:docDefaults
  // id, type, name, basedOn, next, link, isDefault, paragraph, run, ext; a table style's
  // table, row, cell and conditions (w:tblStylePr: firstRow, band1Horz… with the same parts)
  styles: StyleJSON[];
  numbering: { abstracts: AbstractNumberingJSON[]; instances: NumberingInstanceJSON[] };
  theme?: ThemeJSON; // major/minor fonts, theme colors (read-only: export keeps the original part)
  comments: CommentJSON[]; // id, author, initials, date, content (blocks), parent, done
  resources?: Record<string, ResourceJSON>; // contentType, size, part | url | data
  stories?: Record<string, StoryJSON>; // kind, noteType, content (a doc), ext: headers, footers, notes
  controls?: Record<string, ControlJSON>; // kind, tag, alias, lock, items, dateFormat, date, checked,
  //   checkedState, uncheckedState, multiLine, placeholder (showing, docPart, text), binding, ext
  settings?: WordSettingsJSON; // evenAndOddHeaders, footnotes, endnotes
  content: NodeJSON; // a doc
}
```

**Validation** (`parseDocument`) is the trust boundary: it accepts what Word opens and
rejects only what the engine cannot work with. Accepted: duplicate ids (the first wins, as in
Word; comments that repeat an id are given ids of their own instead, the first keeping it and
each later one a fresh id with its anchors, as a command by id must act on one comment; a reply
to a repeated id stays the first's), a numbering instance or a reply whose target is missing, references to styles that do
not exist, empty authors and initials, a paragraph mark both inserted and deleted, `firstLine`
with `hanging` (Word applies `hanging`). Rejected: wrong types, values out of Word's ranges,
unknown keys (inherited names such as `__proto__` included: only own keys are looked up), and
cycles that would never end when followed (a style based on itself through its chain, comments
replying to each other), checked in linear time. The result is a copy that shares nothing with
the input; content and comment content are in canonical form.

**Migration v2 → v3** (`migrateToV3`): every character, break and mark is kept, and every
ordered list item keeps its number (property-tested on generated v2 documents, numbering them
as Word does). Headings become `Heading1`–`Heading6` paragraphs; lists become `ListParagraph`
paragraphs numbered with one instance per list (an item's first nested list of the same kind
starting at 1 continues its parent's numbering a level down; any other nested list, or one past
Word's nine levels, gets its own instance with an explicit start, so it restarts as in v2);
further blocks of a list item are indented to its text; a horizontal rule becomes an empty
paragraph with a bottom border; `align` becomes `justification` (`end` → `right`, `justify` →
`both`); `textColor` becomes `color`, and `highlight` becomes `shading` (Word's highlight has
only 16 colors; a fill keeps any color); linked text takes Word's `Hyperlink` character style
(blue, underlined: the look v2 gave links); `settings` becomes the section in twips (rounded to
the twip, under 0.02 mm, and kept within Word's 22-inch page). The defaults keep the default
stylesheet's look, about: 11 pt Georgia, Word's 1.5 lines (1.5 times the font's own line
height, a little taller than CSS's 1.5), and 11 pt after each paragraph (the browser's 1em between
paragraphs); the styles (`Normal`, headings, `ListParagraph`, `Hyperlink`) and numbering
definitions (bullets • ◦ ▪, numbers decimal at every level, as v2 showed them) are added, fresh
for each document.

**Resolution** (`Resolver`, 8.6a): how a v3 document looks, computed in core with no DOM.
`new Resolver(document)` reads the envelope once; `paragraph(attrs)` gives a paragraph's
effective properties (defaults, then the paragraph style's `basedOn` chain root first, then
direct formatting) and the formatting of its text; `run(paragraphRun, marks)` adds a character
style's chain and the run's own marks; `markers(paragraphs)` numbers a document's paragraphs in
order. Attributes are taken as JSON or as a live node has them (null for unset: inherited), and
results are copies the caller may change. The rules, written to Word's behaviour as ECMA-376
describes it:

- A missing paragraph style (or none) is the default paragraph style; of several marked
  default, the last.
- Properties inherit attribute by attribute (an indent's `left` from one style, `hanging` from
  another); `firstLine` and `hanging` replace each other; tab stops accumulate, a `clear` stop
  removing an inherited one.
- Within a style chain a style overrides what it is based on; toggle properties (bold, italic,
  caps, small caps, strike, double strike, hidden) then flip between the paragraph style and
  the character style, so a bold character style on a bold heading shows plain text; direct
  formatting sets them. Complex-script bold and italic are kept apart.
- Theme fonts resolve per script (`minorHAnsi` → the theme's minor Latin font), falling back to
  the font the file names when there is no theme; a theme color resolves through the color
  scheme, and with a tint or shade is the computed color Word writes beside it. Without any
  value: 10 pt and no font name (the view chooses).
- Numbering: a level's paragraph properties come over the paragraph style's when the
  numbering is direct, under them when the style gives it (numbered headings); a style naming
  only the instance is in the level whose `style` is that style; numId 0 takes numbering away;
  a numbering style's link is followed to the definition it uses. Counters are kept per abstract
  definition (instances sharing one continue the list); an instance's start override restarts
  it where it is first used; a deeper level restarts after a higher one unless its `restart`
  says otherwise; `%1`–`%9` take each level's format (decimal, decimalZero, roman, letters with
  Word's `aa` up to 30 letters, ordinal, none; others as decimal), all decimal in a legal
  level; bullets are their text as written. A marker's formatting is the paragraph's, then its
  mark's, then the level's.
- Tables (v4): `table(attrs)` gives a table's properties over its style's (`basedOn` chain; the
  default table style when none is named); `cell(table, row, cell, place)` gives a cell's
  shading, borders (its own edges: the table's outer borders on the table's edges, `insideH`
  and `insideV` inside; conflicts between neighbours are the view's), margins (twips) and
  vertical alignment from the table style's parts that apply where it is (`tableConditions`,
  as `look` turns them on, in Word's order: whole table, banded columns, banded rows, first and
  last column, first and last row, corners; the first and last row and column are left out of
  banding), then the row's exceptions and the cell's own properties. `paragraph(attrs, cell)`
  puts the table style's paragraph and run properties between the defaults and the paragraph
  style (ECMA-376 17.7.2). Unit-tested; checked against Word's pages in 10.5.

Checked against Word: every list number outside tables in the corpus is the one Word shows
(`packages/docx/src/import/resolve.test.ts`: 41 numbered paragraphs, legal `1.`/`1.1`/`(a)`/
`(i)` numbering, bullets, lists continued across instances). Unit-tested only, with no Word
sample yet: start overrides, `restart`, legal levels, numbering styles, the numbering and style
indent precedence, run formatting, theme colors and fonts. Rendering (8.6b) compares pages
with Word.

### Custom nodes and marks

Apps add their own types with extensions (ADR-0008, 12.3; [api.md](api.md#custom-nodes-and-marks)):
inline leaves, block leaves and marks named `<namespace>:<name>` (lowercase letters, digits and
`-`: `acme:mention`). They are stored as ordinary node and mark JSON by type name, in the content,
the stories and the comments, and nowhere else in the envelope:

```json
{
  "type": "paragraph",
  "content": [
    { "type": "text", "text": "Ask " },
    {
      "type": "acme:mention",
      "attrs": { "id": "u-42", "label": "Ada" },
      "marks": [{ "type": "bold" }]
    },
    {
      "type": "text",
      "text": "budget",
      "marks": [{ "type": "acme:topic", "attrs": { "topic": "finance" } }]
    }
  ]
}
```

They never change `schemaVersion`: they are the app's, not the format's. An app that walks the
JSON must ignore types it does not know. Read without their extension (`parseDocument` without
`extensions`, an editor without them, `exportPdf`) a custom node or mark is kept: in memory a
foreign node (`foreignInline`, `foreignBlock`) or a foreign mark holding the type and attributes
(checked as plain JSON, at most 64 KiB), written back as it was. The foreign types live only in
memory and are never saved; a saved document holding one by name is read as the custom type it
names. The text a custom node stands for (`text(attrs)`) is not saved either. In `.docx` they are
content controls tagged `foli:` and the type and attributes ([api.md](api.md#folijsdocx)).

## Schema v1 (0.1.0: read and migrated)

v1 had `doc`, `paragraph` and `heading` (without `align`), `text`, `hardBreak`, `pageBreak` and
the marks `bold`, `italic`, `underline`, `strike`. Every v1 document is a valid v2 document.

## The model (`packages/core/src/model/`)

Implemented independently (ADR-0002).

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
(closing and opening nodes as needed) is not implemented: transforms only use structurally
compatible slices, and paste inserts whole blocks where a slice cannot fit (an opaque block at
an end).
`ReplaceStep` builds on `replace`.

### JSON in/out

- `schema.nodeFromJSON(json, path?)`, `schema.markFromJSON` and `schema.sliceFromJSON` parse
  untrusted JSON strictly with JSON-path errors and normalize (see above). Slices allow
  incomplete content only in their open nodes.
- `node.toJSON()`, `mark.toJSON()` and `slice.toJSON()` emit canonical JSON
  (`SliceJSON = { content, openStart, openEnd }`).
- `parseContent(json)` parses current-schema content into a `doc` node (`parseContentV2`: v2
  content); `parseDocument` migrates an older envelope first, then validates.

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
This avoids invalid states such as `"custom"` without dimensions. In v2 orientation is derived
(`width > height` = landscape); a v3 section also keeps Word's `orientation`, as the file has
it (migration writes it for a v2 page wider than tall).

## Units

Schema v3 stores Word's units (twips for geometry; [Schema v3](#schema-v3-the-word-model)).
Page geometry outside the document (`editor.settings`, `PAGE_SIZES`, v2's `settings`) is in
**millimetres**:

| Target               | Conversion                                                                              |
| -------------------- | --------------------------------------------------------------------------------------- |
| CSS                  | use `mm` directly (`210mm`); browsers map 1mm = 96/25.4 px ≈ 3.7795 CSS px at 100% zoom |
| CSS px (layout math) | `px = mm × 96 / 25.4`                                                                   |
| DOCX (twips)         | `twip = mm × 1440 / 25.4` (≈ 56.69 per mm)                                              |
| DOCX drawings (EMU)  | `emu = mm × 36000`                                                                      |
| PDF (points)         | `pt = mm × 72 / 25.4`                                                                   |

Font sizes inside content are half-points, as in DOCX (`fontSize`: 24 = 12 pt); `setFontSize`
takes points.

## Versioning and migrations

`schemaVersion` is bumped whenever the envelope or the content schema changes (new types
included: an older Foli cannot read them). `parseDocument` accepts every version from 1 to the
current one: a v1 or v2 document is validated as v2 (v1 → v2 by `MIGRATIONS` in
`packages/core/src/document.ts`), migrated to v3 (`migrateToV3`), v4 (`migrateToV4`) and v5 (`migrateToV5`), then validated as
v5; a v3 or v4 document is validated as v5 holding nothing its version did not have (no
`resources` in v3; no `stories`, `controls` or `settings` in either). A document from a
newer Foli is rejected with a message saying so; versions below 1 or not integers are invalid.
Migrations never drop content. A published version never changes in place.

| Version | Released in | Migration to the next                                                                                                |
| ------- | ----------- | -------------------------------------------------------------------------------------------------------------------- |
| 1       | 0.1.0       | v1 → v2: only the version changes (v2 only adds types and defaulted attributes)                                      |
| 2       | 0.2.0       | v2 → v3 (`migrateToV3`, 8.3): Word's model                                                                           |
| 3       | 0.3.0       | v3 → v4 (`migrateToV4`): only the version changes (a table kept opaque stays so until its `.docx` is imported again) |
| 4       | 0.5.0       | v4 → v5 (`migrateToV5`): only the version changes (what is opaque stays so until its `.docx` is imported again)      |
| 5       | 0.6.0       | v5 → v6: only the version changes (v6 only adds attributes)                                                          |
| 6       | 1.4.0       | v6 → v7: only the version changes (v7 only adds a setting)                                                           |
| 7       | 1.6.0       | — (the current version: the tracking switch, `settings.trackRevisions`, ADR-0012)                                    |

From 1.4.0 a document is saved with the lowest version its content needs (ADR-0008): 5 unless a
picture is rotated or cropped, so 1.0 to 1.3 keep reading what 1.4 saves without those; one that
needs 6 is refused by them with a message saying so. A document that says 5 holding v6 content
is refused. From 1.6.0 a document that holds `settings.trackRevisions` (on, or turned off after
being on) needs 7; every earlier release refuses it, and a document that says 5 or 6 holding it is refused.

0.1.0 reads only version 1: it rejects documents saved by 0.2.0 ("Unsupported schemaVersion: 2").
0.2.0 reads versions 1 and 2: it rejects documents saved by 0.3.0.
0.4.0 (Phase 9: recording, accepting and rejecting tracked changes, editing comments) uses the
same schema 3: it writes the marks and attributes 0.3.0 already reads (`insertion`, `deletion`,
`formatChange`, a paragraph's `revision` and `formatChange`, comment anchors and `comments`), so
0.3.0 and 0.4.0 read each other's documents. Until 1.5, whether tracking was on was not in the
document: the editor option and a `.docx`'s `w:trackRevisions` carried it (from 1.6 it is the
setting `trackRevisions`, schema 7). 0.4.0 cannot read schema 4; 0.5.0
cannot read schema 5.
Tests load a document exactly as 0.1.0 saved it (`document.test.ts`); in the browser, the
page-break e2e (`pages.spec.ts`) and the examples' smoke test load v1 documents through the
migration.

## Planned envelope additions (not implemented)

Each added only when a feature needs it, with a migration:

- `metadata` (title, author, timestamps, app-defined fields).
- Extension-owned data under a namespaced key (custom node and mark types need none: they are
  content, 12.3).

## Open questions

- Generate a JSON Schema from the TypeScript schema so Rust and other consumers validate the
  same format (when a non-TypeScript consumer appears).
- Positions count UTF-16 code units, so a position can fall between the two halves of a
  surrogate pair. Deletion commands move by grapheme (`Intl.Segmenter`), and the view snaps
  the caret and selection out of grapheme clusters. The model does not prevent it.
