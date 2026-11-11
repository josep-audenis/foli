/** The parts beside the document: styles, numbering, theme, comments. */

import type {
  AbstractNumberingJSON,
  CommentJSON,
  NumberingInstanceJSON,
  NumberingLevelJSON,
  StyleJSON,
  ThemeJSON,
} from "@folijs/core";
import type { XmlElement } from "../xml.js";
import { blocks, type ContentContext } from "./content.js";
import { A, attr, child, compact, elements, integer, isW, toggle, W14, W15 } from "./ooxml.js";
import { type Context, paragraphProperties, runProperties, sourceOf } from "./properties.js";

const STYLE_TYPES = ["paragraph", "character", "table", "numbering"];

/** `w:styles`: the document defaults and the styles (each with its `w:style` verbatim). */
export function styles(
  root: XmlElement,
  context: Context,
): { defaults: Record<string, unknown>; styles: StyleJSON[] } {
  const docDefaults = child(root, "docDefaults");
  const pPr = child(child(docDefaults ?? root, "pPrDefault") ?? root, "pPr");
  const rPr = child(child(docDefaults ?? root, "rPrDefault") ?? root, "rPr");
  const paragraph = docDefaults && pPr ? paragraphProperties(pPr, context, false) : {};
  const run = docDefaults && rPr ? runProperties(rPr, context) : [];
  const defaults =
    compact({
      paragraph: Object.keys(paragraph).length ? paragraph : undefined,
      run: run.length ? run : undefined,
    }) ?? {};

  const list: StyleJSON[] = [];
  for (const el of elements(root)) {
    if (!isW(el, "style")) continue;
    const id = attr(el, "styleId");
    const type = attr(el, "type") ?? "paragraph";
    if (!id || id.length > 255 || !STYLE_TYPES.includes(type)) {
      context.report.unmodeled(
        `w:style ${id ?? ""}`,
        "no usable w:styleId or w:type (kept in the original styles part)",
      );
      continue;
    }
    const value = (local: string) => {
      const v = attr(child(el, local), "val");
      return v && v.length <= 255 ? v : undefined;
    };
    const stylePPr = child(el, "pPr");
    const styleRPr = child(el, "rPr");
    const props = stylePPr ? paragraphProperties(stylePPr, context, false) : {};
    const marks = runProperties(styleRPr, context);
    const isDefault = attr(el, "default");
    list.push(
      compact({
        id,
        type: type as StyleJSON["type"],
        name: attr(child(el, "name"), "val")?.slice(0, 255),
        basedOn: value("basedOn"),
        next: value("next"),
        link: value("link"),
        isDefault:
          isDefault === undefined
            ? undefined
            : isDefault === "1" || isDefault === "true" || isDefault === "on",
        paragraph: Object.keys(props).length ? props : undefined,
        run: marks.length ? marks : undefined,
        ext: sourceOf(context, el),
      }) as StyleJSON,
    );
  }
  breakCycles(list, context);
  return { defaults, styles: list };
}

/**
 * A style based on itself through its chain would never resolve: Word ignores the link that
 * closes the cycle, and so does the import (reported). Ids that repeat resolve to the first.
 */
function breakCycles(list: StyleJSON[], context: Context): void {
  const byId = new Map<string, StyleJSON>();
  for (const style of list) if (!byId.has(style.id)) byId.set(style.id, style);
  for (const style of list) {
    const seen = new Set<string>([style.id]);
    let at = style;
    while (at.basedOn !== undefined) {
      if (seen.has(at.basedOn)) {
        context.report.unmodeled(`w:style ${at.id}`, `w:basedOn ${at.basedOn} closes a cycle`);
        delete at.basedOn;
        break;
      }
      seen.add(at.basedOn);
      const next = byId.get(at.basedOn);
      if (!next) break;
      at = next;
    }
  }
}

