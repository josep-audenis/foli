/**
 * Updating and inserting Word's fields (ADR-0007, 11.8). A field's result is worked out from its
 * instruction, as Word's switches say, and put between its separator and end; a table of contents
 * is rebuilt from the headings as Word builds it. Everything happens in one transaction, recorded
 * as tracked changes when tracking is on; what cannot be worked out keeps its result and is
 * reported. Page numbers come from `FieldLayout`, which only a view has.
 */

import {
  Fragment,
  type Mark,
  type Node,
  type NodeType,
  type Schema,
  Slice,
} from "../model/index.js";
import { TransformError } from "../transform/transform.js";
import type { SectionJSON } from "../v3/document.js";
import { formatNumber, type ListMarker } from "../v3/resolve.js";
import { attempt } from "./attempt.js";
import { controlEdit } from "./controls.js";
import type { Editor } from "./editor.js";
import { type Field, fieldAround, fieldsIn } from "./fields.js";
import { closeHistory, joinHistory } from "./history.js";
import { freshId, idsOf } from "./ids.js";
import { marksAt, TextSelection } from "./selection.js";
import type { Command, EditorState, Transaction } from "./state.js";
import { trackState, trackTransaction, untracked } from "./track.js";
import {
  otherTrees,
  type Story,
  StoryStep,
  storyBody,
  storyEdit,
  type WordContext,
  type WordEnvelope,
  withEnvelope,
  wordContext,
} from "./word.js";
import { ensureStyle } from "./wordformat.js";

// ---------- instructions ----------

/** A field's instruction in parts. Switch keys: the letter in lower case, or `*`, `@`, `#`. */
export interface FieldInstruction {
  name: string;
  args: string[];
  switches: Map<string, string[]>;
}

/** The switches of each field that take a value (`\*`, `\@` and `\#` always do). */
const WITH_VALUE: Record<string, string> = {
  SEQ: "rs",
  TOC: "abcdflnopst",
  MERGEFIELD: "bf",
  REF: "d",
  HYPERLINK: "lot",
};
const GENERAL = "*@#";

/** Word's quoting: `"…"`, with `\"` and `\\` inside; a switch is `\` and one character. */
function tokens(text: string): { value: string; quoted: boolean }[] {
  const out: { value: string; quoted: boolean }[] = [];
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i] as string)) i++;
    else if (text[i] === '"') {
      let value = "";
      for (i++; i < text.length && text[i] !== '"'; i++) {
        if (text[i] === "\\" && (text[i + 1] === '"' || text[i + 1] === "\\")) i++;
        value += text[i];
      }
      i++;
      out.push({ value, quoted: true });
    } else {
      const start = i;
      while (i < text.length && !/[\s"]/.test(text[i] as string)) i++;
      out.push({ value: text.slice(start, i), quoted: false });
    }
  }
  return out;
}

export function parseFieldInstruction(text: string): FieldInstruction {
  const parts = tokens(text);
  const name = (parts[0]?.value ?? "").toUpperCase();
  const takesValue = GENERAL + (WITH_VALUE[name] ?? "");
  const args: string[] = [];
  const switches = new Map<string, string[]>();
  for (let i = 1; i < parts.length; i++) {
    const { value, quoted } = parts[i] as { value: string; quoted: boolean };
    if (quoted || !value.startsWith("\\") || value.length < 2) {
      args.push(value);
      continue;
    }
    const letter = (value[1] as string).toLowerCase();
    let given = value.slice(2);
    const next = parts[i + 1];
    if (!given && takesValue.includes(letter) && next && (next.quoted || next.value[0] !== "\\")) {
      given = next.value;
      i++;
    }
    switches.set(letter, [...(switches.get(letter) ?? []), given]);
  }
  return { name, args, switches };
}

const MONTHS =
  "January February March April May June July August September October November December".split(
    " ",
  );
const DAYS = "Sunday Monday Tuesday Wednesday Thursday Friday Saturday".split(" ");
const pad = (n: number, size = 2) => String(n).padStart(size, "0");

const names = new Map<string, readonly string[][]>();
/** A language's month and day names, long and short (`Intl`'s, standalone); English without one. */
function namesOf(locale: string | undefined): readonly string[][] {
  if (!locale || /^en(-|$)/i.test(locale)) return [MONTHS, DAYS];
  let found = names.get(locale);
  if (!found) {
    try {
      const of = (options: Intl.DateTimeFormatOptions, dates: Date[]) => {
        const format = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
        return dates.map((d) => format.format(d));
      };
      const months = Array.from({ length: 12 }, (_, m) => new Date(Date.UTC(2024, m, 1)));
      // 7 January 2024 was a Sunday.
      const days = Array.from({ length: 7 }, (_, d) => new Date(Date.UTC(2024, 0, 7 + d)));
      found = [
        of({ month: "long" }, months),
        of({ weekday: "long" }, days),
        of({ month: "short" }, months),
        of({ weekday: "short" }, days),
      ];
    } catch {
      found = [MONTHS, DAYS];
    }
    names.set(locale, found);
  }
  return found;
}

/**
 * A date in a Word date picture (`\@`); month and day names in `locale` (a BCP 47 tag; English
 * without one).
 * shortcut: a field's own language (`w:lang`) is not read: its names are English when Foli updates
 * it; read it when the model keeps a run's language.
 */
export function formatDatePicture(date: Date, picture: string, locale?: string): string {
  const [months = MONTHS, days = DAYS, shortMonths, shortDays] = namesOf(locale);
  const hours12 = date.getHours() % 12 || 12;
  const parts: Record<string, string> = {
    d: String(date.getDate()),
    dd: pad(date.getDate()),
    ddd: shortDays?.[date.getDay()] ?? (days[date.getDay()] as string).slice(0, 3),
    dddd: days[date.getDay()] as string,
    M: String(date.getMonth() + 1),
    MM: pad(date.getMonth() + 1),
    MMM: shortMonths?.[date.getMonth()] ?? (months[date.getMonth()] as string).slice(0, 3),
    MMMM: months[date.getMonth()] as string,
    yy: pad(date.getFullYear() % 100),
    yyyy: String(date.getFullYear()),
    h: String(hours12),
    hh: pad(hours12),
    H: String(date.getHours()),
    HH: pad(date.getHours()),
    m: String(date.getMinutes()),
    mm: pad(date.getMinutes()),
    s: String(date.getSeconds()),
    ss: pad(date.getSeconds()),
  };
  const noon = date.getHours() < 12;
  const pattern = /'([^']*)'|AM\/PM|am\/pm|A\/P|a\/p|[dD]+|M+|[yY]+|h+|H+|m+|s+/g;
  return picture.replace(pattern, (match, quoted) => {
    if (quoted !== undefined) return quoted as string;
    if (match.includes("/")) return (noon ? match.split("/")[0] : match.split("/")[1]) as string;
    // Word takes d and y in either case; M and m, H and h differ.
    return parts[/^[dy]/i.test(match) ? match.toLowerCase() : match] ?? match;
  });
}

/**
 * A number in a Word numeric picture (`\#`), as Word 16 writes it: `0` a digit, `#` a digit or a
 * space, `x` a digit, dropping those to its left (after the point: nothing when no digit is left),
 * `,` groups thousands, `+` and `-` the sign where they stand, `'…'` and any other character as
 * they are, `;` sections for negative numbers and zero. Null for what is not followed (a sequence
 * number in backquotes, a second point, a comma in the decimals, a number too large to write out).
 */
export function formatNumericPicture(value: number, picture: string): string | null {
  const sections: string[] = [""];
  let quoted = false;
  for (const c of picture) {
    if (c === "'") quoted = !quoted;
    if (c === ";" && !quoted) sections.push("");
    else sections[sections.length - 1] += c;
  }
  const negative = value < 0 && sections[1] !== undefined;
  const zero = value === 0 && sections[2] !== undefined;
  const chosen = (negative ? sections[1] : zero ? sections[2] : sections[0]) as string;
  const out: string[] = [];
  const whole: { at: number; slot: string }[] = [];
  const decimals: { at: number; slot: string }[] = [];
  const signs: { at: number; sign: string }[] = [];
  let point = false;
  let grouped = false;
  quoted = false;
  for (const c of chosen) {
    if (c === "'") quoted = !quoted;
    else if (quoted) out.push(c);
    else if (c === "`") return null;
    else if (c === "0" || c === "#" || c === "x") {
      (point ? decimals : whole).push({ at: out.length, slot: c });
      out.push("");
    } else if (c === ".") {
      if (point) return null;
      point = true;
      out.push(".");
    } else if (c === ",") {
      if (point) return null;
      grouped = true;
    } else if (c === "+" || c === "-") {
      signs.push({ at: out.length, sign: c });
      out.push("");
    } else out.push(c);
  }
  const size = Math.abs(value);
  if (!Number.isFinite(size) || size >= 1e21) return null;
  // `toFixed` stops at 100 places; what a picture asks beyond them is zeros.
  const [digits = "", written = ""] = size.toFixed(Math.min(decimals.length, 100)).split(".");
  const fraction = written.padEnd(decimals.length, "0");
  const integer = digits === "0" ? "" : digits;
  const isZero = !integer && !/[1-9]/.test(fraction);
  let d = integer.length - 1;
  let place = 0;
  const grouping = (text: string) =>
    grouped && place > 0 && place % 3 === 0 && text !== " " ? `${text},` : text;
  for (let i = whole.length - 1; i >= 0; i--, place++) {
    const { at, slot } = whole[i] as { at: number; slot: string };
    out[at] = grouping(d >= 0 ? (integer[d--] as string) : slot === "0" ? "0" : " ");
  }
  // Digits beyond the slots go before the first, unless that is an `x`, which drops them.
  const first = whole[0];
  // Digits an `x` dropped take the sign with them.
  const cut = d >= 0 && first?.slot === "x";
  if (first && first.slot !== "x")
    for (; d >= 0; d--, place++) out[first.at] = grouping(integer[d] as string) + out[first.at];
  decimals.forEach(({ at, slot }, i) => {
    const rest = fraction.slice(i);
    const digit = rest[0] as string;
    if (slot === "0" || /[1-9]/.test(rest)) out[at] = digit;
    // A zero shows its first decimal, whatever the slot.
    else if (isZero && i === 0) out[at] = "0";
    else out[at] = slot === "#" ? " " : "";
  });
  for (const { at, sign } of signs)
    out[at] = isZero ? " " : value < 0 ? "-" : sign === "+" ? "+" : " ";
  if (value < 0 && !negative && !isZero && !signs.length && !cut) {
    const start = whole.find(({ slot }) => slot !== "x");
    if (start) out[start.at] = `-${out[start.at]}`;
  }
  return out.join("");
}

