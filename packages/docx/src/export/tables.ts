/**
 * Table, row and cell attributes back to `w:tblPr`, `w:tblPrEx`, `w:trPr`, `w:tcPr` and
 * `w:tblGrid`, as paragraph properties are written: an element read from a file comes back
 * verbatim while its values are what import read from it; otherwise each child is decided on
 * its own, and children Foli does not model stay where Word requires them.
 */

import { cellProperties, grid, rowProperties, tableProperties } from "../import/tables.js";
import type { XmlElement } from "../xml.js";
import { keptOrFresh, reading, same } from "./properties.js";
import { attributesOf, el, fragment, merged, type Namespaces, onOff, val } from "./xmlout.js";

type Json = Record<string, unknown>;
type Reader = (element: XmlElement, context: ReturnType<typeof reading>) => Json;

interface Spec {
  /** The element's name. */
  name: string;
  /** Its children in the order Word requires. */
  order: readonly string[];
  /** Attribute → the children it is written as. */
  children: Readonly<Record<string, readonly string[]>>;
  read: Reader;
  write: (prop: string, value: Json | unknown) => string;
}

const s = (x: unknown) => (x === undefined || x === null ? undefined : String(x));

function measureXml(local: string, m: unknown): string {
  if (!m) return "";
  const v = m as Json;
  return el(`w:${local}`, { "w:w": s(v.value), "w:type": s(v.type) });
}

function borderXml(local: string, b: unknown): string {
  if (!b) return "";
  const v = b as Json;
  return el(`w:${local}`, {
    "w:val": s(v.style),
    "w:sz": s(v.size),
    "w:space": s(v.space),
    "w:color": s(v.color),
    "w:themeColor": s(v.themeColor),
  });
}

const BORDER_SIDES = [
  "top",
  "left",
  "start",
  "bottom",
  "right",
  "end",
  "insideH",
  "insideV",
  "tl2br",
  "tr2bl",
];
const MARGIN_SIDES = ["top", "left", "start", "bottom", "right", "end"];

function sidesXml(name: string, value: unknown, sides: readonly string[], one: typeof borderXml) {
  if (!value) return "";
  const v = value as Json;
  // `start` is `left` (`end` is `right`) under another name: a file with both gets `left`, as
  // Word writes it, never two elements for one side.
  const twin: Record<string, string> = { start: "left", end: "right" };
  return el(
    name,
    {},
    sides
      .filter((side) => !(twin[side] && v[twin[side] as string] !== undefined))
      .map((side) => one(side, v[side]))
      .join(""),
  );
}

function shadingXml(value: unknown): string {
  if (!value) return "";
  const v = value as Json;
  return el("w:shd", {
    "w:val": s(v.pattern),
    "w:color": s(v.color),
    "w:fill": s(v.fill),
    "w:themeFill": s(v.themeFill),
  });
}

const LOOK_BITS: [string, number][] = [
  ["firstRow", 0x0020],
  ["lastRow", 0x0040],
  ["firstColumn", 0x0080],
  ["lastColumn", 0x0100],
  ["noHBand", 0x0200],
  ["noVBand", 0x0400],
];

/** `w:tblLook` as Word writes it: the bit mask and the named attributes. */
function lookXml(value: unknown): string {
  if (!value) return "";
  const v = value as Json;
  const mask = LOOK_BITS.reduce((m, [key, bit]) => (v[key] ? m | bit : m), 0);
  return el("w:tblLook", {
    "w:val": mask.toString(16).toUpperCase().padStart(4, "0"),
    ...Object.fromEntries(LOOK_BITS.map(([key]) => [`w:${key}`, v[key] as boolean | undefined])),
  });
}

const TABLE_CHILDREN: Record<string, readonly string[]> = {
  style: ["tblStyle"],
  rowBandSize: ["tblStyleRowBandSize"],
  columnBandSize: ["tblStyleColBandSize"],
  width: ["tblW"],
  justification: ["jc"],
  cellSpacing: ["tblCellSpacing"],
  indent: ["tblInd"],
  borders: ["tblBorders"],
  shading: ["shd"],
  layout: ["tblLayout"],
  cellMargins: ["tblCellMar"],
  look: ["tblLook"],
};

