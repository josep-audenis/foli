import {
  createDocument,
  type DocumentSettings,
  type FoliDocument,
  parseContent,
  SCHEMA_VERSION,
} from "../document.js";
import type { Attrs, Node } from "../model/index.js";
import type { Alignment, DocJSON } from "../schema.js";
import {
  type FoliDocumentV3,
  parseContentV3,
  parseDocumentV3,
  SCHEMA_VERSION_V3,
  type SectionJSON,
} from "../v3/document.js";
import { twipsToMm as mm } from "../v3/units.js";
import {
  baseKeymap,
  type DeleteUnit,
  deleteBackward,
  deleteForward,
  deleteSelection,
  insertHardBreak,
  insertPageBreak,
  insertText,
  isMarkActive,
  joinBackward,
  joinForward,
  selectAll,
  setBlockType,
  splitBlock,
  toggleMark,
} from "./commands.js";
import { insertHorizontalRule, setAlign, setHighlight, setTextColor } from "./format.js";
import { history, redo, undo } from "./history.js";
import { removeLink, setLink } from "./links.js";
import { liftListItem, listKeymap, sinkListItem, toggleList, wrapInList } from "./lists.js";
import { TextSelection } from "./selection.js";
import { type Command, EditorState, type Plugin, type Transaction } from "./state.js";
import { type WordEnvelope, wordContext, wordPlugin } from "./word.js";

/**
 * A document an editor can hold: schema v2, or schema v3 (Word's model, 8.7).
 * shortcut: both until 8.7d makes v3 the only one.
 */
export type EditorDocument = FoliDocument | FoliDocumentV3;

export interface EditorOptions<D extends EditorDocument = FoliDocument> {
  /**
   * Trusted or not, it is validated (`parseContent`, `parseDocumentV3`) before use. Defaults to
   * an empty schema v2 document.
   */
  document?: D;
  /** Run before the built-in plugins, so their keymaps take precedence. */
  plugins?: readonly Plugin[];
}

export type EditorListener = (state: EditorState, transactions: readonly Transaction[]) => void;

/** A headless editor: state, commands, history and change notifications, no DOM. */
export interface Editor<D extends EditorDocument = FoliDocument> {
  readonly state: EditorState;
  /**
   * Page size and margins of the current document. For a schema v3 document, its last
   * section's (shortcut: one page setup for every section until the view lays out sections).
   */
  readonly settings: DocumentSettings;
  dispatch(tr: Transaction): void;
  /** Runs a command; returns whether it applied. */
  run(command: Command): boolean;
  /** Dry run: whether a command would apply now. */
  can(command: Command): boolean;
  /** Runs the first keymap command bound to `key` that applies, e.g. "Mod-b". */
  handleKey(key: string): boolean;
  /** Places a text selection (positions are clamped into the document). */
  select(anchor: number, head?: number): void;
  readonly commands: {
    insertText(text: string): boolean;
    deleteSelection(): boolean;
    deleteBackward(unit?: DeleteUnit): boolean;
    deleteForward(unit?: DeleteUnit): boolean;
    joinBackward(): boolean;
    joinForward(): boolean;
    splitBlock(): boolean;
    insertHardBreak(): boolean;
    insertPageBreak(): boolean;
    toggleMark(type: string, attrs?: Attrs | null): boolean;
    setBlockType(type: string, attrs?: Attrs | null): boolean;
    selectAll(): boolean;
    undo(): boolean;
    redo(): boolean;
    /** Wraps the selected blocks in a list ("bulletList" or "orderedList"). */
    wrapInList(type: string, attrs?: Attrs | null): boolean;
    /** The list buttons: removes the list, changes its type, or wraps in a new one. */
    toggleList(type: string, attrs?: Attrs | null): boolean;
    /** Tab in a list: nests the selected items in the item before them. */
    indentListItem(): boolean;
    /** Shift+Tab in a list: lifts the selected items one level (out of the list at the top). */
    outdentListItem(): boolean;
    /**
     * Links the selection to `href` (normalized, then validated: unsafe hrefs do not apply); at
     * a caret in a link, changes it; elsewhere inserts the href as linked text.
     */
    setLink(href: string): boolean;
    /** Removes the links in the selection, or the link around the caret. */
    removeLink(): boolean;
    /** Aligns the selected paragraphs and headings ("start", "center", "end", "justify"). */
    setAlign(align: Alignment): boolean;
    /** Text color (lowercase `#rrggbb`) of the selected or next typed text; null removes it. */
    setTextColor(color: string | null): boolean;
    /** Highlight (`#rrggbb`) of the selected or next typed text; null removes it. */
    setHighlight(color: string | null): boolean;
    /** Inserts a horizontal rule at the selection (the caret goes to the text after it). */
    insertHorizontalRule(): boolean;
  };
  isMarkActive(type: string): boolean;
  /** The current document, persisted as it was given (schema v2 or v3). */
  getDocument(): D;
  /** Replaces the whole document and resets history. */
  setDocument(document: D): void;
  subscribe(listener: EditorListener): () => void;
}

