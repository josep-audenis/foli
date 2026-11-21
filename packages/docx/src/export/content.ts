/**
 * Schema v3 content back to WordprocessingML: paragraphs, runs grouped by their properties,
 * hyperlinks and tracked changes around them, markers between them, opaque content verbatim.
 */

import type { MarkJSON, NodeJSON } from "@folijs/core";
import { DocxError } from "../package.js";
import type { ControlWriter } from "./controls.js";
import { paragraphPropertiesXml, runPropertiesXml, same } from "./properties.js";
import {
  cellPropertiesXml,
  exceptionsXml,
  gridXml,
  rowPropertiesXml,
  tablePropertiesXml,
} from "./tables.js";
import {
  bagXml,
  el,
  escapeAttribute,
  escapeText,
  fragment,
  type Namespaces,
  scoped,
} from "./xmlout.js";

/** @internal */
export interface WriteContext {
  readonly namespaces: Namespaces;
  /**
   * The relationship id for an external hyperlink target: the link's own when the package
   * still has it with that target, otherwise a new one.
   */
  readonly hyperlink: (href: string, id: string | undefined) => string;
  /** A picture's `w:drawing` (its image related to the part, its media part allocated). */
  readonly picture: (attrs: Record<string, unknown>) => string;
  /** The kind of note being written: what its `noteMark` is. */
  readonly note?: "footnote" | "endnote";
  /** The document's content controls. */
  readonly controls: ControlWriter;
}

type Json = Record<string, unknown>;

/** Opaque XML as kept, once checked to be one element that fits the part (DocxError otherwise). */
function verbatim(xml: unknown, context: WriteContext): string {
  const text = typeof xml === "string" ? xml : "";
  fragment(text, context.namespaces);
  return text;
}

