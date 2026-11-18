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
import type { Editor } from "./editor.js";
import { type Field, fieldAround, fieldsIn } from "./fields.js";
import { closeHistory, joinHistory } from "./history.js";
import { marksAt, TextSelection } from "./selection.js";
import type { Command, EditorState, Transaction } from "./state.js";
import { trackTransaction, untracked } from "./track.js";
import {
  otherTrees,
  type Story,
  StoryStep,
  storyBody,
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
};
const GENERAL = "*@#";

/** Word's quoting: `"â€¦"`, with `\"` and `\\` inside; a switch is `\` and one character. */
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

/**
 * A date in a Word date picture (`\@`).
 * shortcut: month and day names are English; take the field's language when a document needs it.
 */
export function formatDatePicture(date: Date, picture: string): string {
  const hours12 = date.getHours() % 12 || 12;
  const parts: Record<string, string> = {
    d: String(date.getDate()),
    dd: pad(date.getDate()),
    ddd: (DAYS[date.getDay()] as string).slice(0, 3),
    dddd: DAYS[date.getDay()] as string,
    M: String(date.getMonth() + 1),
    MM: pad(date.getMonth() + 1),
    MMM: (MONTHS[date.getMonth()] as string).slice(0, 3),
    MMMM: MONTHS[date.getMonth()] as string,
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
  return picture.replace(/'([^']*)'|AM\/PM|am\/pm|d+|M+|y+|h+|H+|m+|s+/g, (match, quoted) => {
    if (quoted !== undefined) return quoted as string;
    if (match === "AM/PM") return noon ? "AM" : "PM";
    if (match === "am/pm") return noon ? "am" : "pm";
    return parts[match] ?? match;
  });
}