/** Word's page when a section leaves it out: Letter, 1 inch margins. */
const LETTER = { width: 12240, height: 15840, margin: 1440 };

/** A section's page setup as page settings (mm; the gutter added to the left margin, as Word does). */
export function sectionSettings(section: SectionJSON): DocumentSettings {
  const m = section.margins ?? {};
  return {
    pageSize: {
      width: mm(section.pageSize?.width ?? LETTER.width),
      height: mm(section.pageSize?.height ?? LETTER.height),
    },
    margins: {
      top: mm(Math.abs(m.top ?? LETTER.margin)),
      right: mm(m.right ?? LETTER.margin),
      bottom: mm(Math.abs(m.bottom ?? LETTER.margin)),
      left: mm((m.left ?? LETTER.margin) + (m.gutter ?? 0)),
    },
  };
}

interface Loaded {
  doc: Node;
  settings: DocumentSettings;
  envelope: WordEnvelope | null;
}

/** Validates a document and reads what the editor keeps of it. */
function load(document: EditorDocument): Loaded {
  if (document.schemaVersion !== SCHEMA_VERSION_V3)
    return { doc: parseContent(document.content), settings: document.settings, envelope: null };
  const { content, ...envelope } = parseDocumentV3(document);
  return { doc: parseContentV3(content), settings: sectionSettings(envelope.section), envelope };
}

export function createEditor(options?: EditorOptions<FoliDocument>): Editor;
export function createEditor(options: EditorOptions<FoliDocumentV3>): Editor<FoliDocumentV3>;
export function createEditor({
  document = createDocument(),
  plugins = [],
}: EditorOptions<EditorDocument> = {}): Editor<EditorDocument> {
  let loaded = load(document);
  const pluginsFor = ({ envelope }: Loaded) => [
    ...plugins,
    history(),
    ...(envelope ? [wordPlugin(envelope)] : []),
    listKeymap(),
    baseKeymap(),
  ];
  let state = EditorState.create({ doc: loaded.doc, plugins: pluginsFor(loaded) });
  const listeners = new Set<EditorListener>();

  const notify = (transactions: readonly Transaction[]) => {
    for (const listener of listeners) listener(state, transactions);
  };
  const dispatch = (tr: Transaction) => {
    const result = state.applyTransaction(tr);
    state = result.state;
    if (result.transactions.length) notify(result.transactions);
  };
  const run = (command: Command) => command(state, dispatch);

  return {
    get settings() {
      return loaded.settings;
    },
    get state() {
      return state;
    },
    dispatch,
    run,
    can: (command) => command(state),
    handleKey(key) {
      return state.plugins.some((plugin) => {
        const command = plugin.spec.keymap?.[key];
        return command ? command(state, dispatch) : false;
      });
    },
    select(anchor, head = anchor) {
      const size = state.doc.content.size;
      const clamp = (pos: number) => Math.max(0, Math.min(pos, size));
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, clamp(anchor), clamp(head))));
    },
    commands: {
      insertText: (text) => run(insertText(text)),
      deleteSelection: () => run(deleteSelection),
      deleteBackward: (unit) => run(deleteBackward(unit)),
      deleteForward: (unit) => run(deleteForward(unit)),
      joinBackward: () => run(joinBackward),
      joinForward: () => run(joinForward),
      splitBlock: () => run(splitBlock),
      insertHardBreak: () => run(insertHardBreak),
      insertPageBreak: () => run(insertPageBreak),
      toggleMark: (type, attrs) => run(toggleMark(type, attrs)),
      setBlockType: (type, attrs) => run(setBlockType(type, attrs)),
      selectAll: () => run(selectAll),
      undo: () => run(undo),
      redo: () => run(redo),
      wrapInList: (type, attrs) => run(wrapInList(type, attrs)),
      toggleList: (type, attrs) => run(toggleList(type, attrs)),
      indentListItem: () => run(sinkListItem()),
      outdentListItem: () => run(liftListItem()),
      setLink: (href) => run(setLink(href)),
      removeLink: () => run(removeLink),
      setAlign: (align) => run(setAlign(align)),
      setTextColor: (color) => run(setTextColor(color)),
      setHighlight: (color) => run(setHighlight(color)),
      insertHorizontalRule: () => run(insertHorizontalRule),
    },
    isMarkActive: (type) => isMarkActive(state, type),
    getDocument: () =>
      loaded.envelope
        ? {
            ...structuredClone(wordContext(state)?.envelope ?? loaded.envelope),
            content: state.doc.toJSON(),
          }
        : {
            schemaVersion: SCHEMA_VERSION,
            settings: loaded.settings,
            content: state.doc.toJSON() as DocJSON,
          },
    setDocument(next) {
      loaded = load(next);
      state = EditorState.create({ doc: loaded.doc, plugins: pluginsFor(loaded) });
      notify([]);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
