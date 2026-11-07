import type { Editor } from "@foli/core";
import { EditorView } from "@foli/view";
import { useLayoutEffect, useRef } from "react";
import { useEditorOrContext } from "./editor.js";

export interface FoliCanvasProps {
  /** Default: the editor of the nearest `FoliEditorProvider`. */
  editor?: Editor;
  /** The user can read, select and copy, but not change the document. */
  readOnly?: boolean;
  /** Shown while the document is empty. */
  placeholder?: string;
  /** Accessible name of the editable area (default "Document"). */
  label?: string;
  className?: string;
}

/**
 * The editable document on real pages (size and margins from the document settings). The view
 * owns the DOM inside it; React never renders children there.
 */
export function FoliCanvas({
  editor: given,
  readOnly = false,
  placeholder = "",
  label = "Document",
  className,
}: FoliCanvasProps) {
  const editor = useEditorOrContext(given, "FoliCanvas");
  const contentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useLayoutEffect(() => {
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
  useLayoutEffect(() => {
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
}
