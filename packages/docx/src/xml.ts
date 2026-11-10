/**
 * An XML reader that keeps the exact source text: every node records where it is in the source
 * string, so anything the importer does not understand is written back as the very characters
 * it was read from (`source.slice(node.start, node.end)`), never re-serialized.
 *
 * XML 1.0 with namespaces, as OOXML uses it. No DTD (OOXML forbids one, ECMA-376 Part 2), so
 * the only entities are the five predefined ones and character references.
 */

export interface XmlName {
  /** As written: `w:p`. */
  readonly name: string;
  /** `w`, or "" without a prefix. */
  readonly prefix: string;
  /** `p`. */
  readonly local: string;
  /** The namespace URI the prefix is bound to; "" for none (an unprefixed attribute, say). */
  readonly ns: string;
}

export interface XmlAttribute extends XmlName {
  /** The value with references decoded and whitespace normalized, as XML defines it. */
  readonly value: string;
  /** From the name to the closing quote. */
  readonly start: number;
  readonly end: number;
}

export interface XmlElement extends XmlName {
  readonly kind: "element";
  readonly attributes: readonly XmlAttribute[];
  readonly children: readonly XmlNode[];
  /** `<` of the start tag. */
  readonly start: number;
  /** Just after the start tag's `>`. */
  readonly openEnd: number;
  /** `<` of the end tag; `openEnd` for an empty-element tag. */
  readonly closeStart: number;
  /** Just after the end tag (or the empty-element tag). */
  readonly end: number;
}

export interface XmlText {
  readonly kind: "text";
  /** Character data with references decoded and line ends normalized. */
  readonly text: string;
  /** A `<![CDATA[...]]>` section. */
  readonly cdata: boolean;
  readonly start: number;
  readonly end: number;
}

export interface XmlOther {
  /** `<?xml ...?>`, `<?target ...?>`, `<!-- ... -->`. */
  readonly kind: "declaration" | "instruction" | "comment";
  readonly start: number;
  readonly end: number;
}

export type XmlNode = XmlElement | XmlText | XmlOther;

export interface XmlDocument {
  readonly source: string;
  /** Everything at the top level in order: declaration, comments, whitespace, the root. */
  readonly children: readonly XmlNode[];
  readonly root: XmlElement;
}

/** Source that is not well-formed XML; `offset` is where in the source. */
export class XmlError extends Error {
  override name = "XmlError";
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(`${message} (at ${offset})`);
  }
}

const XML_NS = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NS = "http://www.w3.org/2000/xmlns/";
const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

interface Open {
  readonly name: string;
  readonly start: number;
  readonly children: XmlNode[];
  readonly scope: ReadonlyMap<string, string>;
  readonly element: Omit<XmlElement, "closeStart" | "end" | "children">;
}

const ROOT_SCOPE: ReadonlyMap<string, string> = new Map([
  ["xml", XML_NS],
  ["xmlns", XMLNS_NS],
]);

