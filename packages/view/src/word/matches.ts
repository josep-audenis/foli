/**
 * What find marks on the pages (11.11), through the CSS Custom Highlight API: ranges kept beside
 * the DOM, so nothing is added to the pages, the document or what the view reads back.
 * shortcut: a browser without the API marks nothing (the current match is still selected and
 * scrolled to on Next); draw boxes if one that matters lacks it.
 */
import { type FindOptions, findInText } from "@folijs/core";
import { PAGE_FIELD_ATTR } from "./regions.js";

const ALL = "foli-find";
const CURRENT = "foli-find-current";
const HINT = "foli-hint";
const FADING = "foli-hint-fading";

/** @internal */
export const MATCH_STYLES =
  `::highlight(${ALL}){background-color:#ffe17a}` +
  `::highlight(${CURRENT}){background-color:#f5a04a}` +
  `@media print{::highlight(${ALL}),::highlight(${CURRENT}){background-color:transparent}}` +
  `@media (forced-colors:active){::highlight(${ALL}){background-color:Mark;color:MarkText}` +
  `::highlight(${CURRENT}){background-color:Highlight;color:HighlightText}}` +
  // A hint: above find's marks; the second colour is its fading, a step before it goes.
  `::highlight(${HINT}){background-color:#9ccbff}::highlight(${FADING}){background-color:#d9ebff}` +
  `@media print{::highlight(${HINT}),::highlight(${FADING}){background-color:transparent}}` +
  `@media (forced-colors:active){::highlight(${HINT}),::highlight(${FADING}){background-color:Mark;color:MarkText}}`;

interface HighlightWindow {
  CSS?: { highlights?: Map<string, Set<Range> & { priority: number }> };
  Highlight?: new () => Set<Range> & { priority: number };
}

/** The document's highlight `name`, made once; null without the API. */
function highlight(doc: Document, name: string, priority: number) {
  const win = doc.defaultView as unknown as HighlightWindow | null;
  const registry = win?.CSS?.highlights;
  if (!registry || !win?.Highlight) return null;
  let found = registry.get(name);
  if (!found) {
    found = new win.Highlight();
    found.priority = priority;
    registry.set(name, found);
  }
  return found;
}

/**
 * One view's marks; views share the document's two highlights.
 * @internal
 */
export class MatchMarks {
  private all: Range[] = [];
  private current: Range[] = [];

  constructor(private readonly doc: Document) {}

  set(all: Range[], current: Range[]): void {
    const allMarks = highlight(this.doc, ALL, 0);
    const currentMarks = highlight(this.doc, CURRENT, 1);
    if (!allMarks || !currentMarks) return;
    for (const range of this.all) allMarks.delete(range);
    for (const range of this.current) currentMarks.delete(range);
    for (const range of all) allMarks.add(range);
    for (const range of current) currentMarks.add(range);
    this.all = all;
    this.current = current;
  }
}

/**
 * Where `query` is in drawn copies of a story (read-only, with their pages' numbers filled in):
 * looked for in each paragraph's text, as the text shown there has no positions.
 * @internal
 */
export function rangesInText(root: Element, query: string, options: FindOptions): Range[] {
  const doc = root.ownerDocument;
  const groups = new Map<Element, Text[]>();
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const block = node.parentElement?.closest("p,h1,h2,h3,h4,h5,h6");
    if (!block) continue;
    const list = groups.get(block);
    if (list) list.push(node as Text);
    else groups.set(block, [node as Text]);
  }
  const out: Range[] = [];
  for (const nodes of groups.values()) {
    // A page number drawn there is no text of the story: nothing runs across it.
    const text = nodes
      .map((node) =>
        node.parentElement?.closest(`[${PAGE_FIELD_ATTR}]`)
          ? "\uFFFC".repeat(node.length)
          : node.data,
      )
      .join("");
    for (const [from, to] of findInText(text, query, options)) {
      let at = 0;
      for (const node of nodes) {
        const start = Math.max(from - at, 0);
        const end = Math.min(to - at, node.length);
        if (start < end) {
          const range = doc.createRange();
          range.setStart(node, start);
          range.setEnd(node, end);
          out.push(range);
        }
        at += node.length;
      }
    }
  }
  return out;
}

/**
 * One view's hint (18.1): its ranges in the document's `foli-hint` highlight, or in
 * `foli-hint-fading` as it goes.
 * @internal
 */
export class HintMarks {
  private ranges: Range[] = [];
  private fading = false;

  constructor(private readonly doc: Document) {}

  set(ranges: Range[], fading = false): void {
    const shown = highlight(this.doc, HINT, 2);
    const fade = highlight(this.doc, FADING, 2);
    if (!shown || !fade) return;
    for (const range of this.ranges) (this.fading ? fade : shown).delete(range);
    for (const range of ranges) (fading ? fade : shown).add(range);
    this.ranges = ranges;
    this.fading = fading;
  }
}

/**
 * Ranges in a drawn copy of a story (a header on a page, a note's lines): each span names a
 * paragraph of the story by its index and characters of its text. The copy has no positions;
 * its paragraphs are the story's, in order, and their text is the story's text.
 * shortcut: a page number drawn there may differ in length from the story's own result;
 * marks after it in the same paragraph shift by the difference. Fine for a hint.
 * @internal
 */
export function rangesInCopy(
  root: Element,
  spans: readonly { block: number; from: number; to: number }[],
): Range[] {
  const doc = root.ownerDocument;
  const blocks = root.querySelectorAll("p,h1,h2,h3,h4,h5,h6");
  const out: Range[] = [];
  for (const { block, from, to } of spans) {
    const element = blocks[block];
    if (!element) continue;
    const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let at = 0;
    for (
      let node = walker.nextNode() as Text | null;
      node;
      node = walker.nextNode() as Text | null
    ) {
      // A list's number and a note's are drawn, and are no text of the story.
      if (node.parentElement?.closest("[data-foli-marker],[data-foli-note-number]")) continue;
      const start = Math.max(from - at, 0);
      const end = Math.min(to - at, node.length);
      if (start < end) {
        const range = doc.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        out.push(range);
      }
      at += node.length;
      if (at >= to) break;
    }
  }
  return out;
}
