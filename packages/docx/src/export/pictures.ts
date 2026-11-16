/**
 * Pictures back to DrawingML (10.8, ADR-0006). A picture read from a file is its `w:drawing`
 * as read, with only what the model changed written into it (size, alt text, title, the image's
 * relationship): unchanged, it comes back byte for byte. A new one is a fresh inline drawing.
 * Its image is the package's part when the resource names one there, else a new media part
 * whose bytes come from the resource's `data:` URL or the app (`ExportOptions.resource`).
 */
import type { FoliDocument, NodeJSON, ResourceJSON } from "@folijs/core";
import { A, R } from "../import/ooxml.js";
import { PIC, WP } from "../import/pictures.js";
import type { DocxPackage } from "../package.js";
import { DocxError } from "../package.js";
import type { XmlElement } from "../xml.js";
import { escapeAttribute, fragment, type Namespaces } from "./xmlout.js";

type Json = Record<string, unknown>;

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/svg+xml": "svg",
  "image/x-emf": "emf",
  "image/x-wmf": "wmf",
};

/** Every picture node of the document (body and comments). */
function picturesOf(doc: FoliDocument): Json[] {
  const out: Json[] = [];
  const visit = (nodes: readonly NodeJSON[] | undefined) => {
    for (const node of nodes ?? []) {
      if (node.type === "picture") out.push((node.attrs ?? {}) as Json);
      visit(node.content);
    }
  };
  visit(doc.content.content);
  for (const comment of doc.comments) visit(comment.content);
  return out;
}

/** A `data:` URL's bytes (base64 only), or undefined. */
function dataBytes(url: string): Uint8Array | undefined {
  const match = /^data:[^,;]*(?:;[^,;]*)*;base64,([A-Za-z0-9+/=\s]*)$/.exec(url);
  if (!match) return undefined;
  const binary = atob((match[1] as string).replace(/\s/g, ""));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** The bytes of each picture's image the package does not hold, before anything is written. */
export async function pictureBytes(
  doc: FoliDocument,
  pkg: DocxPackage | undefined,
  ask:
    | ((
        key: string,
        resource: ResourceJSON,
      ) => Promise<Uint8Array | undefined> | Uint8Array | undefined)
    | undefined,
): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const attrs of picturesOf(doc)) {
    const key = String(attrs.resource);
    if (out.has(key)) continue;
    const resource = doc.resources?.[key];
    if (!resource)
      throw new DocxError(`Picture resource ${key} is not in the document's resources`);
    if (resource.part && pkg?.part(`/${resource.part}`)) continue;
    const bytes =
      (resource.data ? dataBytes(resource.data) : undefined) ?? (await ask?.(key, resource));
    if (!bytes) {
      throw new DocxError(
        resource.part
          ? `The document refers to a part of its original package (the picture ${key}): export it with that package, or give its bytes (a data: URL, ExportOptions.resource)`
          : `No bytes for the picture ${key}: give them as a data: URL or through ExportOptions.resource`,
      );
    }
    out.set(key, bytes);
  }
  return out;
}

/** The media parts pictures need, allocated as they are written (one per resource). */
export class Media {
  readonly added: { name: string; data: Uint8Array; contentType: string }[] = [];
  readonly #parts = new Map<string, string>();
  #nextId: number;

  constructor(
    readonly doc: FoliDocument,
    readonly pkg: DocxPackage | undefined,
    readonly bytes: ReadonlyMap<string, Uint8Array>,
  ) {
    // `wp:docPr` ids are unique in a document: new ones above every one written already.
    let max = 0;
    for (const attrs of picturesOf(doc)) {
      for (const m of String(attrs.ext ?? "").matchAll(/<wp:docPr\b[^>]*?\bid="(\d+)"/g))
        max = Math.max(max, Number(m[1]));
    }
    this.#nextId = max + 1;
  }

  /** The part (absolute name) holding `key`'s image in the output package. */
  part(key: string): string {
    const known = this.#parts.get(key);
    if (known) return known;
    const resource = this.doc.resources?.[key] as ResourceJSON;
    let name: string;
    if (resource.part && this.pkg?.part(`/${resource.part}`)) name = `/${resource.part}`;
    else {
      const extension = EXTENSIONS[resource.contentType] ?? "bin";
      const taken = (n: string) =>
        this.pkg?.part(n) !== undefined || this.added.some((p) => p.name === n);
      let i = this.added.length + 1;
      while (taken(`/word/media/foli-image${i}.${extension}`)) i++;
      name = `/word/media/foli-image${i}.${extension}`;
      this.added.push({
        name,
        data: this.bytes.get(key) as Uint8Array,
        contentType: resource.contentType,
      });
    }
    this.#parts.set(key, name);
    return name;
  }

  freshId(): number {
    return this.#nextId++;
  }
}

