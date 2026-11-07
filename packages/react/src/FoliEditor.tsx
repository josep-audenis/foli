import {
  createDocument,
  type DocJSON,
  type Editor,
  type FoliDocument,
  type Plugin,
  type Transaction,
} from "@foli/core";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { FoliEditorProvider, useFoliEditor } from "./editor.js";
import { FoliCanvas, type FoliCanvasProps } from "./FoliCanvas.js";

/**
 * A change to the document's content, as `FoliEditor` reports it. `document` is a getter:
 * spreading the object or `JSON.stringify(change)` serializes the document (and walks `editor`).
 */
export interface FoliChange {
  readonly editor: Editor;
  /** The transactions of this change (several when plugins append their own). */
  readonly transactions: readonly Transaction[];
  /**
   * The whole document right after this change, serialized on first read (keep reads out of
   * the hot path of typing: a debounced save reads only the last change's).
   */
  readonly document: FoliDocument;
}

export interface FoliEditorProps extends Omit<FoliCanvasProps, "editor"> {
  /** Read once on mount. To load another document later: `editor.setDocument()` or a new `key`. */
  initialContent?: FoliDocument | undefined;
  /** Read once on mount. */
  plugins?: readonly Plugin[] | undefined;
  /**
   * Called after every change to the document's content made through transactions (typing,
   * commands, undo). Not for selection changes, and not for `editor.setDocument()`, whose
   * caller already has the document.
   */
  onChange?: ((change: FoliChange) => void) | undefined;
  /** Rendered above the pages, inside the editor's context (e.g. a toolbar). */
  children?: ReactNode | undefined;
}

/**
 * An editable document on real pages: creates its editor, provides it to `children` and shows
 * it. Uncontrolled: the editor owns the document; React observes it through `onChange`.
 */
export function FoliEditor({
  initialContent,
  plugins,
  onChange,
  children,
  ...canvas
}: FoliEditorProps) {
  const editor = useFoliEditor({ initialContent, plugins });
  const onChangeRef = useRef(onChange);

  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  });

  useLayoutEffect(
    () =>
      editor.subscribe((state, transactions) => {
        const listener = onChangeRef.current;
        if (!listener || !transactions.some((tr) => tr.docChanged)) return;
        // The state is immutable: keeping it makes a later read give this change's document.
        const { settings } = editor;
        let document: FoliDocument | undefined;
        listener({
          editor,
          transactions,
          get document() {
            document ??= createDocument(state.doc.toJSON() as DocJSON, settings);
            return document;
          },
        });
      }),
    [editor],
  );

  return (
    <FoliEditorProvider editor={editor}>
      {children}
      <FoliCanvas editor={editor} {...canvas} />
    </FoliEditorProvider>
  );
}