/**
 * A merge value read as a date by `\@`: ISO 8601 only (`2026-03-05`, with a time and zone or
 * not; a space for the `T`, as SQL writes it), never what `Date.parse` guesses (`"12"` is not
 * 2001-12-01).
 * shortcut: the document's language is not known here, so its numeric form (`5/3/2026`) shows
 * as written; read it when a field's language is.
 */
const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

const NUMBER_SWITCH: Record<string, string> = {
  ROMAN: "upperRoman",
  roman: "lowerRoman",
  ALPHABETIC: "upperLetter",
  alphabetic: "lowerLetter",
};
const NUMBER_SWITCH_ANY_CASE: Record<string, string> = {
  arabic: "decimal",
  arabicdash: "numberInDash",
  ordinal: "ordinal",
};
const CASE_SWITCH: Record<string, (text: string) => string> = {
  upper: (text) => text.toUpperCase(),
  lower: (text) => text.toLowerCase(),
  firstcap: (text) => text.charAt(0).toUpperCase() + text.slice(1),
  caps: (text) => text.replace(/(^|\s)(\S)/g, (_, space, c: string) => space + c.toUpperCase()),
};
const KEEPS_FORMAT = new Set(["mergeformat", "charformat"]);

/** `value` as the `\#` and `\*` switches say; null when a `\*` is not one Foli knows. */
function formatted(
  value: string | number,
  instruction: FieldInstruction,
  numberFormat?: string,
): string | null {
  const parsed = typeof value === "number" ? value : Number(value.trim().replace(/,/g, ""));
  const number = String(value).trim() !== "" && Number.isFinite(parsed) ? parsed : null;
  const picture = instruction.switches.get("#")?.[0];
  let format = numberFormat;
  let hex = false;
  const cases: ((text: string) => string)[] = [];
  for (const name of instruction.switches.get("*") ?? []) {
    const lower = name.toLowerCase();
    if (KEEPS_FORMAT.has(lower)) continue;
    // The name's first letter gives the case: `Roman` is `ROMAN`.
    const cased = /^[A-Z]/.test(name) ? name.toUpperCase() : lower;
    const asNumber = NUMBER_SWITCH[cased] ?? NUMBER_SWITCH_ANY_CASE[lower];
    if (asNumber) format = asNumber;
    else if (lower === "hex") hex = true;
    else if (CASE_SWITCH[lower]) cases.push(CASE_SWITCH[lower]);
    else return null;
  }
  let text = String(value);
  if (number !== null && picture !== undefined) {
    const pictured = formatNumericPicture(number, picture);
    if (pictured === null) return null;
    text = pictured;
  } else if (number !== null && hex) text = Math.round(number).toString(16).toUpperCase();
  else if (number !== null && (format || typeof value === "number"))
    text = formatNumber(number, format);
  for (const apply of cases) text = apply(text);
  return text;
}

// ---------- what an update is given and gives back ----------

/** Where a body position is, from a view's pages. */
export interface FieldPage {
  /** The displayed number (`w:pgNumType` restarts count). */
  number: number;
  /** The page's place among all of them, from 1 (1.11; a view made before has none). */
  index?: number | undefined;
  /** How many pages its section has. */
  sectionPages: number;
  /** The section's number format (`upperRoman`…). */
  format?: string | undefined;
}

export interface FieldLayout {
  readonly pages: number;
  pageAt(pos: number): FieldPage | null;
}

export interface UpdateFieldsOptions {
  /** Pages: without it page fields keep their results and are reported. */
  layout?: FieldLayout | null | undefined;
  /** Values of `MERGEFIELD`s by name. Without it merge fields are left alone. */
  data?: Readonly<Record<string, unknown>> | undefined;
  /** What `DATE` and `TIME` show (default: now). */
  now?: Date | undefined;
  /**
   * Which fields: those a range of this editor's tree touches (a caret: the field around it, a
   * table of contents for a page number in it), or those a function picks. Default: every field
   * of the body and of the stories.
   */
  only?: { from: number; to: number } | ((field: Field) => boolean) | undefined;
  /** Joins the undo step before it: the second pass of one update. */
  continues?: boolean | undefined;
  /**
   * The most the new results may hold together, in characters (a table of contents built again
   * counts its entries), the stories' included. Past it nothing is changed and `updateFields`
   * throws a `RangeError`. For documents from someone else: a field's picture, a merge value
   * or a bookmark referred to many times can make results far larger than the document.
   * Default: no limit.
   */
  maxWritten?: number | undefined;
}

export type FieldSkipReason =
  | "locked"
  | "unknown"
  | "no-layout"
  | "no-data"
  | "missing-bookmark"
  | "unsupported-switch"
  | "self-reference"
  | "failed"
  | "untrackable";

/** A field left as it was, and why. */
export interface FieldSkip {
  instruction: string;
  /** The story it is in; null: the body. */
  story: string | null;
  reason: FieldSkipReason;
  /** The bookmark, merge field or switch concerned. */
  detail?: string;
}

export interface FieldsReport {
  /** Fields whose result changed. */
  updated: number;
  /** Fields worked out to the result they had. */
  unchanged: number;
  /** Tables of contents built again. */
  rebuilt: number;
  skipped: FieldSkip[];
}

const emptyReport = (): FieldsReport => ({ updated: 0, unchanged: 0, rebuilt: 0, skipped: [] });

// ---------- helpers over a tree ----------

/** @internal */
export interface Bookmark {
  name: string;
  /** After its start marker, before its end marker. */
  from: number;
  to: number;
}

const knownBookmarks = new WeakMap<Node, Map<string, Bookmark>>();

/**
 * @internal A tree's bookmarks by name in lower case: Word's names do not differ by case alone.
 */
export function bookmarksIn(tree: Node): Map<string, Bookmark> {
  const known = knownBookmarks.get(tree);
  if (known) return known;
  const starts = new Map<unknown, { name: string; from: number }>();
  const out = new Map<string, Bookmark>();
  tree.descendants((node, pos) => {
    if (node.type.name === "bookmarkStart")
      starts.set(node.attrs.id, { name: String(node.attrs.name), from: pos + 1 });
    else if (node.type.name === "bookmarkEnd") {
      const start = starts.get(node.attrs.id);
      const key = start?.name.toLowerCase();
      if (start && key !== undefined && !out.has(key)) out.set(key, { ...start, to: pos });
    }
    return !node.isInline;
  });
  knownBookmarks.set(tree, out);
  return out;
}

const bookmarkNamed = (tree: Node, name: string) => bookmarksIn(tree).get(name.toLowerCase());

