import {
  createEditor,
  type Editor,
  type EditorDocument,
  type EditorState,
  type Plugin,
  type ReviewView,
} from "@folijs/core";
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
  /** Read once, when the editor is created. */
  plugins?: readonly Plugin[] | undefined;
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
 * are ignored. Throws FoliDocumentError when `initialContent` is not a valid document.
 */
export function useFoliEditor(options: UseFoliEditorOptions = {}): Editor {
  const [editor] = useState(() => {
    const { initialContent: document, plugins, author, trackChanges, reviewView } = options;
    return createEditor({
      ...(document && { document }),
      ...(plugins && { plugins }),
      ...(author !== undefined && { author }),
      ...(trackChanges !== undefined && { trackChanges }),
      ...(reviewView !== undefined && { reviewView }),
    });
  });
  return editor;
}

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

/** `editor` if given, else the context's. */
export function useEditorOrContext(editor: Editor | undefined, caller: string): Editor {
  const context = useContext(EditorContext);
  const found = editor ?? context;
  if (!found) throw new Error(`${caller}: pass an editor or render inside a FoliEditorProvider`);
  return found;
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
