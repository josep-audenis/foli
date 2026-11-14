/**
 * The Word pages page (`/word.html`, dev server only): a .docx imported and laid out on pages
 * by `renderDocumentV3` (read-only, 8.6b). Driven by `apps/playground/word/` to measure page
 * agreement with Word, and to compare the pages with Word's PDF (8.6c); see corpus/README.md.
 */

import { type FoliDocumentV3, type NodeJSON, parseDocumentV3 } from "@folijs/core";
import { importDocx } from "@folijs/docx";
import { type DocumentPages, type ReviewView, renderDocumentV3 } from "@folijs/view";
import { type Agreement, agreement, bodyRegion, inkPixels, overlay, samePage } from "./ink.js";

const container = document.getElementById("pages") as HTMLElement;
let shown: DocumentPages | null = null;

/** A top-level node as the harness compares it with Word. */
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
function show(doc: FoliDocumentV3, review: ReviewView): Shown[] {
  shown?.destroy();
  shown = renderDocumentV3(doc, container, { review });
  const pages = shown;
  return (doc.content.content ?? []).map((node, i) => ({
    type: node.type,
    page: pages.pageOf(i) ?? null,
    line: pages.lineOf(i) ?? null,
    text: node.type === "paragraph" ? textOf(node) : "",
  }));
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

/**
 * Compares Foli's pages (PNG screenshots, CSS pixels, with each page's margins) with the pages
 * of Word's PDF, rendered by pdf.js at the same scale (96 px per inch). A page only one of them
 * has is not compared: the counts differ.
 */
async function comparePdf(
  pdf: string,
  pages: { png: string; margins: [number, number, number, number] }[],
): Promise<{ wordPages: number; compared: PageComparison[] }> {
  const [{ getDocument, GlobalWorkerOptions }, { default: worker }] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  GlobalWorkerOptions.workerSrc = worker;
  const loading = getDocument({ data: Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0)) });
  const word = await loading.promise;
  const compared: PageComparison[] = [];
  for (let i = 0; i < Math.min(word.numPages, pages.length); i++) {
    // shortcut: every page is held at once, as data URLs (fine for the corpus's few pages).
    const foliPage = pages[i] as (typeof pages)[number];
    const image = new Image();
    image.src = `data:image/png;base64,${foliPage.png}`;
    await image.decode();
    const pdfPage = await word.getPage(i + 1);
    const viewport = pdfPage.getViewport({ scale: 96 / 72 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await pdfPage.render({ canvas, viewport }).promise;
    const sizes: PageComparison["sizes"] = [
      [canvas.width, canvas.height],
      [image.naturalWidth, image.naturalHeight],
    ];
    if (!samePage(...sizes)) {
      compared.push({ sizes, page: null, body: null, overlay: null });
      continue;
    }
    // The same page size within a pixel or two of rounding: compared on what both cover.
    const width = Math.min(canvas.width, image.naturalWidth);
    const height = Math.min(canvas.height, image.naturalHeight);
    const wordInk = pixels(canvas, width, height);
    const foliInk = pixels(image, width, height);
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    (out.getContext("2d") as CanvasRenderingContext2D).putImageData(
      new ImageData(overlay(wordInk, foliInk), width, height),
      0,
      0,
    );
    compared.push({
      sizes,
      page: agreement(wordInk, foliInk),
      body: agreement(wordInk, foliInk, undefined, bodyRegion(foliPage.margins, width, height)),
      overlay: out.toDataURL("image/png"),
    });
  }
  const wordPages = word.numPages;
  await loading.destroy();
  return { wordPages, compared };
}

declare global {
  interface Window {
    foliWord: {
      render(base64: string, review: ReviewView): Promise<Shown[]>;
      /** A v3 document as JSON (validated first). */
      show(json: unknown, review: ReviewView): Shown[];
      /** The pages shown, compared with Word's PDF (base64). */
      comparePdf: typeof comparePdf;
    };
  }
}
window.foliWord = {
  render: (base64, review) =>
    render(
      Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
      review,
    ),
  show: (json, review) => show(parseDocumentV3(json), review),
  comparePdf,
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
