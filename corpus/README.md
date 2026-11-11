# Word corpus

Documents for checking Foli against Microsoft Word ([ADR-0005](../docs/decisions/ADR-0005-word-compatible-model.md),
Phase 8): import, rendering, editing and lossless export are measured on them.

## Synthetic documents (`word/`)

Fictional business documents, written by Microsoft Word itself through automation, so they
carry what real Word files carry: full style sheets, numbering definitions, the theme, revision
ids, settings, a glossary for content-control placeholders. The companies and people in them do
not exist.

| File                                  | Exercises                                                                                                                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-mutual-nda.docx`                  | Legal clause numbering linked to styles (1. / 1.1 / (a) / (i)), defined terms, a cross-reference to a clause (`REF`), a different first page, header from page 2, Page X of Y, a borderless signature table                                             |
| `02-services-agreement-redlined.docx` | Tracked changes by two authors (replaced, deleted and inserted text, a new clause, a formatting change), comments with replies and a resolved one, a fee table across two pages with a merged and shaded header repeated on the second, a bulleted list |
| `03-offer-letter-template.docx`       | Content controls (date, drop-down, plain text, check box, rich text) with placeholders, merge fields (`MERGEFIELD`), a letterhead with a picture in the header, footer small print                                                                      |
| `04-board-report.docx`                | Cover page (different first page), table of contents (`TOC`, `PAGEREF`), headings 1-3, bulleted and numbered lists, footnotes, a floating picture with square wrapping, a landscape section, a table with a caption (`SEQ`)                             |
| `05-business-letter.docx`             | Custom styles based on Normal, right tab stops with dot leaders, first-line and hanging indents, 1.15 line spacing, highlight, colored text, small caps, double underline, superscript, a manual page break, a page number in the header                |

Page fields in headers and footers (`PAGE`, `NUMPAGES`) keep the result Word cached when it
last updated them ("Page 1 of 1" in a 2-page document): Word computes them per page when it
shows the document, and real files carry stale values like these. A reader must compute them,
not trust the stored text.

Regenerate them (Windows with desktop Word) only when the documents change, and commit the
result; Word stamps new revision ids and dates on every run:

```bash
powershell -ExecutionPolicy Bypass -File scripts/corpus/build-word-corpus.ps1 -PdfDir <folder>
```

`-PdfDir` also exports Word's own PDF of each document (Word's rendering, to look at and compare
with; not committed). The script authors as fictional users and restores the Word user name and
"use these values regardless of sign in" when it ends; the settings of an interrupted run are
restored by the next run. The text is English (UK) whatever the generating Word's language, but
a document still takes the generating machine's Normal template and regional settings (decimal
symbol): after regenerating, check the files for anything personal before committing them.

## Word's reference data (`reference/word/`)

What Word does with each document, recorded by `scripts/corpus/word-reference.ps1` (Word
automation; documents opened read-only with macros disabled, closed without saving), for Foli to
be compared with:

```bash
powershell -ExecutionPolicy Bypass -File scripts/corpus/word-reference.ps1 [-In <folder>] [-Out <folder>] [-PdfDir <folder>]
```

One `<name>.json` per document:

| Field               | Meaning                                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `word`              | Word's build number                                                                                                                                                                 |
| `opened`            | Word opened the file; if not, `error` says why (a damaged file, a password, a busy Word). Word refuses a damaged file under automation: checked with a `document.xml` cut short     |
| `revisionsAccepted` | Tracked changes in the document. They are accepted in memory before measuring: the numbers below describe the final text, whatever markup view Word is set to                       |
| `pages`             | Word's page count                                                                                                                                                                   |
| `paragraphs`        | One per `w:p` of the main text, in order, table cells included: `text`, `page` and `line` where it starts, `endPage`, `listString` (the number Word shows: "1.1", "(a)"), `inTable` |

In `text` a manual line break is a newline; bullets in `listString` are the bullet font's code point
(U+F0B7 for Symbol's bullet). Pages and lines depend on the Word build, the installed fonts and
the default printer: compare on the machine that produced the data, or regenerate there.

`-PdfDir` exports Word's PDF of each document too (the final text; not committed). The same
script checks any `.docx`, such as Foli's exports later. It exits 1 when a document opened but
could not be measured, keeping that document's earlier JSON. Regenerate the committed data when
the corpus changes or Word updates (the `word` field), and delete the JSON of a document removed
from the corpus.

## Checking Foli's writing with Word

`scripts/corpus/rewrite-corpus.mjs` (after `pnpm build`) writes each document back through
`@folijs/docx`, unchanged and with its main part replaced; the harness then checks that Word
opens every one and finds the reference numbers:

```bash
node scripts/corpus/rewrite-corpus.mjs <folder>
powershell -ExecutionPolicy Bypass -File scripts/corpus/word-reference.ps1 -In <folder> -Out <folder>
```

## Import coverage

`scripts/corpus/import-report.mjs` (after `pnpm build`) imports each document and prints what
became editable and what stayed opaque; counts and element names only, never text, so it runs
on a private folder too (`node scripts/corpus/import-report.mjs <folder>`). On the corpus
(2026-11-11):

| Document                       | Paragraphs | Opaque                                                        | Unmodeled values |
| ------------------------------ | ---------: | ------------------------------------------------------------- | ---------------: |
| 01-mutual-nda                  |         29 | table 1; field structure 4                                    |                0 |
| 02-services-agreement-redlined |         16 | table 1; comment reference marks 4                            |                0 |
| 03-offer-letter-template       |         14 | content controls 5, merge field 1; field structure 4          |                0 |
| 04-board-report                |         35 | table 1, picture 1, footnote references 2; field structure 36 |                0 |
| 05-business-letter             |         17 | none                                                          |                0 |

Field structure (`w:fldChar`, `w:instrText`) and comment reference marks have nothing to show:
the field's result stays editable text. The tests check every imported paragraph's text against
Word's (`reference/word/`).

## Private documents

Real documents (contracts, templates) are never committed. Keep them in a folder outside the
repository and run the harness with `-In` on that folder and `-Out` outside the repository: its
JSON holds the documents' text, so the script refuses to write it into the repository.
