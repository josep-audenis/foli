import {
  type Alignment,
  acceptAllChanges,
  acceptChange,
  addComment,
  alignAt,
  type Command,
  canOutdent,
  changeIndent,
  colorAt,
  deleteColumns,
  deleteRows,
  deleteTable,
  type Editor,
  type EditorState,
  fontFamilyAt,
  fontSizeAt,
  insertColumn,
  insertPageBreak,
  insertRow,
  insertTable,
  isHeaderRow,
  isSafeHref,
  lineSpacingAt,
  linkAt,
  listKindAt,
  mergeCells,
  nextChange,
  normalizeHref,
  openLinkEditor,
  paragraphStyleAt,
  paragraphStyles,
  previousChange,
  type ReviewView,
  redo,
  redoDepth,
  rejectAllChanges,
  rejectChange,
  removeLink,
  requestsLinkEditor,
  setAlign,
  setCellShading,
  setFontFamily,
  setFontSize,
  setHighlight,
  setLineSpacing,
  setLink,
  setParagraphStyle,
  setReviewView,
  setTableStyle,
  setTextColor,
  setTrackChanges,
  splitCell,
  tableStyleAt,
  tableStyles,
  toggleHeaderRow,
  toggleList,
  toggleMark,
  trackState,
  undo,
  undoDepth,
  wordContext,
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
  /**
   * Show "New comment": only where a comments pane (`FoliComments`) lets the comment be written
   * (`FoliEditor` passes it). Default false.
   */
  comments?: boolean | undefined;
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
   * Whether the command can run now (default: always; a paragraph takes every mark and a page
   * break). A cheap check, not a dry
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
  /** An action menu button (the table menu): its commands, in order. */
  actions?: readonly Action[];
  /** A drop-down list (a `select`): its options, the current value, and what picking runs. */
  select?: {
    options: (state: EditorState) => readonly { value: string; label: string }[];
    value: (state: EditorState) => string | null;
    pick: (value: string) => Command;
  };
}

/** A command in an action menu (a menuitem, or a menuitemcheckbox when it has `checked`). */
interface Action {
  key: string;
  label: string;
  /** The command it runs; `insertTable` opens the dialog that asks for the size instead. */
  command: Command;
  dialog?: "insertTable";
  checked?: (state: EditorState) => boolean;
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
/** Word's highlight colors (a document opened in Word shows these exactly). */
const HIGHLIGHTS: readonly ColorOption[] = [
  { name: "None", color: null },
  { name: "Yellow", color: "#ffff00" },
  { name: "Bright green", color: "#00ff00" },
  { name: "Turquoise", color: "#00ffff" },
  { name: "Pink", color: "#ff00ff" },
  { name: "Gray", color: "#c0c0c0" },
];

/** Cell shadings: light fills that keep text readable. */
const SHADINGS: readonly ColorOption[] = [
  { name: "None", color: null },
  { name: "Light gray", color: "#d9d9d9" },
  { name: "Light blue", color: "#deeaf6" },
  { name: "Light green", color: "#e2efd9" },
  { name: "Light yellow", color: "#fff2cc" },
  { name: "Light orange", color: "#fbe4d5" },
];

/** The cell around the selection's start, if any (cheap: the start's ancestors). */
function cellAt(state: EditorState) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--)
    if ($from.node(d).type.name === "tableCell") return $from.node(d);
  // A cell selection starts before its first cell.
  const after = $from.nodeAfter;
  return after?.type.name === "tableCell" ? after : null;
}
const inTable = (state: EditorState) => cellAt(state) !== null;

