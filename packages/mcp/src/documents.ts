/**
 * The documents a server has open (ADR-0009): each a `.docx` read from under the root and an
 * `@folijs/agent` session over it, kept in memory under an id until it is closed.
 */
import { basename, dirname, extname, join } from "node:path";
import { openSession, type Session } from "@folijs/agent";
import { type DocxPackage, exportDocx, importDocx } from "@folijs/docx";
import { type FileRules, read, same, shown, stamp, standing, target, write } from "./files.js";
import type { ToolResult } from "./protocol.js";
import { MAX_GROWTH, weight } from "./weight.js";

/**
 * @internal
 * What one `.docx` may unpack to and hold, well below `@folijs/docx`'s own limits: a document
 * of a few hundred pages passes, a file made to be large does not.
 */
export const READ_LIMITS = { maxSize: 64 * 1024 * 1024, maxNodes: 400_000 };

/** @internal At most this many documents open at once. */
export const MAX_DOCUMENTS = 16;

/**
 * @internal
 * The most the open documents may hold together, in positions of their bodies (a character or
 * a block's edge each). With `READ_LIMITS`, what bounds the server's memory: a body of empty
 * paragraphs costs about 600 bytes a position.
 */
export const MAX_OPEN_SIZE = 3_000_000;

/** @internal */
export interface OpenDocument {
  id: string;
  /** The file it was read from, as its real path. */
  file: string;
  session: Session;
  package: DocxPackage;
  /** It has edits no save has written. */
  dirty: boolean;
  /** Its body's size when opened, in positions: its share of `MAX_OPEN_SIZE`. */
  size: number;
  /** The weight (`weight.ts`) it may not go past: what it weighed when opened, and `MAX_GROWTH`. */
  heaviest: number;
}

/** A reader's error on one line: its message may hold a name from the file. */
const oneLine = (text: string) => text.replace(/[\r\n\u0085\u2028\u2029]+/g, " ").slice(0, 300);

const refusal = (text: string): ToolResult => ({ text, isError: true });

/** @internal */
export class Documents {
  readonly #rules: FileRules;
  readonly #author: () => string;
  readonly #open = new Map<string, OpenDocument>();
  /**
   * The files this server wrote, each as it left it (`stamp`): a save may write over one again
   * while it is still that file.
   */
  readonly #written = new Map<string, string | null>();
  readonly #budget: number;
  #issued = 0;

  constructor(rules: FileRules, author: () => string, budget = MAX_OPEN_SIZE) {
    this.#rules = rules;
    this.#author = author;
    this.#budget = budget;
  }

