import {
  type Alignment,
  AllSelection,
  alignAt,
  type Command,
  canOutdent,
  changeIndent,
  colorAt,
  type Editor,
  type EditorDocument,
  type EditorState,
  fontFamilyAt,
  fontSizeAt,
  insertHorizontalRule,
  insertPageBreak,
  isSafeHref,
  liftListItem,
  lineSpacingAt,
  linkAt,
  listKindAt,
  NodeSelection,
  normalizeHref,
  openLinkEditor,
  paragraphStyleAt,
  paragraphStyles,
  redo,
  redoDepth,
  removeLink,
  requestsLinkEditor,
  setAlign,
  setBlockType,
  setFontFamily,
  setFontSize,
  setHighlight,
  setLineSpacing,
  setLink,
  setParagraphStyle,
  setTextColor,
  sinkListItem,
  toggleList,
  toggleMark,
  undo,
  undoDepth,
  wordContext,
  wrapInList,
} from "@folijs/core";
import {
  type FormEvent,
  Fragment,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useEditorOrContext, useEditorState } from "./editor.js";

export interface FoliToolbarProps {
  /**
   * Default: the editor of the nearest `FoliEditorProvider`. An editor of a schema v3 document
   * (Word's model) gets Word's controls: paragraph style, font, size, line spacing, Word's
   * highlight colors; no heading buttons or horizontal rule.
   */
  editor?: Editor<EditorDocument> | undefined;
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
  /** Shown instead of `text` (a symbol: the label is the name). */
  icon?: ReactNode;
  /** Whether the button shows as pressed (toggle buttons only). */
  pressed?: (state: EditorState, editor: Editor) => boolean;
  /**
   * Whether the command can run now (default: always; in schema v1 every selection is in
   * textblocks, which take every mark, block type and page break). A cheap check, not a dry
   * run: it runs after every transaction, and a dry run builds the whole transaction (for a
   * block type over a large selection, quadratic in the number of blocks).
   */
  enabled?: (state: EditorState) => boolean;
  /** The command a press runs (not for a menu button). */
  command?: (state: EditorState) => Command;
  /** A menu button: its options, the current value, and what picking one runs. */
  menu?: {
    options: readonly ColorOption[];
    value: (state: EditorState) => string | null;
    pick: (color: string | null) => Command;
  };
  /** A drop-down list (a `select`): its options, the current value, and what picking runs. */
  select?: {
    options: (state: EditorState) => readonly { value: string; label: string }[];
    value: (state: EditorState) => string | null;
    pick: (value: string) => Command;
  };
}

interface ColorOption {
  name: string;
  /** Lowercase `#rrggbb`; null removes the color. */
  color: string | null;
}

/**
 * The palettes (fixed: a document should not need a color picker). Text colors keep at least
 * 4.5:1 contrast on white; highlights keep dark text readable.
 */
const TEXT_COLORS: readonly ColorOption[] = [
  { name: "Automatic", color: null },
  { name: "Gray", color: "#5f6368" },
  { name: "Red", color: "#c00000" },
  { name: "Orange", color: "#b45309" },
  { name: "Green", color: "#2e7d32" },
  { name: "Blue", color: "#1f5fbf" },
  { name: "Purple", color: "#7030a0" },
];
const HIGHLIGHTS: readonly ColorOption[] = [
  { name: "None", color: null },
  { name: "Yellow", color: "#fff59d" },
  { name: "Green", color: "#c8e6c9" },
  { name: "Blue", color: "#bbdefb" },
  { name: "Pink", color: "#f8bbd0" },
  { name: "Orange", color: "#ffe0b2" },
  { name: "Gray", color: "#e0e0e0" },
];

/** Word's highlight colors (a document opened in Word shows these exactly). */
const WORD_HIGHLIGHTS: readonly ColorOption[] = [
  { name: "None", color: null },
  { name: "Yellow", color: "#ffff00" },
  { name: "Bright green", color: "#00ff00" },
  { name: "Turquoise", color: "#00ffff" },
  { name: "Pink", color: "#ff00ff" },
  { name: "Gray", color: "#c0c0c0" },
];

