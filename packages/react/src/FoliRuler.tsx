import {
  type Command,
  type Editor,
  type RulerGeometry,
  setIndent,
  setSectionSetup,
} from "@folijs/core";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useActiveEditor, useEditorOrContext } from "./editor.js";
import { defaultUnit, formatLength, type LengthUnit } from "./units.js";

/** Every string the ruler shows or announces, in English; each is its own key in `messages`. */
export const rulerMessages = [
  "Horizontal ruler",
  "First line indent",
  "Hanging indent",
  "Left indent",
  "Right indent",
  "Left margin",
  "Right margin",
  "{position}, hanging {by}",
  "{position}, first line {by}",
] as const;

/** Translations of the ruler's strings, by their English text (`rulerMessages`). */
export type RulerMessages = Partial<Readonly<Record<(typeof rulerMessages)[number], string>>>;
type RulerMessage = (typeof rulerMessages)[number];

export interface FoliRulerProps {
  /** Default: the editor of the nearest `FoliEditorProvider`. */
  editor?: Editor | undefined;
  /** Inches or centimetres; by default the browser's language's (Word's rule, as the toolbar's). */
  units?: LengthUnit | undefined;
  /** The zoom the pages are drawn at: the ruler reads the pages again when it changes. */
  zoom?: number | undefined;
  /** Nothing can be dragged or changed (a read-only or comment-only editor). */
  disabled?: boolean | undefined;
  messages?: RulerMessages | undefined;
  className?: string | undefined;
}

/** Twips in a unit, and the ruler's ticks, snapping step and Page Up/Down step in it. */
const UNITS: Readonly<
  Record<LengthUnit, { twips: number; ticks: number; snap: number; page: number }>
> = {
  // Ticks every 1/8 inch; drags snap to 1/16 inch; Page Up and Page Down move half an inch.
  in: { twips: 1440, ticks: 8, snap: 90, page: 720 },
  // Ticks and snapping every 0.25 cm; Page Up and Page Down move a centimetre.
  cm: { twips: 1440 / 2.54, ticks: 4, snap: 1440 / 2.54 / 4, page: 1440 / 2.54 },
};

/** The narrowest text a handle leaves between itself and the one across from it (0.1 inch). */
const ROOM = 144;

/**
 * A handle on the ruler, as a slider: its value in twips is measured from `origin` (client px),
 * growing to the right (`sign` 1) or to the left (-1); `grid` is where the snapping grid starts.
 */
interface Handle {
  key: string;
  label: RulerMessage;
  /** Its class: `foli-ruler-<kind>`. */
  kind: string;
  origin: number;
  sign: 1 | -1;
  value: number;
  min: number;
  max: number;
  grid: number;
  set: (value: number) => Command;
  /** The hanging marker's: where the first line is (twips from the same origin), which it keeps. */
  firstLine?: number;
}

/** A handle being dragged: its value as the pointer has it, and whether Alt is held. */
interface Drag {
  key: string;
  pointer: number;
  value: number;
  alt: boolean;
  moved: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** The geometry, with the ruler's own left edge (client px) to place it against. */
interface Read {
  geometry: RulerGeometry | null;
  left: number;
}

/**
 * Re-reads the pages' geometry (`editor.storyView.rulerGeometry`) in the next frame after a
 * change, a scroll, a resize, the zoom or fonts loading, and until the first layout.
 */
function useGeometry(
  editor: Editor,
  active: Editor,
  root: React.RefObject<HTMLElement | null>,
  zoom: number,
) {
  const [read, setRead] = useState<Read>({ geometry: null, left: 0 });
  const measureNow = useCallback(
    () =>
      setRead({
        geometry: editor.storyView?.rulerGeometry?.() ?? null,
        left: root.current?.getBoundingClientRect().left ?? 0,
      }),
    [editor, root],
  );
  // The zoom is a dependency only to read again when it changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above.
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      measureNow();
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const unsubscribe = editor.subscribe(later);
    // An open story's selection moving does not reach the body's listeners.
    const unsubscribeActive = active === editor ? null : active.subscribe(later);
    // The first layout comes without a change: tried each frame until there are pages.
    let wait = 0;
    let tries = 0;
    const first = () => {
      measure();
      if (!editor.storyView?.rulerGeometry?.() && tries++ < 120)
        wait = requestAnimationFrame(first);
    };
    wait = requestAnimationFrame(first);
    document.addEventListener("scroll", later, true);
    window.addEventListener("resize", later);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(later);
    if (root.current) observer?.observe(root.current);
    void document.fonts?.ready.then(later);
    return () => {
      unsubscribe();
      unsubscribeActive?.();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(wait);
      document.removeEventListener("scroll", later, true);
      window.removeEventListener("resize", later);
      observer?.disconnect();
    };
  }, [editor, active, measureNow, root, zoom]);
  // Read again at once after the ruler's own change: the next key or drag starts from it.
  return { ...read, measureNow };
}

