/**
 * Schema v3 content back to WordprocessingML: paragraphs, runs grouped by their properties,
 * hyperlinks and tracked changes around them, markers between them, opaque content verbatim.
 */

import type { MarkJSON, NodeJSON } from "@folijs/core";
import { paragraphPropertiesXml, runPropertiesXml, same } from "./properties.js";
import { bagXml, el, escapeText, fragment, type Namespaces } from "./xmlout.js";

export interface WriteContext {
  readonly namespaces: Namespaces;
  /**
   * The relationship id for an external hyperlink target: the link's own when the package
   * still has it with that target, otherwise a new one.
   */
  readonly hyperlink: (href: string, id: string | undefined) => string;
}

type Json = Record<string, unknown>;

/** Opaque XML as kept, once checked to be one element that fits the part (DocxError otherwise). */
function verbatim(xml: unknown, context: WriteContext): string {
  const text = typeof xml === "string" ? xml : "";
  fragment(text, context.namespaces);
  return text;
}

export function blocksXml(blocks: readonly NodeJSON[], context: WriteContext): string {
  let out = "";
  for (const block of blocks) {
    if (block.type === "paragraph") out += paragraphXml(block, context);
    else if (block.type === "opaqueBlock") out += verbatim(block.attrs?.xml, context);
  }
  return out;
}

export function paragraphXml(p: NodeJSON, context: WriteContext): string {
  const attrs = (p.attrs ?? {}) as Json;
  const own = bagXml(attrs.attributes, context.namespaces);
  return `<w:p${own}>${paragraphPropertiesXml(attrs, context.namespaces)}${inlinesXml(p.content ?? [], context)}</w:p>`;
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
    case "opaqueInline":
      return verbatim(a.xml, context);
    default:
      return "";
  }
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
    case "opaqueInline":
      return verbatim(a.xml, context);
    default:
      return "";
  }
}
