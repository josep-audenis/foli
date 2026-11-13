/**
 * Schema v3 attributes and marks back to `w:pPr`, `w:rPr` and `w:sectPr`. An element read from
 * a file comes back verbatim while its values are what import read from it; otherwise each
 * child is decided on its own: one whose property is unchanged is copied from the original
 * (with its unknown attributes), a changed one is written from the model, and children Foli
 * does not model stay where Word requires them.
 */

import { type MarkJSON, schemaV3 } from "@folijs/core";
import { W } from "../import/ooxml.js";
import {
  paragraphProperties,
  section as readSection,
  runProperties,
} from "../import/properties.js";
import { Recorder } from "../import/report.js";
import type { XmlElement } from "../xml.js";
import { attributesOf, el, fragment, merged, type Namespaces, onOff, val } from "./xmlout.js";

type Original = { element: XmlElement; source: string } | undefined;
type Json = Record<string, unknown>;

/** Structural equality of JSON values, key order aside. */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return (a ?? undefined) === (b ?? undefined);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Json)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Json)[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => same((a as Json)[k], (b as Json)[k]));
}

const reading = (original: NonNullable<Original>) => ({
  source: original.source,
  report: new Recorder(),
});

/** Canonical paragraph attributes (defaults left out), as the document holds them. */
function canonicalParagraph(attrs: Json): Json {
  return (schemaV3.nodeFromJSON({ type: "paragraph", attrs }).toJSON().attrs ?? {}) as Json;
}

/** Canonical marks, ordered by type: comparable whatever order they were read in. */
function canonicalMarks(marks: readonly MarkJSON[]): MarkJSON[] {
  return marks
    .map((m) => schemaV3.markFromJSON(m).toJSON())
    .sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
}

/**
 * Children of `original` named `locals`, as written, when `unchanged`; otherwise `fresh()`.
 * One property may span several children (`w:b` and `w:bCs`).
 */
function child(
  original: Original,
  unchanged: boolean,
  locals: readonly string[],
  fresh: () => string,
): string {
  if (!original || !unchanged) return fresh();
  let out = "";
  for (const c of original.element.children) {
    if (c.kind === "element" && c.ns === W && locals.includes(c.local))
      out += original.source.slice(c.start, c.end);
  }
  return out;
}

function wrap(name: string, original: Original, children: string): string {
  const attributes = attributesOf(original);
  return children || attributes ? `<${name}${attributes}>${children}</${name}>` : "";
}

// ---- w:rPr -------------------------------------------------------------------------------

/** CT_ParaRPr / CT_RPr child order (ECMA-376 Part 1, 17.3.1.29 and 17.3.2.28). */
const RPR_ORDER = [
  "ins",
  "del",
  "moveFrom",
  "moveTo",
  "rStyle",
  "rFonts",
  "b",
  "bCs",
  "i",
  "iCs",
  "caps",
  "smallCaps",
  "strike",
  "dstrike",
  "outline",
  "shadow",
  "emboss",
  "imprint",
  "noProof",
  "snapToGrid",
  "vanish",
  "webHidden",
  "color",
  "spacing",
  "w",
  "kern",
  "position",
  "sz",
  "szCs",
  "highlight",
  "u",
  "effect",
  "bdr",
  "shd",
  "fitText",
  "vertAlign",
  "rtl",
  "cs",
  "em",
  "lang",
  "eastAsianLayout",
  "specVanish",
  "oMath",
  "rPrChange",
];

/** Mark type → the children it is written as. */
const MARK_CHILDREN: Record<string, readonly string[]> = {
  characterStyle: ["rStyle"],
  font: ["rFonts"],
  bold: ["b", "bCs"],
  italic: ["i", "iCs"],
  caps: ["caps"],
  smallCaps: ["smallCaps"],
  strike: ["strike"],
  doubleStrike: ["dstrike"],
  hidden: ["vanish"],
  color: ["color"],
  characterSpacing: ["spacing"],
  fontSize: ["sz", "szCs"],
  highlight: ["highlight"],
  underline: ["u"],
  shading: ["shd"],
  verticalAlign: ["vertAlign"],
  formatChange: ["rPrChange"],
};