function tableChild(prop: string, value: unknown): string {
  switch (prop) {
    case "style":
      return val("tblStyle", s(value));
    case "rowBandSize":
      return val("tblStyleRowBandSize", s(value));
    case "columnBandSize":
      return val("tblStyleColBandSize", s(value));
    case "width":
      return measureXml("tblW", value);
    case "justification":
      return val("jc", s(value));
    case "cellSpacing":
      return measureXml("tblCellSpacing", value);
    case "indent":
      return measureXml("tblInd", value);
    case "borders":
      return sidesXml("w:tblBorders", value, BORDER_SIDES, borderXml);
    case "shading":
      return shadingXml(value);
    case "layout":
      return value ? el("w:tblLayout", { "w:type": s(value) }) : "";
    case "cellMargins":
      return sidesXml("w:tblCellMar", value, MARGIN_SIDES, measureXml);
    case "look":
      return lookXml(value);
    default:
      return "";
  }
}

/** CT_TblPr child order (ECMA-376 Part 1, 17.4.60). */
const TABLE: Spec = {
  name: "w:tblPr",
  order: [
    "tblStyle",
    "tblpPr",
    "tblOverlap",
    "bidiVisual",
    "tblStyleRowBandSize",
    "tblStyleColBandSize",
    "tblW",
    "jc",
    "tblCellSpacing",
    "tblInd",
    "tblBorders",
    "shd",
    "tblLayout",
    "tblCellMar",
    "tblLook",
    "tblCaption",
    "tblDescription",
    "tblPrChange",
  ],
  children: TABLE_CHILDREN,
  read: (element, context) => tableProperties(element, context, false),
  write: tableChild,
};

/** CT_TblPrEx (17.4.61): what a row may override. */
const EXCEPTIONS: Spec = {
  name: "w:tblPrEx",
  order: [
    "tblW",
    "jc",
    "tblCellSpacing",
    "tblInd",
    "tblBorders",
    "shd",
    "tblLayout",
    "tblCellMar",
    "tblLook",
    "tblPrExChange",
  ],
  children: Object.fromEntries(
    Object.entries(TABLE_CHILDREN).filter(([, [local]]) =>
      [
        "tblW",
        "jc",
        "tblCellSpacing",
        "tblInd",
        "tblBorders",
        "shd",
        "tblLayout",
        "tblCellMar",
        "tblLook",
      ].includes(local as string),
    ),
  ),
  read: (element, context) => tableProperties(element, context, false),
  write: tableChild,
};

function revisionXml(local: string, r: unknown): string {
  if (!r) return "";
  const v = r as Json;
  return el(`w:${local}`, { "w:id": s(v.id), "w:author": s(v.author) ?? "", "w:date": s(v.date) });
}

/** CT_TrPr (17.4.82; Word writes its children in this order). */
const ROW: Spec = {
  name: "w:trPr",
  order: [
    "cnfStyle",
    "divId",
    "gridBefore",
    "gridAfter",
    "wBefore",
    "wAfter",
    "cantSplit",
    "trHeight",
    "tblHeader",
    "tblCellSpacing",
    "jc",
    "hidden",
    "ins",
    "del",
    "trPrChange",
  ],
  children: {
    gridBefore: ["gridBefore"],
    gridAfter: ["gridAfter"],
    widthBefore: ["wBefore"],
    widthAfter: ["wAfter"],
    cantSplit: ["cantSplit"],
    height: ["trHeight"],
    header: ["tblHeader"],
    revision: ["ins", "del"],
  },
  read: (element, context) => rowProperties(element, context, true),
  write: (prop, value) => {
    const v = (value ?? {}) as Json;
    switch (prop) {
      case "gridBefore":
      case "gridAfter":
        return val(prop, s(value));
      case "widthBefore":
        return measureXml("wBefore", value);
      case "widthAfter":
        return measureXml("wAfter", value);
      case "cantSplit":
        return onOff("cantSplit", value as boolean | undefined);
      case "height":
        return value ? el("w:trHeight", { "w:val": s(v.value), "w:hRule": s(v.rule) }) : "";
      case "header":
        return onOff("tblHeader", value as boolean | undefined);
      case "revision":
        return revisionXml("ins", v.insertion) + revisionXml("del", v.deletion);
      default:
        return "";
    }
  },
};

