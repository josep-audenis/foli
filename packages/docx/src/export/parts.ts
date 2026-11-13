/**
 * `styles.xml`, `numbering.xml` and `comments.xml` from the envelope. With the original part,
 * its prolog, root element and everything Foli does not model (latent styles, picture bullets,
 * elements import could not use) stay as they were and where they were; each modeled element
 * is written verbatim while unchanged, rewritten otherwise, left out when the editor removed
 * it; new ones are added where Word expects them.
 */

import type {
  AbstractNumberingJSON,
  CommentJSON,
  FoliDocumentV3,
  NumberingInstanceJSON,
  NumberingLevelJSON,
  StyleJSON,
} from "@folijs/core";
import { attr, child, isW, W, W15 } from "../import/ooxml.js";
import {
  abstractOf,
  defaultsOf,
  instanceOf,
  level as levelOf,
  styleOf,
  usableStyle,
} from "../import/parts.js";
import { Recorder } from "../import/report.js";
import type { XmlElement, XmlNode } from "../xml.js";
import { blocksXml, type WriteContext } from "./content.js";
import { paragraphPropertiesXml, runPropertiesXml, same } from "./properties.js";
import {
  attributesOf,
  el,
  escapeAttribute,
  fragment,
  merged,
  type Namespaces,
  onOff,
  val,
} from "./xmlout.js";

type Json = Record<string, unknown>;
export interface OriginalPart {
  readonly root: XmlElement;
  readonly source: string;
}

const reading = (source: string) => ({ source, report: new Recorder() });
const text = (part: OriginalPart, node: XmlNode) => part.source.slice(node.start, node.end);

/** The original element's attributes except `skip`, as written (`w:customStyle`, `w15:tentative`…). */
function otherAttributes(
  element: XmlElement | undefined,
  source: string,
  skip: readonly string[],
): string {
  if (!element) return "";
  return element.attributes
    .filter((a) => !skip.includes(a.name) && a.name !== "xmlns" && a.prefix !== "xmlns")
    .map((a) => ` ${source.slice(a.start, a.end)}`)
    .join("");
}

function original(ext: string | undefined, ns: Namespaces) {
  return ext ? fragment(ext, ns) : undefined;
}

function childSource(
  o: { element: XmlElement; source: string } | undefined,
  local: string,
): string | undefined {
  const c = o ? child(o.element, local) : undefined;
  return c && o ? o.source.slice(c.start, c.end) : undefined;
}

