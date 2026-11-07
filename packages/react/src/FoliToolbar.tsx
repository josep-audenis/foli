import {
  type Command,
  type Editor,
  type EditorState,
  insertPageBreak,
  redo,
  setBlockType,
  toggleMark,
  undo,
} from "@foli/core";
import { Fragment, type KeyboardEvent, useRef, useState } from "react";
import { useEditorOrContext, useEditorState } from "./editor.js";

export interface FoliToolbarProps {
  /** Default: the editor of the nearest `FoliEditorProvider`. */
  editor?: Editor | undefined;
  /** Every button is disabled (pair it with the canvas's `readOnly`). */
  disabled?: boolean | undefined;
  /** Accessible name of the toolbar (default "Formatting"). */
  label?: string | undefined;
  className?: string | undefined;
}

interface Item {
  key: string;
  /** Tooltip: what the button does. */
  label: string;
  /** Visible text: the accessible name, unless it is a symbol (then the label is). */
  text: string;
  symbol?: boolean;
  /** Whether the button shows as pressed (toggle buttons only). */
  pressed?: (state: EditorState, editor: Editor) => boolean;
  command: (state: EditorState) => Command;
}

/** Whether every textblock in the selection is `type` with `level` (if given). */
function blockIs(state: EditorState, type: string, level?: number): boolean {
  const { from, to } = state.selection;
  let all = true;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isTextblock && (node.type.name !== type || (level && node.attrs.level !== level)))
      all = false;
    return !node.isTextblock;
  });
  return all;
}

const mark = (key: string, label: string, text: string): Item => ({
  key,
  label,
  text,
  symbol: true,
  pressed: (_state, editor) => editor.isMarkActive(key),
  command: () => toggleMark(key),
});

const heading = (level: number): Item => ({
  key: `h${level}`,
  label: `Heading ${level}`,
  text: `H${level}`,
  pressed: (state) => blockIs(state, "heading", level),
  // Pressing an active heading turns it back into a paragraph.
  command: (state) =>
    blockIs(state, "heading", level)
      ? setBlockType("paragraph")
      : setBlockType("heading", { level }),
});

const GROUPS: Item[][] = [
  [
    mark("bold", "Bold", "B"),
    mark("italic", "Italic", "I"),
    mark("underline", "Underline", "U"),
    mark("strike", "Strikethrough", "S"),
  ],
  [
    {
      key: "paragraph",
      label: "Paragraph",
      text: "¶",
      symbol: true,
      pressed: (state) => blockIs(state, "paragraph"),
      command: () => setBlockType("paragraph"),
    },
    heading(1),
    heading(2),
    heading(3),
  ],
  [
    { key: "undo", label: "Undo", text: "Undo", command: () => undo },
    { key: "redo", label: "Redo", text: "Redo", command: () => redo },
  ],
  [{ key: "pageBreak", label: "Page break", text: "Page break", command: () => insertPageBreak }],
];
const ITEMS = GROUPS.flat();

interface ItemState {
  pressed: boolean | undefined;
  enabled: boolean;
}

const sameStates = (a: ItemState[], b: ItemState[]) =>
  a.length === b.length &&
  a.every((item, i) => item.pressed === b[i]?.pressed && item.enabled === b[i]?.enabled);

/**
 * Formatting buttons for an editor: marks, paragraph and heading levels, undo, redo, page
 * break. One tab stop (arrow keys, Home and End move between buttons); toggles carry
 * `aria-pressed`; a button whose command cannot run now is `aria-disabled` (still focusable).
 * Clicks leave the focus and selection in the document.
 */
export function FoliToolbar({
  editor: given,
  disabled = false,
  label = "Formatting",
  className,
}: FoliToolbarProps) {
  const editor = useEditorOrContext(given, "FoliToolbar");
  const states = useEditorState(
    (state, current) =>
      ITEMS.map((item) => {
        const pressed = item.pressed?.(state, current);
        // A pressed block type is a no-op, not a disabled button.
        return { pressed, enabled: Boolean(pressed) || current.can(item.command(state)) };
      }),
    { editor, isEqual: sameStates },
  );
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const run = (index: number) => {
    const item = ITEMS[index];
    if (!item || disabled || !states[index]?.enabled) return;
    editor.run(item.command(editor.state));
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const count = ITEMS.length;
    const moves: Record<string, number> = {
      ArrowRight: (active + 1) % count,
      ArrowLeft: (active - 1 + count) % count,
      Home: 0,
      End: count - 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
    buttons.current[next]?.focus();
  };

  let index = 0;
  return (
    <div
      role="toolbar"
      aria-label={label}
      className={className ? `foli-toolbar ${className}` : "foli-toolbar"}
      onKeyDown={onKeyDown}
    >
      {GROUPS.map((group, g) => (
        <Fragment key={group[0]?.key}>
          {g > 0 && <hr className="foli-toolbar-separator" aria-orientation="vertical" />}
          {group.map((item) => {
            const i = index++;
            const state = states[i];
            const off = disabled || !state?.enabled;
            return (
              <button
                key={item.key}
                ref={(element) => {
                  buttons.current[i] = element;
                }}
                type="button"
                className={`foli-toolbar-button foli-toolbar-${item.key}`}
                // Speech input users say what they see: "H1", "Undo"; symbols get a name.
                aria-label={item.symbol ? item.label : undefined}
                title={item.label}
                aria-pressed={item.pressed ? Boolean(state?.pressed) : undefined}
                aria-disabled={off || undefined}
                tabIndex={i === active ? 0 : -1}
                // Keep the focus (and the selection) in the document on click.
                onMouseDown={(event) => event.preventDefault()}
                onFocus={() => setActive(i)}
                onClick={() => run(i)}
              >
                {item.text}
              </button>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
