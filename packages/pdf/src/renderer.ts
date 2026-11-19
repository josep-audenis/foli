/**
 * The page's side of `exportPdf`, bundled into `dist/renderer.js` and added to the app's page:
 * `window.foliPdf.render` lays the document out with the read-only renderer, updates its fields
 * from those pages (and once more from the pages that gives, as the editor's update does), makes
 * links and bookmarks PDF links, and adds the print rules the editor uses.
 */
import { createEditor, type Field, isSafeHref, parseDocument, updateFields } from "@folijs/core";
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
    } else if (isSafeHref(href)) url = href;
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

async function render({ document: json, images, review, styles }: RenderInput): Promise<Rendered> {
  const doc = window.document;
  const style = doc.createElement("style");
  style.textContent = `html,body{margin:0;background:#fff}${styles}`;
  doc.head.append(style);
  // Fonts first: the layout measures text in them.
  await Promise.all([...doc.fonts].map((face) => face.load().catch(() => null)));
  const container = doc.body;
  const resource = (key: string) => images[key];
  const show = (document: RenderInput["document"]): DocumentPages =>
    renderDocument(document, container, { review, resource });
  const document = parseDocument(json);
  let pages = show(document);
  const editor = createEditor({ document });
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
  await Promise.all(
    [...doc.images].map((image) => (image.complete ? null : image.decode().catch(() => null))),
  );
  await doc.fonts.ready;
  return { pages: pages.pages.length, fields: report };
}

(window as unknown as { foliPdf: { render: typeof render } }).foliPdf = { render };
