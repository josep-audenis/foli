import {
  type Command,
  createEditor,
  type Editor,
  type EditorDocument,
  type EditorState,
  type Extension,
  type FoliCommands,
  type Plugin,
  type ReviewView,
} from "@folijs/core";
import { editorCommand } from "@folijs/core/internal";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/**
 * `useLayoutEffect` in the browser, `useEffect` on the server, where neither runs: React 18
 * warns about a layout effect in server rendering.
 * @internal
 */
export const useIsomorphicLayoutEffect =
  typeof document === "undefined" ? useEffect : useLayoutEffect;

export interface UseFoliEditorOptions {
  /**
   * Read once, when the editor is created: a document of any version (0.1.0 and 0.2.0 documents
   * are validated and migrated to schema v3, `parseDocument`). Default: an empty document. To
   * load another document, `editor.setDocument()`.
   */
  initialContent?: EditorDocument | undefined;
  /**
   * The editor's plugins. A different list later (other plugins, not a new array of the same
   * ones) replaces them in place (`editor.reconfigure`): the document, the selection, undo and
   * the state of plugins in both lists stay. Joining or leaving a shared session is a new list.
   */
  plugins?: readonly Plugin[] | undefined;
  /**
   * Read once: custom nodes and marks, their plugins and view hooks (`ViewExtension` from
   * `@folijs/view`), as `createEditor`'s `extensions`. A different list later is ignored, with a
   * warning unless `process.env.NODE_ENV` is `"production"` at run time: give the component a
   * new `key` to make a new editor with it.
   */
  extensions?: readonly Extension[] | undefined;
  /** Read once: who edits (tracked changes are made in this name; `createEditor`'s `author`). */
  author?: string | undefined;
  /** Read once: record edits as tracked changes from the start (a `.docx`'s `trackRevisions`). */
  trackChanges?: boolean | undefined;
  /** Read once: how tracked changes show at first (default `markup`). */
  reviewView?: ReviewView | undefined;
}

/**
 * A headless `Editor` (state, commands, history) of a schema v3 document, owned by the calling
 * component: created on the first render and kept for its lifetime. Later changes to `options`
 * are ignored, but for `plugins` (applied with `editor.reconfigure`). Throws FoliDocumentError when `initialContent` is not a valid document.
 */
export function useFoliEditor(options: UseFoliEditorOptions = {}): Editor {
  const [editor] = useState(() => {
    const {
      initialContent: document,
      plugins,
      extensions,
      author,
      trackChanges,
      reviewView,
    } = options;
    return createEditor({
      ...(document && { document }),
      ...(plugins && { plugins }),
      ...(extensions && { extensions }),
      ...(author !== undefined && { author }),
      ...(trackChanges !== undefined && { trackChanges }),
      ...(reviewView !== undefined && { reviewView }),
    });
  });
  // Plugins follow the prop (24.5, ADR-0008 amended): the same editor, its undo kept.
  const applied = useRef(options.plugins);
  useEffect(() => {
    if (sameItems(applied.current, options.plugins)) return;
    applied.current = options.plugins;
    editor.reconfigure({ plugins: options.plugins ?? [] });
  });
  // ADR-0008: the editor takes its extensions once; say so when an app changes them.
  const first = useRef(options.extensions);
  const warned = useRef(false);
  useEffect(() => {
    if (warned.current || !development() || sameItems(first.current, options.extensions)) return;
    warned.current = true;
    console.warn(
      "Foli: `extensions` changed after the editor was created and is ignored. Give the component a new `key` to create an editor with the new list.",
    );
  });
  return editor;
}

/**
 * Dev-only checks run unless `process.env.NODE_ENV` is "production" at run time: read through
 * `globalThis`, so a bundle that defines no `process` runs them too.
 * @internal
 */