/** CT_TcPr (17.4.70). */
const CELL: Spec = {
  name: "w:tcPr",
  order: [
    "cnfStyle",
    "tcW",
    "gridSpan",
    "hMerge",
    "vMerge",
    "tcBorders",
    "shd",
    "noWrap",
    "tcMar",
    "textDirection",
    "tcFitText",
    "vAlign",
    "hideMark",
    "headers",
    "cellIns",
    "cellDel",
    "cellMerge",
    "tcPrChange",
  ],
  children: {
    width: ["tcW"],
    gridSpan: ["gridSpan"],
    vMerge: ["vMerge"],
    borders: ["tcBorders"],
    shading: ["shd"],
    noWrap: ["noWrap"],
    margins: ["tcMar"],
    textDirection: ["textDirection"],
    verticalAlign: ["vAlign"],
  },
  read: (element, context) => cellProperties(element, context, false),
  write: (prop, value) => {
    switch (prop) {
      case "width":
        return measureXml("tcW", value);
      case "gridSpan":
        return val("gridSpan", s(value));
      case "vMerge":
        // `<w:vMerge/>` is a continuation, as Word writes it.
        return value === "continue" ? el("w:vMerge") : val("vMerge", s(value));
      case "borders":
        return sidesXml("w:tcBorders", value, BORDER_SIDES, borderXml);
      case "shading":
        return shadingXml(value);
      case "noWrap":
        return onOff("noWrap", value as boolean | undefined);
      case "margins":
        return sidesXml("w:tcMar", value, MARGIN_SIDES, measureXml);
      case "textDirection":
        return val("textDirection", s(value));
      case "verticalAlign":
        return val("vAlign", s(value));
      default:
        return "";
    }
  },
};

/** `attrs` (with their `ext`) as the element `spec` describes; empty when nothing is set unless `always`. */
function propertiesXml(spec: Spec, attrs: Json, ns: Namespaces, always: boolean): string {
  const ext = attrs.ext as string | undefined;
  const local = spec.name.slice(2);
  const original = ext ? fragment(ext, ns, local) : undefined;
  const pick = (json: Json) =>
    Object.fromEntries(Object.keys(spec.children).map((k) => [k, json[k] ?? undefined]));
  const current = pick(attrs);
  const reread = original ? pick(spec.read(original.element, reading(original))) : {};
  if (original && same(current, reread)) return ext as string;
  const generated = new Map<string, string>();
  for (const [prop, locals] of Object.entries(spec.children)) {
    const text = keptOrFresh(original, same(current[prop], reread[prop]), locals, () =>
      spec.write(prop, current[prop]),
    );
    generated.set(locals[0] as string, text);
    for (const other of locals.slice(1)) generated.set(other, "");
  }
  const modeled = new Set(Object.values(spec.children).flat());
  const children = merged(spec.order, modeled, generated, original);
  return children || attributesOf(original) || always
    ? `<${spec.name}${attributesOf(original)}>${children}</${spec.name}>`
    : "";
}

/**
 * A table's `w:tblPr` (always written: Word requires it).
 * @internal
 */
export const tablePropertiesXml = (attrs: Json, ns: Namespaces) =>
  propertiesXml(TABLE, attrs, ns, true);

/** @internal */
export const exceptionsXml = (exceptions: unknown, ns: Namespaces) =>
  exceptions ? propertiesXml(EXCEPTIONS, exceptions as Json, ns, false) : "";

/** @internal */
export const rowPropertiesXml = (attrs: Json, ns: Namespaces) =>
  propertiesXml(ROW, attrs, ns, false);

/** @internal */
export const cellPropertiesXml = (attrs: Json, ns: Namespaces) =>
  propertiesXml(CELL, attrs, ns, false);

/**
 * A new table style's `w:tblPr`, `w:trPr` and `w:tcPr` (empty for a part it does not set).
 * @internal
 */
export const stylePartsXml = (
  style: { table?: unknown; row?: unknown; cell?: unknown },
  ns: Namespaces,
) => ({
  tblPr: style.table ? propertiesXml(TABLE, style.table as Json, ns, false) : "",
  trPr: style.row ? propertiesXml(ROW, style.row as Json, ns, false) : "",
  tcPr: style.cell ? propertiesXml(CELL, style.cell as Json, ns, false) : "",
});

/**
 * `w:tblGrid`: as read while the widths are the same, else written from them.
 * @internal
 */
export function gridXml(attrs: Json, ns: Namespaces): string {
  const widths = (attrs.grid ?? []) as number[];
  const ext = attrs.gridExt as string | undefined;
  if (ext) {
    const original = fragment(ext, ns, "tblGrid");
    if (same(grid(original.element, reading(original)), widths)) return ext;
  }
  return `<w:tblGrid>${widths.map((w) => el("w:gridCol", { "w:w": w })).join("")}</w:tblGrid>`;
}
