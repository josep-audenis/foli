import type { Editor } from "@folijs/core";
import { useEffect, useRef } from "react";
import { useActiveEditor, useIsomorphicLayoutEffect } from "./editor.js";
import { FoliToolbar, type ToolbarItem, toolbarItems } from "./FoliToolbar.js";
import { toolbarIcons } from "./icons.js";
import type { ToolbarMessages } from "./messages.js";
import type { LengthUnit } from "./units.js";

const t = toolbarItems;
/** With its icon, as the ribbon draws it. */
const drawn = (item: ToolbarItem): ToolbarItem =>
  item.select || item.render
    ? item
    : ({ ...item, icon: toolbarIcons[item.key] ?? item.icon } as ToolbarItem);

/**
 * Word's mini toolbar: font, size, grow and shrink, bold, italic, underline, text color,
 * highlight, styles and New comment. Change it with `FoliMiniToolbar`'s `items`.
 */
export const miniToolbarItems: readonly ToolbarItem[] = [
  t.font,
  t.size,
  t.growFont,
  t.shrinkFont,
  t.bold,
  t.italic,
  t.underline,
  t.textColor,
  t.highlight,
  t.style,
  t.newComment,
].map(drawn);

export interface FoliMiniToolbarProps {
  editor: Editor;
  /** Where the selection starts on the screen (viewport px): it shows above it. */
  at: { x: number; y: number };
  items?: readonly ToolbarItem[] | undefined;
  messages?: ToolbarMessages | undefined;
  /** The unit of the dialogs it opens (`FoliToolbarProps.units`; default: the locale's). */
  units?: LengthUnit | undefined;
  /** Only comments change: its formatting is off (as the toolbar's). */
  commentOnly?: boolean | undefined;
  /** It goes: a key is typed, Escape, or the pointer moves far from it. */
  onClose: () => void;
  /** After a pick with the pointer: the document takes the focus back. */
  onClickCommand?: (() => void) | undefined;
}

/** How far the pointer goes from it before it goes away, in px. */
const AWAY = 120;

/**
 * Word's mini toolbar beside a selection made with the pointer (`.foli-mini-toolbar`): faded
 * until the pointer comes near (`:hover`), gone when a key is pressed, the pointer moves far
 * away or the selection is gone. A `FoliToolbar` of its own (one row of `items`); it does not
 * take the focus, as Word's: the keyboard has the ribbon.
 */
export function FoliMiniToolbar({
  editor,
  at,
  items = miniToolbarItems,
  messages,
  units,
  commentOnly,
  onClose,
  onClickCommand,
}: FoliMiniToolbarProps) {
  const box = useRef<HTMLDivElement>(null);
  const active = useActiveEditor(editor);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const doc = box.current?.ownerDocument ?? document;
    const onKey = (event: KeyboardEvent) => {
      // Keys inside it (a box's arrows) are its own.
      if (!box.current?.contains(event.target as Node)) close.current();
    };
    const onMove = (event: MouseEvent) => {
      // On it or on a menu it opened (a color menu hangs below it).
      if (box.current?.contains(event.target as Node)) return;
      const rect = box.current?.getBoundingClientRect();
      if (!rect || event.buttons) return;
      const dx = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
      const dy = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
      if (Math.hypot(dx, dy) > AWAY) close.current();
    };
    // The selection is the open header's, footer's or note's when one is open.
    const unsubscribe = active.subscribe((state) => {
      if (state.selection.empty) close.current();
    });
    // Scrolling takes the selection away from where it shows, as in Word.
    const onScroll = (event: Event) => {
      if (!box.current?.contains(event.target as Node)) close.current();
    };
    doc.addEventListener("keydown", onKey, true);
    doc.addEventListener("mousemove", onMove);
    doc.addEventListener("scroll", onScroll, true);
    return () => {
      unsubscribe();
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("mousemove", onMove);
      doc.removeEventListener("scroll", onScroll, true);
    };
  }, [active]);
  // Above the selection, kept inside the window, before it is first painted.
  useIsomorphicLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const win = element.ownerDocument.defaultView ?? window;
    element.style.left = `${Math.max(4, Math.min(at.x, win.innerWidth - width - 4))}px`;
    element.style.top = `${at.y - height - 8 >= 4 ? at.y - height - 8 : at.y + 24}px`;
  }, [at]);
  return (
    <div
      ref={box}
      className="foli-mini-toolbar"
      style={{ position: "fixed", left: at.x, top: at.y }}
    >
      <FoliToolbar
        editor={editor}
        items={[items]}
        label="Mini toolbar"
        comments
        messages={messages}
        units={units}
        commentOnly={commentOnly}
        onClickCommand={onClickCommand}
      />
    </div>
  );
}