/** A part's text: the original's prolog and root around `children`, or a new root. */
function wrapPart(
  part: OriginalPart | undefined,
  rootName: string,
  ns: Namespaces,
  children: string,
): string {
  if (!part) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<${rootName} ${ns.declarations}>${children}</${rootName}>`;
  }
  const { root, source } = part;
  if (root.openEnd === root.end) {
    // `<w:styles …/>`: opened to hold the children.
    return `${source.slice(0, root.end - 2)}>${children}</${root.name}>${source.slice(root.end)}`;
  }
  return source.slice(0, root.openEnd) + children + source.slice(root.closeStart);
}

/**
 * Walks the original part's children: `modeled` returns the matching envelope item for a child
 * it models (or null when the editor removed it, undefined when the child is not one it
 * models); `write` writes an item; `added` are written at `insertAt` (after the last child of
 * that kind, or at the end).
 */
function rebuild<T>(
  part: OriginalPart | undefined,
  modeled: (child: XmlElement) => T | null | undefined,
  write: (item: T, child: XmlElement | undefined) => string,
  added: readonly { item: T; after: (child: XmlElement) => boolean }[],
): string {
  const out: string[] = [];
  const insertAfter: (number | undefined)[] = added.map(() => undefined);
  for (const node of part?.root.children ?? []) {
    if (node.kind !== "element") {
      out.push(text(part as OriginalPart, node));
      continue;
    }
    const item = modeled(node);
    if (item === undefined) out.push(text(part as OriginalPart, node));
    else if (item !== null) out.push(write(item, node));
    added.forEach((a, i) => {
      if (a.after(node)) insertAfter[i] = out.length;
    });
  }
  // Insert from the end so earlier positions stay valid.
  const order = added
    .map((a, i) => ({ a, at: insertAfter[i] ?? out.length, i }))
    .sort((x, y) => y.at - x.at || y.i - x.i);
  for (const { a, at } of order) out.splice(at, 0, write(a.item, undefined));
  return out.join("");
}

/** Items matched to the original elements they were read from, by `key` (their verbatim `ext`). */
function matcher<T>(
  items: readonly T[],
  key: (item: T) => string | undefined = (i) => (i as { ext?: string }).ext,
) {
  const byKey = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k !== undefined) byKey.set(k, [...(byKey.get(k) ?? []), item]);
  }
  const used = new Set<T>();
  return {
    take(k: string): T | undefined {
      const item = byKey.get(k)?.find((i) => !used.has(i));
      if (item) used.add(item);
      return item;
    },
    rest: () => items.filter((i) => !used.has(i)),
  };
}

// ---- styles ----------------------------------------------------------------------------------

const STYLE_ORDER = [
  "name",
  "aliases",
  "basedOn",
  "next",
  "link",
  "autoRedefine",
  "hidden",
  "uiPriority",
  "semiHidden",
  "unhideWhenUsed",
  "qFormat",
  "locked",
  "personal",
  "personalCompose",
  "personalReply",
  "rsid",
  "pPr",
  "rPr",
  "tblPr",
  "trPr",
  "tcPr",
  "tblStylePr",
];

function styleXml(style: StyleJSON, ns: Namespaces): string {
  const o = original(style.ext, ns);
  if (o) {
    const reread = styleOf(o.element, reading(o.source));
    if (reread && same(normalizeStyle(style), normalizeStyle(reread))) return style.ext as string;
  }
  const reread = o ? styleOf(o.element, reading(o.source)) : undefined;
  const generated = new Map<string, string>([
    ["name", val("name", style.name)],
    ["basedOn", val("basedOn", style.basedOn)],
    ["next", val("next", style.next)],
    ["link", val("link", style.link)],
    [
      "pPr",
      o && same(style.paragraph ?? {}, reread?.paragraph ?? {})
        ? (childSource(o, "pPr") ?? "")
        : paragraphPropertiesXml({ ...(style.paragraph ?? {}), ext: childSource(o, "pPr") }, ns),
    ],
    ["rPr", runPropertiesXml(style.run ?? [], childSource(o, "rPr"), ns)],
  ]);
  const children = merged(STYLE_ORDER, new Set(generated.keys()), generated, o);
  const open =
    el("w:style", {
      "w:type": style.type,
      "w:default": style.isDefault,
      "w:styleId": style.id,
    }).slice(0, -2) +
    otherAttributes(o?.element, o?.source ?? "", ["w:type", "w:default", "w:styleId"]);
  return `${open}>${children}</w:style>`;
}

/** A style as compared: run properties canonical, the verbatim element aside. */
function normalizeStyle(style: StyleJSON): Json {
  return { ...style, ext: undefined, paragraph: style.paragraph ?? {}, run: style.run ?? [] };
}

function defaultsXml(defaults: FoliDocumentV3["defaults"], ns: Namespaces): string {
  const o = original(defaults.ext, ns);
  if (o) {
    const reread = defaultsOf(o.element, reading(o.source));
    if (same({ ...defaults, ext: undefined }, { ...reread, ext: undefined }))
      return defaults.ext as string;
  }
  const rPrDefault = o ? child(o.element, "rPrDefault") : undefined;
  const pPrDefault = o ? child(o.element, "pPrDefault") : undefined;
  const sub = (e: XmlElement | undefined) =>
    e && o ? { element: e, source: o.source } : undefined;
  const rPr = runPropertiesXml(defaults.run ?? [], childSource(sub(rPrDefault), "rPr"), ns);
  const pPr = paragraphPropertiesXml(
    { ...(defaults.paragraph ?? {}), ext: childSource(sub(pPrDefault), "pPr") },
    ns,
  );
  return `<w:docDefaults${attributesOf(o)}>${rPr ? `<w:rPrDefault>${rPr}</w:rPrDefault>` : "<w:rPrDefault/>"}${pPr ? `<w:pPrDefault>${pPr}</w:pPrDefault>` : "<w:pPrDefault/>"}</w:docDefaults>`;
}

export function stylesXml(
  doc: FoliDocumentV3,
  part: OriginalPart | undefined,
  ns: Namespaces,
): string {
  const styles = matcher(doc.styles);
  const hasDefaults = Object.keys(doc.defaults).length > 0;
  let sawDefaults = false;
  type Item = { kind: "defaults" } | { kind: "style"; style: StyleJSON };
  const body = rebuild<Item>(
    part,
    (c) => {
      if (isW(c, "docDefaults")) {
        sawDefaults = true;
        return hasDefaults ? { kind: "defaults" } : null;
      }
      if (!isW(c, "style") || !usableStyle(c) || !part) return undefined;
      const style = styles.take(text(part, c));
      return style ? { kind: "style", style } : null;
    },
    (item) => (item.kind === "defaults" ? defaultsXml(doc.defaults, ns) : styleXml(item.style, ns)),
    [],
  );
  const added = styles
    .rest()
    .map((s) => styleXml(s, ns))
    .join("");
  const defaults = hasDefaults && !sawDefaults ? defaultsXml(doc.defaults, ns) : "";
  return wrapPart(part, "w:styles", ns, defaults + body + added);
}

// ---- numbering -------------------------------------------------------------------------------

const LEVEL_ORDER = [
  "start",
  "numFmt",
  "lvlRestart",
  "pStyle",
  "isLgl",
  "suff",
  "lvlText",
  "lvlPicBulletId",
  "legacy",
  "lvlJc",
  "pPr",
  "rPr",
];

function levelXml(level: NumberingLevelJSON, ns: Namespaces): string {
  const o = original(level.ext, ns);
  const reread = o ? levelOf(o.element, reading(o.source)) : undefined;
  if (o && reread && same({ ...level, ext: undefined }, { ...reread, ext: undefined }))
    return level.ext as string;
  const s = (x: unknown) => (x === undefined ? undefined : String(x));
  const generated = new Map<string, string>([
    ["start", val("start", s(level.start))],
    ["numFmt", val("numFmt", level.format)],
    ["lvlRestart", val("lvlRestart", s(level.restart))],
    ["pStyle", val("pStyle", level.style)],
    ["isLgl", onOff("isLgl", level.legal)],
    ["suff", val("suff", level.suffix)],
    ["lvlText", level.text === undefined ? "" : el("w:lvlText", { "w:val": level.text })],
    ["lvlJc", val("lvlJc", level.justification)],
    [
      "pPr",
      o && same(level.paragraph ?? {}, reread?.paragraph ?? {})
        ? (childSource(o, "pPr") ?? "")
        : paragraphPropertiesXml({ ...(level.paragraph ?? {}), ext: childSource(o, "pPr") }, ns),
    ],
    ["rPr", runPropertiesXml(level.run ?? [], childSource(o, "rPr"), ns)],
  ]);
  const children = merged(LEVEL_ORDER, new Set(generated.keys()), generated, o);
  const open =
    el("w:lvl", { "w:ilvl": level.level }).slice(0, -2) +
    otherAttributes(o?.element, o?.source ?? "", ["w:ilvl"]);
  return `${open}>${children}</w:lvl>`;
}

const ABSTRACT_ORDER = [
  "nsid",
  "multiLevelType",
  "tmpl",
  "name",
  "styleLink",
  "numStyleLink",
  "lvl",
];

function abstractXml(abstract: AbstractNumberingJSON, ns: Namespaces): string {
  const o = original(abstract.ext, ns);
  const reread = o ? abstractOf(o.element, reading(o.source)) : undefined;
  if (o && reread && same({ ...abstract, ext: undefined }, { ...reread, ext: undefined }))
    return abstract.ext as string;
  const generated = new Map<string, string>([
    ["multiLevelType", val("multiLevelType", abstract.multiLevelType)],
    ["styleLink", val("styleLink", abstract.styleLink)],
    ["numStyleLink", val("numStyleLink", abstract.numStyleLink)],
    ["lvl", abstract.levels.map((l) => levelXml(l, ns)).join("")],
  ]);
  const children = merged(ABSTRACT_ORDER, new Set(generated.keys()), generated, o);
  const open =
    el("w:abstractNum", { "w:abstractNumId": abstract.id }).slice(0, -2) +
    otherAttributes(o?.element, o?.source ?? "", ["w:abstractNumId"]);
  return `${open}>${children}</w:abstractNum>`;
}

function instanceXml(instance: NumberingInstanceJSON, ns: Namespaces): string {
  const o = original(instance.ext, ns);
  const reread = o ? instanceOf(o.element, reading(o.source)) : undefined;
  if (o && reread && same({ ...instance, ext: undefined }, { ...reread, ext: undefined }))
    return instance.ext as string;
  const overrides = (instance.overrides ?? [])
    .map(
      (ov) =>
        `<w:lvlOverride w:ilvl="${ov.level}">${ov.start === undefined ? "" : val("startOverride", String(ov.start))}${ov.definition ? levelXml({ ...ov.definition, level: ov.level }, ns) : ""}</w:lvlOverride>`,
    )
    .join("");
  const generated = new Map<string, string>([
    ["abstractNumId", val("abstractNumId", String(instance.abstract))],
    ["lvlOverride", overrides],
  ]);
  const children = merged(
    ["abstractNumId", "lvlOverride"],
    new Set(generated.keys()),
    generated,
    o,
  );
  const open =
    el("w:num", { "w:numId": instance.id }).slice(0, -2) +
    otherAttributes(o?.element, o?.source ?? "", ["w:numId"]);
  return `${open}>${children}</w:num>`;
}

export function numberingXml(
  doc: FoliDocumentV3,
  part: OriginalPart | undefined,
  ns: Namespaces,
): string {
  const abstracts = matcher(doc.numbering.abstracts);
  const instances = matcher(doc.numbering.instances);
  const silent = reading(part?.source ?? "");
  type Item =
    | { kind: "abstract"; a: AbstractNumberingJSON }
    | { kind: "num"; n: NumberingInstanceJSON };
  // Taken before the walk: added items are known before their insertion point is.
  const walk = (c: XmlElement): Item | null | undefined => {
    if (!part) return undefined;
    if (isW(c, "abstractNum")) {
      if (!abstractOf(c, silent)) return undefined;
      const a = abstracts.take(text(part, c));
      return a ? { kind: "abstract", a } : null;
    }
    if (isW(c, "num")) {
      if (!instanceOf(c, silent)) return undefined;
      const n = instances.take(text(part, c));
      return n ? { kind: "num", n } : null;
    }
    return undefined;
  };
  // A first pass decides what is matched; the second writes (rebuild needs `added` up front).
  for (const node of part?.root.children ?? []) if (node.kind === "element") walk(node);
  const newAbstracts = abstracts.rest();
  const newInstances = instances.rest();
  const again = {
    abstracts: matcher(doc.numbering.abstracts),
    instances: matcher(doc.numbering.instances),
  };
  const body = rebuild<Item>(
    part,
    (c) => {
      if (!part) return undefined;
      if (isW(c, "abstractNum")) {
        if (!abstractOf(c, silent)) return undefined;
        const a = again.abstracts.take(text(part, c));
        return a ? { kind: "abstract", a } : null;
      }
      if (isW(c, "num")) {
        if (!instanceOf(c, silent)) return undefined;
        const n = again.instances.take(text(part, c));
        return n ? { kind: "num", n } : null;
      }
      return undefined;
    },
    (item) => (item.kind === "abstract" ? abstractXml(item.a, ns) : instanceXml(item.n, ns)),
    [
      // CT_Numbering: numPicBullet*, abstractNum*, num*, numIdMacAtCleanup.
      ...newAbstracts.map((a) => ({
        item: { kind: "abstract", a } as Item,
        after: (c: XmlElement) => isW(c, "abstractNum") || isW(c, "numPicBullet"),
      })),
      ...newInstances.map((n) => ({
        item: { kind: "num", n } as Item,
        after: (c: XmlElement) => isW(c, "num") || isW(c, "abstractNum") || isW(c, "numPicBullet"),
      })),
    ],
  );
  return wrapPart(part, "w:numbering", ns, body);
}

// ---- comments ---------------------------------------------------------------------------------

/** A comment's start tag: as written while author, initials and date are what was read from it. */
function commentStart(comment: CommentJSON, ns: Namespaces): string {
  if (comment.ext) {
    const o = fragment(`${comment.ext}</w:comment>`, ns);
    if (o) {
      const author = attr(o.element, "author") ?? "";
      const initials = attr(o.element, "initials");
      const date = attr(o.element, "date");
      const readDate = date && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(date) ? date : undefined;
      if (
        Number(attr(o.element, "id")) === comment.id &&
        author.slice(0, 255) === comment.author &&
        (initials !== undefined && initials.length <= 9 ? initials : undefined) ===
          comment.initials &&
        readDate === comment.date
      ) {
        return comment.ext;
      }
    }
  }
  return el("w:comment", {
    "w:id": comment.id,
    "w:author": comment.author,
    "w:date": comment.date,
    "w:initials": comment.initials,
  }).replace(/\/>$/, ">");
}

export function commentsXml(
  doc: FoliDocumentV3,
  part: OriginalPart | undefined,
  context: WriteContext,
): string {
  // A comment is matched to the element it was read from by its start tag and id.
  const comments = matcher(doc.comments, (c) => (c.ext ? `${c.ext}#${c.id}` : undefined));
  const write = (c: CommentJSON) =>
    `${commentStart(c, context.namespaces)}${blocksXml(c.content, context)}</w:comment>`;
  const body = rebuild<CommentJSON>(
    part,
    (c) => {
      if (!part || !isW(c, "comment")) return undefined;
      const id = Number(attr(c, "id"));
      if (!Number.isInteger(id) || id < 0 || id > 2_147_483_647) return undefined;
      const start = part.source.slice(c.start, c.openEnd);
      return comments.take(`${start}#${id}`) ?? null;
    },
    write,
    [],
  );
  const added = comments.rest().map(write).join("");
  return wrapPart(part, "w:comments", context.namespaces, body + added);
}

