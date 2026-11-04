import { createDocument, createExtensions, type FoliDocument } from "@foli/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { type CSSProperties, useEffect, useRef, useState } from "react";

export interface DocumentEditorProps {
  /** Read once on mount. To load a different document later, remount with a new `key`. */
  initialContent?: FoliDocument;
  onChange?: (document: FoliDocument) => void;
  className?: string;
}

/**
 * Uncontrolled editor: the editor owns document state, the parent observes it via onChange.
 * Walking skeleton only — single visual page, no pagination or toolbar yet (see docs/roadmap.md).
 */
export function DocumentEditor({ initialContent, onChange, className }: DocumentEditorProps) {
  const [initial] = useState(() => initialContent ?? createDocument());
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const editor = useEditor({
    extensions: createExtensions(),
    content: initial.content,
    onUpdate: ({ editor }) => onChangeRef.current?.({ ...initial, content: editor.getJSON() }),
  });

  const { pageSize, margins } = initial.settings;
  const pageStyle: CSSProperties = {
    width: `${pageSize.width}mm`,
    minHeight: `${pageSize.height}mm`,
    padding: `${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm`,
  };

  return (
    <div className={className ? `foli-canvas ${className}` : "foli-canvas"}>
      <div className="foli-page" style={pageStyle}>
        <EditorContent editor={editor} className="foli-content" />
      </div>
    </div>
  );
}