/** A bookmark name for a field's code, quoted when it needs to be. */
const quotedName = (name: string) =>
  /[\s"\\]/.test(name) ? `"${name.replace(/["\\]/g, "\\$&")}"` : name;

/** Makes names `prefix` + a number that no bookmark of `tree` has. */
function bookmarkNames(tree: Node, prefix: string, fresh: (after: number) => number): () => string {
  const taken = bookmarksIn(tree);
  let serial = 200_000_000;
  for (const { name } of taken.values()) {
    const number = name.toLowerCase().startsWith(prefix.toLowerCase())
      ? Number(name.slice(prefix.length))
      : 0;
    // One too large to count from is only a name to keep clear of.
    if (Number.isSafeInteger(number + 1 + taken.size)) serial = Math.max(serial, number);
  }
  return () => {
    let name: string;
    do {
      serial = fresh(serial);
      name = `${prefix}${serial}`;
    } while (taken.has(name.toLowerCase()));
    return name;
  };
}

const knownCodes = new WeakMap<Node, [number, number][]>();

/** Whether `pos` is in a field's code range (what never shows as a result). */
function inFieldCode(tree: Node, pos: number): boolean {
  let ranges = knownCodes.get(tree);
  if (!ranges) {
    ranges = [];
    for (const { from, codeEnd } of fieldsIn(tree)) {
      const last = ranges[ranges.length - 1];
      if (last && from < last[1]) last[1] = Math.max(last[1], codeEnd);
      else ranges.push([from, codeEnd]);
    }
    knownCodes.set(tree, ranges);
  }
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((ranges[middle] as [number, number])[1] <= pos) low = middle + 1;
    else high = middle;
  }
  const found = ranges[low];
  return !!found && found[0] <= pos;
}

interface ParagraphAt {
  node: Node;
  pos: number;
}

/** @internal */
export function paragraphsOf(tree: Node): ParagraphAt[] {
  const out: ParagraphAt[] = [];
  tree.descendants((node, pos) => {
    if (node.type.name === "paragraph") out.push({ node, pos });
    return !node.isTextblock;
  });
  return out;
}

const REVIEW = new Set(["insertion", "deletion", "formatChange"]);
/** @internal */
export const withoutReview = (marks: readonly Mark[]) =>
  marks.filter((m) => !REVIEW.has(m.type.name));
const isGone = (node: Node) => node.marks.some((m) => m.type.name === "deletion");

/** @internal Text as inline nodes: tabs and line feeds become their nodes. */
export function inlineText(schema: Schema, text: string, marks: readonly Mark[]): Node[] {
  const nodes = schema.nodes as Record<string, NodeType>;
  const out: Node[] = [];
  for (const part of text.split(/(\t|\r\n|\r|\n)/)) {
    if (!part) continue;
    if (part === "\t") out.push((nodes.tab as NodeType).create(null, null, marks));
    else if (/^[\r\n]/.test(part))
      out.push((nodes.hardBreak as NodeType).create(null, null, marks));
    else out.push(schema.text(part, marks));
  }
  return out;
}

/** The marks a new result takes: the old result's with `\* MERGEFORMAT`, else its code's. */
function resultMarks(field: Field, instruction: FieldInstruction): readonly Mark[] {
  const merge = (instruction.switches.get("*") ?? []).some(
    (name) => name.toLowerCase() === "mergeformat",
  );
  return withoutReview((merge ? field.resultMarks : null) ?? field.codeMarks ?? []);
}

/**
 * What a bookmark holds, as inline nodes. Field codes and markers stay behind.
 * shortcut: a paragraph end inside the bookmark becomes a line break, where Word's result has the
 * paragraph; make it a slice when a document needs it.
 * @internal
 */
export function bookmarkContent(tree: Node, mark: Bookmark): Node[] {
  const schema = tree.type.schema;
  const out: Node[] = [];
  const hardBreak = schema.nodes.hardBreak as NodeType;
  let paragraph: Node | null = null;
  tree.nodesBetween(mark.from, mark.to, (node, pos, parent) => {
    if (!node.isInline) return true;
    if (paragraph && parent !== paragraph) out.push(hardBreak.create());
    paragraph = parent;
    if (isGone(node) || inFieldCode(tree, pos)) return false;
    if (node.isText) {
      const from = Math.max(mark.from - pos, 0);
      const to = Math.min(mark.to - pos, node.nodeSize);
      if (to > from) out.push(node.cut(from, to).mark(withoutLinks(node.marks)));
    } else if (["tab", "hardBreak", "picture"].includes(node.type.name))
      out.push(node.mark(withoutLinks(node.marks)));
    return false;
  });
  return out;
}
const withoutLinks = (marks: readonly Mark[]) =>
  withoutReview(marks).filter((m) => m.type.name !== "link");

/** The list numbers of a tree's paragraphs, and how a paragraph's number reads in context. */
class ListNumbers {
  private readonly paragraphs: ParagraphAt[];
  private readonly markers: (ListMarker | null)[];
  /** The numbered paragraphs of each list, in order. */
  private readonly lists = new Map<number, number[]>();

  constructor(tree: Node, word: WordContext) {
    this.paragraphs = paragraphsOf(tree);
    this.markers = word.resolver.markers(this.paragraphs.map((p) => p.node.attrs));
    this.markers.forEach((marker, i) => {
      if (!marker) return;
      const list = this.lists.get(marker.instance);
      if (list) list.push(i);
      else this.lists.set(marker.instance, [i]);
    });
  }

  /** The last paragraph of list `instance` at or before paragraph `index` (-1: none). */
  private lastOfList(instance: number, index: number): number {
    const list = this.lists.get(instance) ?? [];
    let low = 0;
    let high = list.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((list[middle] as number) <= index) low = middle + 1;
      else high = middle;
    }
    return list[low - 1] ?? -1;
  }

  private indexAt(pos: number): number {
    let low = 0;
    let high = this.paragraphs.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((this.paragraphs[middle] as ParagraphAt).pos <= pos) low = middle + 1;
      else high = middle;
    }
    const found = this.paragraphs[low - 1];
    return found && pos <= found.pos + found.node.nodeSize ? low - 1 : -1;
  }

  marker(pos: number): ListMarker | null {
    return this.markers[this.indexAt(pos)] ?? null;
  }

  /** The numbered paragraphs above it in its list, then itself: indexes, outermost first. */
  private chain(index: number): number[] {
    const out = [index];
    let level = this.markers[index]?.level ?? 0;
    const list = this.markers[index]?.abstract;
    for (let i = index - 1; i >= 0 && level > 0; i--) {
      const marker = this.markers[i];
      if (marker?.abstract === list && marker && marker.level < level) {
        out.unshift(i);
        level = marker.level;
      }
    }
    return out;
  }

  /**
   * `\n`: alone; `\w`: in full; `\r`: what differs from where its list stands at `from`, the
   * last paragraph of that list there, other lists between counting for nothing. `plain`
   * (`\t`): without the words of the number's format. As Word writes them, only the last
   * trailing period goes.
   */
  number(pos: number, mode: "n" | "w" | "r", from: number, plain: boolean): string {
    const index = this.indexAt(pos);
    const marker = this.markers[index];
    if (!marker) return "0";
    const shown = (i: number) => {
      const at = this.markers[i] as ListMarker;
      return plain ? at.plain : at.text;
    };
    let chain = mode === "n" ? [index] : this.chain(index);
    if (mode === "r") {
      const at = this.lastOfList(marker.instance, this.indexAt(from));
      const here = at < 0 ? [] : this.chain(at);
      let shared = 0;
      while (shared < chain.length - 1 && chain[shared] === here[shared]) shared++;
      chain = chain.slice(shared);
    }
    const parts: string[] = [];
    for (const i of chain) {
      const text = shown(i);
      const previous = parts[parts.length - 1]?.replace(/\.+$/, "");
      // "2.3" under "2." already holds it.
      if (previous && text.startsWith(previous) && !/^\w/.test(text.slice(previous.length)))
        parts[parts.length - 1] = text;
      else parts.push(text);
    }
    return parts.join("").replace(/\.+$/, "");
  }
}

// ---------- one tree ----------

interface Run {
  /** The tree's state and its transaction. */
  state: EditorState;
  tr: Transaction;
  word: WordContext;
  story: string | null;
  /** The body's transaction: bookmarks and pages are the body's. */
  bodyTr: Transaction;
  options: UpdateFieldsOptions;
  report: FieldsReport;
  /** The envelope as new styles leave it. */
  envelope: WordEnvelope;
  /** List numbers, per tree worked on. */
  numbers: Map<Node, ListNumbers>;
  /** Whether tables of contents are built (not when tracking cannot record that). */
  contents: boolean;
  /** Picks fields of this tree. */
  picked(field: Field): boolean;
  /** What may still be written, shared by the body's run and the stories'. */
  budget: { left: number };
}

/** Past `maxWritten`: no field's own failure, so it is not caught as one. */
class OverBudget extends RangeError {}

/** Counts `size` characters of results against the update's limit. */
function spend(run: Run, size: number): void {
  run.budget.left -= size;
  if (run.budget.left < 0)
    throw new OverBudget(
      `The fields' results would hold more than ${run.options.maxWritten} characters`,
    );
}

/**
 * What results hold as the document is saved: their JSON, formatting included. A position
 * count would miss what a mark or an attribute carries (a run's kept XML, a picture), which a
 * reference copies with its bookmark's text.
 */
const sizeOf = (nodes: readonly Node[]) =>
  nodes.reduce((sum, node) => sum + JSON.stringify(node.toJSON()).length, 0);

const PAGE_FIELDS = new Set(["PAGE", "NUMPAGES", "SECTIONPAGES"]);
const VALUE_FIELDS = new Set([...PAGE_FIELDS, "DATE", "TIME", "SEQ", "MERGEFIELD"]);
/** The switches Foli honours, per field (`\*`, `\#` and `\@` go through `formatted`). */
const KNOWN_SWITCHES: Record<string, string> = {
  PAGE: "",
  NUMPAGES: "",
  SECTIONPAGES: "",
  DATE: "",
  TIME: "",
  SEQ: "cnrsh",
  MERGEFIELD: "bf",
  REF: "hnrwpt",
  PAGEREF: "hp",
  TOC: "ohzutnbpwx",
};

/** A position of the tree's transaction, in the document the layout was made from. */
function originalPos(tr: Transaction, pos: number): number {
  let out = pos;
  for (let i = tr.mapping.maps.length - 1; i >= 0; i--)
    out = (tr.mapping.maps[i] as (typeof tr.mapping.maps)[number]).invert().map(out, 1);
  return out;
}

const skip = (run: Run, field: Field, reason: FieldSkipReason, detail?: string) => {
  run.report.skipped.push({
    instruction: field.instruction,
    story: run.story,
    reason,
    ...(detail ? { detail } : {}),
  });
};

/** The page of a body position as of the layout, or null (reported when there is no layout). */
function pageOf(run: Run, field: Field, bodyPos: number): FieldPage | null {
  const { layout } = run.options;
  if (!layout) {
    skip(run, field, "no-layout");
    return null;
  }
  const page = layout.pageAt(originalPos(run.bodyTr, bodyPos));
  if (!page) skip(run, field, "no-layout");
  return page;
}

function headingsOf(tree: Node, word: WordContext): { pos: number; level: number }[] {
  return paragraphsOf(tree).flatMap(({ node, pos }) => {
    const level = headingLevel(word, node);
    return level === null ? [] : [{ pos, level }];
  });
}

/** @internal A paragraph's level from its heading style's name. */
export function headingLevel(word: WordContext, paragraph: Node): number | null {
  const id = word.resolver.paragraph(paragraph.attrs).paragraph.style;
  const name = word.envelope.styles.find((s) => s.id === id)?.name ?? "";
  const match = /^heading ([1-9])$/i.exec(name);
  return match ? Number(match[1]) : null;
}

/** What each `SEQ` of `fields` counts to, in document order. */
function sequenceValues(run: Run, fields: readonly Field[]): Map<Field, number> {
  const tree = run.tr.doc;
  const values = new Map<Field, number>();
  const counters = new Map<string, number>();
  const seen = new Map<string, { pos: number; value: number }[]>();
  const headings = headingsOf(tree, run.word);
  const references: { field: Field; list: { pos: number; value: number }[]; to: number }[] = [];
  for (const field of fields) {
    if (field.name !== "SEQ" || field.deleted) continue;
    const { args, switches } = parseFieldInstruction(field.instruction);
    const id = (args[0] ?? "").toLowerCase();
    const list = seen.get(id) ?? [];
    seen.set(id, list);
    let value = counters.get(id) ?? 0;
    const resetLevel = Number(switches.get("s")?.[0]);
    // A heading since this sequence's last number starts it again.
    const last = list[list.length - 1]?.pos ?? 0;
    if (
      resetLevel &&
      headings.some((h) => h.pos >= last && h.pos < field.from && h.level <= resetLevel)
    )
      value = 0;
    const target = args[1] ? bookmarkNamed(tree, args[1]) : undefined;
    // A reference counts nothing: it is worked out below, once every number is known.
    if (target) {
      references.push({ field, list, to: target.to });
      continue;
    }
    // Of `\c`, `\n` and `\r`, the first written counts.
    const action = [...switches.keys()].find((letter) => "cnr".includes(letter));
    // A `\r` without a whole number to restart at counts on, as Word does.
    const restart = switches.get("r")?.[0] ?? "";
    if (action === "r" && /^\d+$/.test(restart)) value = Number(restart);
    else if (action !== "c") value++;
    counters.set(id, value);
    list.push({ pos: field.from, value });
    values.set(field, value);
  }
  // The sequence's last number before the bookmark's end, wherever the reference stands.
  for (const { field, list, to } of references)
    values.set(field, [...list].reverse().find((s) => s.pos < to)?.value ?? 0);
  return values;
}

interface Worked {
  text: string;
  /** The result, when it is more than text in the field's own format. */
  nodes?: Node[];
}

const dataValue = (data: Readonly<Record<string, unknown>>, name: string) => {
  if (Object.hasOwn(data, name)) return { found: true, value: data[name] };
  const lower = name.toLowerCase();
  const key = Object.keys(data).find((k) => k.toLowerCase() === lower);
  return key === undefined ? { found: false, value: undefined } : { found: true, value: data[key] };
};

/** Where the field is against `target`, as Word's `\p` says it. */
const direction = (field: Field, target: Bookmark) =>
  field.from < target.from ? "below" : "above";

/** The bookmark `name`, in this tree or else in the body; `inBody` when it is the body's. */
function findBookmark(run: Run, name: string) {
  const own = bookmarkNamed(run.tr.doc, name);
  if (own) return { mark: own, tree: run.tr.doc, inBody: run.story === null };
  const body = run.story === null ? undefined : bookmarkNamed(run.bodyTr.doc, name);
  return body ? { mark: body, tree: run.bodyTr.doc, inBody: true } : null;
}

/** The bookmark a field shows the text of, if it is one that does. */
function textTarget(tree: Node, field: Field): Bookmark | undefined {
  const { name, args, switches } = parseFieldInstruction(field.instruction);
  if (VALUE_FIELDS.has(name) || name === "PAGEREF" || name === "TOC") return undefined;
  if (switches.has("n") || switches.has("r") || switches.has("w") || switches.has("p"))
    return undefined;
  const target = name === "REF" ? args[0] : tokens(field.instruction)[0]?.value;
  return target ? bookmarkNamed(tree, target) : undefined;
}

/** Whether what `mark` holds comes, through references, from `field` itself. */
function refersBack(tree: Node, field: Field, mark: Bookmark): boolean {
  const fields = fieldsIn(tree);
  const seen = new Set([mark]);
  const waiting = [mark];
  for (let at = waiting.pop(); at; at = waiting.pop()) {
    if (at.from <= field.from && field.to <= at.to) return true;
    let low = 0;
    let high = fields.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((fields[middle] as Field).from < at.from) low = middle + 1;
      else high = middle;
    }
    for (let i = low; i < fields.length && (fields[i] as Field).from < at.to; i++) {
      const next = textTarget(tree, fields[i] as Field);
      if (next && !seen.has(next)) {
        seen.add(next);
        waiting.push(next);
      }
    }
  }
  return false;
}

/** What `field` should show; null when it keeps its result (the reason reported). */
function work(run: Run, field: Field, sequence: Map<Field, number>): Worked | null {
  const instruction = parseFieldInstruction(field.instruction);
  const { name, args, switches } = instruction;
  // Any other word is a bookmark's name standing for `REF`, or a field Foli does not know.
  const implicit = !VALUE_FIELDS.has(name) && name !== "REF" && name !== "PAGEREF";
  const bookmark = implicit ? tokens(field.instruction)[0]?.value : args[0];
  const found = !VALUE_FIELDS.has(name) && bookmark ? findBookmark(run, bookmark) : null;
  if (implicit && !found) {
    skip(run, field, "unknown");
    return null;
  }
  const allowed = KNOWN_SWITCHES[implicit ? "REF" : name] ?? "";
  for (const letter of switches.keys())
    if (!GENERAL.includes(letter) && !allowed.includes(letter)) {
      skip(run, field, "unsupported-switch", `\\${letter}`);
      return null;
    }
  const done = (value: string | number, numberFormat?: string): Worked | null => {
    const text = formatted(value, instruction, numberFormat);
    if (text === null) skip(run, field, "unsupported-switch", "\\*");
    return text === null ? null : { text };
  };
  const { layout } = run.options;
  switch (name) {
    case "PAGE":
    case "SECTIONPAGES": {
      const page = pageOf(run, field, field.from);
      if (!page) return null;
      return name === "PAGE" ? done(page.number, page.format) : done(page.sectionPages);
    }
    case "NUMPAGES":
      if (!layout) skip(run, field, "no-layout");
      return layout ? done(layout.pages) : null;
    case "DATE":
    case "TIME": {
      const picture = switches.get("@")?.[0] ?? (name === "DATE" ? "M/d/yyyy" : "h:mm AM/PM");
      return done(formatDatePicture(run.options.now ?? new Date(), picture));
    }
    case "SEQ": {
      // Hidden, unless a format asks for it to show.
      const shows = (switches.get("*") ?? []).some((s) => !KEEPS_FORMAT.has(s.toLowerCase()));
      return switches.has("h") && !shows ? { text: "" } : done(sequence.get(field) ?? 0);
    }
    case "MERGEFIELD": {
      const { data } = run.options;
      if (!data) return null;
      const key = args[0] ?? "";
      const { found, value } = dataValue(data, key);
      if (!found) {
        skip(run, field, "no-data", key);
        return null;
      }
      let shown: string | number =
        value === null || value === undefined ? "" : (value as string | number);
      const picture = switches.get("@")?.[0];
      // A bare day is that day here, not UTC's midnight (the day before, west of it).
      const date =
        value instanceof Date
          ? value
          : picture && typeof value === "string" && ISO_DATE.test(value)
            ? new Date(value.length === 10 ? `${value}T00:00` : value.replace(" ", "T"))
            : null;
      // Not a day the calendar has (`2024-13-45`, an invalid Date): the value as it is.
      if (date && !Number.isNaN(date.getTime()))
        shown = picture ? formatDatePicture(date, picture) : date.toISOString();
      const text = formatted(typeof shown === "number" ? shown : String(shown), instruction);
      if (text === null) {
        skip(run, field, "unsupported-switch", "\\*");
        return null;
      }
      // Word's text before and after a value, only when there is one.
      const before = switches.get("b")?.[0] ?? "";
      const after = switches.get("f")?.[0] ?? "";
      return { text: text ? `${before}${text}${after}` : "" };
    }
    default:
  }
  if (!found) {
    skip(run, field, "missing-bookmark", bookmark);
    return null;
  }
  const { mark, tree, inBody } = found;
  const place = switches.has("p") && tree === run.tr.doc ? direction(field, mark) : null;
  if (name === "PAGEREF") {
    if (!inBody) {
      skip(run, field, "no-layout", bookmark);
      return null;
    }
    const page = pageOf(run, field, mark.from);
    if (!page) return null;
    const here =
      place && run.story === null && layout
        ? layout.pageAt(originalPos(run.bodyTr, field.from))
        : null;
    if (place && here?.number === page.number) return { text: place };
    const number = done(page.number, page.format);
    return number && switches.has("p") ? { text: `on page ${number.text}` } : number;
  }
  const mode = (["n", "r", "w"] as const).find((letter) => switches.has(letter));
  if (mode) {
    let numbers = run.numbers.get(tree);
    if (!numbers) {
      numbers = new ListNumbers(tree, run.word);
      run.numbers.set(tree, numbers);
    }
    const text = numbers.number(mark.from, mode, field.from, switches.has("t"));
    return done(place ? `${text} ${place}` : text);
  }
  if (place) return done(place);
  // Word refuses it too ("not a valid bookmark self-reference"): it would grow at every update.
  if (tree === run.tr.doc && refersBack(tree, field, mark)) {
    skip(run, field, "self-reference", bookmark);
    return null;
  }
  const nodes = bookmarkContent(tree, mark);
  const text = nodes.map((n) => (n.isText ? n.text : n.type.name === "tab" ? "\t" : "\n")).join("");
  const cased = done(text);
  if (!cased) return null;
  // The bookmark's own formatting, unless a switch gives the field's.
  const own = !(switches.get("*") ?? []).some((s) => KEEPS_FORMAT.has(s.toLowerCase()));
  return cased.text === text && own ? { text, nodes } : cased;
}

function putResult(run: Run, field: Field, nodes: readonly Node[]): void {
  const { tr } = run;
  if (field.separator !== null) {
    tr.replace(field.resultFrom, field.resultTo, new Slice(Fragment.fromArray([...nodes]), 0, 0));
    return;
  }
  const marks = resultMarks(field, parseFieldInstruction(field.instruction));
  const separator = (tr.doc.type.schema.nodes.fieldSeparator as NodeType).create(null, null, marks);
  tr.insert(field.to - 1, [separator, ...nodes]);
}

/**
 * Puts many results into their paragraphs at once, the fields from the last to the first. Untracked,
 * those of one paragraph go in as one step: a step per field costs the paragraph's length each.
 */
function putResults(run: Run, jobs: readonly (readonly [Field, Node[]])[]): void {
  const { tr } = run;
  const descending = [...jobs].reverse();
  if (jobs.length < 32 || trackState(run.state)?.on) {
    for (const [field, nodes] of descending) putResult(run, field, nodes);
    return;
  }
  const paragraphs = paragraphsOf(tr.doc);
  const paragraphAt = (pos: number): ParagraphAt | undefined => {
    let low = 0;
    let high = paragraphs.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((paragraphs[middle] as ParagraphAt).pos < pos) low = middle + 1;
      else high = middle;
    }
    return paragraphs[low - 1];
  };
  let group: (readonly [Field, Node[]])[] = [];
  let holder: ParagraphAt | undefined;
  const flush = () => {
    const owner = holder;
    const [first] = group;
    const last = group[group.length - 1];
    if (owner && first && last) {
      const ascending = [...group].reverse();
      const from = (last[0] as Field).resultFrom;
      const to = (first[0] as Field).resultTo;
      const kids: { at: number; node: Node }[] = [];
      owner.node.forEach((node, offset) => {
        const at = owner.pos + 1 + offset;
        if (at >= from && at < to) kids.push({ at, node });
      });
      const content: Node[] = [];
      let i = 0;
      for (const [field, nodes] of ascending) {
        while (kids[i] && (kids[i] as { at: number }).at < field.resultFrom)
          content.push((kids[i++] as { node: Node }).node);
        content.push(...nodes);
        while (kids[i] && (kids[i] as { at: number }).at < field.resultTo) i++;
      }
      tr.replace(from, to, new Slice(Fragment.fromArray(content), 0, 0));
    }
    group = [];
    holder = undefined;
  };
  for (const job of descending) {
    const [field, nodes] = job;
    const paragraph = paragraphAt(field.from);
    const inside =
      field.separator !== null &&
      !!paragraph &&
      field.resultTo < paragraph.pos + paragraph.node.nodeSize;
    if (!inside) {
      flush();
      putResult(run, field, nodes);
    } else {
      if (paragraph !== holder) flush();
      holder = paragraph;
      group.push(job);
    }
  }
  flush();
}

