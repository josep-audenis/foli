import {
  addComment,
  controlIsReadOnly,
  controlProperties,
  controlsIn,
  deleteTable,
  type Editor,
  findAll,
  type Node,
  paragraphStyles,
  type ReplaceRefusal,
  replace,
  setParagraphStyle,
  untracked,
} from "@folijs/core";
import { wordContext } from "@folijs/core/internal";
import type { Handles } from "./handles.js";
import { type Block, formatBlocks, oneLine, readBlocks } from "./read.js";
import { type Refusal, type Result, refuse } from "./result.js";

/** A paragraph to insert: its text ("\n" or ↵ a line break, a tab a tab), in `style` if given. */
export type NewParagraph = string | { text: string; style?: string };

/** What an operation changed: the blocks as they are now, and as `read` would show them. */
export interface Changed {
  blocks: Block[];
  text: string;
}

export interface ReplaceOptions {
  /** Replace every place `find` is in the block. Default: refuse when there are several. */
  all?: boolean;
}

/** The most paragraphs one insert takes, and the most places one replace changes. */
const MAX_PARAGRAPHS = 500;
const MAX_PLACES = 500;
/**
 * @internal
 * The most text one operation writes, its places together: a replacement times its places, a
 * value times the controls that take it.
 */
export const MAX_WRITTEN = 300_000;

/** @internal What the operations work on. */
export interface Context {
  editor: Editor;
  handles: Handles;
  author: string;
  /** The header's or footer's story id when this is one's (23.7); the body's: none. */
  story?: string;
}

type Attrs = Record<string, unknown>;

/** A paragraph's attributes that are its mark's own: a new paragraph does not take them. */
const MARK_ONLY = { section: null, revision: null, formatChange: null, attributes: null };

const WHY: Record<ReplaceRefusal, string> = {
  locked: "it is in a locked content control",
  control: "the content control there does not take it",
  field: "it runs over the edge of a field's result",
  "field-code": "it is in a field's code",
  deleted: "it is in text already deleted",
  stale: "the text is no longer there",
  refused: "the change could not be recorded as a tracked change",
};

/** Text as a model writes it, as the document takes it: ↵ is a line break, no control characters. */
const typed = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .replaceAll("↵", "\n")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what goes
    .replace(/[\u0000-\u0008\u000B-\u001F]/g, "");

/** Invisible and look-alike characters: in a quote a model reads them as `\u2011`, not as `-`. */
const LOOKALIKE = /[\u00a0\u00ad\u2007\u2010-\u2015\u2018-\u201f\u200b-\u200f\u202f\u2060\ufeff]/g;

/** `text` cut to `most` characters, never between the halves of a surrogate pair. */
const cut = (text: string, most: number): string => {
  if (text.length <= most) return text;
  const low = text.charCodeAt(most);
  return text.slice(0, low >= 0xdc00 && low <= 0xdfff ? most - 1 : most);
};

/** @internal A text quoted for a message, cut, with look-alike characters shown. */
export const quote = (text: string, most = 80) =>
  JSON.stringify(text.length > most ? `${cut(text, most - 3)}…` : text).replace(
    LOOKALIKE,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );

/** @internal Why `handle` names no block now, or the block. */
export function resolve(context: Context, handle: string): Refusal | { pos: number; node: Node } {
  if (typeof handle !== "string")
    return refuse("invalid", "A block is named by its handle, a string as read gives it: b7.");
  const found = context.handles.resolve(handle);
  if (found) {
    if (readBlocks(context.editor.state, context.handles).some((b) => b.handle === handle))
      return found;
    return refuse("gone", `Block ${handle} was deleted as a tracked change: it is not read.`);
  }
  return context.handles.issued(handle)
    ? refuse(
        "gone",
        `Block ${handle} is no longer in the document. Read again for the blocks there are.`,
      )
    : refuse("unknown-handle", `There is no block ${handle}. Handles come from read: [b1], [b2]…`);
}

/** @internal The blocks with these handles as they read now, in document order. */
export function changed(context: Context, handles: readonly string[]): Changed {
  const wanted = new Set(handles);
  const blocks = readBlocks(context.editor.state, context.handles).filter((b) =>
    wanted.has(b.handle),
  );
  return { blocks, text: formatBlocks(blocks) };
}

