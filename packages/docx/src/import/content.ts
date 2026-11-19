/**
 * Body content (`w:body`, a comment's paragraphs) to schema v3 nodes. What Foli does not model
 * yet becomes an opaque node holding the element's source verbatim, with a label to show (none
 * for markers that have nothing to show: field characters, range ends).
 */

import type { ControlJSON, MarkJSON, NodeJSON, ResourceJSON } from "@folijs/core";
import { schema } from "@folijs/core/internal";
import type { DocxPackage, Relationship } from "../package.js";
import type { XmlElement, XmlNode } from "../xml.js";
import { controlProperties } from "./controls.js";
import { attr, child, deepText, elements, integer, isW, R, REL, textOf, W } from "./ooxml.js";
import { pictureAttrs } from "./pictures.js";
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
import { cellProperties, grid, rowProperties, tableProperties } from "./tables.js";

/** @internal */
export interface ContentContext extends Context {
  readonly pkg: DocxPackage;
  /** The part the content is in: relationship ids (hyperlinks) resolve against it. */
  readonly part: string;
  /** The tracked moves open at this point. */
  readonly moves: Moves;
  /** The part's relationship with this id (hyperlink targets). */
  readonly relationship: (id: string) => Relationship | undefined;
  /** How many tables the content is in. */
  readonly tableDepth?: number;
  /** The envelope's resources (pictures' images), filled as content is read. */
  readonly resources: Map<string, ResourceJSON>;
  /** The envelope's content controls, filled as content is read. */
  readonly controls: Map<string, ControlJSON>;
  /** Numbers the part's controls: their ids are `<part>#<n>`, the same on every reading. */
  readonly ordinals: { next: number };
  /**
   * The kind of story being read (ADR-0007), or a comment: what one may not hold stays verbatim.
   */
  readonly story?: "header" | "footer" | "footnote" | "endnote" | "comment";
}

/** Tables nested deeper stay opaque: within the model's depth (three levels per table). */
const MAX_TABLE_DEPTH = 64;

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

/** What a separator note holds: kept in its run, with nothing to report or edit. */
const NOTE_SEPARATORS = new Set(["separator", "continuationSeparator", "continuationNotice"]);

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
 * @internal
 */
export function blocks(
  nodes: readonly XmlNode[],
  context: ContentContext,
  section?: XmlElement,
): NodeJSON[] {
  const out: NodeJSON[] = [];
  const tables = new Map<NodeJSON, XmlElement>();
  for (const node of nodes) {
    if (node.kind !== "element" || node === section) continue;
    if (isW(node, "p")) out.push(paragraph(node, context));
    else if (isW(node, "sdt"))
      out.push(...(blockControl(node, context) ?? [opaqueOf(node, context)]));
    else if (isW(node, "tbl")) {
      // A table right after a table is one table to Word (it merges them): kept verbatim.
      const table = out.at(-1)?.type === "table" ? undefined : tableOf(node, context);
      if (table) tables.set(table, node);
      out.push(table ?? opaqueOf(node, context));
    } else if (node.ns === W && DROPPED.has(node.local)) context.report.dropped(node.name);
    else out.push(opaqueOf(node, context));
  }
  // Content does not end with a table (Word always puts a paragraph after one).
  const last = out.at(-1);
  const source = last && tables.get(last);
  if (source) out[out.length - 1] = opaqueOf(source, context);
  return out;
}

/** A control's properties taken into the envelope, its id and its content element. */
function controlOf(
  sdt: XmlElement,
  context: ContentContext,
): { id: string; content: XmlElement } | undefined {
  const content = child(sdt, "sdtContent");
  if (!content || sdt.attributes.length) return undefined;
  const children = elements(sdt);
  const once = (local: string) => children.filter((c) => isW(c, local)).length <= 1;
  const known = new Set(["sdtPr", "sdtEndPr", "sdtContent"]);
  if (children.some((c) => !isW(c) || !known.has(c.local))) return undefined;
  if (![...known].every(once)) return undefined;
  const control = controlProperties(sdt, context);
  if (!control) return undefined;
  const id = `${context.part}#${context.ordinals.next++}`;
  context.controls.set(id, control);
  return { id, content };
}

/** How many controls the model lets a block, row or cell be in. */
const MAX_CONTROLS = 64;
const roomForControl = (node: NodeJSON) =>
  ((node.attrs?.controls as string[] | undefined)?.length ?? 0) < MAX_CONTROLS;

/** `node` inside control `id`, outermost first. */
function inControl(node: NodeJSON, id: string): NodeJSON {
  const controls = [id, ...((node.attrs?.controls as string[] | undefined) ?? [])];
  return { ...node, attrs: { ...node.attrs, controls } };
}