function level(lvl: XmlElement, context: Context): NumberingLevelJSON | undefined {
  const index = integer(attr(lvl, "ilvl"));
  if (index === undefined || index < 0 || index > 8) {
    context.report.unmodeled("w:lvl", `w:ilvl ${attr(lvl, "ilvl")}`);
    return undefined;
  }
  const value = (local: string) => attr(child(lvl, local), "val");
  const legal = child(lvl, "isLgl");
  const pPr = child(lvl, "pPr");
  const props = pPr ? paragraphProperties(pPr, context, false) : {};
  const run = runProperties(child(lvl, "rPr"), context);
  const json = compact({
    level: index,
    start: integer(value("start")),
    format: value("numFmt"),
    text: value("lvlText"),
    justification: value("lvlJc"),
    restart: integer(value("lvlRestart")),
    legal: legal ? toggle(legal) : undefined,
    suffix: value("suff"),
    style: value("pStyle"),
    paragraph: Object.keys(props).length ? props : undefined,
    run: run.length ? run : undefined,
    ext: sourceOf(context, lvl),
  }) as NumberingLevelJSON;
  return checked(
    json as unknown as Record<string, unknown>,
    LEVEL_CHECKS,
    "w:lvl",
    context,
  ) as unknown as NumberingLevelJSON;
}

/** Per-field checks of a numbering level, so one bad value does not lose the level. */
const LEVEL_CHECKS: Record<string, (v: unknown) => boolean> = {
  start: (v) => Number.isInteger(v) && (v as number) >= 0,
  format: (v) => typeof v === "string" && /^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(v),
  text: (v) => typeof v === "string" && v.length <= 255,
  justification: (v) => ["left", "center", "right", "start", "end"].includes(v as string),
  restart: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 9,
  suffix: (v) => ["tab", "space", "nothing"].includes(v as string),
  style: (v) => typeof v === "string" && v.length > 0 && v.length <= 255,
};

function checked<T extends Record<string, unknown>>(
  json: T,
  checks: Record<string, (v: unknown) => boolean>,
  element: string,
  context: Context,
): T {
  const out: Record<string, unknown> = { ...json };
  for (const [key, ok] of Object.entries(checks)) {
    if (key in out && !ok(out[key])) {
      context.report.unmodeled(element, `${key} ${String(out[key])}`);
      delete out[key];
    }
  }
  return out as T;
}

/** `w:numbering`: abstract definitions and instances (each with its element verbatim). */
export function numbering(
  root: XmlElement,
  context: Context,
): { abstracts: AbstractNumberingJSON[]; instances: NumberingInstanceJSON[] } {
  const abstracts: AbstractNumberingJSON[] = [];
  const instances: NumberingInstanceJSON[] = [];
  for (const el of elements(root)) {
    if (isW(el, "abstractNum")) {
      const id = integer(attr(el, "abstractNumId"));
      if (id === undefined || id < 0) {
        context.report.unmodeled("w:abstractNum", `w:abstractNumId ${attr(el, "abstractNumId")}`);
        continue;
      }
      const seen = new Set<number>();
      const levels: NumberingLevelJSON[] = [];
      for (const lvl of elements(el)) {
        if (!isW(lvl, "lvl")) continue;
        const json = level(lvl, context);
        // A repeated level: Word uses the first.
        if (json && !seen.has(json.level) && levels.length < 9) {
          seen.add(json.level);
          levels.push(json);
        }
      }
      const multi = attr(child(el, "multiLevelType"), "val");
      const link = (local: string) => {
        const v = attr(child(el, local), "val");
        return v && v.length <= 255 ? v : undefined;
      };
      abstracts.push(
        compact({
          id,
          multiLevelType:
            multi && ["singleLevel", "multilevel", "hybridMultilevel"].includes(multi)
              ? multi
              : undefined,
          levels,
          styleLink: link("styleLink"),
          numStyleLink: link("numStyleLink"),
          ext: sourceOf(context, el),
        }) as AbstractNumberingJSON,
      );
    } else if (isW(el, "num")) {
      const id = integer(attr(el, "numId"));
      const abstract = integer(attr(child(el, "abstractNumId"), "val"));
      if (id === undefined || id < 1 || abstract === undefined || abstract < 0) {
        context.report.unmodeled("w:num", `w:numId ${attr(el, "numId")}`);
        continue;
      }
      const seen = new Set<number>();
      const overrides: NonNullable<NumberingInstanceJSON["overrides"]> = [];
      for (const o of elements(el)) {
        if (!isW(o, "lvlOverride")) continue;
        const index = integer(attr(o, "ilvl"));
        if (index === undefined || index < 0 || index > 8 || seen.has(index)) continue;
        seen.add(index);
        const start = integer(attr(child(o, "startOverride"), "val"));
        const lvl = child(o, "lvl");
        const definition = lvl ? level(lvl, context) : undefined;
        overrides.push(
          compact({
            level: index,
            start: start !== undefined && start >= 0 ? start : undefined,
            definition: definition ? { ...definition, level: index } : undefined,
          }) as { level: number },
        );
      }
      instances.push(
        compact({
          id,
          abstract,
          overrides: overrides.length ? overrides : undefined,
          ext: sourceOf(context, el),
        }) as NumberingInstanceJSON,
      );
    }
  }
  return { abstracts, instances };
}