/** The indent and margin handles of the horizontal ruler. */
function horizontalHandles(g: RulerGeometry): Handle[] {
  const k = g.pxPerTwip;
  const twips = (px: number) => Math.round(px / k);
  const handles: Handle[] = [];
  const { page, margins, text, paragraph } = g;
  handles.push(
    {
      // Measured after the gutter, which the section keeps apart.
      key: "margin-left",
      label: "Left margin",
      kind: "margin",
      origin: page.left + g.gutter,
      sign: 1,
      value: twips(margins.left - page.left - g.gutter),
      min: 0,
      max: twips(margins.right - page.left - g.gutter) - ROOM,
      grid: page.left + g.gutter,
      set: (value) => setSectionSetup({ margins: { left: value } }),
    },
    {
      key: "margin-right",
      label: "Right margin",
      kind: "margin",
      origin: page.right,
      sign: -1,
      value: twips(page.right - margins.right),
      min: 0,
      max: twips(page.right - margins.left) - ROOM,
      grid: page.right,
      set: (value) => setSectionSetup({ margins: { right: value } }),
    },
  );
  if (!paragraph) return handles;
  const left = twips(paragraph.left - text.left);
  const special = twips(paragraph.firstLine - paragraph.left);
  const right = twips(text.right - paragraph.right);
  // Where the text may reach: the page's edges, and short of the indent across.
  const leftmost = twips(page.left - text.left);
  const rightmost = twips(paragraph.right - text.left) - ROOM;
  /** setIndent's special indent for a first line `value` twips from the left indent. */
  const specialOf = (value: number) =>
    value >= 0 ? { firstLine: value / 20 } : { hanging: -value / 20 };
  handles.push(
    {
      key: "first-line",
      label: "First line indent",
      kind: "first-line",
      origin: paragraph.left,
      sign: 1,
      value: special,
      min: leftmost - left,
      max: rightmost - left,
      grid: text.left,
      set: (value) => setIndent(specialOf(value)),
    },
    {
      // The hanging marker moves the left indent; the first line stays where it is.
      key: "hanging",
      label: "Hanging indent",
      kind: "hanging",
      origin: text.left,
      sign: 1,
      value: left,
      min: leftmost,
      max: rightmost,
      grid: text.left,
      set: (value) => setIndent({ left: value / 20, ...specialOf(left + special - value) }),
      firstLine: left + special,
    },
    {
      // The box under it moves both.
      key: "left",
      label: "Left indent",
      kind: "left",
      origin: text.left,
      sign: 1,
      value: left,
      min: Math.max(leftmost, leftmost - special),
      max: Math.min(rightmost, rightmost - special),
      grid: text.left,
      set: (value) => setIndent({ left: value / 20 }),
    },
    {
      key: "right",
      label: "Right indent",
      kind: "right",
      origin: text.right,
      sign: -1,
      value: right,
      min: twips(text.right - page.right),
      max: twips(text.right - Math.max(paragraph.left, paragraph.firstLine)) - ROOM,
      grid: text.left,
      set: (value) => setIndent({ right: value / 20 }),
    },
  );
  return handles;
}