/** A block-level control's blocks, each listing it; undefined keeps it verbatim (one that is empty). */
function blockControl(sdt: XmlElement, context: ContentContext): NodeJSON[] | undefined {
  const control = controlOf(sdt, context);
  if (!control) return undefined;
  const inner = blocks(control.content.children, context);
  if (!inner.length || !inner.every(roomForControl)) return undefined;
  return inner.map((block) => inControl(block, control.id));
}

/**
 * The rows (or cells) among `nodes`, those in row-level (cell-level) controls listing them;
 * undefined when anything else is there, which keeps the table verbatim.
 */
function controlled(
  nodes: readonly XmlNode[],
  local: "tr" | "tc",
  read: (el: XmlElement) => NodeJSON | undefined,
  context: ContentContext,
): NodeJSON[] | undefined {
  const out: NodeJSON[] = [];
  for (const node of nodes) {
    if (node.kind !== "element") continue;
    if (isW(node, local)) {
      const item = read(node);
      if (!item) return undefined;
      out.push(item);
    } else if (isW(node, "sdt")) {
      const control = controlOf(node, context);
      const inner = control && controlled(control.content.children, local, read, context);
      if (!control || !inner?.length || !inner.every(roomForControl)) return undefined;
      out.push(...inner.map((item) => inControl(item, control.id)));
    } else return undefined;
  }
  return out;
}

function opaqueOf(node: XmlElement, context: ContentContext): NodeJSON {
  context.report.opaque(node.name);
  return {
    type: "opaqueBlock",
    attrs: withLabel({ xml: sourceOf(context, node) }, label(BLOCK_LABELS, node)),
  };
}

/**
 * `w:tbl` as a table; undefined when the model cannot hold it as it is (rows or cells inside a
 * content control or custom XML, markers between rows, elements out of Word's order, a cell
 * not ending with a paragraph, tables nested too deep): the caller keeps it verbatim.
 */
function tableOf(tbl: XmlElement, context: ContentContext): NodeJSON | undefined {
  const tableDepth = (context.tableDepth ?? 0) + 1;
  if (tableDepth > MAX_TABLE_DEPTH || tbl.attributes.length) return undefined;
  const inner: ContentContext = { ...context, tableDepth };
  let tblPr: XmlElement | undefined;
  let tblGrid: XmlElement | undefined;
  const rows: NodeJSON[] = [];
  let stage = 0; // 0: w:tblPr may come, 1: w:tblGrid may come, 2: rows
  for (const c of tbl.children) {
    if (c.kind !== "element") continue;
    if (stage === 0 && isW(c, "tblPr")) {
      tblPr = c;
      stage = 1;
    } else if (stage <= 1 && isW(c, "tblGrid")) {
      tblGrid = c;
      stage = 2;
    } else if (isW(c, "tr") || isW(c, "sdt")) {
      stage = 2;
      const read = controlled([c], "tr", (tr) => rowOf(tr, inner), inner);
      if (!read) return undefined;
      rows.push(...read);
    } else return undefined;
  }
  if (!rows.length) return undefined;
  return {
    type: "table",
    attrs: {
      ...tableProperties(tblPr, context, true),
      grid: grid(tblGrid, context),
      ...(tblGrid ? { gridExt: sourceOf(context, tblGrid) } : {}),
    },
    content: rows,
  };
}

const ROW_ATTRS = schema.nodes.tableRow?.spec.attrs ?? {};

function rowOf(tr: XmlElement, context: ContentContext): NodeJSON | undefined {
  let tblPrEx: XmlElement | undefined;
  let trPr: XmlElement | undefined;
  const cells: NodeJSON[] = [];
  let stage = 0; // 0: w:tblPrEx, 1: w:trPr, 2: cells
  for (const c of tr.children) {
    if (c.kind !== "element") continue;
    if (stage === 0 && isW(c, "tblPrEx")) {
      tblPrEx = c;
      stage = 1;
    } else if (stage <= 1 && isW(c, "trPr")) {
      trPr = c;
      stage = 2;
    } else if (isW(c, "tc") || isW(c, "sdt")) {
      stage = 2;
      const read = controlled([c], "tc", (tc) => cellOf(tc, context), context);
      if (!read) return undefined;
      cells.push(...read);
    } else return undefined;
  }
  if (!cells.length) return undefined;
  const attrs: Record<string, unknown> = rowProperties(trPr, context, true);
  if (tblPrEx) {
    const exceptions = tableProperties(tblPrEx, context, true);
    // Not a row's to override (CT_TblPrEx): left in the element, not modeled.
    for (const key of ["style", "rowBandSize", "columnBandSize"]) {
      if (key in exceptions) {
        context.report.unmodeled(tblPrEx.name, `${key} is not an exception (kept in the element)`);
        delete exceptions[key];
      }
    }
    const error = ROW_ATTRS.exceptions?.validate?.(exceptions);
    // Its values are checked one by one: only a too-large element can fail here.
    if (error) return undefined;
    attrs.exceptions = exceptions;
  }
  const bag = attributeBag(tr, [], context);
  if (bag) attrs.attributes = bag;
  return { type: "tableRow", ...(Object.keys(attrs).length ? { attrs } : {}), content: cells };
}

