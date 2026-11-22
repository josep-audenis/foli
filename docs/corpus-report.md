# Corpus report: real .docx files (Phase 20)

What Foli 1.4.0 (`main` after #208) does with real Word files: 3 551 test documents of five
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

| #   | Class                                                           | Files | Kind     | Examples                                                                                               | Cause, as far as seen                                                                                                                      |
| --- | --------------------------------------------------------------- | ----: | -------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Crash on import: a run property twice                           |     3 | crash    | LibreOffice `i124106`, `tdf102466`, `tdf92335`                                                         | A style's or a numbering level's `w:rPr` holding one property twice is read as two marks of one type; the schema refuses it                |
| 2   | Crash on export: "a note reference has no note"                 |     4 | crash    | docx4j `mc-root/c79-12-…`, `mc-root/c79-13-…`, `package-wiring/rn-08-…`; LibreOffice `tdf153255`       | A `w:footnoteReference` to a note the notes part does not hold: import keeps it, export refuses                                            |
| 3   | Paragraph text changed on export                                |     2 | loss     | docx4j `br-placement/br2-3-instrtext-bare-header`; LibreOffice `tdf108806`                             | A header's field code, written without its field characters, lost; one paragraph's text in another order                                   |
| 4   | Second import differs from the first                            |    28 | loss     | docx4j `cr065-decimals-probe`, `Docx4j_GettingStarted`, `sm-73-rfonts-in-one-rpr`; LibreOffice tables  | Mostly a table's kept `ext`/`gridExt` read otherwise (20 of 28); a tab's type, a header's blocks, a comment                                |
| 5   | Tracked changes lost (`w:ins`, `w:del`)                         |     2 | loss     | LibreOffice `tdf157011_ins_del_empty_cols`; `testTrackChangesEmptyParagraphsInADeletion`               | Insertions and deletions of empty paragraphs or table columns                                                                              |
| 6   | Paragraph properties lost (`w:pPr`, `w:ind`, `w:jc`, `w:numPr`) |     8 | loss     | docx4j `repeated/c79-40-…`, `c79-41-…`, `c79-42-…`, `rc-20-pPr-values`                                 | A `w:pPr` (or a property) written twice in one paragraph: one of them is kept. Synthetic, schema-invalid tests; the same family as 1 and 9 |
| 7   | Run properties lost (`w:rPr`)                                   |     5 | loss     | docx4j `repeated/*`                                                                                    | As 6, in runs                                                                                                                              |
| 8   | Empty hyperlinks dropped (`w:hyperlink` with no run)            |    13 | changed  | docx4j `hl-fields`, `revisions/cr068/word-*-accept-all`; `stress008`, `glossaryWithEmail`, `tdf155736` | A `w:hyperlink` with nothing in it is not kept; it shows nothing                                                                           |
| 9   | Paragraph formatted otherwise (`w:vanish`, `w:rFonts`)          |     4 | changed  | docx4j `sm-73-rfonts-in-one-rpr`, `sm-80-vanish-on-off`, `sm-81-vanish-off-on`; POI `Tika-792`         | A property written twice (on then off): the other one is kept                                                                              |
| 10  | Field lock and dirty flags changed                              |     8 | changed  | docx4j `fields/cr067-*`                                                                                | `w:fldChar@w:fldLock` and `@w:dirty` normalized on export                                                                                  |
| 11  | Table properties added (`w:tblPr`, `w:tblGrid`)                 |     9 | added    | LibreOffice `fdo53985`, `tdf104162`, `tdf108714`, `tdf111550`                                          | A table without them gets them (Word always writes them)                                                                                   |
| 12  | A paragraph added to an empty body                              |     3 | added    | Open XML SDK `empty`, POI `Bug60341`, python-docx `default`                                            | A body needs a paragraph                                                                                                                   |
| 13  | A break's default type dropped (`w:br@w:type="textWrapping"`)   |     8 | harmless | LibreOffice `clearing-break`, `FDO76248`, `chart*`                                                     | The default value written as absent; `w:clear` kept                                                                                        |
| 14  | Renderer: a page overflows its sheet                            |    10 | layout   | LibreOffice `fdo78659`, `tdf135595_HFtableWrap_c12`                                                    | Floats and tables in headers, image fills                                                                                                  |

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
fixed here or go to the backlog. Rows 8 and 10–14 change what the file holds without changing
what it shows: the backlog, unless they fall out of the fixes above.

## Fixes

| Row  | Fix                                                                                                                                                                                                               | Files before |                           After |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----------: | ------------------------------: |
| 1    | A run property written twice read as one mark, reported (`import/properties.ts`)                                                                                                                                  |            3 | 0 (all three export equivalent) |
| 2    | A reference to a note the package lacks kept verbatim on import (`import/content.ts`)                                                                                                                             |            4 |  0 (all four export equivalent) |
| 3, 4 | A `w:instrText` holding elements (a `w:br`) kept verbatim; a tab character in `w:t` read as a tab, as the export writes it (`import/content.ts`)                                                                  |     2 and 28 |           1 (`tdf108806`) and 0 |
| 4    | Not a fix: of the 28, 22 differed only in kept XML (`ext`, `gridExt`) by white space between elements or an empty container (`<w:tblPr></w:tblPr>`); the comparison now reads kept XML that way (`keptCanonical`) |           22 |                               0 |
| 9    | Row 1's fix: the three docx4j `sm-*` files read their doubled property as one                                                                                                                                     |            4 |                  1 (`Tika-792`) |

After these (a run of the whole set, 2026-11-22): 3 259 of 3 445 import, export and read back
(3 203, 93.0%, with no difference counted), 186 refused, no crash, no second import that
differs.
