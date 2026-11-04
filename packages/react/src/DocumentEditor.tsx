import { createDocument, createEditor, type FoliDocument } from "@foli/core";
import { EditorView } from "@foli/view";
import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";

export interface DocumentEditorProps {
  /** Read once on mount. To load a different document later, remount with a new `key`. */
  initialContent?: FoliDocument;
  /** Called with the whole document after every change to its content. */
  onChange?: (document: FoliDocument) => void;
  className?: string;
}

/**
 * An editable document on one page-sized sheet (pagination arrives in Phase 5). Uncontrolled:
 * the engine owns the document; React only observes it through `onChange`.
 * Provisional API: final names are decided in Phase 6 (see docs/roadmap.md).
 */
export function DocumentEditor({ initialContent, onChange, className }: DocumentEditorProps) {
  const [initial] = useState(() => initialContent ?? createDocument());
  const [editor] = useState(() => createEditor({ document: initial }));
  const contentRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);

  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  });

  // The view owns this DOM subtree; React never renders children into it.
  useLayoutEffect(() => {
    const host = contentRef.current;
    if (!host) return;
    const view = new EditorView(host, editor);
    // shortcut: serializes the whole document per change (O(document) per keystroke); Phase 6 API decides on a lazy getter.
    const unsubscribe = editor.subscribe((_state, transactions) => {
      if (transactions.some((tr) => tr.docChanged)) onChangeRef.current?.(editor.getDocument());
    });
    return () => {
      unsubscribe();
      view.destroy();
    };
  }, [editor]);

  const { pageSize, margins } = initial.settings;
  const pageStyle: CSSProperties = {
    width: `${pageSize.width}mm`,
    minHeight: `${pageSize.height}mm`,
    padding: `${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm`,
  };

  return (
    <div className={className ? `foli-canvas ${className}` : "foli-canvas"}>
      <div className="foli-page" style={pageStyle}>
        {/* biome-ignore lint/a11y/useSemanticElements: EditorView makes this div a contenteditable rich-text box. */}
        <div
          ref={contentRef}
          className="foli-content"
          role="textbox"
          aria-multiline="true"
          aria-label="Document"
          tabIndex={0}
        />
      </div>
    </div>
  );
}