/** The ticks and numbers between `from` and `to` (client px), counted from `zero`. */
function scale(zero: number, from: number, to: number, k: number, unit: LengthUnit) {
  const { twips, ticks } = UNITS[unit];
  const step = (twips / ticks) * k;
  const marks: { at: number; size: "number" | "half" | "tick"; label?: number }[] = [];
  if (!(step > 0)) return marks;
  const first = Math.ceil((from - zero) / step);
  const last = Math.floor((to - zero) / step);
  for (let i = first; i <= last; i++) {
    if (i === 0) continue;
    const at = zero + i * step;
    if (i % ticks === 0) marks.push({ at, size: "number", label: Math.abs(i / ticks) });
    else marks.push({ at, size: i % (ticks / 2) === 0 ? "half" : "tick" });
  }
  return marks;
}

/**
 * Word's horizontal ruler over the caret's page: its margins shaded, numbers in the unit from the
 * left margin, and the caret's paragraph's indents (first line, hanging, left, right) and the
 * page's margins as sliders, dragged (one change on release, one undo step; a drag snaps to the
 * ruler's step unless Alt is held, which shows the exact value; Escape cancels) or moved with the
 * arrow keys. Positions come from the view (`editor.storyView.rulerGeometry`): without one the
 * ruler is empty. Changes go to the story open on its page, else the editor.
 */
