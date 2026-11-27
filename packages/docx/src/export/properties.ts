/**
 * Schema v3 attributes and marks back to `w:pPr`, `w:rPr` and `w:sectPr`. An element read from
 * a file comes back verbatim while its values are what import read from it; otherwise each
 * child is decided on its own: one whose property is unchanged is copied from the original
 * (with its unknown attributes), a changed one is written from the model, and children Foli
 * does not model stay where Word requires them.
 */

import type { MarkJSON } from "@folijs/core";
import { schema } from "@folijs/core/internal";
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

/**
 * Structural equality of JSON values, key order aside.
 * @internal
 */
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

/** @internal */
export const reading = (original: NonNullable<Original>) => ({
  source: original.source,
  report: new Recorder(),
});

/** Canonical paragraph attributes (defaults left out), as the document holds them. */
function canonicalParagraph(attrs: Json): Json {
  return (schema.nodeFromJSON({ type: "paragraph", attrs }).toJSON().attrs ?? {}) as Json;
}

/** Canonical marks, ordered by type: comparable whatever order they were read in. */
function canonicalMarks(marks: readonly MarkJSON[]): MarkJSON[] {
  return marks
    .map((m) => schema.markFromJSON(m).toJSON())
    .sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
}

/**
 * Children of `original` named `locals`, as written, when `unchanged`; otherwise `fresh()`.
 * One property may span several children (`w:b` and `w:bCs`).
 * @internal
 */
export function keptOrFresh(
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
        undefined,
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
 * A run's properties as `w:rPr`. `ext` is the `w:rPr` they were read from, if any. `always`
 * writes `<w:rPr/>` even when empty. With `properties` (a style's, a level's, the defaults', a
 * paragraph mark's, a recorded change's previous properties) the model holds no formatting
 * change: a `w:rPrChange` stays as the original has it.
 * @internal
 */
export function runPropertiesXml(
  marks: readonly MarkJSON[],
  ext: string | undefined,
  ns: Namespaces,
  name = "w:rPr",
  always = false,
  extra?: { modeled: ReadonlySet<string>; generated: Map<string, string> },
  properties = false,
): string {
  const original = ext ? fragment(ext, ns, "rPr") : undefined;
  const owned = (type: string) =>
    Object.hasOwn(MARK_CHILDREN, type) && !(properties && type === "formatChange");
  const current = canonicalMarks(marks.filter((m) => owned(m.type)));
  const reread = original
    ? canonicalMarks(
        runProperties(original.element, reading(original)).filter((m) => owned(m.type)),
      )
    : [];
  if (original && same(current, reread) && !extra) return ext as string;
  const generated = new Map(extra?.generated);
  for (const [type, locals] of Object.entries(MARK_CHILDREN)) {
    if (!owned(type)) continue;
    const now = current.find((m) => m.type === type);
    const before = reread.find((m) => m.type === type);
    const text = keptOrFresh(original, same(now, before), locals, () =>
      markChildren(now, type, ns),
    );
    generated.set(locals[0] as string, text);
    for (const local of locals.slice(1)) generated.set(local, "");
  }
  const modeled = new Set([...RUN_MODELED, ...(extra?.modeled ?? [])]);
  if (properties) modeled.delete("rPrChange");
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
  suppressLineNumbers: "suppressLineNumbers",
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
    case "suppressLineNumbers":
      return onOff(name, value as boolean);
    case "numbering":
      return el("w:numPr", {}, val("ilvl", s(v.level)) + val("numId", s(v.id)));
    case "borders":
      return el(
        "w:pBdr",
        {},
        BORDER_SIDES.map((side) => borderXml(side, v[side] as Json | undefined)).join(""),
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
      const previous = paragraphPropertiesXml((v.previous as Json) ?? {}, ns, "w:pPr", true, true);
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
        keptOrFresh(sub, true, [local], () => ""),
      );
  } else {
    generated.set("ins", change("ins", revision.insertion as Json | undefined));
    generated.set("del", change("del", revision.deletion as Json | undefined));
    generated.set("moveFrom", "");
    generated.set("moveTo", "");
  }
  return runPropertiesXml(
    (attrs.markFormat as MarkJSON[]) ?? [],
    ext,
    ns,
    "w:rPr",
    false,
    { modeled: new Set(["ins", "del", "moveFrom", "moveTo"]), generated },
    true,
  );
}

