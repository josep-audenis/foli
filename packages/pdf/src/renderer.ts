/**
 * The page's side of `exportPdf`, bundled into `dist/renderer.js` and added to the app's page:
 * `window.foliPdf.render` lays the document out with the read-only renderer, updates its fields
 * from those pages (and once more from the pages that gives, as the editor's update does), makes
 * links and bookmarks PDF links, and adds the print rules the editor uses.
 */
import {
  createEditor,
  type Extension,
  type Field,
  isSafeHref,
  parseDocument,
  updateFields,
} from "@folijs/core";
import { type DocumentPages, renderDocument } from "@folijs/view";
import type { Rendered, RenderInput } from "./index.js";

/** The fields whose results depend on where things fall on the pages. */
const PAGE_DEPENDENT = new Set(["PAGE", "NUMPAGES", "SECTIONPAGES", "PAGEREF"]);

/** `a` elements for links: a safe web link, or a bookmark on these pages (an internal link). */
function makeLinks(root: HTMLElement): void {
  const doc = root.ownerDocument;
  const targets = new Map<string, Element>();
  // The first of a bookmark's marks: a block split over pages repeats them in hidden copies.
  for (const mark of root.querySelectorAll("[data-foli-bookmark]")) {
    const name = mark.getAttribute("data-foli-bookmark") ?? "";
    if (name && !targets.has(name) && !mark.closest("[aria-hidden]")) targets.set(name, mark);
  }
  let ids = 0;
  for (const span of root.querySelectorAll<HTMLElement>("[data-href]")) {
    const href = span.dataset.href ?? "";
    let url: string | null = null;
    if (href.startsWith("#")) {
      const target = targets.get(href.slice(1));
      if (target) {
        target.id ||= `foli-bookmark-${ids++}`;
        url = `#${target.id}`;
      }
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(href) && isSafeHref(href)) {
      // Absolute only: a relative target has nothing to resolve against in a PDF.
      url = href;
    }
    if (!url) continue;
    const link = doc.createElement("a");
    link.href = url;
    // The run keeps its own look: no link color or underline of the browser's.
    link.style.color = "inherit";
    link.style.textDecoration = "none";
    span.replaceWith(link);
    link.append(span);
  }
}

/** How long the images may take to decode: one that has not by then prints without its image. */
const IMAGE_WAIT = 10_000;

/** Waits for the pages' images, at most `IMAGE_WAIT`; those still loading lose their source. */
export async function imagesLoaded(doc: Document): Promise<void> {
  const pending = [...doc.images].filter((image) => !image.complete);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(pending.map((image) => image.decode().catch(() => null))),
    new Promise((resolve) => {
      timer = setTimeout(resolve, IMAGE_WAIT);
    }),
  ]);
  clearTimeout(timer);
  for (const image of pending) if (!image.complete) image.removeAttribute("src");
}

async function render({ document: json, images, review, styles }: RenderInput): Promise<Rendered> {
  const doc = window.document;
  const style = doc.createElement("style");
  style.textContent = `html,body{margin:0;background:#fff}${styles}`;
  doc.head.append(style);
  // Fonts first: the layout measures text in them.
  await Promise.all([...doc.fonts].map((face) => face.load().catch(() => null)));
  const container = doc.body;
  // Never the resource's own URL: only what `exportPdf` made into `data:` URLs (null: a box).
  const resource = (key: string) => images[key] ?? null;
  // The app's extensions, set by its script before this one (`ExportPdfOptions.extensions`).
  const global = globalThis as { foliPdfExtensions?: unknown };
  const given = global.foliPdfExtensions;
  // Taken once: a page used again for another export keeps its globals across `setContent`.
  delete global.foliPdfExtensions;
  const extensions = Array.isArray(given) ? (given as Extension[]) : [];
  const show = (document: RenderInput["document"]): DocumentPages =>
    renderDocument(document, container, { review, resource, extensions });
  const document = parseDocument(json, { extensions });
  let pages = show(document);
  const editor = createEditor({ document, extensions });
  const report = updateFields(editor, { layout: pages.fieldLayout });
  if (report.updated) {
    pages.destroy();
    pages = show(editor.getDocument());
    // What the update moved (a table of contents grown) changes the pages' numbers once more.
    const again = updateFields(editor, {
      layout: pages.fieldLayout,
      only: (field: Field) => PAGE_DEPENDENT.has(field.name),
    });
    if (again.updated) {
      pages.destroy();
      pages = show(editor.getDocument());
    }
    report.updated += again.updated;
  }
  makeLinks(container);
  const print = doc.createElement("style");
  print.textContent = pages.printStyles();
  doc.head.append(print);
  await imagesLoaded(doc);
  await doc.fonts.ready;
  return { pages: pages.pages.length, fields: report };
}

(window as unknown as { foliPdf: { render: typeof render } }).foliPdf = { render };