/** Whether the selection holds a textblock (a caret's own block first; else it walks the range). */
function hasTextblock(state: EditorState): boolean {
  if (state.selection.$from.parent.isTextblock) return true;
  let found = false;
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node) => {
    if (node.isTextblock) found = true;
    return !found;
  });
  return found;
}

/** Four bars, like the alignment they stand for (x and width per bar). */
const alignIcon = (bars: readonly [number, number][]) => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
    {bars.map(([x, width], i) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: a fixed drawing.
      <rect key={i} x={x} y={2.5 + i * 3.5} width={width} height="1.5" fill="currentColor" />
    ))}
  </svg>
);

const align = (value: Alignment, label: string, bars: readonly [number, number][]): Item => ({
  key: `align-${value}`,
  label,
  text: label,
  symbol: true,
  icon: alignIcon(bars),
  pressed: (state) => alignAt(state) === value,
  enabled: hasTextblock,
  command: () => setAlign(value),
});

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
    {
      key: "textColor",
      label: "Text color",
      text: "A",
      symbol: true,
      enabled: hasTextblock,
      menu: {
        options: TEXT_COLORS,
        value: (state) => colorAt(state, "textColor"),
        pick: setTextColor,
      },
    },
    {
      key: "highlight",
      label: "Highlight",
      text: "H",
      symbol: true,
      enabled: hasTextblock,
      menu: {
        options: HIGHLIGHTS,
        value: (state) => colorAt(state, "highlight"),
        pick: setHighlight,
      },
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
    align("start", "Align left", [
      [1, 14],
      [1, 9],
      [1, 14],
      [1, 9],
    ]),
    align("center", "Center", [
      [1, 14],
      [3.5, 9],
      [1, 14],
      [3.5, 9],
    ]),
    align("end", "Align right", [
      [1, 14],
      [6, 9],
      [1, 14],
      [6, 9],
    ]),
    align("justify", "Justify", [
      [1, 14],
      [1, 14],
      [1, 14],
      [1, 14],
    ]),
  ],
  [
    {
      key: "bulletList",
      label: "Bulleted list",
      text: "•",
      symbol: true,
      pressed: (state) => listKindAt(state) === "bulletList",
      enabled: (state) => listKindAt(state) !== null || wrapInList("bulletList")(state),
      command: () => toggleList("bulletList"),
    },
    {
      key: "orderedList",
      label: "Numbered list",
      // A symbol, not "1.": visible text that is not part of the name fails WCAG 2.5.3.
      text: "№",
      symbol: true,
      pressed: (state) => listKindAt(state) === "orderedList",
      enabled: (state) => listKindAt(state) !== null || wrapInList("orderedList")(state),
      command: () => toggleList("orderedList"),
    },
    {
      key: "outdent",
      label: "Decrease indent",
      text: "⇤",
      symbol: true,
      enabled: (state) => listKindAt(state) !== null,
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
  [
    {
      key: "horizontalRule",
      label: "Horizontal rule",
      text: "―",
      symbol: true,
      enabled: (state) =>
        state.selection.$from.parent.isTextblock ||
        state.selection instanceof AllSelection ||
        (state.selection instanceof NodeSelection && state.selection.node.isBlock),
      command: () => insertHorizontalRule,
    },
    { key: "pageBreak", label: "Page break", text: "Page break", command: () => insertPageBreak },
  ],
];
const capitalized = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

/** The fonts the font box offers (with the document's theme fonts, and the one shown now). */
const FONTS = [
  "Aptos",
  "Arial",
  "Calibri",
  "Cambria",
  "Courier New",
  "Georgia",
  "Times New Roman",
  "Verdana",
];
const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
const LINE_SPACINGS = [1, 1.15, 1.5, 2, 2.5, 3];

/** The toolbar for a schema v3 document: Word's controls. */
const WORD_GROUPS: Item[][] = [
  [
    {
      key: "style",
      label: "Paragraph style",
      text: "Style",
      enabled: hasTextblock,
      select: {
        options: (state) =>
          paragraphStyles(state).map((s) => ({ value: s.id, label: capitalized(s.name) })),
        value: paragraphStyleAt,
        pick: (id) => setParagraphStyle(id),
      },
    },
    {
      key: "font",
      label: "Font",
      text: "Font",
      enabled: hasTextblock,
      select: {
        options: (state) => {
          const theme = wordContext(state)?.envelope.theme?.fonts;
          const names = [theme?.minor.latin, theme?.major.latin, ...FONTS];
          return [...new Set(names.filter((n): n is string => !!n))]
            .sort((a, b) => a.localeCompare(b))
            .map((name) => ({ value: name, label: name }));
        },
        value: fontFamilyAt,
        pick: (name) => setFontFamily(name),
      },
    },
    {
      key: "size",
      label: "Font size",
      text: "Size",
      enabled: hasTextblock,
      select: {
        options: () => SIZES.map((size) => ({ value: String(size), label: String(size) })),
        value: (state) => {
          const size = fontSizeAt(state);
          return size === null ? null : String(size);
        },
        pick: (size) => setFontSize(Number(size)),
      },
    },
  ],
  (GROUPS[0] as Item[]).map((item) =>
    item.key === "highlight" && item.menu
      ? { ...item, menu: { ...item.menu, options: WORD_HIGHLIGHTS } }
      : item,
  ),
  [
    ...(GROUPS[2] as Item[]),
    {
      key: "lineSpacing",
      label: "Line spacing",
      text: "Line spacing",
      enabled: hasTextblock,
      select: {
        options: () =>
          LINE_SPACINGS.map((n) => ({ value: String(n), label: n.toFixed(n % 1 ? 2 : 1) })),
        value: (state) => {
          const spacing = lineSpacingAt(state);
          return spacing === null ? null : String(spacing);
        },
        pick: (n) => setLineSpacing(Number(n)),
      },
    },
  ],
  [
    ...(GROUPS[3] as Item[]).slice(0, 2),
    {
      key: "outdent",
      label: "Decrease indent",
      text: "⇤",
      symbol: true,
      enabled: canOutdent,
      command: () => changeIndent(-1),
    },
    {
      key: "indent",
      label: "Increase indent",
      text: "⇥",
      symbol: true,
      enabled: hasTextblock,
      command: () => changeIndent(1),
    },
  ],
  GROUPS[4] as Item[],
  (GROUPS[5] as Item[]).filter((item) => item.key !== "horizontalRule"),
];

const ITEMS = GROUPS.flat();
const WORD_ITEMS = WORD_GROUPS.flat();

/** Whether the selection starts in a list item that has an item before it (cheap: no dry run). */
function canIndent(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === "listItem") return $from.index(depth - 1) > 0;
  }
  return false;
}

