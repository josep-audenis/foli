/**
 * The page color (`w:background`, the first child of `w:document`): read into the settings'
 * `background` and written back. A background as the file has it stays verbatim, Fill Effects
 * (its VML children) included; a new color is written as Word's Page Color writes it, without
 * them.
 */
import type { PageBackgroundJSON } from "@folijs/core";
import { escapeAttribute } from "./export/xmlout.js";
import { attr, child, compact } from "./import/ooxml.js";
import type { XmlElement } from "./xml.js";

const COLOR = /^([0-9A-Fa-f]{6}|auto)$/;
const TOKEN = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
const BYTE = /^[0-9A-Fa-f]{2}$/;

/** What the model holds of the element's attributes (a value it cannot hold is left out). */
function valuesOf(element: XmlElement): Omit<PageBackgroundJSON, "ext"> {
  const valid = (name: string, pattern: RegExp) => {
    const value = attr(element, name);
    return value !== undefined && pattern.test(value) ? value : undefined;
  };
  return (compact({
    color: valid("color", COLOR),
    themeColor: valid("themeColor", TOKEN),
    themeTint: valid("themeTint", BYTE),
    themeShade: valid("themeShade", BYTE),
  }) ?? {}) as Omit<PageBackgroundJSON, "ext">;
}

/**
 * The page color `document` (a `w:document`) gives, undefined when none.
 * @internal
 */
export function readBackground(
  document: XmlElement,
  source: string,
): PageBackgroundJSON | undefined {
  const element = child(document, "background");
  if (!element) return undefined;
  return { ...valuesOf(element), ext: source.slice(element.start, element.end) };
}

const sameValues = (a: Omit<PageBackgroundJSON, "ext">, b: Omit<PageBackgroundJSON, "ext">) =>
  a.color === b.color &&
  a.themeColor === b.themeColor &&
  a.themeTint === b.themeTint &&
  a.themeShade === b.themeShade;

/**
 * `head` (the main part's source up to the body's start tag, `document` its root, `body` its
 * `w:body`) saying `wanted`: unchanged while the element says it, else the element replaced,
 * added before the body or removed.
 * @internal
 */
export function withBackground(
  head: string,
  document: XmlElement,
  body: XmlElement,
  wanted: PageBackgroundJSON | undefined,
): string {
  const existing = child(document, "background");
  if (!existing && !wanted) return head;
  const { ext: _ext, ...values } = wanted ?? {};
  if (existing && wanted && sameValues(valuesOf(existing), values)) return head;
  const xml = wanted ? backgroundXml(document.prefix ? `${document.prefix}:` : "", values) : "";
  if (existing) return head.slice(0, existing.start) + xml + head.slice(existing.end);
  return head.slice(0, body.start) + xml + head.slice(body.start);
}

/**
 * A `w:background` saying `values` (`prefix`: the part's for WordprocessingML, with its colon).
 * @internal
 */
export function backgroundXml(prefix: string, values: Omit<PageBackgroundJSON, "ext">): string {
  let out = `<${prefix}background`;
  for (const name of ["color", "themeColor", "themeTint", "themeShade"] as const) {
    const value = values[name];
    if (value !== undefined) out += ` ${prefix}${name}="${escapeAttribute(value)}"`;
  }
  return `${out}/>`;
}
