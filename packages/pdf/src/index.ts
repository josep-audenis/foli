/**
 * `exportPdf` (11.12, ADR-0007): a document printed to PDF by a Chromium page the app supplies,
 * from Foli's own layout. The page is given the read-only renderer (`dist/renderer.js`, bundled
 * with `@folijs/core` and `@folijs/view`), which lays the document out on pages, updates its
 * fields from them and adds the editor's print rules; then Chromium prints it. No browser
 * dependency: Playwright's and Puppeteer's pages fit `PdfPage`.
 */
import { readFile } from "node:fs/promises";
import {
  type FieldsReport,
  type FoliDocument,
  parseDocument,
  type ResourceJSON,
  type ReviewView,
} from "@folijs/core";

/**
 * What `exportPdf` uses of a page: Playwright's `Page` (1.42+ for the outline and tags) and
 * Puppeteer's `Page` have these. The page is the app's: `exportPdf` replaces its content.
 */
export interface PdfPage {
  setContent(html: string): Promise<unknown>;
  addScriptTag(options: { content: string }): Promise<unknown>;
  // Not generic: Playwright's and Puppeteer's typings of `evaluate` both fit this one.
  evaluate(fn: (arg: RenderInput) => Promise<Rendered>, arg: RenderInput): Promise<unknown>;
  pdf(options: PdfPrintOptions): Promise<Uint8Array>;
}

/** The options `exportPdf` gives `page.pdf`. */
export interface PdfPrintOptions {
  /** Each sheet the size of its section's pages (the print rules' `@page`). */
  preferCSSPageSize: true;
  printBackground: true;
  /** PDF bookmarks from the headings (Chromium; Playwright 1.42+). */
  outline: true;
  /** A tagged PDF (Chromium; Playwright 1.42+). */
  tagged: true;
}

/**
 * A picture's image: bytes with their type (a `.docx` package part is one), an image `data:` URL,
 * `null` for the picture's box, `undefined` for the resource's own `data:` URL. The page loads
 * nothing from the network: a web URL, given here or in the resource, prints the picture's box.
 */
export type PdfImage = { data: Uint8Array; contentType: string } | string | null | undefined;

export interface ExportPdfOptions {
  /** The page that prints: the app's Chromium page (headless), with the document's fonts. */
  page: PdfPage;
  /**
   * The images of the document's pictures, by resource, as bytes or `data:` URLs (for a `.docx`:
   * `(key, r) => (r.part ? pkg.part(`/${r.part}`) : undefined)`).
   */
  resources?: ((key: string, resource: ResourceJSON) => PdfImage) | undefined;
  /** How tracked changes print: `markup` (default), `simple` or `final` (as if accepted). */
  review?: ReviewView | undefined;
  /**
   * CSS added to the page before the document is laid out: `@font-face` rules for fonts the
   * machine does not have, their `src` as `data:` URLs (the page loads nothing from the network).
   * Each face declared is loaded first.
   */
  styles?: string | undefined;
}

export interface ExportedPdf {
  /** The PDF file. */
  pdf: Uint8Array;
  /** Its pages. */
  pages: number;
  /** The fields updated before printing, and those left as they were and why. */
  fields: FieldsReport;
}

/** What the page's renderer is given (`renderer.ts`). */
export interface RenderInput {
  document: FoliDocument;
  /** Image URLs by resource key; `null`: the picture's box. */
  images: Record<string, string | null>;
  review: ReviewView;
  styles: string;
}

/** What the page's renderer gives back. */
export interface Rendered {
  pages: number;
  fields: FieldsReport;
}

/** Image types Chromium shows in an `img`; others (EMF, WMF, TIFF) print as the picture's box. */
const SHOWN = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/svg+xml",
]);

const DATA_IMAGE = /^data:image\//i;

/**
 * Every resource's image as the page shows it: a `data:` URL, or null for the picture's box.
 * Never a web URL: a document could make the server exporting it fetch any address, its own
 * network's included. An SVG is an `img`'s `data:` URL: its scripts never run.
 */
function images(
  document: FoliDocument,
  resources: ExportPdfOptions["resources"],
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [key, resource] of Object.entries(document.resources ?? {})) {
    const image = resources?.(key, resource) ?? resource.data ?? null;
    if (image === null || typeof image === "string")
      out[key] = image && DATA_IMAGE.test(image) ? image : null;
    else if (!SHOWN.has(image.contentType.toLowerCase())) out[key] = null;
    else {
      const { data, contentType } = image;
      const base64 = Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64");
      out[key] = `data:${contentType};base64,${base64}`;
    }
  }
  return out;
}

/**
 * The page's document. Its policy keeps everything inside the page: images and fonts from
 * `data:` URLs only, no other request, inline scripts (the renderer) and styles.
 */
const PAGE =
  '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" ' +
  `content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; ` +
  `script-src 'unsafe-inline'"></head><body></body></html>`;

let bundle: Promise<string> | null = null;

/** The page's renderer, built with the package (`dist/renderer.js`). */
function rendererBundle(): Promise<string> {
  // From src/ (the source condition) and dist/ alike.
  bundle ??= readFile(new URL("../dist/renderer.js", import.meta.url), "utf8").catch(
    (error: unknown) => {
      bundle = null;
      throw new Error("@folijs/pdf: dist/renderer.js is missing; build the package", {
        cause: error,
      });
    },
  );
  return bundle;
}

/**
 * Prints `document` to PDF with `options.page`: laid out on Foli's pages, fields updated from
 * them (`PAGE`, `NUMPAGES`, `PAGEREF`, tables of contents…), headers, footers, notes, columns
 * and sections as the editor shows them; each sheet its section's page size; links kept and
 * headings as PDF bookmarks. The page's content is replaced. `document` is validated first
 * (`parseDocument`): an invalid one throws before the page is touched.
 */
export async function exportPdf(
  document: FoliDocument,
  options: ExportPdfOptions,
): Promise<ExportedPdf> {
  const valid = parseDocument(document);
  const { page } = options;
  if (!page || typeof page.pdf !== "function" || typeof page.evaluate !== "function")
    throw new TypeError("@folijs/pdf: options.page must be a Playwright or Puppeteer page");
  const input: RenderInput = {
    document: valid,
    images: images(valid, options.resources),
    review: options.review ?? "markup",
    styles: options.styles ?? "",
  };
  const script = await rendererBundle();
  await page.setContent(PAGE);
  await page.addScriptTag({ content: script });
  const rendered = (await page.evaluate(
    (arg: RenderInput) =>
      (
        window as unknown as { foliPdf: { render(input: RenderInput): Promise<Rendered> } }
      ).foliPdf.render(arg),
    input,
  )) as Rendered;
  const pdf = await page.pdf({
    preferCSSPageSize: true,
    printBackground: true,
    outline: true,
    tagged: true,
  });
  return { pdf, pages: rendered.pages, fields: rendered.fields };
}
