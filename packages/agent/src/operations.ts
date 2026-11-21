import {
  deleteTable,
  type Editor,
  findAll,
  type Node,
  paragraphStyles,
  type ReplaceRefusal,
  replace,
  setParagraphStyle,
} from "@folijs/core";
import { wordContext } from "@folijs/core/internal";
import type { Handles } from "./handles.js";
import { type Block, formatBlocks, readBlocks } from "./read.js";
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

/** @internal What the operations work on. */
export interface Context {
  editor: Editor;
  handles: Handles;
}

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
    .replaceAll("\r\n", "\n")
    .replaceAll("↵", "\n")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what goes
    .replace(/[\u0000-\u0008\u000B-\u001F]/g, "");

const quote = (text: string) => JSON.stringify(text.length > 80 ? `${text.slice(0, 77)}…` : text);

/** @internal Why `handle` names no block now, or the block. */
export function resolve(context: Context, handle: string): Refusal | { pos: number; node: Node } {
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
  const styles = paragraphStyles(context.editor.state);
  const wanted = name.trim().toLowerCase();
  const style =
    styles.find((s) => s.name.toLowerCase() === wanted) ??
    styles.find((s) => s.id.toLowerCase() === wanted);
  if (style) return style.id;
  return refuse(
    "unknown-style",
    `There is no paragraph style ${quote(name)}. The styles are: ${styles.map((s) => s.name).join(", ")}.`,
  );
}

/** @internal */
export function replaceText(
  context: Context,
  handle: string,
  find: string,
  replacement: string,
  options: ReplaceOptions = {},
): Result<Changed & { replaced: number }> {
  const { editor } = context;
  const target = resolve(context, handle);
  if ("ok" in target) return target;
  if (target.node.type.name !== "paragraph")
    return refuse(
      "not-a-paragraph",
      `Block ${handle} is not a paragraph: text is replaced in paragraphs (a table's are its cells' blocks).`,
    );
  const query = typed(find);
  if (!query) return refuse("invalid", "find must be the text to replace, as read shows it.");
  const from = target.pos;
  const to = target.pos + target.node.nodeSize;
  const matches = findAll(editor, query, { matchCase: true }).filter(
    (m) => m.story === null && m.from >= from && m.to <= to,
  );
  if (!matches.length) {
    const now = changed(context, [handle]).blocks[0]?.text ?? "";
    return refuse(
      "no-match",
      `${quote(query)} is not in block ${handle}. Capitals and spaces count. Its text is: ${JSON.stringify(now)}`,
    );
  }
  if (matches.length > 1 && !options.all)
    return refuse(
      "several-matches",
      `${quote(query)} is in block ${handle} ${matches.length} times. Give a longer find that is there once, or all: true to replace every one.`,
    );
  let replaced = 0;
  let why: ReplaceRefusal | undefined;
  // Last first: a replacement moves what comes after it.
  for (const match of matches.reverse()) {
    const report = replace(editor, match, typed(replacement), { matchCase: true });
    replaced += report.replaced;
    why ??= report.refused[0]?.reason;
  }
  if (!replaced)
    return refuse(
      why === "locked" || why === "control" ? "read-only" : "refused",
      `${quote(query)} in block ${handle} was not replaced: ${why ? WHY[why] : "the document refused the change"}.`,
    );
  return { ok: true, replaced, ...changed(context, [handle]) };
}

/** A new paragraph's content: its text, line breaks and tabs. */
function inline(editor: Editor, text: string): Node[] {
  const { schema } = editor.state;
  const nodes: Node[] = [];
  for (const part of typed(text).split(/(\n|\t)/)) {
    if (part === "\n") nodes.push(schema.node("hardBreak"));
    else if (part === "\t") nodes.push(schema.node("tab"));
    else if (part) nodes.push(schema.text(part));
  }
  return nodes;
}

/** @internal Inserts paragraphs before or after the block `handle`. */
export function insert(
  context: Context,
  handle: string,
  paragraphs: readonly NewParagraph[],
  side: "before" | "after",
): Result<Changed> {
  const { editor, handles } = context;
  const target = resolve(context, handle);
  if ("ok" in target) return target;
  if (!paragraphs.length) return refuse("invalid", "Give at least one paragraph to insert.");
  // Like Enter in Word: a new paragraph next to one is formatted as it is, in the same controls.
  const like: Record<string, unknown> | null =
    target.node.type.name === "paragraph" ? { ...target.node.attrs, ...MARK_ONLY } : null;
  const known = new Set(wordContext(editor.state)?.envelope.styles.map((s) => s.id));
  const { schema } = editor.state;
  const nodes: Node[] = [];
  /** Styles Word has built in that the document has not yet: put on once the paragraph is there. */
  const later: { index: number; id: string }[] = [];
  for (const [index, paragraph] of paragraphs.entries()) {
    const { text, style } = typeof paragraph === "string" ? { text: paragraph } : paragraph;
    if (typeof text !== "string") return refuse("invalid", "A paragraph to insert needs its text.");
    let attrs: Record<string, unknown> | null = like;
    if (style !== undefined) {
      const id = styleId(context, style);
      if (typeof id !== "string") return id;
      if (known.has(id)) attrs = { controls: like?.controls ?? null, style: id };
      else later.push({ index, id });
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
    const node = editor.state.doc.nodeAt(pos);
    if (!node) break;
    made.push(handles.at(pos, node));
    const style = later.find((l) => l.index === index);
    if (style) {
      editor.select(pos + 1);
      editor.run(setParagraphStyle(style.id));
    }
    pos += (editor.state.doc.nodeAt(pos) ?? node).nodeSize;
  }
  return { ok: true, ...changed(context, made) };
}

/** @internal */
export function deleteBlock(context: Context, handle: string): Result<{ text: string }> {
  const { editor } = context;
  const target = resolve(context, handle);
  if ("ok" in target) return target;
  const { node, pos } = target;
  const name = node.type.name;
  const before = editor.state.doc;
  if (name === "table") {
    let inside = -1;
    node.descendants((child, offset) => {
      if (inside < 0 && child.isTextblock) inside = pos + 1 + offset + 1;
      return inside < 0;
    });
    editor.select(inside);
    editor.run(deleteTable);
  } else if (name === "paragraph") {
    // Word's rules: a cell and the body end with a paragraph, and two tables never touch. Where
    // the paragraph holds one of them up, only its content goes.
    const $pos = editor.state.doc.resolve(pos);
    const index = $pos.index();
    const parent = $pos.parent;
    const next = index + 1 < parent.childCount ? parent.child(index + 1) : null;
    const previous = index > 0 ? parent.child(index - 1) : null;
    const stays = !next || (previous?.type.name === "table" && next.type.name === "table");
    const tr = editor.state.tr;
    editor.dispatch(
      stays ? tr.delete(pos + 1, pos + node.nodeSize - 1) : tr.delete(pos, pos + node.nodeSize),
    );
  } else
    return refuse(
      "read-only",
      `Block ${handle} is content Foli does not edit: it cannot be deleted.`,
    );
  if (editor.state.doc === before)
    return refuse(
      "refused",
      name === "paragraph"
        ? `Block ${handle} was not deleted: it is already empty, and a paragraph must stay there (the last of the document or of a cell, or between two tables).`
        : `Block ${handle} was not deleted: the document refused the change.`,
    );
  const left = changed(context, [handle]);
  if (left.blocks.length)
    return {
      ok: true,
      text: `Block ${handle} was emptied but stays: a paragraph must be there (the last of the document or of a cell, or between two tables).\n${left.text}`,
    };
  return { ok: true, text: `Deleted block ${handle}.` };
}
