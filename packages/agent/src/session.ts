import {
  createEditor,
  type Editor,
  type EditorDocument,
  type Extension,
  type FoliDocument,
} from "@folijs/core";
import { Handles } from "./handles.js";
import { type Block, formatBlocks, readBlocks } from "./read.js";
import { type Refusal, type Result, refuse } from "./result.js";

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

export interface Read {
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
  read(options?: ReadOptions): Result<Read>;
  /** One block by its handle. */
  block(handle: string): Result<{ block: Block; text: string }>;
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

  /** Why `handle` names no block now, or null when it does. */
  const missing = (handle: string): Refusal | null => {
    if (handles.resolve(handle)) return null;
    return handles.issued(handle)
      ? refuse(
          "gone",
          `Block ${handle} is no longer in the document. Read again for the blocks there are.`,
        )
      : refuse(
          "unknown-handle",
          `There is no block ${handle}. Handles come from read: [b1], [b2]…`,
        );
  };

  const read = (options: ReadOptions = {}): Result<Read> => {
    const { from, limit } = options;
    if (limit !== undefined && !(Number.isInteger(limit) && limit > 0))
      return refuse("invalid", "limit must be a whole number above 0.");
    const all = readBlocks(editor.state, handles);
    let start = 0;
    if (from !== undefined) {
      const refusal = missing(from);
      if (refusal) return refusal;
      start = all.findIndex((block) => block.handle === from);
      if (start < 0)
        return refuse("gone", `Block ${from} was deleted as a tracked change: it is not read.`);
    }
    const blocks = all.slice(start, limit === undefined ? undefined : start + limit);
    const next = all[start + blocks.length]?.handle ?? null;
    return { ok: true, text: formatBlocks(blocks), blocks, next };
  };

  const block = (handle: string): Result<{ block: Block; text: string }> => {
    const refusal = missing(handle);
    if (refusal) return refusal;
    const found = readBlocks(editor.state, handles).find((b) => b.handle === handle);
    if (!found) return refuse("gone", `Block ${handle} was deleted as a tracked change.`);
    return { ok: true, block: found, text: formatBlocks([found]) };
  };

  return { editor, author, document: () => editor.getDocument(), read, block };
}