  /**
   * The document a tool call is about: the one with this id, or the only one open when no id
   * is given. A refusal otherwise, saying which there are.
   */
  get(id: unknown): OpenDocument | ToolResult {
    const all = [...this.#open.values()];
    if (id === undefined || id === null) {
      if (all.length === 1) return all[0] as OpenDocument;
      return refusal(
        all.length
          ? `Several documents are open: say which with document (${all.map((d) => d.id).join(", ")}).`
          : "No document is open. Open one first: open, with the .docx file's path.",
      );
    }
    const found = typeof id === "string" ? this.#open.get(id) : undefined;
    if (found) return found;
    return refusal(
      all.length
        ? `There is no open document ${JSON.stringify(id)}. Open: ${all.map((d) => d.id).join(", ")}.`
        : `There is no open document ${JSON.stringify(id)}: none is open. Open one first.`,
    );
  }

  async open(path: unknown): Promise<OpenDocument | ToolResult> {
    if (this.#open.size >= MAX_DOCUMENTS)
      return refusal(`${MAX_DOCUMENTS} documents are open already: close one first.`);
    const checked = read(this.#rules, path);
    if (!checked.ok) return refusal(checked.message);
    const name = shown(this.#rules, checked.file);
    // One session a file: two would each save over the other's edits.
    const already = [...this.#open.values()].find((d) => same(d.file, checked.file));
    if (already) return refusal(`${name} is open already, as ${already.id}.`);
    let session: Session;
    let pkg: DocxPackage;
    try {
      const imported = await importDocx(checked.bytes, READ_LIMITS);
      pkg = imported.package;
      session = openSession(imported.document, { author: this.#author() });
    } catch (error) {
      // Not a .docx Word wrote, damaged, or over the reader's limits: said, not thrown.
      const why = error instanceof Error ? oneLine(error.message) : "it could not be read";
      return refusal(`${name} could not be opened as a .docx: ${why}`);
    }
    const size = session.editor.state.doc.content.size;
    const held = [...this.#open.values()].reduce((sum, d) => sum + d.size, 0);
    if (held + size > this.#budget)
      return refusal(
        held
          ? `${name} is too large to open beside the documents open now: close one first.`
          : `${name} is too large to open.`,
      );
    const document: OpenDocument = {
      id: `d${++this.#issued}`,
      file: checked.file,
      session,
      package: pkg,
      dirty: false,
      size,
      heaviest: weight(session) + MAX_GROWTH,
    };
    // What `state.doc` does not show: a header's or footer's field updated, its control filled.
    session.editor.subscribe((_state, transactions) => {
      if (transactions.some((tr) => tr.docChanged)) document.dirty = true;
    });
    this.#open.set(document.id, document);
    return document;
  }

  /**
   * Writes a document: to `path`, or beside the file it came from as `<name>.agent.docx`
   * (`<name>.agent-2.docx`… when that is someone else's).
   */
  async save(document: OpenDocument, path: unknown): Promise<ToolResult> {
    let wanted = path;
    if (wanted === undefined || wanted === null) {
      const base = basename(document.file, extname(document.file)).replace(/\.agent(-\d+)?$/i, "");
      const beside = (n: number) =>
        join(dirname(document.file), `${base}.agent${n > 1 ? `-${n}` : ""}.docx`);
      let n = 1;
      // The first name that is free, or the server's own from an earlier save.
      while (n < 100 && standing(beside(n)) !== "nothing" && !this.#mine(beside(n))) n++;
      // All taken: the last is not the server's to write over for having run out of names.
      if (standing(beside(n)) !== "nothing" && !this.#mine(beside(n)))
        return refusal(
          `The names beside ${shown(this.#rules, document.file)} are taken, up to .agent-${n}.docx: save with a path.`,
        );
      // Checked as a path given: the folder may not be what it was when the file was opened.
      wanted = shown(this.#rules, beside(n));
    }
    const checked = target(this.#rules, wanted);
    if (!checked.ok) return refusal(checked.message);
    const file = checked.file;
    // Another open document's own file: writing it would lose that document's saved edits.
    const other = [...this.#open.values()].find((d) => d !== document && same(d.file, file));
    if (other)
      return refusal(
        `${shown(this.#rules, file)} is open as ${other.id}: saving ${document.id} there would write over it. Save with another path, or close ${other.id} first.`,
      );
    let bytes: Uint8Array;
    try {
      bytes = await exportDocx(document.session.document(), document.package);
    } catch (error) {
      const why = error instanceof Error ? oneLine(error.message) : "it could not be written";
      return refusal(`${document.id} could not be saved: ${why}`);
    }
    const written = write(file, bytes, this.#rules.overwrite || this.#mine(file));
    if (!written.ok) return refusal(written.message);
    this.#written.set(file, stamp(file));
    document.dirty = false;
    return { text: `Saved ${document.id} as ${shown(this.#rules, file)}.` };
  }

  /** Whether `file` is as the server wrote it in this run: it may write over it again. */
  #mine(file: string): boolean {
    // By `same`: in other capitals (Windows, macOS) it is still the file the server wrote.
    for (const [written, left] of this.#written)
      if (left !== null && same(written, file) && left === stamp(file)) return true;
    return false;
  }

  close(document: OpenDocument, discard: boolean): ToolResult {
    if (document.dirty && !discard)
      return refusal(
        `${document.id} has changes that are not saved. Save it first, or close it with discard: true to lose them.`,
      );
    this.#open.delete(document.id);
    return { text: `Closed ${document.id}.` };
  }

  list(): ToolResult {
    const all = [...this.#open.values()];
    if (!all.length) return { text: "No document is open." };
    return {
      text: all
        .map(
          (d) => `${d.id}: ${shown(this.#rules, d.file)}${d.dirty ? " (changes not saved)" : ""}`,
        )
        .join("\n"),
    };
  }

  /** `file` as a model is told it. */
  name(document: OpenDocument): string {
    return shown(this.#rules, document.file);
  }
}
