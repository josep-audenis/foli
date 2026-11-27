/**
 * Headers, footers, footnotes and endnotes as stories (ADR-0007): content trees of their own,
 * read from their parts with the same reader as the body. A header's or footer's id is its
 * relationship id; a note's is `footnote:<w:id>` or `endnote:<w:id>`. A note the model cannot
 * name stays in its part, untouched.
 */
import { parseContent, type StoryJSON } from "@folijs/core";
import type { DocxPackage } from "../package.js";
import type { XmlElement } from "../xml.js";
import { blocks, type ContentContext } from "./content.js";
import { attr, elements, integer, isW, REL } from "./ooxml.js";

const NOTE_TYPES = new Set(["normal", "separator", "continuationSeparator", "continuationNotice"]);

/**
 * The notes of a footnotes or endnotes part that the model holds, by story id.
 * @internal
 */
export function notesOf(root: XmlElement, kind: "footnote" | "endnote"): Map<string, XmlElement> {
  const out = new Map<string, XmlElement>();
  for (const el of elements(root)) {
    if (!isW(el, kind)) continue;
    const id = integer(attr(el, "id"));
    const type = attr(el, "type");
    const key = `${kind}:${id}`;
    if (id === undefined || (type !== undefined && !NOTE_TYPES.has(type)) || out.has(key)) continue;
    out.set(key, el);
  }
  return out;
}

const docOf = (content: StoryJSON["content"]["content"]): StoryJSON["content"] => ({
  type: "doc",
  content: content?.length ? content : [{ type: "paragraph" }],
});

/**
 * Every story of the package, by id. `contextFor` gives the reading context of a part. The text
 * boxes of a header or footer go into `boxes` (`textbox:<relationship id>/<n>`).
 * @internal
 */
export function readStories(
  pkg: DocxPackage,
  contextFor: (part: string, source: string) => ContentContext,
  boxes: Map<string, StoryJSON> = new Map(),
): Record<string, StoryJSON> {
  const stories: Record<string, StoryJSON> = {};
  const notesRead = new Set<string>();
  for (const relationship of pkg.relationships(pkg.mainDocument)) {
    const part = relationship.partName ? pkg.part(relationship.partName) : undefined;
    if (relationship.external || !part) continue;
    const headerOrFooter =
      relationship.type === REL.header
        ? ["header", "hdr"]
        : relationship.type === REL.footer
          ? ["footer", "ftr"]
          : undefined;
    const note =
      relationship.type === REL.footnotes
        ? "footnote"
        : relationship.type === REL.endnotes
          ? "endnote"
          : undefined;
    if (!headerOrFooter && !note) continue;
    // A part that is not XML (a relationship can point anywhere) stays as it is.
    let xml: ReturnType<DocxPackage["xml"]>;
    try {
      xml = pkg.xml(part.name);
    } catch {
      continue;
    }
    const context = contextFor(part.name, xml.source);
    if (headerOrFooter) {
      const [kind, root] = headerOrFooter as ["header" | "footer", string];
      // An id the envelope cannot hold as a key: the part stays as it is.
      if (!isW(xml.root, root) || relationship.id === "__proto__") continue;
      const textBoxes = { stories: boxes, prefix: `textbox:${relationship.id}/` };
      stories[relationship.id] = {
        kind,
        content: docOf(blocks(xml.root.children, { ...context, story: kind, textBoxes })),
      };
    } else if (note) {
      // One part per kind, of the right kind: any other stays as it is.
      if (notesRead.has(note) || !isW(xml.root, `${note}s`)) continue;
      notesRead.add(note);
      for (const [key, el] of notesOf(xml.root, note)) {
        const type = attr(el, "type");
        stories[key] = {
          kind: note,
          ...(type ? { noteType: type as StoryJSON["noteType"] & string } : {}),
          content: docOf(blocks(el.children, { ...context, story: note })),
          ext: xml.source.slice(el.start, el.openEnd),
        };
      }
    }
  }
  return stories;
}

/**
 * The ids of every note in the package's notes parts, those the model does not hold too.
 * @internal
 */
export function noteIds(pkg: DocxPackage): Set<string> {
  const ids = new Set<string>();
  for (const [type, kind] of [
    [REL.footnotes, "footnote"],
    [REL.endnotes, "endnote"],
  ] as const) {
    const name = pkg.relationships(pkg.mainDocument).find((r) => r.type === type)?.partName;
    if (!name || !pkg.part(name)) continue;
    let root: XmlElement;
    try {
      root = pkg.xml(name).root;
    } catch {
      continue;
    }
    for (const el of elements(root)) {
      const id = integer(attr(el, "id"));
      if (isW(el, kind) && id !== undefined) ids.add(`${kind}:${id}`);
    }
  }
  return ids;
}

/**
 * The stories in the form a validated document holds them, to compare with one.
 * @internal
 */
export function canonicalStories(
  pkg: DocxPackage,
  contextFor: (part: string, source: string) => ContentContext,
  /** The body's text boxes too (read from the whole body, as import numbers them). */
  body = false,
): Record<string, StoryJSON> {
  const boxes = new Map<string, StoryJSON>();
  if (body) {
    const main = pkg.xml(pkg.mainDocument);
    const content = elements(main.root).find((e) => isW(e, "body"));
    const sectPr =
      content &&
      elements(content)
        .filter((e) => isW(e, "sectPr"))
        .at(-1);
    if (content)
      blocks(
        content.children,
        {
          ...contextFor(pkg.mainDocument, main.source),
          textBoxes: { stories: boxes, prefix: "textbox:" },
        },
        sectPr,
      );
  }
  const stories = readStories(pkg, contextFor, boxes);
  Object.assign(stories, Object.fromEntries(boxes));
  for (const story of Object.values(stories)) story.content = parseContent(story.content).toJSON();
  return stories;
}
