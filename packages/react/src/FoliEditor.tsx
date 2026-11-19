import type {
  Editor,
  EditorDocument,
  FoliDocument,
  Plugin,
  ReviewView,
  Transaction,
} from "@folijs/core";
import { wordContext } from "@folijs/core/internal";
import { forwardRef, type ReactNode, useImperativeHandle, useRef } from "react";
import {
  FoliEditorProvider,
  useEditorState,
  useFoliEditor,
  useIsomorphicLayoutEffect,
} from "./editor.js";
import { FoliCanvas, type FoliCanvasHandle, type FoliCanvasProps } from "./FoliCanvas.js";
import { FoliComments } from "./FoliComments.js";
import { FoliNavigation } from "./FoliNavigation.js";
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
   * the hot path of typing: a debounced save reads only the last change's). Schema v3.
   */
  readonly document: FoliDocument;
}

export interface FoliEditorProps extends Omit<FoliCanvasProps, "editor"> {
  /**
   * Read once on mount: a document of any version (0.1.0 and 0.2.0 documents are migrated to
   * schema v3). To load another document later: `editor.setDocument()` or a new `key`.
   */
  initialContent?: EditorDocument | undefined;
  /** Read once on mount. */
  plugins?: readonly Plugin[] | undefined;
  /** Read once on mount: who edits (tracked changes are made in this name). */
  author?: string | undefined;
  /** Read once on mount: record edits as tracked changes (the toolbar turns it on and off). */
  trackChanges?: boolean | undefined;
  /** Read once on mount: how tracked changes show (the toolbar changes it). */
  reviewView?: ReviewView | undefined;
  /**
   * Called after every change to the document's content made through transactions (typing,
   * commands, undo). Not for selection changes, and not for `editor.setDocument()`, whose
   * caller already has the document.
   */
  onChange?: ((change: FoliChange) => void) | undefined;
  /** Show the default `FoliToolbar` above the pages (default true). */
  toolbar?: boolean | undefined;
  /**
   * Show the comments pane (`FoliComments`) beside the pages: `"auto"` (the default) while the
   * document has comments, `true` always, `false` never.
   */
  comments?: boolean | "auto" | undefined;
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
  {
    initialContent,
    plugins,
    author,
    trackChanges,
    reviewView,
    onChange,
    toolbar = true,
    comments = "auto",
    children,
    ...canvas
  },
  ref,
) {
  const editor = useFoliEditor({ initialContent, plugins, author, trackChanges, reviewView });
  const hasComments = useEditorState(
    (state) => (wordContext(state)?.envelope.comments.length ?? 0) > 0,
    { editor },
  );
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
        let document: FoliDocument | undefined;
        listener({
          editor,
          transactions,
          get document() {
            document ??= {
              ...(structuredClone(wordContext(state)?.envelope) as Omit<FoliDocument, "content">),
              content: state.doc.toJSON(),
            };
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
          comments={comments !== false}
          upload={canvas.upload}
          onClickCommand={() => canvasRef.current?.focus()}
        />
      )}
      {children}
      <div className="foli-editor-body">
        <FoliNavigation editor={editor} readOnly={canvas.readOnly} />
        <FoliCanvas ref={canvasRef} editor={editor} {...canvas} />
        {/* "auto": mounted while hidden, so a comment made from the toolbar opens for writing. */}
        {comments !== false && (
          <FoliComments
            editor={editor}
            readOnly={canvas.readOnly}
            hidden={comments === "auto" && !hasComments}
          />
        )}
      </div>
    </FoliEditorProvider>
  );
});
