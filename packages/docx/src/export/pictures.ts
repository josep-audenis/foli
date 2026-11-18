/**
 * Pictures back to DrawingML (10.8, ADR-0006). A picture read from a file is its `w:drawing`
 * as read, with only what the model changed written into it (size, alt text, title, the image's
 * relationship): unchanged, it comes back byte for byte. A new one is a fresh inline drawing.
 * Its image is the package's part when the resource names one there, else a new media part
 * whose bytes come from the resource's `data:` URL or the app (`ExportOptions.resource`).
 */

import type { FoliDocument, NodeJSON, ResourceJSON } from "@folijs/core";
import { A, R } from "../import/ooxml.js";
import { floatOf, PIC, WP } from "../import/pictures.js";
import type { DocxPackage } from "../package.js";
import { DocxError } from "../package.js";
import type { XmlElement } from "../xml.js";
import { ControlWriter } from "./controls.js";
import { same } from "./properties.js";
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

/** Every picture node of the document (body, comments and stories). */
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
  for (const story of Object.values(doc.stories ?? {})) visit(story.content.content);
  return out;
}

/** A `data:` URL's bytes (base64 or percent-encoded), or undefined when it is not one. */
function dataBytes(url: string, key: string): Uint8Array | undefined {
  const comma = url.indexOf(",");
  if (!url.startsWith("data:") || comma < 0) return undefined;
  const base64 = /;base64$/i.test(url.slice(0, comma));
  const body = url.slice(comma + 1);
  try {
    if (!base64) return new TextEncoder().encode(decodeURIComponent(body));
    const binary = atob(body.replace(/\s/g, ""));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch (error) {
    throw new DocxError(`The picture ${key} has a data: URL that cannot be read`, { cause: error });
  }
}

/**
 * Whether the package's part is the resource's image: the part it names, an image of the size
 * import recorded (a part of that name in another package is another image).
 */
function ownPart(resource: ResourceJSON, pkg: DocxPackage | undefined): boolean {
  const part = resource.part ? pkg?.part(`/${resource.part}`) : undefined;
  return !!part && part.contentType.startsWith("image/") && part.data.length === resource.size;
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
    if (ownPart(resource, pkg)) continue;
    const bytes =
      (resource.data ? dataBytes(resource.data, key) : undefined) ?? (await ask?.(key, resource));
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

/** `wp:docPr` ids (any prefix) in XML text. */
const docPrIds = (xml: string) =>
  [...xml.matchAll(/<(?:[\w.-]+:)?docPr\b[^>]*?\bid="(\d+)"/g)].map((m) => Number(m[1]));

/** The media parts pictures need, allocated as they are written, and the drawings' ids. */
export class Media {
  readonly added: { name: string; data: Uint8Array; contentType: string }[] = [];
  /** The document's content controls, written once across its parts. */
  readonly controls: ControlWriter;
  readonly #parts = new Map<string, string>();
  /** Ids drawings Foli does not write hold (opaque content, headers and footers). */
  readonly #reserved = new Set<number>();
  /** Ids the pictures written so far took. */
  readonly #claimed = new Set<number>();
  #nextId: number;

  constructor(
    readonly doc: FoliDocument,
    readonly pkg: DocxPackage | undefined,
    readonly bytes: ReadonlyMap<string, Uint8Array>,
    /** The parts rewritten from the model (their drawings are the document's). */
    rewritten: readonly string[] = [],
  ) {
    this.controls = new ControlWriter(doc.controls ?? {});
    // `wp:docPr` ids are unique in a document, across its parts: new ones above all of them.
    let max = 0;
    for (const attrs of picturesOf(doc))
      for (const id of docPrIds(String(attrs.ext ?? ""))) max = Math.max(max, id);
    const reserve = (xml: string) => {
      for (const id of docPrIds(xml)) {
        this.#reserved.add(id);
        max = Math.max(max, id);
      }
    };
    JSON.stringify([doc.content, doc.comments, doc.stories], (key, value) => {
      if (key === "xml" && typeof value === "string") reserve(value);
      return value;
    });
    const skip = new Set(rewritten.map((n) => n.toLowerCase()));
    for (const part of pkg?.parts ?? [])
      if (part.contentType.endsWith("+xml") && !skip.has(part.name.toLowerCase()))
        reserve(new TextDecoder().decode(part.data));
    this.#nextId = max + 1;
  }

  /** The part (absolute name) holding `key`'s image in the output package. */
  part(key: string): string {
    const known = this.#parts.get(key);
    if (known) return known;
    const resource = this.doc.resources?.[key] as ResourceJSON;
    let name: string;
    if (ownPart(resource, this.pkg)) name = `/${resource.part}`;
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

  /** Takes `id` for a drawing written as read; false when another drawing has it already. */
  claim(id: number | undefined): boolean {
    if (id === undefined || this.#reserved.has(id) || this.#claimed.has(id)) return false;
    this.#claimed.add(id);
    return true;
  }

  freshId(): number {
    while (this.#reserved.has(this.#nextId) || this.#claimed.has(this.#nextId)) this.#nextId++;
    this.#claimed.add(this.#nextId);
    return this.#nextId++;
  }
}

const WP14 = "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing";

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

const attrOf = (el: XmlElement | undefined, local: string, ns?: string) =>
  el?.attributes.find((x) => x.local === local && (ns ? x.ns === ns : !x.prefix));

/** The edits setting (or, undefined, removing) attribute `local` (`ns`: none for plain) of `el`. */
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
  const a = attrOf(el, local, ns);
  if (a) {
    if (value === undefined) edits.push({ from: a.start - 1, to: a.end, text: "" });
    else if (a.value !== value)
      edits.push({ from: a.valueStart, to: a.valueEnd, text: escapeAttribute(value) });
  } else if (value !== undefined) {
    const at = source[el.openEnd - 2] === "/" ? el.openEnd - 2 : el.openEnd - 1;
    edits.push({ from: at, to: at, text: ` ${qualified}="${escapeAttribute(value)}"` });
  }
}

/** A part's relationships as a picture's drawing needs them. */
export interface PictureRelations {
  /** The id relating image part `part` (`current` when it already does). */
  image(part: string, current: string | undefined): string;
  /** The part relationship `id` points to, if any. */
  target(id: string): string | undefined;
}

/** `relativeFrom` values Word reads, horizontal and vertical (the first is the default). */
const RELATIVE = {
  H: [
    "column",
    "margin",
    "page",
    "character",
    "leftMargin",
    "rightMargin",
    "insideMargin",
    "outsideMargin",
  ],
  V: [
    "paragraph",
    "margin",
    "page",
    "line",
    "topMargin",
    "bottomMargin",
    "insideMargin",
    "outsideMargin",
  ],
};
const ALIGN = {
  H: ["left", "right", "center", "inside", "outside"],
  V: ["top", "bottom", "center", "inside", "outside"],
};

/** A `wp:positionH`/`wp:positionV` for a float's position, values Word cannot read replaced. */
function positionXml(axis: "H" | "V", position: Json | undefined): string {
  const from = String(position?.relativeTo);
  const relativeTo = RELATIVE[axis].includes(from) ? from : RELATIVE[axis][0];
  const offset = position?.offset;
  const align = String(position?.align);
  const value =
    typeof offset !== "number" && ALIGN[axis].includes(align)
      ? `<wp:align>${align}</wp:align>`
      : `<wp:posOffset>${typeof offset === "number" ? offset : 0}</wp:posOffset>`;
  return `<wp:position${axis} relativeFrom="${relativeTo}">${value}</wp:position${axis}>`;
}

/** The `wp:wrap*` element for a float's wrapping. */
function wrapXml(float: Json): string {
  const side = ["bothSides", "left", "right", "largest"].includes(String(float.side))
    ? String(float.side)
    : "bothSides";
  switch (float.wrap) {
    case "topAndBottom":
      return "<wp:wrapTopAndBottom/>";
    case "behind":
    case "inFront":
      return "<wp:wrapNone/>";
    case "tight":
    case "through": {
      // The picture's rectangle as the wrap polygon (21600 is the full side).
      const tag = float.wrap === "tight" ? "wp:wrapTight" : "wp:wrapThrough";
      return (
        `<${tag} wrapText="${side}"><wp:wrapPolygon edited="0"><wp:start x="0" y="0"/>` +
        '<wp:lineTo x="0" y="21600"/><wp:lineTo x="21600" y="21600"/><wp:lineTo x="21600" y="0"/>' +
        `<wp:lineTo x="0" y="0"/></wp:wrapPolygon></${tag}>`
      );
    }
    default:
      return `<wp:wrapSquare wrapText="${side}"/>`;
  }
}

/**
 * The `w:drawing` for picture `attrs`, inline or floating (`wp:anchor`). From its `ext` with
 * only what the model changed from it written in (size, alt text, title), its image's
 * relationship, and a new id when another drawing of the document has its id; fresh when it
 * has none, when its position or wrapping changed, or when it was read in another part or
 * package and refers to other relationships (an SVG's PNG fallback, a click link) that mean
 * something else here.
 */
export function drawingXml(
  attrs: Json,
  relations: PictureRelations,
  namespaces: Namespaces,
  media: Media,
): string {
  const width = String(attrs.width);
  const height = String(attrs.height);
  const alt = (attrs.alt as string | null | undefined) ?? undefined;
  const title = (attrs.title as string | null | undefined) ?? undefined;
  const ext = typeof attrs.ext === "string" ? attrs.ext : undefined;
  const part = media.part(String(attrs.resource));
  const float = attrs.float && typeof attrs.float === "object" ? (attrs.float as Json) : undefined;
  if (ext) {
    const { element, source } = fragment(ext, namespaces);
    const anchor = kid(element, WP, "anchor");
    const inline = kid(element, WP, "inline") ?? anchor;
    // shortcut: a float changed from the file's is written fresh, losing what only its `ext`
    // holds (cropping, effects, z-order, lock, wrap polygon, an SVG part, a click link); edit
    // `wp:positionH`/`wp:wrap*` in place once a command changes floats.
    const sameFloat = same(anchor ? (floatOf(anchor) ?? false) : undefined, float);
    const blip = descendants(element, (e) => e.ns === A && e.local === "blip")[0];
    const current = attrOf(blip, "embed", R)?.value;
    // Read against this part: its image id still points to its image here.
    const here =
      current !== undefined && relations.target(current)?.toLowerCase() === part.toLowerCase();
    const others = descendants(element, () => true).some((e) =>
      e.attributes.some((a) => a.ns === R && !(e === blip && a.local === "embed")),
    );
    if (blip && inline && sameFloat && (here || !others)) {
      const edits: Edit[] = [];
      setAttr(source, blip, "embed", relations.image(part, current), edits, R, "r:embed");
      const extent = kid(inline, WP, "extent");
      // Only what the model changed: values the file holds twice may differ, and stay so.
      if (attrOf(extent, "cx")?.value !== width || attrOf(extent, "cy")?.value !== height) {
        setAttr(source, extent, "cx", width, edits);
        setAttr(source, extent, "cy", height, edits);
        const spPr = descendants(element, (e) => e.ns === PIC && e.local === "spPr")[0];
        const size = kid(kid(spPr, A, "xfrm"), A, "ext");
        setAttr(source, size, "cx", width, edits);
        setAttr(source, size, "cy", height, edits);
      }
      const docPr = kid(inline, WP, "docPr");
      const cNvPr = descendants(element, (e) => e.ns === PIC && e.local === "cNvPr")[0];
      for (const [local, value] of [
        ["descr", alt],
        ["title", title],
      ] as const) {
        if (attrOf(docPr, local)?.value === value) continue;
        setAttr(source, docPr, local, value, edits);
        setAttr(source, cNvPr, local, value, edits);
      }
      const id = attrOf(docPr, "id")?.value;
      if (!media.claim(id === undefined ? undefined : Number(id))) {
        // A copy of a drawing (pasted twice): its own ids, Word's anchor ids left to Word.
        const fresh = String(media.freshId());
        setAttr(source, docPr, "id", fresh, edits);
        setAttr(source, cNvPr, "id", fresh, edits);
        setAttr(source, inline, "anchorId", undefined, edits, WP14);
        setAttr(source, inline, "editId", undefined, edits, WP14);
      }
      let out = source;
      for (const edit of edits.sort((a, b) => b.from - a.from))
        out = out.slice(0, edit.from) + edit.text + out.slice(edit.to);
      const shift = edits.reduce((sum, e) => sum + e.text.length - (e.to - e.from), 0);
      return out.slice(element.start, element.end + shift);
    }
  }
  const embed = relations.image(part, undefined);
  const id = media.freshId();
  const descr = alt === undefined ? "" : ` descr="${escapeAttribute(alt)}"`;
  const titled = title === undefined ? "" : ` title="${escapeAttribute(title)}"`;
  const extent = `<wp:extent cx="${width}" cy="${height}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>`;
  const distance = (float?.distance ?? {}) as Json;
  const dist = (side: string) => (typeof distance[side] === "number" ? distance[side] : 0);
  const flag = (value: unknown) => (value === false ? "0" : "1");
  const tag = float ? "wp:anchor" : "wp:inline";
  // Namespaces declared where used: a part that has no pictures yet may not declare them.
  const open = float
    ? `<wp:anchor xmlns:wp="${WP}" distT="${dist("top")}" distB="${dist("bottom")}" ` +
      `distL="${dist("left")}" distR="${dist("right")}" simplePos="0" relativeHeight="251658240" ` +
      `behindDoc="${float.wrap === "behind" ? 1 : 0}" locked="0" ` +
      `layoutInCell="${flag(float.layoutInCell)}" allowOverlap="${flag(float.allowOverlap)}">` +
      `<wp:simplePos x="0" y="0"/>${positionXml("H", float.horizontal as Json)}` +
      `${positionXml("V", float.vertical as Json)}${extent}${wrapXml(float)}`
    : `<wp:inline xmlns:wp="${WP}" distT="0" distB="0" distL="0" distR="0">${extent}`;
  return (
    `<w:drawing>${open}` +
    `<wp:docPr id="${id}" name="Picture ${id}"${descr}${titled}/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${A}" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}"><pic:pic xmlns:pic="${PIC}">` +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"${descr}${titled}/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip xmlns:r="${R}" r:embed="${embed}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
    `</${tag}></w:drawing>`
  );
}