const lockedAbove = new WeakMap<Field, boolean>();

/** Whether the field or one around it is locked (each field walked once). */
function lockedChain(field: Field): boolean {
  const path: Field[] = [];
  let locked = false;
  for (let at: Field | null = field; at; at = at.parent) {
    const known = lockedAbove.get(at);
    if (known !== undefined) {
      locked = known;
      break;
    }
    path.push(at);
    if (at.locked) {
      locked = true;
      break;
    }
  }
  for (const at of path) lockedAbove.set(at, locked);
  return locked;
}

/** The tables of contents of a tree, those inside another left to it. */
function contentsIn(tree: Node): Field[] {
  return fieldsIn(tree).filter((field) => {
    if (field.name !== "TOC") return false;
    for (let at = field.parent; at; at = at.parent) if (at.name === "TOC") return false;
    return true;
  });
}

/** Which stage takes a field: nested in a code first, then values, references, contents. */
const stageOf = (field: Field) =>
  field.inCode ? 0 : VALUE_FIELDS.has(field.name) ? 1 : field.name === "TOC" ? 3 : 2;

/** Updates the fields of a tree in `run.tr`. */
function updateTree(run: Run): void {
  const { tr, report, story } = run;
  const schema = tr.doc.type.schema;
  // Every field not updated is reported once, at the first stage that sees it.
  const reported = new Set<number>();
  const usable = (field: Field): boolean => {
    if (field.deleted || !run.picked(field)) return false;
    if (story !== null && PAGE_FIELDS.has(field.name)) return false;
    if (!lockedChain(field)) return true;
    const at = originalPos(tr, field.from);
    if (!reported.has(at)) skip(run, field, "locked");
    reported.add(at);
    return false;
  };
  for (const stage of [0, 1, 2]) {
    const fields = fieldsIn(tr.doc);
    if (!fields.length) return;
    const sequence = sequenceValues(run, fields);
    const jobs = new Map<Field, Node[]>();
    for (const field of fields) {
      if (stageOf(field) !== stage || !usable(field)) continue;
      // One field that cannot be worked out never stops the others, or a print.
      try {
        const worked = work(run, field, sequence);
        if (!worked) continue;
        if (worked.text === field.result) {
          report.unchanged++;
          continue;
        }
        const marks = resultMarks(field, parseFieldInstruction(field.instruction));
        const nodes = worked.nodes ?? inlineText(schema, worked.text, marks);
        // The text's own length first: a result too long to make into nodes is not made.
        if (!worked.nodes) spend(run, worked.text.length);
        spend(run, sizeOf(nodes) - (worked.nodes ? 0 : worked.text.length));
        jobs.set(field, nodes);
        report.updated++;
      } catch (error) {
        if (error instanceof OverBudget) throw error;
        skip(run, field, "failed", (error as Error).message);
      }
    }
    // A result replaced takes the fields inside it along.
    const covered = new Set<Field>();
    for (const field of fields)
      if (field.parent && (jobs.has(field.parent) || covered.has(field.parent))) covered.add(field);
    putResults(
      run,
      [...jobs].filter(([field]) => !covered.has(field)),
    );
  }
  if (story !== null) {
    for (const field of fieldsIn(tr.doc))
      if (field.name === "TOC" && usable(field)) skip(run, field, "unknown", "in a story");
    return;
  }
  const count = contentsIn(tr.doc).length;
  for (let i = 0; i < count; i++) {
    const field = contentsIn(tr.doc)[i];
    if (!field || !usable(field)) continue;
    if (!run.contents) {
      skip(run, field, "untrackable");
      continue;
    }
    try {
      rebuildContents(run, i);
    } catch (error) {
      if (error instanceof OverBudget) throw error;
      skip(run, field, "failed", (error as Error).message);
    }
  }
}

