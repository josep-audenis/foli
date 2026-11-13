/**
 * Schema v3 to `.docx` (ADR-0005): the parts the editor owns are written from the document
 * (`document.xml`, `styles.xml`, `numbering.xml`, `comments.xml`, `commentsExtended.xml` and
 * the relationships new hyperlinks need); every other part is copied from the original package
 * byte for byte. Without a package, a new one is made.
 */

import { type FoliDocumentV3, parseDocumentV3 } from "@folijs/core";
import { child, REL } from "../import/ooxml.js";
import { DocxError, type DocxPackage, type NewPart } from "../package.js";
import { deflateEntry, writeZip } from "../zip.js";
import { blocksXml, type WriteContext } from "./content.js";
import {
  commentsExtendedXml,
  commentsXml,
  numberingXml,
  type OriginalPart,
  stylesXml,
} from "./parts.js";
import { sectionXml } from "./properties.js";
import { DEFAULT_NAMESPACES, escapeAttribute, type Namespaces, namespacesOf } from "./xmlout.js";

const CT = {
  main: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  styles: "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
  numbering: "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml",
  comments: "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml",
  commentsExtended:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml",
  rels: "application/vnd.openxmlformats-package.relationships+xml",
};

const encoder = new TextEncoder();

/** New relationships of a source part (hyperlink targets), allocated as content is written. */
class Relationships {
  readonly added: { id: string; type: string; target: string; external: boolean }[] = [];
  readonly #ids: Set<string>;
  readonly #byTarget = new Map<string, string>();
  readonly #existing: ReadonlyMap<string, { type: string; target: string; external: boolean }>;

  constructor(
    existing: readonly { id: string; type: string; target: string; external: boolean }[],
  ) {
    this.#existing = new Map(existing.map((r) => [r.id, r]));
    this.#ids = new Set(existing.map((r) => r.id));
    for (const r of existing)
      if (r.type === REL.hyperlink && r.external) this.#byTarget.set(r.target, r.id);
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

function contextFor(namespaces: Namespaces, relationships: Relationships): WriteContext {
  return { namespaces, hyperlink: (href, id) => relationships.hyperlink(href, id) };
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

/**
 * The document as a `.docx`. With `original` (the package it was imported from), the parts
 * Foli does not edit come back byte for byte and unchanged elements verbatim.
 */
export async function exportDocx(
  document: FoliDocumentV3,
  original?: DocxPackage,
): Promise<Uint8Array> {
  const doc = parseDocumentV3(document);
  return original ? intoPackage(doc, original) : newPackage(doc);
}

async function intoPackage(doc: FoliDocumentV3, pkg: DocxPackage): Promise<Uint8Array> {
  const mainName = pkg.mainDocument;
  const main = pkg.xml(mainName);
  const body = child(main.root, "body");
  if (!body) throw new DocxError(`${mainName}: no w:body`);
  const namespaces = namespacesOf(main.root, main.source);
  const rels = new Relationships(pkg.relationships(mainName));
  const context = contextFor(namespaces, rels);

  const content =
    blocksXml(doc.content.content ?? [], context) +
    sectionXml(doc.section as Record<string, unknown>, namespaces);
  const documentXml =
    body.openEnd === body.end
      ? `${main.source.slice(0, body.start)}<${body.name}>${content}</${body.name}>${main.source.slice(body.end)}`
      : main.source.slice(0, body.openEnd) + content + main.source.slice(body.closeStart);

  const replace = new Map<string, Uint8Array>();
  const add: NewPart[] = [];
  const set = (name: string, text: string) => {
    if (pkg.text(name) !== text) replace.set(name, encoder.encode(text));
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
    (o, ns) => commentsXml(doc, o, contextFor(ns, commentRels)),
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

  if (rels.added.length) writeRelationships(mainName, rels);
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
function changedThreads(doc: FoliDocumentV3, pkg: DocxPackage): boolean {
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
  const paraId = (id: number | undefined) => {
    const comment = doc.comments.find((c) => c.id === id);
    const last = comment?.content.filter((b) => b.type === "paragraph").at(-1);
    return (last?.attrs?.attributes as Record<string, string> | undefined)?.["w14:paraId"];
  };
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
async function newPackage(doc: FoliDocumentV3): Promise<Uint8Array> {
  const rels = new Relationships([]);
  const context = contextFor(DEFAULT_NAMESPACES, rels);
  const main = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:document ${DEFAULT_NAMESPACES.declarations}><w:body>${blocksXml(doc.content.content ?? [], context)}${sectionXml(doc.section as Record<string, unknown>, DEFAULT_NAMESPACES)}</w:body></w:document>`;
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
      commentsXml(doc, undefined, contextFor(DEFAULT_NAMESPACES, commentRels)),
    );
    if (commentRels.added.length)
      parts.push({
        name: "/word/_rels/comments.xml.rels",
        text: commentRels.xml(undefined),
        contentType: CT.rels,
      });
  }
  parts.push({
    name: "/word/_rels/document.xml.rels",
    text: rels.xml(undefined),
    contentType: CT.rels,
  });
  const overrides = parts
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
  return writeZip(entries);
}
