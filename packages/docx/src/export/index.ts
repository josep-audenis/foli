/**
 * Schema v3 to `.docx` (ADR-0005): the parts the editor owns are written from the document
 * (`document.xml`, `styles.xml`, `numbering.xml`, `comments.xml`, `commentsExtended.xml` and
 * the relationships new hyperlinks need); every other part is copied from the original package
 * byte for byte. Without a package, a new one is made.
 */

import {
  type FoliDocument,
  type NodeJSON,
  parseDocument,
  type ResourceJSON,
  type SectionJSON,
} from "@folijs/core";
import { child, REL } from "../import/ooxml.js";
import { DocxError, type DocxPackage, type NewPart } from "../package.js";
import { newSettingsXml, withTrackRevisions } from "../settings.js";
import { deflateEntry, writeZip } from "../zip.js";
import { blocksXml, type WriteContext } from "./content.js";
import {
  commentsExtendedXml,
  commentsXml,
  numberingXml,
  type OriginalPart,
  stylesXml,
} from "./parts.js";
import { drawingXml, Media, pictureBytes } from "./pictures.js";
import { sectionXml } from "./properties.js";
import {
  DEFAULT_NAMESPACES,
  escapeAttribute,
  type Namespaces,
  NEW_ROOT_ATTRIBUTES,
  namespacesOf,
} from "./xmlout.js";

const CT = {
  main: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  styles: "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
  numbering: "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml",
  comments: "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml",
  commentsExtended:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml",
  settings: "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml",
  rels: "application/vnd.openxmlformats-package.relationships+xml",
};

const encoder = new TextEncoder();

/** New relationships of a source part (hyperlink targets), allocated as content is written. */
class Relationships {
  readonly added: { id: string; type: string; target: string; external: boolean }[] = [];
  readonly #ids: Set<string>;
  readonly #byTarget = new Map<string, string>();
  readonly #existing: ReadonlyMap<
    string,
    { type: string; target: string; external: boolean; partName?: string }
  >;
  /** The part each internal relationship points to (resolved, as the package resolves it). */
  readonly #parts = new Map<string, string>();

  constructor(
    existing: readonly {
      id: string;
      type: string;
      target: string;
      external: boolean;
      partName?: string;
    }[],
  ) {
    this.#existing = new Map(existing.map((r) => [r.id, r]));
    for (const r of existing) if (!r.external && r.partName) this.#parts.set(r.id, r.partName);
    this.#ids = new Set(existing.map((r) => r.id));
    for (const r of existing)
      if (r.type === REL.hyperlink && r.external) this.#byTarget.set(r.target, r.id);
  }

  /** The part relationship `id` points to (one it had, or one added), if internal. */
  target(id: string): string | undefined {
    return this.#parts.get(id);
  }