// ---------- tables of contents ----------

interface Entry {
  /** The stretch of its paragraph it comes from. */
  from: number;
  to: number;
  level: number;
  title: string;
  number: string;
  /** What follows the number: Word's tab, or a space. */
  numberGap: string;
  bookmark: string | null;
}

const knownContents = new WeakMap<Node, Field[]>();

/** Every table of contents of a tree, those inside others too. */
function everyContents(tree: Node): Field[] {
  let found = knownContents.get(tree);
  if (!found) {
    found = fieldsIn(tree).filter((f) => f.name === "TOC");
    knownContents.set(tree, found);
  }
  return found;
}

/** A stretch of a paragraph that makes an entry. */
interface EntryPart {
  title: string;
  from: number;
  to: number;
  bookmark: string | null;
}

/**
 * What a paragraph gives entries from: its text without codes, deleted or hidden text, spaces
 * around it dropped and line breaks as spaces. A table of contents standing in it divides it: Word
 * lists what is before and after as entries of their own.
 */
function entryParts(tree: Node, word: WordContext, { node, pos }: ParagraphAt): EntryPart[] {
  const { run } = word.resolver.paragraph(node.attrs);
  const contents = everyContents(tree);
  const parts: EntryPart[] = [];
  let part: EntryPart | null = null;
  node.forEach((child, offset) => {
    const at = pos + 1 + offset;
    if (contents.some((f) => at >= f.from && at < f.to)) {
      part = null;
      return;
    }
    if (!part) {
      part = { title: "", from: at, to: at, bookmark: null };
      parts.push(part);
    }
    part.to = at + child.nodeSize;
    if (child.type.name === "bookmarkStart" && TOC_BOOKMARK.test(String(child.attrs.name)))
      part.bookmark ??= String(child.attrs.name);
    if (isGone(child) || inFieldCode(tree, at)) return;
    if (
      word.resolver.run(
        run,
        child.marks.map((m) => m.toJSON()),
      ).hidden
    )
      return;
    if (child.isText) part.title += child.text;
    else if (child.type.name === "tab") part.title += "\t";
    else if (child.type.name === "hardBreak") part.title += " ";
  });
  return parts
    .map((found) => ({ ...found, title: found.title.trim() }))
    .filter((found) => found.title);
}

