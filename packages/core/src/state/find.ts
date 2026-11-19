/**
 * Find and replace over the body and every story (ADR-0007, 11.11), with the rules Word 16 was seen
 * to follow through its object model: a match runs across runs, marks and whatever draws nothing
 * (field markers, bookmarks, comment anchors) but not across a note reference or a picture; a
 * straight quote finds curly ones and a space a no-break space, not the other way round; "whole
 * words" takes letters and digits as word characters (`_` and `'` end a word) and is ignored when
 * the query has a space; the replacement takes the formatting of the match's first character and,
 * unless the case must match, follows its capitals.
 *
 * Regular expressions are left out: a user's pattern can backtrack for ever on the main thread, and
 * Word's own wildcards are another language.
 */
import { Fragment, type Node, Slice } from "../model/index.js";
import type { ControlJSON } from "../v3/document.js";
import { controlAt, controlsIn, readOnlyAt } from "./controls.js";
import { createEditor, type Editor, type EditorDocument } from "./editor.js";
import { fieldAround, fieldCodesShown, fieldsIn, isUnseen } from "./fields.js";
import { inlineText, storyIdOf, withoutReview } from "./fieldupdate.js";
import { TextSelection } from "./selection.js";
import type { EditorState, Transaction } from "./state.js";
import { editTrees } from "./stories.js";
import { trackState, trackTransaction } from "./track.js";
import { storyBody, wordContext } from "./word.js";

export interface FindOptions {
  /** Capitals count. Default false. */
  matchCase?: boolean | undefined;
  /** Only whole words (ignored when the query has a space, as in Word). Default false. */
  wholeWord?: boolean | undefined;
}

/** A place the query was found. Positions are those of its tree. */
export interface FindMatch {
  /** The story it is in; null: the body. */
  story: string | null;
  from: number;
  to: number;
  /** The text found, as the document has it. */
  text: string;
}

/** Why a match was left as it is. */
export type ReplaceRefusal =
  /** In a content control that is locked or filled from bound data. */
  | "locked"
  /** A control's kind does not take it, or the match runs over a control's edge. */
  | "control"
  /** The match runs over the edge of a field's result. */
  | "field"
  /** In a field's code, which shows only while codes are shown. */
  | "field-code"
  /** In text already deleted as a tracked change. */
  | "deleted"
  /** The document no longer has this text there. */
  | "stale"
  /** It could not be made or recorded as a tracked change. */
  | "refused";

export interface ReplaceReport {
  replaced: number;
  refused: { match: FindMatch; reason: ReplaceRefusal }[];
}

// ---------- matching text ----------

/** What stands for something that draws but is not text: nothing matches it. */
const BARRIER = "￼";
/** What a plain character in a query also finds. */
const LOOSE: Readonly<Record<string, string>> = {
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  " ": " ",
};
const LOOSE_CHARS = /[‘’“” ]/g;
const loosen = (text: string) => text.replace(LOOSE_CHARS, (c) => LOOSE[c] as string);
/** Letters, digits and what combines with them. */
const WORD_CHAR = /^[\p{L}\p{N}\p{M}]/u;

/** Lower case, unit for unit, so offsets stay the text's. */
function fold(text: string): string {
  let out = text.toLowerCase();
  if (out.length !== text.length) {
    out = "";
    for (let i = 0; i < text.length; i++) {
      const lower = (text[i] as string).toLowerCase();
      out += lower.length === 1 ? lower : text[i];
    }
  }
  return out.replace(/ς/g, "σ"); // a final sigma is a sigma
}

interface Needle {
  query: string;
  text: string;
  matchCase: boolean;
  whole: boolean;
  /** Offsets of the characters that find only themselves. */
  exact: number[];
}

