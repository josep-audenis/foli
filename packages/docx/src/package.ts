/**
 * A `.docx` as an Open Packaging Conventions package (ECMA-376 Part 2): its parts, their
 * content types and the relationships between them. Read once; written back with every part it
 * was not asked to replace copied from the original file byte for byte.
 */

import { type ParseXmlOptions, parseXml, type XmlDocument, type XmlElement } from "./xml.js";
import {
  deflateEntry,
  inflateEntry,
  readZip,
  writeZip,
  type ZipEntry,
  type ZipLimits,
} from "./zip.js";

export interface DocxPart {
  /** The part name: `/word/document.xml`. */
  readonly name: string;
  /** Its content type from `[Content_Types].xml`; "" when the file declares none. */
  readonly contentType: string;
  /** The part's bytes, uncompressed. */
  readonly data: Uint8Array;
}

export interface Relationship {
  readonly id: string;
  /** The relationship type URI. */
  readonly type: string;
  /** As written in the relationships part. */
  readonly target: string;
  readonly external: boolean;
  /**
   * The part an internal target points to (resolved against its source), whether or not it
   * exists; none for a target that is a full URI.
   */
  readonly partName?: string;
}

export interface ReadPackageOptions extends ZipLimits, ParseXmlOptions {}

/** A file that is not a `.docx` package, or is damaged. */
export class DocxError extends Error {
  override name = "DocxError";
}

const CONTENT_TYPES = "/[Content_Types].xml";
const OFFICE_DOCUMENT = /\/officeDocument$/;
/** Documents, templates, and their macro-enabled kinds (ECMA-376 and MS-OFFMACRO). */
const WORD_MAIN =
  /^application\/vnd\.(openxmlformats-officedocument\.wordprocessingml\.(document|template)\.main\+xml|ms-word\.(document|template)\.macroEnabled(Template)?\.main\+xml)$/;

/** Reads a `.docx` (a package whose `officeDocument` is WordprocessingML). */
export async function readPackage(
  bytes: Uint8Array,
  options: ReadPackageOptions = {},
): Promise<DocxPackage> {
  const entries = readZip(bytes, options);
  // One entry at a time: memory holds the parts read so far, never several inflations at once.
  const data: Uint8Array[] = [];
  for (const entry of entries) data.push(await inflateEntry(entry));
  return new DocxPackage(entries, data, options);
}

export class DocxPackage {
  /** Every part in the zip's order (`[Content_Types].xml` and folder entries are not parts). */
  readonly parts: readonly DocxPart[];
  /** The main document part: the target of the package's `officeDocument` relationship. */
  readonly mainDocument: string;
  readonly #entries: readonly ZipEntry[];
  readonly #options: ParseXmlOptions;
  readonly #byName = new Map<string, DocxPart>();
  readonly #relationships = new Map<string, readonly Relationship[]>();
  readonly #xml = new Map<string, XmlDocument>();
  readonly #defaults: ReadonlyMap<string, string>;
  readonly #contentTypesText: string;

