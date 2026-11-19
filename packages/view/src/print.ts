/**
 * Print rules shared by the editor's pages and the read-only renderer's (`renderDocument`), so
 * that the editor's `print()` and `@folijs/pdf`'s `exportPdf` print pages the same way (11.12).
 */

/**
 * The attribute naming a page's page setup (its index among the document's) for print.
 * @internal
 */
export const SHEET_ATTR = "data-foli-sheet";

/**
 * A page setup as print sees it: its sheet's size (CSS lengths) and its `SHEET_ATTR` value.
 * @internal
 */
export interface PrintSheet {
  readonly width: string;
  readonly height: string;
  readonly index: number;
}

/**
 * Print rules for the page elements `pages` selects: one sheet of its page setup's size per page
 * (`last`'s, the document's last section, where named pages are not supported), without margins
 * (the page's padding holds them). A page is exactly as tall as a sheet (the flow keeps content
 * inside it; the exact height absorbs its half-pixel slack), with no gap after it. Content taller
 * than a page (a line taller than a page) is not cut: it prints over the next sheet. `name` makes
 * the named pages unique on the web page.
 * @internal
 */
export function printStyles(
  pages: string,
  last: Pick<PrintSheet, "width" | "height">,
  sheets: readonly PrintSheet[],
  name: string,
): string {
  // Sections with other page sizes: a named page each (engines without named pages print
  // every sheet at the last section's size).
  const named = sheets.every((s) => s.width === last.width && s.height === last.height)
    ? ""
    : sheets
        .map(({ width, height, index }) => {
          const page = `foli-${name}-${index}`;
          return (
            `@page ${page}{size:${width} ${height};margin:0}` +
            `${pages}[${SHEET_ATTR}="${index}"]{page:${page};height:${height}!important}`
          );
        })
        .join("");
  return (
    `@media print{@page{size:${last.width} ${last.height};margin:0}` +
    `${pages}{height:${last.height}!important;margin-block:0!important;` +
    `break-after:page;break-inside:avoid}${pages}:last-child{break-after:auto}${named}}`
  );
}