function needleFor(query: string, { matchCase = false, wholeWord = false }: FindOptions) {
  if (!query || query.includes(BARRIER)) return null;
  const plain = loosen(query);
  const exact: number[] = [];
  for (let i = 0; i < query.length; i++) if (query[i] !== plain[i]) exact.push(i);
  const whole = wholeWord && !/\s/.test(query);
  return { query, text: matchCase ? plain : fold(plain), matchCase, whole, exact } as Needle;
}

const charAfter = (text: string, at: number) =>
  String.fromCodePoint(text.codePointAt(at) as number);
function charBefore(text: string, at: number): string {
  const unit = text.charCodeAt(at - 1);
  return unit >= 0xdc00 && unit <= 0xdfff && at > 1 ? text.slice(at - 2, at) : (text[at - 1] ?? "");
}

/** Whether no word goes on past either end of `from..to`. */
function isWhole(text: string, from: number, to: number): boolean {
  if (from > 0 && WORD_CHAR.test(charAfter(text, from)) && WORD_CHAR.test(charBefore(text, from)))
    return false;
  return !(
    to < text.length &&
    WORD_CHAR.test(charBefore(text, to)) &&
    WORD_CHAR.test(charAfter(text, to))
  );
}

function eachHit(
  raw: string,
  haystack: string,
  needle: Needle,
  hit: (from: number, to: number) => void,
): void {
  const { text, query, exact, whole } = needle;
  let at = haystack.indexOf(text);
  while (at >= 0) {
    const end = at + text.length;
    if (exact.every((i) => raw[at + i] === query[i]) && (!whole || isWhole(raw, at, end))) {
      hit(at, end);
      at = haystack.indexOf(text, end);
    } else at = haystack.indexOf(text, at + 1);
  }
}

/** Where `query` is in a plain text, by Word's rules: `[from, to]` pairs, none overlapping. */
export function findInText(
  text: string,
  query: string,
  options: FindOptions = {},
): [number, number][] {
  const needle = needleFor(query, options);
  if (!needle) return [];
  const out: [number, number][] = [];
  const plain = loosen(text);
  eachHit(text, needle.matchCase ? plain : fold(plain), needle, (from, to) => {
    out.push([from, to]);
  });
  return out;
}

// ---------- what can be searched ----------

/** A stretch of a line's text and where it is in the tree. */
interface Piece {
  at: number;
  length: number;
  pos: number;
  /** A field code: one node, however long its text. */
  code: boolean;
}

/** A paragraph as find sees it. */
interface Line {
  text: string;
  pieces: Piece[];
  plain?: string;
  folded?: string;
}

/** What shows, which decides what can be found. */
interface Scope {
  codes: boolean;
  hideDeleted: boolean;
  controls: Readonly<Record<string, ControlJSON>> | undefined;
}

interface Hidden {
  from: number;
  to: number;
  /** It shows as something else: a match cannot run across it. */
  barrier: boolean;
}

const PAGE_FIELDS = new Set(["PAGE", "NUMPAGES", "SECTIONPAGES"]);
const hasMark = (node: Node, name: string) =>
  node.marks.some((m) => m.type.name === name && m.attrs.value !== false);

/** What of `tree` is not on the page, in order, overlaps joined. */
function hiddenRanges(tree: Node, scope: Scope, story: boolean): Hidden[] {
  const ranges: Hidden[] = [];
  for (const field of fieldsIn(tree)) {
    if (scope.codes) {
      if (field.separator !== null)
        ranges.push({ from: field.separator + 1, to: field.resultTo, barrier: false });
      continue;
    }
    ranges.push({ from: field.from, to: field.codeEnd, barrier: false });
    // The view draws these page by page: what the tree stores is not what shows.
    if (story && PAGE_FIELDS.has(field.name))
      ranges.push({ from: field.resultFrom, to: field.resultTo, barrier: true });
  }
  const { controls } = scope;
  if (controls)
    for (const range of controlsIn(tree))
      if (Object.hasOwn(controls, range.id) && controls[range.id]?.placeholder?.showing)
        ranges.push({ from: range.contentFrom, to: range.contentTo, barrier: true });
  ranges.sort((a, b) => a.from - b.from);
  const out: Hidden[] = [];
  for (const range of ranges) {
    const last = out[out.length - 1];
    if (last && range.from <= last.to) {
      last.to = Math.max(last.to, range.to);
      last.barrier ||= range.barrier;
    } else out.push({ ...range });
  }
  return out;
}

