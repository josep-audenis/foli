# ADR-0014: Strict Open XML, translated at the part boundary

- **Status:** Accepted when merged, task 28.1 (2026-11-25), by an agent's review, as the owner
  asked for Phase 28 ("keep doing all of them iteratively").
- **Context:** Phase 20's corpus run refused 71 Strict Open XML files ("Strict Open XML
  documents are not supported yet", `import/index.ts`). Strict is what Word writes for "Strict
  Open XML Document" (Save As, `wdFormatStrictOpenXMLDocument` = 24): ECMA-376 Part 1's schemas,
  where the usual `.docx` is Part 4's Transitional. The importer, the model, the kept XML and the
  exporter all read and write Transitional names. Foli keeps XML it does not model as its source
  text (`xml.ts`: every node records its offsets, kept content is `source.slice(start, end)`), so
  anything kept is the very text a part was read from.

## What differs

Measured on the nine of `corpus/word/` saved by Word (build 16.0, 2026-11-25) both ways from the
same open document (`scripts/corpus/save-strict.ps1`, `corpus/word/strict/`), and on the 75
Strict packages of the fetched corpus (71 distinct; LibreOffice, docx4j, the Open XML SDK).

**Same in both:** the parts, their names and their structure; every content type; the OPC names
(`[Content_Types].xml`, the `Relationships` namespace, the core-properties relationship type,
`dc`/`dcterms`); Microsoft's extensions (`w14`, `w15`, `w16*`, `mc`, their relationship types
such as `stylesWithEffects`, `diagramDrawing`, `commentsExtended`), but for the text of the four
`wp14` percentages below; half-point sizes (`w:sz`), eighths of a point (border `w:sz`), EMU
(`wp:extent`, `wp:posOffset`), angles. `schemaLibrary` is written in its Transitional name by
Word even in a Strict package (the corpus also has its Strict name): read in both, written as
Word writes it.

**What Word leaves out of a Strict save** (so a twin's import differs there, and nothing is to be
translated): `w:shapeDefaults` and `w:hdrShapeDefaults` (settings), `w:useFELayout` (the
glossary's settings), and a `w:charset` it has no IANA name for (Symbol's `02`).

**Namespaces** (`http://purl.oclc.org/ooxml/` + the left column ↔ the right):