/** A number in a Word numeric picture (`\#`): `0`, `#`, `,`, `.`, literals, `;` sections. */
export function formatNumericPicture(value: number, picture: string): string {
  const sections = picture.split(";");
  const negative = value < 0 && sections[1] !== undefined;
  const zero = value === 0 && sections[2] !== undefined;
  const chosen = (negative ? sections[1] : zero ? sections[2] : sections[0]) as string;
  const first = chosen.search(/[0#]/);
  if (first < 0) return chosen.replace(/'/g, "");
  let last = first;
  for (let i = first; i < chosen.length; i++) if (/[0#.,]/.test(chosen[i] as string)) last = i;
  while (!/[0#]/.test(chosen[last] as string)) last--;
  const pattern = chosen.slice(first, last + 1);
  const [whole = "", fraction = ""] = pattern.split(".");
  const fixed = Math.abs(value).toFixed(fraction.length);
  const [digits = "", decimals = ""] = fixed.split(".");
  const slots = whole.replace(/,/g, "");
  let out = "";
  let d = digits.length - 1;
  for (let s = slots.length - 1; s >= 0 || d >= 0; s--) {
    const slot = s >= 0 ? slots[s] : "#";
    const digit = d >= 0 ? (digits[d] as string) : slot === "0" ? "0" : "";
    const placed = slots.length - s;
    out = digit + (whole.includes(",") && digit && placed > 1 && placed % 3 === 1 ? "," : "") + out;
    d--;
  }
  if (out === "0" && slots[slots.length - 1] === "#") out = "";
  const sign = value < 0 && !negative ? "-" : "";
  const literal = (text: string) => text.replace(/'/g, "");
  return (
    literal(chosen.slice(0, first)) +
    sign +
    out +
    (fraction ? `.${decimals}` : "") +
    literal(chosen.slice(last + 1))
  );
}

const NUMBER_SWITCH: Record<string, string> = {
  ROMAN: "upperRoman",
  roman: "lowerRoman",
  ALPHABETIC: "upperLetter",
  alphabetic: "lowerLetter",
};
const NUMBER_SWITCH_ANY_CASE: Record<string, string> = { arabic: "decimal", ordinal: "ordinal" };
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
    const asNumber = NUMBER_SWITCH[name] ?? NUMBER_SWITCH_ANY_CASE[lower];
    if (asNumber) format = asNumber;
    else if (lower === "hex") hex = true;
    else if (CASE_SWITCH[lower]) cases.push(CASE_SWITCH[lower]);
    else return null;
  }
  let text = String(value);
  if (number !== null && picture !== undefined) text = formatNumericPicture(number, picture);
  else if (number !== null && hex) text = number.toString(16).toUpperCase();
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
  /** How many pages its section has. */
  sectionPages: number;
  /** The section's number format (`upperRoman`â€¦). */
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
}

export type FieldSkipReason =
  | "locked"
  | "unknown"
  | "no-layout"
  | "no-data"
  | "missing-bookmark"
  | "unsupported-switch"
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

interface Bookmark {
  name: string;
  /** After its start marker, before its end marker. */
  from: number;
  to: number;
}

function bookmarksIn(tree: Node): Map<string, Bookmark> {
  const starts = new Map<unknown, { name: string; from: number }>();
  const out = new Map<string, Bookmark>();
  tree.descendants((node, pos) => {
    if (node.type.name === "bookmarkStart")
      starts.set(node.attrs.id, { name: String(node.attrs.name), from: pos + 1 });
    else if (node.type.name === "bookmarkEnd") {
      const start = starts.get(node.attrs.id);
      if (start && !out.has(start.name)) out.set(start.name, { ...start, to: pos });
    }
    return !node.isInline;
  });
  return out;
}

interface ParagraphAt {
  node: Node;
  pos: number;
}

function paragraphsOf(tree: Node): ParagraphAt[] {
  const out: ParagraphAt[] = [];
  tree.descendants((node, pos) => {
    if (node.type.name === "paragraph") out.push({ node, pos });
    return !node.isTextblock;
  });
  return out;
}

const REVIEW = new Set(["insertion", "deletion", "formatChange"]);
const withoutReview = (marks: readonly Mark[]) => marks.filter((m) => !REVIEW.has(m.type.name));
const isGone = (node: Node) => node.marks.some((m) => m.type.name === "deletion");

/** Text as inline nodes: tabs and line feeds become their nodes. */
function inlineText(schema: Schema, text: string, marks: readonly Mark[]): Node[] {
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
function resultMarks(tree: Node, field: Field, instruction: FieldInstruction): readonly Mark[] {
  const merge = (instruction.switches.get("*") ?? []).some(
    (name) => name.toLowerCase() === "mergeformat",
  );
  let marks: readonly Mark[] | undefined;
  if (merge)
    tree.nodesBetween(field.resultFrom, field.resultTo, (node) => {
      if (node.isText && !marks && !isGone(node)) marks = node.marks;
      return !marks;
    });
  if (!marks)
    tree.nodesBetween(field.from, field.codeEnd, (node) => {
      if (node.type.name === "fieldCode" && !marks) marks = node.marks;
      return !marks;
    });
  return withoutReview(marks ?? []);
}

/**
 * What a bookmark holds, as inline nodes. Field codes and markers stay behind.
 * shortcut: a paragraph end inside the bookmark becomes a line break, where Word's result has the
 * paragraph; make it a slice when a document needs it.
 */
function bookmarkContent(tree: Node, mark: Bookmark): Node[] {
  const schema = tree.type.schema;
  const codes = fieldsIn(tree);
  const out: Node[] = [];
  const hardBreak = schema.nodes.hardBreak as NodeType;
  let paragraph: Node | null = null;
  tree.nodesBetween(mark.from, mark.to, (node, pos, parent) => {
    if (!node.isInline) return true;
    if (paragraph && parent !== paragraph) out.push(hardBreak.create());
    paragraph = parent;
    if (isGone(node) || codes.some((f) => pos >= f.from && pos < f.codeEnd)) return false;
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

  constructor(tree: Node, word: WordContext) {
    this.paragraphs = paragraphsOf(tree);
    this.markers = word.resolver.markers(this.paragraphs.map((p) => p.node.attrs));
  }

  private indexAt(pos: number): number {
    let found = -1;
    for (let i = 0; i < this.paragraphs.length; i++) {
      const { pos: at, node } = this.paragraphs[i] as ParagraphAt;
      if (at > pos) break;
      if (pos <= at + node.nodeSize) found = i;
    }
    return found;
  }

  marker(pos: number): ListMarker | null {
    return this.markers[this.indexAt(pos)] ?? null;
  }

  /** The numbered paragraphs above it in its list, then itself: indexes, outermost first. */
  private chain(index: number): number[] {
    const out = [index];
    let level = this.markers[index]?.level ?? 0;
    const list = this.markers[index]?.instance;
    for (let i = index - 1; i >= 0 && level > 0; i--) {
      const marker = this.markers[i];
      if (marker?.instance === list && marker && marker.level < level) {
        out.unshift(i);
        level = marker.level;
      }
    }
    return out;
  }

  /** `\n`: alone; `\w`: in full; `\r`: relative to the paragraph at `from`. */
  number(pos: number, mode: "n" | "w" | "r", from: number): string {
    const index = this.indexAt(pos);
    if (!this.markers[index]) return "0";
    const bare = (i: number) => (this.markers[i]?.text ?? "").replace(/\.+$/, "");
    if (mode === "n") return bare(index);
    let chain = this.chain(index);
    if (mode === "r") {
      const here = this.markers[this.indexAt(from)] ? this.chain(this.indexAt(from)) : [];
      let shared = 0;
      while (shared < chain.length - 1 && chain[shared] === here[shared]) shared++;
      chain = chain.slice(shared);
    }
    const parts: string[] = [];
    for (const i of chain) {
      const text = bare(i);
      const previous = parts[parts.length - 1];
      // "2.3" under "2" already holds it.
      if (previous && text.startsWith(previous) && !/^\w/.test(text.slice(previous.length)))
        parts[parts.length - 1] = text;
      else parts.push(text);
    }
    return parts.join("");
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
  /** Picks fields of this tree. */
  picked(field: Field): boolean;
}

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

function headingLevel(word: WordContext, paragraph: Node): number | null {
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
  let last = 0;
  const marks = bookmarksIn(tree);
  for (const field of fields) {
    if (field.name !== "SEQ" || field.deleted) continue;
    const { args, switches } = parseFieldInstruction(field.instruction);
    const id = (args[0] ?? "").toLowerCase();
    const list = seen.get(id) ?? [];
    seen.set(id, list);
    let value = counters.get(id) ?? 0;
    const resetLevel = Number(switches.get("s")?.[0]);
    if (
      resetLevel &&
      headings.some((h) => h.pos >= last && h.pos < field.from && h.level <= resetLevel)
    )
      value = 0;
    const target = args[1] ? marks.get(args[1]) : undefined;
    const restart = switches.get("r")?.[0];
    if (target) value = [...list].reverse().find((s) => s.pos < target.from)?.value ?? 0;
    else if (restart !== undefined && Number.isFinite(Number(restart))) value = Number(restart);
    else if (!switches.has("c")) value++;
    if (!target) counters.set(id, value);
    list.push({ pos: field.from, value });
    values.set(field, value);
    last = field.from;
  }
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
  const own = bookmarksIn(run.tr.doc).get(name);
  if (own) return { mark: own, tree: run.tr.doc, inBody: run.story === null };
  const body = run.story === null ? undefined : bookmarksIn(run.bodyTr.doc).get(name);
  return body ? { mark: body, tree: run.bodyTr.doc, inBody: true } : null;
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
    case "SEQ":
      return switches.has("h") ? { text: "" } : done(sequence.get(field) ?? 0);
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
      if (value instanceof Date)
        shown = picture ? formatDatePicture(value, picture) : value.toISOString();
      else if (picture && typeof value === "string" && !Number.isNaN(Date.parse(value)))
        shown = formatDatePicture(new Date(value), picture);
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
    let text = new ListNumbers(tree, run.word).number(mark.from, mode, field.from);
    if (switches.has("t")) text = text.replace(/[^\d.\-:]/g, "");
    return done(place ? `${text} ${place}` : text);
  }
  if (place) return done(place);
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
  const marks = resultMarks(tr.doc, field, parseFieldInstruction(field.instruction));
  const separator = (tr.doc.type.schema.nodes.fieldSeparator as NodeType).create(null, null, marks);
  tr.insert(field.to - 1, [separator, ...nodes]);
}

const lockedChain = (field: Field) => {
  for (let at: Field | null = field; at; at = at.parent) if (at.locked) return true;
  return false;
};

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
      const worked = work(run, field, sequence);
      if (!worked) continue;
      if (worked.text === field.result) {
        report.unchanged++;
        continue;
      }
      report.updated++;
      const marks = resultMarks(tr.doc, field, parseFieldInstruction(field.instruction));
      jobs.set(field, worked.nodes ?? inlineText(schema, worked.text, marks));
    }
    // From the end, so positions stay good; a result replaced takes the fields inside it along.
    for (const [field, nodes] of [...jobs].reverse()) {
      let outer = field.parent;
      while (outer && !jobs.has(outer)) outer = outer.parent;
      if (!outer) putResult(run, field, nodes);
    }
  }
  if (story !== null) {
    for (const field of fieldsIn(tr.doc))
      if (field.name === "TOC" && usable(field)) skip(run, field, "unknown", "in a story");
    return;
  }
  const count = fieldsIn(tr.doc).filter((f) => f.name === "TOC").length;
  for (let i = 0; i < count; i++) {
    const field = fieldsIn(tr.doc).filter((f) => f.name === "TOC")[i] as Field;
    if (usable(field)) rebuildContents(run, i);
  }
}

// ---------- tables of contents ----------

interface Entry {
  paragraph: ParagraphAt;
  level: number;
  title: string;
  number: string;
  /** What follows the number: Word's tab, or a space. */
  numberGap: string;
  bookmark: string | null;
}

/** A paragraph's text for its entry: no codes, no deleted text, line breaks as spaces. */
function entryTitle(tree: Node, { node, pos }: ParagraphAt): string {
  const fields = fieldsIn(tree);
  let out = "";
  node.forEach((child, offset) => {
    const at = pos + 1 + offset;
    if (isGone(child) || fields.some((f) => at >= f.from && at < f.codeEnd)) return;
    if (child.isText) out += child.text;
    else if (child.type.name === "tab") out += "\t";
    else if (child.type.name === "hardBreak") out += " ";
  });
  return out;
}

const TOC_BOOKMARK = /^_Toc\d+$/;

/** The range of levels `\o` (or `\u`) asks for. */
const levelRange = (value: string | undefined) => {
  const match = /(\d)\s*-\s*(\d)/.exec(value ?? "");
  return match ? [Number(match[1]), Number(match[2])] : [1, 9];
};

/** The headings a table of contents lists, as its switches say. */
function contentsEntries(tree: Node, word: WordContext, { switches }: FieldInstruction): Entry[] {
  const hasSource = switches.has("o") || switches.has("u") || switches.has("t");
  const [low, high] = levelRange(switches.get("o")?.[0]) as [number, number];
  const custom = new Map<string, number>();
  const pairs = (switches.get("t")?.[0] ?? "").split(/[,;]/).map((s) => s.trim());
  for (let i = 0; i + 1 < pairs.length; i += 2)
    custom.set((pairs[i] as string).toLowerCase(), Number(pairs[i + 1]) || 1);
  const scope = switches.has("b") ? bookmarksIn(tree).get(switches.get("b")?.[0] ?? "") : null;
  const paragraphs = paragraphsOf(tree);
  const markers = word.resolver.markers(paragraphs.map((p) => p.node.attrs));
  const contents = fieldsIn(tree).filter((f) => f.name === "TOC");
  const out: Entry[] = [];
  paragraphs.forEach((paragraph, i) => {
    const { node, pos } = paragraph;
    if (contents.some((f) => pos + 1 >= f.from && pos < f.to)) return;
    if (scope && (pos + node.nodeSize <= scope.from || pos >= scope.to)) return;
    const format = word.resolver.paragraph(node.attrs).paragraph;
    const style = word.envelope.styles.find((s) => s.id === format.style);
    let level: number | undefined = custom.get((style?.name ?? format.style ?? "").toLowerCase());
    if (level === undefined && (switches.has("o") || !hasSource)) {
      const heading = headingLevel(word, node);
      if (heading !== null && heading >= low && heading <= high) level = heading;
    }
    const outline = format.outlineLevel;
    if (level === undefined && switches.has("u") && outline !== null && outline < 9)
      if (outline + 1 >= low && outline + 1 <= high) level = outline + 1;
    if (level === undefined) return;
    const title = entryTitle(tree, paragraph);
    if (!title.trim()) return;
    const marker = markers[i];
    let bookmark: string | null = null;
    node.forEach((child) => {
      if (child.type.name === "bookmarkStart" && TOC_BOOKMARK.test(String(child.attrs.name)))
        bookmark ??= String(child.attrs.name);
    });
    out.push({
      paragraph,
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

/** The styles of the paragraphs a result fills: its last, holding only the end, left out. */
function resultStyles(tree: Node, field: Field): (string | null)[] {
  const out: (string | null)[] = [];
  tree.nodesBetween(field.from, field.to, (node, pos) => {
    if (!node.isTextblock) return true;
    if (pos + 1 !== field.resultTo) out.push((node.attrs.style as string | null) ?? null);
    return false;
  });
  return out;
}

const NO_ENTRIES = "No table of contents entries found.";

/** Makes the table of contents number `index` of the tree list what its headings say. */
function rebuildContents(run: Run, index: number): void {
  const { tr, word, report } = run;
  const contentsField = () => fieldsIn(tr.doc).filter((f) => f.name === "TOC")[index] as Field;
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
    const page = layout.pageAt(originalPos(tr, entry.paragraph.pos + 1));
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
  const wanted = entries.map((entry) => line(entry, pageText(entry))).join("\r");
  const current = resultStyles(tr.doc, field);
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
  let serial = 0;
  for (const name of bookmarksIn(tr.doc).keys())
    if (TOC_BOOKMARK.test(name)) serial = Math.max(serial, Number(name.slice(4)));
  serial = serial || 200_000_000;
  let id = nextBookmarkId(run.state, tr);
  const start = schema.nodes.bookmarkStart as NodeType;
  const end = schema.nodes.bookmarkEnd as NodeType;
  const missing = entries.filter((entry) => !entry.bookmark);
  const ids = new Map(missing.map((entry) => [entry, id++]));
  for (const entry of missing) entry.bookmark = `_Toc${++serial}`;
  for (const entry of missing.reverse()) {
    const { pos, node } = entry.paragraph;
    const mark = ids.get(entry) as number;
    tr.insert(pos + 1 + node.content.size, end.create({ id: mark }));
    tr.insert(pos + 1, start.create({ id: mark, name: entry.bookmark }));
  }
  field = contentsField();
  const hyperlinks = switches.has("h");
  const linkStyle = hyperlinks && ensureStyle({ envelope: run.envelope }, "Hyperlink", "character");
  if (linkStyle) run.envelope = linkStyle.envelope;
  const width = textWidth(tr.doc, word, field.from) - 10;
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
    const tabs = [
      ...(entry.number && entry.numberGap === "\t"
        ? [{ position: 220 + 220 * entry.level, kind: "left" }]
        : []),
      ...(separator === "\t" ? [{ position: width, kind: "right", leader: "dot" }] : []),
    ];
    return (schema.nodes.paragraph as NodeType).create(
      { style: styles[i], ...(tabs.length ? { tabs } : {}) },
      content,
    );
  });
  if (!layout)
    report.skipped.push({ instruction: field.instruction, story: null, reason: "no-layout" });
  const $start = tr.doc.resolve(field.from);
  const $end = tr.doc.resolve(field.resultTo);
  const startsParagraph = $start.parentOffset === 0;
  if (!paragraphs.length) {
    tr.replace(
      field.resultFrom,
      field.resultTo,
      new Slice(Fragment.from(schema.text(NO_ENTRIES)), 0, 0),
    );
    return;
  }
  // The end stays in its own paragraph when it has one (or would be left with the last entry).
  const nodes =
    $end.parentOffset === 0 || $end.pos === field.resultFrom
      ? [...paragraphs, $end.parent.type.create($end.parent.attrs)]
      : paragraphs;
  tr.replace(field.resultFrom, field.resultTo, new Slice(Fragment.fromArray(nodes), 1, 1));
  if (startsParagraph) {
    const first = paragraphs[0] as Node;
    const { section, controls } = $start.parent.attrs;
    tr.setNodeMarkup($start.before(), first.type, { ...first.attrs, section, controls });
  }
}

/** A bookmark id no tree of the document uses yet. */
function nextBookmarkId(state: EditorState, tr: Transaction): number {
  let max = -1;
  for (const tree of [tr.doc, ...otherTrees(state)])
    tree.descendants((node) => {
      if (node.type.name.startsWith("bookmark")) max = Math.max(max, node.attrs.id as number);
      return !node.isInline;
    });
  return max + 1;
}

// ---------- updating ----------

/** The fields a range picks: a caret, the field around it (see `only`). */
function fieldsInRange(tree: Node, from: number, to: number): Set<number> {
  const fields = fieldsIn(tree);
  if (from < to)
    return new Set(fields.filter((f) => f.from < to && f.to > from).map((f) => f.from));
  let field = fieldAround(tree, from);
  if (field?.parent?.name === "TOC") field = field.parent;
  return new Set(field ? [field.from] : []);
}

function storyRun(editor: Editor, id: string, story: Story, body: Run, out: Transaction): void {
  const storyEditor = editor.story(id);
  if (!storyEditor || !fieldsIn(story.doc).length) return;
  const { state } = storyEditor;
  const tr = state.tr;
  updateTree({ ...body, state, tr, story: id, bodyTr: body.tr });
  if (!tr.docChanged) return;
  const tracked = trackTransaction(state, tr);
  if (!tracked) {
    body.report.skipped.push({ instruction: "", story: id, reason: "untrackable" });
    return;
  }
  const next = state.applyTransaction(tracked).state;
  out.step(
    new StoryStep(
      id,
      story,
      { ...story, doc: next.doc },
      state.selection.toJSON(),
      next.selection.toJSON(),
    ),
  );
}

/** The id of the story whose tree `doc` is. */
function storyIdOf(body: EditorState, doc: Node): string {
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
  const report = emptyReport();
  const word = wordContext(state);
  if (!word) return report;
  const body = storyBody(state)?.state;
  const { only } = options;
  const picks =
    only && typeof only !== "function" ? fieldsInRange(state.doc, only.from, only.to) : null;
  const tr = state.tr;
  const run: Run = {
    state,
    tr,
    word,
    story: null,
    bodyTr: tr,
    options,
    report,
    envelope: word.envelope,
    picked: (field) => {
      if (typeof only === "function") return only(field);
      if (!picks) return true;
      // What a table of contents holds goes with it.
      const contents = field.parent?.name === "TOC" ? field.parent : null;
      return [field, contents].some((f) => f && picks.has(originalPos(tr, f.from)));
    },
  };
  if (body) {
    run.story = storyIdOf(body, state.doc);
    run.bodyTr = body.tr;
  }
  updateTree(run);
  const finish = (out: Transaction) => {
    if (run.envelope !== word.envelope) withEnvelope(out, run.envelope);
    return out.setMeta(options.continues ? joinHistory : closeHistory, true);
  };
  if (body || picks) {
    if (tr.docChanged) editor.dispatch(finish(tr));
    return report;
  }
  const out = trackTransaction(state, tr);
  if (!out) {
    report.skipped.push({ instruction: "", story: null, reason: "untrackable" });
    return report;
  }
  for (const [id, story] of word.stories) storyRun(editor, id, story, run, out);
  if (out.docChanged) editor.dispatch(finish(out).setMeta(untracked, true));
  return report;
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
    picked: (field) => field.from === pos,
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

/** What can be cross-referenced: bookmarks (not Word's own, `_â€¦`) and headings. */
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
    const text = entryTitle(tree, { node, pos });
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
          let serial = 200_000_000;
          for (const known of bookmarksIn(tr.doc).keys())
            if (/^_Ref\d+$/.test(known)) serial = Math.max(serial, Number(known.slice(4)));
          name = `_Ref${serial + 1}`;
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
        name +
        (show === "number" ? " \\r" : "") +
        (link ? " \\h" : "");
      const end = placeField(state, tr, tr.selection.from, code, marks, { layout });
      tr.setSelection(TextSelection.create(tr.doc, end)).setMeta(closeHistory, true);
    });
  };
}

const findName = (state: EditorState, name: string) =>
  bookmarksIn(storyBody(state)?.state.doc ?? state.doc).has(name);

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