interface LinkDialogState {
  /** The link at the selection when the dialog opened ("" for none). */
  href: string;
  selection: EditorState["selection"];
  /** Where the focus goes back to on close. */
  restore: HTMLElement | null;
  request: number;
}

interface ItemState {
  pressed: boolean | undefined;
  enabled: boolean;
  /** A menu button's current value (a color, or null). */
  value: string | null | undefined;
}

const sameStates = (a: ItemState[], b: ItemState[]) =>
  a.length === b.length &&
  a.every(
    (item, i) =>
      item.pressed === b[i]?.pressed &&
      item.enabled === b[i]?.enabled &&
      item.value === b[i]?.value,
  );

/** Runs after every transaction: O(selection), no transactions built. */
const statesOf =
  (items: readonly Item[]) =>
  (state: EditorState, editor: Editor): ItemState[] =>
    items.map((item) => ({
      pressed: item.pressed?.(state, editor),
      enabled: item.enabled?.(state) ?? true,
      value: item.menu?.value(state) ?? item.select?.value(state),
    }));
const selectStates = statesOf(ITEMS);
const selectWordStates = statesOf(WORD_ITEMS);

/**
 * Formatting buttons for an editor: marks, link (a dialog, also on Mod-K in the document), text
 * color and highlight menus, paragraph and heading levels, alignment, lists (bulleted,
 * numbered, decrease and increase indent), undo, redo, horizontal rule, page break. One tab stop (arrow keys,
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
  // shortcut: the hooks take a schema v2 editor's type; both editors have the same members
  // they use (8.7d makes v3 the only one).
  const editor = useEditorOrContext(given as Editor | undefined, "FoliToolbar");
  const word = useEditorState((state) => wordContext(state) !== null, { editor });
  const groups = word ? WORD_GROUPS : GROUPS;
  const items = word ? WORD_ITEMS : ITEMS;
  const states = useEditorState(word ? selectWordStates : selectStates, {
    editor,
    isEqual: sameStates,
  });
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | HTMLSelectElement | null)[]>([]);
  // The open menu (a menu button's key), if any.
  const [menu, setMenu] = useState<string | null>(null);
  useEffect(() => {
    if (disabled) setMenu(null);
  }, [disabled]);

  const run = (index: number, event: MouseEvent) => {
    const item = items[index];
    if (!item || disabled || !states[index]?.enabled) return;
    if (item.menu) {
      if (menu !== item.key) {
        setMenu(item.key);
        return;
      }
      // Closing by its button: the focus was in the menu, which goes away.
      setMenu(null);
      if (event.detail > 0 && onClickCommand) onClickCommand();
      else buttons.current[index]?.focus();
      return;
    }
    if (!item.command) return;
    editor.run(item.command(editor.state));
    // `detail` counts pointer clicks; Enter and Space on a button give 0.
    if (event.detail > 0) onClickCommand?.();
  };

  // The link dialog opens on a request from the link button or Mod-K in the document, and
  // gives the focus back to where it was (the document, or the button) when it closes. It is
  // for the selection it opened on: a change to the document or the selection (a click in the
  // document) closes it. A second request while it is open focuses it again.
  const [dialog, setDialog] = useState<LinkDialogState | null>(null);
  useEffect(
    () =>
      editor.subscribe((state, transactions) => {
        if (disabled) return;
        if (!transactions.some(requestsLinkEditor)) {
          setDialog((current) =>
            current &&
            (transactions.some((tr) => tr.docChanged) || !state.selection.eq(current.selection))
              ? null
              : current,
          );
          return;
        }
        const active = typeof document === "undefined" ? null : document.activeElement;
        setDialog((current) =>
          current
            ? { ...current, request: current.request + 1 }
            : {
                href: linkAt(state) ?? "",
                selection: state.selection,
                restore: active instanceof HTMLElement ? active : null,
                request: 0,
              },
        );
      }),
    [editor, disabled],
  );
  // A dialog never outlives a disabled toolbar (it would come back when enabled again).
  useEffect(() => {
    if (disabled) setDialog(null);
  }, [disabled]);
  const closeDialog = () => {
    dialog?.restore?.focus();
    setDialog(null);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // Alt+Left (back) and other shortcuts are the browser's.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const count = items.length;
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
        {groups.map((group, g) => (
          <Fragment key={group[0]?.key}>
            {g > 0 && <hr className="foli-toolbar-separator" aria-orientation="vertical" />}
            {group.map((item) => {
              const i = index++;
              const state = states[i];
              const off = disabled || !state?.enabled;
              if (item.select) {
                const { select } = item;
                const value = state?.value ?? "";
                const options = select.options(editor.state);
                return (
                  <select
                    key={item.key}
                    ref={(element) => {
                      buttons.current[i] = element;
                    }}
                    className={`foli-toolbar-select foli-toolbar-${item.key}`}
                    aria-label={item.label}
                    title={item.label}
                    // Still focusable when it cannot apply, like the buttons.
                    aria-disabled={off || undefined}
                    tabIndex={i === active ? 0 : -1}
                    value={value}
                    onFocus={() => setActive(i)}
                    onChange={(event) => {
                      if (!off) editor.run(select.pick(event.target.value));
                    }}
                  >
                    {/* Mixed (or nothing to show): a blank entry; a value not offered: itself. */}
                    {value === "" && <option value="" />}
                    {value !== "" && !options.some((o) => o.value === value) && (
                      <option value={value}>{value}</option>
                    )}
                    {options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                );
              }
              const button = (
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
                  aria-haspopup={item.menu ? "menu" : undefined}
                  aria-expanded={item.menu ? menu === item.key : undefined}
                  aria-disabled={off || undefined}
                  tabIndex={i === active ? 0 : -1}
                  // Keep the focus (and the selection) in the document on click.
                  onMouseDown={(event) => event.preventDefault()}
                  onFocus={() => setActive(i)}
                  onClick={(event) => run(i, event)}
                  onKeyDown={(event) => {
                    // ArrowDown opens a menu (the WAI-ARIA menu button pattern).
                    if (!item.menu || off || event.key !== "ArrowDown") return;
                    event.preventDefault();
                    setMenu(item.key);
                  }}
                >
                  {item.icon ?? item.text}
                  {item.menu && (
                    <span
                      className="foli-toolbar-swatch"
                      aria-hidden="true"
                      style={{ background: state?.value ?? "transparent" }}
                    />
                  )}
                </button>
              );
              const options = item.menu?.options;
              if (!options || !item.menu) return button;
              const { pick } = item.menu;
              return (
                <span key={item.key} className="foli-toolbar-menu">
                  {button}
                  {menu === item.key && !disabled && (
                    <ColorMenu
                      label={item.label}
                      options={options}
                      current={state?.value ?? null}
                      onPick={(color, pointer) => {
                        editor.run(pick(color));
                        setMenu(null);
                        if (pointer) onClickCommand?.();
                        else buttons.current[i]?.focus();
                      }}
                      onClose={(refocus) => {
                        setMenu(null);
                        if (refocus) buttons.current[i]?.focus();
                      }}
                    />
                  )}
                </span>
              );
            })}
          </Fragment>
        ))}
      </div>
      {dialog && !disabled && (
        <LinkDialog
          editor={editor}
          href={dialog.href}
          request={dialog.request}
          onClose={closeDialog}
        />
      )}
    </>
  );
}