/** Parses `source`; throws {@link XmlError} where it is not well-formed. */
export function parseXml(source: string): XmlDocument {
  const top: XmlNode[] = [];
  const stack: Open[] = [];
  let root: XmlElement | undefined;
  let at = 0;
  const length = source.length;

  const siblings = (): XmlNode[] => stack[stack.length - 1]?.children ?? top;

  while (at < length) {
    const lt = source.indexOf("<", at);
    const textEnd = lt === -1 ? length : lt;
    if (textEnd > at) {
      const raw = source.slice(at, textEnd);
      if (stack.length === 0) {
        if (!/^[ \t\r\n]*$/.test(raw)) throw new XmlError("Text outside the root element", at);
      }
      siblings().push({
        kind: "text",
        text: decode(raw, false, at),
        cdata: false,
        start: at,
        end: textEnd,
      });
      at = textEnd;
      continue;
    }

    if (source.startsWith("<!--", at)) {
      const close = source.indexOf("-->", at + 4);
      if (close === -1) throw new XmlError("Unclosed comment", at);
      siblings().push({ kind: "comment", start: at, end: close + 3 });
      at = close + 3;
    } else if (source.startsWith("<![CDATA[", at)) {
      if (stack.length === 0) throw new XmlError("CDATA outside the root element", at);
      const close = source.indexOf("]]>", at + 9);
      if (close === -1) throw new XmlError("Unclosed CDATA section", at);
      siblings().push({
        kind: "text",
        text: source.slice(at + 9, close),
        cdata: true,
        start: at,
        end: close + 3,
      });
      at = close + 3;
    } else if (source.startsWith("<!", at)) {
      throw new XmlError("Document type declarations are not allowed", at);
    } else if (source.startsWith("<?", at)) {
      const close = source.indexOf("?>", at + 2);
      if (close === -1) throw new XmlError("Unclosed processing instruction", at);
      const target = /^[^\s?]*/.exec(source.slice(at + 2, close))?.[0] ?? "";
      if (target === "") throw new XmlError("Processing instruction without a target", at);
      const declaration = target.toLowerCase() === "xml";
      if (declaration && (at !== 0 || target !== "xml")) {
        throw new XmlError("XML declaration not at the start", at);
      }
      siblings().push({
        kind: declaration ? "declaration" : "instruction",
        start: at,
        end: close + 2,
      });
      at = close + 2;
    } else if (source.startsWith("</", at)) {
      const nameEnd = scanName(source, at + 2);
      const name = source.slice(at + 2, nameEnd);
      const close = skipSpace(source, nameEnd);
      if (source[close] !== ">") throw new XmlError("Malformed end tag", at);
      const open = stack.pop();
      if (!open) throw new XmlError(`End tag </${name}> without a start tag`, at);
      if (open.name !== name)
        throw new XmlError(`End tag </${name}> does not match <${open.name}>`, at);
      finish(
        { ...open.element, children: open.children, closeStart: at, end: close + 1 },
        open.start,
      );
      at = close + 1;
    } else {
      at = startTag(at);
    }
  }
  const unclosed = stack[stack.length - 1];
  if (unclosed) throw new XmlError(`Unclosed element <${unclosed.name}>`, unclosed.start);
  if (!root) throw new XmlError("No root element", 0);
  return { source, children: top, root };

  function finish(element: XmlElement, start: number): void {
    if (stack.length === 0) {
      if (root) throw new XmlError("More than one root element", start);
      root = element;
    }
    siblings().push(element);
  }

  /** Reads a start tag at `start` (`<`); returns the offset after it. */
  function startTag(start: number): number {
    const nameEnd = scanName(source, start + 1);
    const name = source.slice(start + 1, nameEnd);
    if (name === "") throw new XmlError("Malformed start tag", start);
    const raw: { name: string; value: string; start: number; end: number }[] = [];
    let at = nameEnd;
    let empty = false;
    for (;;) {
      const next = skipSpace(source, at);
      if (source[next] === ">") {
        at = next + 1;
        break;
      }
      if (source.startsWith("/>", next)) {
        at = next + 2;
        empty = true;
        break;
      }
      if (next === at) throw new XmlError(`Malformed start tag <${name}>`, next);
      const attrEnd = scanName(source, next);
      const attrName = source.slice(next, attrEnd);
      if (attrName === "") throw new XmlError(`Malformed attribute in <${name}>`, next);
      const eq = skipSpace(source, attrEnd);
      if (source[eq] !== "=") throw new XmlError(`Attribute ${attrName} without a value`, next);
      const open = skipSpace(source, eq + 1);
      const quote = source[open];
      if (quote !== '"' && quote !== "'")
        throw new XmlError(`Unquoted attribute ${attrName}`, open);
      const close = source.indexOf(quote, open + 1);
      if (close === -1) throw new XmlError(`Unclosed attribute ${attrName}`, open);
      const value = source.slice(open + 1, close);
      if (value.includes("<")) throw new XmlError(`"<" in attribute ${attrName}`, open);
      if (raw.some((a) => a.name === attrName))
        throw new XmlError(`Duplicate attribute ${attrName}`, next);
      raw.push({
        name: attrName,
        value: decode(value, true, open + 1),
        start: next,
        end: close + 1,
      });
      at = close + 1;
    }

    const parentScope = stack[stack.length - 1]?.scope ?? ROOT_SCOPE;
    let scope = parentScope;
    for (const a of raw) {
      const declared =
        a.name === "xmlns" ? "" : a.name.startsWith("xmlns:") ? a.name.slice(6) : undefined;
      if (declared === undefined) continue;
      if (scope === parentScope) scope = new Map(parentScope);
      (scope as Map<string, string>).set(declared, a.value);
    }
    const attributes = raw.map((a) => {
      const qualified = splitName(a.name, a.start);
      const ns =
        a.name === "xmlns" || qualified.prefix === "xmlns"
          ? XMLNS_NS
          : qualified.prefix === ""
            ? ""
            : resolve(scope, qualified.prefix, a.start);
      return { ...qualified, ns, value: a.value, start: a.start, end: a.end };
    });
    for (let i = 0; i < attributes.length; i++) {
      const a = attributes[i] as XmlAttribute;
      if (a.ns === "") continue;
      for (let j = 0; j < i; j++) {
        const b = attributes[j] as XmlAttribute;
        if (b.ns === a.ns && b.local === a.local)
          throw new XmlError(`Duplicate attribute ${a.name}`, a.start);
      }
    }
    const qualified = splitName(name, start);
    const element = {
      kind: "element" as const,
      ...qualified,
      ns: resolve(scope, qualified.prefix, start),
      attributes,
      start,
      openEnd: at,
    };
    if (empty) {
      finish({ ...element, children: [], closeStart: at, end: at }, start);
    } else {
      stack.push({ name, start, children: [], scope, element });
    }
    return at;
  }
}

