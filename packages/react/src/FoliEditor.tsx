import {
  commentOnly as commentOnlyPlugin,
  type DocumentTarget,
  type Editor,
  type EditorDocument,
  type Extension,
  type FoliDocument,
  hint,
  type Plugin,
  type ReviewView,
  type Transaction,
} from "@folijs/core";
import { documentJSON, wordContext } from "@folijs/core/internal";
import { forwardRef, type ReactNode, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  FoliEditorProvider,
  useActiveEditor,
  useEditorState,
  useFoliEditor,
  useIsomorphicLayoutEffect,
} from "./editor.js";
import { FoliCanvas, type FoliCanvasHandle, type FoliCanvasProps } from "./FoliCanvas.js";
import { FoliComments, type MentionEvent, type MentionSource } from "./FoliComments.js";
import { FoliContextMenu, type FoliContextMenuProps } from "./FoliContextMenu.js";
import { FoliNavigation } from "./FoliNavigation.js";
import { FoliStatusBar, type FoliStatusBarProps } from "./FoliStatusBar.js";
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
   * The editor's plugins: a different list later replaces them in place (`editor.reconfigure`,
   * `useFoliEditor`), keeping the document and undo; joining or leaving a shared session is one.
   */
  plugins?: readonly Plugin[] | undefined;
  /**
   * Read once on mount: custom nodes and marks with their view hooks (`ViewExtension`). A
   * different list later is ignored, with a warning unless `process.env.NODE_ENV` is
   * `"production"` at run time; give `FoliEditor` a new `key` to change them.
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
  /**
   * Word's status bar under the pages (`FoliStatusBar`, 1.11): the page, the word count,
   * tracking and the zoom. With it, the zoom is the editor's own (Ctrl+wheel included) unless
   * `zoom` is given. Default false.
   */
  statusBar?: boolean | Omit<FoliStatusBarProps, "editor" | "zoom" | "onZoomChange"> | undefined;
  /**
   * Word's right-click menu on the document (`FoliContextMenu`, 1.11); Shift+right-click keeps
   * the browser's (spelling suggestions). Also the menu key and Shift+F10. Default false.
   */
  contextMenu?: boolean | Pick<FoliContextMenuProps, "items" | "messages"> | undefined;
  /**
   * The comments pane edits and deletes only `author`'s comments (`FoliComments`). Default:
   * `commentOnly`'s value.
   */
  onlyOwnComments?: boolean | undefined;
  /**
   * Comment-only mode: the user selects, copies, finds and comments (replies, resolves, deletes),
   * but cannot change the text. The canvas is read-only, the toolbar keeps only commenting and
   * review items, and core's `commentOnly({ author })` plugin refuses every other local change
   * (received collab edits still apply): the user changes only their own comments, and resolves
   * any. Not access control: the app's server checks what it receives.
   */
  commentOnly?: boolean | undefined;
  /** People a comment can tag after `@` (`FoliComments`' `mentions`). */
  mentions?: MentionSource | undefined;
  /** A comment saved in the pane newly tags people: tell them (`FoliComments`' `onMention`). */
  onMention?: ((event: MentionEvent) => void) | undefined;
  /** Rendered between the toolbar and the pages, inside the editor's context. */
  children?: ReactNode | undefined;
}

