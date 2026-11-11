/**
 * Body content (`w:body`, a comment's paragraphs) to schema v3 nodes. What Foli does not model
 * yet becomes an opaque node holding the element's source verbatim, with a label to show (none
 * for markers that have nothing to show: field characters, range ends).
 */

import { type MarkJSON, type NodeJSON, schemaV3 } from "@folijs/core";
import type { DocxPackage } from "../package.js";
import type { XmlElement, XmlNode } from "../xml.js";
import { attr, child, deepText, integer, isW, R, REL, textOf, W } from "./ooxml.js";
import {
  type Context,
  mark,
  paragraphProperties,
  revisionMark,
  runProperties,
  setParagraph,
  sourceOf,
} from "./properties.js";

export interface ContentContext extends Context {
  readonly pkg: DocxPackage;
  /** The part the content is in: relationship ids (hyperlinks) resolve against it. */
  readonly part: string;
  /** Names of the tracked moves open at this point (`w:moveFromRangeStart` … `End`), by range id. */
  readonly moves: Map<string, string>;
}

/** Labels of the opaque elements that show something; anything else unknown shows its name. */
const BLOCK_LABELS: Record<string, string | null> = {
  tbl: "table",
  sdt: "content control",
  altChunk: "embedded document",
  customXml: "custom XML",
  bookmarkStart: null,
  bookmarkEnd: null,
  commentRangeStart: null,
  commentRangeEnd: null,
  moveFromRangeStart: null,
  moveFromRangeEnd: null,
  moveToRangeStart: null,
  moveToRangeEnd: null,
  permStart: null,
  permEnd: null,
};

const INLINE_LABELS: Record<string, string | null> = {
  drawing: "picture",
  pict: "picture",
  object: "object",
  sym: "symbol",
  footnoteReference: "footnote",
  endnoteReference: "endnote",
  sdt: "content control",
  oMath: "equation",
  oMathPara: "equation",
  ptab: "tab",
  // Nothing to show: a field's structure, markers, a comment's own reference mark.
  fldChar: null,
  instrText: null,
  annotationRef: null,
  separator: null,
  continuationSeparator: null,
  footnoteRef: null,
  endnoteRef: null,
  permStart: null,
  permEnd: null,
  moveFromRangeStart: null,
  moveFromRangeEnd: null,
  moveToRangeStart: null,
  moveToRangeEnd: null,
  customXmlInsRangeStart: null,
  customXmlInsRangeEnd: null,
  customXmlDelRangeStart: null,
  customXmlDelRangeEnd: null,
};

/** Recomputed by Word, never kept: spelling marks, the last rendered page breaks. */
const DROPPED = new Set(["proofErr", "lastRenderedPageBreak"]);

function label(table: Record<string, string | null>, element: XmlElement): string | null {
  return Object.hasOwn(table, element.local)
    ? (table[element.local] as string | null)
    : element.local;
}

/** Block content: paragraphs, and every other block element as an opaque block. */
export function blocks(nodes: readonly XmlNode[], context: ContentContext): NodeJSON[] {
  const out: NodeJSON[] = [];
  for (const node of nodes) {
    if (node.kind !== "element") continue;
    if (isW(node, "p")) out.push(paragraph(node, context));
    else if (isW(node, "sectPr"))
      continue; // the body's last section: the envelope's
    else if (node.ns === W && DROPPED.has(node.local)) context.report.dropped(node.name);
    else {
      context.report.opaque(node.name);
      out.push({
        type: "opaqueBlock",
        attrs: withLabel({ xml: sourceOf(context, node) }, label(BLOCK_LABELS, node)),
      });
    }
  }
  return out;
}

function withLabel(attrs: Record<string, unknown>, value: string | null): Record<string, unknown> {
  return value === null ? attrs : { ...attrs, label: value.slice(0, 255) || null };
}

