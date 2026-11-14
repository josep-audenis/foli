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
`@folijs/docx`: the package unchanged and with its main part replaced (8.2), imported and
exported without edits and with edits (8.5), and a new package from a schema v2 document. The
harness then checks that Word opens every one, and finds the reference numbers in those
without edits (2026-11-13: all 21 open; the 15 without edits match their reference exactly):

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

## Page agreement with Word

`pnpm corpus:pages` (Playwright, Chromium) lays each document out with `renderDocumentV3`
(`@folijs/view`, read-only, tracked changes accepted as in the reference data) and compares
every paragraph outside tables with Word's reference: the page it starts on, and the line of
that page. Paragraphs are matched by text, in order; those Foli does not show as paragraphs
(inside content controls) are left out. Results go to `test-results/word-pages.json`.

The numbers depend on the fonts. Chromium uses the installed ones; Word's default since 2023,
Aptos, is an Office cloud font that is not installed system-wide, so the run serves it to the
page from Office's font cache when one exists (`FOLI_FONT_DIR`, default the Windows cache;
families in `FOLI_FONTS`, default `Aptos,Aptos Display`). The font files are read in place for
that run only: never copied or committed.

Baseline (2026-11-13, Word 16.0.20527, Chromium; of 106 paragraphs compared):

| Document                       | Compared | On Word's page | On Word's line | Within a line | Without Aptos: page / line |
| ------------------------------ | -------: | -------------: | -------------: | ------------: | -------------------------: |
| 01-mutual-nda                  |       29 |             29 |             29 |            29 |                     29 / 8 |
| 02-services-agreement-redlined |       16 |             16 |             15 |            16 |                    14 / 10 |
| 03-offer-letter-template       |        9 |              9 |              9 |             9 |                      9 / 9 |
| 04-board-report                |       35 |             35 |             33 |            34 |                    35 / 33 |
| 05-business-letter             |       17 |             17 |             17 |            17 |                    17 / 17 |
| **Total**                      |  **106** |        **106** |        **103** |       **105** |               **104 / 77** |

The documents are short (1-4 pages) and most of their page breaks are explicit, so the page
number alone says little: the line is the stricter measure, and it moves with the fonts. The
three lines that differ: the paragraph after the fee table in 02 (Word counts the header row it
repeats on the second page as a line; Foli does not), and two empty paragraphs around the table
of contents in 04 (a field Foli keeps opaque). Not laid out yet, so not measured: headers and
footers (their space is Word's margin here), footnotes, floating pictures, and text inside
tables.

## Pages against Word's PDF

The same run compares every page Foli shows with Word's page as Word prints it, when it is
given Word's PDFs (not committed; `word-reference.ps1 -PdfDir` writes them):

```bash
powershell -ExecutionPolicy Bypass -File scripts/corpus/word-reference.ps1 -Out <folder> -PdfDir <pdf-folder>
FOLI_WORD_PDF=<pdf-folder> pnpm corpus:pages
```

Word's page is rendered by pdf.js and Foli's is a screenshot, both at 96 px per inch. Each is
reduced to the pixels that hold ink (darker than mid grey: text and rules, not highlights or
shading), and ink in one counts as matched where the other has ink within 2 px across and
down (`apps/playground/src/ink.ts`): enough for antialiasing and hinting, not for another
line, whose glyphs fall elsewhere. A page's score is the harmonic mean of the two shares
matched: 1 when the pages agree, falling as text moves or wraps differently (in the unit test,
a block of text 3 px lower scores 0.9, half a line lower under 0.5, a whole line lower about
0.5), 0 when no ink is where the other has it. A page only one of them has, or of another size
(another orientation or paper), scores 0 and is reported. The score inside the margins leaves
out headers, footers and page numbers, which Foli does not lay out yet. Documents without a
PDF are listed in the results (`pdf.missing`). Overlays go to `test-results/word-pdf/`: black
where both have ink, red Word only, blue Foli only.

Baseline (2026-11-14, Word 16.0.20527, Chromium, with Aptos; mean of the pages; the same on
a second run):

| Document                       | Pages | Page score | Inside the margins | Per page (inside the margins) |
| ------------------------------ | ----: | ---------: | -----------------: | ----------------------------- |
| 01-mutual-nda                  |     2 |      0.420 |              0.428 | 0.410, 0.446                  |
| 02-services-agreement-redlined |     3 |      0.523 |              0.528 | 0.427, 0.598, 0.560           |
| 03-offer-letter-template       |     1 |      0.164 |              0.191 | 0.191                         |
| 04-board-report                |     4 |      0.514 |              0.527 | 1.000, 0.663, 0.184, 0.261    |
| 05-business-letter             |     2 |      0.927 |              0.968 | 0.936, 1.000                  |
| **All 12 pages**               |       |  **0.540** |          **0.556** |                               |

The number is strict where the page and line numbers are not: in 01 every paragraph starts on
Word's line, yet the numbered clauses drift down the page (Foli's lines there are taller than
Word's) and some wrap at a different word. In 03 the whole text sits higher than Word's, which
moves it below a letterhead taller than the top margin. In 04 the footnotes and the floating
chart are missing (Foli's text does not wrap around it), and the headings sit lower than Word's.

## Private documents

Real documents (contracts, templates) are never committed. Keep them in a folder outside the
repository and run the harness with `-In` on that folder and `-Out` outside the repository: its
JSON holds the documents' text, so the script refuses to write it into the repository.
