# @folijs/docx

DOCX for [Foli](https://github.com/josep-audenis/foli): imports a `.docx` into Foli's Word model
(schema v3 of `@folijs/core`), and reads its package (zip, parts, content types, relationships)
and XML keeping every byte it does not change. No DOM: runs in the browser, workers and Node
20.12+. Depends only on `@folijs/core`.

> In development (Phase 8): import, the package and XML layer are here; export comes next (8.5).
> Not published yet.

```ts
import { importDocx } from "@folijs/docx";

const {
  document,
  package: pkg,
  report,
} = await importDocx(new Uint8Array(await file.arrayBuffer()));
document.content; // schema v3: paragraphs with Word's properties, runs as text with marks
document.styles; // with basedOn, run and paragraph properties
report.opaque; // { "w:tbl": 1, "w:drawing": 1 }: kept verbatim, not editable yet
```

**Import** (`importDocx`, `importPackage`) reads the main document, styles (with the document
defaults), numbering, the theme's fonts and colors, comments (with replies and resolved state
from `commentsExtended`) and sections:

- **Paragraphs** with their properties (style, justification, indentation, spacing, keep rules,
  outline level, numbering, tab stops, borders, shading, the paragraph mark's formatting and
  tracked insertion or deletion, formatting changes, section breaks) and their own attributes
  (`w14:paraId`…). **Runs** become text, tabs and breaks with their properties as marks; tracked
  insertions, deletions and moves, hyperlinks (target from the relationship, or a bookmark),
  bookmarks, comment ranges and references are modeled.
- **Lossless:** every properties element is kept verbatim (`ext` on paragraphs, sections,
  styles, numbering; `runExt` on runs), every element Foli does not model yet (tables, content
  controls, pictures, fields' structure, footnote references, equations…) becomes an opaque node
  holding its source, and export will write all of it back (8.5). Keep `package` with the
  document: the parts Foli does not edit are written back from it.
- **What Word opens, imports:** each value is checked on its own; one the model cannot hold (out
  of range, a unit such as `1.5cm`) is left out of the model, kept in the verbatim element and
  listed in `report.unmodeled`. A style cycle is broken where it closes, a reply that would close
  a cycle of replies is not kept. Not imported, because Word recomputes them: spelling marks
  (`w:proofErr`), rendered page breaks (`w:lastRenderedPageBreak`) and run attributes (editing
  session ids): counted in `report.dropped`.
- Strict Open XML documents are refused (`DocxError`) until a real file needs them.

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
