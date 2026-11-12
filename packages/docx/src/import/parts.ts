/** The parts beside the document: styles, numbering, theme, comments. */

import {
  type AbstractNumberingJSON,
  type CommentJSON,
  type MarkJSON,
  type NumberingInstanceJSON,
  type NumberingLevelJSON,
  RUN_PROPERTY_MARKS,
  type StyleJSON,
  schemaV3,
  type ThemeJSON,
} from "@folijs/core";
import type { XmlElement } from "../xml.js";
import { blocks, type ContentContext } from "./content.js";
import { A, attr, child, compact, elements, integer, isW, toggle, W14, W15 } from "./ooxml.js";
import { type Context, onOff, paragraphProperties, runProperties, sourceOf } from "./properties.js";

const STYLE_TYPES = ["paragraph", "character", "table", "numbering"];
/** Word's ids (`w:numId`, `w:abstractNumId`, comment ids): what the model holds. */
const MAX_ID = 2_147_483_647;

/**
 * Run properties as a style, a level or the defaults hold them: a recorded formatting change
 * (`w:rPrChange`) stays in the element's verbatim `ext`.
 */
function runList(rPr: XmlElement | undefined, context: Context): MarkJSON[] {
  return runProperties(rPr, context)
    .filter((m) => RUN_PROPERTY_MARKS.includes(m.type))
    .map((m) => schemaV3.markFromJSON(m).toJSON()); // canonical: default values left out
}

/** An id within what the model holds; reported otherwise. */
function id(
  value: string | undefined,
  min: number,
  element: string,
  context: Context,
): number | undefined {
  const n = integer(value);
  if (n === undefined || n < min || n > MAX_ID) {
    context.report.unmodeled(element, `id ${value} out of range (kept in the original part)`);
    return undefined;
  }
  return n;
}

/** `w:styles`: the document defaults and the styles (each with its element verbatim). */
export function styles(
  root: XmlElement,
  context: Context,
): { defaults: Record<string, unknown>; styles: StyleJSON[] } {
  const docDefaults = child(root, "docDefaults");
  let defaults: Record<string, unknown> = {};
  if (docDefaults) {
    const pPr = child(child(docDefaults, "pPrDefault") ?? docDefaults, "pPr");
    const rPr = child(child(docDefaults, "rPrDefault") ?? docDefaults, "rPr");
    const paragraph = pPr ? paragraphProperties(pPr, context, false) : {};
    const run = runList(rPr, context);
    defaults = {
      ...(Object.keys(paragraph).length ? { paragraph } : {}),
      ...(run.length ? { run } : {}),
      ext: sourceOf(context, docDefaults),
    };
  }

  const list: StyleJSON[] = [];
  for (const el of elements(root)) {
    if (!isW(el, "style")) continue;
    const styleId = attr(el, "styleId");
    const type = attr(el, "type") ?? "paragraph";
    if (!styleId || styleId.length > 255 || !STYLE_TYPES.includes(type)) {
      context.report.unmodeled(
        `w:style ${styleId ?? ""}`,
        "no usable w:styleId or w:type (kept in the original styles part)",
      );
      continue;
    }
    const value = (local: string) => {
      const v = attr(child(el, local), "val");
      return v && v.length <= 255 ? v : undefined;
    };
    const stylePPr = child(el, "pPr");
    const props = stylePPr ? paragraphProperties(stylePPr, context, false) : {};
    const marks = runList(child(el, "rPr"), context);
    const name = attr(child(el, "name"), "val");
    list.push(
      compact({
        id: styleId,
        type: type as StyleJSON["type"],
        name: name !== undefined && name.length <= 255 ? name : undefined,
        basedOn: value("basedOn"),
        next: value("next"),
        link: value("link"),
        isDefault: onOff(el, "default", context),
        paragraph: Object.keys(props).length ? props : undefined,
        run: marks.length ? marks : undefined,
        ext: sourceOf(context, el),
      }) as StyleJSON,
    );
  }
  breakCycles(
    list,
    (s) => s.id,
    (s) => s.basedOn,
    (s) => {
      context.report.unmodeled(`w:style ${s.id}`, `w:basedOn ${s.basedOn} closes a cycle`);
      delete s.basedOn;
    },
  );
  return { defaults, styles: list };
}

