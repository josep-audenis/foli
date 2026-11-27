# Format fixtures

One document per schema version (0.x, and each 1.x minor that adds one), each written by the release that saved that version
(ADR-0008: every 1.x reads every earlier format). `src/v3/formats.test.ts` (core) loads, saves
and compares them; `src/formats.test.ts` (docx) takes them through `.docx` too.

| File                                     | Schema | Saved by   | What it is                                                                                    |
| ---------------------------------------- | -----: | ---------- | --------------------------------------------------------------------------------------------- |
| `v1.json`                                |      1 | 0.1.0      | Headings 1, 3 and 6, the four marks, a line and a page break, an empty paragraph, emoji       |
| `v2.json`                                |      2 | 0.2.0      | Alignment, nested ordered and bullet lists with a start, rules, links, text colors, highlight |
| `v3-02-services-agreement-redlined.json` |      3 | 0.3.0      | The corpus's 02 as 0.3.0's `@folijs/docx` read it: tracked changes, comments, opaque tables   |
| `v4-04-board-report.json`                |      4 | 0.5.0      | The corpus's 04 as 0.5.0 read it: tables, a picture, opaque notes and fields                  |
| `v5-03-offer-letter-template.json`       |      5 | 0.6.0      | The corpus's 03 as 0.6.0 read it: content controls, merge fields, a header picture            |
| `v5-09-pump-test-memo.json`              |      5 | 0.6.0      | The corpus's 09 as 0.6.0 read it: footnotes, endnotes, bookmarks, fields                      |
| `v6.json`                                |      6 | 1.4.0      | A picture rotated and cropped by 1.4.0's commands (19.5), saved by its editor                 |
| `v8.json`                                |      8 | 1.7.0      | A table's style, a header row and a cell's shading changed while tracking (23.2), dates fixed |
| `v9.json`                                |      9 | (Phase 32) | v7's with a page color, page borders and line numbers (hand-made from v7 before the release)  |
| `v10-11-text-box-flyer.json`             |     10 | (Phase 33) | The corpus's 11 as Phase 33's `@folijs/docx` read it: text boxes in the body and a header     |

`migrated/v1.json` and `migrated/v2.json` are what 1.x saves from the v1 and v2 fixtures (the
migration to Word's model), reviewed when recorded in 12.11: a change to them is a change to
what old documents become, to be reviewed again (`vitest -u` rewrites them).

## Regenerating

The fixtures stand for documents already saved: never regenerate one to make a test pass. Only
to add a format (a 1.x minor's new schema version: add that release to `generate.mjs`) or to
check that the files are what the releases wrote:

```bash
node packages/core/fixtures/formats/generate.mjs
pnpm format
git diff packages/core/fixtures/formats   # empty: the files are reproduced exactly
```

`generate.mjs` takes each release's `packages/core/src` (and `packages/docx/src` from 0.3.0 on)
from its git tag (`@folijs/core@0.1.0`, `@folijs/core@0.2.0`, `@folijs/core@0.3.0` with
`@folijs/docx@0.3.0`, `@folijs/core@0.5.0` with `@folijs/docx@0.5.0`, `@folijs/core@0.6.0` with
`@folijs/docx@0.6.0`), compiles it with the repository's TypeScript into a temporary folder (no
install: the packages have no dependencies but core), builds the v1 and v2 documents through that
release's `createDocument` and `parseDocument`, reads the corpus files at that tag with that
release's `importDocx`, and writes what that release's `parseDocument` returns. 0.4.0 saved v3
like 0.3.0 and is not separate.
