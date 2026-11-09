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
automation, read only), for Foli to be compared with:

```bash
powershell -ExecutionPolicy Bypass -File scripts/corpus/word-reference.ps1 [-In <folder>] [-Out <folder>] [-PdfDir <folder>]
```

One `<name>.json` per document:

| Field        | Meaning                                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `word`       | Word's build number (results differ between versions and fonts)                                                                                                                             |
| `opened`     | Word opened the file without complaint (under automation Word refuses a file it would offer to repair); `error` says why not                                                                |
| `pages`      | Word's page count                                                                                                                                                                           |
| `paragraphs` | Every paragraph of the main text in Word's order, table cells included: `text`, `page` and `line` where it starts, `endPage`, `listString` (the number Word shows, "1.1", "(a)"), `inTable` |

`-PdfDir` exports Word's PDF of each document too (not committed). The same script checks any
`.docx`, such as Foli's exports later: `opened` false means Word would need to repair it.
Regenerate the committed data when the corpus changes or Word updates (the `word` field).

## Private documents

Real documents (contracts, templates) are never committed. Keep them in a folder outside the
repository and run the harness with `-In` on that folder and `-Out` outside the repository too:
its JSON holds the documents' text.
