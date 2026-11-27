/**
 * The Word pages page (`/word.html`, dev server only): a .docx imported and laid out on pages
 * by `renderDocument` (read-only, 8.6b). Driven by `apps/playground/word/` to measure page
 * agreement with Word, and to compare the pages with Word's PDF (8.6c); see corpus/README.md.
 */

import { type FoliDocument, type NodeJSON, parseDocument } from "@folijs/core";
import { importDocx } from "@folijs/docx";
import { type DocumentPages, type ReviewView, renderDocument } from "@folijs/view";
import {
  type Agreement,
  agreement,
  bodyRegion,
  inkPixels,
  overlay,
  type Region,
  samePage,
} from "./ink.js";

const container = document.getElementById("pages") as HTMLElement;
let shown: DocumentPages | null = null;

/** A top-level node (or, `type` "cell", a paragraph in a table cell) as the harness compares it with Word. */
interface Shown {
  type: string;
  /** The page (0-based) it starts on; null when not shown. */
  page: number | null;
  /** The line on that page (1-based) it starts on. */
  line: number | null;
  /** A paragraph's text as Word's `Range.Text` gives it (tracked deletions left out). */
  text: string;
}

/** A paragraph's text: text, tabs and line breaks, without deleted text. */
function textOf(node: NodeJSON): string {
  return (node.content ?? [])
    .map((n) => {
      if ((n.marks ?? []).some((m) => m.type === "deletion")) return "";
      if (n.type === "text") return n.text ?? "";
      return n.type === "tab" ? "\t" : n.type === "hardBreak" ? "\n" : "";
    })
    .join("");
}

/** Renders a .docx on pages; returns each top-level node with the page it starts on. */
async function render(bytes: Uint8Array, review: ReviewView): Promise<Shown[]> {
  const { document: doc } = await importDocx(bytes);
  return show(doc, review);
}

/** Lays a v3 document out on pages (replacing the last one shown). */
function show(doc: FoliDocument, review: ReviewView): Shown[] {
  shown?.destroy();
  shown = renderDocument(doc, container, { review });
  const pages = shown;
  const blocks: Shown[] = (doc.content.content ?? []).map((node, i) => ({
    type: node.type,
    page: pages.pageOf(i) ?? null,
    line: pages.lineOf(i) ?? null,
    text: node.type === "paragraph" ? textOf(node) : "",
  }));
  // Then the paragraphs in table cells, in document order: their page only.
  const cells: Shown[] = pages
    .cellParagraphs()
    .map(({ page, text }) => ({ type: "cell", page, line: null, text }));
  return [...blocks, ...cells];
}

/**
 * One page compared with Word's: on the whole page, and inside the margins; null when the two
 * are not the same page size (another orientation or paper size), which scores 0.
 */
interface PageComparison {
  /** Word's page size and Foli's, in pixels. */
  sizes: [[number, number], [number, number]];
  page: Agreement | null;
  body: Agreement | null;
  /** The overlay (PNG data URL): black both, red Word only, blue Foli only. */
  overlay: string | null;
}

function pixels(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0);
  return inkPixels(context.getImageData(0, 0, width, height).data, width, height);
}

/** A PDF (base64) opened by pdf.js; `destroy` when done. */
async function openPdf(base64: string) {
  const [{ getDocument, GlobalWorkerOptions }, { default: worker }] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  GlobalWorkerOptions.workerSrc = worker;
  const loading = getDocument({ data: Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)) });
  return { pdf: await loading.promise, destroy: () => loading.destroy() };
}
type Pdf = Awaited<ReturnType<typeof openPdf>>["pdf"];

