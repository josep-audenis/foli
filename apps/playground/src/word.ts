/**
 * The Word pages page (`/word.html`, dev server only): a .docx imported and laid out on pages
 * by `renderDocumentV3` (read-only, 8.6b). Driven by `apps/playground/word/` to measure page
 * agreement with Word; see corpus/README.md.
 */

import { type FoliDocumentV3, type NodeJSON, parseDocumentV3 } from "@folijs/core";
import { importDocx } from "@folijs/docx";
import { type DocumentPages, type ReviewView, renderDocumentV3 } from "@folijs/view";

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

declare global {
  interface Window {
    foliWord: {
      render(base64: string, review: ReviewView): Promise<Shown[]>;
      /** A v3 document as JSON (validated first). */
      show(json: unknown, review: ReviewView): Shown[];
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