/** What a `ref` on `FoliEditor` gives: its editor (commands, `setDocument`…) and focus. */
export interface FoliEditorHandle extends FoliCanvasHandle {
  readonly editor: Editor;
  /**
   * Shows a place for a few seconds without moving the caret (core's `hint`): a range, or a
   * bookmark by name. False when no page shows it.
   */
  hint(target: DocumentTarget | { bookmark: string }, options?: { ms?: number }): boolean;
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
    onlyOwnComments,
    commentOnly = false,
    mentions,
    onMention,
    children,
    statusBar = false,
    contextMenu = false,
    ...canvas
  },
  ref,
) {
  // One filter per author (read once, as the editor's): the client refuses what a server checking
  // `onlyCommentSteps(doc, steps, { author })` would.
  const [filter] = useState(() => commentOnlyPlugin(author !== undefined ? { author } : {}));
  // A new list only when the mode or the app's plugins change (plugins are applied in place).
  const allPlugins = useMemo(
    () => (commentOnly ? [...(plugins ?? []), filter] : plugins),
    [commentOnly, plugins, filter],
  );
  const editor = useFoliEditor({
    initialContent,
    plugins: allPlugins,
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

  useImperativeHandle(
    ref,
    () => ({
      editor,
      focus: () => canvasRef.current?.focus(),
      fitZoom: (kind) => canvasRef.current?.fitZoom(kind) ?? 1,
      hint: (target, options) => hint(editor, target, options),
    }),
    [editor],
  );

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

  const readOnly = canvas.readOnly === true;
  // The status bar's zoom, unless the app gives one.
  const [ownZoom, setOwnZoom] = useState(1);
  const zoomed = canvas.zoom === undefined && statusBar !== false;
  const zoom = zoomed ? ownZoom : (canvas.zoom ?? 1);
  const onZoomChange = zoomed ? setOwnZoom : canvas.onZoomChange;
  // The open header's, footer's or note's editor, else the body's: what the menu acts on.
  const activeEditor = useActiveEditor(editor);
  // Where the right-click menu is open, if it is.
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  // Groups are arrays of items or `{ label, items }`; a tab has a `key`.
  const first = typeof toolbar === "object" ? toolbar[0] : undefined;
  const tabbed = first !== undefined && !Array.isArray(first) && "key" in first;
  return (
    <FoliEditorProvider editor={editor}>
      {toolbar && (
        <FoliToolbar
          {...toolbarProps}
          editor={editor}
          disabled={readOnly}
          commentOnly={commentOnly}
          comments={comments !== false}
          upload={canvas.upload}
          // Groups are arrays of items, tabs are objects; an empty array is no items (as in 1.0).
          items={toolbar === true || tabbed ? undefined : (toolbar as ToolbarGroups)}
          tabs={tabbed ? (toolbar as readonly ToolbarTab[]) : undefined}
          onClickCommand={() => canvasRef.current?.focus()}
        />
      )}
      {children}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the document's own menu event, from the keyboard too (the menu key, Shift+F10). */}
      <div
        className="foli-editor-body"
        onContextMenu={(event) => {
          const target = event.target as Element;
          // Shift+right-click keeps the browser's menu; Shift+F10 (a key, no button) opens ours.
          const pointer = event.button === 2 && (event.clientX !== 0 || event.clientY !== 0);
          if (!contextMenu || (event.shiftKey && pointer) || !target.closest?.(".foli-content"))
            return;
          event.preventDefault();
          // From the keyboard (the menu key, Shift+F10): at the caret.
          let { clientX: x, clientY: y } = event;
          if (!x && !y) {
            const selection = target.ownerDocument.getSelection();
            const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
            // A caret's box is often empty (an empty paragraph): its first rect, else the
            // focused element's box.
            const rect = range?.getBoundingClientRect?.();
            const box =
              rect && (rect.width || rect.height)
                ? rect
                : (range?.getClientRects?.()[0] ?? target.getBoundingClientRect());
            x = box.left;
            y = box.bottom;
          }
          // After the selection a quick press made has reached the editor (`selectionchange`).
          setTimeout(() => setMenuAt({ x, y }));
        }}
      >
        <FoliNavigation editor={editor} readOnly={readOnly || commentOnly} />
        <FoliCanvas
          ref={canvasRef}
          editor={editor}
          {...canvas}
          zoom={zoom}
          onZoomChange={onZoomChange}
          readOnly={readOnly || commentOnly}
        />
        {/* "auto": mounted while hidden, so a comment made from the toolbar opens for writing. */}
        {comments !== false && (
          <FoliComments
            editor={editor}
            readOnly={readOnly}
            hidden={comments === "auto" && !hasComments}
            onlyOwnComments={onlyOwnComments ?? commentOnly}
            mentions={mentions}
            onMention={onMention}
          />
        )}
      </div>
      {menuAt && (
        <FoliContextMenu
          {...(contextMenu === true || contextMenu === false ? {} : contextMenu)}
          editor={activeEditor}
          readOnly={readOnly}
          commentOnly={commentOnly}
          at={menuAt}
          onClose={() => setMenuAt(null)}
          onFocusDocument={() => canvasRef.current?.focus()}
        />
      )}
      {statusBar !== false && (
        <FoliStatusBar
          {...(statusBar === true ? {} : statusBar)}
          editor={editor}
          zoom={zoom}
          onZoomChange={onZoomChange}
          fitZoom={(kind) => canvasRef.current?.fitZoom(kind) ?? zoom}
        />
      )}
    </FoliEditorProvider>
  );
});