/** A paragraph's text as a heading to refer to. */
/** @internal A paragraph's text as its entry. */
export const entryTitle = (tree: Node, word: WordContext, paragraph: ParagraphAt) =>
  entryParts(tree, word, paragraph)
    .map((part) => part.title)
    .join(" ");

const TOC_BOOKMARK = /^_Toc\d+$/;

/** The range of levels `\o` (or `\u`) asks for. */
const levelRange = (value: string | undefined) => {
  const match = /(\d)\s*-\s*(\d)/.exec(value ?? "");
  return match ? [Number(match[1]), Number(match[2])] : [1, 9];
};

/** The level a paragraph style gives: a heading's, or its outline level (inherited too). */
function styleLevel(word: WordContext, id: string | null | undefined): number | null {
  const name = word.envelope.styles.find((s) => s.id === id)?.name ?? "";
  const heading = /^heading ([1-9])$/i.exec(name);
  if (heading) return Number(heading[1]);
  const outline = id ? word.resolver.paragraph({ style: id }).paragraph.outlineLevel : null;
  return outline !== null && outline < 9 ? outline + 1 : null;
}

/** The headings a table of contents lists, as its switches say. */
function contentsEntries(tree: Node, word: WordContext, { switches }: FieldInstruction): Entry[] {
  const hasSource = switches.has("o") || switches.has("u") || switches.has("t");
  const [low, high] = levelRange(switches.get("o")?.[0]) as [number, number];
  const custom = new Map<string, number>();
  const pairs = (switches.get("t")?.[0] ?? "").split(/[,;]/).map((s) => s.trim());
  for (let i = 0; i + 1 < pairs.length; i += 2)
    custom.set((pairs[i] as string).toLowerCase(), Number(pairs[i + 1]) || 1);
  const scope = switches.has("b") ? bookmarkNamed(tree, switches.get("b")?.[0] ?? "") : null;
  const paragraphs = paragraphsOf(tree);
  const markers = word.resolver.markers(paragraphs.map((p) => p.node.attrs));
  const inRange = (level: number) => level >= low && level <= high;
  const out: Entry[] = [];
  paragraphs.forEach((paragraph, i) => {
    const { node, pos } = paragraph;
    if (scope && (pos + node.nodeSize <= scope.from || pos >= scope.to)) return;
    const format = word.resolver.paragraph(node.attrs).paragraph;
    const style = word.envelope.styles.find((s) => s.id === format.style);
    let level: number | undefined = custom.get((style?.name ?? format.style ?? "").toLowerCase());
    // What Word lists: styles by their level, and with `\u` a paragraph's own outline level.
    if (level === undefined && (switches.has("o") || switches.has("u") || !hasSource)) {
      const own = styleLevel(word, format.style);
      if (own !== null && inRange(own)) level = own;
    }
    const outline = format.outlineLevel;
    if (level === undefined && switches.has("u") && outline !== null && outline < 9)
      if (inRange(outline + 1)) level = outline + 1;
    if (level === undefined) return;
    const marker = markers[i];
    for (const { title, from, to, bookmark } of entryParts(tree, word, paragraph))
      out.push({
        from,
        to,
        level,
        title,
        number: marker?.text ?? "",
        numberGap: marker?.suffix === "space" ? " " : marker?.suffix === "nothing" ? "" : "\t",
        bookmark,
      });
  });
  return out;
}

/** The width of the text of the section `pos` is in, in twips. */
function textWidth(tree: Node, word: WordContext, pos: number): number {
  let found: SectionJSON | undefined;
  tree.forEach((node, at) => {
    if (!found && at + node.nodeSize > pos && node.attrs.section)
      found = node.attrs.section as SectionJSON;
  });
  const { pageSize, margins } = found ?? word.envelope.section;
  return (
    (pageSize?.width ?? 12_240) -
    (margins?.left ?? 1440) -
    (margins?.right ?? 1440) -
    (margins?.gutter ?? 0)
  );
}

/** Whether a paragraph has something of `field` a tracked change has not deleted. */
function holdsResult(node: Node, pos: number, field: Field): boolean {
  let live = pos < field.from;
  node.forEach((child, offset) => {
    const at = pos + 1 + offset;
    if (at >= field.from && at < field.to && !isGone(child))
      live ||= !child.type.name.startsWith("field") || at === field.from;
  });
  return live;
}

/** The styles of the paragraphs a result fills: not the one holding only the end. */
function resultStyles(tree: Node, field: Field): (string | null)[] {
  const out: (string | null)[] = [];
  tree.nodesBetween(field.from, field.to, (node, pos) => {
    if (!node.isTextblock) return true;
    if (holdsResult(node, pos, field) && pos + 1 !== field.resultTo)
      out.push((node.attrs.style as string | null) ?? null);
    return false;
  });
  return out;
}

const NO_ENTRIES = "No table of contents entries found.";

