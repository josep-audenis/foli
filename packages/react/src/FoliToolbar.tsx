import {
  type Command,
  type Editor,
  type EditorState,
  insertPageBreak,
  liftListItem,
  linkAt,
  listTypeAt,
  openLinkEditor,
  redo,
  redoDepth,
  removeLink,
  requestsLinkEditor,
  setBlockType,
  setLink,
  sinkListItem,
  toggleList,
  toggleMark,
  undo,
  undoDepth,
  wrapInList,
} from "@folijs/core";
import {
  type FormEvent,
  Fragment,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useEditorOrContext, useEditorState } from "./editor.js";

export interface FoliToolbarProps {
  /** Default: the editor of the nearest `FoliEditorProvider`. */
  editor?: Editor | undefined;
  /**
   * Every button is disabled. Pass it whenever the canvas is `readOnly`: commands run through
   * the editor, which code may always change (`FoliEditor` does this for you).
   */
  disabled?: boolean | undefined;
  /**
   * Called after a click ran a command, to show its result in the document (`FoliEditor`
   * focuses its canvas). Keyboard activation keeps the focus in the toolbar.
   */
  onClickCommand?: (() => void) | undefined;
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
  /**
   * Whether the command can run now (default: always; in schema v1 every selection is in
   * textblocks, which take every mark, block type and page break). A cheap check, not a dry
   * run: it runs after every transaction, and a dry run builds the whole transaction (for a
   * block type over a large selection, quadratic in the number of blocks).
   */
  enabled?: (state: EditorState) => boolean;
  command: (state: EditorState) => Command;
}

/** Whether the selection holds textblocks and all of them are `type` with `level` (if given). */
function blockIs(state: EditorState, type: string, level?: number): boolean {
  const { from, to } = state.selection;
  let all = true;
  let any = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (!all) return false;
    if (node.isTextblock) {
      any = true;
      if (node.type.name !== type || (level && node.attrs.level !== level)) all = false;
    }
    return !node.isTextblock;
  });
  return any && all;
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
    {
      key: "link",
      label: "Link",
      text: "Link",
      pressed: (state) => linkAt(state) !== null,
      enabled: (state) => openLinkEditor(state),
      // Asks for the link dialog, as Mod-K does: the toolbar listens for that request.
      command: () => openLinkEditor,
    },
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
    {
      key: "bulletList",
      label: "Bulleted list",
      text: "•",
      symbol: true,
      pressed: (state) => listTypeAt(state)?.name === "bulletList",
      enabled: (state) => listTypeAt(state) !== null || wrapInList("bulletList")(state),
      command: () => toggleList("bulletList"),
    },
    {
      key: "orderedList",
      label: "Numbered list",
      // A symbol, not "1.": visible text that is not part of the name fails WCAG 2.5.3.
      text: "№",
      symbol: true,
      pressed: (state) => listTypeAt(state)?.name === "orderedList",
      enabled: (state) => listTypeAt(state) !== null || wrapInList("orderedList")(state),
      command: () => toggleList("orderedList"),
    },
    {
      key: "outdent",
      label: "Decrease indent",
      text: "⇤",
      symbol: true,
      enabled: (state) => listTypeAt(state) !== null,
      command: () => liftListItem(),
    },
    {
      key: "indent",
      label: "Increase indent",
      text: "⇥",
      symbol: true,
      enabled: (state) => canIndent(state),
      command: () => sinkListItem(),
    },
  ],
  [
    {
      key: "undo",
      label: "Undo",
      text: "Undo",
      enabled: (state) => undoDepth(state) > 0,
      command: () => undo,
    },
    {
      key: "redo",
      label: "Redo",
      text: "Redo",
      enabled: (state) => redoDepth(state) > 0,
      command: () => redo,
    },
  ],
  [{ key: "pageBreak", label: "Page break", text: "Page break", command: () => insertPageBreak }],
];
const ITEMS = GROUPS.flat();

/** Whether the selection starts in a list item that has an item before it (cheap: no dry run). */
function canIndent(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === "listItem") return $from.index(depth - 1) > 0;
  }
  return false;
}

