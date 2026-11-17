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
  insertPicture,
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
  selectedPicture,
  setAlign,
  setCellShading,
  setFontFamily,
  setFontSize,
  setHighlight,
  setLineSpacing,
  setLink,
  setParagraphStyle,
  setPictureAlt,
  setPictureSize,
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
import { type EditorViewOptions, EMU_PER_PX, measureImageFile, textWidthEmu } from "@folijs/view";
import {
  type FormEvent,
  Fragment,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
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
  /**
   * Where an inserted picture's image file goes (`EditorViewOptions.upload`): with it, "Picture"
   * inserts one from a file; without it, it only edits a selected picture.
   */
  upload?: EditorViewOptions["upload"] | undefined;
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
  /** A button opening a dialog (the picture's). */
  dialog?: "picture";
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
/** Table and cell properties change only when not tracking (Foli does not record them yet). */
const canFormatTable = (state: EditorState) => inTable(state) && trackState(state)?.on !== true;

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
      enabled: canFormatTable,
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
      enabled: canFormatTable,
      menu: {
        options: SHADINGS,
        value: (state) => {
          const fill = (cellAt(state)?.attrs.shading as { fill?: string } | null)?.fill;
          return fill && fill.toLowerCase() !== "auto" ? `#${fill.toLowerCase()}` : null;
        },
        pick: (color) => setCellShading(color ? color.slice(1).toUpperCase() : null),
      },
    },
  ],
  [
    {
      key: "picture",
      label: "Insert a picture, or edit the selected one",
      text: "Picture…",
      enabled: (state) =>
        wordContext(state) !== null && (selectedPicture(state) !== null || hasTextblock(state)),
      // With a picture selected the dialog edits it.
      dialog: "picture",
    },
    { key: "pageBreak", label: "Page break", text: "Page break", command: () => insertPageBreak },
  ],
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
      value:
        item.menu?.value(state) ??
        item.select?.value(state) ??
        (item.dialog ? (selectedPicture(state) ? "edit" : "insert") : undefined),
    }));
const selectStates = statesOf(ITEMS);
const selectStatesNoComment = statesOf(ITEMS_NO_COMMENT);