/** As core checks it (ISO 8601 date-time). */
const DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

/** Whether `from`'s chain of parents reaches `target` (a reply that would close a cycle is not kept). */
function repliesTo(byId: ReadonlyMap<number, CommentJSON>, from: number, target: number): boolean {
  const seen = new Set<number>();
  for (
    let at: number | undefined = from;
    at !== undefined && !seen.has(at);
    at = byId.get(at)?.parent
  ) {
    if (at === target) return true;
    seen.add(at);
  }
  return false;
}

const THEME_COLORS = [
  "dk1",
  "lt1",
  "dk2",
  "lt2",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
  "hlink",
  "folHlink",
];

/** `a:theme`'s fonts and colors; undefined when it has neither. */
export function theme(root: XmlElement): ThemeJSON | undefined {
  const a = (el: XmlElement | undefined, local: string) =>
    el?.children.find(
      (c): c is XmlElement => c.kind === "element" && c.ns === A && c.local === local,
    );
  const elementsOf = a(root, "themeElements");
  const fontScheme = a(elementsOf, "fontScheme");
  const font = (local: string) => {
    const f = a(fontScheme, local);
    const face = (name: string) =>
      a(f, name)?.attributes.find((x) => x.local === "typeface")?.value;
    const latin = face("latin");
    return latin === undefined
      ? undefined
      : compact({ latin, eastAsia: face("ea"), cs: face("cs") });
  };
  const major = font("majorFont");
  const minor = font("minorFont");
  const colors: Record<string, string> = {};
  const scheme = a(elementsOf, "clrScheme");
  for (const name of THEME_COLORS) {
    const slot = a(scheme, name);
    const color = slot?.children.find((c): c is XmlElement => c.kind === "element");
    const value = color?.attributes.find(
      (x) => x.local === (color.local === "sysClr" ? "lastClr" : "val"),
    )?.value;
    if (value && /^[0-9A-Fa-f]{6}$/.test(value)) colors[name] = value;
  }
  if (!major || !minor) return undefined;
  return { fonts: { major, minor } as ThemeJSON["fonts"], colors };
}

/**
 * `w:comments`, with replies and resolved state from `commentsExtended` (keyed by the
 * `w14:paraId` of each comment's last paragraph).
 */
export function comments(
  root: XmlElement,
  extended: XmlElement | undefined,
  context: ContentContext,
): CommentJSON[] {
  const byParaId = new Map<string, number>();
  const list: CommentJSON[] = [];
  for (const el of elements(root)) {
    if (!isW(el, "comment")) continue;
    const id = integer(attr(el, "id"));
    if (id === undefined || id < 0) {
      context.report.unmodeled("w:comment", `w:id ${attr(el, "id")}`);
      continue;
    }
    const date = attr(el, "date");
    const content = blocks(el.children, context);
    const paragraphs = elements(el).filter((p) => isW(p, "p"));
    const paraId = paragraphs
      .at(-1)
      ?.attributes.find((x) => x.ns === W14 && x.local === "paraId")?.value;
    if (paraId) byParaId.set(paraId, id);
    list.push(
      compact({
        id,
        author: (attr(el, "author") ?? "").slice(0, 255),
        initials: attr(el, "initials")?.slice(0, 9),
        date: date && DATE.test(date) ? date : undefined,
        content: content.length ? content : [{ type: "paragraph" }],
      }) as CommentJSON,
    );
  }
  if (extended) {
    const byId = new Map(list.map((c) => [c.id, c]));
    for (const ex of elements(extended)) {
      if (ex.ns !== W15 || ex.local !== "commentEx") continue;
      const get = (local: string) =>
        ex.attributes.find((x) => x.ns === W15 && x.local === local)?.value;
      const comment = byId.get(byParaId.get(get("paraId") ?? "") ?? -1);
      if (!comment) continue;
      const parent = byParaId.get(get("paraIdParent") ?? "");
      if (parent !== undefined && !repliesTo(byId, parent, comment.id)) comment.parent = parent;
      const done = get("done");
      if (done !== undefined) comment.done = done === "1" || done === "true";
    }
  }
  return list;
}
