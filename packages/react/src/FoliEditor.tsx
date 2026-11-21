import type {
  Editor,
  EditorDocument,
  Extension,
  FoliDocument,
  Plugin,
  ReviewView,
  Transaction,
} from "@folijs/core";
import { documentJSON, wordContext } from "@folijs/core/internal";
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
import {
  FoliToolbar,
  type FoliToolbarProps,
  type ToolbarGroups,
  type ToolbarTab,
} from "./FoliToolbar.js";

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
  /**
   * Read once on mount: a different list later is ignored, with a warning unless
   * `process.env.NODE_ENV` is `"production"` at run time (`useFoliEditor`). To change them, give
   * `FoliEditor` a new `key`.
   */
  plugins?: readonly Plugin[] | undefined;
  /**
   * Read once on mount, as `plugins`: custom nodes and marks with their view hooks
   * (`ViewExtension`).
   */
  extensions?: readonly Extension[] | undefined;
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
  /**
   * Show `FoliToolbar` above the pages (default true): with `defaultToolbarItems`, with these
   * groups of items (`FoliToolbarProps.items`), or with these tabs (`FoliToolbarProps.tabs`,
   * e.g. `defaultToolbarTabs`).
   */
  toolbar?: boolean | ToolbarGroups | readonly ToolbarTab[] | undefined;
  /**
   * More of `FoliToolbar`'s props for the toolbar shown (`tab`, `onTabChange`, `label`,
   * `className`…). `editor`, `disabled`, `comments`, `upload` and `onClickCommand` stay
   * `FoliEditor`'s; `items` and `tabs` come from `toolbar`.
   */
  toolbarProps?:
    | Omit<
        FoliToolbarProps,
        "editor" | "disabled" | "comments" | "upload" | "onClickCommand" | "items" | "tabs"
      >
    | undefined;
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
    extensions,
    author,
    trackChanges,
    reviewView,
    onChange,
    toolbar = true,
    toolbarProps,
    comments = "auto",
    children,
    ...canvas
  },
  ref,
) {
  const editor = useFoliEditor({
    initialContent,
    plugins,
    extensions,
    author,
    trackChanges,
    reviewView,
  });
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
            const envelope = wordContext(state)?.envelope;
            document ??= envelope
              ? documentJSON(envelope, state.doc)
              : ({ content: state.doc.toJSON() } as FoliDocument);
            return document;
          },
        });
      }),
    [editor],
  );

  // Groups are arrays of items or `{ label, items }`; a tab has a `key`.
  const first = typeof toolbar === "object" ? toolbar[0] : undefined;
  const tabbed = first !== undefined && !Array.isArray(first) && "key" in first;
  return (
    <FoliEditorProvider editor={editor}>
      {toolbar && (
        <FoliToolbar
          {...toolbarProps}
          editor={editor}
          disabled={canvas.readOnly}
          comments={comments !== false}
          upload={canvas.upload}
          // Groups are arrays of items, tabs are objects; an empty array is no items (as in 1.0).
          items={toolbar === true || tabbed ? undefined : (toolbar as ToolbarGroups)}
          tabs={tabbed ? (toolbar as readonly ToolbarTab[]) : undefined}
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
