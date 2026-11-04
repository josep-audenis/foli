import {
  Fragment,
  type Mark,
  type Node,
  type NodeType,
  type Schema,
  Slice,
} from "../model/index.js";
import type { Step } from "../transform/steps.js";
import { Transform } from "../transform/transform.js";
import { AllSelection, Selection, TextSelection } from "./selection.js";

/**
 * A command: checks whether it applies to `state` and, given `dispatch`, performs it.
 * Calling without `dispatch` is a dry run (e.g. to enable or disable a toolbar button).
 */
export type Command = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;

export class PluginKey<T> {
  constructor(readonly name: string) {}

  getState(state: EditorState): T | undefined {
    return state.pluginState(this);
  }
}

export interface PluginSpec<T> {
  key?: PluginKey<T>;
  /** A state field kept alongside the document. */
  state?: {
    init(state: EditorState): T;
    apply(tr: Transaction, value: T, oldState: EditorState, newState: EditorState): T;
  };
  /** Return false to drop a transaction. */
  filterTransaction?(tr: Transaction, state: EditorState): boolean;
  /** Runs after transactions are applied; may return a follow-up transaction. */
  appendTransaction?(
    transactions: readonly Transaction[],
    oldState: EditorState,
    newState: EditorState,
  ): Transaction | null | undefined;
  /** Key name (e.g. "Mod-b", "Shift-Enter") → command. The view normalizes key events to these names. */
  keymap?: Readonly<Record<string, Command>>;
}

/** Internal extension point; built-in features (history, keymap) use the same API. */
export class Plugin<T = unknown> {
  readonly key: PluginKey<T>;

  constructor(readonly spec: PluginSpec<T>) {
    this.key = spec.key ?? new PluginKey<T>("plugin");
  }
}

/**
 * A transform created from a state: tracks the selection (mapped through every step), stored
 * marks and metadata. Metadata `addToHistory: false` keeps a change out of undo history.
 */
export class Transaction extends Transform {
  /** Creation time in ms; history groups changes by it. Writable for tests. */
  time = Date.now();
  storedMarks: readonly Mark[] | null;
  private currentSelection: Selection;
  private selectionStep = 0;
  private storedMarksSet = false;
  private readonly meta = new Map<unknown, unknown>();

  constructor(state: EditorState) {
    super(state.doc);
    this.currentSelection = state.selection;
    this.storedMarks = state.storedMarks;
  }

  get selection(): Selection {
    if (this.selectionStep < this.steps.length) {
      this.currentSelection = this.currentSelection.map(
        this.doc,
        this.mapping.slice(this.selectionStep),
      );
      this.selectionStep = this.steps.length;
    }
    return this.currentSelection;
  }

  setSelection(selection: Selection): this {
    if (selection.$anchor.doc !== this.doc)
      throw new RangeError("Selection is not in this document");
    this.currentSelection = selection;
    this.selectionStep = this.steps.length;
    return this;
  }

  setStoredMarks(marks: readonly Mark[] | null): this {
    this.storedMarks = marks;
    this.storedMarksSet = true;
    return this;
  }

  protected override addStep(step: Step, doc: Node): void {
    super.addStep(step, doc);
    if (!this.storedMarksSet) this.storedMarks = null;
  }

  setMeta(key: unknown, value: unknown): this {
    this.meta.set(key, value);
    return this;
  }

  getMeta(key: unknown): unknown {
    return this.meta.get(key);
  }

  get addToHistory(): boolean {
    return this.meta.get("addToHistory") !== false;
  }

  /** Deletes the selection; deleting everything leaves one empty default textblock. */
  deleteSelection(): this {
    const selection = this.selection;
    if (selection.empty) return this;
    if (selection instanceof AllSelection) {
      const type = defaultTextblockType(this.doc.type.schema);
      this.replace(0, this.doc.content.size, new Slice(Fragment.from(type.create()), 0, 0));
      return this.setSelection(Selection.atStart(this.doc));
    }
    this.delete(selection.from, selection.to);
    return this.setSelection(TextSelection.create(this.doc, this.mapping.map(selection.from, -1)));
  }

