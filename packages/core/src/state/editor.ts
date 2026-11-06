import {
  createDocument,
  type DocumentSettings,
  type FoliDocument,
  parseContent,
  SCHEMA_VERSION,
} from "../document.js";
import type { Attrs } from "../model/index.js";
import type { DocJSON } from "../schema.js";
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
import { history, redo, undo } from "./history.js";
import { TextSelection } from "./selection.js";
import { type Command, EditorState, type Plugin, type Transaction } from "./state.js";

export interface EditorOptions {
  /** Trusted or not, it is validated (`parseContent`) before use. Defaults to an empty document. */
  document?: FoliDocument;
  /** Run before the built-in plugins, so their keymaps take precedence. */
  plugins?: readonly Plugin[];
}

export type EditorListener = (state: EditorState, transactions: readonly Transaction[]) => void;

/** A headless editor: state, commands, history and change notifications, no DOM. */
export interface Editor {
  readonly state: EditorState;
  /** Page size and margins of the current document. */
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
  };
  isMarkActive(type: string): boolean;
  /** The current document as a persisted FoliDocument. */
  getDocument(): FoliDocument;
  /** Replaces the whole document and resets history. */
  setDocument(document: FoliDocument): void;
  subscribe(listener: EditorListener): () => void;
}

export function createEditor({
  document = createDocument(),
  plugins = [],
}: EditorOptions = {}): Editor {
  let settings = document.settings;
  const allPlugins = [...plugins, history(), baseKeymap()];
  let state = EditorState.create({ doc: parseContent(document.content), plugins: allPlugins });
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
      return settings;
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
    },
    isMarkActive: (type) => isMarkActive(state, type),
    getDocument: () => ({
      schemaVersion: SCHEMA_VERSION,
      settings,
      content: state.doc.toJSON() as DocJSON,
    }),
    setDocument(next) {
      const doc = parseContent(next.content);
      settings = next.settings;
      state = EditorState.create({ doc, plugins: allPlugins });
      notify([]);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