/** @internal The id of the paragraph style a model named (by its name or id), or the refusal. */
export function styleId(context: Context, name: string): string | Refusal {
  // By the names a read shows them under: on one line.
  const styles = paragraphStyles(context.editor.state).map((s) => ({
    id: s.id,
    name: oneLine(s.name),
  }));
  if (typeof name !== "string") return refuse("invalid", "A style is named by its name, a string.");
  const wanted = oneLine(name).trim().toLowerCase();
  const style =
    styles.find((s) => s.name.toLowerCase() === wanted) ??
    styles.find((s) => s.id.toLowerCase() === wanted);
  if (style) return style.id;
  return refuse(
    "unknown-style",
    `There is no paragraph style ${quote(name)}. The styles are: ${styles.map((s) => s.name).join(", ")}.`,
  );
}

/** The content controls `node` at `pos` is in or holds that may not be edited, by name. */
/** @internal The locked content controls a block is in or holds, by name. */
export function lockedControls(context: Context, pos: number, node: Node): string[] {
  const { state } = context.editor;
  const ids = new Set<string>((node.attrs.controls as string[] | null) ?? []);
  const end = pos + node.nodeSize;
  for (const range of controlsIn(state.doc))
    if (range.from < end && pos < range.to) ids.add(range.id);
  const names: string[] = [];
  for (const id of ids) {
    const control = controlProperties(state, id);
    if (control && controlIsReadOnly(control)) names.push(control.alias ?? control.tag ?? id);
  }
  return names;
}

/** @internal */
export function replaceText(
  context: Context,
  handle: string,
  find: string,
  replacement: string,
  options: ReplaceOptions = {},
): Result<Changed & { replaced: number; refused: number }> {
  const { editor } = context;
  const target = resolve(context, handle);
  if ("ok" in target) return target;
  if (target.node.type.name !== "paragraph")
    return refuse(
      "not-a-paragraph",
      `Block ${handle} is not a paragraph: text is replaced in paragraphs (a table's are its cells' blocks).`,
    );
  if (typeof find !== "string" || typeof replacement !== "string")
    return refuse("invalid", 'find and replacement must be strings (replacement "" deletes).');
  const query = typed(find);
  const text = typed(replacement);
  if (!query) return refuse("invalid", "find must be the text to replace, as read shows it.");
  const from = target.pos;
  const to = target.pos + target.node.nodeSize;
  const matches = findAll(editor, query, { matchCase: true }).filter(
    (m) => m.story === (context.story ?? null) && m.from >= from && m.to <= to,
  );
  if (!matches.length) {
    const now = changed(context, [handle]).blocks[0]?.text ?? "";
    const brackets = /\[[^\]]+\]/.test(query)
      ? " What read shows in brackets ([picture], [empty: …]) is not text: leave it out of find."
      : "";
    return refuse(
      "no-match",
      `${quote(query)} is not in block ${handle}. Capitals and spaces count.${brackets} Its text is: ${quote(now, 2000)}`,
    );
  }
  if (matches.length > 1 && !options?.all)
    return refuse(
      "several-matches",
      `${quote(query)} is in block ${handle} ${matches.length} times. Give a longer find that is there once, or all: true to replace every one.`,
    );
  // Each place is a change of its own.
  if (matches.length > MAX_PLACES)
    return refuse(
      "several-matches",
      `${quote(query)} is in block ${handle} ${matches.length} times: at most ${MAX_PLACES} places are replaced at once. Give a longer find.`,
    );
  if (matches.length * text.length > MAX_WRITTEN)
    return refuse(
      "invalid",
      `That writes ${matches.length * text.length} characters: one replace writes ${MAX_WRITTEN} at most, its places together. Replace in parts.`,
    );
  // Nothing to record: the text is what it would become.
  if (query === text) return { ok: true, replaced: 0, refused: 0, ...changed(context, [handle]) };
  let replaced = 0;
  let refused = 0;
  let why: ReplaceRefusal | undefined;
  // Last first: a replacement moves what comes after it.
  for (const match of matches.reverse()) {
    const report = replace(editor, match, text, { matchCase: true });
    replaced += report.replaced;
    refused += report.refused.length;
    why ??= report.refused[0]?.reason;
  }
  const reason = why ? WHY[why] : "the document refused the change";
  if (!replaced)
    return refuse(
      why === "locked" || why === "control" ? "read-only" : "refused",
      `${quote(query)} in block ${handle} was not replaced: ${reason}.`,
    );
  const result = changed(context, [handle]);
  if (refused) result.text += `\n${refused} of ${matches.length} not replaced: ${reason}.`;
  return { ok: true, replaced, refused, ...result };
}

