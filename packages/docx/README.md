# @folijs/docx

DOCX for [Foli](https://github.com/josep-audenis/foli): imports a `.docx` into Foli's Word model
(schema v5 of `@folijs/core`), exports it back losslessly (`exportDocx`), and reads its package
(zip, parts, content types, relationships) and XML keeping every byte it does not change. No DOM:
runs in the browser, workers and Node 20.12+. Its only dependency is `@folijs/core`, a peer at
exactly its own version: `npm install @folijs/docx @folijs/core`.

> Early release: the API may change in any 0.x minor version (changes in `CHANGELOG.md`).

```ts
import { importDocx } from "@folijs/docx";

const {
  document,
  package: pkg,
  report,
} = await importDocx(new Uint8Array(await file.arrayBuffer()));
document.content; // paragraphs with Word's properties, runs as text with marks, tables
document.stories; // headers, footers, footnotes and endnotes, by id
document.styles; // with basedOn, run and paragraph properties
report.opaque; // { "w:annotationRef": 4 }: content kept verbatim, not editable
```

**Import** (`importDocx`, `importPackage`) reads the main document, styles (with the document
defaults), numbering, the theme's fonts and colors, comments (with replies and resolved state
from `commentsExtended`), sections, headers, footers, footnotes, endnotes and settings:

- **Paragraphs** with their properties (style, justification, indentation, spacing, keep rules,
  outline level, numbering, tab stops, borders, shading, the paragraph mark's formatting and
  tracked insertion or deletion, formatting changes, section breaks) and their own attributes
  (`w14:paraId`…). **Runs** become text, tabs and breaks with their properties as marks; tracked
  insertions, deletions and moves, hyperlinks (target from the relationship, or a bookmark),
  bookmarks, comment ranges and references are modeled.
- **Sections** (11.6): page size and margins, how each starts, `w:cols` (equal or set widths, the
  line between them), `w:pgNumType`, `w:footnotePr`, `w:endnotePr` and a tracked setup change
  (`w:sectPrChange`), read and written; a section unchanged is exported byte for byte, a changed
  one rewrites only what changed. A recorded setup is written with every value spelled out: Word
  sees no change in what it leaves out.
- **Headers, footers and notes** (11.4) become `stories` holding the body's kinds of blocks
  (tables and pictures included), a note's reference a `noteReference` node and its number in the
  note a `noteMark`. What a story may not hold (a section break, a note reference, a comment, a
  page or column break in a note) stays verbatim there, reported.
- **Fields** (11.5): complex fields (`w:fldChar`, `w:instrText`), nested and across runs and
  paragraphs, become `fieldStart`, `fieldCode`, `fieldSeparator` and `fieldEnd` markers with their
  result as ordinary content; `w:fldSimple` reads as the same markers and is written back as one.
  Merge fields and form fields (`w:ffData` kept) are fields like the others.
- **Content controls** (11.5, 11.9) at run, block, row and cell level are modeled with their
  properties (`controls`), `w:sdtPr` and `w:sdtEndPr` kept in `ext`: what changes is patched child
  by child, the rest stays byte for byte, a new control gets a whole `w:sdtPr`, and the glossary
  gives the text an emptied one shows. Data bindings are kept, not evaluated. An empty block
  control stays verbatim.
- **Tables** (10.4) become `table`, `tableRow` and `tableCell` nodes: the table's, rows' and
  cells' properties (`w:tblPr`, `w:tblGrid`, `w:tblPrEx`, `w:trPr`, `w:tcPr`) as attributes,
  merges as Word writes them (`gridSpan`, `vMerge`), a row inserted or deleted as a tracked
  change, the cells' paragraphs and nested tables; a table style's parts and conditional
  formats go to its `StyleJSON`. A table the model cannot hold as it is stays opaque, reported:
  rows or cells inside a content control or custom XML, markers between rows, elements out of
  Word's order, a cell not ending with a paragraph, tables nested more than 64 deep, a table
  right after a table (Word merges the two) or ending the body, and a page, column or section
  break in a cell (the model has none there). A row's `w:tblPrEx` keeps what a row may not
  override (a style, band sizes) in its `ext`, and a table style's `wholeTable` conditional
  format stays in its `ext`, both reported. A table made in the model is written as Word
  requires (properties, grid, rows); Word opens it, with or without a grid.