/** Makes the table of contents number `index` of the tree list what its headings say. */
function rebuildContents(run: Run, index: number): void {
  const { tr, word, report } = run;
  const contentsField = () => contentsIn(tr.doc)[index] as Field;
  let field = contentsField();
  const instruction = parseFieldInstruction(field.instruction);
  const { switches } = instruction;
  for (const letter of switches.keys())
    if (!GENERAL.includes(letter) && !(KNOWN_SWITCHES.TOC as string).includes(letter)) {
      skip(run, field, "unsupported-switch", `\\${letter}`);
      return;
    }
  const schema = tr.doc.type.schema;
  const entries = contentsEntries(tr.doc, word, instruction);
  const separator = switches.get("p")?.[0] || "\t";
  const noPages = levelRange(switches.get("n")?.[0]);
  const pagesHidden = (level: number) =>
    switches.has("n") && level >= (noPages[0] as number) && level <= (noPages[1] as number);
  const { layout } = run.options;
  const pageText = (entry: Entry) => {
    if (pagesHidden(entry.level) || !layout) return "";
    const page = layout.pageAt(originalPos(tr, entry.from));
    return page ? formatNumber(page.number, page.format) : "";
  };
  const line = (entry: Entry, page: string) =>
    (entry.number ? entry.number + entry.numberGap : "") +
    entry.title +
    (pagesHidden(entry.level) ? "" : separator + page);
  const styles: string[] = [];
  const styleFor = (level: number): string => {
    const known = ensureStyle({ envelope: run.envelope }, `toc ${level}`);
    if (!known) throw new TransformError("No table of contents style");
    run.envelope = known.envelope;
    return known.id;
  };
  for (const entry of entries) styles.push(styleFor(entry.level));
  // The same lines in the same styles: the page numbers were updated as fields.
  const shown = (text: string) => (layout ? text : text.replace(/\t[^\t\r]*(?=\r|$)/g, "\t"));
  // After text in its paragraph the entries start on a paragraph of their own, as in Word.
  const startsParagraph = tr.doc.resolve(field.from).parentOffset === 0;
  const lead = startsParagraph ? "" : "\r";
  const wanted = lead + entries.map((entry) => line(entry, pageText(entry))).join("\r");
  const current = resultStyles(tr.doc, field).slice(startsParagraph ? 0 : 1);
  if (
    (entries.length ? shown(wanted) === shown(field.result) : field.result === NO_ENTRIES) &&
    (!entries.length || styles.every((id, i) => current[i] === id))
  ) {
    report.unchanged++;
    return;
  }
  report.updated++;
  report.rebuilt++;
  // Every heading gets its `_Toc` bookmark, Word's way.
  const nextName = bookmarkNames(tr.doc, "_Toc", idsOf(run.state));
  let id = nextBookmarkId(run.state, tr);
  const start = schema.nodes.bookmarkStart as NodeType;
  const end = schema.nodes.bookmarkEnd as NodeType;
  const missing = entries.filter((entry) => !entry.bookmark);
  const ids = new Map(
    missing.map((entry) => {
      const mine = id;
      id = freshId(run.state, id);
      return [entry, mine];
    }),
  );
  for (const entry of missing) entry.bookmark = nextName();
  for (const entry of missing.reverse()) {
    const mark = ids.get(entry) as number;
    tr.insert(entry.to, end.create({ id: mark }));
    tr.insert(entry.from, start.create({ id: mark, name: entry.bookmark }));
  }
  field = contentsField();
  const hyperlinks = switches.has("h");
  const linkStyle = hyperlinks && ensureStyle({ envelope: run.envelope }, "Hyperlink", "character");
  if (linkStyle) run.envelope = linkStyle.envelope;
  const width = textWidth(tr.doc, word, field.from) - 10;
  const $start = tr.doc.resolve(field.from);
  const $end = tr.doc.resolve(field.resultTo);
  // Entries stand where the field did: in its content controls.
  const controls = $start.parent.attrs.controls ?? null;
  const node = (name: string, attrs?: Record<string, unknown> | null, marks?: readonly Mark[]) =>
    (schema.nodes[name] as NodeType).create(attrs ?? null, null, marks ?? []);
  const paragraphs = entries.map((entry, i) => {
    const link = hyperlinks ? [schema.mark("link", { anchor: entry.bookmark })] : [];
    const styled = linkStyle
      ? [...link, schema.mark("characterStyle", { id: linkStyle.id })]
      : link;
    const content: Node[] = [];
    if (entry.number) content.push(...inlineText(schema, entry.number + entry.numberGap, styled));
    content.push(...inlineText(schema, entry.title, styled));
    if (!pagesHidden(entry.level)) {
      content.push(...inlineText(schema, separator, link));
      content.push(
        node("fieldStart", null, link),
        node("fieldCode", { text: ` PAGEREF ${entry.bookmark} \\h ` }, link),
        node("fieldSeparator", null, link),
        ...inlineText(schema, pageText(entry), link),
        node("fieldEnd", null, link),
      );
    }
    // A style with tab stops of its own keeps them: Word then writes none on the paragraph.
    // shortcut: Word sets the number's tab from the number's width; here 440 twips a level.
    const own = run.envelope.styles.find((s) => s.id === styles[i])?.paragraph?.tabs ?? [];
    const tabs = [
      ...(entry.number && entry.numberGap === "\t" && !own.some((t) => t.kind !== "right")
        ? [{ position: 440 * entry.level, kind: "left" }]
        : []),
      ...(separator === "\t" && !own.some((t) => t.kind === "right")
        ? [{ position: width, kind: "right", leader: "dot" }]
        : []),
    ];
    return (schema.nodes.paragraph as NodeType).create(
      { style: styles[i], ...(tabs.length ? { tabs } : {}), ...(controls ? { controls } : {}) },
      content,
    );
  });
  spend(run, sizeOf(paragraphs));
  if (!layout)
    report.skipped.push({ instruction: field.instruction, story: null, reason: "no-layout" });
  if (!paragraphs.length) {
    tr.replace(
      field.resultFrom,
      field.resultTo,
      new Slice(Fragment.from(schema.text(NO_ENTRIES)), 0, 0),
    );
    return;
  }
  // The end goes on in a paragraph of its own, with what follows it, as in Word.
  if (field.separator === null) {
    const marks = field.codeMarks ?? [];
    tr.insert(field.resultTo, node("fieldSeparator", null, withoutReview(marks)));
    field = contentsField();
  }
  /** The paragraphs entries go into, line for line: tracked, each keeps its place and change. */
  const linesBefore = (closing: number) => {
    const found: ParagraphAt[] = [];
    tr.doc.nodesBetween(field.from, field.resultTo, (block, pos) => {
      if (!block.isTextblock) return true;
      if (pos !== closing && (pos > $start.before() || startsParagraph))
        if (holdsResult(block, pos, field)) found.push({ node: block, pos });
      return false;
    });
    return found;
  };
  const $inline = tr.doc.resolve(field.resultTo);
  if ($inline.parentOffset) {
    // Its paragraph becomes the end's: emptied when no entry needs it (a split beside lines being
    // deleted cannot be tracked), else divided.
    const spare =
      $inline.before() !== $start.before() &&
      paragraphs.length <= linesBefore($inline.before()).length;
    if (spare) tr.delete($inline.start(), field.resultTo);
    else tr.split(field.resultTo);
    field = contentsField();
  }
  const $close = tr.doc.resolve(field.resultTo);
  const closing = $close.before();
  const closes = $close.parent;
  const lines = linesBefore(closing);
  // A section ending in what is replaced goes on ending after the last entry, not after the first.
  let section = closes.attrs.section ?? null;
  tr.doc.nodesBetween(field.from, field.resultTo, (block, pos) => {
    if (block.isTextblock && pos !== closing) section ??= block.attrs.section ?? null;
    return !block.isTextblock;
  });
  if (section !== (closes.attrs.section ?? null))
    tr.setNodeMarkup(closing, closes.type, { ...closes.attrs, section });
  if (paragraphs.length > lines.length) tr.insert(closing, paragraphs.slice(lines.length));
  for (let i = lines.length - 1; i >= 0; i--) {
    const { node: old, pos } = lines[i] as ParagraphAt;
    const entry = paragraphs[i];
    if (!entry) {
      tr.delete(pos, pos + old.nodeSize);
      continue;
    }
    const from = pos < field.from ? field.resultFrom : pos + 1;
    tr.replace(from, pos + 1 + old.content.size, new Slice(entry.content, 0, 0));
    const { revision, formatChange } = old.attrs;
    tr.setNodeMarkup(pos, old.type, { ...entry.attrs, revision, formatChange });
  }
  if (!startsParagraph) {
    // What the first paragraph held of the old result goes; the text before the field stays.
    const held = tr.doc.resolve(field.from);
    if (field.resultFrom < held.end()) tr.delete(field.resultFrom, held.end());
    if (held.parent.attrs.section)
      tr.setNodeMarkup(held.before(), held.parent.type, { ...held.parent.attrs, section: null });
  }
}

/** @internal A bookmark id no tree of the document uses yet. */
export function nextBookmarkId(state: EditorState, tr: Transaction): number {
  let max = -1;
  for (const tree of [tr.doc, ...otherTrees(state)])
    tree.descendants((node) => {
      if (node.type.name.startsWith("bookmark")) max = Math.max(max, node.attrs.id as number);
      return !node.isInline;
    });
  return freshId(state, max);
}

// ---------- updating ----------

/** The fields a range picks: a caret, the field around it (see `only`). */
function fieldsInRange(tree: Node, from: number, to: number): Set<number> {
  const fields = fieldsIn(tree);
  if (from < to)
    return new Set(fields.filter((f) => f.from < to && f.to > from).map((f) => f.from));
  // A caret stays out of a result's edges: one beside a field is at that field.
  let field =
    fieldAround(tree, from) ?? fields.find((f) => f.to === from || f.from === from) ?? null;
  if (field?.parent?.name === "TOC") field = field.parent;
  return new Set(field ? [field.from] : []);
}

function storyRun(editor: Editor, id: string, story: Story, body: Run, out: Transaction): void {
  const storyEditor = editor.story(id);
  if (!storyEditor || !fieldsIn(story.doc).length) return;
  const { state } = storyEditor;
  const tr = state.tr.setMeta(controlEdit, "fields");
  const { updated, unchanged } = body.report;
  updateTree({ ...body, state, tr, story: id, bodyTr: body.tr });
  if (!tr.docChanged) return;
  const tracked = trackTransaction(state, tr);
  if (!tracked) {
    // None of it happens: what the count said of this story is taken back.
    body.report.updated = updated;
    body.report.unchanged = unchanged;
    body.report.skipped.push({ instruction: "", story: id, reason: "untrackable" });
    return;
  }
  const result = state.applyTransaction(tracked);
  const next = result.state;
  out.step(
    storyEdit(id, story, result.transactions, next.doc, [
      state.selection.toJSON(),
      next.selection.toJSON(),
    ]),
  );
}

/** @internal The id of the story whose tree `doc` is. */
export function storyIdOf(body: EditorState, doc: Node): string {
  for (const [id, story] of wordContext(body)?.stories ?? []) if (story.doc === doc) return id;
  return "";
}

/**
 * Updates fields: one transaction, one undo step, tracked when tracking is on. Locked fields stay;
 * what cannot be worked out keeps its result and is reported. Page fields in a story are drawn by
 * the view page by page and left alone.
 */
export function updateFields(editor: Editor, options: UpdateFieldsOptions = {}): FieldsReport {
  const { state } = editor;
  const word = wordContext(state);
  if (!word) return emptyReport();
  const body = storyBody(state)?.state;
  const { only } = options;
  const picks =
    only && typeof only !== "function" ? fieldsInRange(state.doc, only.from, only.to) : null;
  const attempt = (contents: boolean) => {
    // Word updates fields in locked content and in lists.
    const tr = state.tr.setMeta(controlEdit, "fields");
    const run: Run = {
      state,
      tr,
      word,
      story: null,
      bodyTr: tr,
      options,
      report: emptyReport(),
      envelope: word.envelope,
      numbers: new Map(),
      contents,
      budget: { left: options.maxWritten ?? Number.POSITIVE_INFINITY },
      picked: (field) => {
        if (typeof only === "function") return only(field);
        if (!picks) return true;
        // What a table of contents holds goes with it.
        const holder = field.parent?.name === "TOC" ? field.parent : null;
        return [field, holder].some((f) => f && picks.has(originalPos(tr, f.from)));
      },
    };
    if (body) {
      run.story = storyIdOf(body, state.doc);
      run.bodyTr = body.tr;
    }
    updateTree(run);
    return { run, out: trackTransaction(state, tr) };
  };
  // What tracking cannot record stays out, and the other fields are still updated.
  let made = attempt(true);
  if (!made.out) made = attempt(false);
  const { run, out } = made;
  if (!out) {
    const report = emptyReport();
    report.skipped.push({ instruction: "", story: run.story, reason: "untrackable" });
    return report;
  }
  if (!body && !picks)
    for (const [id, story] of word.stories) storyRun(editor, id, story, run, out);
  if (out.docChanged) {
    if (run.envelope !== word.envelope) withEnvelope(out, run.envelope);
    out.setMeta(options.continues ? joinHistory : closeHistory, true);
    editor.dispatch(out.setMeta(untracked, true));
  }
  return run.report;
}

