import {
  createEditor,
  type Editor,
  type EditorDocument,
  type Extension,
  type FoliDocument,
} from "@folijs/core";

export interface SessionOptions {
  /** Whose tracked changes and comments the session's edits are. */
  author: string;
  /** The app's custom node and mark types, as `createEditor` takes them. */
  extensions?: readonly Extension[];
}

/** One agent's work on one document: its edits are tracked changes by `author`. */
export interface Session {
  /**
   * The headless editor under the session, for what the session has no operation for. Its
   * commands take positions; edits made through it are tracked like the session's own, unless
   * tracking is turned off on it.
   */
  readonly editor: Editor;
  readonly author: string;
  /** The document as it is now, to save or to export (`exportDocx` of `@folijs/docx`). */
  document(): FoliDocument;
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
    ...(extensions ? { extensions } : {}),
  });
  return { editor, author, document: () => editor.getDocument() };
}