/**
 * Word's formatting controls for an editor: paragraph style, font and size boxes, marks, link (a
 * dialog, also on Mod-K in the document), text color and highlight menus, alignment and line
 * spacing, lists (bulleted, numbered, decrease and increase indent), undo, redo, tables (a Table
 * menu with an insert table dialog, a table style box, a cell shading menu), page break.
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
  upload,
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
    if (item.dialog === "picture") {
      const selected = selectedPicture(editor.state);
      // Inserting needs the app's upload; editing a selected picture does not.
      if (!selected && !upload) return;
      setDialog(null);
      setTableDialog(null);
      setPictureDialog({
        pos: selected?.pos ?? null,
        selection: editor.state.selection,
        restore: buttons.current[index] ?? null,
      });
      return;
    }
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
          // The picture dialog too: what it edits or inserts at may have gone.
          setPictureDialog((current) =>
            current &&
            (transactions.some((tr) => tr.docChanged) || !state.selection.eq(current.selection))
              ? null
              : current,
          );
          // The insert table dialog is for the caret it opened on, as the link dialog is.
          setTableDialog((current) =>
            current &&
            (transactions.some((tr) => tr.docChanged) || !state.selection.eq(current.selection))
              ? null
              : current,
          );
          setDialog((current) =>
            current &&
            (transactions.some((tr) => tr.docChanged) || !state.selection.eq(current.selection))
              ? null
              : current,
          );
          return;
        }
        const active = typeof document === "undefined" ? null : document.activeElement;
        setTableDialog(null);
        setPictureDialog(null);
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
  const [tableDialog, setTableDialog] = useState<{
    restore: HTMLElement | null;
    selection: EditorState["selection"];
    request: number;
  } | null>(null);
  useEffect(() => {
    if (disabled) setTableDialog(null);
  }, [disabled]);
  // The picture dialog: inserts at (or edits the picture at `pos`) the selection it opened on.
  const [pictureDialog, setPictureDialog] = useState<{
    pos: number | null;
    selection: EditorState["selection"];
    restore: HTMLElement | null;
  } | null>(null);
  useEffect(() => {
    if (disabled) setPictureDialog(null);
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
              // Inserting a picture needs the app's upload; editing a selected one does not.
              const off =
                disabled ||
                !state?.enabled ||
                (item.dialog === "picture" && state?.value === "insert" && !upload);
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
                            setDialog(null);
                            setTableDialog((current) => ({
                              restore: buttons.current[i] ?? null,
                              selection: editor.state.selection,
                              request: (current?.request ?? -1) + 1,
                            }));
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
      {pictureDialog && !disabled && (
        <PictureDialog
          editor={editor}
          pos={pictureDialog.pos}
          upload={upload}
          onClose={(done) => {
            const { restore } = pictureDialog;
            setPictureDialog(null);
            if (done && onClickCommand) onClickCommand();
            else restore?.focus();
          }}
        />
      )}
      {tableDialog && !disabled && (
        <InsertTableDialog
          editor={editor}
          request={tableDialog.request}
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: the actions are a constant list.
  const enabled = useMemo(() => actions.map((action) => action.command(state)), [state]);
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
  request,
  onClose,
}: {
  editor: Editor;
  /** Counts the open requests: each one focuses the first field. */
  request: number;
  /** `inserted`: a table was inserted (the focus may go to the document). */
  onClose: (inserted: boolean) => void;
}) {
  const [rows, setRows] = useState("2");
  const [columns, setColumns] = useState("3");
  // What is wrong: a field out of range, or the place (the caret is not in a paragraph).
  const [error, setError] = useState<"rows" | "columns" | "place" | null>(null);
  const rowsField = useRef<HTMLInputElement>(null);
  const columnsField = useRef<HTMLInputElement>(null);
  const id = useId();
  // biome-ignore lint/correctness/useExhaustiveDependencies: each request focuses the field again.
  useEffect(() => {
    rowsField.current?.focus();
    rowsField.current?.select();
  }, [request]);

  const parse = (value: string, max: number) => {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
  };
  const insert = (event: FormEvent) => {
    event.preventDefault();
    const r = parse(rows, MAX_TABLE_ROWS);
    const c = parse(columns, MAX_TABLE_COLUMNS);
    const wrong = r === null ? "rows" : c === null ? "columns" : null;
    if (!wrong && editor.run(insertTable(r as number, c as number))) {
      onClose(true);
      return;
    }
    setError(wrong ?? "place");
    (wrong === "columns" ? columnsField : rowsField).current?.focus();
  };
  const messages = {
    rows: `Enter a number of rows from 1 to ${MAX_TABLE_ROWS}.`,
    columns: `Enter a number of columns from 1 to ${MAX_TABLE_COLUMNS}.`,
    place: "A table cannot be inserted here: put the caret in a paragraph.",
  };
  const field = (
    name: "rows" | "columns",
    label: string,
    value: string,
    set: (value: string) => void,
    max: number,
    ref: typeof rowsField,
  ) => (
    <>
      <label htmlFor={`${id}-${name}`}>{label}</label>
      <input
        ref={ref}
        id={`${id}-${name}`}
        type="number"
        min={1}
        max={max}
        step={1}
        value={value}
        aria-invalid={error === name || undefined}
        aria-describedby={error === name ? `${id}-error` : undefined}
        onChange={(event) => {
          set(event.target.value);
          setError(null);
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
        {field("rows", "Rows", rows, setRows, MAX_TABLE_ROWS, rowsField)}
        {field("columns", "Columns", columns, setColumns, MAX_TABLE_COLUMNS, columnsField)}
        <button type="submit">Insert</button>
        <button type="button" onClick={() => onClose(false)}>
          Cancel
        </button>
        {error && (
          <p id={`${id}-error`} className="foli-link-error" role="alert">
            {messages[error]}
          </p>
        )}
      </form>
    </div>
  );
}

/**
 * The picture dialog. Inserting (`pos` null): an image file, its alt text (required unless the
 * picture is marked decorative), Insert and Cancel; the file goes through `upload`, the picture
 * in at the file's natural size no wider than the page's text. Editing the picture at `pos`:
 * its alt text, decorative, and its width and height in px (proportions kept unless unchecked;
 * not while tracking changes), Apply and Cancel. Escape cancels; a field that is wrong is marked
 * and announced.
 */
function PictureDialog({
  editor,
  pos,
  upload,
  onClose,
}: {
  editor: Editor;
  pos: number | null;
  upload: EditorViewOptions["upload"] | undefined;
  /** `done`: a picture was inserted or changed (the focus may go to the document). */
  onClose: (done: boolean) => void;
}) {
  const picture = pos === null ? null : editor.state.doc.nodeAt(pos);
  const attrs = picture?.attrs ?? {};
  const px = (emu: unknown) => String(Math.round(Number(emu) / EMU_PER_PX));
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState(String(attrs.alt ?? ""));
  const [decorative, setDecorative] = useState(attrs.decorative === true);
  const [width, setWidth] = useState(picture ? px(attrs.width) : "");
  const [height, setHeight] = useState(picture ? px(attrs.height) : "");
  const [keep, setKeep] = useState(true);
  const [error, setError] = useState<"file" | "alt" | "size" | "failed" | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const id = useId();
  const tracking = trackState(editor.state)?.on === true;
  const ratio = picture ? Number(attrs.height) / Number(attrs.width) : 1;
  useEffect(() => {
    first.current?.focus();
  }, []);
  // A dialog closed while an upload runs: what the upload finds then is not inserted.
  const open = useRef(true);
  useEffect(
    () => () => {
      open.current = false;
    },
    [],
  );

  const messages = {
    file: "Choose an image file.",
    alt: "Describe the picture, or mark it as decorative.",
    size: "Enter a width and height in pixels, from 1.",
    failed: "The picture could not be inserted: the file could not be read or uploaded here.",
  };
  const invalid = (field: string) => (error === field ? true : undefined);
  const described = (field: string) => (error === field ? `${id}-error` : undefined);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!decorative && !alt.trim()) {
      setError("alt");
      return;
    }
    if (pos !== null && picture) {
      const w = Number(width);
      const h = Number(height);
      const sizeChanged = w !== Number(px(attrs.width)) || h !== Number(px(attrs.height));
      if (
        sizeChanged &&
        !tracking &&
        !(Number.isFinite(w) && Number.isFinite(h) && w >= 1 && h >= 1)
      ) {
        setError("size");
        return;
      }
      editor.run(setPictureAlt(pos, alt, decorative));
      if (sizeChanged && !tracking)
        editor.run(setPictureSize(pos, Math.round(w * EMU_PER_PX), Math.round(h * EMU_PER_PX)));
      onClose(true);
      return;
    }
    if (!file || !upload) {
      setError("file");
      return;
    }
    setBusy(true);
    try {
      const size = await measureImageFile(file, document);
      const answer = size ? await upload(file) : null;
      const src = typeof answer === "string" ? answer : answer?.src;
      if (!open.current) return;
      if (!size || !src) throw new Error("no image");
      const scale = Math.min(1, textWidthEmu(editor.state) / (size.width * EMU_PER_PX));
      const type = /^data:([^;,]+)/i.exec(src)?.[1]?.toLowerCase() ?? file.type;
      const done = editor.run(
        insertPicture({
          contentType: type,
          ...(src.startsWith("data:") ? { data: src } : { url: src }),
          width: Math.max(1, Math.round(size.width * EMU_PER_PX * scale)),
          height: Math.max(1, Math.round(size.height * EMU_PER_PX * scale)),
          ...(decorative ? { decorative: true } : { alt }),
        }),
      );
      if (!done) throw new Error("not inserted");
      onClose(true);
    } catch {
      if (!open.current) return;
      setBusy(false);
      setError("failed");
    }
  };

  const changeWidth = (value: string) => {
    setWidth(value);
    setError(null);
    if (keep && Number(value) > 0)
      setHeight(String(Math.max(1, Math.round(Number(value) * ratio))));
  };
  const changeHeight = (value: string) => {
    setHeight(value);
    setError(null);
    if (keep && Number(value) > 0) setWidth(String(Math.max(1, Math.round(Number(value) / ratio))));
  };

  return (
    <div
      role="dialog"
      aria-label={pos === null ? "Insert picture" : "Edit picture"}
      className="foli-link-dialog foli-picture-dialog"
      aria-busy={busy || undefined}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose(false);
      }}
    >
      <form onSubmit={submit} noValidate>
        {pos === null && (
          <>
            <label htmlFor={`${id}-file`}>Image</label>
            <input
              ref={first}
              id={`${id}-file`}
              type="file"
              accept="image/*"
              aria-invalid={invalid("file")}
              aria-describedby={described("file")}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setError(null);
              }}
            />
          </>
        )}
        <label htmlFor={`${id}-alt`}>Alt text</label>
        <input
          ref={pos === null ? undefined : first}
          id={`${id}-alt`}
          type="text"
          value={decorative ? "" : alt}
          disabled={decorative}
          aria-invalid={invalid("alt")}
          aria-describedby={described("alt")}
          onChange={(event) => {
            setAlt(event.target.value);
            setError(null);
          }}
        />
        <label>
          <input
            type="checkbox"
            checked={decorative}
            onChange={(event) => {
              setDecorative(event.target.checked);
              setError(null);
            }}
          />
          Decorative (no alt text)
        </label>
        {pos !== null && (
          <>
            <label htmlFor={`${id}-width`}>Width (px)</label>
            <input
              id={`${id}-width`}
              type="number"
              min={1}
              step={1}
              value={width}
              disabled={tracking}
              aria-invalid={invalid("size")}
              aria-describedby={described("size")}
              onChange={(event) => changeWidth(event.target.value)}
            />
            <label htmlFor={`${id}-height`}>Height (px)</label>
            <input
              id={`${id}-height`}
              type="number"
              min={1}
              step={1}
              value={height}
              disabled={tracking}
              aria-invalid={invalid("size")}
              aria-describedby={described("size")}
              onChange={(event) => changeHeight(event.target.value)}
            />
            <label>
              <input
                type="checkbox"
                checked={keep}
                disabled={tracking}
                onChange={(event) => setKeep(event.target.checked)}
              />
              Keep proportions
            </label>
            {tracking && <p>The size does not change while changes are tracked.</p>}
          </>
        )}
        <button type="submit" disabled={busy}>
          {pos === null ? "Insert" : "Apply"}
        </button>
        <button type="button" onClick={() => onClose(false)}>
          Cancel
        </button>
        {error && (
          <p id={`${id}-error`} className="foli-link-error" role="alert">
            {messages[error]}
          </p>
        )}
      </form>
    </div>
  );
}
