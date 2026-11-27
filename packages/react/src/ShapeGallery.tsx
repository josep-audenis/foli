import { insertShape } from "@folijs/core";
import { SHAPE_GALLERY, shapePreview } from "@folijs/view";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import type { ToolbarCustomProps } from "./FoliToolbar.js";
import { toolbarIcons } from "./icons.js";
import { type ToolbarMessage, useT } from "./messages.js";

const SHAPES = SHAPE_GALLERY.flatMap((group) => group.shapes);
/** Icons per row in the menu (the arrow keys move by it up and down). */
const COLUMNS = 8;

/** A shape's icon: its geometry's outline in a 20 px square. */
function Icon({ geometry }: { geometry: string }) {
  return (
    <svg width="20" height="20" viewBox="-1 -1 22 22" aria-hidden="true" focusable="false">
      {shapePreview(geometry).map((path, i) => (
        <path
          // biome-ignore lint/suspicious/noArrayIndexKey: a geometry's paths have no other identity.
          key={i}
          d={path.d}
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        />
      ))}
    </svg>
  );
}

/**
 * Insert ▸ Shapes (34.3): a menu button opening Word's gallery, grouped as Word's (Lines,
 * Rectangles, Basic Shapes, Block Arrows…), each shape an icon named as Word names it. A click
 * starts drawing it on the pages (drag for its size, Shift for its proportions); chosen from the
 * keyboard, an inch square is inserted at the selection, selected. The arrow keys move in the
 * menu, Escape closes it.
 * @internal `toolbarItems.shapes` is how apps use it.
 */
export function ShapeGallery({ editor, disabled, tabIndex, ref, onFocus }: ToolbarCustomProps) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  // Open, a press anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const doc = menu.current?.ownerDocument ?? document;
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    doc.addEventListener("pointerdown", away, true);
    items.current[0]?.focus();
    return () => doc.removeEventListener("pointerdown", away, true);
  }, [open]);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const choose = (geometry: string, byKeyboard: boolean) => {
    setOpen(false);
    // The focus to the button before its menu goes: the ribbon then knows when it leaves.
    button.current?.focus();
    // The body's view draws it (a story's editor has none: a shape goes in the body).
    const view = editor.storyView;
    if (!byKeyboard && view?.drawShape?.(geometry)) return;
    editor.run(insertShape(geometry));
  };
  const onMenuKey = (event: KeyboardEvent) => {
    const at = items.current.indexOf(event.target as HTMLButtonElement);
    const last = SHAPES.length - 1;
    const to: Record<string, number> = {
      ArrowRight: Math.min(last, at + 1),
      ArrowLeft: Math.max(0, at - 1),
      ArrowDown: Math.min(last, at + COLUMNS),
      ArrowUp: Math.max(0, at - COLUMNS),
      Home: 0,
      End: last,
    };
    if (event.key in to) {
      event.preventDefault();
      event.stopPropagation();
      items.current[to[event.key] as number]?.focus();
    } else if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };
  let index = 0;
  return (
    <span className="foli-shape-gallery">
      <button
        ref={(element) => {
          ref(element);
          button.current = element;
        }}
        type="button"
        className="foli-toolbar-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-disabled={disabled || undefined}
        tabIndex={tabIndex}
        onFocus={onFocus}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (!disabled) setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !disabled) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="foli-toolbar-large-icon">{toolbarIcons.shapes}</span>
        <span>{t("Shapes" as ToolbarMessage)}</span>
      </button>
      {open && (
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label={t("Shapes" as ToolbarMessage)}
          className="foli-shape-gallery-menu"
          tabIndex={-1}
          onKeyDown={onMenuKey}
        >
          {SHAPE_GALLERY.map((group) => (
            // biome-ignore lint/a11y/useSemanticElements: a menu's group (ARIA), not a form's fieldset.
            <div key={group.name} role="group" aria-label={t(group.name as ToolbarMessage)}>
              <div className="foli-shape-gallery-heading" aria-hidden="true">
                {t(group.name as ToolbarMessage)}
              </div>
              <div className="foli-shape-gallery-row">
                {group.shapes.map((shape) => {
                  const i = index++;
                  return (
                    <button
                      key={shape.geometry}
                      ref={(element) => {
                        items.current[i] = element;
                      }}
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      aria-label={t(shape.name as ToolbarMessage)}
                      title={t(shape.name as ToolbarMessage)}
                      className="foli-shape-gallery-item"
                      data-geometry={shape.geometry}
                      onMouseDown={(event) => event.preventDefault()}
                      // A click's detail is 0 when Enter or Space made it.
                      onClick={(event) => choose(shape.geometry, event.detail === 0)}
                    >
                      <Icon geometry={shape.geometry} />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
