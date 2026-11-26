/**
 * A part whose root is `mc:AlternateContent` (markup compatibility, ECMA-376 Part 3), read as
 * Word reads it (Phase 28.4): the first `mc:Choice` whose `Requires` namespaces are understood,
 * else the `mc:Fallback`, else nothing. The main document's branch may hold one or more
 * `w:document`s (their bodies joined, the last one's section properties kept, the first one's
 * other children such as `w:background` kept), a bare `w:body`, or bare blocks, an element Word
 * does not know read as the blocks it holds; another part's root there is dropped, as Word drops it. Another part takes its branch's first element as its root.
 * The result is the part's text with that root in the place of `mc:AlternateContent`, the
 * namespaces declared above it moved onto it; what it holds is the original's text.
 */

import type { XmlAttribute, XmlDocument, XmlElement } from "./xml.js";

const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
/** Namespaces Word understands: OOXML's, Strict's, Microsoft's (an approximation, ADR-0014). */
const UNDERSTOOD =
  /^(http:\/\/schemas\.openxmlformats\.org\/|http:\/\/purl\.oclc\.org\/ooxml\/|http:\/\/schemas\.microsoft\.com\/office\/|urn:schemas-microsoft-com:)/;
/** Elements a body holds directly. */
const BLOCKS = new Set([
  "p",
  "tbl",
  "sdt",
  "customXml",
  "bookmarkStart",
  "bookmarkEnd",
  "moveFromRangeStart",
  "moveFromRangeEnd",
  "moveToRangeStart",
  "moveToRangeEnd",
  "commentRangeStart",
  "commentRangeEnd",
  "permStart",
  "permEnd",
  "proofErr",
  "ins",
  "del",
  "altChunk",
]);

/** Other parts' roots: in a document's branch, dropped, not read as a wrapper of blocks. */
const PART_ROOTS = new Set([
  "hdr",
  "ftr",
  "footnotes",
  "endnotes",
  "comments",
  "styles",
  "numbering",
  "settings",
  "glossaryDocument",
]);

/**
 * A part's root resolved: its new text, and what was dropped (element names).
 * @internal
 */
export interface ResolvedRoot {
  readonly text: string;
  readonly dropped: readonly string[];
}

const elementsOf = (el: XmlElement) =>
  el.children.filter((c): c is XmlElement => c.kind === "element");
const isDeclaration = (a: XmlAttribute) => a.name === "xmlns" || a.prefix === "xmlns";
const prefixOf = (a: XmlAttribute) => (a.name === "xmlns" ? "" : a.local);

/**
 * Whether `text` (a part's) starts with an `mc:AlternateContent` root: cheap, before a parse.
 * @internal
 */
export function mayHaveAlternateRoot(text: string): boolean {
  return /^﻿?\s*(?:<\?[\s\S]*?\?>\s*|<!--[\s\S]*?-->\s*)*<(?:[\w.-]+:)?AlternateContent[\s>/]/.test(
    text,
  );
}

/**
 * The part read as Word reads it when its root is `mc:AlternateContent`; undefined when it is not,
 * or when another part's branch holds no element (it stays as it is).
 * @internal
 */
