import {
  createEditor,
  type DocumentTarget,
  type Editor,
  type EditorDocument,
  type Extension,
  type FieldsReport,
  type FoliDocument,
  type Node,
  Slice,
  type Step,
  tableStyles,
  trackState,
  untracked,
} from "@folijs/core";
import { withEnvelope, withTrackState, wordContext } from "@folijs/core/internal";
import { type FormatOptions, formatText, type TextFormat } from "./formatting.js";
import { Handles } from "./handles.js";
import {
  type Changed,
  type CommentOptions,
  type Context,
  changed,
  comment,
  deleteBlock,
  insert,
  type NewParagraph,
  type ReplaceOptions,
  replaceText,
  resolve,
  setStyle,
  styles,
} from "./operations.js";
import { formatParagraphs, type ParagraphFormat } from "./paragraphs.js";
import {
  type Block,
  formatBlocks,
  paragraphFormatting,
  readBlocks,
  runFormatting,
} from "./read.js";
import { type Result, refuse } from "./result.js";
import {
  type CellText,
  deleteRows,
  type InsertTableOptions,
  insertRows,
  insertTable,
  type ShadeOptions,
  setCells,
  setHeaderRows,
  setTableStyle,
  shadeCells,
} from "./tables.js";
import {
  type Control,
  controls,
  fillControl,
  type Unfilled,
  type UpdateFieldsOptions,
  updateFields,
} from "./templates.js";

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
  /** Also each paragraph's text formatting of its own (bold, font, size…): `Block.formatting`. */
  formatting?: boolean;
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
  /**
   * Where a block is, as positions of this session's editor (`session.editor`): what core's
   * `hint` and `goTo` take, to show an agent's change in a view of that editor.
   */
  target(handle: string): Result<{ target: DocumentTarget }>;
  /** The paragraph styles there are, by the names `read` shows and `setStyle` takes. */
  styles(): string[];
  /**
   * Puts a paragraph in a style, named by its name or id (capitals do not count). Its direct
   * formatting stays. Recorded as a tracked formatting change.
   */
  setStyle(handle: string, style: string): Result<Changed>;
  /**
   * Comments a paragraph in the session's author's name: the whole block, or `on` text in it
   * (there once). A line break in `text` starts a new paragraph of the comment. A comment is
   * not a tracked change: rejecting the session's changes leaves it. Returns the comment's id.
   */
  comment(
    handle: string,
    text: string,
    options?: CommentOptions,
  ): Result<Changed & { comment: number }>;
  /** The body's content controls: what a template leaves to be filled, with their values. */
  controls(): Control[];
  /**
   * Fills a content control: the one with this id, else every control with this tag, else with
   * this title. Text for a text control (line breaks only where the control takes them), an
   * item for a list, `yyyy-mm-dd` or any text for a date, true or false for a check box; null
   * or "" empties it. A tracked change. Returns the blocks changed, the controls as they are
   * now, and `unfilled`: those of the name that did not take the value, each with why.
   */
  fillControl(
    name: string,
    value: string | boolean | null,
  ): Result<Changed & { controls: Control[]; unfilled: Unfilled[] }>;
  /**
   * Updates the document's fields (dates, cross-references, tables of contents; page numbers
   * need a layout and are left), and fills its merge fields from `data`. A tracked change.
   */
  updateFields(options?: UpdateFieldsOptions): Result<FieldsReport & { text: string }>;
  /**
   * Inserts a table next to a block (after it by default), its cells' texts given row by row
   * (rows shorter than the longest get empty cells), in Word's Table Grid style unless `style`
   * names another; `header` makes its first row a header row. Returns the table's blocks.
   */
  insertTable(
    handle: string,
    cells: readonly (readonly string[])[],
    options?: InsertTableOptions,
  ): Result<Changed>;
  /**
   * Inserts rows after (or before) row `row` of a table, made like it, with these cells' texts.
   * A table is named by its handle or by a paragraph's in one of its cells; rows and columns
   * are numbered as `read` prints them (`r1 c1`). Returns the table's blocks.
   */
  insertRows(
    handle: string,
    row: number,
    cells: readonly (readonly string[])[],
    where?: "after" | "before",
  ): Result<Changed>;
  /** Deletes a table's rows (`rows`: how many); every row deletes the table. */
  deleteRows(handle: string, rows: readonly number[]): Result<Changed & { rows: number }>;
  /** Sets cells' whole text (a merged cell's is its top cell's). Returns the table's blocks. */
  setCells(handle: string, cells: readonly CellText[]): Result<Changed>;
  /** The table styles there are, by the names `setTableStyle` takes. */
  tableStyles(): string[];
  /** Gives a table a table style by name (capitals do not count), or none (null). */
  setTableStyle(handle: string, style: string | null): Result<Changed>;
  /** Shades a table's cells (`RRGGBB`; null takes it off): all, a row's, a column's or one. */
  shadeCells(handle: string, fill: string | null, options?: ShadeOptions): Result<Changed>;
  /** Makes the first `count` rows a table's header rows, repeated on each page; 0: none. */
  setHeaderRows(handle: string, count: number): Result<Changed>;
  /**
   * Formats a paragraph's text, or `on` text in it (once, or every place with `all`): bold,
   * italic, underline, strike, font, size, color, highlight, a link. What `format` leaves out
   * stays. A tracked formatting change; a link, the text deleted and inserted again with it.
   */
  formatText(handle: string, format: TextFormat, options?: FormatOptions): Result<Changed>;
  /**
   * Formats paragraphs (one handle, or several: those next to each other become one list):
   * alignment, line spacing, space before and after, indentation (a list level in a list),
   * list numbering. What `format` leaves out stays. Tracked formatting changes.
   */
  formatParagraphs(handles: string | readonly string[], format: ParagraphFormat): Result<Changed>;
  /**
   * Marks the document as it is now, to come back to: `rollback` takes back every edit made
   * since, the session's own and those made through `editor`, as if none had been (no tracked
   * change is left of them, and every handle names the block it named). `release` ends the
   * checkpoint and keeps the edits. One or the other, once: a second call throws. Undo is as it
   * was at the checkpoint: what was taken back cannot be undone or redone. `setDocument` on the editor
   * cannot be taken back: `rollback` then throws.
   */
  checkpoint(): Checkpoint;
}