/** Page `n` (1-based) of a PDF rendered at 96 px per inch. */
async function pdfCanvas(pdf: Pdf, n: number): Promise<HTMLCanvasElement> {
  const pdfPage = await pdf.getPage(n);
  const viewport = pdfPage.getViewport({ scale: 96 / 72 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await pdfPage.render({ canvas, viewport }).promise;
  return canvas;
}

/**
 * Word's page (rendered) against Foli's (a screenshot, or its own PDF's page rendered): on the
 * whole page, and inside `margins` when given.
 */
function comparePage(
  word: HTMLCanvasElement,
  foli: HTMLCanvasElement | HTMLImageElement,
  margins: [number, number, number, number] | null,
): PageComparison {
  const foliSize: [number, number] =
    foli instanceof HTMLImageElement
      ? [foli.naturalWidth, foli.naturalHeight]
      : [foli.width, foli.height];
  const sizes: PageComparison["sizes"] = [[word.width, word.height], foliSize];
  if (!samePage(...sizes)) return { sizes, page: null, body: null, overlay: null };
  // The same page size within a pixel or two of rounding: compared on what both cover.
  const width = Math.min(word.width, foliSize[0]);
  const height = Math.min(word.height, foliSize[1]);
  const wordInk = pixels(word, width, height);
  const foliInk = pixels(foli, width, height);
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  (out.getContext("2d") as CanvasRenderingContext2D).putImageData(
    new ImageData(overlay(wordInk, foliInk), width, height),
    0,
    0,
  );
  return {
    sizes,
    page: agreement(wordInk, foliInk),
    body: margins
      ? agreement(wordInk, foliInk, undefined, bodyRegion(margins, width, height))
      : null,
    overlay: out.toDataURL("image/png"),
  };
}

/**
 * Regions of Foli's pages (PNG screenshots, CSS pixels) compared by ink with the same regions of
 * Word's PDF pages, rendered by pdf.js at 96 px per inch (Phase 34: each shape's box). A page
 * Word's PDF does not have scores null.
 */
async function compareRegions(
  pdf: string,
  pages: { png: string; regions: Region[] }[],
): Promise<(Agreement | null)[][]> {
  const { pdf: word, destroy } = await openPdf(pdf);
  const out: (Agreement | null)[][] = [];
  for (const [i, foliPage] of pages.entries()) {
    if (i >= word.numPages) {
      out.push(foliPage.regions.map(() => null));
      continue;
    }
    const image = new Image();
    image.src = `data:image/png;base64,${foliPage.png}`;
    await image.decode();
    const canvas = await pdfCanvas(word, i + 1);
    const width = Math.min(canvas.width, image.naturalWidth);
    const height = Math.min(canvas.height, image.naturalHeight);
    const wordInk = pixels(canvas, width, height);
    const foliInk = pixels(image, width, height);
    out.push(foliPage.regions.map((region) => agreement(wordInk, foliInk, undefined, region)));
  }
  await destroy();
  return out;
}

/**
 * Compares Foli's pages (PNG screenshots, CSS pixels, with each page's margins) with the pages
 * of Word's PDF, rendered by pdf.js at the same scale (96 px per inch). A page only one of them
 * has is not compared: the counts differ.
 */
async function comparePdf(
  pdf: string,
  pages: { png: string; margins: [number, number, number, number] }[],
): Promise<{ wordPages: number; compared: PageComparison[] }> {
  const { pdf: word, destroy } = await openPdf(pdf);
  const compared: PageComparison[] = [];
  for (let i = 0; i < Math.min(word.numPages, pages.length); i++) {
    // shortcut: every page is held at once, as data URLs (fine for the corpus's few pages).
    const foliPage = pages[i] as (typeof pages)[number];
    const image = new Image();
    image.src = `data:image/png;base64,${foliPage.png}`;
    await image.decode();
    compared.push(comparePage(await pdfCanvas(word, i + 1), image, foliPage.margins));
  }
  const wordPages = word.numPages;
  await destroy();
  return { wordPages, compared };
}

/**
 * Foli's PDF (`exportPdf`, 11.12) compared with Word's, page by page, both rendered by pdf.js at
 * 96 px per inch: on the whole page only.
 */
async function comparePdfs(
  wordPdf: string,
  foliPdf: string,
): Promise<{ wordPages: number; foliPages: number; compared: PageComparison[] }> {
  const [word, foli] = await Promise.all([openPdf(wordPdf), openPdf(foliPdf)]);
  const compared: PageComparison[] = [];
  for (let n = 1; n <= Math.min(word.pdf.numPages, foli.pdf.numPages); n++)
    compared.push(comparePage(await pdfCanvas(word.pdf, n), await pdfCanvas(foli.pdf, n), null));
  const result = { wordPages: word.pdf.numPages, foliPages: foli.pdf.numPages, compared };
  await Promise.all([word.destroy(), foli.destroy()]);
  return result;
}

/** What a PDF holds as a reader shows it: pages (points) and their text, the outline, links. */
interface PdfContents {
  pages: { width: number; height: number; text: string }[];
  outline: { title: string; depth: number }[];
  links: { page: number; url: string | null; internal: boolean }[];
}

async function readPdf(base64: string): Promise<PdfContents> {
  const { pdf, destroy } = await openPdf(base64);
  const contents: PdfContents = { pages: [], outline: [], links: [] };
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = page.view;
    const text = (await page.getTextContent()).items
      .map((item) => ("str" in item ? `${item.str}${item.hasEOL ? " " : ""}` : ""))
      .join("");
    contents.pages.push({ width: x1 - x0, height: y1 - y0, text });
    for (const annotation of await page.getAnnotations())
      if (annotation.subtype === "Link")
        contents.links.push({
          page: n,
          url: annotation.url ?? null,
          internal: !annotation.url && !!annotation.dest,
        });
  }
  type Item = { title: string; items: Item[] };
  const walk = (items: Item[] | null, depth: number): void => {
    for (const item of items ?? []) {
      contents.outline.push({ title: item.title, depth });
      walk(item.items, depth + 1);
    }
  };
  walk((await pdf.getOutline()) as Item[] | null, 0);
  await destroy();
  return contents;
}

declare global {
  interface Window {
    foliWord: {
      render(base64: string, review: ReviewView): Promise<Shown[]>;
      /** A v3 document as JSON (validated first). */
      show(json: unknown, review: ReviewView): Shown[];
      /** The pages shown, compared with Word's PDF (base64). */
      comparePdf: typeof comparePdf;
      /** Foli's PDF compared with Word's (both base64). */
      comparePdfs: typeof comparePdfs;
      /** Regions of the pages shown compared with Word's PDF (base64). */
      compareRegions: typeof compareRegions;
      /** A PDF's pages, text, outline and links (base64). */
      readPdf: typeof readPdf;
    };
  }
}
window.foliWord = {
  render: (base64, review) =>
    render(
      Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
      review,
    ),
  show: (json, review) => show(parseDocument(json), review),
  comparePdf,
  comparePdfs,
  compareRegions,
  readPdf,
};

const input = document.getElementById("file") as HTMLInputElement;
const final = document.getElementById("final") as HTMLInputElement;
const open = async () => {
  const file = input.files?.[0];
  if (file)
    await render(new Uint8Array(await file.arrayBuffer()), final.checked ? "final" : "markup");
};
input.addEventListener("change", open);
final.addEventListener("change", open);
