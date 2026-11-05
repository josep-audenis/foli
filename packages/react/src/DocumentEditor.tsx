import { createDocument, createEditor, type FoliDocument } from "@foli/core";
import { EditorView } from "@foli/view";
import { useLayoutEffect, useRef, useState } from "react";

export interface DocumentEditorProps {
  /** Read once on mount. To load a different document later, remount with a new `key`. */
  initialContent?: FoliDocument;
  /** Called with the whole document after every change to its content. */
  onChange?: (document: FoliDocument) => void;
  /** The user can read, select and copy, but not change the document. */
  readOnly?: boolean;
  /** Shown while the document is empty. */
  placeholder?: string;
  /** Accessible name of the editor (default "Document"). */
  label?: string;
  className?: string;
}

/**
 * An editable document on real pages (size and margins from the document settings; whole blocks
 * flow from page to page, paragraphs split across pages in Phase 5.2). Uncontrolled:
 * the engine owns the document; React only observes it through `onChange`.
 * Provisional API: final names are decided in Phase 6 (see docs/roadmap.md).
 */
export function DocumentEditor({
  initialContent,
  onChange,
  readOnly = false,
  placeholder = "",
  label = "Document",
  className,
}: DocumentEditorProps) {
  const [initial] = useState(() => initialContent ?? createDocument());
  const [editor] = useState(() => createEditor({ document: initial }));
  const contentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);

  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  });

  // The view owns this DOM subtree; React never renders children into it.
  useLayoutEffect(() => {
    const host = contentRef.current;
    if (!host) return;
    const view = new EditorView(host, editor);
    viewRef.current = view;
    // shortcut: serializes the whole document per change (O(document) per keystroke); Phase 6 API decides on a lazy getter.
    const unsubscribe = editor.subscribe((_state, transactions) => {
      if (transactions.some((tr) => tr.docChanged)) onChangeRef.current?.(editor.getDocument());
    });
    return () => {
      unsubscribe();
      view.destroy();
      viewRef.current = null;
    };
  }, [editor]);

  // Runs after the view is created (effects run in order), and again when the props change.
  useLayoutEffect(() => {
    viewRef.current?.setOptions({ editable: !readOnly, placeholder });
  }, [readOnly, placeholder]);

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