export interface Checkpoint {
  rollback(): void;
  release(): void;
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
  // On whatever the document's setting (`settings.trackRevisions`) says, without changing it.
  const track = trackState(editor.state);
  if (track)
    editor.dispatch(
      withTrackState(editor.state.tr, Object.assign({ ...track, on: true }, { pinned: true })),
    );
  const handles = new Handles(editor);

  const context: Context = { editor, handles, author };

  const read = (options: ReadOptions = {}): Result<ReadResult> => {
    // A model's tool call may send null for an object left out.
    const { from, limit, formatting } = options ?? {};
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
    if (formatting === true)
      for (const block of blocks) {
        const node = block.kind === "paragraph" ? handles.resolve(block.handle)?.node : undefined;
        const own = node
          ? [paragraphFormatting(node), runFormatting(node)].filter(Boolean).join("; ")
          : "";
        if (own) block.formatting = own;
      }
    const next = all[start + blocks.length]?.handle ?? null;
    return { ok: true, text: formatBlocks(blocks), blocks, next };
  };

  const block = (handle: string): Result<{ block: Block; text: string }> => {
    const target = resolve(context, handle);
    if ("ok" in target) return target;
    const { blocks, text } = changed(context, [handle]);
    return { ok: true, block: blocks[0] as Block, text };
  };

