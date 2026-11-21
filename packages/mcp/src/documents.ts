/**
 * The documents a server has open (ADR-0009): each a `.docx` read from under the root and an
 * `@folijs/agent` session over it, kept in memory under an id until it is closed.
 */
import { basename, dirname, extname, join } from "node:path";
import { openSession, type Session } from "@folijs/agent";
import { type DocxPackage, exportDocx, importDocx } from "@folijs/docx";
import { type FileRules, read, shown, standing, target, write } from "./files.js";
import type { ToolResult } from "./protocol.js";

/**
 * @internal
 * What a `.docx` may unpack to and hold, below `@folijs/docx`'s own limits: with the number of
 * documents open, what bounds the server's memory and the time one `open` takes.
 */
export const READ_LIMITS = { maxSize: 256 * 1024 * 1024, maxNodes: 1_000_000 };

/** @internal At most this many documents open at once. */
export const MAX_DOCUMENTS = 16;

/** @internal */
export interface OpenDocument {
  id: string;
  /** The file it was read from, as its real path. */
  file: string;
  session: Session;
  package: DocxPackage;
  /** It has edits no save has written. */
  dirty: boolean;
}

const refusal = (text: string): ToolResult => ({ text, isError: true });

/** @internal */
export class Documents {
  readonly #rules: FileRules;
  readonly #author: () => string;
  readonly #open = new Map<string, OpenDocument>();
  /** The files this server wrote: a save may write over them again. */
  readonly #written = new Set<string>();
  #issued = 0;

  constructor(rules: FileRules, author: () => string) {
    this.#rules = rules;
    this.#author = author;
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
    let session: Session;
    let pkg: DocxPackage;
    try {
      const imported = await importDocx(checked.bytes, READ_LIMITS);
      pkg = imported.package;
      session = openSession(imported.document, { author: this.#author() });
    } catch (error) {
      // Not a .docx Word wrote, damaged, or over the reader's limits: said, not thrown.
      const why = error instanceof Error ? error.message : "it could not be read";
      return refusal(`${name} could not be opened as a .docx: ${why}`);
    }
    const document: OpenDocument = {
      id: `d${++this.#issued}`,
      file: checked.file,
      session,
      package: pkg,
      dirty: false,
    };
    this.#open.set(document.id, document);
    return document;
  }

  /**
   * Writes a document: to `path`, or beside the file it came from as `<name>.agent.docx`
   * (`<name>.agent-2.docx`… when that is someone else's).
   */
  async save(document: OpenDocument, path: unknown): Promise<ToolResult> {
    let file: string;
    if (path === undefined || path === null) {
      const base = basename(document.file, extname(document.file)).replace(/\.agent(-\d+)?$/i, "");
      const beside = (n: number) =>
        join(dirname(document.file), `${base}.agent${n > 1 ? `-${n}` : ""}.docx`);
      let n = 1;
      // The first name that is free, or the server's own from an earlier save.
      while (n < 100 && standing(beside(n)) !== "nothing" && !this.#mine(beside(n))) n++;
      file = beside(n);
    } else {
      const checked = target(this.#rules, path);
      if (!checked.ok) return refusal(checked.message);
      file = checked.file;
    }
    let bytes: Uint8Array;
    try {
      bytes = await exportDocx(document.session.document(), document.package);
    } catch (error) {
      const why = error instanceof Error ? error.message : "it could not be written";
      return refusal(`${document.id} could not be saved: ${why}`);
    }
    const written = write(file, bytes, this.#rules.overwrite || this.#mine(file));
    if (!written.ok) return refusal(written.message);
    this.#written.add(file);
    document.dirty = false;
    return { text: `Saved ${document.id} as ${shown(this.#rules, file)}.` };
  }

  /** Whether the server wrote `file` in this run: it may write over it again. */
  #mine(file: string): boolean {
    return this.#written.has(file);
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
