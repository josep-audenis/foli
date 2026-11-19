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

/** @internal */
export const MATCH_STYLES =
  `::highlight(${ALL}){background-color:#ffe17a}` +
  `::highlight(${CURRENT}){background-color:#f5a04a}` +
  `@media print{::highlight(${ALL}),::highlight(${CURRENT}){background-color:transparent}}` +
  `@media (forced-colors:active){::highlight(${ALL}){background-color:Mark;color:MarkText}` +
  `::highlight(${CURRENT}){background-color:Highlight;color:HighlightText}}`;

interface HighlightWindow {
  CSS?: { highlights?: Map<string, Set<Range> & { priority: number }> };
  Highlight?: new () => Set<Range> & { priority: number };
}

/**
 * One view's marks; views share the document's two highlights.
 * @internal
 */
export class MatchMarks {
  private all: Range[] = [];
  private current: Range[] = [];

  constructor(private readonly doc: Document) {}

  private highlight(name: string, priority: number) {
    const win = this.doc.defaultView as unknown as HighlightWindow | null;
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

  set(all: Range[], current: Range[]): void {
    const allMarks = this.highlight(ALL, 0);
    const currentMarks = this.highlight(CURRENT, 1);
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