  /** Replaces the selection with a slice and puts the caret after it. */
  replaceSelection(slice: Slice): this {
    this.deleteSelection();
    const from = this.selection.from;
    this.replace(from, from, slice);
    return this.setSelection(Selection.near(this.doc.resolve(this.mapping.map(from, 1)), -1));
  }
}

/** The first textblock type of the schema (the "normal paragraph"). */
export function defaultTextblockType(schema: Schema): NodeType {
  const type = Object.values(schema.nodes).find((t) => t.isTextblock);
  if (!type) throw new RangeError("Schema has no textblock type");
  return type;
}

export interface EditorStateConfig {
  doc: Node;
  selection?: Selection;
  storedMarks?: readonly Mark[] | null;
  plugins?: readonly Plugin[];
}

/** An immutable editor state: document, selection, stored marks and plugin state fields. */
export class EditorState {
  private constructor(
    readonly doc: Node,
    readonly selection: Selection,
    /** Marks to apply to the next typed text (set by toggling a mark at a caret). */
    readonly storedMarks: readonly Mark[] | null,
    readonly plugins: readonly Plugin[],
    private readonly fields: Map<Plugin, unknown>,
  ) {}

  static create(config: EditorStateConfig): EditorState {
    const state = new EditorState(
      config.doc,
      config.selection ?? Selection.atStart(config.doc),
      config.storedMarks ?? null,
      config.plugins ?? [],
      new Map(),
    );
    for (const plugin of state.plugins) {
      if (plugin.spec.state) state.fields.set(plugin, plugin.spec.state.init(state));
    }
    return state;
  }

  get schema(): Schema {
    return this.doc.type.schema;
  }

  get tr(): Transaction {
    return new Transaction(this);
  }

  pluginState<T>(key: PluginKey<T>): T | undefined {
    const plugin = this.plugins.find((p) => p.key === key);
    return plugin ? (this.fields.get(plugin) as T) : undefined;
  }

  apply(tr: Transaction): EditorState {
    return this.applyTransaction(tr).state;
  }

  /** Applies `root` plus any transactions plugins append; returns all that were applied. */
  applyTransaction(root: Transaction): { state: EditorState; transactions: Transaction[] } {
    if (!this.passesFilters(root)) return { state: this, transactions: [] };
    const transactions = [root];
    let state = this.applyInner(root);
    const seen: { state: EditorState; count: number }[] = [];
    for (;;) {
      let appended = false;
      this.plugins.forEach((plugin, i) => {
        const append = plugin.spec.appendTransaction;
        if (!append) return;
        const prev = seen[i] ?? { state: this, count: 0 };
        const tr =
          prev.count < transactions.length
            ? append(transactions.slice(prev.count), prev.state, state)
            : null;
        if (tr && state.passesFilters(tr, i)) {
          tr.setMeta("appendedTransaction", root);
          transactions.push(tr);
          state = state.applyInner(tr);
          appended = true;
        }
        seen[i] = { state, count: transactions.length };
      });
      if (!appended) return { state, transactions };
    }
  }

  private passesFilters(tr: Transaction, ignore = -1): boolean {
    return this.plugins.every(
      (plugin, i) => i === ignore || plugin.spec.filterTransaction?.(tr, this) !== false,
    );
  }

  private applyInner(tr: Transaction): EditorState {
    if (tr.before !== this.doc) throw new RangeError("Transaction was not created from this state");
    const next = new EditorState(tr.doc, tr.selection, tr.storedMarks, this.plugins, new Map());
    for (const plugin of this.plugins) {
      const field = plugin.spec.state;
      if (field) next.fields.set(plugin, field.apply(tr, this.fields.get(plugin), this, next));
    }
    return next;
  }
}