/**
 * Following `next` from any item ends: the link that closes a cycle is removed (`cut`), as
 * Word ignores it. Linear: each item is walked once. Ids that repeat resolve to the first.
 */
function breakCycles<T>(
  items: readonly T[],
  key: (item: T) => unknown,
  next: (item: T) => unknown,
  cut: (item: T) => void,
): void {
  const byId = new Map<unknown, number>();
  items.forEach((item, i) => {
    if (!byId.has(key(item))) byId.set(key(item), i);
  });
  const state = new Uint8Array(items.length); // 0 unseen, 1 on the current path, 2 ends
  items.forEach((_, start) => {
    const path: number[] = [];
    let at: number | undefined = start;
    while (at !== undefined && state[at] === 0) {
      state[at] = 1;
      path.push(at);
      const target = next(items[at] as T);
      const following: number | undefined = target === undefined ? undefined : byId.get(target);
      if (following !== undefined && state[following] === 1) {
        cut(items[at] as T);
        break;
      }
      at = following;
    }
    for (const i of path) state[i] = 2;
  });
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
  const run = runList(child(lvl, "rPr"), context);
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
  }) as Record<string, unknown>;
  return checked(json, LEVEL_CHECKS, "w:lvl", context) as unknown as NumberingLevelJSON;
}

/** Per-field checks of a numbering level, so one bad value does not lose the level. */
const LEVEL_CHECKS: Record<string, (v: unknown) => boolean> = {
  start: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_ID,
  format: (v) => typeof v === "string" && /^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(v),
  text: (v) => typeof v === "string" && v.length <= 255,
  justification: (v) => ["left", "center", "right", "start", "end"].includes(v as string),
  restart: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 9,
  legal: (v) => typeof v === "boolean",
  suffix: (v) => ["tab", "space", "nothing"].includes(v as string),
  style: (v) => typeof v === "string" && v.length > 0 && v.length <= 255,
};