/** What only a paragraph's `w:pPr` has: a style's, a level's, the defaults' keep theirs as written. */
const PARAGRAPH_ONLY = new Set(["section", "formatChange", "revision", "markFormat"]);

/**
 * Paragraph properties as `w:pPr`; empty when there are none. `ext` is the `w:pPr` they were
 * read from. With `properties` (a style's, a level's, the defaults', a recorded change's
 * previous properties) the model does not hold the mark's run properties, a section or a
 * formatting change there: those stay as the original has them.
 * @internal
 */
export function paragraphPropertiesXml(
  attrs: Json,
  ns: Namespaces,
  name = "w:pPr",
  always = false,
  properties = false,
): string {
  const ext = attrs.ext as string | undefined;
  const original = ext ? fragment(ext, ns, "pPr") : undefined;
  const keep = ([k]: [string, unknown]) =>
    k !== "attributes" && !(properties && PARAGRAPH_ONLY.has(k));
  const current = canonicalParagraph(Object.fromEntries(Object.entries(attrs).filter(keep)));
  const reread = original
    ? canonicalParagraph(
        Object.fromEntries(
          Object.entries(
            paragraphProperties(original.element, reading(original), !properties),
          ).filter(keep),
        ),
      )
    : {};
  if (original && same(current, reread)) return ext as string;
  const generated = new Map<string, string>();
  for (const [prop, local] of Object.entries(PARAGRAPH_CHILDREN)) {
    if (properties && PARAGRAPH_ONLY.has(prop)) continue;
    generated.set(
      local,
      keptOrFresh(original, same(current[prop], reread[prop]), [local], () =>
        paragraphChild(prop, current[prop], ns),
      ),
    );
  }
  if (!properties) generated.set("rPr", markRunProperties(current, original, ns));
  const modeled = properties
    ? new Set([...PARAGRAPH_MODELED].filter((l) => !["rPr", "sectPr", "pPrChange"].includes(l)))
    : PARAGRAPH_MODELED;
  const children = merged(PPR_ORDER, modeled, generated, original);
  return children || attributesOf(original) || always
    ? `<${name}${attributesOf(original)}>${children}</${name}>`
    : "";
}

/** A border element (`w:top`…) of `border`; "" for none. */
function borderXml(side: string, border: Json | undefined): string {
  const s = (x: unknown) => (x === undefined || x === null ? undefined : String(x));
  return border
    ? el(`w:${side}`, {
        "w:val": s(border.style),
        "w:sz": s(border.size),
        "w:space": s(border.space),
        "w:color": s(border.color),
        "w:themeColor": s(border.themeColor),
      })
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
  columns: ["cols"],
  pageNumbers: ["pgNumType"],
  pageBorders: ["pgBorders"],
  lineNumbers: ["lnNumType"],
  footnotes: ["footnotePr"],
  endnotes: ["endnotePr"],
  change: ["sectPrChange"],
};
const SECTION_MODELED = new Set(Object.values(SECTION_CHILDREN).flat());

/** `w:footnotePr` or `w:endnotePr`: its children in CT_FtnProps order. */
function noteProperties(local: string, v: Json): string {
  const s = (x: unknown) => (x === undefined ? undefined : String(x));
  const children =
    val("pos", s(v.position)) +
    val("numFmt", s(v.format)) +
    val("numStart", s(v.start)) +
    val("numRestart", s(v.restart));
  return children ? el(`w:${local}`, {}, children) : "";
}