/**
 * `commentsExtended.xml` for the comments' replies and resolved state, keyed by the `w14:paraId`
 * of each comment's last paragraph (comments without one cannot be listed).
 */
export function commentsExtendedXml(doc: FoliDocumentV3, part: OriginalPart | undefined): string {
  const paraId = (c: CommentJSON) => {
    const last = c.content.filter((b) => b.type === "paragraph").at(-1);
    return (last?.attrs?.attributes as Record<string, string> | undefined)?.["w14:paraId"];
  };
  const byId = new Map(doc.comments.map((c) => [c.id, c]));
  const entries = doc.comments
    .filter((c) => paraId(c))
    .map((c) => {
      const parent = c.parent === undefined ? undefined : byId.get(c.parent);
      const parentId = parent ? paraId(parent) : undefined;
      return `<w15:commentEx w15:paraId="${escapeAttribute(paraId(c) as string)}"${parentId ? ` w15:paraIdParent="${escapeAttribute(parentId)}"` : ""} w15:done="${c.done ? 1 : 0}"/>`;
    })
    .join("");
  if (!part) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w15:commentsEx xmlns:w15="${W15}" xmlns:w="${W}">${entries}</w15:commentsEx>`;
  }
  return wrapPart(part, part.root.name, { declarations: "" }, entries);
}
