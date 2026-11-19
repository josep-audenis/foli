/**
 * Word's table property elements (`w:tblPr`, `w:tblPrEx`, `w:trPr`, `w:tcPr`, a table style's
 * `w:tblStylePr`) to schema v4 attributes. As for paragraphs, each value is checked on its own
 * against the schema: one the model cannot hold is reported and stays in the element's `ext`.
 */

import { type AttributeSpec, TABLE_CONDITIONS } from "@folijs/core";
import { schema } from "@folijs/core/internal";
import type { XmlElement } from "../xml.js";
import { attr, child, compact, elements, integer, toggle } from "./ooxml.js";
import { type Context, onOff, revisionOf, sourceOf } from "./properties.js";

type Json = Record<string, unknown>;

const specs = (type: string) => schema.nodes[type]?.spec.attrs ?? {};
const TABLE = specs("table");
const ROW = specs("tableRow");
const CELL = specs("tableCell");

const nameOf = (element: XmlElement, local: string) =>
  `${element.prefix ? `${element.prefix}:` : ""}${local}`;

/** Keeps `value` as `name` if the schema accepts it there; reports it otherwise. */
function set(
  out: Json,
  attrs: Readonly<Record<string, AttributeSpec>>,
  name: string,
  value: unknown,
  element: string,
  context: Context,
): void {
  if (value === undefined) return;
  const error = attrs[name]?.validate?.(value);
  if (error) context.report.unmodeled(element, `${name} ${error}`);
  else out[name] = value;
}

/**
 * A measure (`w:tblW`, `w:tcW`, `w:tblInd`, a margin): `w:w` in twips or fiftieths of a percent
 * (`pct`, which Strict files may write as `50%`). Undefined, reported, when unreadable.
 * @internal
 */
export function measure(el: XmlElement | undefined, context: Context): Json | undefined {
  if (!el) return undefined;
  const type = attr(el, "type") ?? "dxa";
  const raw = attr(el, "w");
  const percent = raw?.endsWith("%") ? Number(raw.slice(0, -1)) : Number.NaN;
  const value =
    raw === undefined
      ? 0
      : type === "pct" && Number.isFinite(percent)
        ? Math.round(percent * 50)
        : integer(raw);
  if (value === undefined) {
    context.report.unmodeled(`${el.name}@w:w`, `${raw} is not a whole number`);
    return undefined;
  }
  return { value, type };
}

/**
 * A border element's attributes.
 * @internal
 */
export function border(el: XmlElement, context: Context): Json | undefined {
  const whole = (local: string) => {
    const value = attr(el, local);
    const n = integer(value);
    if (value !== undefined && n === undefined)
      context.report.unmodeled(`${el.name}@${local}`, `${value} is not a whole number`);
    return n;
  };
  return compact({
    style: attr(el, "val"),
    size: whole("sz"),
    space: whole("space"),
    color: attr(el, "color"),
    themeColor: attr(el, "themeColor"),
  });
}

function borders(el: XmlElement | undefined, context: Context): Json | undefined {
  if (!el) return undefined;
  return compact(
    Object.fromEntries(elements(el).map((side) => [side.local, border(side, context)])),
  );
}

function margins(el: XmlElement | undefined, context: Context): Json | undefined {
  if (!el) return undefined;
  return compact(
    Object.fromEntries(elements(el).map((side) => [side.local, measure(side, context)])),
  );
}

/** @internal */
export function shading(el: XmlElement | undefined): Json | undefined {
  if (!el) return undefined;
  return compact({
    pattern: attr(el, "val"),
    color: attr(el, "color"),
    fill: attr(el, "fill"),
    themeFill: attr(el, "themeFill"),
  });
}

/** `w:tblLook`: Word 2010's attributes, or the older `w:val` bit mask. */
const LOOK_BITS: [string, number][] = [
  ["firstRow", 0x0020],
  ["lastRow", 0x0040],
  ["firstColumn", 0x0080],
  ["lastColumn", 0x0100],
  ["noHBand", 0x0200],
  ["noVBand", 0x0400],
];

function look(el: XmlElement | undefined, context: Context): Json | undefined {
  if (!el) return undefined;
  const named = compact(
    Object.fromEntries(LOOK_BITS.map(([key]) => [key, onOff(el, key, context)])),
  );
  if (named) return named;
  const mask = Number.parseInt(attr(el, "val") ?? "", 16);
  if (!Number.isFinite(mask)) return undefined;
  return Object.fromEntries(LOOK_BITS.map(([key, bit]) => [key, (mask & bit) !== 0]));
}

const value = (el: XmlElement | undefined) => attr(el, "val");
const whole = (el: XmlElement | undefined) => integer(attr(el, "val"));
const on = (el: XmlElement | undefined) => (el ? toggle(el) : undefined);

/**
 * `w:tblPr` (or `w:tblPrEx`) as table properties. With `ext`, the element itself is kept
 * verbatim (a table's and a row's exceptions; a style's are in its own `ext`).
 * @internal
 */
export function tableProperties(el: XmlElement | undefined, context: Context, ext: boolean): Json {
  const out: Json = {};
  if (!el) return out;
  const at = (local: string) => child(el, local);
  const keep = (name: string, v: unknown, local: string) =>
    set(out, TABLE, name, v, nameOf(el, local), context);
  keep("style", value(at("tblStyle")), "tblStyle");
  keep("width", measure(at("tblW"), context), "tblW");
  keep("justification", value(at("jc")), "jc");
  keep("indent", measure(at("tblInd"), context), "tblInd");
  keep("layout", attr(at("tblLayout"), "type"), "tblLayout");
  keep("borders", borders(at("tblBorders"), context), "tblBorders");
  keep("cellMargins", margins(at("tblCellMar"), context), "tblCellMar");
  keep("cellSpacing", measure(at("tblCellSpacing"), context), "tblCellSpacing");
  keep("shading", shading(at("shd")), "shd");
  keep("look", look(at("tblLook"), context), "tblLook");
  keep("rowBandSize", whole(at("tblStyleRowBandSize")), "tblStyleRowBandSize");
  keep("columnBandSize", whole(at("tblStyleColBandSize")), "tblStyleColBandSize");
  if (ext) out.ext = sourceOf(context, el);
  return out;
}