function markChildren(m: MarkJSON | undefined, type: string, ns: Namespaces): string {
  if (!m) return "";
  const a = (m.attrs ?? {}) as Json;
  const str = (k: string) => (a[k] === null || a[k] === undefined ? undefined : String(a[k]));
  switch (type) {
    case "characterStyle":
      return val("rStyle", str("id"));
    case "font":
      return el("w:rFonts", {
        "w:ascii": str("ascii"),
        "w:hAnsi": str("hAnsi"),
        "w:eastAsia": str("eastAsia"),
        "w:cs": str("cs"),
        "w:asciiTheme": str("asciiTheme"),
        "w:hAnsiTheme": str("hAnsiTheme"),
        "w:eastAsiaTheme": str("eastAsiaTheme"),
        "w:cstheme": str("csTheme"),
        "w:hint": str("hint"),
      });
    case "bold":
    case "italic": {
      const local = type === "bold" ? "b" : "i";
      const value = a.value === undefined ? true : (a.value as boolean | null);
      return (
        onOff(local, value) + onOff(`${local}Cs`, a.complexScript as boolean | null | undefined)
      );
    }
    case "caps":
    case "smallCaps":
    case "strike":
    case "doubleStrike":
    case "hidden": {
      const local = (MARK_CHILDREN[type] as readonly string[])[0] as string;
      return onOff(local, a.value === undefined ? true : (a.value as boolean));
    }
    case "color":
      return el("w:color", {
        "w:val": str("value"),
        "w:themeColor": str("themeColor"),
        "w:themeTint": str("themeTint"),
        "w:themeShade": str("themeShade"),
      });
    case "characterSpacing":
      return val("spacing", str("value"));
    case "fontSize":
      return val("sz", str("value")) + val("szCs", str("complexScript"));
    case "highlight":
      return val("highlight", str("value"));
    case "underline":
      return el("w:u", { "w:val": str("style") ?? "single", "w:color": str("color") });
    case "shading":
      return el("w:shd", {
        "w:val": str("pattern"),
        "w:color": str("color") ?? "auto",
        "w:fill": str("fill") ?? "auto",
      });
    case "verticalAlign":
      return val("vertAlign", str("value"));
    case "formatChange": {
      const previous = runPropertiesXml(
        (a.previous as MarkJSON[]) ?? [],
        undefined,
        ns,
        "w:rPr",
        true,
      );
      return el(
        "w:rPrChange",
        { "w:id": str("id"), "w:author": str("author") ?? "", "w:date": str("date") },
        previous || "<w:rPr/>",
      );
    }
    default:
      return "";
  }
}

const RUN_MODELED = new Set(Object.values(MARK_CHILDREN).flat());

/**
 * A run's (or a style's, a level's, the defaults') properties as `w:rPr`. `ext` is the `w:rPr`
 * they were read from, if any. `always` writes `<w:rPr/>` even when empty.
 */
export function runPropertiesXml(
  marks: readonly MarkJSON[],
  ext: string | undefined,
  ns: Namespaces,
  name = "w:rPr",
  always = false,
  extra?: { modeled: ReadonlySet<string>; generated: Map<string, string> },
): string {
  const original = ext ? fragment(ext, ns) : undefined;
  if (ext && !original) return ext; // not readable: as it was
  const current = canonicalMarks(marks.filter((m) => Object.hasOwn(MARK_CHILDREN, m.type)));
  const reread = original ? canonicalMarks(runProperties(original.element, reading(original))) : [];
  if (original && same(current, reread) && !extra) return ext as string;
  const generated = new Map(extra?.generated);
  for (const [type, locals] of Object.entries(MARK_CHILDREN)) {
    const now = current.find((m) => m.type === type);
    const before = reread.find((m) => m.type === type);
    const text = child(original, same(now, before), locals, () => markChildren(now, type, ns));
    generated.set(locals[0] as string, text);
    for (const local of locals.slice(1)) generated.set(local, "");
  }
  const modeled = new Set([...RUN_MODELED, ...(extra?.modeled ?? [])]);
  const children = merged(RPR_ORDER, modeled, generated, original);
  return children || attributesOf(original) || always
    ? `<${name}${attributesOf(original)}>${children}</${name}>`
    : "";
}

// ---- w:pPr -------------------------------------------------------------------------------

/** CT_PPr child order (17.3.1.26). */
const PPR_ORDER = [
  "pStyle",
  "keepNext",
  "keepLines",
  "pageBreakBefore",
  "framePr",
  "widowControl",
  "numPr",
  "suppressLineNumbers",
  "pBdr",
  "shd",
  "tabs",
  "suppressAutoHyphens",
  "kinsoku",
  "wordWrap",
  "overflowPunct",
  "topLinePunct",
  "autoSpaceDE",
  "autoSpaceDN",
  "bidi",
  "adjustRightInd",
  "snapToGrid",
  "spacing",
  "ind",
  "contextualSpacing",
  "mirrorIndents",
  "suppressOverlap",
  "jc",
  "textDirection",
  "textAlignment",
  "textboxTightWrap",
  "outlineLvl",
  "divId",
  "cnfStyle",
  "rPr",
  "sectPr",
  "pPrChange",
];