/**
 * A color menu (WAI-ARIA menu with radio items): the current color checked and focused on
 * open; arrow keys, Home and End move; Enter or Space (or a click) picks; Escape closes it back
 * to its button, Tab closes it and moves on; leaving it (a click elsewhere) closes it.
 */
function ColorMenu({
  label,
  options,
  current,
  onPick,
  onClose,
}: {
  label: string;
  options: readonly ColorOption[];
  current: string | null;
  onPick: (color: string | null, pointer: boolean) => void;
  onClose: (refocus: boolean) => void;
}) {
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const checked = Math.max(
    0,
    options.findIndex((option) => option.color === current),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus once, on open.
  useEffect(() => {
    items.current[checked]?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    const count = options.length;
    const at = items.current.indexOf(event.target as HTMLButtonElement);
    const moves: Record<string, number> = {
      ArrowDown: (at + 1) % count,
      ArrowUp: (at - 1 + count) % count,
      Home: 0,
      End: count - 1,
    };
    const next = moves[event.key];
    // The toolbar's own arrow keys must not see these.
    event.stopPropagation();
    if (next !== undefined) {
      event.preventDefault();
      items.current[next]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose(true);
    } else if (event.key === "Tab") {
      // Back to the button, then the browser's Tab moves on from it (out of the toolbar).
      onClose(true);
    }
  };

  return (
    <div
      role="menu"
      aria-label={label}
      className="foli-menu"
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onClose(false);
      }}
    >
      {options.map((option, i) => (
        <button
          key={option.name}
          ref={(element) => {
            items.current[i] = element;
          }}
          type="button"
          role="menuitemradio"
          aria-checked={option.color === current}
          tabIndex={-1}
          className="foli-menu-item"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => onPick(option.color, event.detail > 0)}
        >
          <span
            className="foli-menu-swatch"
            aria-hidden="true"
            style={{ background: option.color ?? "transparent" }}
          />
          {option.name}
        </button>
      ))}
    </div>
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
  request,
  onClose,
}: {
  editor: Editor;
  href: string;
  /** Counts the open requests: each one focuses the field. */
  request: number;
  onClose: () => void;
}) {
  const [value, setValue] = useState(href);
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();

  // biome-ignore lint/correctness/useExhaustiveDependencies: each request focuses the field again.
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [request]);

  const apply = (event: FormEvent) => {
    event.preventDefault();
    // The same link again changes nothing (the command does not apply): that is not an error.
    const normalized = normalizeHref(value);
    const unchanged = isSafeHref(normalized) && linkAt(editor.state) === normalized;
    if (unchanged || editor.run(setLink(value))) onClose();
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