/** @internal Text as a model writes it, as inline nodes: ↵ a line break, a tab a tab. */
export function inline(editor: Editor, text: string): Node[] {
  const { schema } = editor.state;
  const nodes: Node[] = [];
  for (const part of typed(text).split(/(\n|\t)/)) {
    if (part === "\n") nodes.push(schema.node("hardBreak"));
    else if (part === "\t") nodes.push(schema.node("tab"));
    else if (part) nodes.push(schema.text(part));
  }
  return nodes;
}

/**
 * The attributes of a paragraph put next to `node`, as Enter gives in Word (core's
 * `splitAttrs`): the paragraph's own properties and controls, without its mark's own. After a
 * paragraph whose style names another as the next (a heading: Normal), that style, without the
 * direct formatting.
 */
function attrsLike(context: Context, node: Node, side: "before" | "after"): Attrs | null {
  if (node.type.name !== "paragraph") return null;
  const attrs = node.attrs as Attrs;
  if (side === "after") {
    const styles = wordContext(context.editor.state)?.envelope.styles ?? [];
    const paragraph = styles.filter((s) => s.type === "paragraph");
    const id =
      (attrs.style as string | null) ?? paragraph.filter((s) => s.isDefault).at(-1)?.id ?? null;
    const next = paragraph.find((s) => s.id === id)?.next;
    // One the document does not have as a paragraph style is no next style: Word stays in this one.
    if (next !== undefined && next !== id && paragraph.some((s) => s.id === next))
      return { controls: attrs.controls ?? null, style: next };
  }
  return { ...attrs, ...MARK_ONLY };
}

/** @internal Inserts paragraphs before or after the block `handle`. */
export function insert(
  context: Context,
  handle: string,
  paragraphs: NewParagraph | readonly NewParagraph[],
  side: "before" | "after",
): Result<Changed> {
  const { editor, handles } = context;
  const target = resolve(context, handle);
  if ("ok" in target) return target;
  // One paragraph given bare is one paragraph.
  const list: readonly unknown[] = Array.isArray(paragraphs) ? paragraphs : [paragraphs];
  if (!list.length) return refuse("invalid", "Give at least one paragraph to insert.");
  // Each is a step of the editor, and a document of many thousands is slow to edit at all.
  if (list.length > MAX_PARAGRAPHS)
    return refuse(
      "invalid",
      `At most ${MAX_PARAGRAPHS} paragraphs are inserted at once: ${list.length} were given. Insert them in parts.`,
    );
  const like = attrsLike(context, target.node, side);
  // A new paragraph next to one in a control is in that control: not when it is locked.
  for (const id of (like?.controls as string[] | null | undefined) ?? []) {
    const control = controlProperties(editor.state, id);
    if (control && controlIsReadOnly(control))
      return refuse(
        "read-only",
        `Block ${handle} is in the locked content control ${quote(control.alias ?? control.tag ?? id)}: nothing is inserted there.`,
      );
  }
  const known = new Set(wordContext(editor.state)?.envelope.styles.map((s) => s.id));
  const { schema } = editor.state;
  const nodes: Node[] = [];
  /** Styles Word has built in that the document has not yet: put on once the paragraph is there. */
  const later: { index: number; id: string }[] = [];
  for (const [index, paragraph] of list.entries()) {
    const given = typeof paragraph === "string" ? { text: paragraph } : paragraph;
    const { text, style } = (given ?? {}) as { text?: unknown; style?: unknown };
    if (typeof text !== "string")
      return refuse(
        "invalid",
        'A paragraph to insert is its text, or { "text": …, "style": … } with the text a string.',
      );
    let attrs = like;
    if (style !== undefined) {
      const id = styleId(context, style as string);
      if (typeof id !== "string") return id;
      // In a style of its own: none of the neighbour's numbering or indents.
      attrs = { controls: like?.controls ?? null, ...(known.has(id) ? { style: id } : {}) };
      if (!known.has(id)) later.push({ index, id });
    }
    nodes.push(schema.node("paragraph", attrs, inline(editor, text)));
  }
  const at = side === "after" ? target.pos + target.node.nodeSize : target.pos;
  const before = editor.state.doc;
  editor.dispatch(editor.state.tr.insert(at, nodes));
  if (editor.state.doc === before)
    return refuse("refused", `Nothing could be inserted ${side} block ${handle}.`);
  const made: string[] = [];
  let pos = at;
  for (const [index] of nodes.entries()) {
    const style = later.find((l) => l.index === index);
    if (style) {
      // shortcut: a second change and undo step; only for a built-in style the document lacks.
      editor.select(pos + 1);
      editor.run(setParagraphStyle(style.id));
    }
    const node = editor.state.doc.nodeAt(pos);
    if (!node) break;
    made.push(handles.at(pos, node));
    pos += node.nodeSize;
  }
  return { ok: true, ...changed(context, made) };
}