export const development = () =>
  (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV !==
  "production";

/**
 * The same elements (an inline array of the same plugins is not a change).
 * @internal
 */
export const sameItems = (a: readonly unknown[] = [], b: readonly unknown[] = []) =>
  a.length === b.length && a.every((item, i) => item === b[i]);

const EditorContext = createContext<Editor | null>(null);

/** Makes `editor` the one `useCurrentEditor`, `useEditorState` and `FoliCanvas` use below it. */
export function FoliEditorProvider({
  editor,
  children,
}: {
  editor: Editor;
  children?: ReactNode | undefined;
}) {
  return <EditorContext.Provider value={editor}>{children}</EditorContext.Provider>;
}

/** The editor of the nearest `FoliEditorProvider` (or `FoliEditor`). Throws outside one. */
export function useCurrentEditor(): Editor {
  const editor = useContext(EditorContext);
  if (!editor) throw new Error("useCurrentEditor: no FoliEditorProvider or FoliEditor above");
  return editor;
}

/**
 * `editor` if given, else the context's.
 * @internal
 */
export function useEditorOrContext(editor: Editor | undefined, caller: string): Editor {
  const context = useContext(EditorContext);
  const found = editor ?? context;
  if (!found) throw new Error(`${caller}: pass an editor or render inside a FoliEditorProvider`);
  return found;
}

/**
 * The editor commands go to: the story open on its page, if any, else `editor`.
 * @internal
 */
export function useActiveEditor(editor: Editor): Editor {
  const subscribe = useCallback((notify: () => void) => editor.subscribe(notify), [editor]);
  const id = useSyncExternalStore(
    subscribe,
    () => editor.storyView?.open?.id ?? null,
    () => null,
  );
  return (id && editor.story(id)) || editor;
}

export interface UseEditorStateOptions<T> {
  /** Default: the context's editor. */
  editor?: Editor | undefined;
  /** When the selected value equals the previous one, the component does not re-render (default `Object.is`). */
  isEqual?: ((a: T, b: T) => boolean) | undefined;
}

/**
 * A slice of the editor state that re-renders the component only when it changes, e.g.
 * `useEditorState((state, editor) => editor.isMarkActive("bold"))`. The selector runs after
 * every transaction: keep it cheap.
 */
export function useEditorState<T>(
  selector: (state: EditorState, editor: Editor) => T,
  { editor: given, isEqual = Object.is }: UseEditorStateOptions<T> = {},
): T {
  const editor = useEditorOrContext(given, "useEditorState");
  // The last selected value, kept across renders so an equal one keeps its identity (an inline
  // selector is a new function every render: it runs again, the result stays the same object).
  const last = useRef<{ state: EditorState; selector: unknown; value: T } | null>(null);
  const subscribe = useCallback((notify: () => void) => editor.subscribe(notify), [editor]);
  const getSnapshot = () => {
    const state = editor.state;
    const previous = last.current;
    if (previous?.state === state && previous.selector === selector) return previous.value;
    const value = selector(state, editor);
    const kept = previous && isEqual(previous.value, value) ? previous.value : value;
    last.current = { state, selector, value: kept };
    return kept;
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** What `useCommand` gives: whether the command applies now, and a way to run it. */
export interface CommandState {
  /** A dry run (`editor.can`), again after every transaction. */
  readonly enabled: boolean;
  /** Runs the command on the editor; whether it applied. */
  run(): boolean;
}

export interface UseCommandOptions {
  /** Default: the context's editor. */
  editor?: Editor | undefined;
}

/**
 * A command's state for a button of the app's own: `enabled` re-renders the component when a dry
 * run's answer changes, `run` runs it, e.g. `useCommand(toggleMark("bold"))`. Both act on the
 * editor of the header, footer or note open on its page, else on `editor` (default: the
 * context's), as the toolbar's items do. The dry run runs after every transaction (and on a
 * render with another command: keep the command's identity, e.g. made outside the component).
 */
export function useCommand(command: Command, options?: UseCommandOptions): CommandState;
/**
 * A named command of `editor.commands` (built-in, or a plugin's `PluginSpec.commands`), typed by
 * `FoliCommands`, on the context's editor (or the story open on its page):
 * `useCommand("toggleMark", "bold")`, `useCommand("insertMention", "u-1", "Ada")`. Disabled while
 * the editor has no command of that name (its plugin not added yet, or taken away).
 */
export function useCommand<K extends keyof FoliCommands>(
  name: K,
  ...args: Parameters<FoliCommands[K]>
): CommandState;
export function useCommand(target: Command | string, ...rest: unknown[]): CommandState {
  const named = typeof target === "string";
  const editor = useActiveEditor(
    useEditorOrContext(
      named ? undefined : (rest[0] as UseCommandOptions | undefined)?.editor,
      "useCommand",
    ),
  );
  const args = named ? rest : [];
  // One command and selector per editor, its commands, target and arguments: useEditorState
  // keeps its answer. A named command is looked up again when the plugins change (`reconfigure`):
  // one whose plugin the parent adds in this render is disabled until its effect has added it.
  const memo = useRef<{
    editor: Editor;
    commands: FoliCommands;
    target: Command | string;
    args: readonly unknown[];
    command: Command | undefined;
    selector: (state: EditorState, editor: Editor) => boolean;
  } | null>(null);
  let current = memo.current;
  if (
    !current ||
    current.editor !== editor ||
    current.commands !== editor.commands ||
    current.target !== target ||
    !sameItems(current.args, args)
  ) {
    const command = typeof target === "string" ? editorCommand(editor, target, args) : target;
    const selector = (_state: EditorState, e: Editor) => {
      const now = typeof target === "string" ? editorCommand(e, target, args) : target;
      return now ? e.can(now) : false;
    };
    current = { editor, commands: editor.commands, target, args, command, selector };
    memo.current = current;
  }
  const { command, selector } = current;
  const enabled = useEditorState(selector, { editor });
  return { enabled, run: () => (command ? editor.run(command) : false) };
}
