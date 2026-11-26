# Corpus report: real .docx files (Phase 20)

What Foli 1.4.0 (`main` after #208) did with real Word files (Phase 28's run follows): 3 551 test documents of five
open-source projects ([ADR-0011](decisions/ADR-0011-external-corpus.md); `corpus/external.json`
pins them), 3 445 distinct by content, run 2026-11-22 on Windows 11, Node 25, Chromium
(Playwright). Counts, names and file names only, never document text. Reproduce:

```bash
pnpm build && pnpm corpus:fetch && pnpm corpus:run && pnpm corpus:render
```

Each file goes through `scripts/corpus/check.mjs` in a worker (120 s, 2 GB heap): import; export
with no edit, compared part by part with the file; a second import of the export compared with
the first; one character typed at the document's start, exported and read back (against the
unedited export's reading). Then `renderDocument` lays out every file that imported, in Chromium
(`apps/playground/word/corpus.word.ts`).

What the comparison counts: each part's elements and attribute values, prefixes and order aside,
and each paragraph's text with the formatting of every character (runs of one formatting joined;
text read as Word reads it: XML spaces around a `w:t` without `xml:space="preserve"` dropped, a no-break or other Unicode space kept; which
element holds text, `w:t`, `w:delText` or `w:instrText`, kept). Not counted: what Word writes anew
at every save (`rsid*`, `w14:paraId` and `w14:textId` outside comments, `w:proofErr`,
`w:lastRenderedPageBreak`), and runs with nothing in them, which Foli drops (the import report
lists them as dropped). Before these rules, runs joined on export made about 1 200 files look
lossy, and reading no-break spaces as spaces Word drops about 50 more.

## After Phase 28 (Strict Open XML, `mc:AlternateContent` roots)

Run again 2026-11-26 on `main` after #305 (the packages at 1.10.0 plus Phase 28), the same 3 445
distinct files, the same checks; compared file by file with the last run of Phase 20
(2026-11-22, after its fixes). Reproduce as above; the comparison is by SHA-256.

| Outcome                         | Phase 20 | After Phase 28 |
| ------------------------------- | -------: | -------------: |
| Imported, exported, read back   |    3 259 |          3 352 |
| Refused with a reason           |      186 |             93 |
| Crash on import or export, hung |        0 |              0 |

**The 93 files read now:** the 71 Strict Open XML files (LibreOffice, docx4j, the Open XML SDK)
and the 22 whose `word/document.xml` root is `mc:AlternateContent` (docx4j's `mc-root/*`
and three in `repeated/`: `rt-50`, `rt-51`, `sm-52`). 89 export with no difference counted and read back the same. The other four:

| Class                                       | Files | Examples                                      | Cause                                                                                  |
| ------------------------------------------- | ----: | --------------------------------------------- | -------------------------------------------------------------------------------------- |
| A paragraph added to an empty body          |     3 | `c79-71-empty-branch-taken`, `or-50`, `rw-24` | The branch Word takes holds no body content; a body needs a paragraph (row 12 below)   |
| A picture's ids renumbered, read back other |     1 | Open XML SDK `Strict01`                       | Two drawings with one `wp:docPr@id`: the export makes them unique, as for Transitional |