- **Lossless:** every properties element is kept verbatim (`ext` on paragraphs, sections,
  styles, numbering levels and definitions, the document defaults; `runExt` on runs; a comment's
  start tag), and unknown attributes of modeled elements go to attribute bags (paragraphs,
  links, tracked changes, bookmarks and comment anchors: `w16du:dateUtc`, `w14:paraId`…). Every
  element Foli does not model yet (equations, charts, shapes…) becomes an opaque node holding its source, and so does an
  element the model rejects as a whole (a tracked change with an id past Word's range, a link in
  a link, a run with an unknown attribute): never stripped to plain text. Export (8.5) writes all
  of it back; keep `package` with the document, the parts Foli does not edit come from it. The
  tests check every attribute of the corpus's document and comments parts is kept.
- **What Word opens, imports:** each value is checked on its own; one the model cannot hold (out
  of range, a unit such as `1.5cm`, a date without a time) is left out of the model, kept in the
  verbatim element and listed in `report.unmodeled`. A style cycle is broken where it closes, a
  reply that would close a cycle of replies is not kept. Not imported, because Word recomputes
  them or they show nothing: spelling marks (`w:proofErr`), rendered page breaks
  (`w:lastRenderedPageBreak`), editing session ids on runs (`w:rsid*`) and runs with no content:
  counted in `report.dropped`. Import time is linear in the file (crafted files included).
- **Failures** are `DocxError` (or `ZipError` from the package): a file that is not a
  WordprocessingML document, Strict Open XML (refused until a real file needs it), or an element
  past the model's absolute limits (over 16 MiB kept verbatim).
- **Not kept exactly**, to be equal under export's canonical comparison: run boundaries
  (adjacent runs with the same properties become one text), `w:cr` (read as a line break),
  `w:noBreakHyphen` and `w:softHyphen` (read as U+2011 and U+00AD), an explicit
  `w:type="textWrapping"` on a break, XML comments, processing instructions and whitespace
  between elements, and the empty paragraph given to an empty body or comment. Text is read as
  Word reads it: without `xml:space="preserve"`, whitespace at the ends of a `w:t` is not text.

**Settings.** Of `settings.xml`, `w:trackRevisions` is read (`DocxImport.trackRevisions`)
and, when `exportDocx` is given `trackRevisions`, written; `w:evenAndOddHeaders` and the note
properties of `w:footnotePr` and `w:endnotePr` are the document's `settings`, written when they
differ from the part (the separators listed in those elements stay). Each is added in its place
among the settings, or removed; the rest of the part is kept byte for byte, and all of it when
nothing differs. A new package gets a settings part only with tracking on or `settings`.

**Export** (`exportDocx(document, package?, options?)`) writes the parts the editor owns
(`document.xml`, `styles.xml`, `numbering.xml`, `comments.xml`, `commentsExtended.xml`,
relationships for new hyperlink targets, and `settings.xml` when `trackRevisions` or `settings`
change it)
and copies every other part of the original package byte for byte (its compressed entry
included). Within the parts it writes:

- An element read from the file comes back verbatim while its values are what import read from
  it (a paragraph's `w:pPr`, a run's `w:rPr`, a section, a style, a numbering level or
  definition, a comment's start tag). Changed, it is rewritten child by child: unchanged
  properties keep their original element (unknown attributes included), changed ones are
  written from the model, and children Foli does not model stay in the order Word requires.
  Recorded formatting changes inside a style's, a level's, the defaults' or a paragraph mark's
  properties are not modeled: they stay as written.
- Opaque content, unknown attributes in bags, latent styles, picture bullets and anything else
  the parts hold outside the model come back as they were; styles, definitions and comments the
  editor removed are left out; new ones are added where Word expects them; a part the document
  now needs (numbering, comments, comment threads) is added with its content type and
  relationship. Comments made in the editor that are in a thread get a `w14:paraId`, so their
  replies and resolved state are written. Tracked changes and comments the editor records (0.4.0: insertions,
  deletions, run and paragraph formatting changes, comments, replies, resolved threads) are
  written as Word writes them; Word reads them back with their authors and text, and Foli reads
  Word's own changes and replies (checked with Word on the corpus: `corpus/README.md`). A run's
  recorded formatting (`w:rPrChange`) is imported in canonical form, as the editor records it.
- Runs are regrouped from the model: hyperlinks outermost, then insertions (or move
  destinations), deletions (or move sources) with `w:delText`, then runs of equal properties.
  Line ends and vertical tabs in text become breaks, a tab character `w:tab` (read back as a
  `tab` node); a character XML cannot hold (other control characters, lone surrogates) is
  refused with a `DocxError`, never written.
- Verbatim content (opaque nodes, `ext`, attribute bags) is checked against the part it goes
  into: one element of the expected kind, prefixes the part declares, no attribute the writer
  writes itself. What does not fit is a `DocxError`, never ill-formed XML.
- Without a package, a new one is made (from a migrated v2 document, say), declaring Word's
  namespaces. A document that refers to parts of its original package (headers and footers it
  has no story for, pictures, content kept verbatim with relationship ids) needs that package:
  exporting it without one is a `DocxError`.
- Headers, footers, footnotes and endnotes are the document's `stories`. An unchanged one keeps
  its part (or, for a note, its element) byte for byte; a changed one is written from the model;
  a new one gets its part, relationship and content type. A note whose story is gone is removed
  from its part. A document without `stories` leaves those parts as they are. Notes inserted,
  deleted, tracked, converted or given new options in the editor are written as Word writes them,
  and Word reads them back (`scripts/corpus/story-roundtrip.mjs`).
- Tables are written from the model: each properties element as paragraphs' are (verbatim
  while unchanged, else child by child), the grid as read while its widths are, rows and cells
  in order; Word reads every corpus table back with Foli's text, unchanged and edited
  (`scripts/corpus/table-roundtrip.mjs`). A changed table style definition is refused
  (`DocxError`): Foli has no command that changes one.
