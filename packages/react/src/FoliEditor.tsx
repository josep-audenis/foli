import {
  createDocument,
  type DocJSON,
  type Editor,
  type FoliDocument,
  type Plugin,
  type Transaction,
} from "@folijs/core";
import { forwardRef, type ReactNode, useImperativeHandle, useRef } from "react";
import { FoliEditorProvider, useFoliEditor, useIsomorphicLayoutEffect } from "./editor.js";
import { FoliCanvas, type FoliCanvasHandle, type FoliCanvasProps } from "./FoliCanvas.js";
import { FoliToolbar } from "./FoliToolbar.js";

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
  /** Show the default `FoliToolbar` above the pages (default true). */
  toolbar?: boolean | undefined;
  /** Rendered between the toolbar and the pages, inside the editor's context. */
  children?: ReactNode | undefined;
}

/** What a `ref` on `FoliEditor` gives: its editor (commands, `setDocument`…) and focus. */
export interface FoliEditorHandle extends FoliCanvasHandle {
  readonly editor: Editor;
}

/**
 * An editable document on real pages with a toolbar: creates its editor, provides it to
 * `children` and shows it. Uncontrolled: the editor owns the document; React observes it
 * through `onChange`, a parent reaches it through a `ref`.
 */
export const FoliEditor = forwardRef<FoliEditorHandle, FoliEditorProps>(function FoliEditor(
  { initialContent, plugins, onChange, toolbar = true, children, ...canvas },
  ref,
) {
  const editor = useFoliEditor({ initialContent, plugins });
  const onChangeRef = useRef(onChange);
  const canvasRef = useRef<FoliCanvasHandle>(null);

  useImperativeHandle(ref, () => ({ editor, focus: () => canvasRef.current?.focus() }), [editor]);

  useIsomorphicLayoutEffect(() => {
    onChangeRef.current = onChange;
  });

  useIsomorphicLayoutEffect(
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
      {toolbar && (
        <FoliToolbar
          editor={editor}
          disabled={canvas.readOnly}
          onClickCommand={() => canvasRef.current?.focus()}
        />
      )}
      {children}
      <FoliCanvas ref={canvasRef} editor={editor} {...canvas} />
    </FoliEditorProvider>
  );
});