  /**
   * The relationship to image part `part` (absolute; `target` as this part refers to it):
   * `current` when it is one, else a known or new one. Compared by part, not by the target's
   * text (`/word/media/x.png`, `./media/x.png` and `media/x.png` are one part).
   */
  image(part: string, target: string, current: string | undefined): string {
    const isImage = (id: string) => {
      const r = this.#existing.get(id) ?? this.added.find((a) => a.id === id);
      return r?.type === REL_IMAGE && this.#parts.get(id)?.toLowerCase() === part.toLowerCase();
    };
    if (current !== undefined && isImage(current)) return current;
    for (const id of this.#parts.keys()) if (isImage(id)) return id;
    const id = this.add(REL_IMAGE, target, false);
    this.#parts.set(id, part);
    return id;
  }

  hyperlink(href: string, id: string | undefined): string {
    const own = id === undefined ? undefined : this.#existing.get(id);
    if (own && own.type === REL.hyperlink && own.target === href) return id as string;
    const known = this.#byTarget.get(href);
    if (known) return known;
    return this.add(REL.hyperlink, href, true);
  }

  add(type: string, target: string, external: boolean): string {
    let n = this.#ids.size + 1;
    while (this.#ids.has(`rId${n}`)) n++;
    const id = `rId${n}`;
    this.#ids.add(id);
    this.added.push({ id, type, target, external });
    if (type === REL.hyperlink && external) this.#byTarget.set(target, id);
    return id;
  }

  /** The relationships part with the added ones (`original` its text, if it exists). */
  xml(original: string | undefined): string {
    const entries = this.added
      .map(
        (r) =>
          `<Relationship Id="${r.id}" Type="${escapeAttribute(r.type)}" Target="${escapeAttribute(r.target)}"${r.external ? ' TargetMode="External"' : ""}/>`,
      )
      .join("");
    if (original === undefined) {
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries}</Relationships>`;
    }
    const close = original.lastIndexOf("</Relationships>");
    if (close === -1) return original.replace(/\/>\s*$/, `>${entries}</Relationships>`);
    return original.slice(0, close) + entries + original.slice(close);
  }
}

const REL_IMAGE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

function contextFor(
  namespaces: Namespaces,
  relationships: Relationships,
  media: Media,
  source: string,
): WriteContext {
  return {
    namespaces,
    hyperlink: (href, id) => relationships.hyperlink(href, id),
    picture: (attrs) =>
      drawingXml(
        attrs,
        {
          image: (part, current) => relationships.image(part, relative(source, part), current),
          target: (id) => relationships.target(id),
        },
        namespaces,
        media,
      ),
  };
}

/** `/word/_rels/document.xml.rels` for `/word/document.xml`. */
function relationshipsPartName(source: string): string {
  const slash = source.lastIndexOf("/");
  return `${source.slice(0, slash)}/_rels/${source.slice(slash + 1)}.rels`;
}

/** A part path relative to the main document's folder (`/word/styles.xml` → `styles.xml`). */
function relative(from: string, to: string): string {
  const folder = from.slice(0, from.lastIndexOf("/") + 1);
  return to.startsWith(folder) ? to.slice(folder.length) : to;
}

export interface ExportOptions {
  /**
   * Whether Word records edits as tracked changes (`w:trackRevisions`). Left out: as the
   * original package has it (off in a new one).
   */
  trackRevisions?: boolean;
  /**
   * The bytes of a picture's image the package does not hold and its resource gives no `data:`
   * URL for (an app's upload, by its URL). Undefined: the export fails, never drops it.
   */
  resource?: (
    key: string,
    resource: ResourceJSON,
  ) => Promise<Uint8Array | undefined> | Uint8Array | undefined;
}

/**
 * The document as a `.docx`. With `original` (the package it was imported from), the parts
 * Foli does not edit come back byte for byte and unchanged elements verbatim.
 */
export async function exportDocx(
  document: FoliDocument,
  original?: DocxPackage,
  options: ExportOptions = {},
): Promise<Uint8Array> {
  const doc = withThreadIds(parseDocument(document), original);
  refuseNotYetWritten(doc);
  // Before the app is asked for any picture's bytes.
  const reference = original ? undefined : packageReference(doc);
  if (reference) {
    throw new DocxError(
      `The document refers to a part of its original package (${reference}): export it with that package`,
    );
  }
  // The parts written from the model: their drawings are the document's own.
  const rewritten = original
    ? [
        original.mainDocument,
        ...original
          .relationships(original.mainDocument)
          .filter((r) => r.type === REL.comments && r.partName)
          .map((r) => r.partName as string),
      ]
    : [];
  const bytes = await pictureBytes(doc, original, options.resource);
  const media = new Media(doc, original, bytes, rewritten);
  return original ? intoPackage(doc, original, options, media) : newPackage(doc, options, media);
}

/** Schema v5's additions outside the content, until 11.4-11.6 write them: never dropped. */
function refuseNotYetWritten(doc: FoliDocument): void {
  const written = (key: string) => new DocxError(`${key} cannot be exported to .docx yet`);
  for (const key of ["stories", "controls", "settings"] as const) if (doc[key]) throw written(key);
  const sections = [doc.section];
  const walk = (node: NodeJSON) => {
    const attrs = node.attrs as { section?: SectionJSON; controls?: unknown } | undefined;
    if (attrs?.controls) throw written("controls");
    if (attrs?.section) sections.push(attrs.section);
    node.content?.forEach(walk);
  };
  walk(doc.content);
  for (const comment of doc.comments) comment.content.forEach(walk);
  for (const section of sections)
    for (const key of ["columns", "pageNumbers", "footnotes", "endnotes"] as const)
      if (section[key]) throw written(`A section's ${key}`);
}

const PARA_ID = "w14:paraId";
type Json = Record<string, unknown>;

/** A comment's last paragraph's `w14:paraId`: what `commentsExtended` keys its thread state by. */
function paraIdOf(comment: FoliDocument["comments"][number]): string | undefined {
  const last = comment.content.filter((b) => b.type === "paragraph").at(-1);
  return (last?.attrs?.attributes as Record<string, string> | undefined)?.[PARA_ID];
}

/**
 * The document with a `w14:paraId` on the last paragraph of each comment that is in a thread
 * (a reply, replied to, or resolved) and has none (a comment made in the editor), so its thread
 * state can be written. Unique, below 0x80000000 as Word requires. Not when the comments part
 * cannot declare it (an existing part without the `w14` namespace).
 */
function withThreadIds(doc: FoliDocument, pkg: DocxPackage | undefined): FoliDocument {
  const parents = new Set(doc.comments.map((c) => c.parent).filter((p) => p !== undefined));
  const needs = doc.comments.filter(
    (c) =>
      (c.parent !== undefined || c.done !== undefined || parents.has(c.id)) &&
      !paraIdOf(c) &&
      c.content.some((b) => b.type === "paragraph"),
  );
  if (!needs.length) return doc;
  if (pkg) {
    const name = pkg
      .relationships(pkg.mainDocument)
      .find((r) => r.type === REL.comments && !r.external)?.partName;
    const part = name ? pkg.part(name) : undefined;
    if (
      part &&
      !namespacesOf(pkg.xml(part.name).root, pkg.xml(part.name).source).prefixes.has("w14")
    )
      return doc;
  }
  const used = new Set<string>();
  JSON.stringify(doc, (key, value) => {
    if (key === PARA_ID && typeof value === "string") used.add(value.toUpperCase());
    return value;
  });
  let next = 0x10000000;
  const fresh = () => {
    let id: string;
    do id = (next++).toString(16).toUpperCase().padStart(8, "0");
    while (used.has(id));
    used.add(id);
    return id;
  };
  const copy = structuredClone(doc);
  for (const comment of copy.comments) {
    if (!needs.some((c) => c.id === comment.id) || paraIdOf(comment)) continue;
    const last = comment.content.filter((b) => b.type === "paragraph").at(-1) as { attrs?: Json };
    last.attrs = {
      ...(last.attrs ?? {}),
      attributes: { ...((last.attrs?.attributes as Json) ?? {}), [PARA_ID]: fresh() },
    };
  }
  return copy;
}

async function intoPackage(
  doc: FoliDocument,
  pkg: DocxPackage,
  options: ExportOptions,
  media: Media,
): Promise<Uint8Array> {
  const mainName = pkg.mainDocument;
  const main = pkg.xml(mainName);
  const body = child(main.root, "body");
  if (!body) throw new DocxError(`${mainName}: no w:body`);
  const namespaces = namespacesOf(main.root, main.source);
  const rels = new Relationships(pkg.relationships(mainName));
  const context = contextFor(namespaces, rels, media, mainName);

  const content = blocksXml(doc.content.content ?? [], context) + bodySection(doc, namespaces);
  const documentXml =
    body.openEnd === body.end
      ? `${main.source.slice(0, body.start)}<${body.name}>${content}</${body.name}>${main.source.slice(body.end)}`
      : main.source.slice(0, body.openEnd) + content + main.source.slice(body.closeStart);

  const replace = new Map<string, Uint8Array>();
  const add: NewPart[] = [];
  const set = (name: string, text: string) => {
    if (pkg.text(name) !== text) replace.set(name, encoder.encode(utf8Declaration(text)));
  };
  set(mainName, documentXml);

  /** The main document's related part of `type`, or a new one at `defaultName`. */
  const part = (
    type: string,
    defaultName: string,
    contentType: string,
    write: (o: OriginalPart | undefined, ns: Namespaces) => string,
    needed: boolean,
  ) => {
    const relationship = pkg.relationships(mainName).find((r) => r.type === type && !r.external);
    const existing = relationship?.partName ? pkg.part(relationship.partName) : undefined;
    if (existing) {
      const xml = pkg.xml(existing.name);
      set(
        existing.name,
        write({ root: xml.root, source: xml.source }, namespacesOf(xml.root, xml.source)),
      );
      return existing.name;
    }
    if (!needed) return undefined;
    if (pkg.part(defaultName)) {
      // There, but not related to the document: written in place, then related.
      const xml = pkg.xml(defaultName);
      set(
        defaultName,
        write({ root: xml.root, source: xml.source }, namespacesOf(xml.root, xml.source)),
      );
      rels.add(type, relative(mainName, defaultName), false);
      return defaultName;
    }
    add.push({
      name: defaultName,
      data: encoder.encode(write(undefined, namespaces)),
      contentType,
    });
    rels.add(type, relative(mainName, defaultName), false);
    return defaultName;
  };

  part(
    REL.styles,
    "/word/styles.xml",
    CT.styles,
    (o, ns) => stylesXml(doc, o, ns),
    doc.styles.length > 0 || Object.keys(doc.defaults).length > 0,
  );
  const numbered = doc.numbering.abstracts.length + doc.numbering.instances.length > 0;
  part(
    REL.numbering,
    "/word/numbering.xml",
    CT.numbering,
    (o, ns) => numberingXml(doc, o, ns),
    numbered,
  );

  // Comments: their hyperlinks resolve against the comments part's relationships.
  const commentsName = pkg
    .relationships(mainName)
    .find((r) => r.type === REL.comments && !r.external)?.partName;
  const commentRels = new Relationships(commentsName ? pkg.relationships(commentsName) : []);
  const comments = part(
    REL.comments,
    "/word/comments.xml",
    CT.comments,
    (o, ns) =>
      commentsXml(doc, o, contextFor(ns, commentRels, media, commentsName ?? "/word/comments.xml")),
    doc.comments.length > 0,
  );
  if (comments && commentRels.added.length) writeRelationships(comments, commentRels);
  // Replies and resolved state: rewritten only when they changed.
  if (comments && changedThreads(doc, pkg)) {
    part(
      REL.commentsExtended,
      "/word/commentsExtended.xml",
      CT.commentsExtended,
      (o) => commentsExtendedXml(doc, o),
      true,
    );
  }

  const { trackRevisions } = options;
  if (trackRevisions !== undefined) {
    part(
      REL.settings,
      "/word/settings.xml",
      CT.settings,
      (o) => (o ? withTrackRevisions(o.source, o.root, trackRevisions) : newSettingsXml()),
      trackRevisions,
    );
  }

  if (rels.added.length) writeRelationships(mainName, rels);
  add.push(...media.added);
  return pkg.write(replace, add);

  function writeRelationships(source: string, relationships: Relationships): void {
    const relsName = relationshipsPartName(source);
    if (pkg.part(relsName)) set(relsName, relationships.xml(pkg.text(relsName)));
    else
      add.push({
        name: relsName,
        data: encoder.encode(relationships.xml(undefined)),
        contentType: CT.rels,
      });
  }
}

/** Whether the comments' replies or resolved state differ from what the package says. */
function changedThreads(doc: FoliDocument, pkg: DocxPackage): boolean {
  const extended = pkg
    .relationships(pkg.mainDocument)
    .find((r) => r.type === REL.commentsExtended && !r.external)?.partName;
  const W15 = "http://schemas.microsoft.com/office/word/2012/wordml";
  const states = new Map<string, { parent: string | undefined; done: string | undefined }>();
  if (extended && pkg.part(extended)) {
    for (const c of pkg.xml(extended).root.children) {
      if (c.kind !== "element" || c.ns !== W15 || c.local !== "commentEx") continue;
      const get = (local: string) =>
        c.attributes.find((a) => a.ns === W15 && a.local === local)?.value;
      states.set(get("paraId") ?? "", { parent: get("paraIdParent"), done: get("done") });
    }
  }
  const byId = new Map<number, string | undefined>();
  for (const c of doc.comments) if (!byId.has(c.id)) byId.set(c.id, paraIdOf(c));
  const paraId = (id: number | undefined) => (id === undefined ? undefined : byId.get(id));
  for (const comment of doc.comments) {
    const id = paraId(comment.id);
    if (!id) continue;
    const state = states.get(id);
    const done = state?.done === "1" || state?.done === "true" || state?.done === "on";
    if (!state && (comment.done || comment.parent !== undefined)) return true;
    if (
      state &&
      (done !== !!comment.done || (state.parent ?? undefined) !== paraId(comment.parent))
    )
      return true;
  }
  return false;
}

/** A new package: content types, relationships, the document and the parts it needs. */
async function newPackage(
  doc: FoliDocument,
  options: ExportOptions,
  media: Media,
): Promise<Uint8Array> {
  const rels = new Relationships([]);
  const context = contextFor(DEFAULT_NAMESPACES, rels, media, "/word/document.xml");
  const main = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:document ${NEW_ROOT_ATTRIBUTES}><w:body>${blocksXml(doc.content.content ?? [], context)}${bodySection(doc, DEFAULT_NAMESPACES)}</w:body></w:document>`;
  const parts: { name: string; text: string; contentType: string }[] = [
    { name: "/word/document.xml", text: main, contentType: CT.main },
  ];
  const add = (name: string, type: string, contentType: string, text: string) => {
    parts.push({ name, text, contentType });
    rels.add(type, relative("/word/document.xml", name), false);
  };
  add("/word/styles.xml", REL.styles, CT.styles, stylesXml(doc, undefined, DEFAULT_NAMESPACES));
  if (doc.numbering.abstracts.length + doc.numbering.instances.length) {
    add(
      "/word/numbering.xml",
      REL.numbering,
      CT.numbering,
      numberingXml(doc, undefined, DEFAULT_NAMESPACES),
    );
  }
  if (doc.comments.length) {
    const commentRels = new Relationships([]);
    add(
      "/word/comments.xml",
      REL.comments,
      CT.comments,
      commentsXml(
        doc,
        undefined,
        contextFor(DEFAULT_NAMESPACES, commentRels, media, "/word/comments.xml"),
      ),
    );
    if (commentRels.added.length)
      parts.push({
        name: "/word/_rels/comments.xml.rels",
        text: commentRels.xml(undefined),
        contentType: CT.rels,
      });
    if (doc.comments.some((c) => paraIdOf(c) && (c.parent !== undefined || c.done !== undefined))) {
      add(
        "/word/commentsExtended.xml",
        REL.commentsExtended,
        CT.commentsExtended,
        commentsExtendedXml(doc, undefined),
      );
    }
  }
  if (options.trackRevisions)
    add("/word/settings.xml", REL.settings, CT.settings, newSettingsXml());
  parts.push({
    name: "/word/_rels/document.xml.rels",
    text: rels.xml(undefined),
    contentType: CT.rels,
  });
  const overrides = [...parts, ...media.added]
    .filter((p) => p.contentType !== CT.rels)
    .map((p) => `<Override PartName="${p.name}" ContentType="${p.contentType}"/>`)
    .join("");
  const files: [string, string][] = [
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="${CT.rels}"/><Default Extension="xml" ContentType="application/xml"/>${overrides}</Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ],
    ...parts.map((p): [string, string] => [p.name.slice(1), p.text]),
  ];
  const entries = [];
  for (const [name, text] of files) entries.push(await deflateEntry(name, encoder.encode(text)));
  for (const part of media.added) entries.push(await deflateEntry(part.name.slice(1), part.data));
  return writeZip(entries);
}

/** The body's last section: written when the document has one or read one (an empty `{}` read
 * from nothing is Word's default page, written as no `w:sectPr`). */
function bodySection(doc: FoliDocument, namespaces: Namespaces): string {
  const section = doc.section as Record<string, unknown>;
  return Object.keys(section).length ? sectionXml(section, namespaces) : "";
}

/**
 * Where the document refers to a part of a package by relationship id (headers, footers,
 * pictures and other content kept verbatim): such a document needs that package to export.
 */
function packageReference(doc: FoliDocument): string | undefined {
  const sections = [doc.section, ...(doc.content.content ?? []).map((b) => b.attrs?.section)];
  for (const s of sections) {
    const section = s as { headers?: object; footers?: object } | undefined;
    if (section?.headers || section?.footers) return "a header or footer";
  }
  let found: string | undefined;
  JSON.stringify([doc.content, doc.comments], (key, value) => {
    if (!found && key === "xml" && typeof value === "string" && /\sr:[A-Za-z]+="/.test(value))
      found = "content kept verbatim";
    const link = value as {
      type?: string;
      attrs?: { href?: unknown; attributes?: Record<string, string> };
    };
    // A link with a target gets a new relationship; one without keeps its reference.
    if (
      !found &&
      link?.type === "link" &&
      link.attrs?.href == null &&
      link.attrs?.attributes?.["r:id"]
    ) {
      found = "a hyperlink";
    }
    return value;
  });
  return found;
}

/** A part's text with an encoding declaration of UTF-8, the encoding it is written in. */
function utf8Declaration(text: string): string {
  return text.replace(/^(<\?xml[^?]*?encoding=)(["'])[^"']*\2/, "$1$2UTF-8$2");
}