/**
 * The setup a tracked change records, every value it could have changed spelled out: Word finds
 * no change in what the recorded `w:sectPr` leaves out (a `w:cols` without `w:num`, checked with
 * Word 16). One read from a file stays as it was.
 */
function previousSetup(previous: Json): Json {
  if (previous.ext) return previous;
  const size = (previous.pageSize ?? {}) as Json;
  const columns = (previous.columns ?? {}) as Json;
  return {
    ...previous,
    type: previous.type ?? "nextPage",
    pageSize: { ...size, width: size.width ?? 12240, height: size.height ?? 15840 },
    margins: previous.margins ?? {},
    columns: {
      ...columns,
      count: columns.count ?? (columns.widths as unknown[] | undefined)?.length ?? 1,
    },
  };
}

function sectionChild(name: string, value: unknown, ns: Namespaces): string {
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
      // CT_PageMar requires all seven: a missing one takes Word's default.
      return el("w:pgMar", {
        "w:top": s(v.top ?? 1440),
        "w:right": s(v.right ?? 1440),
        "w:bottom": s(v.bottom ?? 1440),
        "w:left": s(v.left ?? 1440),
        "w:header": s(v.header ?? 720),
        "w:footer": s(v.footer ?? 720),
        "w:gutter": s(v.gutter ?? 0),
      });
    case "titlePage":
      return onOff("titlePg", value as boolean);
    case "columns":
      return el(
        "w:cols",
        {
          "w:num": s(v.count),
          "w:sep": v.separator as boolean | undefined,
          "w:space": s(v.space),
          "w:equalWidth": v.equalWidth as boolean | undefined,
        },
        ((v.widths ?? []) as Json[])
          .map((col) => el("w:col", { "w:w": s(col.width), "w:space": s(col.space) }))
          .join(""),
      );
    case "pageBorders":
      return el(
        "w:pgBorders",
        {
          "w:zOrder": s(v.zOrder),
          "w:display": s(v.display),
          "w:offsetFrom": s(v.offsetFrom),
        },
        // CT_PageBorders: top, left, bottom, right.
        ["top", "left", "bottom", "right"]
          .map((side) => borderXml(side, v[side] as Json | undefined))
          .join(""),
      );
    case "lineNumbers":
      return el("w:lnNumType", {
        "w:countBy": s(v.countBy),
        "w:start": s(v.start),
        "w:distance": s(v.distance),
        "w:restart": s(v.restart),
      });
    case "pageNumbers":
      return el("w:pgNumType", { "w:fmt": s(v.format), "w:start": s(v.start) });
    case "footnotes":
      return noteProperties("footnotePr", v);
    case "endnotes":
      return noteProperties("endnotePr", v);
    case "change":
      return el(
        "w:sectPrChange",
        { "w:id": s(v.id), "w:author": s(v.author) ?? "", "w:date": s(v.date) },
        // What the section was: never its header references (CT_SectPrBase has none).
        sectionXml(
          { ...previousSetup(v.previous as Json), headers: undefined, footers: undefined },
          ns,
        ),
      );
    default:
      return "";
  }
}

/**
 * A section as `w:sectPr` (always written: an empty one is a section break with Word's defaults).
 * @internal
 */
export function sectionXml(section: Json, ns: Namespaces): string {
  const ext = section.ext as string | undefined;
  const original = ext ? fragment(ext, ns, "sectPr") : undefined;
  const reread = original ? readSection(original.element, reading(original)) : {};
  if (original && same({ ...section, ext: undefined }, { ...reread, ext: undefined }))
    return ext as string;
  const generated = new Map<string, string>();
  for (const [prop, locals] of Object.entries(SECTION_CHILDREN)) {
    generated.set(
      locals[0] as string,
      keptOrFresh(original, same(section[prop], reread[prop]), locals, () =>
        sectionChild(prop, section[prop], ns),
      ),
    );
  }
  const children = merged(SECT_ORDER, SECTION_MODELED, generated, original);
  return `<w:sectPr${attributesOf(original)}>${children}</w:sectPr>`;
}
