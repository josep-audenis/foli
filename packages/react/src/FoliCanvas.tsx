import type { Editor } from "@foli/core";
import { EditorView } from "@foli/view";
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
  { editor: given, readOnly = false, placeholder = "", label = "Document", className },
  ref,
) {
  const editor = useEditorOrContext(given, "FoliCanvas");
  const contentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useImperativeHandle(ref, () => ({ focus: () => viewRef.current?.focus() }), []);

  useIsomorphicLayoutEffect(() => {
    const host = contentRef.current;
    if (!host) return;
    const view = new EditorView(host, editor);
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [editor]);

  // Runs after the view is created (effects run in order): for a new view, and when the props change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new editor means a new view, which needs the options too.
  useIsomorphicLayoutEffect(() => {
    viewRef.current?.setOptions({ editable: !readOnly, placeholder });
  }, [editor, readOnly, placeholder]);

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
