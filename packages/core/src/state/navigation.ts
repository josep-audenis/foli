/**
 * Going places in a document (11.11): bookmarks with Word's rules for their names, and the outline.
 * Bookmarks are not tracked (Word does not track them) and their ids are unique over the body and
 * every story.
 */
import { Fragment, type Mark, type Node, type NodeType, Slice } from "../model/index.js";
import { formatNumber } from "../v3/resolve.js";
import type { DocumentTarget, Editor } from "./editor.js";
import { fieldsIn } from "./fields.js";
import {
  bookmarkContent,
  bookmarksIn,
  entryTitle,
  type FieldLayout,
  headingLevel,
  nextBookmarkId,
  paragraphsOf,
} from "./fieldupdate.js";
import { storyOfEditor } from "./find.js";
import { TextSelection } from "./selection.js";
import type { EditorState, Transaction } from "./state.js";
import { editTrees } from "./stories.js";
import { storyBody, wordContext } from "./word.js";

/** A letter, then letters, digits and `_`; at most 40 (what Word takes). */
const NAME = /^\p{L}[\p{L}\p{N}_]{0,39}$/u;

/** Whether Word takes `name` for a bookmark made by hand. */
export const isBookmarkName = (name: string): boolean => NAME.test(name);

export interface BookmarkInfo {
  name: string;
  /** The story it is in; null: the body. */
  story: string | null;
  /** After its start marker, before its end marker. */
  from: number;
  to: number;
  /** The text it holds. */
  text: string;
  /** Word's own (`_Toc…`, `_Ref…`, `_GoBack`): not listed unless asked for. */
  hidden: boolean;
}

export type BookmarkResult =
  | { ok: true; bookmark: BookmarkInfo }
  | {
      ok: false;
      /**
       * `invalid-name`: not a name Word takes. `no-place`: the selection is not in text.
       * `missing`: no bookmark has that name. `exists`: another one does. `refused`: the content
       * there cannot change (a locked control).
       */
      reason: "invalid-name" | "no-place" | "missing" | "exists" | "refused";
    };

const bodyOf = (state: EditorState) => storyBody(state)?.state ?? state;

function treesOf(state: EditorState): { id: string | null; tree: Node }[] {
  const body = bodyOf(state);
  return [
    { id: null, tree: body.doc },
    ...[...(wordContext(body)?.stories ?? [])].map(([id, story]) => ({ id, tree: story.doc })),
  ];
}

