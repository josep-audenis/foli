import {
  type EditorState,
  paragraphStyleAt,
  paragraphStyles,
  setParagraphStyle,
} from "@folijs/core";
import { wordContext } from "@folijs/core/internal";
import { type CSSProperties, type KeyboardEvent, useEffect, useId, useState } from "react";
import { useEditorState } from "./editor.js";
import type { ToolbarCustomProps } from "./FoliToolbar.js";
import { type ToolbarMessage, useT } from "./messages.js";

/** One style as the gallery draws it: its name, in its own look. */
interface Look {
  id: string;
  name: string;
  /** Word's Quick Styles (`w:qFormat`), and the ones Foli adds: the gallery's first row. */
  quick: boolean;
  style: CSSProperties;
}

const capitalized = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

/** Looks by resolver: a new one comes with new styles, not with each keystroke. */
const cache = new WeakMap<object, Look[]>();

/** The document's paragraph styles, each in its font, size (capped), color, weight and slant. */
function looks(state: EditorState): Look[] {
  const context = wordContext(state);
  if (!context) return [];
  const known = cache.get(context.resolver);
  if (known) return known;
  const made = drawLooks(state, context);
  cache.set(context.resolver, made);
  return made;
}

function drawLooks(
  state: EditorState,
  context: NonNullable<ReturnType<typeof wordContext>>,
): Look[] {
  const own = new Map(context.envelope.styles.map((s) => [s.id, s]));
  return paragraphStyles(state).map(({ id, name }) => {
    const run = context.resolver.run(context.resolver.paragraph({ style: id }).run, []);
    const ext = own.get(id)?.ext;
    return {
      id,
      name: capitalized(name),
      quick: !ext || /<w:qFormat\b/.test(ext),
      style: {
        fontFamily: run.font.ascii ?? run.font.hAnsi ?? undefined,
        // Half points; a gallery tile shows 9 to 16 pt.
        fontSize: `${Math.min(16, Math.max(9, run.size / 2))}pt`,
        color: run.color ? `#${run.color}` : undefined,
        fontWeight: run.bold ? 700 : 400,
        fontStyle: run.italic ? "italic" : "normal",
        textDecoration: run.underline ? "underline" : undefined,
        textTransform: run.caps ? "uppercase" : undefined,
      },
    };
  });
}

const sameLooks = (a: Look[], b: Look[]) =>
  a.length === b.length && a.every((look, i) => JSON.stringify(look) === JSON.stringify(b[i]));

/**
 * Word's Styles gallery (29.10): a listbox of the paragraph styles, each drawn in its own look;
 * Up and Down (and Home, End) move through them, Enter and a click apply one, Alt+Down or the
 * arrow at its end shows them all. Left and Right stay the toolbar's.
 * @internal `toolbarItems.styleGallery` is how apps use it.
 */
export function StyleGallery({ editor, disabled, tabIndex, ref, onFocus }: ToolbarCustomProps) {
  const t = useT();
  const id = useId();
  const all = useEditorState(looks, { editor, isEqual: sameLooks });
  const current = useEditorState(paragraphStyleAt, { editor });
  const [open, setOpen] = useState(false);
  // The quick styles first; open, all of them.
  const shown = open ? all : [...all.filter((s) => s.quick), ...all.filter((s) => !s.quick)];
  const [active, setActive] = useState<string | null>(null);
  const at = shown.findIndex((s) => s.id === (active ?? current));
  // The active style stays in view (the gallery's row shows a few).
  useEffect(() => {
    if (at >= 0) document.getElementById(`${id}-${at}`)?.scrollIntoView?.({ block: "nearest" });
  }, [at, id]);
  const apply = (style: string) => {
    if (disabled) return;
    editor.run(setParagraphStyle(style));
    setOpen(false);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const moves: Record<string, number> = {
      ArrowDown: Math.min(shown.length - 1, at + 1),
      ArrowUp: Math.max(0, at - 1),
      Home: 0,
      End: shown.length - 1,
    };
    if (event.key === "ArrowDown" && event.altKey) {
      event.preventDefault();
      setOpen(true);
    } else if (event.key in moves) {
      event.preventDefault();
      event.stopPropagation();
      setActive(shown[moves[event.key] as number]?.id ?? null);
    } else if ((event.key === "Enter" || event.key === " ") && shown[at]) {
      event.preventDefault();
      apply((shown[at] as Look).id);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };
  return (
    <div className={`foli-style-gallery${open ? " foli-style-gallery-open" : ""}`}>
      <div
        ref={ref}
        role="listbox"
        aria-label={t("Styles" as ToolbarMessage)}
        aria-disabled={disabled || undefined}
        aria-activedescendant={at >= 0 ? `${id}-${at}` : undefined}
        tabIndex={tabIndex}
        className="foli-style-gallery-list"
        onFocus={onFocus}
        onBlur={() => {
          setActive(null);
          setOpen(false);
        }}
        onKeyDown={onKeyDown}
      >
        {shown.map((look, i) => (
          // biome-ignore lint/a11y/useFocusableInteractive: options of an aria-activedescendant listbox: the listbox has the focus.
          // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox's keys pick them (Enter, Space).
          <div
            key={look.id}
            id={`${id}-${i}`}
            role="option"
            aria-selected={look.id === current}
            className={`foli-style-gallery-item${i === at ? " foli-style-gallery-active" : ""}`}
            // The focus and the selection stay in the document.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => apply(look.id)}
          >
            <span style={look.style}>{look.name}</span>
          </div>
        ))}
      </div>
      <span
        aria-hidden="true"
        className="foli-style-gallery-more"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen(!open)}
      >
        ▾
      </span>
    </div>
  );
}
