# @folijs/pdf

PDF for [Foli](https://github.com/josep-audenis/foli): `exportPdf` prints a Foli document (schema
v5 of `@folijs/core`) to PDF with a headless Chromium page your app supplies, from Foli's own page
layout: the pages the editor shows and prints. No browser dependency of its own: bring
Playwright (1.42+) or Puppeteer.

> Stable since 1.0.0: the public API and the saved format follow semver ([versions and deprecation](https://foli.josepaudenis.com/docs/deprecation/)); changes in `CHANGELOG.md`. Docs: [foli.josepaudenis.com/docs](https://foli.josepaudenis.com/docs/).

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
   renderer, bundled; your app needs nothing else) and the CSS you give (`styles`), after your
   `extensions` script if you give one (custom nodes, below).
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

## On a server

- **One export per page at a time.** A page shows one document: exports given the same page run
  one after another, never mixed, so one user's PDF never holds another's. For exports at once,
  give each its own page (a pool of pages).
- **`signal` and `timeout`** (milliseconds) stop an export: the call rejects at once; the export
  on the page stops at its next step, and the page's next export waits for it. A hung page is
  still the app's to close.
- **Keep `@folijs/pdf` external in a bundler** (esbuild's `external`, webpack's `externals`): it
  reads `dist/renderer.js` from beside its own file, which a bundle does not have.

## Fonts

Chromium lays the text out with the fonts it has: the machine's, and those the page loads. A
document in fonts the machine lacks (Office's cloud fonts, such as Aptos, are not installed
system-wide) prints in a fallback, with other line breaks than Word's. Install the fonts on the
machine that prints, or give `@font-face` rules in `styles` with the font files as `data:` URLs
(`src: url("data:font/ttf;base64,…")`; each face declared is loaded before the layout). A web
font's URL is not loaded (below). Only fonts you may embed in a PDF.

## Pictures

`resources(key, resource)` gives each picture's image: `{ data, contentType }` (a package part
is one), an image `data:` URL, `null` for the picture's box, `undefined` for the resource's own
`data:` URL. PNG, JPEG, GIF, WebP, BMP and SVG are drawn; EMF, WMF and TIFF print as the
picture's box. A picture whose image has not decoded after 10 seconds prints without it.

## Nothing leaves the page

A document is often a user's, and the server that exports it is inside your network: a picture
or font URL in it would make that server request any address it names. So the page loads nothing:
`exportPdf` hands it images and fonts as `data:` URLs only, a web URL (a resource's own `url`, or
one `resources` returns) prints the picture's box, and the page's Content Security Policy
(`default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src
'unsafe-inline'`) blocks every other request, those of `styles` included (`@import`, a web font).
To print a web image, fetch it yourself (checking the address) and give its bytes. Links are kept
in the PDF but never followed.

## Custom nodes and marks

Functions cannot be passed into the page, so an editor's extensions come as a script of your own,
`extensions`, run there before the renderer: it sets `globalThis.foliPdfExtensions` to the
extensions array (bundle their code into it; `h` is given to `render`). Without it custom nodes
print as their `.docx` text. A script that fails prints the document without the views, with no
error; it runs with the renderer's rights, so never build it from a document.

## Puppeteer

`PdfPage` is the part of a page `exportPdf` uses (`setContent`, `addScriptTag`, `evaluate`,
`pdf`). Playwright's and Puppeteer's (24) `Page` types fit it; it is run with Playwright's
Chromium only.

## In the browser

The editor prints the same pages with the user's dialog: `view.print()` (`@folijs/view`) updates
the fields from the pages, then opens the browser's print, with the same print rules.

- [API reference](https://github.com/josep-audenis/foli/blob/main/docs/api.md#folijspdf)
- [Limitations](https://github.com/josep-audenis/foli/blob/main/docs/limitations.md#print-and-pdf)