// ---------- inserting ----------

export interface InsertFieldOptions {
  /** The result until it is updated, when it cannot be worked out here. */
  result?: string;
  layout?: FieldLayout | null | undefined;
  data?: UpdateFieldsOptions["data"];
  now?: Date | undefined;
}

/** Whether a field can go at the selection. */
const canInsert = (state: EditorState) =>
  wordContext(state) !== null && state.selection.$from.parent.inlineContent;

/** Puts a new field at `pos` of `tr`, its result worked out; returns where it ends. */
function placeField(
  state: EditorState,
  tr: Transaction,
  pos: number,
  instruction: string,
  marks: readonly Mark[],
  options: InsertFieldOptions,
): number {
  const schema = tr.doc.type.schema;
  const make = (name: string, attrs?: Record<string, unknown>) =>
    (schema.nodes[name] as NodeType).create(attrs ?? null, null, marks);
  const initial = options.result ? inlineText(schema, options.result, marks) : [];
  const nodes = [
    make("fieldStart"),
    make("fieldCode", { text: ` ${instruction} ` }),
    make("fieldSeparator"),
    ...initial,
    make("fieldEnd"),
  ];
  tr.insert(pos, nodes);
  const size = nodes.reduce((sum, node) => sum + node.nodeSize, 0);
  const word = wordContext(state) as WordContext;
  const body = storyBody(state)?.state;
  const run: Run = {
    state,
    tr,
    word,
    story: body ? storyIdOf(body, state.doc) : null,
    bodyTr: body ? body.tr : tr,
    options,
    report: emptyReport(),
    envelope: word.envelope,
    numbers: new Map(),
    contents: true,
    picked: (field) => field.from === pos,
    budget: { left: Number.POSITIVE_INFINITY },
  };
  updateTree(run);
  if (run.envelope !== word.envelope) withEnvelope(tr, run.envelope);
  const placed = fieldsIn(tr.doc).find((f) => f.from === pos);
  return placed?.to ?? pos + size;
}

/** Replaces the selection with a field; its result is worked out where that can be done here. */
export function insertField(instruction: string, options: InsertFieldOptions = {}): Command {
  return (state, dispatch) => {
    if (!canInsert(state) || !instruction.trim()) return false;
    if (!dispatch) return true;
    return attempt(state, dispatch, (tr) => {
      const marks = withoutReview(state.storedMarks ?? marksAt(state.selection.$from));
      tr.deleteSelection();
      const end = placeField(state, tr, tr.selection.from, instruction.trim(), marks, options);
      tr.setSelection(TextSelection.create(tr.doc, end)).setMeta(closeHistory, true);
    });
  };
}

/** A `PAGE` field at the selection. */
export const insertPageNumber = (options: InsertFieldOptions = {}): Command =>
  insertField("PAGE", { result: "1", ...options });

/** A `DATE` field at the selection, in a Word date picture. */
export const insertDate = (picture = "d MMMM yyyy", options: InsertFieldOptions = {}): Command =>
  insertField(`DATE \\@ "${picture.replace(/"/g, '\\"')}"`, options);

/** What can be cross-referenced: bookmarks (not Word's own, `_…`) and headings. */
export interface CrossReferenceTargets {
  bookmarks: { name: string; text: string }[];
  headings: { pos: number; level: number; text: string; number: string }[];
}

export function crossReferenceTargets(state: EditorState): CrossReferenceTargets {
  const word = wordContext(state);
  if (!word) return { bookmarks: [], headings: [] };
  const tree = storyBody(state)?.state.doc ?? state.doc;
  const bookmarks = [...bookmarksIn(tree).values()]
    .filter((mark) => !mark.name.startsWith("_"))
    .map((mark) => ({
      name: mark.name,
      text: bookmarkContent(tree, mark)
        .map((n) => n.text ?? " ")
        .join(""),
    }));
  const numbers = new ListNumbers(tree, word);
  const headings = headingsOf(tree, word).flatMap(({ pos, level }) => {
    const node = tree.nodeAt(pos) as Node;
    const text = entryTitle(tree, word, { node, pos });
    return text.trim() ? [{ pos, level, text, number: numbers.marker(pos + 1)?.text ?? "" }] : [];
  });
  return { bookmarks, headings };
}

export interface CrossReference {
  /** A bookmark's name, or a heading's position (`crossReferenceTargets`). */
  to: string | number;
  /** What the field shows: the text, its page, or its paragraph's number. Default text. */
  show?: "text" | "page" | "number";
  /** Whether a click on it goes there (`\h`). Default true. */
  link?: boolean;
  layout?: FieldLayout | null | undefined;
}

/** A `REF` or `PAGEREF` at the selection; a heading gets a `_Ref` bookmark, as Word gives it. */
export function insertCrossReference(reference: CrossReference): Command {
  return (state, dispatch) => {
    const { to, show = "text", link = true, layout } = reference;
    // A heading is the body's: its bookmark cannot be added from a story's transaction.
    if (!canInsert(state) || (typeof to === "number" && storyBody(state))) return false;
    const heading = typeof to === "number" ? state.doc.nodeAt(to) : null;
    if (typeof to === "number" ? heading?.type.name !== "paragraph" : !findName(state, to))
      return false;
    if (!dispatch) return true;
    return attempt(state, dispatch, (tr) => {
      let name = typeof to === "string" ? to : null;
      if (typeof to === "number") {
        const node = heading as Node;
        node.forEach((child) => {
          // Not a `_Toc` one: Word makes those again with the table of contents.
          if (child.type.name === "bookmarkStart" && /^_Ref\d+$/.test(child.attrs.name as string))
            name ??= child.attrs.name as string;
        });
        if (!name) {
          name = bookmarkNames(tr.doc, "_Ref", idsOf(state))();
          const id = nextBookmarkId(state, tr);
          const { bookmarkStart, bookmarkEnd } = tr.doc.type.schema.nodes as Record<
            string,
            NodeType
          >;
          tr.insert(to + 1 + node.content.size, (bookmarkEnd as NodeType).create({ id }));
          tr.insert(to + 1, (bookmarkStart as NodeType).create({ id, name }));
        }
      }
      const marks = withoutReview(state.storedMarks ?? marksAt(state.selection.$from));
      tr.deleteSelection();
      const code =
        (show === "page" ? "PAGEREF " : "REF ") +
        quotedName(name as string) +
        (show === "number" ? " \\r" : "") +
        (link ? " \\h" : "");
      const end = placeField(state, tr, tr.selection.from, code, marks, { layout });
      tr.setSelection(TextSelection.create(tr.doc, end)).setMeta(closeHistory, true);
    });
  };
}

const findName = (state: EditorState, name: string) =>
  !!bookmarkNamed(storyBody(state)?.state.doc ?? state.doc, name);

export interface TableOfContentsOptions {
  /** The heading levels listed. Default 1 to 3. */
  from?: number;
  to?: number;
  /** Entries link to their headings (`\h`). Default true. */
  hyperlinks?: boolean;
  layout?: FieldLayout | null | undefined;
}

/**
 * A table of contents at the selection, as Word's own (`TOC \o "1-3" \h \z \u`), in a paragraph of
 * its own, built from the headings. Not in a story: Word's headings are the body's.
 */
export function insertTableOfContents(options: TableOfContentsOptions = {}): Command {
  return (state, dispatch) => {
    if (!canInsert(state) || storyBody(state)) return false;
    // A table of contents holds its entries, not another one.
    const { from: start, to: end } = state.selection;
    const inContents = fieldsIn(state.doc).some(
      (f) => f.name === "TOC" && f.from < end && start < f.to,
    );
    if (inContents) return false;
    if (!dispatch) return true;
    const { from = 1, to = 3, hyperlinks = true, layout } = options;
    return attempt(state, dispatch, (tr) => {
      tr.deleteSelection();
      const $pos = tr.selection.$from;
      const paragraph = tr.doc.type.schema.nodes.paragraph as NodeType;
      let at = $pos.pos;
      if ($pos.parent.content.size) {
        if ($pos.parentOffset === 0) {
          tr.insert($pos.before(), paragraph.create());
          at = $pos.before() + 1;
        } else if ($pos.parentOffset === $pos.parent.content.size) {
          tr.insert($pos.after(), paragraph.create());
          at = $pos.after() + 1;
        } else {
          tr.split($pos.pos);
          tr.insert($pos.pos + 1, paragraph.create());
          at = $pos.pos + 2;
        }
      }
      const code = `TOC \\o "${from}-${to}"${hyperlinks ? " \\h" : ""} \\z \\u`;
      const end = placeField(state, tr, at, code, [], { layout });
      tr.setSelection(TextSelection.create(tr.doc, end)).setMeta(closeHistory, true);
    });
  };
}
