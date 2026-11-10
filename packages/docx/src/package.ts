/**
 * A `.docx` as an Open Packaging Conventions package (ECMA-376 Part 2): its parts, their
 * content types and the relationships between them. Read once; written back with every part it
 * was not asked to replace copied from the original file byte for byte.
 */

import { parseXml, type XmlDocument, type XmlElement } from "./xml.js";
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
  /** The part an internal target points to (resolved against its source), whether or not it exists. */
  readonly partName?: string;
}

export interface ReadPackageOptions extends ZipLimits {}

/** A file that is not a `.docx` package, or is damaged. */
export class DocxError extends Error {
  override name = "DocxError";
}

const CONTENT_TYPES = "/[Content_Types].xml";
const OFFICE_DOCUMENT = /\/officeDocument$/;

/** Reads a `.docx` (or any OPC package with an `officeDocument` relationship). */
export async function readPackage(
  bytes: Uint8Array,
  options: ReadPackageOptions = {},
): Promise<DocxPackage> {
  const entries = readZip(bytes, options);
  const data = await Promise.all(entries.map(inflateEntry));
  return new DocxPackage(entries, data);
}

export class DocxPackage {
  /** Every part in the zip's order (`[Content_Types].xml` and folder entries are not parts). */
  readonly parts: readonly DocxPart[];
  /** The main document part: the target of the package's `officeDocument` relationship. */
  readonly mainDocument: string;
  readonly #entries: readonly ZipEntry[];
  readonly #byName = new Map<string, DocxPart>();
  readonly #relationships = new Map<string, readonly Relationship[]>();

  /** @internal Use {@link readPackage}. */
  constructor(entries: readonly ZipEntry[], data: readonly Uint8Array[]) {
    this.#entries = entries;
    const index = entries.findIndex(
      (e) => partName(e.name).toLowerCase() === CONTENT_TYPES.toLowerCase(),
    );
    if (index === -1) throw new DocxError("Not a .docx: no [Content_Types].xml");
    const types = contentTypes(xml(data[index] as Uint8Array, CONTENT_TYPES).root);

    const parts: DocxPart[] = [];
    entries.forEach((entry, i) => {
      if (i === index || entry.name.endsWith("/")) return;
      const name = partName(entry.name);
      const contentType =
        types.overrides.get(name.toLowerCase()) ?? types.defaults.get(extension(name)) ?? "";
      const part = { name, contentType, data: data[i] as Uint8Array };
      parts.push(part);
      this.#byName.set(name.toLowerCase(), part);
    });
    this.parts = parts;

    const main = this.relationships("/").find((r) => OFFICE_DOCUMENT.test(r.type) && !r.external);
    if (!main?.partName || !this.part(main.partName)) {
      throw new DocxError("Not a .docx: no main document part");
    }
    this.mainDocument = (this.part(main.partName) as DocxPart).name;
  }

  /** The part named `name` (part names compare case-insensitively), if any. */
  part(name: string): DocxPart | undefined {
    const key = name.toLowerCase();
    return this.#byName.get(key) ?? this.#byName.get(safeDecode(key));
  }

  /** The relationships whose source is the part `source` ("/" for the package itself). */
  relationships(source: string): readonly Relationship[] {
    const known = this.#relationships.get(source.toLowerCase());
    if (known) return known;
    const relsName = relationshipsPart(source);
    const part = this.part(relsName);
    const list = part ? parseRelationships(this.xml(part.name).root, source, relsName) : [];
    this.#relationships.set(source.toLowerCase(), list);
    return list;
  }

  /** The part's text (UTF-8 or UTF-16 by its byte order mark), throwing on invalid bytes. */
  text(name: string): string {
    const part = this.part(name);
    if (!part) throw new DocxError(`No part ${name}`);
    return text(part.data, part.name);
  }

  /** The part parsed as XML; every node keeps its offsets into the part's text. */
  xml(name: string): XmlDocument {
    const part = this.part(name);
    if (!part) throw new DocxError(`No part ${name}`);
    return xml(part.data, part.name);
  }

  /**
   * The package as a `.docx` file. Parts in `replace` (by part name) get the new bytes; every
   * other entry, `[Content_Types].xml` included, is copied from the original file as it was
   * stored. Entries keep their order.
   */
  async write(replace: ReadonlyMap<string, Uint8Array> = new Map()): Promise<Uint8Array> {
    const pending = new Map<string, Uint8Array>();
    for (const [name, data] of replace) {
      const part = this.part(name);
      // shortcut: replaces existing parts only; adding and removing parts (with their content
      // types and relationships) comes with export (8.5).
      if (!part) throw new DocxError(`No part ${name} to replace`);
      pending.set(part.name, data);
    }
    const entries = await Promise.all(
      this.#entries.map((entry) => {
        const data = pending.get(partName(entry.name));
        return data ? deflateEntry(entry.name, data, entry) : entry;
      }),
    );
    return writeZip(entries);
  }
}

/** `word/document.xml` (zip) → `/word/document.xml` (part name). */
function partName(entryName: string): string {
  return `/${entryName}`;
}

function extension(name: string): string {
  const slash = name.lastIndexOf("/");
  const dot = name.lastIndexOf(".");
  return dot > slash ? name.slice(dot + 1).toLowerCase() : "";
}

function safeDecode(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
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
      overrides.set((attribute(child, "PartName") ?? "").toLowerCase(), type ?? "");
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
    list.push(
      external
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

function xml(data: Uint8Array, name: string): XmlDocument {
  try {
    return parseXml(text(data, name));
  } catch (error) {
    if (error instanceof DocxError) throw error;
    throw new DocxError(`${name}: ${(error as Error).message}`);
  }
}
