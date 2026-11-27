import { type Editor, selectedObject } from "@folijs/core";
import { useEffect, useRef, useState } from "react";
import { useEditorState } from "./editor.js";
import { FoliToolbar, toolbarItems } from "./FoliToolbar.js";
import { toolbarIcons } from "./icons.js";
import type { ToolbarMessages } from "./messages.js";
import type { LengthUnit } from "./units.js";

export interface FoliLayoutOptionsProps {
  editor: Editor;
  messages?: ToolbarMessages | undefined;
  /** The unit of the dialog it opens (`FoliToolbarProps.units`). */
  units?: LengthUnit | undefined;
  /** Only shown when the document can change. */
  disabled?: boolean | undefined;
}

/** The selected object as the view marks it (in this editor's pages: the one with the focus). */
const SELECTED = "[data-foli-picture-selected]";

/**
 * Word's Layout Options button beside the selected picture or text box (33.4,
 * `.foli-layout-options`): its wrapping, and whether it moves with its paragraph, in a menu.
 * Follows the object as the pages scroll and change; gone when no object is selected.
 */
export function FoliLayoutOptions({ editor, messages, units, disabled }: FoliLayoutOptionsProps) {
  const selected = useEditorState((state) => selectedObject(state)?.pos ?? null, { editor });
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (selected === null || disabled) {
      setAt(null);
      return;
    }
    const doc = box.current?.ownerDocument ?? document;
    let frame = 0;
    const place = () => {
      frame = 0;
      const element = doc.querySelector(SELECTED);
      const rect = element?.getBoundingClientRect();
      setAt((old) => {
        const next = rect ? { x: rect.right + 6, y: rect.top } : null;
        return old && next && old.x === next.x && old.y === next.y ? old : next;
      });
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    later();
    const unsubscribe = editor.subscribe(later);
    doc.addEventListener("scroll", later, true);
    doc.defaultView?.addEventListener("resize", later);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      unsubscribe();
      doc.removeEventListener("scroll", later, true);
      doc.defaultView?.removeEventListener("resize", later);
    };
  }, [editor, selected, disabled]);
  const item = { ...toolbarItems.layoutOptions, icon: toolbarIcons.wrapText };
  return (
    <div
      ref={box}
      className="foli-layout-options"
      style={{
        position: "fixed",
        left: at?.x ?? 0,
        top: at?.y ?? 0,
        display: at ? undefined : "none",
      }}
    >
      {at && (
        <FoliToolbar
          editor={editor}
          items={[[item]]}
          label="Layout Options"
          messages={messages}
          units={units}
        />
      )}
    </div>
  );
}