- **Pictures** (10.8, 10.9): a `w:drawing` holding one DrawingML picture (`wp:inline` or
  `wp:anchor`, `pic:pic`, its image an embedded `image/*` part) becomes a `picture` node: `resource` (the
  image part's name, `word/media/image1.png`, a key of the envelope's `resources`, which give
  its content type, size and part), its size in EMU (`wp:extent`), `alt` and `title`
  (`wp:docPr`), `decorative` (Office's `adec:decorative`), and the drawing verbatim in `ext`
  (cropping, effects, ids; an SVG picture's SVG part stays there, its PNG fallback is the
  resource). An empty description stays empty. A picture without alt text and not decorative is allowed and
  counted (`report.picturesWithoutAlt`). A floating picture (`wp:anchor`) is a `picture` node
  too, with `float`: `horizontal` and `vertical` (`relativeFrom` as `relativeTo`, and
  `wp:posOffset` as `offset` in EMU or `wp:align` as `align`), `wrap` (`square`, `tight`,
  `through`, `topAndBottom`; `wp:wrapNone` is `behind` or `inFront` by `behindDoc`), `side`
  (`wrapText`), `distance` (`distT`…`distR`), `allowOverlap` and `layoutInCell`; its z-order,
  lock and wrap polygon stay in `ext`. A position given both an `offset` and an `align` (Foli's
  schema allows it; Word's holds one) is written with the offset. One positioned by `simplePos`, hidden, sized relative to
  the page (`wp14:sizeRelH`/`sizeRelV`), or with no position or wrapping the model reads, stays
  opaque, as linked images, charts, shapes and other drawings do.
- Pictures are written from their `ext` with only what the model changed from it written in
  (the extent and the transform's size, alt text and title on `wp:docPr` and `pic:cNvPr`, the
  image's relationship): an unchanged picture comes back byte for byte, values the file holds
  twice (and differently) included. A copy of a drawing (the same id twice) gets new
  `wp:docPr` and `pic:cNvPr` ids, its `wp14` anchor ids left to Word. One without `ext` (new) is
  a fresh drawing, inline or `wp:anchor` (a position Word cannot read written as `column` or
  `paragraph` at offset 0, tight and through wrapping with the picture's rectangle as the
  polygon); so is a floating picture whose `float` differs from its `ext`'s, and one made
  floating or inline: what only its `ext` held is then lost (cropping, effects, z-order, lock,
  `hidden`, the wrap polygon, an SVG picture's SVG part, a click link; no command changes a
  float yet); new ids are above every drawing id in the document's parts. Its image
  is the package's part when the resource names one there of the size and an image type import
  recorded (a part of that name in another package is another image); otherwise a new media
  part (`word/media/foli-imageN.ext`, its content type declared) with the bytes of the
  resource's `data:` URL (base64 or percent-encoded) or of `ExportOptions.resource(key,
  resource)` (an app's upload); without bytes the export fails (`DocxError`), never drops the
  picture. Image relationships are matched by the part they point to. A drawing read in another
  part or package that refers to other relationships (an SVG's PNG fallback, a click link) is
  written fresh.
- Not written: the theme (read-only in the model: the original part is kept; a new package has
  none, so Word's default applies). Page margins Word requires but the document leaves out are
  written with Word's defaults. A part read as UTF-16 is written as UTF-8, declared so.

Checked: the corpus exported without edits equals the original under the canonical comparison
(`src/testing/canonical.ts`), with every other part, and every unchanged element, byte for byte
(tables as written, but for what import drops everywhere);
re-imported, it is the same document; random edits leave every other paragraph identical and
the edited one's unknown properties in place; Word opens the exports (unchanged, edited, and new
packages) and finds the reference numbers in the unchanged ones
(`scripts/corpus/rewrite-corpus.mjs`).

The package layer underneath:

```ts
import { readPackage } from "@folijs/docx";

const pkg = await readPackage(new Uint8Array(await file.arrayBuffer()));
pkg.mainDocument; // "/word/document.xml"
pkg.relationships(pkg.mainDocument); // [{ id: "rId1", type: ".../styles", partName: "/word/styles.xml", ... }]
const doc = pkg.xml(pkg.mainDocument); // elements with their offsets in doc.source
const body = doc.root.children.find((n) => n.kind === "element" && n.local === "body");

// Unchanged parts are copied from the original file as stored: written back with no
// replacements, the package is the identical file.
const bytes = await pkg.write(new Map([["/word/document.xml", new TextEncoder().encode(edited)]]));
```

- **Zip:** central directory reader and writer on the platform's `DecompressionStream` and
  `CompressionStream` (`deflate-raw`). Entries keep their headers and compressed data; only
  replaced parts are compressed again (keeping their name bytes). Data descriptors supported;
  encrypted entries, ZIP64 and methods other than stored and deflate are refused. Untrusted
  files are expected: every local header must match its directory record, entries may not
  overlap, an end record counts only with its directory right before it, declared sizes must be
  ones deflate can produce, and every entry's size and CRC-32 is checked while inflating, one
  entry at a time. Limits on entry count and uncompressed size (`maxEntries`, default 10 000;
  `maxSize`, default 512 MiB).
- **XML:** `parseXml` keeps the source string and every node's offsets (`start`, `end`, and for
  elements `openEnd` and `closeStart`), so content the importer does not understand is written
  back as the exact characters it was read from (attributes also give `valueStart` and
  `valueEnd`). Namespaces resolved (`ns`, reserved prefixes enforced), references decoded, line
  ends and attribute whitespace normalized as XML defines; characters XML forbids, `--` in
  comments and `]]>` in text refused. No DTD: a document type declaration is refused (OOXML
  forbids one), so no entity expansion. Nesting limited (`maxDepth`, default 1000) so code
  walking the tree recursively is safe; linear time in the input.
- **Package:** part names compare case-insensitively and percent-decoded (never decoding a
  `/`), content types by override then default extension, relationship targets resolved
  against their source part (a target that is a full URI is not a part). The main part must be
  WordprocessingML (document, template, or their macro-enabled kinds). Text parts decode as
  UTF-8 or UTF-16 by byte order mark; invalid bytes throw. Each XML part is parsed once.

Errors: `ZipError` (the container), `XmlError` (with the `offset`), `DocxError` (the package,
naming the part; an XML error is its `cause`). `readPackage` takes the zip limits and
`maxDepth`.