const known = new WeakMap<Node, { key: string; scope: Scope; lines: Line[] }>();

/** The lines of `tree`, kept while the tree and what shows stay the same (typing in the panel). */
function linesOf(tree: Node, scope: Scope, story: boolean): Line[] {
  const key = `${scope.codes}|${scope.hideDeleted}`;
  const cached = known.get(tree);
  if (cached?.key === key && cached.scope.controls === scope.controls) return cached.lines;
  const hidden = hiddenRanges(tree, scope, story);
  const lines: Line[] = [];
  let h = 0;
  tree.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const pieces: Piece[] = [];
    let text = "";
    let walled = -1;
    const add = (value: string, at: number, code = false) => {
      pieces.push({ at: text.length, length: value.length, pos: at, code });
      text += value;
    };
    node.forEach((child, offset) => {
      const at = pos + 1 + offset;
      while (h < hidden.length && (hidden[h] as Hidden).to <= at) h++;
      const range = hidden[h];
      if (range && range.from <= at) {
        if (range.barrier && walled !== h) {
          walled = h;
          text += BARRIER;
        }
        return;
      }
      if (hasMark(child, "hidden") || (scope.hideDeleted && hasMark(child, "deletion"))) return;
      const name = child.type.name;
      if (child.isText) add(child.text as string, at);
      else if (name === "tab") add("\t", at);
      else if (name === "hardBreak") add("\n", at);
      else if (name === "fieldCode" && scope.codes) add(String(child.attrs.text ?? ""), at, true);
      else if (!isUnseen(child)) text += BARRIER;
    });
    if (text) lines.push({ text, pieces });
    return false;
  });
  known.set(tree, { key, scope, lines });
  return lines;
}

/** A found place with the stretches of the tree it covers. */
interface Hit {
  match: FindMatch;
  parts: { from: number; to: number; code: boolean }[];
}

function hitsIn(lines: readonly Line[], story: string | null, needle: Needle, out: Hit[]): void {
  for (const line of lines) {
    line.plain ??= loosen(line.text);
    if (!needle.matchCase) line.folded ??= fold(line.plain);
    const haystack = needle.matchCase ? line.plain : (line.folded as string);
    if (haystack.length < needle.text.length) continue;
    eachHit(line.text, haystack, needle, (a, b) => {
      const parts: Hit["parts"] = [];
      for (const { at, length, pos, code } of line.pieces) {
        const start = Math.max(a, at);
        const end = Math.min(b, at + length);
        if (start >= end) continue;
        if (code) parts.push({ from: pos, to: pos + 1, code });
        else parts.push({ from: pos + start - at, to: pos + end - at, code });
      }
      const first = parts[0];
      const last = parts[parts.length - 1];
      if (!first || !last) return;
      const match = { story, from: first.from, to: last.to, text: line.text.slice(a, b) };
      out.push({ match, parts });
    });
  }
}

/** The body's state of `target`, whichever of its editors it is. */
const bodyState = (state: EditorState) => storyBody(state)?.state ?? state;

const scopeOf = (body: EditorState): Scope => {
  const view = trackState(body)?.view ?? "markup";
  return {
    codes: fieldCodesShown(body),
    hideDeleted: view !== "markup",
    controls: wordContext(body)?.envelope.controls,
  };
};

/** The trees searched: the body, then the stories that hold text (no note separators). */
function treesOf(body: EditorState): { id: string | null; tree: Node }[] {
  const stories = wordContext(body)?.stories ?? new Map();
  return [
    { id: null, tree: body.doc },
    ...[...stories]
      .filter(([, story]) => !story.noteType)
      .map(([id, story]) => ({ id: id as string, tree: story.doc as Node })),
  ];
}

