/**
 * The canonical form export is compared with (8.5): a part's XML as a tree in which exactly
 * what import does not keep (packages/docx/README.md, "Not kept exactly") is normalized away.
 * - Comments, processing instructions, and whitespace between elements are ignored; attribute
 *   order is irrelevant; `xml:space` is ignored.
 * - Spelling marks (`w:proofErr`), Word's rendered page breaks (`w:lastRenderedPageBreak`) and
 *   editing session ids on runs (`w:r@w:rsid*`) are dropped.
 * - A paragraph's content is a list of leaves, each a run's content item (text, break, …) or a
 *   marker, with the set of elements around it (hyperlinks, tracked changes) and its run's
 *   properties: so run boundaries, and the nesting order of hyperlinks and tracked changes, do
 *   not matter. Adjacent text with equal context is joined; `w:delText` is text; `w:cr` is a
 *   break; `w:noBreakHyphen` and `w:softHyphen` are their characters; `w:br
 *   w:type="textWrapping"` is a plain break; empty runs vanish.
 */

import { parseXml, type XmlElement, type XmlNode } from "../xml.js";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const DROPPED = new Set(["proofErr", "lastRenderedPageBreak"]);
const WRAPPERS = new Set(["hyperlink", "ins", "del", "moveFrom", "moveTo"]);

type Canon = string | { n: string; a: [string, string][]; c: Canon[] };

function attributes(el: XmlElement): [string, string][] {
  return el.attributes
    .filter((a) => !(a.ns === XML_NS && a.local === "space"))
    .filter((a) => !(el.ns === W && el.local === "r" && a.ns === W && a.local.startsWith("rsid")))
    .filter(
      (a) =>
        !(
          el.ns === W &&
          el.local === "br" &&
          a.ns === W &&
          a.local === "type" &&
          a.value === "textWrapping"
        ),
    )
    .map((a): [string, string] => [`{${a.ns}}${a.local}`, a.value])
    .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
}

function element(el: XmlElement): Canon {
  if (el.ns === W && el.local === "p") return paragraph(el);
  const children: Canon[] = [];
  for (const c of el.children) {
    if (c.kind === "element") {
      if (c.ns === W && DROPPED.has(c.local)) continue;
      children.push(element(c));
    } else if (c.kind === "text" && c.text.trim() !== "") {
      children.push(c.text);
    }
  }
  return { n: `{${el.ns}}${el.local}`, a: attributes(el), c: children };
}

/** A leaf of a paragraph: its context (wrappers and run properties) and one item. */
interface Leaf {
  context: string;
  item: Canon;
}

function paragraph(p: XmlElement): Canon {
  const leaves: Leaf[] = [];
  const walk = (nodes: readonly XmlNode[], wrappers: readonly string[]) => {
    for (const c of nodes) {
      if (c.kind !== "element") continue;
      if (c.ns === W && DROPPED.has(c.local)) continue;
      if (c.ns === W && WRAPPERS.has(c.local)) {
        walk(c.children, [...wrappers, JSON.stringify(element({ ...c, children: [] }))]);
      } else if (c.ns === W && c.local === "r") {
        const rPr = c.children.find(
          (x): x is XmlElement => x.kind === "element" && x.ns === W && x.local === "rPr",
        );
        const context = JSON.stringify([
          [...wrappers].sort(),
          rPr ? element(rPr) : null,
          attributes(c),
        ]);
        for (const x of c.children) {
          if (x.kind !== "element" || x === rPr || (x.ns === W && DROPPED.has(x.local))) continue;
          leaves.push({ context, item: runItem(x) });
        }
      } else {
        leaves.push({ context: JSON.stringify([[...wrappers].sort()]), item: element(c) });
      }
    }
  };
  walk(p.children, []);
  // Joined text: one run's text split in two, or two runs with equal context, is the same text.
  const out: Canon[] = [];
  let last: Leaf | undefined;
  for (const leaf of leaves) {
    if (
      last &&
      typeof leaf.item === "string" &&
      typeof last.item === "string" &&
      last.context === leaf.context
    ) {
      last.item += leaf.item;
      out[out.length - 1] = `${last.context}|${last.item}`;
      continue;
    }
    last = { ...leaf };
    out.push(
      typeof leaf.item === "string"
        ? `${leaf.context}|${leaf.item}`
        : { n: leaf.context, a: [], c: [leaf.item] },
    );
  }
  return { n: `{${W}}p`, a: attributes(p), c: out };
}

function runItem(x: XmlElement): Canon {
  if (x.ns === W) {
    if (x.local === "t" || x.local === "delText") {
      return x.children.map((c) => (c.kind === "text" ? c.text : "")).join("");
    }
    if (x.local === "noBreakHyphen") return "‑";
    if (x.local === "softHyphen") return "­";
    if (x.local === "tab") return "\t";
    if (x.local === "cr") return element({ ...x, local: "br", attributes: [] });
  }
  return element(x);
}

/** A part's canonical form, as a string to compare. */
export function canonical(source: string): string {
  return JSON.stringify(element(parseXml(source).root));
}
