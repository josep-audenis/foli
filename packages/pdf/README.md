# @folijs/pdf

PDF for [Foli](https://github.com/josep-audenis/foli): `exportPdf` prints a Foli document (schema
v5 of `@folijs/core`) to PDF with a headless Chromium page your app supplies, from Foli's own page
layout: the pages the editor shows and prints. No browser dependency of its own: bring
Playwright (1.42+) or Puppeteer.

> Early release: the API may change in any 0.x minor version (changes in `CHANGELOG.md`).

```bash
npm install @folijs/pdf @folijs/core
```

```ts
import { importDocx } from "@folijs/docx";
import { exportPdf } from "@folijs/pdf";
import { chromium } from "playwright";

const { document, package: pkg } = await importDocx(bytes);
const browser = await chromium.launch();
const page = await browser.newPage();
const { pdf, pages, fields } = await exportPdf(document, {
  page,
  // The pictures' images: here a .docx package's parts.
  resources: (_key, resource) => (resource.part ? pkg.part(`/${resource.part}`) : undefined),
});
await browser.close();
```

What it does, in the page (its content is replaced):

1. Adds the package's renderer (`dist/renderer.js`: `@folijs/core` and `@folijs/view`'s read-only
   renderer, bundled; your app needs nothing else) and the CSS you give (`styles`).
2. Lays the document out on pages: every section's page size, margins and columns, headers and
   footers, footnotes and endnotes, tables, pictures, tracked changes as `review` says (`markup`,
   the default; `simple`; `final`).
3. Updates the fields from those pages (`updateFields` of `@folijs/core`: `PAGE`, `NUMPAGES`,
   `SECTIONPAGES`, `PAGEREF`, `REF`, `SEQ`, `DATE`, tables of contents…), lays out again what
   that changed, and again once for what depends on the pages. `fields` reports what was updated
   and what was left as it was (a locked field, an unknown one).
4. Makes links PDF links: a web link (`https:`, `mailto:`… the editor's safe targets) and a link to
   a bookmark of the document; other targets stay text.
5. Prints with `page.pdf({ preferCSSPageSize: true, printBackground: true, outline: true, tagged: true })`
   and the editor's own print rules: one sheet per page, each the size of its section's pages
   (CSS named pages: a landscape section prints on landscape sheets), headings as PDF bookmarks,
   a tagged PDF.

The document is validated first (`parseDocument`): an invalid one throws before the page is used.

## Fonts

Chromium lays the text out with the fonts it has: the machine's, and those the page loads. A
document in fonts the machine lacks (Office's cloud fonts, such as Aptos, are not installed
system-wide) prints in a fallback, with other line breaks than Word's. Install the fonts on the
machine that prints, or give `@font-face` rules in `styles` (each face declared is loaded before
the layout; a font from another origin needs CORS headers). Only fonts you may embed in a PDF.

## Pictures

`resources(key, resource)` gives each picture's image: `{ data, contentType }` (a package part
is one), a URL the page can load (`data:`, `https:`), `null` for the picture's box, `undefined`
for the resource's own `data:` or web URL. PNG, JPEG, GIF, WebP, BMP and SVG are drawn; EMF, WMF
and TIFF print as the picture's box.

## Puppeteer

`PdfPage` is the part of a page `exportPdf` uses (`setContent`, `addScriptTag`, `evaluate`,
`pdf`), which Puppeteer's `Page` has too. It is tested with Playwright's Chromium only.

## In the browser

The editor prints the same pages with the user's dialog: `view.print()` (`@folijs/view`) updates
the fields from the pages, then opens the browser's print, with the same print rules.

- [API reference](https://github.com/josep-audenis/foli/blob/main/docs/api.md#folijspdf)
- [Limitations](https://github.com/josep-audenis/foli/blob/main/docs/limitations.md#print-and-pdf)
