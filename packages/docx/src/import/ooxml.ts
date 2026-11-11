/** WordprocessingML names and the small helpers the importer reads XML with. */

import type { XmlElement, XmlNode } from "../xml.js";

export const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
/** Strict Open XML's WordprocessingML namespace (not supported yet: other units and names). */
export const W_STRICT = "http://purl.oclc.org/ooxml/wordprocessingml/main";
export const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
export const W15 = "http://schemas.microsoft.com/office/word/2012/wordml";
export const A = "http://schemas.openxmlformats.org/drawingml/2006/main";

export const REL = {
  styles: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
  numbering: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering",
  theme: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
  comments: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
  commentsExtended: "http://schemas.microsoft.com/office/2011/relationships/commentsExtended",
  hyperlink: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
};

/** Whether `node` is the WordprocessingML element `local`. */
export function isW(node: XmlNode, local?: string): boolean {
  return node.kind === "element" && node.ns === W && (local === undefined || node.local === local);
}

export function elements(element: XmlElement): XmlElement[] {
  return element.children.filter((child): child is XmlElement => child.kind === "element");
}

/** The first WordprocessingML child named `local`. */
export function child(element: XmlElement, local: string): XmlElement | undefined {
  return element.children.find((c): c is XmlElement => c.kind === "element" && isW(c, local));
}

/** A WordprocessingML attribute (`w:val`) of `element`. */
export function attr(element: XmlElement | undefined, local: string, ns = W): string | undefined {
  return element?.attributes.find((a) => a.local === local && a.ns === ns)?.value;
}

/** The text of an element's character data children (`w:t`, `w:delText`, `w:instrText`). */
export function textOf(element: XmlElement): string {
  return element.children.map((c) => (c.kind === "text" ? c.text : "")).join("");
}

/** Every `w:t` of an element's descendants, in order (a field's or content control's visible text). */
export function deepText(element: XmlElement): string {
  let out = "";
  for (const c of element.children) {
    if (c.kind !== "element") continue;
    out += isW(c, "t") ? textOf(c) : deepText(c);
  }
  return out;
}

/** An integer as Word writes it; undefined for anything else (universal measures, decimals). */
export function integer(value: string | undefined): number | undefined {
  return value !== undefined && /^-?\d+$/.test(value) ? Number.parseInt(value, 10) : undefined;
}

/**
 * An on/off property (ST_OnOff): absent value is on. Undefined for a value that is not one of
 * Word's spellings.
 */
export function toggle(element: XmlElement): boolean | undefined {
  const value = attr(element, "val");
  if (value === undefined || value === "1" || value === "true" || value === "on") return true;
  if (value === "0" || value === "false" || value === "off") return false;
  return undefined;
}

/** `{ key: value }` without the undefined values; undefined when none remain. */
export function compact<T extends Record<string, unknown>>(object: T): Partial<T> | undefined {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) if (value !== undefined) out[key] = value;
  return Object.keys(out).length ? (out as Partial<T>) : undefined;
}
