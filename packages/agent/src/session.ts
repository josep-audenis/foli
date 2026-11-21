import {
  createEditor,
  type Editor,
  type EditorDocument,
  type Extension,
  type FoliDocument,
} from "@folijs/core";
import { Handles } from "./handles.js";
import {
  type Changed,
  type Context,
  changed,
  deleteBlock,
  insert,
  type NewParagraph,
  type ReplaceOptions,
  replaceText,
  resolve,
} from "./operations.js";
import { type Block, formatBlocks, readBlocks } from "./read.js";
import { type Result, refuse } from "./result.js";

export interface SessionOptions {
  /** Whose tracked changes and comments the session's edits are. */
  author: string;
  /** The app's custom node and mark types, as `createEditor` takes them. */
  extensions?: readonly Extension[];
}

export interface ReadOptions {
  /** Start at this block (a handle from an earlier read). Default: the first block. */
  from?: string;
  /** At most this many blocks. Default: all of them. */
  limit?: number;
}

export interface ReadResult {
  /** The blocks as lines, each starting with its handle in brackets (`formatBlocks`). */
  text: string;
  blocks: Block[];
  /** The handle to read `from` next when `limit` cut the read short; null at the end. */
  next: string | null;
}

/** One agent's work on one document: its edits are tracked changes by `author`. */
export interface Session {
  /**
   * The headless editor under the session, for what the session has no operation for. Its
   * commands take positions; edits made through it are tracked like the session's own, unless
   * tracking is turned off on it. `setDocument` on it forgets every handle.
   */
  readonly editor: Editor;
  readonly author: string;
  /** The document as it is now, to save or to export (`exportDocx` of `@folijs/docx`). */
  document(): FoliDocument;
  /**
   * The body as it would be with every tracked change accepted, a block per line. Headers,
   * footers and notes are not read. Refused when `from` names no block.
   */
  read(options?: ReadOptions): Result<ReadResult>;
  /** One block by its handle. */
  block(handle: string): Result<{ block: Block; text: string }>;
  /**
   * Replaces `find` in a paragraph by `replacement` ("" deletes it). `find` is text as `read`
   * shows it, capitals and spaces included, and must be in the block once, unless `all`. The
   * replacement takes the formatting of the text it replaces. Returns the block as it reads
   * now, how many places were replaced and how many could not be (a locked control, a field).
   */
  replaceText(
    handle: string,
    find: string,
    replacement: string,
    options?: ReplaceOptions,
  ): Result<Changed & { replaced: number; refused: number }>;
  /**
   * Inserts paragraphs after a block (a paragraph, a table, anything read): one, or a list.
   * Next to a paragraph they are formatted as Enter there gives in Word: as the paragraph,
   * numbering included, or in the style its style names as the next (after a heading: body
   * text); a paragraph that names a `style` has that style and nothing of the neighbour's.
   * Returns the new blocks with their handles.
   */
  insertAfter(handle: string, paragraphs: NewParagraph | readonly NewParagraph[]): Result<Changed>;
  /** As `insertAfter`, before the block: the block keeps its handle. */
  insertBefore(handle: string, paragraphs: NewParagraph | readonly NewParagraph[]): Result<Changed>;
  /**
   * Deletes a paragraph, or a table with all its cells. A paragraph that must stay (the last of
   * the document or of a cell, one before a table, one that ends a section) is emptied instead,
   * and `text` says why.
   */
  deleteBlock(handle: string): Result<{ text: string }>;
}

/**
 * Opens a document for an agent. The document is validated as `createEditor` does (an older
 * format is migrated); tracking is on from the start, whatever the document's own setting.
 * Throws on a document that does not validate, and on an empty `author`.
 */
export function openSession(document: EditorDocument, options: SessionOptions): Session {
  const { author, extensions } = options;
  if (!author.trim()) throw new TypeError("openSession: `author` must name who edits");
  const editor = createEditor({
    document,
    author,
    trackChanges: true,
    // Deleted text is neither read nor found: the agent works on the text as it would be.
    reviewView: "final",
    ...(extensions ? { extensions } : {}),
  });
  const handles = new Handles(editor);

  const context: Context = { editor, handles, author };

  const read = (options: ReadOptions = {}): Result<ReadResult> => {
    const { from, limit } = options;
    if (limit !== undefined && !(Number.isInteger(limit) && limit > 0))
      return refuse("invalid", "limit must be a whole number above 0.");
    const all = readBlocks(editor.state, handles);
    let start = 0;
    if (from !== undefined) {
      const target = resolve(context, from);
      if ("ok" in target) return target;
      start = all.findIndex((block) => block.handle === from);
    }
    const blocks = all.slice(start, limit === undefined ? undefined : start + limit);
    const next = all[start + blocks.length]?.handle ?? null;
    return { ok: true, text: formatBlocks(blocks), blocks, next };
  };

  const block = (handle: string): Result<{ block: Block; text: string }> => {
    const target = resolve(context, handle);
    if ("ok" in target) return target;
    const { blocks, text } = changed(context, [handle]);
    return { ok: true, block: blocks[0] as Block, text };
  };

  return {
    editor,
    author,
    document: () => editor.getDocument(),
    read,
    block,
    replaceText: (handle, find, replacement, options) =>
      replaceText(context, handle, find, replacement, options),
    insertAfter: (handle, paragraphs) => insert(context, handle, paragraphs, "after"),
    insertBefore: (handle, paragraphs) => insert(context, handle, paragraphs, "before"),
    deleteBlock: (handle) => deleteBlock(context, handle),
  };
}