const kid = (el: XmlElement | undefined, ns: string, local: string) =>
  el?.children.find(
    (c): c is XmlElement => c.kind === "element" && c.ns === ns && c.local === local,
  );

function descendants(el: XmlElement, test: (e: XmlElement) => boolean, out: XmlElement[] = []) {
  for (const c of el.children) {
    if (c.kind !== "element") continue;
    if (test(c)) out.push(c);
    descendants(c, test, out);
  }
  return out;
}

/** Edits to a source string: replace `[from, to)` with `text`. */
type Edit = { from: number; to: number; text: string };

/** The edits setting (or, undefined, removing) attribute `name` (`ns`: none for plain) of `el`. */
function setAttr(
  source: string,
  el: XmlElement | undefined,
  local: string,
  value: string | undefined,
  edits: Edit[],
  ns?: string,
  qualified = local,
): void {
  if (!el) return;
  const a = el.attributes.find((x) => x.local === local && (ns ? x.ns === ns : !x.prefix));
  if (a) {
    if (value === undefined) edits.push({ from: a.start - 1, to: a.end, text: "" });
    else if (a.value !== value)
      edits.push({ from: a.valueStart, to: a.valueEnd, text: escapeAttribute(value) });
  } else if (value !== undefined) {
    const at = source[el.openEnd - 2] === "/" ? el.openEnd - 2 : el.openEnd - 1;
    edits.push({ from: at, to: at, text: ` ${qualified}="${escapeAttribute(value)}"` });
  }
}

/**
 * The `w:drawing` for picture `attrs`, its image related as `embedFor` says (given the id the
 * drawing has, kept when it still points to that image). From its `ext` with the
 * model's values written in; fresh when it has none, or when the drawing refers to other
 * relationships the part does not have (an SVG's PNG fallback from another package).
 */
export function drawingXml(
  attrs: Json,
  embedFor: (current: string | undefined) => string,
  namespaces: Namespaces,
  known: (id: string) => boolean,
  media: Media,
): string {
  const width = String(attrs.width);
  const height = String(attrs.height);
  const alt = (attrs.alt as string | null | undefined) ?? undefined;
  const title = (attrs.title as string | null | undefined) ?? undefined;
  const ext = typeof attrs.ext === "string" ? attrs.ext : undefined;
  if (ext) {
    const { element, source } = fragment(ext, namespaces);
    const blip = descendants(element, (e) => e.ns === A && e.local === "blip")[0];
    const others = descendants(element, () => true)
      .flatMap((e) => e.attributes.map((a) => ({ e, a })))
      .filter(({ e, a }) => a.ns === R && !(e === blip && a.local === "embed"));
    if (blip && others.every(({ a }) => known(a.value))) {
      const embed = embedFor(blip.attributes.find((a) => a.ns === R && a.local === "embed")?.value);
      const edits: Edit[] = [];
      const inline = kid(element, WP, "inline");
      setAttr(source, blip, "embed", embed, edits, R, "r:embed");
      const extent = kid(inline, WP, "extent");
      setAttr(source, extent, "cx", width, edits);
      setAttr(source, extent, "cy", height, edits);
      const spPr = descendants(element, (e) => e.ns === PIC && e.local === "spPr")[0];
      const size = descendants(spPr ?? element, (e) => e.ns === A && e.local === "ext")[0];
      if (spPr && size) {
        setAttr(source, size, "cx", width, edits);
        setAttr(source, size, "cy", height, edits);
      }
      const cNvPr = descendants(element, (e) => e.ns === PIC && e.local === "cNvPr")[0];
      for (const target of [kid(inline, WP, "docPr"), cNvPr]) {
        setAttr(source, target, "descr", alt, edits);
        setAttr(source, target, "title", title, edits);
      }
      let out = source;
      for (const edit of edits.sort((a, b) => b.from - a.from))
        out = out.slice(0, edit.from) + edit.text + out.slice(edit.to);
      const shift = edits.reduce((sum, e) => sum + e.text.length - (e.to - e.from), 0);
      return out.slice(element.start, element.end + shift);
    }
  }
  const embed = embedFor(undefined);
  const id = media.freshId();
  const descr = alt === undefined ? "" : ` descr="${escapeAttribute(alt)}"`;
  const titled = title === undefined ? "" : ` title="${escapeAttribute(title)}"`;
  // Namespaces declared where used: a part that has no pictures yet may not declare them.
  return (
    `<w:drawing><wp:inline xmlns:wp="${WP}" distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${width}" cy="${height}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${id}" name="Picture ${id}"${descr}${titled}/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${A}" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}"><pic:pic xmlns:pic="${PIC}">` +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"${descr}${titled}/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip xmlns:r="${R}" r:embed="${embed}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
    "</wp:inline></w:drawing>"
  );
}