  const checkpoint = (): Checkpoint => {
    const start = editor.state.doc;
    const ends = handles.snapshot();
    // What the document holds besides its body (styles, numbering…), and undo's own state: a
    // rollback puts both back as they are now. The history plugin is found by its key's name
    // (core does not export the key): its state, given back to it, is taken as it is.
    const envelope = wordContext(editor.state)?.envelope;
    const history = editor.state.plugins.find((plugin) => plugin.key.name === "history");
    const undo = history?.key.getState(editor.state);
    // What the edits change outside the body (a comment's text, a note, a header): each such
    // step, inverted. The body's own steps are not kept: it is put back whole, so a run of
    // any number of edits costs a rollback the same, and holds no document but the first.
    const aside: Step[] = [];
    let changed = false;
    let lost = false;
    let over = false;
    let last = start;
    const stop = editor.subscribe((state, transactions) => {
      // A document replaced tells without a transaction: there are no steps to take back.
      if (!transactions.length && state.doc !== last) lost = true;
      last = state.doc;
      if (transactions.length) changed = true;
      for (const tr of transactions)
        for (const [i, step] of tr.steps.entries()) {
          const from = tr.docs[i] as Node;
          if ((tr.docs[i + 1] ?? tr.doc) === from) aside.push(step.invert(from));
        }
    });
    const end = () => {
      if (over) throw new Error("checkpoint: already rolled back or released");
      over = true;
      stop();
    };
    return {
      release: end,
      rollback() {
        end();
        if (lost)
          throw new Error("checkpoint: the document was replaced, it cannot be rolled back");
        if (changed) {
          // The body as it was, in one step, and what changed beside it undone, last first: one
          // change that is not tracked.
          const tr = editor.state.tr;
          tr.replace(0, tr.doc.content.size, new Slice(start.content, 0, 0));
          for (const step of aside.reverse()) tr.step(step);
          // Marked as an undo, which it is: core's rules for content controls let an undo
          // put back what no edit may write (a list's placeholder, a check box's glyph).
          tr.setMeta(untracked, true).setMeta("historyOp", "undo");
          // Undo as it was: neither this change nor those it takes back are steps of it.
          if (history) tr.setMeta(history.key, undo);
          else tr.setMeta("addToHistory", false);
          // The inverted envelope steps put the envelope back; this only makes sure of it.
          if (envelope && wordContext(editor.state)?.envelope !== envelope)
            withEnvelope(tr, envelope);
          editor.dispatch(tr);
        }
        if (!editor.state.doc.eq(start))
          throw new Error("checkpoint: the rollback did not give the document back");
        handles.restore(ends);
      },
    };
  };

  /** An operation of several edits, all or none: a refusal takes back what it did before it. */
  const whole = <T>(operation: () => Result<T>): Result<T> => {
    const point = checkpoint();
    let result: Result<T>;
    try {
      result = operation();
    } catch (error) {
      point.release();
      throw error;
    }
    if (result.ok) point.release();
    else point.rollback();
    return result;
  };

  return {
    checkpoint,
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
    target: (handle) => {
      const found = resolve(context, handle);
      if ("ok" in found) return found;
      // Its content: a paragraph's text, a table's cells.
      const { pos, node } = found;
      return { ok: true, target: { story: null, from: pos + 1, to: pos + node.nodeSize - 1 } };
    },
    styles: () => styles(context),
    setStyle: (handle, style) => setStyle(context, handle, style),
    comment: (handle, text, options) => comment(context, handle, text, options),
    controls: () => controls(context),
    fillControl: (name, value) => fillControl(context, name, value),
    updateFields: (options) => updateFields(context, options),
    insertTable: (handle, cells, options) =>
      whole(() => insertTable(context, handle, cells, options)),
    insertRows: (handle, row, cells, where) =>
      whole(() => insertRows(context, handle, row, cells, where)),
    deleteRows: (handle, rows) => whole(() => deleteRows(context, handle, rows)),
    setCells: (handle, cells) => whole(() => setCells(context, handle, cells)),
    tableStyles: () => tableStyles(editor.state),
    setTableStyle: (handle, style) => setTableStyle(context, handle, style),
    shadeCells: (handle, fill, options) => shadeCells(context, handle, fill, options),
    setHeaderRows: (handle, count) => setHeaderRows(context, handle, count),
    formatParagraphs: (handles, format) => whole(() => formatParagraphs(context, handles, format)),
    formatText: (handle, format, options) =>
      whole(() => formatText(context, handle, format, options)),
  };
}