Word's own reading of the roots, against docx4j's `-word365` twins (Word's resaves): 27 of the 31
files with such a root in some part import with the twin's text; in `or-50`, `rq-32` and `rq-33`
the body is the twin's, but Word also moves a dropped `w:hdr`'s paragraphs into its footnote
separator (not imitated); `rq-31` Word cannot open. Word opened the Strict exports of the nine synthetic documents (`corpus/word/strict/`), edited
and not, without a repair (28.3).

**Still refused (93):** 38 docx4j tests whose root Word only recovers from (`w:madeUp` 15,
`w:sdtContent` 4, `w:foo`/`foo`/`z:foo` 6, `z:madeUp` 2, `w:footnotes` 2, and one each of
`madeUp`, `w:p`, `w:tc`, `w:body`, `w:hdr`, `w:ftr`, `w:endnotes`, `w:comments`, `w:styles`): the
message names the root. The other 55 are broken on purpose or right to refuse, as in "Refused, by
reason": not a zip (13), encrypted or a legacy `.doc` (8), duplicate zip entries (10), malformed
XML (18), no `w:body` or `[Content_Types].xml` (4), a damaged zip or another main part (2).

**Changed though Phase 28 does not touch them:** 2 files read the same way in both runs
(Transitional, no `mc:AlternateContent` root) but differ now: LibreOffice's `tdf124670` (a
paragraph's text differs on export) and the Open XML SDK's `Comment040` (comment ids renumbered,
read back otherwise). Both come from the `@folijs/docx` changes of Phases 21–27; to the backlog.

**Renderer:** 3 352 files laid out, 6 106 pages, no exception or page error; median 10 ms, p95
54 ms, the slowest 8.2 s (POI's `bug65649`). The same 10 files as before have a page that overflows
its sheet; none of the 93 new ones does.

## Outcomes

| Outcome                                                     | Files | Share of 3 445 |
| ----------------------------------------------------------- | ----: | -------------: |
| Imported, exported, read back                               | 3 252 |          94.4% |
| …of which with no difference counted, read back the same    | 3 181 |          92.3% |
| Refused with a reason (`DocxError`, `ZipError`)             |   186 |           5.4% |
| Crash on export                                             |     4 |           0.1% |
| Crash on import (the model refused what the importer built) |     3 |           0.1% |
| Hung, or killed its worker                                  |     0 |                |

The edit: typed and read back in every file that exported; in 27 the document starts where a
character cannot go (a table, a picture, opaque content), so nothing was typed.

Times (Node, per file, the four steps together): median 32 ms, p95 228 ms; 269 s of work for all
files (6 workers); the slowest 23 s (POI's `bug65649.docx`).

**Renderer** (3 256 files that imported, 5 983 pages): every one laid out, no exception, no page
error; median 10 ms, p95 54 ms, the slowest 9.1 s. 10 files have a page whose content overflows
its sheet (LibreOffice's `fdo78659`, `tdf104061_tableSectionColumns`,
`tdf120760_ZOrderInHeader`, `tdf131098_imageFill`, `tdf135595_HFtableWrap_c12`, …).

## What goes wrong, ranked

By kind, then by how many distinct files show it. A file can be in several rows. "Cause" is from
the examples, not yet confirmed by a fix.

| #   | Class                                                           | Files | Kind     | Examples                                                                                               | Cause, as far as seen                                                                                                                                             |
| --- | --------------------------------------------------------------- | ----: | -------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Crash on import: a run property twice                           |     3 | crash    | LibreOffice `i124106`, `tdf102466`, `tdf92335`                                                         | A style's or a numbering level's `w:rPr` holding one property twice is read as two marks of one type; the schema refuses it                                       |
| 2   | Crash on export: "a note reference has no note"                 |     4 | crash    | docx4j `mc-root/c79-12-…`, `mc-root/c79-13-…`, `package-wiring/rn-08-…`; LibreOffice `tdf153255`       | A `w:footnoteReference` to a note the notes part does not hold: import keeps it, export refuses                                                                   |
| 3   | Paragraph text changed on export                                |     2 | loss     | docx4j `br-placement/br2-3-instrtext-bare-header`; LibreOffice `tdf108806`                             | A header's field code, written without its field characters, lost; one paragraph's text in another order                                                          |
| 4   | Second import differs from the first                            |    28 | loss     | docx4j `cr065-decimals-probe`, `Docx4j_GettingStarted`, `sm-73-rfonts-in-one-rpr`; LibreOffice tables  | Mostly kept XML (`ext`, `gridExt`) differing in white space or an empty container (22 of 28); a tab character in `w:t`; a header's field code; a doubled property |
| 5   | Tracked changes lost (`w:ins`, `w:del`)                         |     2 | loss     | LibreOffice `tdf157011_ins_del_empty_cols`; `testTrackChangesEmptyParagraphsInADeletion`               | Insertions and deletions of empty paragraphs or table columns                                                                                                     |
| 6   | Paragraph properties lost (`w:pPr`, `w:ind`, `w:jc`, `w:numPr`) |     8 | loss     | docx4j `repeated/c79-40-…`, `c79-41-…`, `c79-42-…`, `rc-20-pPr-values`                                 | A `w:pPr` (or a property) written twice in one paragraph: one of them is kept. Synthetic, schema-invalid tests; the same family as 1 and 9                        |
| 7   | Run properties lost (`w:rPr`)                                   |     5 | loss     | docx4j `repeated/*`                                                                                    | As 6, in runs                                                                                                                                                     |
| 8   | Empty hyperlinks dropped (`w:hyperlink` with no run)            |    13 | changed  | docx4j `hl-fields`, `revisions/cr068/word-*-accept-all`; `stress008`, `glossaryWithEmail`, `tdf155736` | A `w:hyperlink` with nothing in it is not kept; it shows nothing                                                                                                  |
| 9   | Paragraph formatted otherwise (`w:vanish`, `w:rFonts`)          |     4 | changed  | docx4j `sm-73-rfonts-in-one-rpr`, `sm-80-vanish-on-off`, `sm-81-vanish-off-on`; POI `Tika-792`         | A property written twice (on then off): the other one is kept                                                                                                     |
| 10  | Field lock and dirty flags changed                              |     8 | changed  | docx4j `fields/cr067-*`                                                                                | `w:fldChar@w:fldLock` and `@w:dirty` normalized on export                                                                                                         |
| 11  | Table properties added (`w:tblPr`, `w:tblGrid`)                 |     9 | added    | LibreOffice `fdo53985`, `tdf104162`, `tdf108714`, `tdf111550`                                          | A table without them gets them (Word always writes them)                                                                                                          |
| 12  | A paragraph added to an empty body                              |     3 | added    | Open XML SDK `empty`, POI `Bug60341`, python-docx `default`                                            | A body needs a paragraph                                                                                                                                          |
| 13  | A break's default type dropped (`w:br@w:type="textWrapping"`)   |     8 | harmless | LibreOffice `clearing-break`, `FDO76248`, `chart*`                                                     | The default value written as absent; `w:clear` kept                                                                                                               |
| 14  | Renderer: a page overflows its sheet                            |    10 | layout   | LibreOffice `fdo78659`, `tdf135595_HFtableWrap_c12`                                                    | Floats and tables in headers, image fills                                                                                                                         |

## Refused, by reason

| Reason                                                                      | Files | What it is                                                                                    |
| --------------------------------------------------------------------------- | ----: | --------------------------------------------------------------------------------------------- |
| Strict Open XML (`purl.oclc.org/ooxml` namespaces)                          |    71 | A feature: Word's "Strict" format, which Word reads and Foli does not yet                     |
| `/word/document.xml: not a WordprocessingML document`                       |    60 | docx4j's `mc-root/*`: the document's root inside markup compatibility (`mc:AlternateContent`) |
| Malformed XML (a DTD, an unclosed element, an attribute without a value, …) |    18 | Broken on purpose (most are LibreOffice and docx4j tests of exactly this)                     |
| Not a zip archive                                                           |    13 | Broken on purpose, or not a .docx                                                             |
| Duplicate entry in the zip                                                  |    10 | Word refuses these too                                                                        |
| An encrypted document or a legacy .doc                                      |     8 | Right to refuse                                                                               |
| No `w:body`; no `[Content_Types].xml`                                       |     4 | Broken                                                                                        |
| A damaged zip (a local header); the main part another kind (`themeManager`) |     2 | Broken, or not a word-processing document                                                     |

## What 20.5 fixes

The plan's order: crashes and data loss first, then refusals, then losses on export.

1. Crashes: rows 1 and 2.
2. Data loss: rows 3, 4, 5.
3. The repeated-property family (rows 6, 7, 9, and 1's cause) once, if one fix covers it: their
   inputs are synthetic and schema-invalid, so they come after real losses.

Then the owner chooses whether the markup-compatibility root (60) and Strict Open XML (71) are
fixed here or go to the backlog (chosen on 2026-11-22: the backlog, both). Rows 8 and 10–14
change what the file holds without changing what it shows: the backlog, unless they fall out of
the fixes above.

## Fixes

| Row  | Fix                                                                                                                                                                                                                                                                                                                        |      Files before |                             After |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------: | --------------------------------: |
| 1    | A run property written twice read as one mark, reported (`import/properties.ts`)                                                                                                                                                                                                                                           |                 3 |   0 (all three export equivalent) |
| 2    | A reference to a note the package lacks kept verbatim on import (`import/content.ts`)                                                                                                                                                                                                                                      |                 4 |    0 (all four export equivalent) |
| 3, 4 | A `w:instrText` holding elements (a `w:br`) kept verbatim; a tab character in `w:t` read as a tab, as the export writes it (`import/content.ts`)                                                                                                                                                                           | 2 and 6 of the 28 |             1 (`tdf108806`) and 0 |
| 4    | Not a fix: of the 28, 22 differed only in kept XML (`ext`, `gridExt`) by white space between elements or an empty container (`<w:tblPr></w:tblPr>`); the comparison now reads kept XML that way (`keptCanonical`)                                                                                                          |                22 |                                 0 |
| 3    | Not a fix: in `tdf108806` a line end inside a preserved `w:t`, which Word and Foli read as a space; the comparison now does too                                                                                                                                                                                            |                 1 |                                 0 |
| 9    | Row 1's fix (#210): the three docx4j `sm-*` files read their doubled property as one                                                                                                                                                                                                                                       |                 4 |                    1 (`Tika-792`) |
| 6, 7 | A second `w:pPr` read into the first, property by property (the paragraph mark's marks by type), as Word 365 resaves docx4j's `repeated` files; it was dropped without a report (`import/content.ts`). The export writes one `w:pPr`, so these 8 still count as `w:pPr` lost, and their second import keeps the merged one |         8 dropped | 0 dropped (8 merged as Word does) |
| 1, 9 | Checked with Word: its resaves of docx4j's `sm-73`, `sm-80`, `sm-81` merge a doubled run property the same way (later wins, attributes merged)                                                                                                                                                                             |                   |                                   |

After these (a run of the whole set, 2026-11-22): 3 259 of 3 445 import, export and read back
(3 204, 93.0%, with no difference counted), 186 refused, no crash, no paragraph text changed; the second import differs only in the 8 merged `w:pPr` files.

## Word on a sample

20.6, 2026-11-22, Word 365 on Windows: `scripts/corpus/word-sample.mjs` took the first 30 files
(by SHA-256) of each project that import, export and read back (150: five projects, 30 each), and Foli's export of each with no edit;
`word-reference.ps1` measured both in Word (opened without a repair, pages, each paragraph's
text, page, line and list number, revisions, comments, notes, fields, bookmarks, content controls,
pictures, sections and their headers and footers).

| Outcome                                                                    | Files |
| -------------------------------------------------------------------------- | ----: |
| Word opens both and measures the same                                      |   142 |
| Word opens both and measures a difference                                  |     1 |
| Word refuses both (`UnknownElement`, POI's OPC compliance tests, two more) |     4 |
| Word refuses the original as damaged and opens the export                  |     1 |
| Opened both, not measured: a signed document, a protected one              |     2 |
| Word opens the original and refuses the export                             |     0 |

The difference: docx4j's `ArialUnicodeMS` has three paragraphs holding a literal soft hyphen
(U+00AD) in `w:t`. Foli's model holds one character for both that and the `w:softHyphen`
element, and the export writes the element, so Word shows an optional hyphen where it showed
the character. The same holds for U+2011 and `w:noBreakHyphen`. Keeping them apart needs a
model change: on the backlog. The file Word calls damaged
is POI's `stress005`; Foli's export of it opens, read-only as the file asks (`w:documentProtection`),
so Word could not measure it.