function checked(
  json: Record<string, unknown>,
  checks: Record<string, (v: unknown) => boolean>,
  element: string,
  context: Context,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...json };
  for (const [key, ok] of Object.entries(checks)) {
    if (key in out && !ok(out[key])) {
      context.report.unmodeled(element, `${key} ${String(out[key])}`);
      delete out[key];
    }
  }
  return out;
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
      const abstractId = id(attr(el, "abstractNumId"), 0, "w:abstractNum", context);
      if (abstractId === undefined) continue;
      const seen = new Set<number>();
      const levels: NumberingLevelJSON[] = [];
      for (const lvl of elements(el)) {
        if (!isW(lvl, "lvl")) continue;
        const json = level(lvl, context);
        // A repeated level: Word uses the first.
        if (json && !seen.has(json.level)) {
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
          id: abstractId,
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
      const numId = id(attr(el, "numId"), 1, "w:num", context);
      const abstract = id(
        attr(child(el, "abstractNumId"), "val"),
        0,
        "w:num/w:abstractNumId",
        context,
      );
      if (numId === undefined || abstract === undefined) continue;
      const seen = new Set<number>();
      const overrides: NonNullable<NumberingInstanceJSON["overrides"]> = [];
      for (const o of elements(el)) {
        if (!isW(o, "lvlOverride")) continue;
        const index = integer(attr(o, "ilvl"));
        if (index === undefined || index < 0 || index > 8 || seen.has(index)) {
          context.report.unmodeled("w:lvlOverride", `w:ilvl ${attr(o, "ilvl")}`);
          continue;
        }
        seen.add(index);
        const start = integer(attr(child(o, "startOverride"), "val"));
        const startOk = start !== undefined && start >= 0 && start <= MAX_ID;
        if (start !== undefined && !startOk)
          context.report.unmodeled("w:startOverride", `${start}`);
        const lvl = child(o, "lvl");
        const definition = lvl ? level(lvl, context) : undefined;
        overrides.push(
          compact({
            level: index,
            start: startOk ? start : undefined,
            definition: definition ? { ...definition, level: index } : undefined,
          }) as { level: number },
        );
      }
      instances.push(
        compact({
          id: numId,
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

/** `a:theme`'s fonts and colors; undefined (reported) when its fonts are missing or unusable. */
export function theme(root: XmlElement, context: Context): ThemeJSON | undefined {
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
  const usable = (f: Record<string, unknown> | undefined) =>
    f !== undefined && Object.values(f).every((v) => typeof v === "string" && v.length <= 255);
  if (!usable(major) || !usable(minor)) {
    context.report.unmodeled("a:fontScheme", "no usable major and minor fonts (theme left out)");
    return undefined;
  }
  return { fonts: { major, minor } as ThemeJSON["fonts"], colors };
}

/**
 * `w:comments`, with replies and resolved state from `commentsExtended` (keyed by the
 * `w14:paraId` of each comment's last paragraph). Each comment keeps its start tag verbatim
 * (`ext`): values the model cannot hold (a long author, a date without a time) stay there.
 */
export function comments(
  root: XmlElement,
  extended: XmlElement | undefined,
  context: ContentContext,
): CommentJSON[] {
  const byParaId = new Map<string, CommentJSON>();
  const list: CommentJSON[] = [];
  for (const el of elements(root)) {
    if (!isW(el, "comment")) continue;
    const commentId = id(attr(el, "id"), 0, "w:comment", context);
    if (commentId === undefined) continue;
    const date = attr(el, "date");
    const author = attr(el, "author") ?? "";
    const initials = attr(el, "initials");
    if (date !== undefined && !DATE.test(date)) context.report.unmodeled("w:comment@w:date", date);
    if (author.length > 255) context.report.unmodeled("w:comment@w:author", "longer than 255");
    if (initials !== undefined && initials.length > 9) {
      context.report.unmodeled("w:comment@w:initials", "longer than 9");
    }
    const content = blocks(el.children, context);
    const comment = compact({
      id: commentId,
      author: author.length <= 255 ? author : author.slice(0, 255),
      initials: initials !== undefined && initials.length <= 9 ? initials : undefined,
      date: date && DATE.test(date) ? date : undefined,
      content: content.length ? content : [{ type: "paragraph" }],
      ext: context.source.slice(el.start, el.openEnd),
    }) as CommentJSON;
    list.push(comment);
    const paraId = elements(el)
      .filter((p) => isW(p, "p"))
      .at(-1)
      ?.attributes.find((x) => x.ns === W14 && x.local === "paraId")?.value;
    if (paraId && !byParaId.has(paraId)) byParaId.set(paraId, comment);
  }
  if (extended) {
    for (const ex of elements(extended)) {
      if (ex.ns !== W15 || ex.local !== "commentEx") continue;
      const get = (local: string) =>
        ex.attributes.find((x) => x.ns === W15 && x.local === local)?.value;
      const comment = byParaId.get(get("paraId") ?? "");
      if (!comment) continue;
      const parent = byParaId.get(get("paraIdParent") ?? "");
      if (parent && parent !== comment) comment.parent = parent.id;
      const done = onOff(ex, "done", context, W15);
      if (done !== undefined) comment.done = done;
    }
    breakCycles(
      list,
      (c) => c.id,
      (c) => c.parent,
      (c) => {
        context.report.unmodeled(`w:comment ${c.id}`, "a reply closing a cycle of replies");
        delete c.parent;
      },
    );
  }
  return list;
}