/** Paragraph attribute → its child (the paragraph mark's `w:rPr` holds two attributes). */
const PARAGRAPH_CHILDREN: Record<string, string> = {
  style: "pStyle",
  keepNext: "keepNext",
  keepLines: "keepLines",
  pageBreakBefore: "pageBreakBefore",
  widowControl: "widowControl",
  numbering: "numPr",
  borders: "pBdr",
  shading: "shd",
  tabs: "tabs",
  spacing: "spacing",
  indent: "ind",
  contextualSpacing: "contextualSpacing",
  justification: "jc",
  outlineLevel: "outlineLvl",
  section: "sectPr",
  formatChange: "pPrChange",
};
const PARAGRAPH_MODELED = new Set([...Object.values(PARAGRAPH_CHILDREN), "rPr"]);

const BORDER_SIDES = ["top", "left", "bottom", "right", "between", "bar"];

function paragraphChild(name: string, value: unknown, ns: Namespaces): string {
  if (value === undefined || value === null) return "";
  const v = value as Json;
  const s = (x: unknown) => (x === undefined || x === null ? undefined : String(x));
  switch (name) {
    case "style":
      return val("pStyle", s(value));
    case "keepNext":
    case "keepLines":
    case "pageBreakBefore":
    case "widowControl":
    case "contextualSpacing":
      return onOff(name, value as boolean);
    case "numbering":
      return el("w:numPr", {}, val("ilvl", s(v.level)) + val("numId", s(v.id)));
    case "borders":
      return el(
        "w:pBdr",
        {},
        BORDER_SIDES.map((side) => {
          const b = v[side] as Json | undefined;
          return b
            ? el(`w:${side}`, {
                "w:val": s(b.style),
                "w:sz": s(b.size),
                "w:space": s(b.space),
                "w:color": s(b.color),
                "w:themeColor": s(b.themeColor),
              })
            : "";
        }).join(""),
      );
    case "shading":
      return el("w:shd", {
        "w:val": s(v.pattern),
        "w:color": s(v.color),
        "w:fill": s(v.fill),
        "w:themeFill": s(v.themeFill),
      });
    case "tabs":
      return el(
        "w:tabs",
        {},
        (value as Json[])
          .map((t) =>
            el("w:tab", { "w:val": s(t.kind), "w:leader": s(t.leader), "w:pos": s(t.position) }),
          )
          .join(""),
      );
    case "spacing":
      return el("w:spacing", {
        "w:before": s(v.before),
        "w:beforeAutospacing": v.beforeAutospacing as boolean | undefined,
        "w:after": s(v.after),
        "w:afterAutospacing": v.afterAutospacing as boolean | undefined,
        "w:line": s(v.line),
        "w:lineRule": s(v.lineRule),
      });
    case "indent":
      return el("w:ind", {
        "w:left": s(v.left),
        "w:right": s(v.right),
        "w:hanging": s(v.hanging),
        "w:firstLine": s(v.firstLine),
      });
    case "justification":
      return val("jc", s(value));
    case "outlineLevel":
      return val("outlineLvl", s(value));
    case "section":
      return sectionXml(v, ns);
    case "formatChange": {
      const previous = paragraphPropertiesXml((v.previous as Json) ?? {}, ns, "w:pPr", true);
      return el(
        "w:pPrChange",
        { "w:id": s(v.id), "w:author": s(v.author) ?? "", "w:date": s(v.date) },
        previous || "<w:pPr/>",
      );
    }
    default:
      return "";
  }
}

/** The paragraph mark's `w:rPr`: its tracked insertion or deletion, then its run properties. */
function markRunProperties(attrs: Json, original: Original, ns: Namespaces): string {
  const rPr = original?.element.children.find(
    (c): c is XmlElement => c.kind === "element" && c.ns === W && c.local === "rPr",
  );
  const ext = rPr && original ? original.source.slice(rPr.start, rPr.end) : undefined;
  const revision = (attrs.revision ?? {}) as Json;
  const change = (local: string, r: Json | undefined) =>
    r
      ? el(`w:${local}`, {
          "w:id": String(r.id),
          "w:author": String(r.author ?? ""),
          "w:date": r.date as string | undefined,
        })
      : "";
  const rereadRevision =
    rPr && original
      ? (paragraphProperties(original.element, reading(original), true).revision ?? {})
      : {};
  const generated = new Map<string, string>();
  const unchanged = same(attrs.revision ?? {}, rereadRevision);
  if (unchanged && rPr && original) {
    // As written, moves included.
    const sub = { element: rPr, source: original.source };
    for (const local of ["ins", "del", "moveFrom", "moveTo"])
      generated.set(
        local,
        child(sub, true, [local], () => ""),
      );
  } else {
    generated.set("ins", change("ins", revision.insertion as Json | undefined));
    generated.set("del", change("del", revision.deletion as Json | undefined));
    generated.set("moveFrom", "");
    generated.set("moveTo", "");
  }
  return runPropertiesXml((attrs.markFormat as MarkJSON[]) ?? [], ext, ns, "w:rPr", false, {
    modeled: new Set(["ins", "del", "moveFrom", "moveTo"]),
    generated,
  });
}

