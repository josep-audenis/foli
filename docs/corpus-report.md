# Corpus report: real .docx files (Phase 20)

What Foli 1.4.0 (`main` after #208) does with real Word files: 3 551 test documents of five
open-source projects ([ADR-0011](decisions/ADR-0011-external-corpus.md); `corpus/external.json`
pins them), 3 445 distinct by content, run 2026-11-22 on Windows 11, Node 25, Chromium
(Playwright). Counts, names and file names only, never document text. Reproduce:

```bash
pnpm build && pnpm corpus:fetch && pnpm corpus:run && pnpm corpus:render
```

Each file goes through `scripts/corpus/check.mjs` in a worker (120 s, 2 GB heap): import; export
with no edit, compared part by part with the file (elements, attribute values and each
paragraph's text with its formatting, runs of one formatting joined; namespace prefixes, order,
whitespace and what Word writes anew at every save, `rsid*`, `w14:paraId`, `w:proofErr` and
`w:lastRenderedPageBreak`, aside); a second import of the export compared with the first; one
character typed at the start, exported and read back. Then `renderDocument` lays out every file
that imported, in Chromium (`apps/playground/word/corpus.word.ts`).

## Outcomes

| Outcome                                                     | Files | Share |
| ----------------------------------------------------------- | ----: | ----: |
| Imported, exported, read back, edited                       | 3 248 | 94.3% |
| Refused with a reason (`DocxError`, `ZipError`)             |   186 |  5.4% |
| Crash on export                                             |     4 |  0.1% |
| Crash later (the edit's export read back otherwise)         |     4 |  0.1% |
| Crash on import (the model refused what the importer built) |     3 |  0.1% |
| Hung or killed its worker                                   |     0 |       |

Of the 3 248, 3 047 (93.8% of the distinct files) exported with no difference the comparison
counts and read back the same; the rest are below.

Times (Node, per file, the four steps together): median 33 ms, p95 250 ms; 248 s of work for all
files (6 workers); the slowest file 20.5 s (`docx4j/docs/Docx4j_GettingStarted.docx`, 1 170 blocks).

**Renderer** (3 256 files that imported, 5 983 pages): every one laid out, no exception, no page
error; median 10 ms, p95 54 ms, the slowest 9.1 s. 10 files have a page whose content overflows
its sheet (e.g. LibreOffice's `fdo78659`, `tdf104061_tableSectionColumns`,
`tdf120760_ZOrderInHeader`, `tdf131098_imageFill`, `tdf135595_HFtableWrap_c12`).

## What goes wrong, ranked

By how many distinct files show it. A file can be in several rows. "Cause" is from looking at
the examples, not yet confirmed by a fix.

| #   | Class                                                                        | Files | Kind    | Examples (file names)                                                                                            | Cause, as far as seen                                                                                              |
| --- | ---------------------------------------------------------------------------- | ----: | ------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | Crash on import: duplicate mark in a style's or a level's run                |     3 | crash   | LibreOffice `i124106`, `tdf102466`, `tdf92335`                                                                   | A `w:rPr` holding one property twice is read as two marks of one type; the schema refuses it                       |
| 2   | Crash on export: "a note reference has no note"                              |     4 | crash   | docx4j `c79-12-footnotes-r…`, `c79-13-endnotes-ro…`, `rn-08-rich-…`; LibreOffice `tdf153255`                     | A `w:footnoteReference` to a note the notes part does not hold (or no notes part): import keeps it, export refuses |
| 3   | Paragraph text changed on export                                             |    24 | loss    | LibreOffice `fdo47669`, `fdo76098`, `fixed-date-field`; docx4j `tblHeaderTestTwo`                                | At least: a field's code loses its leading and trailing spaces (`" DATE \@…" "` → `"DATE \@…"`); others to see     |
| 4   | Second import differs from the first                                         |    28 | loss    | docx4j `br2-3-instrtext-bare-header`, `cr065-decimals-probe`, `Docx4j_GettingStarted`, `sm-73-rfonts-in-one-rpr` | Export writes something import reads otherwise (a tab's type, kept run XML, a header's blocks)                     |
| 5   | Hyperlink lost on export (`w:hyperlink`, its `r:id`, `w:history`)            |    13 | loss    | docx4j `hl-fields`, `revisions/cr068/word-*-accept-all`                                                          | Hyperlinks with tracked changes or fields inside                                                                   |
| 6   | Paragraph properties lost (`w:pPr`, `w:ind`, `w:jc`, `w:numPr`, `w:spacing`) |     8 | loss    | docx4j `c79-40-ppr-nested-rpr`, `c79-41-ppr-numpr`, `c79-42-ppr-pprchange`, `rc-20-pPr-values`                   | A `w:pPr` written twice in one paragraph, or with a `w:pPrChange`: the second one's values are not kept            |
| 7   | The edit's export does not read back with the edited text                    |     4 | loss    | docx4j `cr065-decimals-probe`, `Docx4j_GettingStarted`; LibreOffice `tdf57589_hashColor`, `xml_space`            | Probably the same as 3 or 4 on the typed paragraph                                                                 |
| 8   | Field lock and dirty flags changed (`w:fldChar@w:fldLock`, `@w:dirty`)       |     8 | changed | docx4j `fields/cr067-*`                                                                                          | Flags normalized on export                                                                                         |
| 9   | Table properties added (`w:tblPr`, `w:tblGrid`, `w:p`)                       |     6 | added   | LibreOffice `fdo53985`, `tdf104162`, `tdf108714`, `tdf111550`                                                    | Tables without a `w:tblPr` or `w:tblGrid` (Word always writes them) get them; harmless, but not as read            |
| 10  | Paragraph formatted otherwise (`w:vanish`, `w:rFonts`)                       |     4 | changed | —                                                                                                                | To see                                                                                                             |
| 11  | Comments' text changed                                                       |     4 | loss    | python-docx `comments-rich-para`                                                                                 | Runs in comments: a space between two runs lost                                                                    |
| 12  | Tracked changes renested (`w:moveFrom` in `w:ins`)                           |     1 | changed | —                                                                                                                | Nesting of a move inside an insertion swapped                                                                      |
| 13  | Renderer: a page overflows its sheet                                         |    10 | layout  | LibreOffice `fdo78659`, `tdf135595_HFtableWrap_c12`                                                              | Floats and tables in headers, image fills                                                                          |

## Refused, by reason

| Reason                                                                  | Files | What it is                                                                                    |
| ----------------------------------------------------------------------- | ----: | --------------------------------------------------------------------------------------------- |
| Strict Open XML (`purl.oclc.org/ooxml` namespaces)                      |    71 | A feature: Word's "Strict" format, read by Word, not by Foli yet                              |
| `/word/document.xml: not a WordprocessingML document`                   |    60 | docx4j's `mc-root/*`: the document's root inside markup compatibility (`mc:AlternateContent`) |
| Not a zip archive                                                       |    13 | Broken on purpose, or not a .docx                                                             |
| An encrypted document or a legacy .doc                                  |     8 | Right to refuse                                                                               |
| Duplicate entry in the zip                                              |     9 | Word refuses these too                                                                        |
| Malformed XML, a DTD, an unclosed element, an attribute without a value |    11 | Broken on purpose (most are LibreOffice and docx4j tests of exactly this)                     |
| No `w:body`; no `[Content_Types].xml`                                   |     4 | Broken                                                                                        |

## What 20.5 fixes

The plan's order: crashes and data loss first, then refusals, then losses on export. So rows 1
and 2 (crashes), then 3–7 (text, hyperlinks, paragraph properties, read-back), each with a
reduced fixture written for it and the class's count after the fix noted here. Then the owner
chooses whether the markup-compatibility root (60) and Strict Open XML (71) are fixed here or
go to the backlog; rows 8–13 go to the backlog unless they fall out of the fixes above.

## Fixes

None yet (20.5).