| Strict (under `purl.oclc.org/ooxml/`) | Transitional                                                     |
| ------------------------------------- | ---------------------------------------------------------------- |
| `wordprocessingml/main`               | `schemas.openxmlformats.org/wordprocessingml/2006/main`          |
| `officeDocument/relationships`        | `…/officeDocument/2006/relationships`                            |
| `officeDocument/math`                 | `…/officeDocument/2006/math`                                     |
| `officeDocument/extendedProperties`   | `…/officeDocument/2006/extended-properties`                      |
| `officeDocument/docPropsVTypes`       | `…/officeDocument/2006/docPropsVTypes`                           |
| `officeDocument/customXml`            | `…/officeDocument/2006/customXml`                                |
| `officeDocument/bibliography`         | `…/officeDocument/2006/bibliography`                             |
| `officeDocument/sharedTypes`          | `…/officeDocument/2006/sharedTypes`                              |
| `schemaLibrary/main`                  | `schemas.openxmlformats.org/schemaLibrary/2006/main` (read only) |
| `drawingml/main`                      | `schemas.openxmlformats.org/drawingml/2006/main`                 |
| `drawingml/wordprocessingDrawing`     | `…/drawingml/2006/wordprocessingDrawing`                         |
| `drawingml/picture`                   | `…/drawingml/2006/picture` (also `a:graphicData@uri`'s value)    |
| `drawingml/chart`                     | `…/drawingml/2006/chart` (also `a:graphicData@uri`)              |
| `drawingml/diagram`                   | `…/drawingml/2006/diagram` (also `a:graphicData@uri`)            |
| `drawingml/lockedCanvas`              | `…/drawingml/2006/lockedCanvas` (also `a:graphicData@uri`)       |
| `drawingml/chartDrawing`              | `…/drawingml/2006/chartDrawing`                                  |
| `drawingml/compatibility`             | `…/drawingml/2006/compatibility`                                 |
| `spreadsheetml/main`                  | `schemas.openxmlformats.org/spreadsheetml/2006/main`             |

**Relationship types:** `purl.oclc.org/ooxml/officeDocument/relationships/<name>` ↔
`schemas.openxmlformats.org/officeDocument/2006/relationships/<name>`, the same `<name>` but
`extendedProperties` ↔ `extended-properties`, `customProperties` ↔ `custom-properties` and
`metadata/thumbnail` ↔ the package's `schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail`.
One corpus file mixes a Transitional type into a Strict package: read as it is.

**Values and names** (Strict ↔ Transitional; R read in Strict's form, W written back in it, K kept
as read):

| Where                                                                                                                                                                                                                                                                                                                                                                    | Strict                                                          | Transitional                               |     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------ | --- |
| `w:document@w:conformance` (not on `w:glossaryDocument`: Word does not write it there)                                                                                                                                                                                                                                                                                   | `strict`                                                        | absent                                     | R W |
| Twips Word writes as points: `w:ind@start,end,left,right,hanging,firstLine`, `w:spacing@before,after,line`, `w:tab@pos`, `w:pgSz@w,h`, `w:pgMar@*`, `w:cols@space`, `w:col@w,space`, `w:defaultTabStop@val`, `w:hyphenationZone@val`, `w:drawingGridHorizontalSpacing@val`, `w:drawingGridVerticalSpacing@val`, `w:object@dxaOrig,dyaOrig`                               | `36pt`, `35.40pt`                                               | `720`, `708`                               | R W |
| Twips Word writes as numbers in Strict too: `w:gridCol@w`, `w:spacing@val` (`w:rPr`), `w:trHeight@val`, `w:framePr@w,h,hSpace,vSpace,x,y`, `w:tblpPr@*FromText,tblpX,tblpY`, `w:lnNumType@distance`, `w:drawingGrid*Origin@val`                                                                                                                                          | a number, or a universal measure from another writer            | a number                                   | R   |
| Half-points: `w:sz`, `w:szCs`, `w:kern`, `w:position` (`@val`)                                                                                                                                                                                                                                                                                                           | a number, or a universal measure                                | a number                                   | R   |
| Widths (`w:tblW`, `w:tcW`, `w:tblInd`, `w:tblCellSpacing`, `w:wBefore`, `w:wAfter`, the margins of `w:tblCellMar`/`w:tcMar`), by `w:type`                                                                                                                                                                                                                                | `dxa`: `5.40pt`; `pct`: `50%`                                   | `108`; `2500` (fiftieths)                  | R W |
| `w:zoom@w:percent`                                                                                                                                                                                                                                                                                                                                                       | `110%`                                                          | `110`                                      | R W |
| `w:w@w:val` (`w:rPr`, text scale)                                                                                                                                                                                                                                                                                                                                        | `110%`, or a number                                             | `110`                                      | R   |
| `w:jc@val`, `w:lvlJc@val`, `w:tab@val`                                                                                                                                                                                                                                                                                                                                   | `start`, `end`                                                  | `left`, `right`                            | R W |
| `w:ind@start,end,startChars,endChars`                                                                                                                                                                                                                                                                                                                                    | `start`, `end`, `startChars`, `endChars`                        | `left`, `right`, `leftChars`, `rightChars` | R W |
| `w:start`, `w:end` in `w:tblBorders`, `w:tcBorders`, `w:tblCellMar`, `w:tcMar`                                                                                                                                                                                                                                                                                           | `w:start`, `w:end`                                              | `w:left`, `w:right`                        | R W |
| DrawingML percentages: `a:tint`, `a:shade`, `a:alpha`, `a:alphaMod`, `a:alphaOff`, `a:lumMod`, `a:lumOff`, `a:satMod`, `a:satOff`, `a:hueMod`, `a:spcPct` (`@val`); `a:gs@pos`; `a:miter@lim`; `a:alphaModFix@amt`; `a:lum@bright,contrast`; `a:srcRect`, `a:fillRect`, `a:fillToRect`, `a:tileRect` (`@l,t,r,b`); `a:scrgbClr@r,g,b`; `a:rPr`, `a:defRPr` (`@baseline`) | `50%`                                                           | `50000` (thousandths)                      | R W |
| The text of `wp14:pctWidth`, `wp14:pctHeight`, `wp14:pctPosHOffset`, `wp14:pctPosVOffset`                                                                                                                                                                                                                                                                                | `0%`                                                            | `0` (thousandths)                          | R W |
| `w:tblLook@w:val`, `w:cnfStyle@w:val`                                                                                                                                                                                                                                                                                                                                    | absent (the named attributes only)                              | hex or bits, beside the named ones         | R W |
| `w:charset`                                                                                                                                                                                                                                                                                                                                                              | `@w:characterSet` (`iso-8859-1`)                                | `@w:val` (`00`)                            | K   |
| `mc:Ignorable` of a part's root                                                                                                                                                                                                                                                                                                                                          | lists `wne`                                                     | does not                                   | K   |
| VML (`v:`, `o:`)                                                                                                                                                                                                                                                                                                                                                         | not allowed, but 5 parts of the corpus's Strict files hold some | allowed                                    | K   |

Word writes a twips value `n` as `n/20` points, `36pt` when whole, else with two decimals
(`35.40pt`, `451.30pt`); a percentage as its value with `%`, no zeros after the point (`50%`).

## Decision

**Translate the text of a Strict part where it is read and where it is written, and nowhere
else.** `strict.ts` holds the tables above, once, and two functions over a part's source:
`toTransitional(source)` and `toStrict(source)`. Each parses the part (`parseXml`) and returns its
text with only the listed spans replaced, every other character as it was: namespace URIs in
`xmlns` declarations and `a:graphicData@uri`, relationship types, the listed attribute values and
names, the listed element names in both tags, the text of the listed elements, and the attributes
one form has and the other lacks (`w:conformance`, `w:tblLook@w:val` and `w:cnfStyle@w:val`,
removed or added from the named ones). The package (`readPackage`) knows its conformance from its
own relationships (`/_rels/.rels`, an `officeDocument` of Strict's type); in a Strict package
`text()` returns, and `xml()` and `relationships()` read, every XML part translated by
`toTransitional`. From there everything is Transitional: the property readers, the model, the
opaque and verbatim XML kept in the document, its JSON.

**Export writes the original's conformance.** `exportDocx` with a Strict original passes every
part it writes (the document, styles, numbering, comments, headers, footers, notes, settings,
relationships) through `toStrict`, in `DocxPackage.write`; parts it copies are the original's
bytes, Strict already. Export rewrites a part only when its new text differs from `text()`, so
an unchanged part is copied; `asDocument`'s second pass (it reads the written package again to
drop macros) goes through the same `text()` and `write`. Without the original, or with a
Transitional one, nothing changes: a document from a Strict file saved as JSON and exported on its
own is all Transitional, because nothing it kept is in Strict names. No schema change.

**Round trip.** For what Word writes, `toStrict(toTransitional(x))` is `x`, character for
character, for every XML part of the nine's Strict files: tested, since a part that did not come
back exact would be rewritten on every export. Other writers' forms (`0.5in`, `1.27cm`, `36.0pt`)
are read to the nearest twip and written back as Word writes them: the same value, another
spelling, which the corpus run classes "reformatted". An attribute not in the table keeps its text
both ways; a universal measure in one stays as written, which Transitional allows too (its current
schema's measure types accept universal measures; its 2006 first edition did not), and Foli's
readers read as no value.

**Not done:** writing Transitional from a Strict file or the reverse (no option asked for);
converting VML (kept as read, as Word reads it in the corpus's Strict files) or `w:charset` (the
font table is copied, never written).

## Consequences

- One map, both directions, in one file: a missed name shows as a corpus-run difference in a
  Strict file, fixed by adding a row.
- A Strict part is parsed twice on read (once to translate, once to import) and each written
  part once more on export; Strict files only.
- `W_STRICT` and its refusal go; `isW`, `REL` and the readers stay Transitional-only.
- Alternatives rejected: reading both namespaces in every reader (`isW` taking two URIs, the
  readers taking both value forms) spreads Strict through the importer and leaves kept XML in
  Strict names, so an export without the package mixes both; translating the parsed tree loses
  the source text kept content is sliced from.