/**
 * Paragraph properties (a paragraph's attributes, or a style's, a level's, the defaults') as
 * `w:pPr`; empty when there are none. A paragraph's `ext` is the `w:pPr` it was read from.
 */
export function paragraphPropertiesXml(
  attrs: Json,
  ns: Namespaces,
  name = "w:pPr",
  always = false,
): string {
  const ext = attrs.ext as string | undefined;
  const original = ext ? fragment(ext, ns) : undefined;
  if (ext && !original) return ext;
  const current = canonicalParagraph(
    Object.fromEntries(Object.entries(attrs).filter(([k]) => k !== "attributes")),
  );
  const reread = original
    ? canonicalParagraph(paragraphProperties(original.element, reading(original), true))
    : {};
  if (original && same(current, reread)) return ext as string;
  const generated = new Map<string, string>();
  for (const [prop, local] of Object.entries(PARAGRAPH_CHILDREN)) {
    generated.set(
      local,
      child(original, same(current[prop], reread[prop]), [local], () =>
        paragraphChild(prop, current[prop], ns),
      ),
    );
  }
  generated.set("rPr", markRunProperties(current, original, ns));
  const children = merged(PPR_ORDER, PARAGRAPH_MODELED, generated, original);
  return children || attributesOf(original) || always
    ? `<${name}${attributesOf(original)}>${children}</${name}>`
    : "";
}

// ---- w:sectPr ------------------------------------------------------------------------------

/** CT_SectPr child order (17.6.17). */
const SECT_ORDER = [
  "headerReference",
  "footerReference",
  "footnotePr",
  "endnotePr",
  "type",
  "pgSz",
  "pgMar",
  "paperSrc",
  "pgBorders",
  "lnNumType",
  "pgNumType",
  "cols",
  "formProt",
  "vAlign",
  "noEndnote",
  "titlePg",
  "textDirection",
  "bidi",
  "rtlGutter",
  "docGrid",
  "printerSettings",
  "sectPrChange",
];
const SECTION_CHILDREN: Record<string, readonly string[]> = {
  headers: ["headerReference"],
  footers: ["footerReference"],
  type: ["type"],
  pageSize: ["pgSz"],
  margins: ["pgMar"],
  titlePage: ["titlePg"],
};
const SECTION_MODELED = new Set(Object.values(SECTION_CHILDREN).flat());

function sectionChild(name: string, value: unknown): string {
  if (value === undefined || value === null) return "";
  const v = value as Json;
  const s = (x: unknown) => (x === undefined || x === null ? undefined : String(x));
  const references = (local: string) =>
    Object.entries(v)
      .map(([type, id]) => el(`w:${local}`, { "w:type": type, "r:id": s(id) }))
      .join("");
  switch (name) {
    case "headers":
      return references("headerReference");
    case "footers":
      return references("footerReference");
    case "type":
      return val("type", s(value));
    case "pageSize":
      return el("w:pgSz", { "w:w": s(v.width), "w:h": s(v.height), "w:orient": s(v.orientation) });
    case "margins":
      return el("w:pgMar", {
        "w:top": s(v.top),
        "w:right": s(v.right),
        "w:bottom": s(v.bottom),
        "w:left": s(v.left),
        "w:header": s(v.header),
        "w:footer": s(v.footer),
        "w:gutter": s(v.gutter),
      });
    case "titlePage":
      return onOff("titlePg", value as boolean);
    default:
      return "";
  }
}

/** A section as `w:sectPr` (always written: an empty one is a section break with Word's defaults). */
export function sectionXml(section: Json, ns: Namespaces): string {
  const ext = section.ext as string | undefined;
  const original = ext ? fragment(ext, ns) : undefined;
  if (ext && !original) return ext;
  const reread = original ? readSection(original.element, reading(original)) : {};
  if (original && same({ ...section, ext: undefined }, { ...reread, ext: undefined }))
    return ext as string;
  const generated = new Map<string, string>();
  for (const [prop, locals] of Object.entries(SECTION_CHILDREN)) {
    generated.set(
      locals[0] as string,
      child(original, same(section[prop], reread[prop]), locals, () =>
        sectionChild(prop, section[prop]),
      ),
    );
  }
  const children = merged(SECT_ORDER, SECTION_MODELED, generated, original);
  return `<w:sectPr${attributesOf(original)}>${children}</w:sectPr>`;
}

export { wrap };