/** The document's bookmarks, the body's first; Word's hidden ones only with `hidden`. */
export function listBookmarks(
  target: Editor | EditorState,
  { hidden = false }: { hidden?: boolean } = {},
): BookmarkInfo[] {
  return treesOf("getDocument" in target ? target.state : target).flatMap(({ id, tree }) =>
    [...bookmarksIn(tree).values()].flatMap((mark) => {
      const secret = mark.name.startsWith("_");
      if (secret && !hidden) return [];
      const text = bookmarkContent(tree, mark)
        .map((node) => node.text ?? " ")
        .join("");
      return [{ ...mark, story: id, text, hidden: secret }];
    }),
  );
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The positions of `name`'s markers in `tree`, either end. */
function markersOf(tree: Node, name: string): number[] {
  const ids = new Set<unknown>();
  const out: number[] = [];
  tree.descendants((node, pos) => {
    if (node.type.name === "bookmarkStart" && same(String(node.attrs.name), name)) {
      ids.add(node.attrs.id);
      out.push(pos);
    } else if (node.type.name === "bookmarkEnd" && ids.has(node.attrs.id)) out.push(pos);
    return !node.isInline;
  });
  return out;
}

const find = (editor: Editor, name: string) =>
  listBookmarks(editor, { hidden: true }).find((b) => same(b.name, name));

const result = (editor: Editor, name: string, failed: Set<unknown>): BookmarkResult => {
  const bookmark = failed.size ? undefined : find(editor, name);
  return bookmark ? { ok: true, bookmark } : { ok: false, reason: "refused" };
};

/**
 * A bookmark over the selection or `range` of `editor`'s tree (a caret: a point). As in Word, a
 * name already used, in any case and any story, moves that bookmark here.
 */
export function insertBookmark(
  editor: Editor,
  name: string,
  range?: { from: number; to: number },
): BookmarkResult {
  if (!isBookmarkName(name)) return { ok: false, reason: "invalid-name" };
  const { state } = editor;
  const { from, to } = range ?? state.selection;
  const size = state.doc.content.size;
  if (from < 0 || to > size || from > to) return { ok: false, reason: "no-place" };
  if (![from, to].every((pos) => state.doc.resolve(pos).parent.inlineContent))
    return { ok: false, reason: "no-place" };
  const here = storyOfEditor(editor);
  const edits = new Map<string | null, (tr: Transaction) => void>();
  for (const { id, tree } of treesOf(state)) {
    const old = markersOf(tree, name);
    if (id !== here && !old.length) continue;
    edits.set(id, (tr) => {
      const { bookmarkStart, bookmarkEnd } = tr.doc.type.schema.nodes as Record<string, NodeType>;
      const mark = id === here ? nextBookmarkId(state, tr) : 0;
      // From the end back, so positions hold; at one place the old goes first, the start ends first.
      const steps: { pos: number; rank: number; run: () => void }[] = old.map((pos) => ({
        pos,
        rank: 0,
        run: () => tr.delete(pos, pos + 1),
      }));
      if (id === here)
        steps.push(
          {
            pos: to,
            rank: 1,
            run: () => tr.insert(to, (bookmarkEnd as NodeType).create({ id: mark })),
          },
          {
            pos: from,
            rank: 2,
            run: () => tr.insert(from, (bookmarkStart as NodeType).create({ id: mark, name })),
          },
        );
      steps.sort((a, b) => b.pos - a.pos || a.rank - b.rank);
      for (const step of steps) step.run();
    });
  }
  return result(editor, name, editTrees(editor, edits, { tracked: false }));
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Word's field names: a code starting with one is that field, never a bookmark standing for `REF`. */
const FIELD_NAMES = new Set(
  (
    "ADDRESSBLOCK ADVANCE ASK AUTHOR AUTONUM AUTONUMLGL AUTONUMOUT AUTOTEXT AUTOTEXTLIST BARCODE " +
    "BIBLIOGRAPHY BIDIOUTLINE CITATION COMMENTS COMPARE CREATEDATE DATABASE DATE DISPLAYBARCODE " +
    "DOCPROPERTY DOCVARIABLE EDITTIME EQ FILENAME FILESIZE FILLIN FORMCHECKBOX FORMDROPDOWN " +
    "FORMTEXT GOTOBUTTON GREETINGLINE HYPERLINK IF INCLUDEPICTURE INCLUDETEXT INDEX INFO KEYWORDS " +
    "LASTSAVEDBY LINK LISTNUM MACROBUTTON MERGEBARCODE MERGEFIELD MERGEREC MERGESEQ NEXT NEXTIF " +
    "NOTEREF NUMCHARS NUMPAGES NUMWORDS PAGE PAGEREF PRINT PRINTDATE PRIVATE QUOTE RD REF REVNUM " +
    "SAVEDATE SECTION SECTIONPAGES SEQ SET SKIPIF STYLEREF SUBJECT SYMBOL TA TC TEMPLATE TIME " +
    "TITLE TOA TOC USERADDRESS USERINITIALS USERNAME XE"
  ).split(" "),
);

/** Renames a bookmark, and what refers to it: `REF`, `PAGEREF`, `NOTEREF` and links. */
export function renameBookmark(editor: Editor, name: string, next: string): BookmarkResult {
  if (!isBookmarkName(next)) return { ok: false, reason: "invalid-name" };
  const current = find(editor, name);
  if (!current) return { ok: false, reason: "missing" };
  const taken = find(editor, next);
  if (taken && !same(taken.name, name)) return { ok: false, reason: "exists" };
  const old = escaped(current.name);
  // shortcut: a reference whose name is split over two `w:instrText` runs is not followed.
  // A bare name stands for `REF` only when it is no field's name: `{ TITLE }` is the title.
  const bare = FIELD_NAMES.has(current.name.toUpperCase()) ? "" : "?";
  const reference = new RegExp(`^(\\s*(?:(?:REF|PAGEREF|NOTEREF)\\s+)${bare})${old}(?=\\s|$)`, "i");
  const edits = new Map<string | null, (tr: Transaction) => void>();
  for (const { id, tree } of treesOf(editor.state))
    edits.set(id, (tr) => {
      const swap = (pos: number, node: Node, attrs: Record<string, unknown>) =>
        tr.replace(
          pos,
          pos + 1,
          new Slice(
            Fragment.from(node.type.create({ ...node.attrs, ...attrs }, null, node.marks)),
            0,
            0,
          ),
        );
      const codes = new Set(fieldsIn(tree).map((field) => field.from));
      let inField = false;
      tree.descendants((node, pos) => {
        if (!node.isInline) return true;
        const type = node.type.name;
        if (type === "fieldStart") inField = codes.has(pos);
        if (type === "bookmarkStart" && same(String(node.attrs.name), name))
          swap(pos, node, { name: next });
        if (type === "fieldCode" && inField) {
          const text = String(node.attrs.text ?? "");
          const changed = text.replace(reference, `$1${next}`);
          if (changed !== text) swap(pos, node, { text: changed });
          inField = false;
        }
        const link = node.marks.find(
          (m: Mark) => m.type.name === "link" && m.attrs.anchor === current.name,
        );
        if (link) {
          const end = pos + node.nodeSize;
          tr.removeMark(pos, end, link);
          tr.addMark(pos, end, link.type.create({ ...link.attrs, anchor: next }));
        }
        return false;
      });
    });
  return result(editor, next, editTrees(editor, edits, { tracked: false }));
}

/** Deletes a bookmark, in whichever tree it is. What refers to it keeps its last result. */
export function deleteBookmark(editor: Editor, name: string): boolean {
  const edits = new Map<string | null, (tr: Transaction) => void>();
  for (const { id, tree } of treesOf(editor.state)) {
    const markers = markersOf(tree, name);
    if (markers.length)
      edits.set(id, (tr) => {
        for (const pos of markers.reverse()) tr.delete(pos, pos + 1);
      });
  }
  return edits.size > 0 && !editTrees(editor, edits, { tracked: false }).size;
}

/**
 * Selects `target` and shows it: through the view when there is one (which opens a story for it),
 * else in the editor of its tree. Whether it could.
 */
export function goTo(
  editor: Editor,
  target: DocumentTarget,
  options: { focus?: boolean } = {},
): boolean {
  const view = editor.storyView;
  if (view) return view.reveal(target, options);
  const host = target.story === null ? null : editor.story(target.story);
  if (target.story !== null && !host) return false;
  const state = (host ?? editor).state;
  const tr = state.tr.setSelection(TextSelection.create(state.doc, target.from, target.to));
  (host ?? storyBody(editor.state) ?? editor).dispatch(tr);
  return true;
}

export interface OutlineEntry {
  /** Before the paragraph. */
  pos: number;
  /** 1 to 9. */
  level: number;
  text: string;
  /** Its list number, if any. */
  number: string;
  /** Its page as the document numbers it; null without a layout. */
  page: string | null;
}

/**
 * The body's headings, by the rule of a table of contents with `\o` and `\u`: a heading style's
 * level, else the paragraph's outline level. Empty ones and a table of contents' own lines are
 * left out. `layout` (`editor.storyView.fieldLayout`) gives their pages.
 */
export function documentOutline(
  state: EditorState,
  layout: FieldLayout | null = null,
): OutlineEntry[] {
  const body = bodyOf(state);
  const word = wordContext(body);
  if (!word) return [];
  const tree = body.doc;
  const paragraphs = paragraphsOf(tree);
  const markers = word.resolver.markers(paragraphs.map((p) => p.node.attrs));
  const contents = fieldsIn(tree).filter((field) => field.name === "TOC");
  return paragraphs.flatMap((paragraph, i) => {
    const { node, pos } = paragraph;
    const outline = word.resolver.paragraph(node.attrs).paragraph.outlineLevel;
    const level =
      headingLevel(word, node) ?? (outline !== null && outline < 9 ? outline + 1 : null);
    if (level === null || contents.some((f) => pos + 1 >= f.from && pos < f.to)) return [];
    const text = entryTitle(tree, word, paragraph);
    if (!text.trim()) return [];
    const at = layout?.pageAt(pos + 1);
    return [
      {
        pos,
        level,
        text,
        number: markers[i]?.text ?? "",
        page: at ? formatNumber(at.number, at.format) : null,
      },
    ];
  });
}
