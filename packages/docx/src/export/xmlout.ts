/** Writing XML: escaping, elements, and reading back the verbatim fragments the model keeps. */

import { W } from "../import/ooxml.js";
import { DocxError } from "../package.js";
import { parseXml, type XmlElement } from "../xml.js";

/**
 * Throws when `text` has a character XML 1.0 cannot hold (control characters other than tab
 * and line ends, lone surrogates, U+FFFE, U+FFFF): no file Word opens could carry it.
 */
export function checkCharacters(text: string, where: string): void {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    let bad = false;
    if (c < 0x20) bad = c !== 0x09 && c !== 0x0a && c !== 0x0d;
    else if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
      else bad = true;
    } else bad = (c >= 0xdc00 && c <= 0xdfff) || c === 0xfffe || c === 0xffff;
    if (bad) {
      throw new DocxError(
        `${where}: character U+${c.toString(16).toUpperCase().padStart(4, "0")} cannot be written to a .docx`,
      );
    }
  }
}

/** Character data: `&`, `<`, `>` escaped (characters XML cannot hold refused). */
export function escapeText(text: string): string {
  checkCharacters(text, "text");
  return text.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

/** An attribute value: also `"`, and tabs and line ends as references (XML normalizes them). */
export function escapeAttribute(value: string): string {
  checkCharacters(value, "attribute");
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
  /** The prefixes declared (`w`, `w14`…). */
  readonly prefixes: ReadonlySet<string>;
}

/** The namespaces Word declares on its parts, so content imported from Word fits a new part. */
const WORD_NAMESPACES: Record<string, string> = {
  wpc: "http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas",
  mc: "http://schemas.openxmlformats.org/markup-compatibility/2006",
  o: "urn:schemas-microsoft-com:office:office",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  m: "http://schemas.openxmlformats.org/officeDocument/2006/math",
  v: "urn:schemas-microsoft-com:vml",
  wp14: "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing",
  wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  w10: "urn:schemas-microsoft-com:office:word",
  w: W,
  w14: "http://schemas.microsoft.com/office/word/2010/wordml",
  w15: "http://schemas.microsoft.com/office/word/2012/wordml",
  w16cex: "http://schemas.microsoft.com/office/word/2018/wordml/cex",
  w16cid: "http://schemas.microsoft.com/office/word/2016/wordml/cid",
  w16: "http://schemas.microsoft.com/office/word/2018/wordml",
  w16du: "http://schemas.microsoft.com/office/word/2023/wordml/word16du",
  w16sdtdh: "http://schemas.microsoft.com/office/word/2020/wordml/sdtdatahash",
  w16se: "http://schemas.microsoft.com/office/word/2015/wordml/symex",
  wpg: "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup",
  wpi: "http://schemas.microsoft.com/office/word/2010/wordprocessingInk",
  wne: "http://schemas.microsoft.com/office/word/2006/wordml",
  wps: "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  pic: "http://schemas.openxmlformats.org/drawingml/2006/picture",
};

export const DEFAULT_NAMESPACES: Namespaces = {
  declarations: Object.entries(WORD_NAMESPACES)
    .map(([prefix, uri]) => `xmlns:${prefix}="${uri}"`)
    .join(" "),
  prefixes: new Set(Object.keys(WORD_NAMESPACES)),
};

/** Attributes of a new part's root: Word's namespaces, its extensions ignorable. */
export const NEW_ROOT_ATTRIBUTES = `${DEFAULT_NAMESPACES.declarations} mc:Ignorable="w14 w15 w16se w16cid w16 w16cex w16sdtdh w16du wp14"`;

export function namespacesOf(root: XmlElement, source: string): Namespaces {
  const declared = root.attributes.filter((a) => a.name === "xmlns" || a.prefix === "xmlns");
  if (!declared.length) return DEFAULT_NAMESPACES;
  return {
    declarations: declared.map((a) => source.slice(a.start, a.end)).join(" "),
    prefixes: new Set(declared.map((a) => (a.prefix === "xmlns" ? a.local : ""))),
  };
}

/**
 * A verbatim fragment (`ext`, `runExt`, an opaque node's XML) parsed in the part's namespaces:
 * exactly one element (named `expected` when given), with its offsets into the returned
 * source. Anything else could not be written into the part as well-formed XML: DocxError.
 */
export function fragment(
  xml: string,
  namespaces: Namespaces,
  expected?: string,
): { element: XmlElement; source: string } {
  const source = `<fragment ${namespaces.declarations}>${xml}</fragment>`;
  let doc: ReturnType<typeof parseXml>;
  try {
    doc = parseXml(source);
  } catch (error) {
    throw new DocxError(`Verbatim XML that does not fit the part: ${(error as Error).message}`, {
      cause: error,
    });
  }
  const children = doc.root.children.filter((c) => c.kind !== "text" || c.text.trim() !== "");
  const element = children[0];
  if (children.length !== 1 || element?.kind !== "element") {
    throw new DocxError("Verbatim XML must be exactly one element");
  }
  if (expected && (element.ns !== W || element.local !== expected)) {
    throw new DocxError(`Verbatim XML must be a w:${expected}, not ${element.name}`);
  }
  return { element, source };
}

/**
 * An element's `attributes` bag as written (` name="value"`…). A name the writer already
 * writes, or a prefix not declared in the part (nor by the bag itself), would make the element
 * ill-formed: DocxError.
 */
export function bagXml(
  bag: unknown,
  namespaces: Namespaces,
  written: readonly string[] = [],
): string {
  if (!bag || typeof bag !== "object") return "";
  const entries = Object.entries(bag as Record<string, string>);
  const own = new Set(
    entries.filter(([name]) => name.startsWith("xmlns:")).map(([name]) => name.slice(6)),
  );
  let out = "";
  for (const [name, value] of entries) {
    if (written.includes(name))
      throw new DocxError(`Attribute ${name} is written from the model, not from the bag`);
    const colon = name.indexOf(":");
    const prefix = colon === -1 ? "" : name.slice(0, colon);
    if (
      prefix &&
      prefix !== "xmlns" &&
      prefix !== "xml" &&
      !namespaces.prefixes.has(prefix) &&
      !own.has(prefix)
    ) {
      throw new DocxError(`Attribute ${name}: prefix ${prefix} is not declared in the part`);
    }
    out += ` ${name}="${escapeAttribute(value)}"`;
  }
  return out;
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
