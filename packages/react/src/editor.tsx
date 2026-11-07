import {
  createEditor,
  type Editor,
  type EditorState,
  type FoliDocument,
  type Plugin,
} from "@foli/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

export interface UseFoliEditorOptions {
  /** Read once, when the editor is created. To load another document, `editor.setDocument()`. */
  initialContent?: FoliDocument | undefined;
  /** Read once, when the editor is created. */
  plugins?: readonly Plugin[] | undefined;
}

/**
 * A headless `Editor` (state, commands, history) owned by the calling component: created on the
 * first render and kept for its lifetime. Later changes to `options` are ignored.
 */
export function useFoliEditor(options: UseFoliEditorOptions = {}): Editor {
  const [editor] = useState(() => {
    const { initialContent: document, plugins } = options;
    return createEditor({ ...(document && { document }), ...(plugins && { plugins }) });
  });
  return editor;
}

const EditorContext = createContext<Editor | null>(null);

/** Makes `editor` the one `useCurrentEditor`, `useEditorState` and `FoliCanvas` use below it. */
export function FoliEditorProvider({ editor, children }: { editor: Editor; children?: ReactNode }) {
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
  editor?: Editor;
  /** When the selection is equal to the previous one, the component does not re-render (default `Object.is`). */
  isEqual?: (a: T, b: T) => boolean;
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
  // The last selection, kept across renders so an equal one keeps its identity (an inline
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