interface ItemState {
  pressed: boolean | undefined;
  enabled: boolean;
}

const sameStates = (a: ItemState[], b: ItemState[]) =>
  a.length === b.length &&
  a.every((item, i) => item.pressed === b[i]?.pressed && item.enabled === b[i]?.enabled);

/** Runs after every transaction: O(selection), no transactions built. */
const selectStates = (state: EditorState, editor: Editor): ItemState[] =>
  ITEMS.map((item) => ({
    pressed: item.pressed?.(state, editor),
    enabled: item.enabled?.(state) ?? true,
  }));

/**
 * Formatting buttons for an editor: marks and link (a dialog, also on Mod-K in the document),
 * paragraph and heading levels, lists (bulleted,
 * numbered, decrease and increase indent), undo, redo, page break. One tab stop (arrow keys,
 * Home and End move between buttons); toggles carry
 * `aria-pressed`; a button whose command cannot run now is `aria-disabled` (still focusable).
 * Clicks leave the focus and selection in the document.
 */
export function FoliToolbar({
  editor: given,
  disabled = false,
  onClickCommand,
  label = "Formatting",
  className,
}: FoliToolbarProps) {
  const editor = useEditorOrContext(given, "FoliToolbar");
  const states = useEditorState(selectStates, { editor, isEqual: sameStates });
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const run = (index: number, event: MouseEvent) => {
    const item = ITEMS[index];
    if (!item || disabled || !states[index]?.enabled) return;
    editor.run(item.command(editor.state));
    // `detail` counts pointer clicks; Enter and Space on a button give 0.
    if (event.detail > 0) onClickCommand?.();
  };

  // The link dialog opens on a request from the link button or Mod-K in the document, and
  // gives the focus back to where it was (the document, or the button) when it closes.
  const [dialog, setDialog] = useState<{ href: string; restore: HTMLElement | null } | null>(null);
  useEffect(
    () =>
      editor.subscribe((state, transactions) => {
        if (disabled || !transactions.some(requestsLinkEditor)) return;
        const active = typeof document === "undefined" ? null : document.activeElement;
        setDialog(
          (current) =>
            current ?? {
              href: linkAt(state) ?? "",
              restore: active instanceof HTMLElement ? active : null,
            },
        );
      }),
    [editor, disabled],
  );
  const closeDialog = () => {
    dialog?.restore?.focus();
    setDialog(null);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // Alt+Left (back) and other shortcuts are the browser's.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
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
    <>
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
                  onClick={(event) => run(i, event)}
                >
                  {item.text}
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
      {dialog && !disabled && (
        <LinkDialog editor={editor} href={dialog.href} onClose={closeDialog} />
      )}
    </>
  );
}

/**
 * The link dialog: a URL field (prefilled with the link at the selection), Apply, Remove link
 * (for an existing link) and Cancel; Escape cancels. An unsafe or invalid URL is not applied:
 * the field is marked invalid and the message is announced.
 */
function LinkDialog({
  editor,
  href,
  onClose,
}: {
  editor: Editor;
  href: string;
  onClose: () => void;
}) {
  const [value, setValue] = useState(href);
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const apply = (event: FormEvent) => {
    event.preventDefault();
    if (editor.run(setLink(value))) onClose();
    else {
      setInvalid(true);
      input.current?.focus();
    }
  };
  const remove = () => {
    editor.run(removeLink);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-label={href ? "Edit link" : "Add link"}
      className="foli-link-dialog"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
    >
      <form onSubmit={apply} noValidate>
        <label htmlFor={`${id}-url`}>URL</label>
        <input
          ref={input}
          id={`${id}-url`}
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={value}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-error` : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            setInvalid(false);
          }}
        />
        <button type="submit">Apply</button>
        {href && (
          <button type="button" onClick={remove}>
            Remove link
          </button>
        )}
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        {invalid && (
          <p id={`${id}-error`} className="foli-link-error" role="alert">
            Enter a web or email address, or a link starting with http, https, mailto or tel.
          </p>
        )}
      </form>
    </div>
  );
}