  /** @internal Use {@link readPackage}. */
  constructor(entries: readonly ZipEntry[], data: readonly Uint8Array[], options: ParseXmlOptions) {
    this.#entries = entries;
    this.#options = options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth };
    const index = entries.findIndex((e) => key(partName(e.name)) === key(CONTENT_TYPES));
    if (index === -1) throw new DocxError("Not a .docx: no [Content_Types].xml");
    const typesXml = xml(data[index] as Uint8Array, CONTENT_TYPES, this.#options);
    const types = contentTypes(typesXml.root);
    this.#defaults = types.defaults;
    this.#contentTypesText = typesXml.source;

    const parts: DocxPart[] = [];
    entries.forEach((entry, i) => {
      if (i === index || entry.name.endsWith("/")) return;
      const name = partName(entry.name);
      const contentType =
        types.overrides.get(key(name)) ?? types.defaults.get(extension(name)) ?? "";
      const part = { name, contentType, data: data[i] as Uint8Array };
      parts.push(part);
      this.#byName.set(key(name), part);
    });
    this.parts = parts;

    const main = this.relationships("/").find((r) => OFFICE_DOCUMENT.test(r.type) && !r.external);
    const part = main?.partName ? this.part(main.partName) : undefined;
    if (!part) throw new DocxError("Not a .docx: no main document part");
    if (!WORD_MAIN.test(part.contentType)) {
      throw new DocxError(`Not a .docx: the main part is ${part.contentType || "untyped"}`);
    }
    this.mainDocument = part.name;
  }

  /** The part named `name`, if any. Part names compare case-insensitively and percent-decoded. */
  part(name: string): DocxPart | undefined {
    return this.#byName.get(key(name));
  }

  /** The relationships whose source is the part `source` ("/" for the package itself). */
  relationships(source: string): readonly Relationship[] {
    const known = this.#relationships.get(key(source));
    if (known) return known;
    const relsName = relationshipsPart(source);
    const part = this.part(relsName);
    const list = part ? parseRelationships(this.xml(part.name).root, source, relsName) : [];
    this.#relationships.set(key(source), list);
    return list;
  }

  /** The part's text (UTF-8 or UTF-16 by its byte order mark), throwing on invalid bytes. */
  text(name: string): string {
    const part = this.part(name);
    if (!part) throw new DocxError(`No part ${name}`);
    // shortcut: the encoding and byte order mark are not reported; export (8.5) needs them to
    // re-encode a part it rewrites that was not BOM-less UTF-8 (Word writes only that).
    return text(part.data, part.name);
  }

  /** The part parsed as XML (once); every node keeps its offsets into the part's text. */
  xml(name: string): XmlDocument {
    const part = this.part(name);
    if (!part) throw new DocxError(`No part ${name}`);
    let doc = this.#xml.get(key(part.name));
    if (!doc) {
      doc = xml(part.data, part.name, this.#options);
      this.#xml.set(key(part.name), doc);
    }
    return doc;
  }

  /**
   * The package as a `.docx` file. Parts in `replace` (by part name) get the new bytes; parts in
   * `add` are new (their content type declared in `[Content_Types].xml` unless its defaults
   * already give it). Every other entry, `[Content_Types].xml` included when nothing is added,
   * is copied from the original file as it was stored. Entries keep their order; added ones
   * come last.
   */
  async write(
    replace: ReadonlyMap<string, Uint8Array> = new Map(),
    add: readonly NewPart[] = [],
  ): Promise<Uint8Array> {
    const pending = new Map<string, Uint8Array>();
    for (const [name, data] of replace) {
      const part = this.part(name);
      if (!part) throw new DocxError(`No part ${name} to replace`);
      pending.set(key(part.name), data);
    }
    const overrides: string[] = [];
    for (const part of add) {
      if (!part.name.startsWith("/") || part.name.endsWith("/"))
        throw new DocxError(`Not a part name: ${part.name}`);
      if (this.part(part.name) || add.filter((p) => key(p.name) === key(part.name)).length > 1) {
        throw new DocxError(`Part ${part.name} already exists`);
      }
      if (part.contentType && this.#defaults.get(extension(part.name)) !== part.contentType) {
        overrides.push(
          `<Override PartName="${escapeXml(part.name)}" ContentType="${escapeXml(part.contentType)}"/>`,
        );
      }
    }
    if (overrides.length) {
      const types = this.#contentTypesText;
      const close = types.lastIndexOf("</");
      pending.set(
        key(CONTENT_TYPES),
        new TextEncoder().encode(types.slice(0, close) + overrides.join("") + types.slice(close)),
      );
    }
    const entries: ZipEntry[] = [];
    for (const entry of this.#entries) {
      const data = pending.get(key(partName(entry.name)));
      entries.push(data ? await deflateEntry(entry.name, data, entry) : entry);
    }
    for (const part of add) entries.push(await deflateEntry(part.name.slice(1), part.data));
    return writeZip(entries);
  }
}

/** A part to add to a package. */
export interface NewPart {
  /** `/word/numbering.xml`. */
  readonly name: string;
  readonly data: Uint8Array;
  /** Declared unless the extension's default content type is already this one. */
  readonly contentType?: string;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** `word/document.xml` (zip) → `/word/document.xml` (part name). */
function partName(entryName: string): string {
  return `/${entryName}`;
}

/**
 * Part names are equivalent case-insensitively and with percent-encoding decoded (ECMA-376
 * Part 2, 6.2.2). `decodeURI` leaves encoded delimiters (`%2F`) encoded: never a new segment.
 */
function key(name: string): string {
  let decoded = name;
  try {
    decoded = decodeURI(name);
  } catch {}
  return decoded.toLowerCase();
}

function extension(name: string): string {
  const slash = name.lastIndexOf("/");
  const dot = name.lastIndexOf(".");
  return dot > slash ? name.slice(dot + 1).toLowerCase() : "";
}

function contentTypes(root: XmlElement): {
  defaults: Map<string, string>;
  overrides: Map<string, string>;
} {
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  if (root.local !== "Types") throw new DocxError("Not a .docx: [Content_Types].xml has no Types");
  for (const child of root.children) {
    if (child.kind !== "element") continue;
    const type = attribute(child, "ContentType");
    if (child.local === "Default") {
      defaults.set((attribute(child, "Extension") ?? "").toLowerCase(), type ?? "");
    } else if (child.local === "Override") {
      overrides.set(key(attribute(child, "PartName") ?? ""), type ?? "");
    }
  }
  return { defaults, overrides };
}

/** `/word/document.xml` → `/word/_rels/document.xml.rels`; `/` → `/_rels/.rels`. */
function relationshipsPart(source: string): string {
  const slash = source.lastIndexOf("/");
  return `${source.slice(0, slash)}/_rels/${source.slice(slash + 1)}.rels`;
}

function parseRelationships(root: XmlElement, source: string, relsName: string): Relationship[] {
  if (root.local !== "Relationships") throw new DocxError(`${relsName} has no Relationships`);
  const list: Relationship[] = [];
  for (const child of root.children) {
    if (child.kind !== "element" || child.local !== "Relationship") continue;
    const id = attribute(child, "Id");
    const type = attribute(child, "Type");
    const target = attribute(child, "Target");
    if (id === undefined || type === undefined || target === undefined) {
      throw new DocxError(`${relsName}: a relationship without Id, Type or Target`);
    }
    const external = attribute(child, "TargetMode") === "External";
    // A target with a scheme (`http:`, `file:`) is not a part, whatever its mode says.
    const uri = /^[a-z][a-z0-9+.-]*:/i.test(target);
    list.push(
      external || uri
        ? { id, type, target, external }
        : { id, type, target, external, partName: resolveTarget(source, target) },
    );
  }
  return list;
}

/** A relative target resolved against its source part's folder (RFC 3986 dot segments). */
function resolveTarget(source: string, target: string): string {
  const path = target.split("#")[0] as string;
  const base = path.startsWith("/") ? [] : source.split("/").slice(1, -1);
  for (const segment of path.split("/")) {
    if (segment === "..") base.pop();
    else if (segment !== "." && segment !== "") base.push(segment);
  }
  return `/${base.join("/")}`;
}

function attribute(element: XmlElement, local: string): string | undefined {
  return element.attributes.find((a) => a.local === local && a.ns === "")?.value;
}

function text(data: Uint8Array, name: string): string {
  const encoding =
    data[0] === 0xff && data[1] === 0xfe
      ? "utf-16le"
      : data[0] === 0xfe && data[1] === 0xff
        ? "utf-16be"
        : "utf-8";
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(data);
  } catch {
    throw new DocxError(`${name}: not valid ${encoding.toUpperCase()}`);
  }
}

function xml(data: Uint8Array, name: string, options: ParseXmlOptions): XmlDocument {
  const source = text(data, name);
  try {
    return parseXml(source, options);
  } catch (error) {
    // The XmlError (with its offset) stays reachable as the cause.
    throw new DocxError(`${name}: ${(error as Error).message}`, { cause: error });
  }
}