/** Why a paragraph must stay where it is, or null when it may go whole. */
function mustStay(node: Node, previous: Node | null, next: Node | null): string | null {
  if (node.attrs.section) return "it ends a section, and its section break stays with it";
  if (!next) return "a paragraph must end the document, and a table's cell";
  if (next.type.name !== "paragraph")
    return previous?.type.name === "table" && next.type.name === "table"
      ? "a paragraph must stand between two tables"
      : "the block after it is not a paragraph it can join";
  return null;
}

/** Whether a paragraph has anything left to delete: content not deleted already. */
/** Whether all of the paragraph's content is `author`'s own tracked insertion. */
function ownText(node: Node, author: string): boolean {
  let own = true;
  node.forEach((child) => {
    own &&= child.marks.some((m) => m.type.name === "insertion" && m.attrs.author === author);
  });
  return own;
}

const hasContent = (node: Node) => {
  let live = false;
  node.forEach((child) => {
    live ||= !child.marks.some((m) => m.type.name === "deletion");
  });
  return live;
};

/** @internal */
export function deleteBlock(context: Context, handle: string): Result<{ text: string }> {
  const { editor, author } = context;
  const target = resolve(context, handle);
  if ("ok" in target) return target;
  const { node, pos } = target;
  const name = node.type.name;
  if (name !== "table" && name !== "paragraph")
    return refuse(
      "read-only",
      `Block ${handle} is content Foli does not edit: it cannot be deleted.`,
    );
  const locked = lockedControls(context, pos, node);
  if (locked.length)
    return refuse(
      "read-only",
      `Block ${handle} is in or holds the locked content control ${quote(locked[0] as string)}: it cannot be deleted.`,
    );
  const before = editor.state.doc;
  if (name === "table") {
    // The caret in a paragraph of the table's own first cell (a cell ends with one), not in a
    // table nested there: `deleteTable` takes the innermost table around the caret.
    const cell = node.child(0).child(0);
    const last = cell.child(cell.childCount - 1);
    editor.select(pos + 2 + cell.content.size - last.nodeSize + 2);
    editor.run(deleteTable);
    if (editor.state.doc === before || changed(context, [handle]).blocks.length)
      return refuse("refused", `Table ${handle} was not deleted: the document refused the change.`);
    return { ok: true, text: `Deleted table ${handle} with its cells.` };
  }
  // Word's rules: a cell and the body end with a paragraph, two tables never touch, and a
  // paragraph mark that cannot join a paragraph after it stays when its deletion is accepted.
  // Where the paragraph must stay, only its content goes.
  const $pos = editor.state.doc.resolve(pos);
  const index = $pos.index();
  const parent = $pos.parent;
  const next = index + 1 < parent.childCount ? parent.child(index + 1) : null;
  const previous = index > 0 ? parent.child(index - 1) : null;
  const stays = mustStay(node, previous, next);
  const own = (node.attrs.revision as { insertion?: { author?: string } } | null)?.insertion;
  if (
    stays &&
    !node.attrs.section &&
    own?.author === author &&
    ownText(node, author) &&
    previous?.type.name === "paragraph"
  ) {
    // The session's own paragraph, never accepted: it goes for real, as its text would.
    editor.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize).setMeta(untracked, true));
    if (editor.state.doc !== before) return { ok: true, text: `Deleted block ${handle}.` };
  }
  if (stays && !hasContent(node))
    return refuse(
      "refused",
      `Block ${handle} was not deleted: it is already empty, and it stays because ${stays}.`,
    );
  const tr = editor.state.tr;
  editor.dispatch(
    stays ? tr.delete(pos + 1, pos + node.nodeSize - 1) : tr.delete(pos, pos + node.nodeSize),
  );
  if (editor.state.doc === before)
    return refuse("refused", `Block ${handle} was not deleted: the document refused the change.`);
  const left = changed(context, [handle]);
  if (left.blocks.length)
    return {
      ok: true,
      text: `Block ${handle} was emptied but stays: ${stays ?? "its paragraph mark could not be deleted"}.\n${left.text}`,
    };
  return { ok: true, text: `Deleted block ${handle}.` };
}

/** @internal The paragraph `handle` names, or why an operation on a paragraph cannot go on. */
/** @internal The paragraph `handle` names, or why it is not one. */
export function paragraphAt(
  context: Context,
  handle: string,
  what: string,
): Refusal | { pos: number; node: Node } {
  const target = resolve(context, handle);
  if ("ok" in target || target.node.type.name === "paragraph") return target;
  return refuse(
    "not-a-paragraph",
    `Block ${handle} is not a paragraph: ${what} (a table's are its cells' blocks).`,
  );
}