function hitsOf(body: EditorState, query: string, options: FindOptions): Hit[] {
  const needle = needleFor(query, options);
  if (!needle) return [];
  const scope = scopeOf(body);
  const out: Hit[] = [];
  for (const { id, tree } of treesOf(body))
    hitsIn(linesOf(tree, scope, id !== null), id, needle, out);
  return out;
}

/**
 * Every place `query` is, in the body then in each story, as the document shows now: a field's
 * code only while codes are shown (its result then not), text deleted as a tracked change only in
 * the `markup` review view, no control's placeholder, no hidden text. A `document` is read as an
 * editor would load it, with those at their defaults.
 */
export function findAll(
  target: Editor | EditorDocument,
  query: string,
  options: FindOptions = {},
): FindMatch[] {
  const editor = "getDocument" in target ? target : createEditor({ document: target });
  return hitsOf(bodyState(editor.state), query, options).map((hit) => hit.match);
}

// ---------- replacing ----------

/** The replacement as Word writes it over `found`: its capitals followed. */
function withCaseOf(found: string, text: string): string {
  const first = found[0] ?? "";
  if (first === first.toLowerCase() || !text) return text;
  if (found === found.toUpperCase()) return text.toUpperCase();
  return (text[0] as string).toUpperCase() + text.slice(1);
}

/** Control characters other than tab and line ends cannot be in a Word file. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: that is what it removes
const cleaned = (text: string) => text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

/** Puts `text` where `hit` is: in its first stretch, with that stretch's marks. */
function applyHit(tr: Transaction, { parts }: Hit, text: string): number {
  const first = parts[0] as Hit["parts"][number];
  for (const part of parts.slice(1).reverse()) tr.delete(part.from, part.to);
  const marks = withoutReview(tr.doc.nodeAt(first.from)?.marks ?? []);
  const nodes = inlineText(tr.doc.type.schema, text, marks);
  tr.replace(first.from, first.to, new Slice(Fragment.fromArray(nodes), 0, 0));
  return first.from + nodes.reduce((size, node) => size + node.nodeSize, 0);
}

/** Why `hit` may not be replaced in `state` (its tree's), if so. */
function refusalOf(state: EditorState, scope: Scope, hit: Hit, text: string) {
  const tree = state.doc;
  const { parts, match } = hit;
  if (parts.some((part) => part.code)) return "field-code";
  if (parts.some((part) => tree.nodeAt(part.from)?.marks.some((m) => m.type.name === "deletion")))
    return "deleted";
  const first = parts[0] as Hit["parts"][number];
  if (parts.length > 1) {
    const field = fieldAround(tree, first.from);
    if (parts.some((part) => fieldAround(tree, part.from) !== field)) return "field";
    const control = controlAt(tree, first.from);
    if (parts.some((part) => controlAt(tree, part.from) !== control)) return "control";
  }
  if (!controlAt(tree, first.from)) return null;
  if (readOnlyAt(tree, scope.controls, match.from, match.to)) return "locked";
  // What else a control takes is the filter's to say.
  const tr = state.tr;
  applyHit(tr, hit, text);
  const made = trackTransaction(state, tr);
  return made && state.applyTransaction(made).transactions.length ? null : "control";
}