export function resolveAlternateRoot(doc: XmlDocument, main: boolean): ResolvedRoot | undefined {
  const { root, source } = doc;
  if (root.ns !== MC || root.local !== "AlternateContent") return undefined;
  const branches = elementsOf(root).filter((b) => b.ns === MC);
  const scope = new Map(root.attributes.filter(isDeclaration).map((a) => [prefixOf(a), a.value]));
  const understood = (choice: XmlElement) => {
    const inScope = new Map(scope);
    for (const a of choice.attributes.filter(isDeclaration)) inScope.set(prefixOf(a), a.value);
    const requires = choice.attributes.find((a) => a.local === "Requires" && !a.prefix)?.value;
    return (requires ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .every((prefix) => UNDERSTOOD.test(inScope.get(prefix) ?? ""));
  };
  const taken =
    branches.find((b) => b.local === "Choice" && understood(b)) ??
    branches.find((b) => b.local === "Fallback");
  const dropped = elementsOf(root)
    .filter((b) => b !== taken)
    .map((b) => `${b.name} (root)`);
  const before = source.slice(0, root.start);
  const after = source.slice(root.end);
  /**
   * Declarations in scope down to `from`, by prefix, later ones winning. shortcut: one scope for
   * all the joined content, so a prefix a later document binds to another URI wins for the earlier
   * ones too; no such file is known, a per-element scope if one turns up.
   */
  const declarations = (...from: XmlElement[]) => {
    const all = new Map<string, { text: string; uri: string }>();
    for (const el of [root, ...(taken ? [taken] : []), ...from])
      for (const a of el.attributes.filter(isDeclaration))
        all.set(prefixOf(a), { text: source.slice(a.start, a.end), uri: a.value });
    return all;
  };
  const kids = taken ? elementsOf(taken) : [];

  if (!main) {
    const first = kids[0];
    // Nothing to read: the part stays as it is, what was not taken reported.
    if (!first) return { text: source, dropped };
    for (const other of kids.slice(1)) dropped.push(`${other.name} (in ${taken?.name})`);
    const own = new Set(first.attributes.filter(isDeclaration).map(prefixOf));
    const extra = [...declarations()]
      .filter(([prefix]) => !own.has(prefix))
      .map(([, { text }]) => ` ${text}`)
      .join("");
    const nameEnd = first.start + 1 + first.name.length;
    return {
      text:
        before +
        source.slice(first.start, nameEnd) +
        extra +
        source.slice(nameEnd, first.end) +
        after,
      dropped,
    };
  }

  const documents = kids.filter((k) => k.ns === W && k.local === "document");
  const bodyOf = (d: XmlElement) => elementsOf(d).find((c) => c.ns === W && c.local === "body");
  let bodies: XmlElement[] = [];
  let blocks: XmlElement[] = [];
  if (documents.length) bodies = documents.map(bodyOf).filter((b): b is XmlElement => !!b);
  else {
    const body = kids.find((k) => k.ns === W && k.local === "body");
    if (body) bodies = [body];
    // Blocks, and the blocks an element Word does not know holds (`w:madeUp`), as Word reads them.
    else
      blocks = kids.flatMap((k) =>
        k.ns !== W
          ? []
          : BLOCKS.has(k.local)
            ? [k]
            : PART_ROOTS.has(k.local)
              ? []
              : elementsOf(k).filter((c) => c.ns === W && BLOCKS.has(c.local)),
      );
  }
  const wrappers = kids.filter((kid) => blocks.some((b) => elementsOf(kid).includes(b)));
  const used = new Set<XmlElement>([...documents, ...bodies, ...blocks, ...wrappers]);
  for (const kid of kids) if (!used.has(kid)) dropped.push(`${kid.name} (in ${taken?.name})`);

  const first = documents[0];
  const named = first ?? bodies[0] ?? blocks[0];
  const prefix = named ? (named.prefix ? `${named.prefix}:` : "") : "w:";
  const decls = declarations(...documents, ...bodies, ...wrappers);
  // The new root's prefix bound to WordprocessingML, whatever the levels above bound it to.
  const key = prefix.slice(0, -1);
  if (decls.get(key)?.uri !== W)
    decls.set(key, { text: `${key ? `xmlns:${key}` : "xmlns"}="${W}"`, uri: W });
  // The first document's other attributes (`mc:Ignorable`), else the root's.
  const attributes = (first ?? root).attributes
    .filter((a) => !isDeclaration(a))
    .map((a) => ` ${source.slice(a.start, a.end)}`)
    .join("");
  const head = first
    ? elementsOf(first)
        .filter((c) => c !== bodyOf(first))
        .map((c) => source.slice(c.start, c.end))
        .join("")
    : "";
  for (const later of documents.slice(1))
    for (const c of elementsOf(later))
      if (c !== bodyOf(later)) dropped.push(`${c.name} (in a joined w:document)`);
  const last = bodies[bodies.length - 1];
  const inner = bodies.length
    ? bodies
        .map((body) =>
          elementsOf(body)
            .filter((c) => {
              // The joined body's section: the last body's own, at its end; others reported.
              if (
                c.ns === W &&
                c.local === "sectPr" &&
                !(body === last && c === elementsOf(body).at(-1))
              ) {
                dropped.push(`${c.name} (in a joined w:body)`);
                return false;
              }
              return true;
            })
            .map((c) => source.slice(c.start, c.end))
            .join(""),
        )
        .join("")
    : blocks.map((b) => source.slice(b.start, b.end)).join("");
  const text =
    `${before}<${prefix}document${[...decls.values()].map((d) => ` ${d.text}`).join("")}${attributes}>` +
    `${head}<${prefix}body>${inner}</${prefix}body></${prefix}document>${after}`;
  return { text, dropped };
}