/**
 * @internal
 * Where text `on` is in a paragraph (`on` is text as read shows it; without it, the whole
 * paragraph): once, or with `all` every place; refused when it is not there, or is there more
 * than once without `all`.
 */
export function placesIn(
  context: Context,
  handle: string,
  target: { pos: number; node: Node },
  on: unknown,
  all: boolean,
): Refusal | { from: number; to: number }[] {
  const from = target.pos + 1;
  const to = target.pos + target.node.nodeSize - 1;
  if (on === undefined) return [{ from, to }];
  const query = typeof on === "string" ? typed(on) : "";
  if (!query) return refuse("invalid", "on must be text of the block, as read shows it.");
  const matches = findAll(context.editor, query, { matchCase: true }).filter(
    (m) => m.story === (context.story ?? null) && m.from >= from && m.to <= to,
  );
  if (matches.length === 1 || (all && matches.length))
    return matches.map((m) => ({ from: m.from, to: m.to }));
  const now = changed(context, [handle]).blocks[0]?.text ?? "";
  return matches.length
    ? refuse(
        "several-matches",
        `${quote(query)} is in block ${handle} ${matches.length} times. Give a longer text that is there once${all ? "" : ", or pass all"}.`,
      )
    : refuse(
        "no-match",
        `${quote(query)} is not in block ${handle}. Capitals and spaces count. Its text is: ${quote(now, 2000)}`,
      );
}

/** @internal The paragraph styles there are to name, as `read` names them. */
export function styles(context: Context): string[] {
  return paragraphStyles(context.editor.state).map((style) => oneLine(style.name));
}

/** @internal */
export function setStyle(context: Context, handle: string, style: string): Result<Changed> {
  const { editor } = context;
  const target = paragraphAt(context, handle, "a style is set on paragraphs");
  if ("ok" in target) return target;
  const id = styleId(context, style);
  if (typeof id !== "string") return id;
  const resolver = wordContext(editor.state)?.resolver;
  const now = resolver?.paragraph(target.node.attrs as Record<string, unknown>).paragraph.style;
  if (now !== id) {
    const before = editor.state.doc;
    editor.select(target.pos + 1);
    editor.run(setParagraphStyle(id));
    // The command says yes before the document's rules have their say (a locked control).
    if (editor.state.doc === before) {
      const locked = lockedControls(context, target.pos, target.node)[0];
      return locked
        ? refuse(
            "read-only",
            `Block ${handle} is in the locked content control ${quote(locked)}: its style cannot be changed.`,
          )
        : refuse("refused", `The style of block ${handle} could not be changed.`);
    }
  }
  return { ok: true, ...changed(context, [handle]) };
}

export interface CommentOptions {
  /** Text in the block to anchor the comment to, as `read` shows it. Default: the whole block. */
  on?: string;
}

/** @internal */
export function comment(
  context: Context,
  handle: string,
  text: string,
  options: CommentOptions = {},
): Result<Changed & { comment: number }> {
  const { editor } = context;
  const target = paragraphAt(context, handle, "a comment is anchored in a paragraph");
  if ("ok" in target) return target;
  const content = typeof text === "string" ? typed(text).trim() : "";
  if (!content) return refuse("invalid", "A comment needs its text, a string.");
  const places = placesIn(context, handle, target, options?.on, false);
  if (!Array.isArray(places)) return places;
  const { from, to } = places[0] as { from: number; to: number };
  const ids = () => new Set(wordContext(editor.state)?.envelope.comments.map((c) => c.id));
  const before = ids();
  editor.select(from, to);
  // Word shows a comment's initials beside it: the author's, as Word makes them.
  const initials = context.author
    .split(/\s+/)
    // Each word's first letter or digit, as a person's initials are: "Claude (trial)" is "Ct".
    .map((word) => /[\p{L}\p{N}]/u.exec(word)?.[0] ?? "")
    // Nine UTF-16 units at most, as core keeps, and never half a character.
    .reduce((all, initial) => (all.length + initial.length <= 9 ? all + initial : all), "");
  if (!editor.run(addComment(content, { initials })))
    return refuse("refused", `Block ${handle} could not be commented.`);
  const made = [...ids()].find((id) => !before.has(id));
  if (made === undefined) return refuse("refused", `Block ${handle} could not be commented.`);
  return { ok: true, comment: made, ...changed(context, [handle]) };
}