/** A control around `inner` (`w:sdtPr`, `w:sdtEndPr`, then the content, as `w:sdt` requires). */
function controlXml(id: string, inner: string, context: WriteContext): string {
  const { properties } = context.controls.parts(id, context.namespaces);
  return `<w:sdt>${properties}<w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
}

/** `items` written by `write`, the runs of them in one control (at `depth`) inside it. */
function inControls(
  items: readonly NodeJSON[],
  depth: number,
  context: WriteContext,
  write: (item: NodeJSON) => string,
): string {
  return grouped(
    items,
    (n) => (n.attrs?.controls as string[] | undefined)?.[depth],
    (group, id) =>
      id === undefined
        ? group.map(write).join("")
        : controlXml(id as string, inControls(group, depth + 1, context, write), context),
  );
}

/** @internal */
export function blocksXml(blocks: readonly NodeJSON[], context: WriteContext): string {
  return inControls(blocks, 0, context, (block) => {
    if (block.type === "paragraph") return paragraphXml(block, context);
    if (block.type === "opaqueBlock") return verbatim(block.attrs?.xml, context);
    if (block.type === "table") return tableXml(block, context);
    return notYet(block);
  });
}

/** `context` inside an element with this `attributes` bag: the namespaces it declares in scope. */
function within(context: WriteContext, bag: unknown): WriteContext {
  const namespaces = scoped(context.namespaces, bag);
  return namespaces === context.namespaces ? context : { ...context, namespaces };
}

/** A table: its properties, its grid, then each row's exceptions, properties and cells. */
function tableXml(table: NodeJSON, context: WriteContext): string {
  const ns = context.namespaces;
  const attrs = (table.attrs ?? {}) as Json;
  let out = `<w:tbl>${tablePropertiesXml(attrs, ns)}${gridXml(attrs, ns)}`;
  out += inControls(table.content ?? [], 0, context, (row) => {
    const r = (row.attrs ?? {}) as Json;
    const inRow = within(context, r.attributes);
    const rowNs = inRow.namespaces;
    const cells = inControls(row.content ?? [], 0, inRow, (cell) => {
      const c = (cell.attrs ?? {}) as Json;
      return `<w:tc>${cellPropertiesXml(c, rowNs)}${blocksXml(cell.content ?? [], inRow)}</w:tc>`;
    });
    return `<w:tr${bagXml(r.attributes, ns)}>${exceptionsXml(r.exceptions, rowNs)}${rowPropertiesXml(r, rowNs)}${cells}</w:tr>`;
  });
  return `${out}</w:tbl>`;
}

/** Content export does not write yet (pictures: 10.8): refused, never dropped. */
function notYet(node: NodeJSON): never {
  throw new DocxError(`A ${node.type} cannot be exported to .docx yet`);
}

/** @internal */
export function paragraphXml(p: NodeJSON, context: WriteContext): string {
  const attrs = (p.attrs ?? {}) as Json;
  const own = bagXml(attrs.attributes, context.namespaces);
  const inside = within(context, attrs.attributes);
  const inner = `${paragraphPropertiesXml(attrs, inside.namespaces)}${inlinesXml(p.content ?? [], inside)}`;
  // An empty paragraph as Word writes it.
  return inner ? `<w:p${own}>${inner}</w:p>` : `<w:p${own}/>`;
}

const markOf = (node: NodeJSON, type: string) => node.marks?.find((m) => m.type === type);

/** Consecutive nodes with the same `key`, each run of them given to `write`. */
function grouped(
  nodes: readonly NodeJSON[],
  key: (n: NodeJSON) => unknown,
  write: (group: readonly NodeJSON[], k: unknown) => string,
): string {
  let out = "";
  for (let i = 0; i < nodes.length; ) {
    const k = key(nodes[i] as NodeJSON);
    let j = i + 1;
    while (j < nodes.length && same(key(nodes[j] as NodeJSON), k)) j++;
    out += write(nodes.slice(i, j), k);
    i = j;
  }
  return out;
}

/** An element already written, standing in the inline content while runs are grouped. */
const ELEMENT = "#element";

/** Where the node matching the opening one at `from` is, by nesting; -1 if none. */
function closing(
  nodes: readonly NodeJSON[],
  from: number,
  opens: (n: NodeJSON) => boolean,
  closes: (n: NodeJSON) => boolean,
): number {
  let depth = 0;
  for (let i = from; i < nodes.length; i++) {
    const node = nodes[i] as NodeJSON;
    if (opens(node)) depth++;
    else if (closes(node) && --depth === 0) return i;
  }
  return -1;
}

/** A field read from `w:fldSimple`, written as one: start, its code, a separator, the result. */
function simpleFieldXml(
  inner: readonly NodeJSON[],
  context: WriteContext,
  deleted: boolean,
): string | undefined {
  const start = inner[0] as NodeJSON;
  const code = inner[1];
  if (code?.type !== "fieldCode" || inner[2]?.type !== "fieldSeparator") return undefined;
  const instruction = String(code.attrs?.text ?? "");
  const ext = start.attrs?.ext as string | undefined;
  let open = `<w:fldSimple w:instr="${escapeAttribute(instruction)}">`;
  if (ext) {
    const { element, source } = fragment(`${ext}</w:fldSimple>`, context.namespaces, "fldSimple");
    const others = element.attributes
      .filter((a) => a.name !== "w:instr")
      .map((a) => ` ${source.slice(a.start, a.end)}`)
      .join("");
    const same = element.attributes.find((a) => a.name === "w:instr")?.value === instruction;
    open = same ? ext : `<w:fldSimple w:instr="${escapeAttribute(instruction)}"${others}>`;
  }
  return `${open}${inlinesXml(inner.slice(3), context, deleted)}</w:fldSimple>`;
}

/** The hyperlink and tracked changes `a` and `b` both have: they go around the whole element. */
function sharedStructure(a: NodeJSON, b: NodeJSON): MarkJSON[] {
  return (a.marks ?? []).filter(
    (m) => STRUCTURE.has(m.type) && (b.marks ?? []).some((other) => same(m, other)),
  );
}

/**
 * Inline content: inline controls and simple fields as the elements around what they hold, inside
 * the hyperlink and tracked changes around both their ends (ends whose partner is gone are
 * dropped, their content kept); the rest in runs. `deleted`: inside a tracked deletion.
 */
function inlinesXml(nodes: readonly NodeJSON[], context: WriteContext, deleted = false): string {
  const out: NodeJSON[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as NodeJSON;
    const control = node.type === "controlStart";
    const field = node.type === "fieldStart" && !!node.attrs?.simple;
    const id = node.attrs?.id;
    const end =
      !control && !field
        ? -1
        : closing(
            nodes,
            i,
            (n) =>
              control ? n.type === "controlStart" && n.attrs?.id === id : n.type === "fieldStart",
            (n) =>
              control ? n.type === "controlEnd" && n.attrs?.id === id : n.type === "fieldEnd",
          );
    if (end < 0) {
      out.push(node);
      continue;
    }
    const shared = sharedStructure(node, nodes[end] as NodeJSON);
    const without = (n: NodeJSON): NodeJSON => {
      const marks = (n.marks ?? []).filter((m) => !shared.some((s) => same(m, s)));
      const { marks: _marks, ...rest } = n;
      return marks.length ? { ...rest, marks } : rest;
    };
    const gone = deleted || shared.some((m) => m.type === "deletion");
    const xml = control
      ? controlXml(
          String(id),
          inlinesXml(nodes.slice(i + 1, end).map(without), context, gone),
          context,
        )
      : simpleFieldXml(nodes.slice(i, end).map(without), context, gone);
    if (xml === undefined) {
      out.push(node);
      continue;
    }
    out.push({ type: ELEMENT, attrs: { xml }, ...(shared.length ? { marks: shared } : {}) });
    i = end;
  }
  return plainInlinesXml(out, context, deleted);
}

/** Hyperlinks outermost, then insertions (or move destinations), then deletions (or move sources). */
function plainInlinesXml(
  nodes: readonly NodeJSON[],
  context: WriteContext,
  outerDeleted: boolean,
): string {
  return grouped(
    nodes,
    (n) => markOf(n, "link"),
    (group, link) => {
      const inner = grouped(
        group,
        (n) => markOf(n, "insertion"),
        (g, ins) =>
          wrapChange(
            ins as MarkJSON | undefined,
            "ins",
            "moveTo",
            grouped(
              g,
              (n) => markOf(n, "deletion"),
              (g2, del) =>
                wrapChange(
                  del as MarkJSON | undefined,
                  "del",
                  "moveFrom",
                  runsXml(g2, !!del || outerDeleted, context),
                  context,
                ),
            ),
            context,
          ),
      );
      return link ? hyperlinkXml(link as MarkJSON, inner, context) : inner;
    },
  );
}

const CHANGE_ATTRIBUTES = ["w:id", "w:author", "w:date"];

function wrapChange(
  mark: MarkJSON | undefined,
  local: string,
  moveLocal: string,
  inner: string,
  context: WriteContext,
): string {
  if (!mark) return inner;
  const a = (mark.attrs ?? {}) as Json;
  const name = a.move ? `w:${moveLocal}` : `w:${local}`;
  const open = el(name, {
    "w:id": String(a.id),
    "w:author": String(a.author ?? ""),
    "w:date": a.date as string | undefined,
  }).slice(0, -2);
  return `${open}${bagXml(a.attributes, context.namespaces, CHANGE_ATTRIBUTES)}>${inner}</${name}>`;
}

function hyperlinkXml(link: MarkJSON, inner: string, context: WriteContext): string {
  const a = (link.attrs ?? {}) as Json;
  const attributes = { ...((a.attributes as Record<string, string>) ?? {}) };
  const original = attributes["r:id"];
  delete attributes["r:id"];
  // A target: its relationship. None (a relationship the package does not have, read as no
  // target): the original reference as it was.
  const id = typeof a.href === "string" ? context.hyperlink(a.href, original) : original;
  const open = el("w:hyperlink", {
    "r:id": id,
    "w:anchor": a.anchor as string | undefined,
    "w:tooltip": a.tooltip as string | undefined,
  }).slice(0, -2);
  return `${open}${bagXml(attributes, context.namespaces, ["r:id", "w:anchor", "w:tooltip"])}>${inner}</w:hyperlink>`;
}

/** Inline nodes that are a run's content (the rest stands between runs). */
function inRun(node: NodeJSON): boolean {
  if (node.type === "opaqueInline") return node.attrs?.run === true;
  return [
    "text",
    "tab",
    "hardBreak",
    "pageBreak",
    "columnBreak",
    "commentReference",
    "noteReference",
    "noteMark",
    "picture",
    "fieldStart",
    "fieldCode",
    "fieldSeparator",
    "fieldEnd",
  ].includes(node.type);
}

const STRUCTURE = new Set(["link", "insertion", "deletion"]);

/** A run's own properties: its marks without the hyperlink and tracked changes around it. */
function runMarks(node: NodeJSON): MarkJSON[] {
  return (node.marks ?? []).filter((m) => !STRUCTURE.has(m.type));
}

function runsXml(nodes: readonly NodeJSON[], deleted: boolean, context: WriteContext): string {
  return grouped(
    nodes,
    (n) => (inRun(n) ? runMarks(n) : n),
    (group) => {
      const first = group[0] as NodeJSON;
      if (!inRun(first)) return group.map((n) => markerXml(n, context)).join("");
      const marks = runMarks(first);
      const ext = marks.find((m) => m.type === "runExt")?.attrs?.xml as string | undefined;
      const rPr = runPropertiesXml(
        marks.filter((m) => m.type !== "runExt"),
        ext,
        context.namespaces,
      );
      return `<w:r>${rPr}${group.map((n) => runContentXml(n, deleted, context)).join("")}</w:r>`;
    },
  );
}

function markerXml(node: NodeJSON, context: WriteContext): string {
  const a = (node.attrs ?? {}) as Json;
  const tag = (name: string, attrs: Record<string, string | undefined>) =>
    `${el(name, attrs).slice(0, -2)}${bagXml(a.attributes, context.namespaces, Object.keys(attrs))}/>`;
  switch (node.type) {
    case "bookmarkStart":
      return tag("w:bookmarkStart", { "w:id": String(a.id), "w:name": String(a.name ?? "") });
    case "bookmarkEnd":
      return tag("w:bookmarkEnd", { "w:id": String(a.id) });
    case "commentStart":
      return tag("w:commentRangeStart", { "w:id": String(a.id) });
    case "commentEnd":
      return tag("w:commentRangeEnd", { "w:id": String(a.id) });
    case ELEMENT:
      return String(a.xml);
    case "opaqueInline":
      return verbatim(a.xml, context);
    // Their partner is gone (an edit): the content around them stays.
    case "controlStart":
    case "controlEnd":
      return "";
    default:
      return notYet(node);
  }
}

/** A `w:fldChar`: the element as read if it holds more than the model does. */
function fieldCharXml(type: string, a: Json, context: WriteContext): string {
  // A simple field's `ext` is its start tag: this one has lost its shape, and is written plain.
  if (a.ext && !a.simple) return verbatim(a.ext, context);
  const flag = (value: unknown) =>
    value === null || value === undefined ? undefined : value ? "1" : "0";
  return el("w:fldChar", {
    "w:fldCharType": type,
    "w:dirty": flag(a.dirty),
    "w:fldLock": flag(a.locked),
  });
}

/**
 * Text as `w:t` (or `w:delText`), with tabs and Word's special hyphens as their elements, and
 * line ends and vertical tabs (Office's line break in pasted text) as breaks.
 */
function textXml(text: string, deleted: boolean): string {
  const name = deleted ? "w:delText" : "w:t";
  let out = "";
  // A vertical tab (U+000B) is a line break, as Office pastes it.
  const lines = text.split(String.fromCharCode(11)).join("\n");
  for (const piece of lines.split(/(\r\n|[\t‑­\n\r])/)) {
    if (piece === "") continue;
    if (piece === "\t") out += "<w:tab/>";
    else if (piece === "‑") out += "<w:noBreakHyphen/>";
    else if (piece === "­") out += "<w:softHyphen/>";
    else if (piece === "\n" || piece === "\r" || piece === "\r\n") out += "<w:br/>";
    else {
      const preserve = /^\s|\s$/.test(piece) ? ' xml:space="preserve"' : "";
      out += `<${name}${preserve}>${escapeText(piece)}</${name}>`;
    }
  }
  return out;
}

function runContentXml(node: NodeJSON, deleted: boolean, context: WriteContext): string {
  const a = (node.attrs ?? {}) as Json;
  switch (node.type) {
    case "text":
      return textXml(node.text ?? "", deleted);
    case "tab":
      return "<w:tab/>";
    case "hardBreak":
      return el("w:br", { "w:clear": a.clear as string | undefined });
    case "pageBreak":
      return el("w:br", { "w:type": "page" });
    case "columnBreak":
      return el("w:br", { "w:type": "column" });
    case "commentReference":
      return `${el("w:commentReference", { "w:id": String(a.id) }).slice(0, -2)}${bagXml(a.attributes, context.namespaces, ["w:id"])}/>`;
    case "noteReference": {
      const [kind, id] = String(a.story).split(/:(.*)/s) as [string, string];
      if ((kind !== "footnote" && kind !== "endnote") || !/^-?\d+$/.test(id ?? ""))
        throw new DocxError(`Not a note's id: ${String(a.story).slice(0, 64)}`);
      const known = ["w:customMarkFollows", "w:id"];
      const open = el(`w:${kind}Reference`, {
        "w:customMarkFollows": a.customMark === undefined ? undefined : a.customMark ? "1" : "0",
        "w:id": id,
      }).slice(0, -2);
      return `${open}${bagXml(a.attributes, context.namespaces, known)}/>`;
    }
    case "noteMark":
      return context.note ? `<w:${context.note}Ref/>` : notYet(node);
    case "fieldStart":
      return fieldCharXml("begin", a, context);
    case "fieldSeparator":
      return fieldCharXml("separate", a, context);
    case "fieldEnd":
      return fieldCharXml("end", a, context);
    case "fieldCode": {
      const name = deleted ? "w:delInstrText" : "w:instrText";
      const value = String(a.text ?? "");
      const preserve = /^\s|\s$/.test(value) ? ' xml:space="preserve"' : "";
      const bag = bagXml(a.attributes, context.namespaces, ["xml:space"]);
      return `<${name}${preserve}${bag}>${escapeText(value)}</${name}>`;
    }
    case "opaqueInline":
      return verbatim(a.xml, context);
    case "picture":
      return context.picture(a);
    default:
      return notYet(node);
  }
}