function cellOf(tc: XmlElement, context: ContentContext): NodeJSON | undefined {
  if (tc.attributes.length) return undefined;
  const first = tc.children.find((c): c is XmlElement => c.kind === "element");
  const tcPr = first && isW(first, "tcPr") ? first : undefined;
  const content = blocks(
    tc.children.filter((c) => c !== tcPr),
    context,
  );
  if (content.at(-1)?.type !== "paragraph" || !content.every(allowedInCell)) return undefined;
  const attrs = cellProperties(tcPr, context, true);
  return { type: "tableCell", ...(Object.keys(attrs).length ? { attrs } : {}), content };
}

/**
 * Whether a cell's block is one the model allows there: not a paragraph that ends a section or
 * holds a page or column break. A table with one stays verbatim (lossless) instead.
 */
function allowedInCell(block: NodeJSON): boolean {
  if (block.type !== "paragraph") return true;
  if (block.attrs?.section) return false;
  return !block.content?.some((n) => n.type === "pageBreak" || n.type === "columnBreak");
}

function withLabel(attrs: Record<string, unknown>, value: string | null): Record<string, unknown> {
  return value === null ? attrs : { ...attrs, label: value.slice(0, 255) || null };
}

/** @internal */
export function paragraph(p: XmlElement, context: ContentContext): NodeJSON {
  // A story ends no section: such a paragraph stays as it is.
  const pPr = child(p, "pPr");
  if (context.story && pPr && child(pPr, "sectPr")) return opaqueOf(p, context);
  const attrs: Record<string, unknown> = paragraphProperties(pPr, context, true);
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
        // Stories hold no comments (ADR-0007): such an anchor stays verbatim.
        if (type.startsWith("comment") && context.story && context.story !== "comment") {
          opaque(el, BLOCK_LABELS);
          break;
        }
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
      case "fldSimple": {
        const instruction = attr(el, "instr");
        const start = node("fieldStart", {
          simple: true,
          // The start tag, as an element holding the result has it.
          ext: context.source.slice(el.start, el.openEnd).replace(/\/>$/, ">"),
        });
        const code = node("fieldCode", { text: instruction ?? "" });
        const leaves = valid(start, el, context) && valid(code, el, context);
        if (instruction === undefined || !leaves) {
          opaque(el, INLINE_LABELS, deepText(el) || "field");
          break;
        }
        out.push(start, code, node("fieldSeparator"));
        inlines(el.children, marks, context, out);
        out.push(node("fieldEnd"));
        break;
      }
      case "sdt": {
        const blocksInside = (c: XmlElement) =>
          elements(c).some((e) => isW(e, "p") || isW(e, "tbl"));
        const control = controlOf(el, context);
        if (!control || blocksInside(control.content)) {
          opaque(el);
          break;
        }
        out.push(node("controlStart", { id: control.id }));
        inlines(control.content.children, marks, context, out);
        out.push(node("controlEnd", { id: control.id }));
        break;
      }
      default:
        if (DROPPED.has(el.local)) context.report.dropped(el.name);
        else opaque(el);
    }
  }
}

/** The node if the schema accepts it (its marks were checked already); reported otherwise. */
function valid(json: NodeJSON, el: XmlElement, context: Context): NodeJSON | undefined {
  try {
    schema.nodeFromJSON(json);
    return json;
  } catch (error) {
    context.report.unmodeled(el.name, (error as Error).message);
    return undefined;
  }
}