const TABLE_ACTIONS: readonly Action[] = [
  { key: "insertTable", label: "Insert table…", command: insertTable(1, 1), dialog: "insertTable" },
  { key: "rowAbove", label: "Insert row above", command: insertRow(-1) },
  { key: "rowBelow", label: "Insert row below", command: insertRow(1) },
  { key: "columnLeft", label: "Insert column left", command: insertColumn(-1) },
  { key: "columnRight", label: "Insert column right", command: insertColumn(1) },
  { key: "deleteRows", label: "Delete rows", command: deleteRows },
  { key: "deleteColumns", label: "Delete columns", command: deleteColumns },
  { key: "deleteTable", label: "Delete table", command: deleteTable },
  { key: "mergeCells", label: "Merge cells", command: mergeCells },
  { key: "splitCell", label: "Split cell", command: splitCell },
  {
    key: "headerRow",
    label: "Repeat as header row",
    command: toggleHeaderRow,
    checked: isHeaderRow,
  },
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

const mark = (key: string, label: string, text: string): Item => ({
  key,
  label,
  text,
  symbol: true,
  pressed: (_state, editor) => editor.isMarkActive(key),
  command: () => toggleMark(key),
});

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
const REVIEW_VIEWS = [
  { value: "markup", label: "All markup" },
  { value: "simple", label: "Simple markup" },
  { value: "final", label: "No markup" },
];

/** Word's controls. */
const GROUPS: Item[][] = [
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
    {
      key: "bulletList",
      label: "Bulleted list",
      text: "•",
      symbol: true,
      pressed: (state) => listKindAt(state) === "bulletList",
      enabled: hasTextblock,
      command: () => toggleList("bulletList"),
    },
    {
      key: "orderedList",
      label: "Numbered list",
      // A symbol, not "1.": visible text that is not part of the name fails WCAG 2.5.3.
      text: "№",
      symbol: true,
      pressed: (state) => listKindAt(state) === "orderedList",
      enabled: hasTextblock,
      command: () => toggleList("orderedList"),
    },
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
  [
    {
      key: "newComment",
      label: "New comment on the selection",
      text: "New comment",
      enabled: (state) => wordContext(state) !== null && hasTextblock(state),
      command: () => addComment(""),
    },
    {
      key: "trackChanges",
      label: "Track changes",
      text: "Track changes",
      pressed: (state) => trackState(state)?.on === true,
      enabled: (state) => trackState(state) !== null,
      command: (state) => setTrackChanges(!trackState(state)?.on),
    },
    {
      key: "reviewView",
      label: "Show changes as",
      text: "Show",
      enabled: (state) => trackState(state) !== null,
      select: {
        options: () => REVIEW_VIEWS,
        value: (state) => trackState(state)?.view ?? "markup",
        pick: (view) => setReviewView(view as ReviewView),
      },
    },
    // Enabled while tracking can be used: whether there is a change to go to or resolve would
    // walk the whole document after every transaction.
    {
      key: "previousChange",
      label: "Previous change",
      text: "Previous change",
      enabled: (state) => trackState(state) !== null,
      command: () => previousChange,
    },
    {
      key: "nextChange",
      label: "Next change",
      text: "Next change",
      enabled: (state) => trackState(state) !== null,
      command: () => nextChange,
    },
    {
      key: "acceptChange",
      label: "Accept the change here, or the changes selected",
      text: "Accept",
      enabled: (state) => trackState(state) !== null,
      command: () => acceptChange,
    },
    {
      key: "rejectChange",
      label: "Reject the change here, or the changes selected",
      text: "Reject",
      enabled: (state) => trackState(state) !== null,
      command: () => rejectChange,
    },
    {
      key: "acceptAll",
      label: "Accept all changes",
      text: "Accept all",
      enabled: (state) => trackState(state) !== null,
      command: () => acceptAllChanges(),
    },
    {
      key: "rejectAll",
      label: "Reject all changes",
      text: "Reject all",
      enabled: (state) => trackState(state) !== null,
      command: () => rejectAllChanges(),
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
      key: "table",
      label: "Table",
      text: "Table",
      enabled: (state) => wordContext(state) !== null && "table" in state.schema.nodes,
      actions: TABLE_ACTIONS,
    },
    {
      key: "tableStyle",
      label: "Table style",
      text: "Table style",
      enabled: inTable,
      select: {
        options: (state) => tableStyles(state).map((name) => ({ value: name, label: name })),
        value: (state) => (inTable(state) ? (tableStyleAt(state) ?? "") : null),
        pick: (name) => setTableStyle(name),
      },
    },
    {
      key: "cellShading",
      label: "Cell shading",
      text: "Shading",
      enabled: inTable,
      menu: {
        options: SHADINGS,
        value: (state) => {
          const fill = (cellAt(state)?.attrs.shading as { fill?: string } | null)?.fill;
          return fill && fill !== "auto" ? `#${fill.toLowerCase()}` : null;
        },
        pick: (color) => setCellShading(color ? color.slice(1).toUpperCase() : null),
      },
    },
  ],
  [{ key: "pageBreak", label: "Page break", text: "Page break", command: () => insertPageBreak }],
];

const ITEMS = GROUPS.flat();
/** Without "New comment": where no comments pane lets a comment be written. */
const GROUPS_NO_COMMENT = GROUPS.map((group) => group.filter((i) => i.key !== "newComment"));
const ITEMS_NO_COMMENT = GROUPS_NO_COMMENT.flat();

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
const selectStatesNoComment = statesOf(ITEMS_NO_COMMENT);

/**
 * Word's formatting controls for an editor: paragraph style, font and size boxes, marks, link (a
 * dialog, also on Mod-K in the document), text color and highlight menus, alignment and line
 * spacing, lists (bulleted, numbered, decrease and increase indent), undo, redo, page break.
 * One tab stop (arrow keys, Home and End move between buttons); toggles carry
 * `aria-pressed`; a button whose command cannot run now is `aria-disabled` (still focusable).
 * Clicks leave the focus and selection in the document.
 */
export function FoliToolbar({
  editor: given,
  disabled = false,
  onClickCommand,
  label = "Formatting",
  className,
  comments = false,
}: FoliToolbarProps) {
  const editor = useEditorOrContext(given, "FoliToolbar");
  const groups = comments ? GROUPS : GROUPS_NO_COMMENT;
  const items = comments ? ITEMS : ITEMS_NO_COMMENT;
  const states = useEditorState(comments ? selectStates : selectStatesNoComment, {
    editor,
    isEqual: sameStates,
  });
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | HTMLSelectElement | null)[]>([]);
  // Whether a select box was last used with the pointer (its pick then goes back to the document).
  const pointer = useRef(false);
  // The open menu (a menu button's key), if any.
  const [menu, setMenu] = useState<string | null>(null);
  useEffect(() => {
    if (disabled) setMenu(null);
  }, [disabled]);

  const run = (index: number, event: MouseEvent) => {
    const item = items[index];
    if (!item || disabled || !states[index]?.enabled) return;
    if (item.menu || item.actions) {
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
  // The insert table dialog (from the table menu): the focus goes back to the menu's button.
  const [tableDialog, setTableDialog] = useState<{ restore: HTMLElement | null } | null>(null);
  useEffect(() => {
    if (disabled) setTableDialog(null);
  }, [disabled]);

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
                    onMouseDown={() => {
                      pointer.current = true;
                    }}
                    onKeyDown={() => {
                      pointer.current = false;
                    }}
                    // shortcut: Up and Down on a closed box apply each value they pass (Chrome
                    // and Firefox on Windows), one undo step each; apply on Enter if it matters.
                    onChange={(event) => {
                      if (off) return;
                      editor.run(select.pick(event.target.value));
                      if (pointer.current) onClickCommand?.();
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
                  aria-haspopup={item.menu || item.actions ? "menu" : undefined}
                  aria-expanded={item.menu || item.actions ? menu === item.key : undefined}
                  aria-disabled={off || undefined}
                  tabIndex={i === active ? 0 : -1}
                  // Keep the focus (and the selection) in the document on click.
                  onMouseDown={(event) => event.preventDefault()}
                  onFocus={() => setActive(i)}
                  onClick={(event) => run(i, event)}
                  onKeyDown={(event) => {
                    // ArrowDown opens a menu (the WAI-ARIA menu button pattern).
                    if (!(item.menu || item.actions) || off || event.key !== "ArrowDown") return;
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
              if (item.actions) {
                const { actions } = item;
                return (
                  <span key={item.key} className="foli-toolbar-menu">
                    {button}
                    {menu === item.key && !disabled && (
                      <ActionMenu
                        label={item.label}
                        actions={actions}
                        state={editor.state}
                        onPick={(action, pointer) => {
                          setMenu(null);
                          if (action.dialog) {
                            setTableDialog({ restore: buttons.current[i] ?? null });
                            return;
                          }
                          editor.run(action.command);
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
              }
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
      {tableDialog && !disabled && (
        <InsertTableDialog
          editor={editor}
          onClose={(inserted) => {
            const { restore } = tableDialog;
            setTableDialog(null);
            if (inserted && onClickCommand) onClickCommand();
            else restore?.focus();
          }}
        />
      )}
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

/**
 * An action menu (WAI-ARIA menu: menuitems, a menuitemcheckbox for a toggle): the first item
 * focused on open; arrow keys, Home and End move; Enter or Space (or a click) runs an item;
 * Escape closes it back to its button, Tab closes it and moves on; leaving it closes it. An item
 * that cannot apply here is `aria-disabled` (still focusable, as in the toolbar).
 */
function ActionMenu({
  label,
  actions,
  state,
  onPick,
  onClose,
}: {
  label: string;
  actions: readonly Action[];
  state: EditorState;
  onPick: (action: Action, pointer: boolean) => void;
  onClose: (refocus: boolean) => void;
}) {
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  // Dry runs, once per opening (not after every transaction).
  const enabled = actions.map((action) => action.command(state));
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus once, on open.
  useEffect(() => {
    items.current[0]?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    const count = actions.length;
    const at = items.current.indexOf(event.target as HTMLButtonElement);
    const moves: Record<string, number> = {
      ArrowDown: (at + 1) % count,
      ArrowUp: (at - 1 + count) % count,
      Home: 0,
      End: count - 1,
    };
    const next = moves[event.key];
    event.stopPropagation();
    if (next !== undefined) {
      event.preventDefault();
      items.current[next]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose(true);
    } else if (event.key === "Tab") onClose(true);
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
      {actions.map((action, i) => {
        const props = {
          ref: (element: HTMLButtonElement | null) => {
            items.current[i] = element;
          },
          type: "button" as const,
          "aria-disabled": enabled[i] ? undefined : true,
          tabIndex: -1,
          className: "foli-menu-item",
          onMouseDown: (event: MouseEvent) => event.preventDefault(),
          onClick: (event: MouseEvent) => {
            if (enabled[i]) onPick(action, event.detail > 0);
          },
        };
        return action.checked ? (
          <button
            key={action.key}
            {...props}
            role="menuitemcheckbox"
            aria-checked={action.checked(state)}
          >
            {action.label}
          </button>
        ) : (
          <button key={action.key} {...props} role="menuitem">
            {action.label}
          </button>
        );
      })}
    </div>
  );
}

/** Word's limits for a new table. */
const MAX_TABLE_ROWS = 1000;
const MAX_TABLE_COLUMNS = 63;

/**
 * The insert table dialog: rows and columns (whole numbers within Word's limits; an invalid one
 * is marked and announced), Insert and Cancel; Escape cancels.
 */
function InsertTableDialog({
  editor,
  onClose,
}: {
  editor: Editor;
  /** `inserted`: a table was inserted (the focus may go to the document). */
  onClose: (inserted: boolean) => void;
}) {
  const [rows, setRows] = useState("2");
  const [columns, setColumns] = useState("3");
  const [invalid, setInvalid] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    first.current?.focus();
    first.current?.select();
  }, []);

  const parse = (value: string, max: number) => {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
  };
  const insert = (event: FormEvent) => {
    event.preventDefault();
    const r = parse(rows, MAX_TABLE_ROWS);
    const c = parse(columns, MAX_TABLE_COLUMNS);
    if (r !== null && c !== null && editor.run(insertTable(r, c))) onClose(true);
    else setInvalid(true);
  };
  const field = (
    name: string,
    value: string,
    set: (value: string) => void,
    max: number,
    ref?: typeof first,
  ) => (
    <>
      <label htmlFor={`${id}-${name}`}>{name}</label>
      <input
        ref={ref}
        id={`${id}-${name}`}
        type="number"
        min={1}
        max={max}
        step={1}
        value={value}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={(event) => {
          set(event.target.value);
          setInvalid(false);
        }}
      />
    </>
  );

  return (
    <div
      role="dialog"
      aria-label="Insert table"
      className="foli-link-dialog foli-table-dialog"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose(false);
      }}
    >
      <form onSubmit={insert} noValidate>
        {field("Rows", rows, setRows, MAX_TABLE_ROWS, first)}
        {field("Columns", columns, setColumns, MAX_TABLE_COLUMNS)}
        <button type="submit">Insert</button>
        <button type="button" onClick={() => onClose(false)}>
          Cancel
        </button>
        {invalid && (
          <p id={`${id}-error`} className="foli-link-error" role="alert">
            Enter from 1 to {MAX_TABLE_ROWS} rows and from 1 to {MAX_TABLE_COLUMNS} columns, with
            the caret in a paragraph.
          </p>
        )}
      </form>
    </div>
  );
}