export function FoliRuler({
  editor: given,
  units,
  zoom = 1,
  disabled = false,
  messages,
  className,
}: FoliRulerProps) {
  const body = useEditorOrContext(given, "FoliRuler");
  const editor = useActiveEditor(body);
  const unit = units ?? defaultUnit();
  const t = (message: RulerMessage, values?: Record<string, string>) => {
    const text = messages?.[message] ?? message;
    return values ? text.replace(/\{(\w+)\}/g, (all, name: string) => values[name] ?? all) : text;
  };
  /** What a slider says of its value: the hanging marker also its special indent (Word's By). */
  const valueText = (handle: Handle, value: number) => {
    const position = formatLength(value, unit);
    if (handle.firstLine === undefined || handle.firstLine === value) return position;
    const by = formatLength(Math.abs(handle.firstLine - value), unit);
    return t(
      handle.firstLine < value ? "{position}, hanging {by}" : "{position}, first line {by}",
      {
        position,
        by,
      },
    );
  };
  const root = useRef<HTMLDivElement>(null);
  const { geometry, left: rootLeft, measureNow } = useGeometry(body, editor, root, zoom);
  const [drag, setDragState] = useState<Drag | null>(null);
  // Read by the pointer's events at once: they may come before a render.
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDragState(next);
  };
  const handles = geometry ? horizontalHandles(geometry) : [];
  const k = geometry?.pxPerTwip ?? 1;
  const local = (x: number) => x - rootLeft;
  const at = (handle: Handle, value: number) => handle.origin + handle.sign * value * k;

  /** The value the pointer at `x` gives `handle`: snapped to the ruler's grid unless `exact`. */
  const valueAt = (handle: Handle, x: number, exact: boolean) => {
    const step = UNITS[unit].snap * k;
    const snapped = exact ? x : handle.grid + Math.round((x - handle.grid) / step) * step;
    return clamp(Math.round((handle.sign * (snapped - handle.origin)) / k), handle.min, handle.max);
  };

  const apply = (handle: Handle, value: number) => {
    if (value !== handle.value && editor.run(handle.set(value))) measureNow();
  };

  const onPointerDown = (handle: Handle) => (event: ReactPointerEvent<HTMLElement>) => {
    // The document keeps the focus and its selection (also when nothing can change).
    event.preventDefault();
    if (disabled || event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({
      key: handle.key,
      pointer: event.pointerId,
      value: handle.value,
      alt: event.altKey,
      moved: false,
    });
  };
  const onPointerMove = (handle: Handle) => (event: ReactPointerEvent<HTMLElement>) => {
    const current = dragRef.current;
    if (!current || current.key !== handle.key || current.pointer !== event.pointerId) return;
    const value = valueAt(handle, event.clientX, event.altKey);
    setDrag({
      ...current,
      value,
      alt: event.altKey,
      moved: current.moved || value !== handle.value,
    });
  };
  const onPointerUp = (handle: Handle) => (event: ReactPointerEvent<HTMLElement>) => {
    const current = dragRef.current;
    if (!current || current.key !== handle.key || current.pointer !== event.pointerId) return;
    setDrag(null);
    if (current.moved) apply(handle, valueAt(handle, event.clientX, event.altKey));
  };
  const cancel = () => setDrag(null);
  // Escape cancels a drag.
  useEffect(() => {
    if (!drag) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dragRef.current = null;
      setDragState(null);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [drag]);

  const onKeyDown = (handle: Handle) => (event: ReactKeyboardEvent<HTMLElement>) => {
    if (disabled) return;
    const { snap, page } = UNITS[unit];
    // Left and Right move the handle the way they point (a right-side value grows to the left);
    // Up and Page Up make its value larger, Down and Page Down smaller, as a slider's.
    const moves: Record<string, number> = {
      ArrowRight: handle.sign * snap,
      ArrowLeft: -handle.sign * snap,
      ArrowUp: snap,
      ArrowDown: -snap,
      PageUp: page,
      PageDown: -page,
    };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    apply(handle, clamp(Math.round(handle.value + move), handle.min, handle.max));
  };

  const shown = (handle: Handle) =>
    drag?.key === handle.key ? drag.value : clamp(handle.value, handle.min, handle.max);
  const dragged = handles.find((h) => h.key === drag?.key);
  const number = (twips: number) => Math.round((twips / UNITS[unit].twips) * 100) / 100;
  const marks = geometry
    ? scale(geometry.margins.left, geometry.page.left, geometry.page.right, k, unit)
    : [];

  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset is for form controls, not a ruler.
    <div
      ref={root}
      role="group"
      aria-label={t("Horizontal ruler")}
      className={className ? `foli-ruler ${className}` : "foli-ruler"}
      data-foli-dragging={drag ? "" : undefined}
    >
      {geometry && (
        <>
          <div
            className="foli-ruler-page"
            aria-hidden="true"
            style={{
              left: local(geometry.page.left),
              width: geometry.page.right - geometry.page.left,
            }}
          >
            <div
              className="foli-ruler-text"
              style={{
                left: geometry.margins.left - geometry.page.left,
                width: Math.max(geometry.margins.right - geometry.margins.left, 0),
              }}
            />
            {marks.map((mark) => (
              <span
                key={mark.at}
                className={`foli-ruler-${mark.size}`}
                style={{ left: mark.at - geometry.page.left }}
              >
                {mark.label}
              </span>
            ))}
          </div>
          {handles.map((handle) => {
            const value = shown(handle);
            return (
              <div
                key={handle.key}
                role="slider"
                tabIndex={disabled ? -1 : 0}
                aria-label={t(handle.label)}
                aria-orientation="horizontal"
                aria-valuenow={number(value)}
                aria-valuemin={number(handle.min)}
                aria-valuemax={number(Math.max(handle.min, handle.max))}
                aria-valuetext={valueText(handle, value)}
                aria-disabled={disabled || undefined}
                className={`foli-ruler-handle foli-ruler-${handle.kind}`}
                data-foli-ruler={handle.key}
                style={{ left: local(at(handle, value)) }}
                // Pointer events' preventDefault does not keep the focus in every engine.
                onMouseDown={(event) => event.preventDefault()}
                onPointerDown={onPointerDown(handle)}
                onPointerMove={onPointerMove(handle)}
                onPointerUp={onPointerUp(handle)}
                onPointerCancel={cancel}
                onLostPointerCapture={cancel}
                onKeyDown={onKeyDown(handle)}
              />
            );
          })}
          {drag?.alt && dragged && (
            <span
              className="foli-ruler-value"
              aria-hidden="true"
              style={{ left: local(at(dragged, drag.value)) }}
            >
              {formatLength(drag.value, unit)}
            </span>
          )}
          {drag?.moved && dragged && (
            <div
              className="foli-ruler-guide"
              aria-hidden="true"
              style={{
                left: at(dragged, drag.value),
                top: geometry.page.top,
                height: geometry.page.bottom - geometry.page.top,
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