/** Replaces `hits` tree by tree in one undo step; `after`: a caret after the single one. */
function replaceHits(
  editor: Editor,
  hits: readonly Hit[],
  text: string,
  matchCase: boolean,
  caretAfter: boolean,
): ReplaceReport {
  const body = bodyState(editor.state);
  const scope = scopeOf(body);
  const report: ReplaceReport = { replaced: 0, refused: [] };
  const value = cleaned(text);
  const textOf = (hit: Hit) => (matchCase ? value : withCaseOf(hit.match.text, value));
  const byTree = new Map<string | null, Hit[]>();
  for (const hit of hits) {
    const { story } = hit.match;
    const state = story === null ? body : editor.story(story)?.state;
    const reason = state ? refusalOf(state, scope, hit, textOf(hit)) : "stale";
    if (reason) report.refused.push({ match: hit.match, reason });
    else byTree.set(story, [...(byTree.get(story) ?? []), hit]);
  }
  const edits = new Map<string | null, (tr: Transaction) => void>();
  for (const [story, list] of byTree)
    edits.set(story, (tr) => {
      let caret = 0;
      for (const hit of [...list].reverse()) caret = applyHit(tr, hit, textOf(hit));
      if (caretAfter) tr.setSelection(TextSelection.create(tr.doc, caret));
    });
  const failed = edits.size ? editTrees(editor, edits, { tracked: true }) : new Set();
  for (const [story, list] of byTree) {
    if (failed.has(story))
      report.refused.push(...list.map((hit) => ({ match: hit.match, reason: "refused" as const })));
    else report.replaced += list.length;
  }
  return report;
}

/**
 * Replaces one match found by `findAll`: tracked when tracking is on, in the formatting of the
 * match's first character, its capitals followed unless `matchCase`. Anything between its pieces
 * that draws nothing (a bookmark, a comment's anchor) stays. A line feed in `text` makes a line
 * break, a tab a tab. The caret goes after it. One undo step.
 */
export function replace(
  editor: Editor,
  match: FindMatch,
  text: string,
  { matchCase = false }: Pick<FindOptions, "matchCase"> = {},
): ReplaceReport {
  const body = bodyState(editor.state);
  const needle = needleFor(match.text, { matchCase: true }) as Needle | null;
  const tree = match.story === null ? body.doc : wordContext(body)?.stories.get(match.story)?.doc;
  const hits: Hit[] = [];
  if (needle && tree)
    hitsIn(linesOf(tree, scopeOf(body), match.story !== null), match.story, needle, hits);
  const hit = hits.find((h) => h.match.from === match.from && h.match.to === match.to);
  if (!hit) return { replaced: 0, refused: [{ match, reason: "stale" }] };
  return replaceHits(editor, [hit], text, matchCase, true);
}

/**
 * Replaces every match of `query`, in the body and every story, as one undo step. What may not be
 * replaced stays and is in `refused`, with why.
 */
export function replaceAll(
  editor: Editor,
  query: string,
  text: string,
  options: FindOptions = {},
): ReplaceReport {
  const hits = hitsOf(bodyState(editor.state), query, options);
  return replaceHits(editor, hits, text, options.matchCase === true, false);
}

/** The story `editor` edits; null for the body's. */
export function storyOfEditor(editor: Editor): string | null {
  const body = storyBody(editor.state)?.state;
  return body ? storyIdOf(body, editor.state.doc) : null;
}

/**
 * The match to go to from the selection of the story open (or the body): the next, or with
 * `backward` the previous, around the end of the document.
 */
export function nextMatch(
  editor: Editor,
  matches: readonly FindMatch[],
  backward = false,
): FindMatch | null {
  if (!matches.length) return null;
  const open = editor.storyView?.open?.id ?? storyOfEditor(editor);
  const body = bodyState(editor.state);
  const order = new Map(treesOf(body).map(({ id }, i) => [id, i]));
  const rank = (story: string | null) => order.get(story) ?? -1;
  const state = (open && editor.story(open)?.state) || body;
  const here = rank(open);
  const { from, to } = state.selection;
  const after = (m: FindMatch) => {
    const tree = rank(m.story);
    return tree > here || (tree === here && m.from >= to);
  };
  const before = (m: FindMatch) => {
    const tree = rank(m.story);
    return tree < here || (tree === here && m.to <= from);
  };
  if (backward)
    return [...matches].reverse().find(before) ?? (matches[matches.length - 1] as FindMatch);
  return matches.find(after) ?? (matches[0] as FindMatch);
}