function splitName(name: string, at: number): { name: string; prefix: string; local: string } {
  const colon = name.indexOf(":");
  if (colon === -1) return { name, prefix: "", local: name };
  if (colon === 0 || colon === name.length - 1 || name.indexOf(":", colon + 1) !== -1) {
    throw new XmlError(`Malformed qualified name ${name}`, at);
  }
  return { name, prefix: name.slice(0, colon), local: name.slice(colon + 1) };
}

function resolve(scope: ReadonlyMap<string, string>, prefix: string, at: number): string {
  const ns = scope.get(prefix);
  if (ns === undefined) {
    if (prefix === "") return "";
    throw new XmlError(`Unbound namespace prefix ${prefix}`, at);
  }
  if (ns === "" && prefix !== "") throw new XmlError(`Unbound namespace prefix ${prefix}`, at);
  return ns;
}

/** The end of the name starting at `at` (lenient: anything but delimiters). */
function scanName(source: string, at: number): number {
  let i = at;
  while (i < source.length) {
    const c = source.charCodeAt(i);
    // whitespace / > = < " ' & ? !
    if (
      c === 0x20 ||
      c === 0x09 ||
      c === 0x0a ||
      c === 0x0d ||
      c === 0x2f ||
      c === 0x3e ||
      c === 0x3d ||
      c === 0x3c ||
      c === 0x22 ||
      c === 0x27 ||
      c === 0x26 ||
      c === 0x3f ||
      c === 0x21
    ) {
      break;
    }
    i++;
  }
  return i;
}

function skipSpace(source: string, at: number): number {
  let i = at;
  while (i < source.length) {
    const c = source.charCodeAt(i);
    if (c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) break;
    i++;
  }
  return i;
}

/**
 * Decodes references and normalizes line ends (`\r\n` and `\r` to `\n`); in an attribute value
 * literal tabs and line ends become spaces (references to them stay).
 */
function decode(raw: string, attribute: boolean, offset: number): string {
  if (!raw.includes("&") && !raw.includes("\r") && !(attribute && /[\t\n]/.test(raw))) return raw;
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const c = raw[i] as string;
    if (c === "&") {
      const semi = raw.indexOf(";", i + 1);
      if (semi === -1) throw new XmlError('"&" without a reference', offset + i);
      out += reference(raw.slice(i + 1, semi), offset + i);
      i = semi + 1;
    } else if (c === "\r") {
      out += attribute ? " " : "\n";
      i += raw[i + 1] === "\n" ? 2 : 1;
    } else {
      out += attribute && (c === "\t" || c === "\n") ? " " : c;
      i++;
    }
  }
  return out;
}

function reference(name: string, at: number): string {
  const entity = ENTITIES[name];
  if (entity !== undefined) return entity;
  const code = /^#x[0-9a-fA-F]+$/.test(name)
    ? Number.parseInt(name.slice(2), 16)
    : /^#[0-9]+$/.test(name)
      ? Number.parseInt(name.slice(1), 10)
      : -1;
  if (code === -1) throw new XmlError(`Unknown entity &${name};`, at);
  const legal =
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff);
  if (!legal) throw new XmlError(`Character reference &${name}; to an illegal character`, at);
  return String.fromCodePoint(code);
}
