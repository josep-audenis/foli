# Visual regression and fixtures

Pagination depends on fonts, so its browser tests lay documents out with one bundled font:
Tinos (SIL OFL 1.1, from the `@fontsource/tinos` dev dependency). It is metric-compatible
with Times New Roman. Foli itself ships no font.

## Fixtures

`apps/playground/e2e/fixtures.ts` holds deterministic documents (no randomness):

| Fixture               | What it covers                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `short`               | One page, marks                                                                                                                          |
| `multi-page`          | Paragraphs of one to five lines over three pages                                                                                         |
| `long-paragraph`      | One paragraph split over several pages                                                                                                   |
| `heading-at-boundary` | A heading that would end page 1 moves with its paragraph                                                                                 |
| `explicit-breaks`     | `pageBreak` in the middle and at the end of a paragraph                                                                                  |
| `mixed-font-sizes`    | Heading levels 1–6, bold and italic (schema v1 has no font size)                                                                         |
| `different-margins`   | US Letter with uneven margins                                                                                                            |
| `lists`               | Lists across pages (7.4): an item split at a line, a nested list across a break, a justified paragraph split, a rule, a centered heading |

`openFixture(page, fixture)` stores the fixture as the playground document, reloads, serves
the font (intercepted requests to `/__foli-test-font/`), applies it with `--foli-font-family`,
waits for the faces to load, and waits until the layout stops changing between frames.
`pageBreaks(page)` lists each page's blocks (paragraphs, headings, rules, at any depth) as
`[>…] <block>[.<fragment>] (<characters>) <start>`, with one `>` per list item around the
block. Fixtures are stored as format v2.

## Print

`apps/playground/e2e/print.spec.ts`, for each fixture:

- in print media (all engines; re-flow frozen, since a real print does not re-flow), every
  page's content fits its sheet;
- printed to PDF (Chromium only: Playwright's `page.pdf`), one sheet per screen page, each of
  the fixture's page size.

## Snapshots

`apps/playground/e2e/visual.spec.ts` checks, for each fixture and engine:

- a second load gives the same page breaks;
- the page breaks match `<fixture>-breaks-<project>-<platform>.json`;
- the pages match `<fixture>-<project>-<platform>.png` (pixel-exact).

Snapshots live in `apps/playground/e2e/visual.spec.ts-snapshots/`. They are recorded on
Windows (`win32`), so another platform has none and its first run fails, writing them.
After an intended layout or style change:

```bash
pnpm test:e2e visual --project=playground-chromium --project=playground-webkit --update-snapshots
```

```bash
pnpm test:e2e visual --project=playground-firefox --workers=1 --update-snapshots
```

Then review the changed PNGs and JSON in the diff before committing.