export function paragraph(p: XmlElement, context: ContentContext): NodeJSON {
  const attrs: Record<string, unknown> = paragraphProperties(child(p, "pPr"), context, true);
  if (p.attributes.length) {
    const bag = Object.fromEntries(p.attributes.map((a) => [a.name, a.value]));
    setParagraph(attrs, "attributes", bag, p.name, context);
  }
  const content: NodeJSON[] = [];
  inlines(p.children, [], context, content);
  return {
    type: "paragraph",
    ...(Object.keys(attrs).length ? { attrs } : {}),
    ...(content.length ? { content } : {}),
  };
}

/** Adds `m` to `marks`, replacing a mark of the same type (the inner element wins). */
function withMark(marks: readonly MarkJSON[], m: MarkJSON | undefined): MarkJSON[] {
  return m ? [...marks.filter((other) => other.type !== m.type), m] : [...marks];
}

/** A paragraph's (or hyperlink's, or tracked change's) inline children, appended to `out`. */
function inlines(
  nodes: readonly XmlNode[],
  marks: readonly MarkJSON[],
  context: ContentContext,
  out: NodeJSON[],
): void {
  const node = (type: string, attrs?: Record<string, unknown>): NodeJSON => ({
    type,
    ...(attrs ? { attrs } : {}),
    ...(marks.length ? { marks: [...marks] } : {}),
  });
  const opaque = (
    element: XmlElement,
    table = INLINE_LABELS,
    labelValue = label(table, element),
  ) => {
    context.report.opaque(element.name);
    out.push(node("opaqueInline", withLabel({ xml: sourceOf(context, element) }, labelValue)));
  };
  for (const el of nodes) {
    if (el.kind !== "element") continue;
    if (!isW(el)) {
      opaque(el, INLINE_LABELS, el.local === "AlternateContent" ? "alternate content" : el.local);
      continue;
    }
    switch (el.local) {
      case "pPr":
        break;
      case "r":
        run(el, marks, context, out);
        break;
      case "hyperlink":
        inlines(el.children, withMark(marks, link(el, context)), context, out);
        break;
      case "ins":
      case "del":
      case "moveFrom":
      case "moveTo": {
        const type = el.local === "ins" || el.local === "moveTo" ? "insertion" : "deletion";
        const move = el.local.startsWith("move")
          ? (currentMove(context, el.local === "moveTo" ? "to" : "from") ?? "move")
          : null;
        inlines(el.children, withMark(marks, revisionMark(type, el, move, context)), context, out);
        break;
      }
      case "bookmarkStart":
      case "bookmarkEnd":
      case "commentRangeStart":
      case "commentRangeEnd": {
        const id = integer(attr(el, "id"));
        const type = {
          bookmarkStart: "bookmarkStart",
          bookmarkEnd: "bookmarkEnd",
          commentRangeStart: "commentStart",
          commentRangeEnd: "commentEnd",
        }[el.local] as string;
        const name = attr(el, "name") ?? "";
        // Word's column bookmarks (`w:colFirst`) and invalid ids: kept verbatim.
        const leaf =
          id === undefined || attr(el, "colFirst") !== undefined
            ? undefined
            : valid(node(type, type === "bookmarkStart" ? { id, name } : { id }), el, context);
        if (leaf) out.push(leaf);
        else opaque(el, BLOCK_LABELS);
        break;
      }
      case "moveFromRangeStart":
      case "moveToRangeStart":
        context.moves.set(
          `${el.local.startsWith("moveFrom") ? "from" : "to"}:${attr(el, "id")}`,
          attr(el, "name") ?? "move",
        );
        opaque(el);
        break;
      case "moveFromRangeEnd":
      case "moveToRangeEnd":
        context.moves.delete(
          `${el.local.startsWith("moveFrom") ? "from" : "to"}:${attr(el, "id")}`,
        );
        opaque(el);
        break;
      case "fldSimple":
        opaque(el, INLINE_LABELS, deepText(el) || attr(el, "instr")?.trim() || "field");
        break;
      default:
        if (DROPPED.has(el.local)) context.report.dropped(el.name);
        else opaque(el);
    }
  }
}

