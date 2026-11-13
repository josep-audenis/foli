/** Writing XML: escaping, elements, and reading back the verbatim fragments the model keeps. */

import { W } from "../import/ooxml.js";
import { parseXml, type XmlElement } from "../xml.js";

/** Character data: `&`, `<`, `>` escaped. */
export function escapeText(text: string): string {
  return text.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

/** An attribute value: also `"`, and tabs and line ends as references (XML normalizes them). */
export function escapeAttribute(value: string): string {
  return value.replace(/[&<>"\t\n\r]/g, (c) => `&#${c.charCodeAt(0)};`);
}

export type Attrs = Readonly<Record<string, string | number | boolean | undefined | null>>;

/** `<name a="1">children</name>`, or `<name a="1"/>` without children; undefined attributes left out. */
export function el(name: string, attrs: Attrs = {}, children = ""): string {
  let out = `<${name}`;
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    out += ` ${key}="${escapeAttribute(typeof value === "boolean" ? (value ? "1" : "0") : String(value))}"`;
  }
  return children ? `${out}>${children}</${name}>` : `${out}/>`;
}

/** `w:` element with a `w:val`. */
export function val(local: string, value: string | number | undefined): string {
  return value === undefined ? "" : el(`w:${local}`, { "w:val": value });
}

/** An on/off property: `<w:b/>`, or `<w:b w:val="0"/>` when off. */
export function onOff(local: string, value: boolean | null | undefined): string {
  if (value === undefined || value === null) return "";
  return value ? el(`w:${local}`) : el(`w:${local}`, { "w:val": "0" });
}

/**
 * Namespace declarations in scope for a part's verbatim fragments: its root's `xmlns`
 * attributes, written on a wrapper so a fragment such as `<w:pPr>…</w:pPr>` parses.
 */
export interface Namespaces {
  readonly declarations: string;
}

export const DEFAULT_NAMESPACES: Namespaces = {
  declarations: `xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`,
};

export function namespacesOf(root: XmlElement, source: string): Namespaces {
  const declarations = root.attributes
    .filter((a) => a.name === "xmlns" || a.prefix === "xmlns")
    .map((a) => source.slice(a.start, a.end))
    .join(" ");
  return { declarations: declarations || DEFAULT_NAMESPACES.declarations };
}

/**
 * A verbatim fragment (`ext`, `runExt`) parsed as its single element, with its offsets into
 * the returned source; undefined when it does not parse (written back untouched then).
 */
export function fragment(
  xml: string,
  namespaces: Namespaces,
): { element: XmlElement; source: string } | undefined {
  try {
    const source = `<fragment ${namespaces.declarations}>${xml}</fragment>`;
    const doc = parseXml(source);
    const element = doc.root.children.find((c): c is XmlElement => c.kind === "element");
    return element ? { element, source } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The children of a properties element in the order Word requires. `modeled` are the children
 * the model owns: written from `generated` or not at all (a property removed in the editor must
 * not come back from the original). Every other child of `original` (unknown to Foli) is kept
 * verbatim at its place in `order`, or at the end when `order` does not name it (extensions
 * such as `w14:ligatures`, which Word writes last).
 */
export function merged(
  order: readonly string[],
  modeled: ReadonlySet<string>,
  generated: ReadonlyMap<string, string>,
  original: { element: XmlElement; source: string } | undefined,
): string {
  const kept = new Map<string, string[]>();
  const tail: string[] = [];
  if (original) {
    for (const c of original.element.children) {
      if (c.kind !== "element") continue;
      const isW = c.ns === W;
      if (isW && modeled.has(c.local)) continue;
      const text = original.source.slice(c.start, c.end);
      if (isW && order.includes(c.local)) kept.set(c.local, [...(kept.get(c.local) ?? []), text]);
      else tail.push(text);
    }
  }
  let out = "";
  for (const local of order) out += generated.get(local) ?? (kept.get(local) ?? []).join("");
  return out + tail.join("");
}

/** The original element's own attributes, as written (`w:rsidR`… on `w:pPr` is rare but kept). */
export function attributesOf(
  original: { element: XmlElement; source: string } | undefined,
): string {
  if (!original) return "";
  return original.element.attributes
    .filter((a) => a.name !== "xmlns" && a.prefix !== "xmlns")
    .map((a) => ` ${original.source.slice(a.start, a.end)}`)
    .join("");
}
