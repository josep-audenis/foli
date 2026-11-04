import { createDocument, type FoliDocument } from "@foli/core";
import { renderContent } from "@foli/view";
import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";

export interface DocumentEditorProps {
  /** Read once on mount. To load a different document later, remount with a new `key`. */
  initialContent?: FoliDocument;
  className?: string;
}

/**
 * Currently READ-ONLY: renders the document on one page-sized sheet.
 * Editing arrives with Foli's own engine (Phases 2–4), pagination in Phase 5 — see docs/roadmap.md.
 */
export function DocumentEditor({ initialContent, className }: DocumentEditorProps) {
  const [initial] = useState(() => initialContent ?? createDocument());
  const contentRef = useRef<HTMLDivElement>(null);

  // The view owns this DOM subtree; React never renders children into it.
  useLayoutEffect(() => {
    contentRef.current?.replaceChildren(renderContent(initial.content));
  }, [initial]);

  const { pageSize, margins } = initial.settings;
  const pageStyle: CSSProperties = {
    width: `${pageSize.width}mm`,
    minHeight: `${pageSize.height}mm`,
    padding: `${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm`,
  };

  return (
    <div className={className ? `foli-canvas ${className}` : "foli-canvas"}>
      <div className="foli-page" style={pageStyle}>
        <div ref={contentRef} className="foli-content" />
      </div>
    </div>
  );
}
