/**
 * Word's property elements (`w:pPr`, `w:rPr`, `w:sectPr`) to schema v3 attributes and marks.
 * Each value is checked on its own against the schema: one Word cannot store in the model
 * (out of range, a unit Foli does not read) is left out and reported, and stays in the
 * element's verbatim `ext`, so nothing is lost.
 */

import { checkSection, type MarkJSON, RUN_PROPERTY_MARKS, schemaV3 } from "@folijs/core";
import type { XmlElement } from "../xml.js";
import { attr, child, compact, elements, integer, isW, R, toggle, W } from "./ooxml.js";
import type { Recorder } from "./report.js";

export interface Context {
  readonly source: string;
  readonly report: Recorder;
}

export function sourceOf(context: Context, element: XmlElement): string {
  return context.source.slice(element.start, element.end);
}

const ATTRIBUTE_NAME = /^[A-Za-z_][\w.-]*(:[A-Za-z_][\w.-]*)?$/;

/**
 * An element's attributes not in `modeled`, as an `attributes` bag (undefined when none). One
 * the bag cannot hold (a name outside its pattern, a value over 64 KiB, past 64) is reported.
 */
export function attributeBag(
  element: XmlElement,
  modeled: readonly string[],
  context: Context,
): Record<string, string> | undefined {
  const bag: Record<string, string> = {};
  let count = 0;
  for (const a of element.attributes) {
    if (modeled.includes(a.name)) continue;
    if (!ATTRIBUTE_NAME.test(a.name) || a.value.length > 65_535 || count === 64) {
      context.report.unmodeled(`${element.name}@${a.name}`, "not kept as an attribute");
      continue;
    }
    Object.defineProperty(bag, a.name, {
      value: a.value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    count++;
  }
  return count ? bag : undefined;
}

const PARAGRAPH_ATTRS = schemaV3.nodes.paragraph?.spec.attrs ?? {};

/** Keeps `value` as paragraph attribute `name` if the schema accepts it; reports it otherwise. */
export function setParagraph(
  out: Record<string, unknown>,
  name: string,
  value: unknown,
  element: string,
  context: Context,
): void {
  if (value === undefined) return;
  const error = PARAGRAPH_ATTRS[name]?.validate?.(value);
  if (error) context.report.unmodeled(element, `${name} ${error}`);
  else out[name] = value;
}

/** The mark if the schema accepts it; reported and left out otherwise. */
export function mark(json: MarkJSON, element: string, context: Context): MarkJSON | undefined {
  try {
    schemaV3.markFromJSON(json);
    return json;
  } catch (error) {
    context.report.unmodeled(element, (error as Error).message);
    return undefined;
  }
}

/** Who and when, for tracked changes (`w:ins`, `w:del`, `w:rPrChange`…). */
export function revisionOf(element: XmlElement): {
  id: number | undefined;
  author: string;
  date: string | null;
} {
  return {
    id: integer(attr(element, "id")),
    author: attr(element, "author") ?? "",
    date: attr(element, "date") ?? null,
  };
}

/**
 * A tracked change's mark (`insertion`, `deletion`, with `move` for `w:moveFrom`/`w:moveTo`).
 * An invalid date is left out rather than losing the change.
 */
export function revisionMark(
  type: "insertion" | "deletion",
  element: XmlElement,
  move: string | null,
  context: Context,
): MarkJSON | undefined {
  const { id, author, date } = revisionOf(element);
  if (id === undefined) {
    context.report.unmodeled(element.name, "no w:id");
    return undefined;
  }
  const attributes = attributeBag(element, ["w:id", "w:author", "w:date"], context) ?? null;
  const attrs = { id, author, date, move, attributes };
  return (
    mark({ type, attrs }, element.name, context) ??
    mark({ type, attrs: { ...attrs, date: null } }, element.name, context)
  );
}

const TOGGLES: Record<string, string> = {
  strike: "strike",
  dstrike: "doubleStrike",
  caps: "caps",
  smallCaps: "smallCaps",
  vanish: "hidden",
};

/**
 * `w:rPr`'s run properties as marks (without `runExt`, the caller's). Tracked changes of the
 * paragraph mark (`w:ins`/`w:del` in a paragraph's `w:rPr`) are not run properties: see
 * `paragraphRevision`.
 */
export function runProperties(rPr: XmlElement | undefined, context: Context): MarkJSON[] {
  if (!rPr) return [];
  const marks: (MarkJSON | undefined)[] = [];
  const name = (local: string) => `${rPr.prefix ? `${rPr.prefix}:` : ""}${local}`;
  const twin = (main: string, cs: string, type: string) => {
    const read = (el: XmlElement | undefined) => {
      if (!el) return null;
      const value = toggle(el);
      if (value === undefined) context.report.unmodeled(el.name, `w:val ${attr(el, "val")}`);
      return value ?? null;
    };
    const value = read(child(rPr, main));
    const complexScript = read(child(rPr, cs));
    if (value === null && complexScript === null) return;
    marks.push(mark({ type, attrs: { value, complexScript } }, name(main), context));
  };
  twin("b", "bCs", "bold");
  twin("i", "iCs", "italic");
  for (const el of elements(rPr)) {
    if (!isW(el)) continue;
    const val = attr(el, "val");
    switch (el.local) {
      case "rStyle":
        if (val !== undefined)
          marks.push(mark({ type: "characterStyle", attrs: { id: val } }, el.name, context));
        break;
      case "u":
        marks.push(
          mark(
            {
              type: "underline",
              attrs: { style: val ?? "single", color: attr(el, "color") ?? null },
            },
            el.name,
            context,
          ),
        );
        break;
      case "rFonts":
        marks.push(
          mark(
            {
              type: "font",
              attrs: {
                ascii: attr(el, "ascii") ?? null,
                hAnsi: attr(el, "hAnsi") ?? null,
                eastAsia: attr(el, "eastAsia") ?? null,
                cs: attr(el, "cs") ?? null,
                asciiTheme: attr(el, "asciiTheme") ?? null,
                hAnsiTheme: attr(el, "hAnsiTheme") ?? null,
                eastAsiaTheme: attr(el, "eastAsiaTheme") ?? null,
                // ECMA-376 spells it `w:cstheme`; some writers use `w:csTheme`.
                csTheme: attr(el, "cstheme") ?? attr(el, "csTheme") ?? null,
                hint: attr(el, "hint") ?? null,
              },
            },
            el.name,
            context,
          ),
        );
        break;
      case "sz":
      case "szCs": {
        if (el.local === "szCs" && child(rPr, "sz")) break; // read with sz
        const sz = child(rPr, "sz");
        const szCs = child(rPr, "szCs");
        marks.push(
          mark(
            {
              type: "fontSize",
              attrs: {
                value: whole(sz, "val", context) ?? null,
                complexScript: whole(szCs, "val", context) ?? null,
              },
            },
            el.name,
            context,
          ),
        );
        break;
      }
      case "color":
        marks.push(
          mark(
            {
              type: "color",
              attrs: {
                value: val ?? "auto",
                themeColor: attr(el, "themeColor") ?? null,
                themeTint: attr(el, "themeTint") ?? null,
                themeShade: attr(el, "themeShade") ?? null,
              },
            },
            el.name,
            context,
          ),
        );
        break;
      case "highlight":
        marks.push(mark({ type: "highlight", attrs: { value: val } }, el.name, context));
        break;
      case "shd":
        marks.push(
          mark(
            {
              type: "shading",
              attrs: {
                pattern: val,
                color: attr(el, "color") ?? "auto",
                fill: attr(el, "fill") ?? "auto",
              },
            },
            el.name,
            context,
          ),
        );
        break;
      case "vertAlign":
        marks.push(mark({ type: "verticalAlign", attrs: { value: val } }, el.name, context));
        break;
      case "spacing":
        marks.push(
          mark({ type: "characterSpacing", attrs: { value: integer(val) } }, el.name, context),
        );
        break;
      case "rPrChange": {
        const { id, author, date } = revisionOf(el);
        const previous = runProperties(child(el, "rPr"), context);
        const change = { type: "formatChange", attrs: { id, author, date, previous } };
        marks.push(
          mark(change, el.name, context) ??
            mark({ ...change, attrs: { ...change.attrs, date: null } }, el.name, context),
        );
        break;
      }
      default: {
        const type = Object.hasOwn(TOGGLES, el.local) ? TOGGLES[el.local] : undefined;
        if (type) {
          const value = toggle(el);
          if (value === undefined) context.report.unmodeled(el.name, `w:val ${val}`);
          else marks.push(mark({ type, attrs: { value } }, el.name, context));
        }
      }
    }
  }
  return marks.filter((m): m is MarkJSON => m !== undefined);
}

/** A paragraph mark's tracked insertion and deletion (`w:pPr/w:rPr/w:ins`, `w:del`, moves). */
function paragraphRevision(rPr: XmlElement | undefined): Record<string, unknown> | undefined {
  if (!rPr) return undefined;
  const pick = (...locals: string[]) => {
    const el = elements(rPr).find((e) => locals.some((local) => isW(e, local)));
    if (!el) return undefined;
    const { id, author, date } = revisionOf(el);
    return id === undefined ? undefined : compact({ id, author, date: date ?? undefined });
  };
  return compact({ insertion: pick("ins", "moveTo"), deletion: pick("del", "moveFrom") });
}

/**
 * An integer attribute; a value that is there but not an integer (a universal measure such as
 * `1.5cm`, a decimal) is reported and read as missing.
 */
function whole(
  element: XmlElement | undefined,
  local: string,
  context: Context,
): number | undefined {
  const value = attr(element, local);
  const n = integer(value);
  if (element && value !== undefined && n === undefined) {
    context.report.unmodeled(`${element.name}@${local}`, `${value} is not a whole number`);
  }
  return n;
}

/** An ST_OnOff attribute (`w:beforeAutospacing="1"`); another value is reported, read as missing. */
export function onOff(
  element: XmlElement | undefined,
  local: string,
  context: Context,
  ns = W,
): boolean | undefined {
  const value = attr(element, local, ns);
  if (value === undefined) return undefined;
  if (value === "1" || value === "true" || value === "on") return true;
  if (value === "0" || value === "false" || value === "off") return false;
  context.report.unmodeled(`${element?.name}@${local}`, `${value} is not on or off`);
  return undefined;
}

const toggleProperty = (el: XmlElement | undefined) => (el ? toggle(el) : undefined);

/**
 * `w:pPr` as paragraph attributes. With `paragraph`, also what only a paragraph has (its
 * section, the paragraph mark's revisions, a formatting change, the verbatim `ext`).
 */
export function paragraphProperties(
  pPr: XmlElement | undefined,
  context: Context,
  paragraph: boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!pPr) return out;
  const at = (local: string) => child(pPr, local);
  const set = (name: string, value: unknown, local: string) =>
    setParagraph(out, name, value, `${pPr.prefix ? `${pPr.prefix}:` : ""}${local}`, context);
  set("style", attr(at("pStyle"), "val"), "pStyle");
  set("justification", attr(at("jc"), "val"), "jc");
  const ind = at("ind");
  if (ind) {
    set(
      "indent",
      compact({
        left: whole(ind, attr(ind, "left") === undefined ? "start" : "left", context),
        right: whole(ind, attr(ind, "right") === undefined ? "end" : "right", context),
        firstLine: whole(ind, "firstLine", context),
        hanging: whole(ind, "hanging", context),
      }),
      "ind",
    );
  }
  const spacing = at("spacing");
  if (spacing) {
    const auto = (local: string) => onOff(spacing, local, context);
    set(
      "spacing",
      compact({
        before: whole(spacing, "before", context),
        after: whole(spacing, "after", context),
        line: whole(spacing, "line", context),
        lineRule: attr(spacing, "lineRule"),
        beforeAutospacing: auto("beforeAutospacing"),
        afterAutospacing: auto("afterAutospacing"),
      }),
      "spacing",
    );
  }
  for (const [name, local] of [
    ["keepNext", "keepNext"],
    ["keepLines", "keepLines"],
    ["widowControl", "widowControl"],
    ["pageBreakBefore", "pageBreakBefore"],
    ["contextualSpacing", "contextualSpacing"],
  ] as const) {
    set(name, toggleProperty(at(local)), local);
  }
  set("outlineLevel", whole(at("outlineLvl"), "val", context), "outlineLvl");
  const numPr = at("numPr");
  if (numPr)
    set(
      "numbering",
      compact({
        id: whole(child(numPr, "numId"), "val", context),
        level: whole(child(numPr, "ilvl"), "val", context),
      }),
      "numPr",
    );
  const tabs = at("tabs");
  if (tabs) {
    set(
      "tabs",
      elements(tabs)
        .filter((t) => isW(t, "tab"))
        .map((t) =>
          compact({
            position: whole(t, "pos", context),
            kind: attr(t, "val"),
            leader: attr(t, "leader"),
          }),
        ),
      "tabs",
    );
  }
  const pBdr = at("pBdr");
  if (pBdr) {
    const borders: Record<string, unknown> = {};
    for (const side of elements(pBdr)) {
      borders[side.local] = compact({
        style: attr(side, "val"),
        size: whole(side, "sz", context),
        space: whole(side, "space", context),
        color: attr(side, "color"),
        themeColor: attr(side, "themeColor"),
      });
    }
    set("borders", compact(borders), "pBdr");
  }
  const shd = at("shd");
  if (shd)
    set(
      "shading",
      compact({
        pattern: attr(shd, "val"),
        color: attr(shd, "color"),
        fill: attr(shd, "fill"),
        themeFill: attr(shd, "themeFill"),
      }),
      "shd",
    );
  const rPr = at("rPr");
  // The mark's recorded formatting change stays in `ext`: a list of run properties holds none.
  const markFormat = runProperties(rPr, context)
    .filter((m) => RUN_PROPERTY_MARKS.includes(m.type))
    .map((m) => schemaV3.markFromJSON(m).toJSON());
  if (markFormat.length) set("markFormat", markFormat, "rPr");
  if (!paragraph) return out;

  set("revision", paragraphRevision(rPr), "rPr");
  const sectPr = at("sectPr");
  if (sectPr) set("section", section(sectPr, context), "sectPr");
  const change = at("pPrChange");
  if (change) {
    const { id, author, date } = revisionOf(change);
    set(
      "formatChange",
      compact({
        id,
        author,
        date: date ?? undefined,
        previous: paragraphProperties(child(change, "pPr"), context, false),
      }),
      "pPrChange",
    );
  }
  out.ext = sourceOf(context, pPr);
  return out;
}

/** `w:sectPr` as a section; every part checked on its own. */
export function section(sectPr: XmlElement, context: Context): Record<string, unknown> {
  const pgSz = child(sectPr, "pgSz");
  const pgMar = child(sectPr, "pgMar");
  const references = (local: string) =>
    compact(
      Object.fromEntries(
        elements(sectPr)
          .filter((el) => isW(el, local))
          .map((el) => [attr(el, "type") ?? "default", attr(el, "id", R)]),
      ),
    );
  const titlePg = child(sectPr, "titlePg");
  const parts: Record<string, unknown> = {
    pageSize:
      pgSz &&
      compact({
        width: whole(pgSz, "w", context),
        height: whole(pgSz, "h", context),
        orientation: attr(pgSz, "orient"),
      }),
    margins:
      pgMar &&
      compact({
        top: whole(pgMar, "top", context),
        right: whole(pgMar, "right", context),
        bottom: whole(pgMar, "bottom", context),
        left: whole(pgMar, "left", context),
        header: whole(pgMar, "header", context),
        footer: whole(pgMar, "footer", context),
        gutter: whole(pgMar, "gutter", context),
      }),
    type: attr(child(sectPr, "type"), "val"),
    titlePage: titlePg ? toggle(titlePg) : undefined,
    headers: references("headerReference"),
    footers: references("footerReference"),
  };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parts)) {
    if (value === undefined) continue;
    const error = checkSection({ [key]: value });
    if (error) context.report.unmodeled(`${sectPr.name}`, error);
    else out[key] = value;
  }
  out.ext = sourceOf(context, sectPr);
  return out;
}