/** The node if the schema accepts it (its marks were checked already); reported otherwise. */
function valid(json: NodeJSON, el: XmlElement, context: ContentContext): NodeJSON | undefined {
  try {
    schemaV3.nodeFromJSON(json);
    return json;
  } catch (error) {
    context.report.unmodeled(el.name, (error as Error).message);
    return undefined;
  }
}

function currentMove(context: ContentContext, kind: "from" | "to"): string | undefined {
  let name: string | undefined;
  for (const [key, value] of context.moves) if (key.startsWith(`${kind}:`)) name = value;
  return name;
}

/** `w:hyperlink` as a link mark: the target from its relationship, or a bookmark. */
function link(el: XmlElement, context: ContentContext): MarkJSON | undefined {
  const id = attr(el, "id", R);
  const relationship =
    id === undefined ? undefined : context.pkg.relationships(context.part).find((r) => r.id === id);
  const href =
    relationship?.type === REL.hyperlink || relationship?.external
      ? relationship.target
      : undefined;
  const others = el.attributes.filter(
    (a) => !(a.ns === W && (a.local === "anchor" || a.local === "tooltip")),
  );
  const attrs = {
    href: href && href.length <= 8192 ? href : null,
    anchor: attr(el, "anchor") ?? null,
    tooltip: attr(el, "tooltip")?.slice(0, 1024) ?? null,
    attributes: others.length
      ? Object.fromEntries(others.slice(0, 64).map((a) => [a.name, a.value]))
      : null,
  };
  return mark({ type: "link", attrs }, el.name, context);
}

/** A run's content, each piece carrying the run's marks (its properties, verbatim in `runExt`). */
function run(
  r: XmlElement,
  outer: readonly MarkJSON[],
  context: ContentContext,
  out: NodeJSON[],
): void {
  for (const a of r.attributes) context.report.dropped(`w:r@${a.name}`);
  const rPr = child(r, "rPr");
  let marks = [...outer];
  for (const m of runProperties(rPr, context)) marks = withMark(marks, m);
  if (rPr) marks = withMark(marks, { type: "runExt", attrs: { xml: sourceOf(context, rPr) } });
  const node = (type: string, attrs?: Record<string, unknown>, text?: string): NodeJSON => ({
    type,
    ...(attrs ? { attrs } : {}),
    ...(text === undefined ? {} : { text }),
    ...(marks.length ? { marks } : {}),
  });
  const text = (value: string) => {
    if (value) out.push(node("text", undefined, value));
  };
  for (const el of r.children) {
    if (el.kind !== "element" || el === rPr) continue;
    if (!isW(el)) {
      context.report.opaque(el.name);
      out.push(
        node(
          "opaqueInline",
          withLabel(
            { xml: sourceOf(context, el) },
            el.local === "AlternateContent" ? "alternate content" : el.local,
          ),
        ),
      );
      continue;
    }
    switch (el.local) {
      case "t":
      case "delText":
        text(textOf(el));
        break;
      case "tab":
        out.push(node("tab"));
        break;
      case "br": {
        const type = attr(el, "type");
        if (type === "page") out.push(node("pageBreak"));
        else if (type === "column") out.push(node("columnBreak"));
        else {
          const clear = attr(el, "clear");
          const leaf = valid(
            node("hardBreak", clear && clear !== "none" ? { clear } : undefined),
            el,
            context,
          );
          if (leaf) out.push(leaf);
          else opaqueRun(el);
        }
        break;
      }
      case "cr":
        out.push(node("hardBreak"));
        break;
      case "noBreakHyphen":
        text("‑");
        break;
      case "softHyphen":
        text("­");
        break;
      case "commentReference": {
        const leaf = valid(node("commentReference", { id: integer(attr(el, "id")) }), el, context);
        if (leaf) out.push(leaf);
        else opaqueRun(el);
        break;
      }
      default:
        if (DROPPED.has(el.local)) context.report.dropped(el.name);
        else opaqueRun(el);
    }
  }

  function opaqueRun(el: XmlElement): void {
    context.report.opaque(el.name);
    const labelValue = label(INLINE_LABELS, el);
    out.push(node("opaqueInline", withLabel({ xml: sourceOf(context, el) }, labelValue)));
  }
}