/**
 * `w:tblGrid`'s column widths.
 * @internal
 */
export function grid(el: XmlElement | undefined, context: Context): number[] {
  if (!el) return [];
  const widths = elements(el)
    .filter((c) => c.local === "gridCol")
    .map((c) => integer(attr(c, "w")) ?? 0);
  const error = TABLE.grid?.validate?.(widths);
  if (error) {
    context.report.unmodeled(el.name, `grid ${error}`);
    return [];
  }
  return widths;
}

/**
 * `w:trPr` as row properties; with `node`, also the row's revision and the element verbatim.
 * @internal
 */
export function rowProperties(el: XmlElement | undefined, context: Context, node: boolean): Json {
  const out: Json = {};
  if (!el) return out;
  const at = (local: string) => child(el, local);
  const keep = (name: string, v: unknown, local: string) =>
    set(out, ROW, name, v, nameOf(el, local), context);
  const height = at("trHeight");
  if (height) {
    keep(
      "height",
      compact({ value: integer(attr(height, "val")) ?? 0, rule: attr(height, "hRule") }),
      "trHeight",
    );
  }
  keep("cantSplit", on(at("cantSplit")), "cantSplit");
  keep("header", on(at("tblHeader")), "tblHeader");
  keep("gridBefore", whole(at("gridBefore")), "gridBefore");
  keep("widthBefore", measure(at("wBefore"), context), "wBefore");
  keep("gridAfter", whole(at("gridAfter")), "gridAfter");
  keep("widthAfter", measure(at("wAfter"), context), "wAfter");
  if (!node) return out;
  const revision = (local: string) => {
    const change = at(local);
    if (!change) return undefined;
    const { id, author, date } = revisionOf(change);
    return id === undefined ? undefined : compact({ id, author, date: date ?? undefined });
  };
  keep("revision", compact({ insertion: revision("ins"), deletion: revision("del") }), "ins");
  out.ext = sourceOf(context, el);
  return out;
}

/**
 * `w:tcPr` as cell properties; with `node`, also the element verbatim.
 * @internal
 */
export function cellProperties(el: XmlElement | undefined, context: Context, node: boolean): Json {
  const out: Json = {};
  if (!el) return out;
  const at = (local: string) => child(el, local);
  const keep = (name: string, v: unknown, local: string) =>
    set(out, CELL, name, v, nameOf(el, local), context);
  keep("width", measure(at("tcW"), context), "tcW");
  keep("gridSpan", whole(at("gridSpan")), "gridSpan");
  const vMerge = at("vMerge");
  // `<w:vMerge/>` continues the merge above.
  if (vMerge) keep("vMerge", value(vMerge) ?? "continue", "vMerge");
  keep("borders", borders(at("tcBorders"), context), "tcBorders");
  keep("shading", shading(at("shd")), "shd");
  keep("margins", margins(at("tcMar"), context), "tcMar");
  keep("verticalAlign", value(at("vAlign")), "vAlign");
  keep("textDirection", value(at("textDirection")), "textDirection");
  keep("noWrap", on(at("noWrap")), "noWrap");
  if (node) out.ext = sourceOf(context, el);
  return out;
}

const nonEmpty = (json: Json) => (Object.keys(json).length ? json : undefined);

/**
 * A table style's parts (`w:tblPr`, `w:trPr`, `w:tcPr`, `w:tblStylePr`) for its `StyleJSON`.
 * @internal
 */
export function tableStyleParts(
  style: XmlElement,
  context: Context,
  paragraph: (pPr: XmlElement) => Json,
  run: (rPr: XmlElement | undefined) => unknown[],
): Json {
  const parts = (el: XmlElement) => {
    const pPr = child(el, "pPr");
    const marks = run(child(el, "rPr"));
    return {
      paragraph: pPr ? nonEmpty(paragraph(pPr)) : undefined,
      run: marks.length ? marks : undefined,
      table: nonEmpty(tableProperties(child(el, "tblPr"), context, false)),
      row: nonEmpty(rowProperties(child(el, "trPr"), context, false)),
      cell: nonEmpty(cellProperties(child(el, "tcPr"), context, false)),
    };
  };
  const own = parts(style);
  const seen = new Set<string>();
  const conditions: Json[] = [];
  for (const c of elements(style)) {
    if (c.local !== "tblStylePr") continue;
    const type = attr(c, "type") ?? "";
    // A type the model does not know, or one already read (Word uses the first): kept in `ext`.
    if (
      !(TABLE_CONDITIONS as readonly string[]).includes(type) ||
      type === "wholeTable" ||
      seen.has(type)
    ) {
      context.report.unmodeled(`${c.name}@w:type`, `${type} (kept in the style's element)`);
      continue;
    }
    seen.add(type);
    conditions.push(compact({ type, ...parts(c), ext: sourceOf(context, c) }) as Json);
  }
  return (
    compact({
      table: own.table,
      row: own.row,
      cell: own.cell,
      conditions: conditions.length ? conditions : undefined,
    }) ?? {}
  );
}
