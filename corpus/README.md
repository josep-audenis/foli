# Word corpus

Documents for checking Foli against Microsoft Word ([ADR-0005](../docs/decisions/ADR-0005-word-compatible-model.md),
Phase 8): import, rendering, editing and lossless export are measured on them.

## Synthetic documents (`word/`)

Fictional business documents, written by Microsoft Word itself through automation, so they
carry what real Word files carry: full style sheets, numbering definitions, the theme, revision
ids, settings, a glossary for content-control placeholders. The companies and people in them do
not exist.

| File                                  | Exercises                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-mutual-nda.docx`                  | Legal clause numbering linked to styles (1. / 1.1 / (a) / (i)), defined terms, a cross-reference to a clause (`REF`), a different first page, header from page 2, Page X of Y, a borderless signature table                                                                                                                                                      |
| `02-services-agreement-redlined.docx` | Tracked changes by two authors (replaced, deleted and inserted text, a new clause, a formatting change), comments with replies and a resolved one, a fee table across two pages with a merged and shaded header repeated on the second, a bulleted list                                                                                                          |
| `03-offer-letter-template.docx`       | Content controls (date, drop-down, plain text, check box, rich text) with placeholders, merge fields (`MERGEFIELD`), a letterhead with a picture in the header, footer small print                                                                                                                                                                               |
| `04-board-report.docx`                | Cover page (different first page), table of contents (`TOC`, `PAGEREF`), headings 1-3, bulleted and numbered lists, footnotes, a floating picture with square wrapping, a landscape section, a table with a caption (`SEQ`)                                                                                                                                      |
| `05-business-letter.docx`             | Custom styles based on Normal, right tab stops with dot leaders, first-line and hanging indents, 1.15 line spacing, highlight, colored text, small caps, double underline, superscript, a manual page break, a page number in the header                                                                                                                         |
| `06-price-schedule.docx`              | Phase 10: a 41-row table over two pages with a repeated header row, a banded built-in table style (Medium List 1 - Accent 1), a category column merged down (`vMerge`), subtotal rows merged across (`gridSpan`), a tall row that may not break across pages (Word moves it to page 2 whole), a nested table in a cell after its caption, set column widths      |
| `07-picture-report.docx`              | Phase 10: inline pictures at the end of their paragraphs, with and without alt text; floating pictures wrapped square and top-and-bottom beside body text, one behind the text                                                                                                                                                                                   |
| `08-newsletter.docx`                  | Phase 11: five sections: one column, two balanced columns with a line between them (continuous), one column (continuous), three columns of set widths with a column break on a new page with a header of its own, a landscape section starting on an odd page after a blank page; even and odd headers and footers, a different first page, `PAGE` in the footer |
| `09-pump-test-memo.docx`              | Phase 11: footnotes, one longer than a page so it continues on the next, endnotes, a bookmark with `REF` and `PAGEREF` to it, a locked `DATE` field (Word recomputes an unlocked one on opening), numbered captions (`SEQ`), `PAGE` in the header                                                                                                                |

Page fields in headers and footers (`PAGE`, `NUMPAGES`) keep the result Word cached when it
last updated them ("Page 1 of 1" in a 2-page document): Word computes them per page when it
shows the document, and real files carry stale values like these. A reader must compute them,
not trust the stored text.

Regenerate them (Windows with desktop Word) only when the documents change, and commit the
result; Word stamps new revision ids and dates on every run:

```bash
powershell -ExecutionPolicy Bypass -File scripts/corpus/build-word-corpus.ps1 -PdfDir <folder>
```

`-Only "06 07"` builds only those documents and leaves the others as they are (their reference
data stays valid).

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

| Field               | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `word`              | Word's build number                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `opened`            | Word opened the file; if not, `error` says why (a damaged file, a password, a busy Word). Word refuses a damaged file under automation: checked with a `document.xml` cut short                                                                                                                                                                                                                                                                                              |
| `comments`          | How many comments the document has                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `revisionsAccepted` | Tracked changes in the document. They are accepted in memory before measuring: the numbers below describe the final text, whatever markup view Word is set to                                                                                                                                                                                                                                                                                                                |
| `pages`             | Word's page count                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `paragraphs`        | One per `w:p` of the main text, in order, table cells included: `text`, `page` and `line` where it starts, `endPage`, `listString` (the number Word shows: "1.1", "(a)"), `inTable`                                                                                                                                                                                                                                                                                          |
| `pictures`          | Each picture of the main text (inline ones first, then floating ones; headers' and footers' are left out): `page`, `left`/`top` (an inline one from the page's corner; a floating one from what it is `horizontalTo`/`verticalTo`, Word's WdRelative…Position; null when aligned, the alignment then in `horizontalAlign`/`verticalAlign`), `width`, `height` (points), `alt`, `wrap` (a floating one's WdWrapType), `paragraph` (a floating one's anchor, numbered from 1)  |
| `evenAndOddHeaders` | Whether even pages have their own headers and footers                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `pageSections`      | The section each page starts in, from page 1 (not meaningful for the blank page before an even or odd page section: 08's page 4 says 1)                                                                                                                                                                                                                                                                                                                                      |
| `sections`          | Each section: `page` it starts on, `start` (WdSectionStart), `columns`, `differentFirstPage`, and `headers` and `footers`, each with `default`, `first`, `even`: `exists`, `linked` (to the previous section), `tables`, `text` (as Word has it open: page fields recomputed, so not what the part stores, and a picture as `/`). `exists` says the variant is in effect (`first` needs a different first page, `even` even and odd headers), not that the file has the part |
| `notes`             | Each footnote, then each endnote: `kind`, `referencePage`, `text`, and the tracked changes in it (`revisions`, counted before changes are accepted). Word answers a note's own page with its reference's, so where a note continues shows only in its PDF                                                                                                                                                                                                                    |
| `fields`            | Each field of the main text: `type` (WdFieldType), `code`, `result` as Word has it open (an unlocked `DATE` would be today's), `page`                                                                                                                                                                                                                                                                                                                                        |
| `controls`          | Each content control of the main text: `type` (WdContentControlType), `tag`, `title`, `placeholder` (showing it), `text`                                                                                                                                                                                                                                                                                                                                                     |
| `bookmarks`         | Each visible bookmark: `name`, `page`, `text`                                                                                                                                                                                                                                                                                                                                                                                                                                |

`line` counts on down a page's columns (Word numbers the lines of a page in one run). In `text` a manual line break is a newline; bullets in `listString` are the bullet font's code point
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
without edits (2026-11-13, and again for 0.3.0 on 2026-11-16: all 21 open without a repair
prompt; the 15 without edits match their reference exactly):

```bash
node scripts/corpus/rewrite-corpus.mjs <folder>
powershell -ExecutionPolicy Bypass -File scripts/corpus/word-reference.ps1 -In <folder> -Out <folder>
```

## Review content with Word (`reference/review/`)

`scripts/corpus/word-review.ps1` records, for each document, its tracked changes (Word's type,
author, text), its comments (text, author, initials, the comment answered, resolved) and its
paragraphs with every change accepted and with every change rejected, as Word reads them. Run on
the corpus, it is the reference `packages/docx/src/review-word.test.ts` compares Foli with: the
same kinds of changes by the same authors, the same comments, threads and resolved state, and
Foli's accept-all and reject-all text equal to Word's paragraph by paragraph (those with fields
aside; 03 is not compared, its content control around paragraphs is one block in Foli). Documents other than the corpus: `-Out` and
`-Edit` outside the repository; `-Edit` copies are saved as new files, never over one.

`scripts/corpus/review-roundtrip.mjs` checks both directions. `make` opens every document in
Foli with tracking on and, as "Foli Reviewer", inserts, deletes, formats text and a paragraph,
comments, replies (as "Foli Replier") and resolves; `check` then reads what Word made of each
export, and the copy Word edited (a tracked insertion and a reply to the first comment, by Word's
user), back in Foli. 2026-11-16, Word 16.0.20527: all 5 open without a repair prompt; in each,
Word finds Foli's insertion, deletion, formatting and paragraph formatting by their author with
their text, the comment with its initials, the reply in its thread and both resolved; Word's
accepted and rejected text equals Foli's in 01, 02, 04 and 05 (paragraphs with fields aside;
03 has a content control around paragraphs); Foli reads back Word's tracked insertion and reply
in all 5.

```bash
pnpm build
powershell -ExecutionPolicy Bypass -File scripts/corpus/word-review.ps1 -In corpus/word -Out corpus/reference/review
node scripts/corpus/review-roundtrip.mjs make <folder>
powershell -ExecutionPolicy Bypass -File scripts/corpus/word-review.ps1 -In <folder>/foli -Out <folder>/word -Edit <folder>/edited
node scripts/corpus/review-roundtrip.mjs check <folder>
```

Dates: Foli writes changes' and comments' dates in UTC (`w:date`, `Z`); Word writes local time
there (and UTC in `w16du:dateUtc`), so Word shows Foli's times shifted by the time zone.

## Import coverage

`scripts/corpus/import-report.mjs` (after `pnpm build`) imports each document and prints what
became editable and what stayed opaque; counts and element names only, never text, so it runs
on a private folder too (`node scripts/corpus/import-report.mjs <folder>`). On the corpus
(2026-11-18, after 11.9: tables, pictures, headers, footers, notes, fields and content controls are modeled, and what stays
opaque is counted in those parts too; paragraphs count the body's, those in table cells included):

| Document                       | Paragraphs | Tables | Opaque                    | Unmodeled values |
| ------------------------------ | ---------: | -----: | ------------------------- | ---------------: |
| 01-mutual-nda                  |         37 |      1 | none                      |                0 |
| 02-services-agreement-redlined |         98 |      1 | comment reference marks 4 |                0 |
| 03-offer-letter-template       |         14 |      0 | none                      |                0 |
| 04-board-report                |         59 |      1 | none                      |                0 |
| 05-business-letter             |         17 |      0 | none                      |                0 |
| 06-price-schedule              |        202 |      2 | none                      |                0 |
| 07-picture-report              |          7 |      0 | none                      |                0 |
| 08-newsletter                  |         22 |      0 | none                      |                0 |
| 09-pump-test-memo              |         15 |      0 | none                      |                0 |

Comment reference marks have nothing to show. The tests check every imported paragraph's text
against Word's (`reference/word/`), table cells included (a cell a vertical merge covers has none in
Word's list: 06 counts 32 of them).

`scripts/corpus/field-roundtrip.mjs` (11.5) has Word read Foli's fields and content controls
back: every document holding them exported unchanged (Word finds the same fields, controls and
bookmarks) and edited (a field's result, a control's text, a block control split in two).

Since 11.8 it has Word read what `updateFields` and the insert commands write, Word's own pages as
the layout: 01, 04 and 09 with every result spoiled and updated, 04's table of contents built again
after an entry was spoiled (and again while tracking, and inside a block content control, as Word's gallery has it),
03's merge fields filled from data while tracking, and 04 with a page
number, the date, two cross-references to a heading and a new table of contents. Word finds exactly
the fields and results Foli holds (an unlocked `DATE` it recomputes; a `w:hyperlink` to a bookmark
counts as a field in Word's list and is left out). All 24 files pass (2026-11-18, Word 16.0.20527).
`packages/docx/src/fields-word.test.ts` does the arithmetic part on every run: on the corpus, with
Word's pages from `reference/word/`, every field works out to Word's result and nothing changes.

`scripts/corpus/control-roundtrip.mjs` (11.9, with `control-word.ps1`, which records what
`word-reference.ps1` does for controls and their locks, check box state, list items and date format)
has Word read what the editor makes of controls: 03 unchanged, filled through the API (also while
tracking), typed into, filled and emptied, with changed properties and with a control copied, and a
new document with every kind inserted and a repeating section grown; a tracked fill rejected. Word opens all 9 and finds
every control as Foli holds it, ids unique (2026-11-18, Word 16.0.20527).

`scripts/corpus/find-roundtrip.mjs` (11.11, with `find-word.ps1`, which reads every story as it
stands, accepted and rejected, and the bookmarks) replaces a word over the body and every story of
05, 09 and a new document with a header, a footer and both kinds of note, untracked and tracked, and
adds, renames, moves and deletes bookmarks. Word opens all 9, finds the new text where Foli put it,
records the changes in every story, and accepting and rejecting give the new and the old text; the
bookmarks hold the text Foli says (2026-11-19, Word 16.0.20527).

`scripts/corpus/section-roundtrip.mjs` (11.6) has Word read Foli's sections back: 08 exported
unchanged (Word's own pages and sections), edited through the editor's commands (a continuous
break, three columns in one section, a line between columns in the last), the same edits while
tracking (Word finds the inserted break and both setup changes), and a new package with columns,
set widths, an odd page section, page numbers and note properties. All 4 pass (2026-11-18).

`scripts/corpus/story-roundtrip.mjs` (11.4) has Word read Foli's stories back: every document
with stories exported unchanged and edited (text added to every header and footer and to a note,
a new footnote with its reference), and a new package with a header, a footer, a footnote and an
endnote. Word opens all of them; unchanged ones give Word's own pages, sections and notes, edited
ones Foli's text.

Since 11.7 it also has Word read what the editor's header commands make: 08 with even pages and
its first page turned off and its last section's header unlinked, 05 with even pages on and a
header typed in through `editor.story`, and a new package with even and odd headers. All 18 files
pass (2026-11-18, Word 16.0.20527).

`scripts/corpus/table-roundtrip.mjs` (10.4) has Word read Foli's tables back: every corpus
document with a table exported unchanged and edited (a cell's text as a tracked insertion, a row
kept from breaking, a cell shaded, a row deleted as a tracked change), then `word-reference.ps1`
on them; `check` compares Word's pages and paragraphs, table cells included, with Foli's, and
Word's count of tracked changes with Foli's; it also has Word open a table made in the model,
with and without a grid. All 10 pass (2026-11-17).

`scripts/corpus/picture-roundtrip.mjs` (10.10) does the same for pictures: every corpus document
with pictures (04, 07) exported unchanged and edited (every picture's alt text changed, the first
at half its size, every floating picture moved 10 pt right and down, so written as a new
`wp:anchor`, and a new inline picture from a `data:` URL); `check` has the unchanged ones with
Word's pages and Word's own picture positions, and the edited ones with Foli's alt text, sizes,
inline or floating, and moved offsets. All 4 pass (2026-11-17, Word 16.0.20527).
## Page agreement with Word

`pnpm corpus:pages` (Playwright, Chromium) lays each document out with `renderDocument`
(`@folijs/view`, read-only, tracked changes accepted as in the reference data) and compares
every paragraph outside tables with Word's reference: the page it starts on, and the line of
that page; and every paragraph in table cells: the page it starts on (`cellParagraphs`).
Paragraphs are matched by text, in order; those Foli does not show as paragraphs (inside
content controls) are left out. Results go to `test-results/word-pages.json`.

The numbers depend on the fonts. Chromium uses the installed ones; Word's default since 2023,
Aptos, is an Office cloud font that is not installed system-wide, so the run serves it to the
page from Office's font cache when one exists (`FOLI_FONT_DIR`, default the Windows cache;
families in `FOLI_FONTS`, default `Aptos,Aptos Display`). The font files are read in place for
that run only: never copied or committed.

Baseline (2026-11-13, Word 16.0.20527, Chromium; of 106 paragraphs compared; the same for 0.3.0
on 2026-11-16, with and without Aptos):

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
of contents in 04 (a field Foli keeps opaque). Footnotes were not laid out, so not measured; headers
and footers were not either until 11.7 (below).

Floating pictures (10.9, 2026-11-17, with Aptos): 07 has all 5 of its paragraphs on Word's page
(2 pages, as Word), 4 on Word's line. 04 keeps its 35 on Word's page but has 25 on Word's line
(33 before): its chart is now wrapped square and the 9 lines beside it, as Word's PDF shows them,
push what follows down, while Word's line numbers (`Range.Information`) count that paragraph as
5 lines. The line is no measure beside a floating picture; the editing view's floats are checked
against Word's offsets instead (`apps/playground/e2e/word-floats.spec.ts`).

Paragraphs in table cells (2026-11-16, after 10.5, with Aptos): 277 of 280 on Word's page: 01
8 of 8, 02 79 of 82, 04 24 of 24, 06 166 of 166 (the header row repeated, the row that may not
split moved whole to page 2, as in Word). The three that differ are one row of 02's fee table
that Word moves to the next page and Foli keeps on the first. The editing view lays tables out
the same way; `apps/playground/e2e/word-tables.spec.ts` checks 06 in it in three engines.

Phase 11's documents before it lays them out (2026-11-18, with Aptos), the numbers its tasks start
from: 08 has 19 of 22 paragraphs on Word's page and 6 on Word's line, and 4 pages against Word's 5,
its columns being laid out as one and the blank page before its last section missing; 09 has 7 of
15 on Word's page and 2 pages against Word's 3, its footnote of more than a page not being laid
out. Against Word's PDF: 08 0.321, 09 0.109.

After 11.6 (2026-11-18, Word 16.0.20527, Chromium, with Aptos): sections are laid out with their
columns, and the flow takes the larger of the space after and the space before, as Word's PDFs
show (it added them). 08 has all 22 paragraphs on Word's page, 20 on Word's line (the two others
are in columns of different widths, which Word numbers its own way) and Word's 5 pages, the blank
one included.

| Document | Page score before | After 11.6 | Inside the margins, after |
| -------- | ----------------: | ---------: | ------------------------: |
| 01       |             0.420 |      0.977 |                     0.994 |
| 02       |             0.530 |      0.852 |                     0.861 |
| 03       |             0.163 |      0.138 |                     0.160 |
| 04       |             0.513 |      0.790 |                     0.810 |
| 05       |             0.927 |      0.927 |                     0.968 |
| 06       |             0.942 |      0.942 |                     0.942 |
| 07       |             0.394 |      0.394 |                     0.394 |
| 08       |             0.321 |      0.989 |                     1.000 |
| 09       |             0.109 |      0.387 |                     0.388 |
| **All**  |         **0.463** |  **0.768** |                 **0.781** |

Of 155 paragraphs outside tables: 147 on Word's page (144 before), 131 on Word's line (117), 132
within a line (122); 277 of 280 paragraphs in table cells on Word's page, as before. 03 is the one
lower: its text starts about 44 px above Word's until its letterhead pushes it down (11.7), so the
score there measures where lines happen to overlap.

After 11.7 (2026-11-18, the same setup): headers and footers are on the pages, so the page score
now counts them. A header taller than its margin pushes the text (03), a line is as tall as its
runs and paragraph mark, and a line holding only a picture ends at its foot, as in Word's PDFs. The
paragraph numbers do not change. 03's text is where Word's: what it still loses on the page is its
letterhead, a picture drawn as a box against Word's ink. 09 waits for its footnotes (11.10), 04
for its footnotes and 07 for its pictures' ink.

| Document | After 11.6 | After 11.7 | Inside the margins, after |
| -------- | ---------: | ---------: | ------------------------: |
| 01       |      0.977 |      0.994 |                     0.994 |
| 02       |      0.852 |      0.858 |                     0.861 |
| 03       |      0.138 |      0.830 |                     1.000 |
| 04       |      0.790 |      0.821 |                     0.810 |
| 05       |      0.927 |      0.968 |                     0.968 |
| 06       |      0.942 |      0.942 |                     0.942 |
| 07       |      0.394 |      0.394 |                     0.394 |
| 08       |      0.989 |      1.000 |                     1.000 |
| 09       |      0.387 |      0.391 |                     0.388 |
| **All**  |  **0.768** |  **0.811** |                 **0.816** |

After 11.10 (2026-11-18, the same setup): footnotes and endnotes are on the pages, drawn from their
stories under their separators. All 158 paragraphs outside tables are on Word's page (150 before),
142 on Word's line (134). 09 goes from 2 pages to Word's 3, its long footnote continuing where
Word's does. 04's notes are where Word's are; what it still loses is its table of contents' tab
leaders and its chart's ink. No document is lower.

| Document | After 11.7 | After 11.10 | Inside the margins, after |
| -------- | ---------: | ----------: | ------------------------: |
| 01       |      0.994 |       0.994 |                     0.994 |
| 02       |      0.858 |       0.858 |                     0.861 |
| 03       |      0.830 |       0.830 |                     1.000 |
| 04       |      0.821 |       0.832 |                     0.822 |
| 05       |      0.968 |       0.968 |                     0.968 |
| 06       |      0.942 |       0.942 |                     0.942 |
| 07       |      0.394 |       0.394 |                     0.394 |
| 08       |      1.000 |       1.000 |                     1.000 |
| 09       |      0.391 |       0.999 |                     0.999 |
| **All**  |  **0.811** |   **0.889** |                 **0.894** |

`scripts/corpus/story-roundtrip.mjs` (with `note-word.ps1`) has Word read notes inserted, deleted,
tracked, rejected, converted and renumbered: all 24 files pass.

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
out headers, footers and page numbers; the page score counts them since 11.7. Documents without a
PDF are listed in the results (`pdf.missing`). Overlays go to `test-results/word-pdf/`: black
where both have ink, red Word only, blue Foli only.

Baseline (2026-11-16, for 0.3.0: Word 16.0.20527, Chromium, with Aptos; mean of the pages; on
2026-11-14 0.540 and 0.556, 02 and 04 a little lower):

| Document                       | Pages | Page score | Inside the margins | Per page (inside the margins) |
| ------------------------------ | ----: | ---------: | -----------------: | ----------------------------- |
| 01-mutual-nda                  |     2 |      0.420 |              0.428 | 0.410, 0.446                  |
| 02-services-agreement-redlined |     3 |      0.530 |              0.535 | 0.448, 0.598, 0.560           |
| 03-offer-letter-template       |     1 |      0.164 |              0.191 | 0.191                         |
| 04-board-report                |     4 |      0.519 |              0.532 | 1.000, 0.663, 0.203, 0.261    |
| 05-business-letter             |     2 |      0.927 |              0.968 | 0.936, 1.000                  |
| **All 12 pages**               |       |  **0.544** |          **0.560** |                               |

The number is strict where the page and line numbers are not: in 01 every paragraph starts on
Word's line, yet the numbered clauses drift down the page (Foli's lines there are taller than
Word's) and some wrap at a different word. In 03 the whole text sits higher than Word's, which
moves it below a letterhead taller than the top margin. In 04 the footnotes are missing and the
headings sit lower than Word's; since 10.9 the chart is drawn and the text wraps around it as in
Word, but page 3 scores 0.177 (0.203 before): the text beside it, being lower, is further from
Word's (the chart is drawn as a box here, so its ink does not count). 07 (10.9, not in the table
above): 0.123 and 0.665, its pictures as boxes against Word's ink, its floats where Word's are.

## Private documents

Real documents (contracts, templates) are never committed. Keep them in a folder outside the
repository and run the harness with `-In` on that folder and `-Out` outside the repository: its
JSON holds the documents' text, so the script refuses to write it into the repository.
