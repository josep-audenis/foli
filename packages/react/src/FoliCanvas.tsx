import type { Editor } from "@folijs/core";
import { EditorView, type EditorViewOptions } from "@folijs/view";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { useEditorOrContext, useIsomorphicLayoutEffect } from "./editor.js";

export interface FoliCanvasProps {
  /** Default: the editor of the nearest `FoliEditorProvider`. */
  editor?: Editor | undefined;
  /** The user can read, select and copy, but not change the document. */
  readOnly?: boolean | undefined;
  /** Shown while the document is empty. */
  placeholder?: string | undefined;
  /** Accessible name of the editable area (default "Document"). */
  label?: string | undefined;
  /**
   * Where pasted, dropped and inserted image files go: the URL the app stores the file at (or a
   * `data:` URL, opting in). Without it, pictures are not pasted, dropped or inserted.
   */
  upload?: EditorViewOptions["upload"] | undefined;
  /**
   * The URL to show a picture's image from (`packageImages` for a .docx package's images). A new
   * function each render is fine: pictures drawn later ask the latest one; ones already drawn
   * keep their image until the document or the picture changes.
   */
  resource?: EditorViewOptions["resource"] | undefined;
  className?: string | undefined;
}

/** What a `ref` on `FoliCanvas` gives. */
export interface FoliCanvasHandle {
  /** Focuses the document and shows the editor's selection in it. */
  focus(): void;
}

/**
 * The editable document on real pages (size and margins from the document settings). The view
 * owns the DOM inside it; React never renders children there.
 */
export const FoliCanvas = forwardRef<FoliCanvasHandle, FoliCanvasProps>(function FoliCanvas(
  {
    editor: given,
    readOnly = false,
    placeholder = "",
    label = "Document",
    className,
    upload = null,
    resource = null,
  },
  ref,
) {
  const editor = useEditorOrContext(given, "FoliCanvas");
  const contentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useImperativeHandle(ref, () => ({ focus: () => viewRef.current?.focus() }), []);

  // The app's latest functions, called through one function each: an inline one, new each
  // render, would otherwise draw every picture again (a new resolver) on every render.
  const latest = useRef({ upload, resource });
  latest.current = { upload, resource };
  const stable = useRef({
    upload: ((file) => latest.current.upload?.(file)) as NonNullable<FoliCanvasProps["upload"]>,
    resource: ((key, r) => latest.current.resource?.(key, r)) as NonNullable<
      FoliCanvasProps["resource"]
    >,
  }).current;
  // Only giving one or taking it away changes the view's options.
  const uploadOption = upload ? stable.upload : null;
  const resourceOption = resource ? stable.resource : null;

  // The options at the moment the view is made: its first render already uses them (no web
  // image fetched before the app's resolver is in place).
  const options = {
    editable: !readOnly,
    placeholder,
    upload: uploadOption,
    resource: resourceOption,
  };
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useIsomorphicLayoutEffect(() => {
    const host = contentRef.current;
    if (!host) return;
    const view = new EditorView(host, editor, optionsRef.current);
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [editor]);

  // Runs after the view is created (effects run in order): for a new view, and when the props change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new editor means a new view, which needs the options too.
  useIsomorphicLayoutEffect(() => {
    viewRef.current?.setOptions({
      editable: !readOnly,
      placeholder,
      upload: uploadOption,
      resource: resourceOption,
    });
  }, [editor, readOnly, placeholder, uploadOption, resourceOption]);

  return (
    <div className={className ? `foli-canvas ${className}` : "foli-canvas"}>
      {/* biome-ignore lint/a11y/useSemanticElements: EditorView makes this div a contenteditable rich-text box. */}
      <div
        ref={contentRef}
        className="foli-content"
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        tabIndex={0}
      />
    </div>
  );
});