/**
 * The tracked moves open at a point (`w:moveFromRangeStart` … `End`, by range id): the innermost
 * open one names the moved content. Amortized constant time per operation.
 * @internal
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
        text(spaced(el));
        break;
      case "tab":
        out.push(node("tab", marks));
        break;
      case "br": {
        const type = attr(el, "type");
        const inNote = context.story === "footnote" || context.story === "endnote";
        if ((type === "page" || type === "column") && inNote) opaqueRun(el);
        else if (type === "page") out.push(node("pageBreak", marks));
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
      case "drawing": {
        const image: [string?, ResourceJSON?] = [];
        const attrs = pictureAttrs(
          el,
          { ...context, partOf: (name) => context.pkg.part(name) },
          image,
        );
        const leaf = attrs && valid(node("picture", marks, attrs), el, context);
        if (!leaf) {
          opaqueRun(el);
          break;
        }
        out.push(leaf);
        const [key, entry] = image;
        if (key && entry && !context.resources.has(key)) context.resources.set(key, entry);
        if (!attrs.alt && !attrs.decorative) context.report.withoutAlt();
        break;
      }
      case "commentReference": {
        if (context.story && context.story !== "comment") {
          opaqueRun(el);
          break;
        }
        const bag = attributeBag(el, ["w:id"], context);
        const attrs: Record<string, unknown> = { id: integer(attr(el, "id")) };
        if (bag) attrs.attributes = bag;
        const leaf = valid(node("commentReference", marks, attrs), el, context);
        if (leaf) out.push(leaf);
        else opaqueRun(el);
        break;
      }
      case "fldChar": {
        const type = attr(el, "fldCharType");
        const name = { begin: "fieldStart", separate: "fieldSeparator", end: "fieldEnd" }[
          type ?? ""
        ];
        if (!name) {
          opaqueRun(el);
          break;
        }
        const known = ["w:fldCharType", "w:dirty", "w:fldLock"];
        const plain = !elements(el).length && el.attributes.every((a) => known.includes(a.name));
        const flags: Record<string, unknown> = {};
        if (name === "fieldStart" && plain) {
          const dirty = attr(el, "dirty");
          const locked = attr(el, "fldLock");
          if (dirty !== undefined) flags.dirty = !["0", "false", "off"].includes(dirty);
          if (locked !== undefined) flags.locked = !["0", "false", "off"].includes(locked);
        }
        // Form field data, or anything else on it: the element itself is kept.
        const simple = plain && (name === "fieldStart" || el.attributes.length === 1);
        const attrs = simple ? flags : { ext: sourceOf(context, el) };
        const leaf = valid(
          node(name, marks, Object.keys(attrs).length ? attrs : undefined),
          el,
          context,
        );
        if (leaf) out.push(leaf);
        else opaqueRun(el);
        break;
      }
      case "instrText":
      case "delInstrText": {
        const bag = attributeBag(el, ["xml:space"], context);
        const attrs: Record<string, unknown> = { text: spaced(el) };
        if (bag) attrs.attributes = bag;
        const leaf = valid(node("fieldCode", marks, attrs), el, context);
        if (leaf) out.push(leaf);
        else opaqueRun(el);
        break;
      }
      case "footnoteReference":
      case "endnoteReference": {
        const id = integer(attr(el, "id"));
        const custom = attr(el, "customMarkFollows");
        const on = custom === undefined ? null : ["1", "true", "on"].includes(custom);
        // A story holds no references (ADR-0007), and a value the node cannot say stays verbatim.
        if (
          context.story ||
          id === undefined ||
          (custom !== undefined && !["0", "1", "true", "false", "on", "off"].includes(custom))
        ) {
          opaqueRun(el);
          break;
        }
        const bag = attributeBag(el, ["w:id", "w:customMarkFollows"], context);
        const attrs: Record<string, unknown> = {
          story: `${el.local === "footnoteReference" ? "footnote" : "endnote"}:${id}`,
        };
        if (on !== null) attrs.customMark = on;
        if (bag) attrs.attributes = bag;
        const leaf = valid(node("noteReference", marks, attrs), el, context);
        if (leaf) out.push(leaf);
        else opaqueRun(el);
        break;
      }
      case "footnoteRef":
      case "endnoteRef":
        if (context.story === el.local.slice(0, -3) && !el.attributes.length)
          out.push(node("noteMark", marks));
        else opaqueRun(el);
        break;
      default:
        if (DROPPED.has(el.local)) context.report.dropped(el.name);
        else opaqueRun(el, undefined, context.story && NOTE_SEPARATORS.has(el.local));
    }
  }
  // A run with properties and nothing else shows nothing; Word drops those too.
  if (out.length === before) context.report.dropped("w:r (empty)");

  function opaqueRun(
    el: XmlElement,
    labelValue = label(INLINE_LABELS, el),
    expected: boolean | undefined = false,
  ): void {
    if (!expected) context.report.opaque(el.name);
    out.push(
      node("opaqueInline", marks, {
        ...withLabel({ xml: sourceOf(context, el) }, labelValue),
        run: true,
      }),
    );
  }
}

/**
 * A `w:t`'s text as Word reads it: without `xml:space="preserve"`, whitespace at its ends is not
 * part of the text (Word writes `preserve` whenever it is).
 */
function spaced(el: XmlElement): string {
  const value = textOf(el);
  const preserve = el.attributes.some(
    (a) => a.local === "space" && a.prefix === "xml" && a.value === "preserve",
  );
  return preserve ? value : value.trim();
}
