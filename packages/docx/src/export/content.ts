/**
 * Schema v3 content back to WordprocessingML: paragraphs, runs grouped by their properties,
 * hyperlinks and tracked changes around them, markers between them, opaque content verbatim.
 */

import type { MarkJSON, NodeJSON } from "@folijs/core";
import { paragraphPropertiesXml, runPropertiesXml, same } from "./properties.js";
import { el, escapeAttribute, escapeText, type Namespaces } from "./xmlout.js";

export interface WriteContext {
  readonly namespaces: Namespaces;
  /**
   * The relationship id for an external hyperlink target: the link's own when the package
   * still has it with that target, otherwise a new one.
   */
  readonly hyperlink: (href: string, id: string | undefined) => string;
}

type Json = Record<string, unknown>;

export function blocksXml(blocks: readonly NodeJSON[], context: WriteContext): string {
  let out = "";
  for (const block of blocks) {
    if (block.type === "paragraph") out += paragraphXml(block, context);
    else if (block.type === "opaqueBlock") out += (block.attrs?.xml as string) ?? "";
  }
  return out;
}

/** An element's own attributes from its `attributes` bag, as written. */
function bag(attributes: unknown): string {
  if (!attributes || typeof attributes !== "object") return "";
  return Object.entries(attributes as Record<string, string>)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join("");
}

export function paragraphXml(p: NodeJSON, context: WriteContext): string {
  const attrs = (p.attrs ?? {}) as Json;
  return `<w:p${bag(attrs.attributes)}>${paragraphPropertiesXml(attrs, context.namespaces)}${inlinesXml(p.content ?? [], context)}</w:p>`;
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

/** Hyperlinks outermost, then insertions (or move destinations), then deletions (or move sources). */
function inlinesXml(nodes: readonly NodeJSON[], context: WriteContext): string {
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
                  runsXml(g2, !!del, context),
                ),
            ),
          ),
      );
      return link ? hyperlinkXml(link as MarkJSON, inner, context) : inner;
    },
  );
}

function wrapChange(
  mark: MarkJSON | undefined,
  local: string,
  moveLocal: string,
  inner: string,
): string {
  if (!mark) return inner;
  const a = (mark.attrs ?? {}) as Json;
  const name = a.move ? `w:${moveLocal}` : `w:${local}`;
  const open = el(name, {
    "w:id": String(a.id),
    "w:author": String(a.author ?? ""),
    "w:date": a.date as string | undefined,
  }).slice(0, -2);
  return `${open}${bag(a.attributes)}>${inner}</${name}>`;
}

function hyperlinkXml(link: MarkJSON, inner: string, context: WriteContext): string {
  const a = (link.attrs ?? {}) as Json;
  const attributes = { ...((a.attributes as Record<string, string>) ?? {}) };
  const original = attributes["r:id"];
  delete attributes["r:id"];
  const id = typeof a.href === "string" ? context.hyperlink(a.href, original) : undefined;
  const open = el("w:hyperlink", {
    "r:id": id,
    "w:anchor": a.anchor as string | undefined,
    "w:tooltip": a.tooltip as string | undefined,
  }).slice(0, -2);
  return `${open}${bag(attributes)}>${inner}</w:hyperlink>`;
}

/** Inline nodes that are a run's content (the rest stands between runs). */
function inRun(node: NodeJSON): boolean {
  if (node.type === "opaqueInline") return node.attrs?.run === true;
  return ["text", "tab", "hardBreak", "pageBreak", "columnBreak", "commentReference"].includes(
    node.type,
  );
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
      if (!inRun(first)) return group.map(markerXml).join("");
      const marks = runMarks(first);
      const ext = marks.find((m) => m.type === "runExt")?.attrs?.xml as string | undefined;
      const rPr = runPropertiesXml(
        marks.filter((m) => m.type !== "runExt"),
        ext,
        context.namespaces,
      );
      return `<w:r>${rPr}${group.map((n) => runContentXml(n, deleted)).join("")}</w:r>`;
    },
  );
}

function markerXml(node: NodeJSON): string {
  const a = (node.attrs ?? {}) as Json;
  const tag = (name: string, attrs: Record<string, string | undefined>) =>
    `${el(name, attrs).slice(0, -2)}${bag(a.attributes)}/>`;
  switch (node.type) {
    case "bookmarkStart":
      return tag("w:bookmarkStart", { "w:id": String(a.id), "w:name": String(a.name ?? "") });
    case "bookmarkEnd":
      return tag("w:bookmarkEnd", { "w:id": String(a.id) });
    case "commentStart":
      return tag("w:commentRangeStart", { "w:id": String(a.id) });
    case "commentEnd":
      return tag("w:commentRangeEnd", { "w:id": String(a.id) });
    case "opaqueInline":
      return (a.xml as string) ?? "";
    default:
      return "";
  }
}

/** Text as `w:t` (or `w:delText`), with tabs and Word's special hyphens as their elements. */
function textXml(text: string, deleted: boolean): string {
  const name = deleted ? "w:delText" : "w:t";
  let out = "";
  for (const piece of text.split(/([\t‑­])/)) {
    if (piece === "") continue;
    if (piece === "\t") out += "<w:tab/>";
    else if (piece === "‑") out += "<w:noBreakHyphen/>";
    else if (piece === "­") out += "<w:softHyphen/>";
    else {
      const preserve = /^\s|\s$/.test(piece) ? ' xml:space="preserve"' : "";
      out += `<${name}${preserve}>${escapeText(piece)}</${name}>`;
    }
  }
  return out;
}

function runContentXml(node: NodeJSON, deleted: boolean): string {
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
      return `${el("w:commentReference", { "w:id": String(a.id) }).slice(0, -2)}${bag(a.attributes)}/>`;
    case "opaqueInline":
      return (a.xml as string) ?? "";
    default:
      return "";
  }
}
