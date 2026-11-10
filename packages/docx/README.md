# @folijs/docx

DOCX for [Foli](https://github.com/josep-audenis/foli): reads a `.docx` package (its zip, parts,
content types and relationships) and its XML, keeping every byte it does not change. No DOM and
no dependencies: runs in the browser, workers and Node 20.12+.

> In development (Phase 8): the package and XML layer are here; import to Foli's document model
> and export come next. Not published yet.

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
