/**
 * Body content (`w:body`, a comment's paragraphs) to schema v3 nodes. What Foli does not model
 * yet becomes an opaque node holding the element's source verbatim, with a label to show (none
 * for markers that have nothing to show: field characters, range ends).
 */

import { type MarkJSON, type NodeJSON, schemaV3 } from "@folijs/core";
import type { DocxPackage, Relationship } from "../package.js";
import type { XmlElement, XmlNode } from "../xml.js";
import { attr, child, deepText, integer, isW, R, REL, textOf, W } from "./ooxml.js";
import {
  attributeBag,
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
  /** The tracked moves open at this point. */
  readonly moves: Moves;
  /** The part's relationship with this id (hyperlink targets). */
  readonly relationship: (id: string) => Relationship | undefined;
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

/**
 * Block content: paragraphs, and every other block element as an opaque block. `section` is the
 * body's last `w:sectPr` (the envelope's): any other one stays as an opaque block.
 */
export function blocks(
  nodes: readonly XmlNode[],
  context: ContentContext,
  section?: XmlElement,
): NodeJSON[] {
  const out: NodeJSON[] = [];
  for (const node of nodes) {
    if (node.kind !== "element" || node === section) continue;
    if (isW(node, "p")) out.push(paragraph(node, context));
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
  const bag = attributeBag(p, [], context);
  if (bag) setParagraph(attrs, "attributes", bag, p.name, context);
  const content: NodeJSON[] = [];
  inlines(p.children, [], context, content);
  return {
    type: "paragraph",
    ...(Object.keys(attrs).length ? { attrs } : {}),
    ...(content.length ? { content } : {}),
  };
}

/** `marks` with `m` added; undefined when `m` is missing or one of its type is already there. */
function withMark(marks: readonly MarkJSON[], m: MarkJSON | undefined): MarkJSON[] | undefined {
  if (!m || marks.some((other) => other.type === m.type)) return undefined;
  return [...marks, m];
}

const MARKER_TYPES: Record<string, string> = {
  bookmarkStart: "bookmarkStart",
  bookmarkEnd: "bookmarkEnd",
  commentRangeStart: "commentStart",
  commentRangeEnd: "commentEnd",
};

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
  /** Its children with `m` added, or the whole element opaque when `m` cannot be (a link in a link…). */
  const wrapped = (el: XmlElement, m: MarkJSON | undefined, labelValue: string | null) => {
    const inner = withMark(marks, m);
    if (inner) inlines(el.children, inner, context, out);
    else opaque(el, INLINE_LABELS, labelValue);
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
        wrapped(el, link(el, context), deepText(el) || "link");
        break;
      case "ins":
      case "del":
      case "moveFrom":
      case "moveTo": {
        const type = el.local === "ins" || el.local === "moveTo" ? "insertion" : "deletion";
        const move = el.local.startsWith("move")
          ? (context.moves.current(el.local === "moveTo" ? "to" : "from") ?? "move")
          : null;
        wrapped(el, revisionMark(type, el, move, context), deepText(el) || null);
        break;
      }
      case "bookmarkStart":
      case "bookmarkEnd":
      case "commentRangeStart":
      case "commentRangeEnd": {
        const type = MARKER_TYPES[el.local] as string;
        const isStart = type === "bookmarkStart";
        const bag = attributeBag(el, isStart ? ["w:id", "w:name"] : ["w:id"], context);
        const attrs: Record<string, unknown> = { id: integer(attr(el, "id")) };
        if (isStart) attrs.name = attr(el, "name") ?? "";
        if (bag) attrs.attributes = bag;
        const leaf = valid(node(type, attrs), el, context);
        if (leaf) out.push(leaf);
        else opaque(el, BLOCK_LABELS);
        break;
      }
      case "moveFromRangeStart":
      case "moveToRangeStart":
        context.moves.open(
          el.local.startsWith("moveFrom") ? "from" : "to",
          attr(el, "id") ?? "",
          attr(el, "name") ?? "move",
        );
        opaque(el);
        break;
      case "moveFromRangeEnd":
      case "moveToRangeEnd":
        context.moves.close(el.local.startsWith("moveFrom") ? "from" : "to", attr(el, "id") ?? "");
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
function valid(json: NodeJSON, el: XmlElement, context: Context): NodeJSON | undefined {
  try {
    schemaV3.nodeFromJSON(json);
    return json;
  } catch (error) {
    context.report.unmodeled(el.name, (error as Error).message);
    return undefined;
  }
}

/**
 * The tracked moves open at a point (`w:moveFromRangeStart` … `End`, by range id): the innermost
 * open one names the moved content. Amortized constant time per operation.
 */
export class Moves {
  readonly #stacks = {
    from: [] as { key: number; name: string }[],
    to: [] as { key: number; name: string }[],
  };
  readonly #byId = new Map<string, number>();
  readonly #open = new Set<number>();
  #next = 0;

  open(kind: "from" | "to", id: string, name: string): void {
    const key = this.#next++;
    this.#byId.set(`${kind}:${id}`, key);
    this.#open.add(key);
    this.#stacks[kind].push({ key, name });
  }

  close(kind: "from" | "to", id: string): void {
    const key = this.#byId.get(`${kind}:${id}`);
    if (key === undefined) return;
    this.#byId.delete(`${kind}:${id}`);
    this.#open.delete(key);
  }

  current(kind: "from" | "to"): string | undefined {
    const stack = this.#stacks[kind];
    // Closed ranges at the top are discarded once: each entry is popped at most once.
    while (stack.length && !this.#open.has((stack.at(-1) as { key: number }).key)) stack.pop();
    return stack.at(-1)?.name;
  }
}

/** `w:hyperlink` as a link mark: the target from its relationship, or a bookmark. */
function link(el: XmlElement, context: ContentContext): MarkJSON | undefined {
  const id = attr(el, "id", R);
  const relationship = id === undefined ? undefined : context.relationship(id);
  const href =
    relationship?.type === REL.hyperlink || relationship?.external
      ? relationship.target
      : undefined;
  const attrs = {
    href: href ?? null,
    anchor: attr(el, "anchor") ?? null,
    tooltip: attr(el, "tooltip") ?? null,
    attributes: attributeBag(el, ["w:anchor", "w:tooltip"], context) ?? null,
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
  const node = (
    type: string,
    marks: readonly MarkJSON[],
    attrs?: Record<string, unknown>,
    text?: string,
  ): NodeJSON => ({
    type,
    ...(attrs ? { attrs } : {}),
    ...(text === undefined ? {} : { text }),
    ...(marks.length ? { marks: [...marks] } : {}),
  });
  // Editing session ids are Word's to recompute; any other run attribute has no home: the run
  // stays whole, opaque.
  const isRsid = (a: XmlElement["attributes"][number]) => a.ns === W && a.local.startsWith("rsid");
  const unmodeled = r.attributes.find((a) => !isRsid(a));
  if (unmodeled) {
    context.report.opaque(`${r.name}@${unmodeled.name}`);
    out.push(
      node("opaqueInline", outer, withLabel({ xml: sourceOf(context, r) }, deepText(r) || null)),
    );
    return;
  }
  for (const a of r.attributes) context.report.dropped(`w:r@${a.name}`);
  const rPr = child(r, "rPr");
  let marks = [...outer];
  for (const m of runProperties(rPr, context)) {
    // A property the enclosing elements set (a hyperlink's style…): the run's own wins.
    marks = [...marks.filter((other) => other.type !== m.type), m];
  }
  if (rPr) marks.push({ type: "runExt", attrs: { xml: sourceOf(context, rPr) } });
  const before = out.length;
  const text = (value: string) => {
    if (value) out.push(node("text", marks, undefined, value));
  };
  for (const el of r.children) {
    if (el.kind !== "element" || el === rPr) continue;
    if (!isW(el)) {
      opaqueRun(el, el.local === "AlternateContent" ? "alternate content" : el.local);
      continue;
    }
    switch (el.local) {
      case "t":
      case "delText":
        text(textOf(el));
        break;
      case "tab":
        out.push(node("tab", marks));
        break;
      case "br": {
        const type = attr(el, "type");
        if (type === "page") out.push(node("pageBreak", marks));
        else if (type === "column") out.push(node("columnBreak", marks));
        else {
          const clear = attr(el, "clear");
          const leaf = valid(node("hardBreak", marks, clear ? { clear } : undefined), el, context);
          if (leaf) out.push(leaf);
          else opaqueRun(el);
        }
        break;
      }
      case "cr":
        out.push(node("hardBreak", marks));
        break;
      case "noBreakHyphen":
        text("‑");
        break;
      case "softHyphen":
        text("­");
        break;
      case "commentReference": {
        const bag = attributeBag(el, ["w:id"], context);
        const attrs: Record<string, unknown> = { id: integer(attr(el, "id")) };
        if (bag) attrs.attributes = bag;
        const leaf = valid(node("commentReference", marks, attrs), el, context);
        if (leaf) out.push(leaf);
        else opaqueRun(el);
        break;
      }
      default:
        if (DROPPED.has(el.local)) context.report.dropped(el.name);
        else opaqueRun(el);
    }
  }
  // A run with properties and nothing else shows nothing; Word drops those too.
  if (out.length === before) context.report.dropped("w:r (empty)");

  function opaqueRun(el: XmlElement, labelValue = label(INLINE_LABELS, el)): void {
    context.report.opaque(el.name);
    out.push(
      node("opaqueInline", marks, {
        ...withLabel({ xml: sourceOf(context, el) }, labelValue),
        run: true,
      }),
    );
  }
}
