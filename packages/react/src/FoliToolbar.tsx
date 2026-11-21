import {
  type Alignment,
  acceptAllChanges,
  acceptChange,
  addComment,
  addRepeatingItem,
  alignAt,
  type Command,
  type ControlJSON,
  canOutdent,
  changeIndent,
  colorAt,
  controlAt,
  controlProperties,
  convertNotes,
  crossReferenceTargets,
  deleteColumns,
  deleteRows,
  deleteTable,
  documentSections,
  type Editor,
  type EditorState,
  type FieldLayout,
  fieldCodesShown,
  fieldsIn,
  fontFamilyAt,
  fontSizeAt,
  insertColumn,
  insertColumnBreak,
  insertControl,
  insertCrossReference,
  insertDate,
  insertNote,
  insertPageBreak,
  insertPageNumber,
  insertPicture,
  insertRow,
  insertSectionBreak,
  insertTable,
  insertTableOfContents,
  isHeaderRow,
  isSafeHref,
  lineSpacingAt,
  linkAt,
  listKindAt,
  mergeCells,
  type NavigationRequest,
  type NoteKind,
  type NotePropertiesJSON,
  nextChange,
  normalizeHref,
  noteAtSelection,
  noteProperties,
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
  removeSectionBreak,
  requestsLinkEditor,
  type SectionJSON,
  type SectionSetup,
  type StorySide,
  sectionAt,
  selectedPicture,
  setAlign,
  setCellShading,
  setControlProperties,
  setDifferentEvenPages,
  setDifferentFirstPage,
  setFontFamily,
  setFontSize,
  setHighlight,
  setLineSpacing,
  setLink,
  setNoteProperties,
  setParagraphStyle,
  setPictureAlt,
  setPictureSize,
  setReviewView,
  setSectionSetup,
  setStoryLinked,
  setTableStyle,
  setTextColor,
  setTrackChanges,
  splitCell,
  tableStyleAt,
  tableStyles,
  toggleFieldCodes,
  toggleHeaderRow,
  toggleList,
  toggleMark,
  trackState,
  type UpdateFieldsOptions,
  undo,
  undoDepth,
  updateFields,
} from "@folijs/core";
import { wordContext } from "@folijs/core/internal";
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
import {
  development,
  sameItems,
  useActiveEditor,
  useEditorOrContext,
  useEditorState,
  useIsomorphicLayoutEffect,
} from "./editor.js";

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
  /**
   * The items, in groups (a separator between groups), in place of `defaultToolbarItems`: the
   * built-in ones from `toolbarItems`, and the app's own. "New comment" shows only with
   * `comments`; an empty group is left out.
   */
  items?: ToolbarGroups | undefined;
  /**
   * Tabs over the toolbar (a WAI-ARIA tab list with its own tab stop: arrow keys, Home and End
   * move between tabs and show each), each with its own groups of items, in place of `items`;
   * the first one shows at first. `defaultToolbarTabs` are Word's. Without tabs (or with none),
   * `items`. With tabs, `className` goes on the element around both (`.foli-ribbon`).
   */
  tabs?: readonly ToolbarTab[] | undefined;
  /**
   * The tab shown, by its key: with it the app decides (change it in `onTabChange`). A key that
   * is not among the tabs shown gives the first one.
   */
  tab?: string | undefined;
  /** The tab shown at first, while the app does not pass `tab` (default: the first one). */
  defaultTab?: string | undefined;
  /** Someone picked another tab (a click, or the arrow keys). */
  onTabChange?: ((key: string) => void) | undefined;
  /**
   * What happens to items that do not fit the toolbar's width: `"wrap"` (the default) puts
   * them on more rows; `"menu"` keeps one row and puts the groups that do not fit, whole, in a
   * panel under a "More" button at its end. The arrow keys go on into the panel (it opens) and
   * back; Escape closes it.
   */
  overflow?: "wrap" | "menu" | undefined;
  className?: string | undefined;
}

/**
 * A group of toolbar items with a caption: a `role="group"` named by `label`, shown under it.
 * It has no `key` (a tab has: that tells them apart in `FoliEditor`'s `toolbar`).
 */
export interface ToolbarGroup {
  readonly label: string;
  readonly items: readonly ToolbarItem[];
}

/** A toolbar's groups, a separator between them: arrays of items, or groups with a caption. */
export type ToolbarGroups = readonly (readonly ToolbarItem[] | ToolbarGroup)[];

/** A tab of the toolbar: its items show while it is the selected one. */
export interface ToolbarTab {
  /** Unique among the tabs. */
  readonly key: string;
  /** The tab's text. */
  readonly label: string;
  /** Its items, in groups (as `FoliToolbarProps.items`); a key is unique within its tab. */
  readonly items: ToolbarGroups;
  /**
   * A tab that comes and goes with the selection (Word's Table tab): shown while this says so
   * (`editor` is the header, footer or note open on its page, else the body's, as for an item's
   * `enabled`). Runs after every transaction: keep it cheap. It is not selected for the user
   * when it comes (unless it is the `tab` or `defaultTab`); when the selected tab goes, the
   * first one shows (no `onTabChange`).
   */
  readonly visible?: ((state: EditorState, editor: Editor) => boolean) | undefined;
}

/** What every toolbar item has. */
interface ToolbarItemBase {
  /** Unique in the toolbar (with tabs: in its tab); also its class, `foli-toolbar-<key>`. */
  readonly key: string;
  /** What it does: the tooltip, and the accessible name when an `icon` stands for the text. */
  readonly label: string;
  /** Visible text, which is then the accessible name (default `label`). */
  readonly text?: string | undefined;
  /** Shown instead of the text (a symbol or an SVG): `label` is then the accessible name. */
  readonly icon?: ReactNode | undefined;
  /**
   * Whether it can be used now. Default: a button's dry run of its `command` (`editor.can`); for
   * a menu, whether it has entries; any other kind, always (a box's `pick` is not dry-run).
   * Runs after every transaction: keep it cheap.
   */
  readonly enabled?: ((state: EditorState, editor: Editor) => boolean) | undefined;
}

/** A toolbar button that runs a command. */
export interface ToolbarButton extends ToolbarItemBase {
  /**
   * What a press runs, on the editor of the header, footer or note open on its page, else the
   * body's (as the built-in buttons do).
   */
  readonly command: Command;
  /** A toggle: whether it shows as pressed (`aria-pressed`). Runs after every transaction. */
  readonly pressed?: ((state: EditorState, editor: Editor) => boolean) | undefined;
  readonly actions?: undefined;
  readonly select?: undefined;
  readonly colors?: undefined;
  readonly dialog?: undefined;
  readonly render?: undefined;
}

/** A toolbar menu button: a WAI-ARIA menu of its `actions`. */
export interface ToolbarMenu extends ToolbarItemBase {
  /**
   * Its entries, in order, or a function of the body's editor making them (as the built-in
   * menus do). Each entry is dry-run when the menu opens; without entries the button is disabled.
   */
  readonly actions: readonly ToolbarAction[] | ((editor: Editor) => readonly ToolbarAction[]);
  readonly command?: undefined;
  readonly select?: undefined;
  readonly colors?: undefined;
  readonly dialog?: undefined;
  readonly render?: undefined;
  readonly pressed?: undefined;
}

/** An entry of a toolbar box. */
export interface ToolbarOption {
  /** What `pick` gets; unique in the box, and not "". */
  readonly value: string;
  readonly label: string;
}

/**
 * A toolbar box (a `select`), as the font box: Up and Down on a closed box apply each value
 * they pass. A built-in box with other entries is a copy:
 * `{ ...toolbarItems.size, select: { ...toolbarItems.size.select, options: () => mine } }`.
 */
export interface ToolbarSelect extends ToolbarItemBase {
  readonly select: {
    /** Its entries now. Runs after every transaction: keep it cheap. */
    readonly options: (state: EditorState) => readonly ToolbarOption[];
    /**
     * The entry shown: its `value`; null (or "") shows a blank entry (mixed, or nothing to
     * show), a value that is not among the options shows itself. Runs after every transaction.
     */
    readonly value: (state: EditorState) => string | null;
    /** What picking an entry runs. */
    readonly pick: (value: string) => Command;
  };
  readonly command?: undefined;
  readonly actions?: undefined;
  readonly colors?: undefined;
  readonly dialog?: undefined;
  readonly render?: undefined;
  readonly pressed?: undefined;
}

/** A color of a toolbar color menu. */
export interface ToolbarColor {
  /** Its name in the menu (the accessible name); unique in the menu. */
  readonly name: string;
  /** Lowercase `#rrggbb`; null is the entry that removes the color. */
  readonly color: string | null;
}

/**
 * A toolbar color menu button (a WAI-ARIA menu of `menuitemradio`s, the current color checked
 * and shown on the button), as the text color's. A built-in one with another palette is a copy:
 * `{ ...toolbarItems.textColor, colors: { ...toolbarItems.textColor.colors, options: mine } }`.
 */
export interface ToolbarColorMenu extends ToolbarItemBase {
  readonly colors: {
    readonly options: readonly ToolbarColor[];
    /** The color at the selection (null: none, or mixed). Runs after every transaction. */
    readonly value: (state: EditorState) => string | null;
    /** What picking a color runs (null: the entry that removes it). */
    readonly pick: (color: string | null) => Command;
    /**
     * A last entry, "More colors…", that opens the browser's color field: `pick` then gets any
     * `#rrggbb`. Default false: the palette only.
     */
    readonly custom?: boolean | undefined;
  };
  readonly command?: undefined;
  readonly actions?: undefined;
  readonly select?: undefined;
  readonly dialog?: undefined;
  readonly render?: undefined;
  readonly pressed?: undefined;
}

/**
 * The toolbar's own dialogs, for `ToolbarDialog.dialog`: `"link"` (as Mod-K), `"picture"`
 * (insert, or edit the selected one), `"insertTable"`, `"pageSetup"` (the caret's section),
 * `"crossReference"`, `"controlProperties"` (the content control at the caret), `"noteOptions"`.
 */
export type ToolbarDialogName =
  | "link"
  | "picture"
  | "insertTable"
  | "pageSetup"
  | "crossReference"
  | "controlProperties"
  | "noteOptions";

/** What an app's dialog gets. */
export interface ToolbarDialogProps {
  /** Where the toolbar's commands go: the header, footer or note open on its page, else the body. */
  readonly editor: Editor;
  /**
   * Closes the dialog. `applied`: it changed the document, so the focus goes there
   * (`onClickCommand`); otherwise back to the dialog's button.
   */
  readonly close: (applied?: boolean) => void;
}

/**
 * A toolbar button that opens the app's dialog under the toolbar, as Picture… does: a
 * `role="dialog"` named by `label` (classes `foli-toolbar-dialog` and
 * `foli-toolbar-<key>-dialog`). The focus goes to its first field or button; Escape closes it
 * back to its button; a disabled toolbar closes it.
 */
export interface ToolbarDialog extends ToolbarItemBase {
  /**
   * The dialog's content (rendered as a component's body: hooks are fine), or the name of one
   * of the toolbar's own dialogs, which the button then opens as its built-in item or menu
   * entry does. Such a button is enabled where that dialog applies, unless `enabled` says.
   */
  readonly dialog: ((props: ToolbarDialogProps) => ReactNode) | ToolbarDialogName;
  /** A toggle: whether the button shows as pressed. Runs after every transaction. */
  readonly pressed?: ((state: EditorState, editor: Editor) => boolean) | undefined;
  readonly command?: undefined;
  readonly actions?: undefined;
  readonly select?: undefined;
  readonly colors?: undefined;
  readonly render?: undefined;
}

/**
 * What an app's own control gets: `ref`, `tabIndex` and `onFocus` go on its focusable element
 * (a DOM element, or a component that passes them on: React 18 does not pass `ref` to a
 * function component).
 */
export interface ToolbarCustomProps {
  /** Where the toolbar's commands go: the header, footer or note open on its page, else the body. */
  readonly editor: Editor;
  /** The toolbar is disabled, or the item's `enabled` says no: stay focusable (`aria-disabled`). */
  readonly disabled: boolean;
  /** The toolbar has one tab stop: 0 on the item the arrow keys are on, else -1. */
  readonly tabIndex: 0 | -1;
  /** The element the toolbar's arrow keys focus. */
  readonly ref: (element: HTMLElement | null) => void;
  /** Moves the toolbar's tab stop here. */
  readonly onFocus: () => void;
}

/**
 * A toolbar item the app renders itself (a search field, a zoom slider, a button with a
 * popover). It must render one focusable element with the props' `ref`, `tabIndex` and
 * `onFocus`: without it the toolbar's tab stop can land on nothing. The control names itself
 * (`label` is not shown), shows `disabled` itself (`aria-disabled`) and decides what a click
 * does to the focus. The toolbar's ArrowLeft, ArrowRight, Home and End move between items: a
 * control that needs them stops their propagation. Enabled unless `enabled` says no.
 */
export interface ToolbarCustom extends ToolbarItemBase {
  /** The control. Rendered as a component's body: hooks (`useEditorState`) are fine. */
  readonly render: (props: ToolbarCustomProps) => ReactNode;
  readonly command?: undefined;
  readonly actions?: undefined;
  readonly select?: undefined;
  readonly colors?: undefined;
  readonly dialog?: undefined;
  readonly pressed?: undefined;
}

/**
 * A toolbar item, built-in (`toolbarItems`) or the app's own: a button running a command, a
 * menu button, a box, a color menu, a button opening a dialog, or the app's own control
 * (`ToolbarCustom`, which does for itself what follows). The
 * toolbar keeps one tab stop for all its items (arrow keys, Home and End move
 * between them), gives toggles `aria-pressed` and an item that cannot apply now `aria-disabled`
 * (still focusable), and leaves the focus and selection in the document on click.
 */
export type ToolbarItem =
  | ToolbarButton
  | ToolbarMenu
  | ToolbarSelect
  | ToolbarColorMenu
  | ToolbarDialog
  | ToolbarCustom;

/** An entry of a toolbar menu (a `menuitem`, or a `menuitemcheckbox` when it has `checked`). */
export interface ToolbarAction {
  /** Unique in its menu. */
  readonly key: string;
  readonly label: string;
  /** What it runs; a dry run when the menu opens decides whether it is enabled. */
  readonly command: Command;
  /** A checkable entry: whether it is checked (with the same arguments as `pressed`). */
  readonly checked?: ((state: EditorState, editor: Editor) => boolean) | undefined;
}

/**
 * Any item, as the toolbar reads it; the dialogs are only the built-in items'. Each of those has its own
 * cheap `enabled`, not a dry run: that runs after every transaction, and a dry run builds the
 * whole transaction (for a block type over a large selection, quadratic in the number of blocks).
 */
interface Item extends ToolbarItemBase {
  command?: Command | undefined;
  pressed?: ((state: EditorState, editor: Editor) => boolean) | undefined;
  colors?: ToolbarColorMenu["colors"] | undefined;
  /** An action menu button (the table menu): its commands, in order. */
  actions?: readonly Action[] | ((editor: Editor) => readonly Action[]) | undefined;
  /** A button opening a dialog: the picture's, or an app's. */
  dialog?: ToolbarDialog["dialog"] | undefined;
  render?: ToolbarCustom["render"] | undefined;
  select?: ToolbarSelect["select"] | undefined;
}

/** A built-in menu's entry: it may open a dialog or move the focus. */
interface Action extends ToolbarAction {
  /** With `dialog`, `command` says whether it applies: the dialog does the rest. */
  dialog?: Exclude<ToolbarDialogName, "link" | "picture">;
  /** It takes the focus where it belongs (into a story, or back to the body). */
  movesFocus?: boolean;
}

/**
 * The palettes (fixed: a document should not need a color picker). Text colors keep at least
 * 4.5:1 contrast on white; highlights keep dark text readable.
 */
const TEXT_COLORS: readonly ToolbarColor[] = [
  { name: "Automatic", color: null },
  { name: "Gray", color: "#5f6368" },
  { name: "Red", color: "#c00000" },
  { name: "Orange", color: "#b45309" },
  { name: "Green", color: "#2e7d32" },
  { name: "Blue", color: "#1f5fbf" },
  { name: "Purple", color: "#7030a0" },
];
/** Word's highlight colors (a document opened in Word shows these exactly). */
const HIGHLIGHTS: readonly ToolbarColor[] = [
  { name: "None", color: null },
  { name: "Yellow", color: "#ffff00" },
  { name: "Bright green", color: "#00ff00" },
  { name: "Turquoise", color: "#00ffff" },
  { name: "Pink", color: "#ff00ff" },
  { name: "Gray", color: "#c0c0c0" },
];

/** Cell shadings: light fills that keep text readable. */
const SHADINGS: readonly ToolbarColor[] = [
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

const SECTION_ACTIONS: readonly Action[] = [
  {
    key: "pageSetup",
    label: "Page setup…",
    command: (state) => sectionAt(state) !== null,
    dialog: "pageSetup",
  },
  { key: "breakNext", label: "Section break: next page", command: insertSectionBreak("nextPage") },
  {
    key: "breakContinuous",
    label: "Section break: continuous",
    command: insertSectionBreak("continuous"),
  },
  { key: "breakEven", label: "Section break: even page", command: insertSectionBreak("evenPage") },
  { key: "breakOdd", label: "Section break: odd page", command: insertSectionBreak("oddPage") },
  { key: "removeBreak", label: "Remove section break", command: removeSectionBreak },
  { key: "columnBreak", label: "Column break", command: insertColumnBreak },
];

/**
 * The header and footer menu: opening them on the caret's page, and, for the one open (else the
 * caret's section), what a section does about them.
 */
function storyActions(body: Editor): readonly Action[] {
  const open = () => body.storyView?.open ?? null;
  const setup = (state: EditorState) => {
    const index = open()?.section ?? sectionAt(state)?.index ?? 0;
    return documentSections(state)[index]?.setup ?? {};
  };
  const edit =
    (side: StorySide): Command =>
    (_state, dispatch) => {
      const view = body.storyView;
      if (!view) return false;
      if (dispatch) view.edit(side);
      return true;
    };
  const linked = (state: EditorState) => {
    const story = open();
    if (!story) return false;
    if (story.side === "note") return false;
    const references = story.side === "header" ? setup(state).headers : setup(state).footers;
    return !references?.[story.variant];
  };
  const evenPages = (state: EditorState) =>
    wordContext(state)?.envelope.settings?.evenAndOddHeaders === true;
  return [
    { key: "editHeader", label: "Edit header", command: edit("header"), movesFocus: true },
    { key: "editFooter", label: "Edit footer", command: edit("footer"), movesFocus: true },
    {
      key: "closeStory",
      label: "Close header and footer",
      movesFocus: true,
      command: (_state, dispatch) => {
        if (!open()) return false;
        if (dispatch) body.storyView?.close();
        return true;
      },
    },
    {
      key: "firstPage",
      label: "Different first page",
      checked: (state) => setup(state).titlePage === true,
      command: (state, dispatch) =>
        setDifferentFirstPage(setup(state).titlePage !== true, open()?.section)(state, dispatch),
    },
    {
      key: "evenPages",
      label: "Different odd and even pages",
      checked: evenPages,
      command: (state, dispatch) => setDifferentEvenPages(!evenPages(state))(state, dispatch),
    },
    {
      key: "linkPrevious",
      label: "Link to previous",
      checked: linked,
      command: (state, dispatch) => {
        const story = open();
        return story && story.side !== "note"
          ? setStoryLinked(
              story.side,
              story.variant,
              !linked(state),
              story.section,
            )(state, dispatch)
          : false;
      },
    },
  ];
}

/**
 * The notes menu: a new note (the caret goes into it), between a reference and its note, the
 * conversions Word has, and the options dialog.
 */
function noteActions(body: Editor): readonly Action[] {
  const insert =
    (kind: NoteKind): Command =>
    (state, dispatch) => {
      if (!insertNote(kind)(state)) return false;
      if (dispatch) {
        insertNote(kind)(state, dispatch);
        body.storyView?.editNote();
      }
      return true;
    };
  return [
    { key: "footnote", label: "Insert footnote", command: insert("footnote"), movesFocus: true },
    { key: "endnote", label: "Insert endnote", command: insert("endnote"), movesFocus: true },
    {
      key: "goToNote",
      label: "Go to note or reference",
      movesFocus: true,
      command: (state, dispatch) => {
        const view = body.storyView;
        if (!view) return false;
        if (view.open?.side === "note") {
          if (dispatch) view.toReference();
          return true;
        }
        if (!noteAtSelection(state)) return false;
        if (dispatch) view.editNote();
        return true;
      },
    },
    {
      key: "toEndnotes",
      label: "Convert footnotes to endnotes",
      command: (_state, dispatch) => convertNotes("endnote")(body.state, dispatch && body.dispatch),
    },
    {
      key: "toFootnotes",
      label: "Convert endnotes to footnotes",
      command: (_state, dispatch) =>
        convertNotes("footnote")(body.state, dispatch && body.dispatch),
    },
    {
      key: "noteOptions",
      label: "Note options…",
      dialog: "noteOptions",
      command: (state) => wordContext(state) !== null,
    },
  ];
}

/** The control the selection is in. */
const selectedControl = (state: EditorState) => {
  const range = controlAt(state.doc, state.selection.from);
  const control = range && controlProperties(state, range.id);
  return range && control ? { id: range.id, control } : null;
};

/** The content controls menu: each kind to insert, then what applies to the one at the caret. */
const CONTROL_ACTIONS: readonly Action[] = [
  { key: "richText", label: "Rich text", command: insertControl("richText") },
  { key: "plainText", label: "Plain text", command: insertControl("text") },
  { key: "dropDown", label: "Drop-down list", command: insertControl("dropDown") },
  { key: "comboBox", label: "Combo box", command: insertControl("comboBox") },
  { key: "datePicker", label: "Date picker", command: insertControl("date") },
  { key: "checkBox", label: "Check box", command: insertControl("checkbox") },
  { key: "pictureControl", label: "Picture (selected)", command: insertControl("picture") },
  { key: "repeating", label: "Repeating section", command: insertControl("repeating") },
  { key: "repeatingItem", label: "Add repeating item", command: addRepeatingItem() },
  {
    key: "controlProperties",
    label: "Control properties…",
    dialog: "controlProperties",
    command: (state) => selectedControl(state) !== null,
  },
];

/**
 * The navigation menu: what `FoliNavigation` shows, with Word's keys. Nothing applies without it.
 */
function navigationActions(body: Editor): readonly Action[] {
  const open =
    (request: NavigationRequest): Command =>
    (_state, dispatch) => {
      if (!body.navigation) return false;
      if (dispatch) body.navigation(request);
      return true;
    };
  const item = (key: NavigationRequest, label: string): Action => ({
    key,
    label,
    command: open(key),
    movesFocus: true,
  });
  return [
    item("find", "Find\u2026"),
    item("replace", "Replace\u2026"),
    item("goTo", "Go to\u2026"),
    item("bookmarks", "Bookmarks\u2026"),
    item("outline", "Outline"),
  ];
}

/**
 * The fields menu: what can be inserted at the selection, updating (the view's pages when there is
 * one) and the codes shown or hidden.
 */
function fieldActions(body: Editor): readonly Action[] {
  const layout = () => body.storyView?.fieldLayout ?? null;
  const active = () => {
    const open = body.storyView?.open;
    return (open && body.story(open.id)) || body;
  };
  const update = (editor: Editor, options: UpdateFieldsOptions) =>
    body.storyView ? body.storyView.updateFields(options, editor) : updateFields(editor, options);
  return [
    {
      key: "pageNumber",
      label: "Page number",
      command: (state, dispatch) => insertPageNumber({ layout: layout() })(state, dispatch),
    },
    { key: "date", label: "Date", command: insertDate() },
    {
      key: "crossReference",
      label: "Cross-reference…",
      dialog: "crossReference",
      command: (state) => {
        const { bookmarks, headings } = crossReferenceTargets(state);
        return insertPageBreak(state) && bookmarks.length + headings.length > 0;
      },
    },
    {
      key: "tableOfContents",
      label: "Table of contents",
      command: (state, dispatch) => {
        const done = insertTableOfContents({ layout: layout() })(state, dispatch);
        // Its own lines moved the headings: their page numbers follow, in the same undo step.
        if (done && dispatch)
          update(body, { only: (field) => field.parent?.name === "TOC", continues: true });
        return done;
      },
    },
    {
      key: "updateSelected",
      label: "Update selected fields",
      command: (state, dispatch) => {
        if (!fieldsIn(state.doc).length) return false;
        const { from, to } = state.selection;
        if (dispatch) update(active(), { only: { from, to } });
        return true;
      },
    },
    {
      key: "updateAll",
      label: "Update all fields",
      command: (_state, dispatch) => {
        if (dispatch) update(body, {});
        return true;
      },
    },
    {
      key: "fieldCodes",
      label: "Show field codes",
      checked: fieldCodesShown,
      command: toggleFieldCodes,
    },
  ];
}

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

/** A paragraph takes every mark and a page break: no need for a dry run after each change. */
const always = () => true;

const align = (value: Alignment, label: string, bars: readonly [number, number][]): Item => ({
  key: `align-${value}`,
  label,
  icon: alignIcon(bars),
  pressed: (state) => alignAt(state) === value,
  enabled: hasTextblock,
  command: setAlign(value),
});

const mark = (key: string, label: string, icon: string): Item => ({
  key,
  label,
  icon,
  pressed: (_state, editor) => editor.isMarkActive(key),
  enabled: always,
  command: toggleMark(key),
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
      command: openLinkEditor,
    },
    {
      key: "textColor",
      label: "Text color",
      icon: "A",
      enabled: hasTextblock,
      colors: {
        options: TEXT_COLORS,
        value: (state) => colorAt(state, "textColor"),
        pick: setTextColor,
      },
    },
    {
      key: "highlight",
      label: "Highlight",
      icon: "H",
      enabled: hasTextblock,
      colors: {
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
      icon: "•",
      pressed: (state) => listKindAt(state) === "bulletList",
      enabled: hasTextblock,
      command: toggleList("bulletList"),
    },
    {
      key: "orderedList",
      label: "Numbered list",
      // A symbol, not "1.": visible text that is not part of the name fails WCAG 2.5.3.
      icon: "№",
      pressed: (state) => listKindAt(state) === "orderedList",
      enabled: hasTextblock,
      command: toggleList("orderedList"),
    },
    {
      key: "outdent",
      label: "Decrease indent",
      icon: "⇤",
      enabled: canOutdent,
      command: changeIndent(-1),
    },
    {
      key: "indent",
      label: "Increase indent",
      icon: "⇥",
      enabled: hasTextblock,
      command: changeIndent(1),
    },
  ],
  [
    {
      key: "newComment",
      label: "New comment on the selection",
      text: "New comment",
      enabled: (state) => wordContext(state) !== null && hasTextblock(state),
      command: addComment(""),
    },
    {
      key: "trackChanges",
      label: "Track changes",
      text: "Track changes",
      pressed: (state) => trackState(state)?.on === true,
      enabled: (state) => trackState(state) !== null,
      command: (state, dispatch) => setTrackChanges(!trackState(state)?.on)(state, dispatch),
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
      command: previousChange,
    },
    {
      key: "nextChange",
      label: "Next change",
      text: "Next change",
      enabled: (state) => trackState(state) !== null,
      command: nextChange,
    },
    {
      key: "acceptChange",
      label: "Accept the change here, or the changes selected",
      text: "Accept",
      enabled: (state) => trackState(state) !== null,
      command: acceptChange,
    },
    {
      key: "rejectChange",
      label: "Reject the change here, or the changes selected",
      text: "Reject",
      enabled: (state) => trackState(state) !== null,
      command: rejectChange,
    },
    {
      key: "acceptAll",
      label: "Accept all changes",
      text: "Accept all",
      enabled: (state) => trackState(state) !== null,
      command: acceptAllChanges(),
    },
    {
      key: "rejectAll",
      label: "Reject all changes",
      text: "Reject all",
      enabled: (state) => trackState(state) !== null,
      command: rejectAllChanges(),
    },
  ],
  [
    {
      key: "undo",
      label: "Undo",
      text: "Undo",
      enabled: (state) => undoDepth(state) > 0,
      command: undo,
    },
    {
      key: "redo",
      label: "Redo",
      text: "Redo",
      enabled: (state) => redoDepth(state) > 0,
      command: redo,
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
      colors: {
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
    {
      key: "pageBreak",
      label: "Page break",
      text: "Page break",
      enabled: always,
      command: insertPageBreak,
    },
    {
      key: "section",
      label: "Section",
      text: "Section",
      enabled: (state) => wordContext(state) !== null,
      actions: SECTION_ACTIONS,
    },
    {
      key: "headerFooter",
      label: "Header and footer",
      text: "Header",
      enabled: (state) => wordContext(state) !== null,
      actions: storyActions,
    },
    {
      key: "fields",
      label: "Fields",
      text: "Fields",
      enabled: (state) => wordContext(state) !== null,
      actions: fieldActions,
    },
    {
      key: "navigate",
      label: "Find and go to",
      text: "Navigate",
      enabled: (state) => wordContext(state) !== null,
      actions: navigationActions,
    },
    {
      key: "notes",
      label: "Footnotes and endnotes",
      text: "Notes",
      enabled: (state) => wordContext(state) !== null,
      actions: noteActions,
    },
    {
      key: "controls",
      label: "Content controls",
      text: "Controls",
      enabled: (state) => wordContext(state) !== null,
      actions: CONTROL_ACTIONS,
    },
  ],
];

/** The names of the built-in items in `toolbarItems`. */
export type ToolbarItemName =
  | "style"
  | "font"
  | "size"
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "link"
  | "textColor"
  | "highlight"
  | "alignStart"
  | "alignCenter"
  | "alignEnd"
  | "alignJustify"
  | "lineSpacing"
  | "bulletList"
  | "orderedList"
  | "outdent"
  | "indent"
  | "newComment"
  | "trackChanges"
  | "reviewView"
  | "previousChange"
  | "nextChange"
  | "acceptChange"
  | "rejectChange"
  | "acceptAll"
  | "rejectAll"
  | "undo"
  | "redo"
  | "table"
  | "tableStyle"
  | "cellShading"
  | "picture"
  | "pageBreak"
  | "section"
  | "headerFooter"
  | "fields"
  | "navigate"
  | "notes"
  | "controls";

/** The built-in menu buttons of `actions`. */
type ToolbarMenuName =
  | "table"
  | "section"
  | "headerFooter"
  | "fields"
  | "navigate"
  | "notes"
  | "controls";
type ToolbarSelectName = "style" | "font" | "size" | "lineSpacing" | "reviewView" | "tableStyle";
type ToolbarColorName = "textColor" | "highlight" | "cellShading";

/**
 * The built-in items by name, to place in `FoliToolbarProps.items` (an item's `key` is its name,
 * except the alignments: `align-start`, `align-center`, `align-end`, `align-justify`). A copy
 * with another `label` or `icon` keeps what the built-in does.
 */
export const toolbarItems = Object.fromEntries(
  GROUPS.flat().map((item) => [item.key.replace(/-(\w)/, (_, c: string) => c.toUpperCase()), item]),
) as unknown as {
  readonly [Name in ToolbarItemName]: Name extends ToolbarMenuName
    ? ToolbarMenu
    : Name extends ToolbarSelectName
      ? ToolbarSelect
      : Name extends ToolbarColorName
        ? ToolbarColorMenu
        : ToolbarButton;
};

/** The default toolbar: groups of `toolbarItems`, a separator between groups. */
export const defaultToolbarItems = GROUPS as unknown as readonly (readonly ToolbarItem[])[];

/** A group's items, with or without a caption. */
const itemsOf = (group: ToolbarGroups[number]): readonly ToolbarItem[] =>
  Array.isArray(group) ? group : (group as ToolbarGroup).items;
const labelOf = (group: ToolbarGroups[number]): string | undefined =>
  Array.isArray(group) ? undefined : (group as ToolbarGroup).label;

/**
 * The built-in items in tabs, after Word's ribbon: Home, Insert, Layout, Review. For
 * `FoliToolbarProps.tabs` (or `FoliEditor`'s `toolbar`), whole or as a start for an app's own.
 */
export const defaultToolbarTabs: readonly (ToolbarTab & {
  /** Arrays only, no captioned groups: `tab.items.map((group) => group.filter(…))` works. */
  readonly items: readonly (readonly ToolbarItem[])[];
})[] = (() => {
  const t = toolbarItems;
  return [
    {
      key: "home",
      label: "Home",
      items: [
        [t.undo, t.redo],
        [t.style, t.font, t.size],
        [t.bold, t.italic, t.underline, t.strike, t.textColor, t.highlight],
        [t.alignStart, t.alignCenter, t.alignEnd, t.alignJustify, t.lineSpacing],
        [t.bulletList, t.orderedList, t.outdent, t.indent],
        [t.navigate],
      ],
    },
    {
      key: "insert",
      label: "Insert",
      items: [[t.table, t.picture, t.link], [t.pageBreak], [t.fields, t.notes, t.controls]],
    },
    {
      key: "layout",
      label: "Layout",
      items: [
        [t.section, t.headerFooter],
        [t.tableStyle, t.cellShading],
      ],
    },
    {
      key: "review",
      label: "Review",
      items: [
        [t.newComment],
        [t.trackChanges, t.reviewView],
        [t.previousChange, t.nextChange, t.acceptChange, t.rejectChange, t.acceptAll, t.rejectAll],
      ],
    },
  ];
})();

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
  /** A box's entries: the toolbar renders again when they change, not only with its value. */
  options: readonly ToolbarOption[] | undefined;
}

const sameOptions = (a: readonly ToolbarOption[] = [], b: readonly ToolbarOption[] = []) =>
  a.length === b.length &&
  a.every((option, i) => option.value === b[i]?.value && option.label === b[i]?.label);

const sameStates = (a: ItemState[], b: ItemState[]) =>
  a.length === b.length &&
  a.every(
    (item, i) =>
      item.pressed === b[i]?.pressed &&
      item.enabled === b[i]?.enabled &&
      item.value === b[i]?.value &&
      sameOptions(item.options, b[i]?.options),
  );

/** Where each built-in dialog applies (cheap: these run after every transaction). */
const DIALOG_APPLIES: Record<ToolbarDialogName, (state: EditorState) => boolean> = {
  link: (state) => openLinkEditor(state),
  picture: (state) =>
    wordContext(state) !== null && (selectedPicture(state) !== null || hasTextblock(state)),
  insertTable: (state) => wordContext(state) !== null && state.selection.$from.parent.isTextblock,
  // A Word document has a section everywhere.
  pageSetup: (state) => wordContext(state) !== null,
  // Whether there is something to refer to is asked when it opens (that reads the document).
  crossReference: (state) => wordContext(state) !== null && insertPageBreak(state),
  controlProperties: (state) => selectedControl(state) !== null,
  noteOptions: (state) => wordContext(state) !== null,
};

/**
 * Runs after every transaction: the built-ins' checks are O(selection), no transactions built;
 * an app's item without `enabled` gets a dry run of its command.
 */
const statesOf =
  (items: readonly Item[], body: Editor) =>
  (state: EditorState, editor: Editor): ItemState[] =>
    items.map((item) => ({
      pressed: item.pressed?.(state, editor),
      enabled: item.enabled
        ? item.enabled(state, editor)
        : typeof item.dialog === "string"
          ? DIALOG_APPLIES[item.dialog](state)
          : item.actions
            ? actionsOf(item, body).length > 0
            : !item.command || editor.can(item.command),
      value:
        item.colors?.value(state) ??
        item.select?.value(state) ??
        (item.dialog === "picture" ? (selectedPicture(state) ? "edit" : "insert") : undefined),
      options: item.select?.options(state),
    }));

/** A menu button's entries (made from the body's editor when a function). */
const actionsOf = (item: Item, body: Editor): readonly Action[] =>
  typeof item.actions === "function" ? item.actions(body) : (item.actions ?? []);

/** The same groups of the same items (an inline `items` array is not a change). */
const sameGroups = (a: ToolbarGroups | undefined, b: ToolbarGroups | undefined) =>
  a === b ||
  (!!a &&
    !!b &&
    a.length === b.length &&
    a.every((group, i) => {
      const other = b[i] as ToolbarGroups[number];
      return labelOf(group) === labelOf(other) && sameItems(itemsOf(group), itemsOf(other));
    }));

/**
 * Word's formatting controls for an editor (`defaultToolbarItems`, or `items`): paragraph
 * style, font and size boxes, marks, link (a dialog, also on Mod-K in the document), text color
 * and highlight menus, alignment and line spacing, lists (bulleted, numbered, decrease and
 * increase indent), undo, redo, tables (a Table menu with an insert table dialog, a table style
 * box, a cell shading menu), page break.
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
  items: givenGroups,
  tabs: allTabs,
  tab: givenTab,
  defaultTab,
  onTabChange,
  overflow = "wrap",
}: FoliToolbarProps) {
  const id = useId();
  const body = useEditorOrContext(given, "FoliToolbar");
  // A story open on its page takes the formatting commands; the body otherwise.
  const editor = useActiveEditor(body);
  // The tabs shown now (a tab with `visible` comes and goes with the selection), as their keys.
  const shownKeys = useEditorState(
    (state, active) =>
      (allTabs ?? []).filter((t) => !t.visible || t.visible(state, active)).map((t) => t.key),
    { editor, isEqual: sameItems },
  );
  const shownTabs = new Set(shownKeys);
  const tabs = allTabs?.filter((t) => shownTabs.has(t.key));
  // The tab shown: the app's, else the one picked while it is still there, else the first.
  const [tabKey, setTabKey] = useState(defaultTab ?? null);
  const wanted = givenTab ?? tabKey;
  const tab = tabs?.find((t) => t.key === wanted) ?? tabs?.[0];
  const itemGroups = tab ? tab.items : givenGroups;
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  // Without "New comment" where no comments pane lets a comment be written.
  const lastGroups = useRef(itemGroups);
  if (!sameGroups(lastGroups.current, itemGroups)) lastGroups.current = itemGroups;
  const stableGroups = lastGroups.current;
  const { groups, items, selectStates } = useMemo(() => {
    const groups = ((stableGroups ?? GROUPS) as ToolbarGroups)
      .map((group) => ({
        label: labelOf(group),
        items: (itemsOf(group) as readonly Item[]).filter(
          (item) => comments || item.key !== "newComment",
        ),
      }))
      .filter((group) => group.items.length > 0);
    const items = groups.flatMap((group) => group.items);
    if (development()) {
      const keys = items.map((item) => item.key);
      const twice = keys.find((key, i) => keys.indexOf(key) !== i);
      if (twice !== undefined)
        console.warn(`FoliToolbar: two items have the key "${twice}"; each needs its own`);
    }
    return { groups, items, selectStates: statesOf(items, body) };
  }, [stableGroups, comments, body]);
  const states = useEditorState(selectStates, { editor, isEqual: sameStates });
  const [focused, setActive] = useState(0);
  const buttons = useRef<(HTMLElement | null)[]>([]);
  // `overflow="menu"`: how many groups fit the row (null: not known yet, or `"wrap"`); the rest
  // are in the More panel. Measured with every group in the row, again when the width changes.
  const overflowing = overflow === "menu";
  const bar = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const morePanel = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<number | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const rowGroups = overflowing && fit !== null ? Math.min(fit, groups.length) : groups.length;
  /** The first item in the More panel (the number of items when all are in the row). */
  const firstInMore = groups.slice(0, rowGroups).reduce((n, group) => n + group.items.length, 0);
  /** Where each group ended with all of them in the row, and what More takes. */
  const measured = useRef<{ ends: number[]; more: number } | null>(null);
  /** The toolbar's inner width, and how many groups it takes. */
  const fitNow = (element: HTMLElement) => {
    const sizes = measured.current;
    if (!sizes) return null;
    const style = getComputedStyle(element);
    const room =
      element.getBoundingClientRect().width -
      (Number.parseFloat(style.paddingInlineStart) || 0) -
      (Number.parseFloat(style.paddingInlineEnd) || 0);
    if ((sizes.ends.at(-1) ?? 0) <= room + 0.5) return sizes.ends.length;
    const past = sizes.ends.findIndex((edge) => edge > room - sizes.more + 0.5);
    return past < 0 ? sizes.ends.length : past;
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: measured again when the groups change.
  useIsomorphicLayoutEffect(() => {
    if (!overflowing) return;
    measured.current = null;
    setFit(null);
  }, [overflowing, groups]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `fitNow` reads what this effect measures.
  useIsomorphicLayoutEffect(() => {
    const element = bar.current;
    if (!overflowing || fit !== null || !element) return;
    // Every group is in the row now: where each ends, from where the row starts.
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const start = Number.parseFloat(style.paddingInlineStart) || 0;
    const rtl = style.direction === "rtl";
    let at = 0;
    let edge = 0;
    const ends = groups.map((group) => {
      at += group.items.length;
      // The group's last item that has an element (an app's control may give none: the group
      // then ends where the one before it does). A captioned group is as wide as its caption.
      for (let i = at - 1; i >= at - group.items.length; i--) {
        const item = buttons.current[i];
        if (!item) continue;
        const rect = (
          item.closest<HTMLElement>(".foli-toolbar-group") ?? item
        ).getBoundingClientRect();
        edge = Math.max(edge, rtl ? box.right - start - rect.left : rect.right - box.left - start);
        break;
      }
      return edge;
    });
    measured.current = {
      ends,
      more: (moreButton.current?.getBoundingClientRect().width ?? 0) + 4,
    };
    setFit(fitNow(element));
  }, [overflowing, fit, groups]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `fitNow` reads refs only.
  useEffect(() => {
    const element = bar.current;
    if (!overflowing || !element || typeof ResizeObserver === "undefined") return;
    // Another width: the groups are counted again from what was measured (they stay where
    // they are, with their state and the focus, unless they change sides).
    const observer = new ResizeObserver(() => {
      const next = fitNow(element);
      if (next !== null) setFit((current) => (current === null ? current : next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [overflowing]);
  const inMore = overflowing && firstInMore < items.length;
  // The panel closes with a press outside it (a click in it keeps the document's focus, so
  // there is no blur to hear), and when nothing is in it any more.
  useEffect(() => {
    if (!moreOpen) return;
    if (!inMore) {
      setMoreOpen(false);
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (morePanel.current?.contains(target) || moreButton.current?.contains(target)) return;
      // What is open or focused in it goes with it: its menu, and the focus (to More).
      if (morePanel.current?.contains(document.activeElement)) moreButton.current?.focus();
      setMenu(null);
      setMoreOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [moreOpen, inMore]);
  // An item in the panel that the arrow keys moved to before the panel was open.
  const focusNext = useRef<number | null>(null);
  useEffect(() => {
    if (focusNext.current === null || !moreOpen) return;
    buttons.current[focusNext.current]?.focus();
    focusNext.current = null;
  }, [moreOpen]);
  // The tab stop stays on the toolbar when items are taken away, and out of a closed panel.
  const active =
    focused < items.length && (focused < firstInMore || moreOpen || !inMore) ? focused : 0;
  /** The focus back to a dialog's button: to More when the button is in the closed panel. */
  const giveBack = (element: HTMLElement | null | undefined) => {
    const closed = morePanel.current?.hidden && morePanel.current.contains(element ?? null);
    (closed ? moreButton.current : element)?.focus();
  };
  /** The items as last rendered: where a dialog closed later finds its button. */
  const shown = useRef(items);
  shown.current = items;
  // Whether a select box was last used with the pointer (its pick then goes back to the document).
  const pointer = useRef(false);
  // The open menu (a menu button's key), if any.
  const [menu, setMenu] = useState<string | null>(null);
  // The color fields behind "More colors…" (by item key), and what the last one opened on.
  const colorFields = useRef<Record<string, HTMLInputElement | null>>({});
  const customColor = useRef<{ pointer: boolean; editor: Editor; state: EditorState } | null>(null);
  // Nor does it come back with its item, once that has left the toolbar.
  const menuGone = menu !== null && !items.some((item) => item.key === menu);
  useEffect(() => {
    if (disabled || menuGone) setMenu(null);
  }, [disabled, menuGone]);

  const run = (index: number, event: MouseEvent) => {
    const item = items[index];
    if (!item || disabled || !states[index]?.enabled) return;
    if (typeof item.dialog === "string") {
      openBuiltIn(item.dialog, buttons.current[index] ?? null);
      return;
    }
    if (typeof item.dialog === "function") {
      closeDialogs();
      setAppDialog({ key: item.key });
      return;
    }
    if (item.actions && !actionsOf(item, body).length) return;
    if (item.colors && !item.colors.options.length) return;
    if (item.colors || item.actions) {
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
    editor.run(item.command);
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
          // The picture dialog too: what it edits or inserts at may have gone (another
          // document, set with no transaction, included).
          setPictureDialog((current) =>
            current &&
            (!transactions.length ||
              transactions.some((tr) => tr.docChanged) ||
              !state.selection.eq(current.selection))
              ? null
              : current,
          );
          // The cross-reference dialog inserts at the selection it opened on.
          setReferenceDialog((current) =>
            current &&
            (!transactions.length ||
              transactions.some((tr) => tr.docChanged) ||
              !state.selection.eq(current.selection))
              ? null
              : current,
          );
          setNoteDialog((current) =>
            current && (!transactions.length || transactions.some((tr) => tr.docChanged))
              ? null
              : current,
          );
          // The control properties dialog is for the control it opened on.
          setControlDialog((current) =>
            current &&
            (!transactions.length ||
              transactions.some((tr) => tr.docChanged) ||
              !state.selection.eq(current.selection))
              ? null
              : current,
          );
          // So is the page setup dialog: its section may have changed.
          setSetupDialog((current) =>
            current &&
            (!transactions.length ||
              transactions.some((tr) => tr.docChanged) ||
              !state.selection.eq(current.selection))
              ? null
              : current,
          );
          // The insert table dialog is for the caret it opened on, as the link dialog is.
          setTableDialog((current) =>
            current &&
            (!transactions.length ||
              transactions.some((tr) => tr.docChanged) ||
              !state.selection.eq(current.selection))
              ? null
              : current,
          );
          setDialog((current) =>
            current &&
            (!transactions.length ||
              transactions.some((tr) => tr.docChanged) ||
              !state.selection.eq(current.selection))
              ? null
              : current,
          );
          return;
        }
        const active = typeof document === "undefined" ? null : document.activeElement;
        setTableDialog(null);
        setPictureDialog(null);
        setSetupDialog(null);
        setReferenceDialog(null);
        setControlDialog(null);
        setNoteDialog(null);
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
    giveBack(dialog?.restore);
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
  // The page setup dialog (from the section menu), for the section of the caret it opened on.
  const [setupDialog, setSetupDialog] = useState<{
    restore: HTMLElement | null;
    selection: EditorState["selection"];
  } | null>(null);
  useEffect(() => {
    if (disabled) setSetupDialog(null);
  }, [disabled]);
  // The cross-reference dialog (from the fields menu).
  const [referenceDialog, setReferenceDialog] = useState<{
    restore: HTMLElement | null;
    selection: EditorState["selection"];
  } | null>(null);
  useEffect(() => {
    if (disabled) setReferenceDialog(null);
  }, [disabled]);
  // The control properties dialog (from the content controls menu).
  const [controlDialog, setControlDialog] = useState<{
    restore: HTMLElement | null;
    selection: EditorState["selection"];
  } | null>(null);
  useEffect(() => {
    if (disabled) setControlDialog(null);
  }, [disabled]);
  // The note options dialog (from the notes menu).
  const [noteDialog, setNoteDialog] = useState<{ restore: HTMLElement | null } | null>(null);
  useEffect(() => {
    if (disabled) setNoteDialog(null);
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

  // An app's dialog (a `ToolbarDialog` item's): it closes itself, and with a disabled toolbar.
  const [appDialog, setAppDialog] = useState<{ key: string } | null>(null);
  // One dialog at a time: a built-in one that opens (Mod-K's, a menu's) takes its place.
  const builtInDialog = Boolean(
    dialog ||
      tableDialog ||
      pictureDialog ||
      setupDialog ||
      referenceDialog ||
      controlDialog ||
      noteDialog,
  );
  // A dialog opens under the toolbar, where the More panel is: the panel closes for it.
  const anyDialog = builtInDialog || appDialog !== null;
  useEffect(() => {
    if (anyDialog) setMoreOpen(false);
  }, [anyDialog]);
  const appDialogItem = appDialog && items.find((item) => item.key === appDialog.key);
  // Nor does it come back with its item, once that has left the toolbar.
  const appDialogGone = !appDialogItem;
  useEffect(() => {
    if (disabled || builtInDialog || appDialogGone) setAppDialog(null);
  }, [disabled, builtInDialog, appDialogGone]);

  // One dialog at a time: opening one closes the rest (`keep` reopens itself, counting requests).
  // A built-in dialog, from its menu entry or from an item that names it; the focus goes back
  // to `restore` when it closes.
  function openBuiltIn(name: ToolbarDialogName, restore: HTMLElement | null) {
    const { selection } = editor.state;
    if (name === "link") {
      // As Mod-K: the toolbar hears the request (and keeps the focus to give back).
      editor.run(openLinkEditor);
    } else if (name === "picture") {
      const selected = selectedPicture(editor.state);
      // Inserting needs the app's upload; editing a selected picture does not.
      if (!selected && !upload) return;
      closeDialogs();
      setPictureDialog({ pos: selected?.pos ?? null, selection, restore });
    } else if (name === "insertTable") {
      closeDialogs("table");
      setTableDialog((current) => ({
        restore,
        selection,
        request: (current?.request ?? -1) + 1,
      }));
    } else {
      // Nothing to refer to: no dialog (its menu entry is disabled then).
      if (name === "crossReference") {
        const { bookmarks, headings } = crossReferenceTargets(editor.state);
        if (bookmarks.length + headings.length === 0) return;
      }
      closeDialogs();
      if (name === "noteOptions") setNoteDialog({ restore });
      else if (name === "controlProperties") setControlDialog({ restore, selection });
      else if (name === "crossReference") setReferenceDialog({ restore, selection });
      else setSetupDialog({ restore, selection });
    }
  }

  function closeDialogs(keep?: "table") {
    setDialog(null);
    if (keep !== "table") setTableDialog(null);
    setPictureDialog(null);
    setSetupDialog(null);
    setReferenceDialog(null);
    setControlDialog(null);
    setNoteDialog(null);
  }

  // Another tab: its items from the first, and nothing of the last tab's left open.
  // A pick: the app's to follow when it passes `tab`. Picking the tab that shows only because
  // the wanted one went (a tab with `visible`) is a pick too.
  const showTab = (next: ToolbarTab) => {
    if (next.key === tab?.key && (wanted === null || wanted === next.key)) return;
    if (givenTab === undefined) setTabKey(next.key);
    onTabChange?.(next.key);
  };
  // Another tab shows (picked, the app's `tab`, or the selected one went): its items from the
  // first, and nothing of the last tab's left open (a dialog's button goes with its tab).
  const tabNow = tab?.key;
  const lastTab = useRef(tabNow);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a change of tab; `closeDialogs` sets state.
  useEffect(() => {
    if (lastTab.current === tabNow) return;
    lastTab.current = tabNow;
    setActive(0);
    setMenu(null);
    setAppDialog(null);
    closeDialogs();
  }, [tabNow]);
  // The focus was in the ribbon and what had it is gone (a tab or an item that went with the
  // selection): the selected tab takes it, not the page.
  const ribbon = useRef<HTMLDivElement>(null);
  const ribbonFocused = useRef(false);
  useEffect(() => {
    const element = ribbon.current;
    if (!ribbonFocused.current || !element || element.contains(document.activeElement)) return;
    tabButtons.current[tabs?.findIndex((t) => t.key === tabNow) ?? -1]?.focus();
  });
  // The tab list's keys (WAI-ARIA tabs, automatic activation: the tab focused is the one shown).
  const onTabKeyDown = (event: KeyboardEvent) => {
    if (!tabs || !tab || event.altKey || event.ctrlKey || event.metaKey) return;
    const count = tabs.length;
    // From the tab that has the focus: the selected one, unless the app kept its `tab`.
    const focusedTab = tabButtons.current.indexOf(event.target as HTMLButtonElement);
    const at = focusedTab >= 0 ? focusedTab : tabs.findIndex((t) => t.key === tab.key);
    const moves: Record<string, number> = {
      ArrowRight: (at + 1) % count,
      ArrowLeft: (at - 1 + count) % count,
      Home: 0,
      End: count - 1,
    };
    const next = tabs[moves[event.key] ?? -1];
    if (!next) return;
    event.preventDefault();
    showTab(next);
    tabButtons.current[tabs.indexOf(next)]?.focus();
  };
  // With tabs, a ribbon: the tab list and the selected tab's panel, which holds the toolbar.
  const panel = (bar: ReactNode) =>
    tabs && tab ? (
      // biome-ignore lint/a11y/noStaticElementInteractions: it only notes whether the focus is inside.
      <div
        ref={ribbon}
        className={className ? `foli-ribbon ${className}` : "foli-ribbon"}
        onFocus={() => {
          ribbonFocused.current = true;
        }}
        onBlur={(event) => {
          // Not fired when the focused element is removed: the flag then stays.
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            ribbonFocused.current = false;
        }}
      >
        <div
          role="tablist"
          aria-label={label}
          className="foli-ribbon-tabs"
          onKeyDown={onTabKeyDown}
        >
          {tabs.map((t, n) => (
            <button
              key={t.key}
              ref={(element) => {
                tabButtons.current[n] = element;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${n}`}
              className={`foli-ribbon-tab foli-ribbon-tab-${t.key}`}
              aria-selected={t.key === tab.key}
              aria-controls={`${id}-panel`}
              tabIndex={t.key === tab.key ? 0 : -1}
              // Keep the focus (and the selection) in the document on click.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => showTab(t)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id={`${id}-panel`}
          aria-labelledby={`${id}-tab-${tabs.findIndex((t) => t.key === tab.key)}`}
          className="foli-ribbon-panel"
          // A tab without items has nothing to focus: the panel takes the tab stop.
          tabIndex={items.length ? undefined : 0}
        >
          {bar}
        </div>
      </div>
    ) : (
      bar
    );

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
    if (next === undefined) {
      // Escape in the More panel closes it, the focus on its button.
      // (Not an Escape a control in it took for itself.)
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        moreOpen &&
        morePanel.current?.contains(event.target as Node)
      ) {
        event.preventDefault();
        setMoreOpen(false);
        setActive(0);
        moreButton.current?.focus();
      }
      return;
    }
    event.preventDefault();
    setActive(next);
    if (inMore && next >= firstInMore && !moreOpen) {
      // Into the panel: it opens, then the item takes the focus.
      focusNext.current = next;
      setMoreOpen(true);
      return;
    }
    if (inMore && next < firstInMore && moreOpen) setMoreOpen(false);
    buttons.current[next]?.focus();
  };
  // `overflow="menu"`: the groups that fit, then More and its panel with the others.
  const overflowed = (nodes: ReactNode[]) => {
    if (!overflowing) return nodes;
    const more = (
      <button
        ref={moreButton}
        type="button"
        className="foli-toolbar-button foli-toolbar-more"
        aria-expanded={moreOpen}
        aria-controls={`${id}-more`}
        // The items in the panel are reached with the arrow keys: this is the pointer's way.
        tabIndex={-1}
        // While it measures, and when everything fits: there for its width only.
        style={inMore && fit !== null ? undefined : { visibility: "hidden" }}
        aria-hidden={inMore && fit !== null ? undefined : true}
        onMouseDown={(event) => event.preventDefault()}
        // Also on a disabled toolbar, whose items stay there to be found.
        onClick={() => setMoreOpen((open) => !open)}
      >
        More
      </button>
    );
    return (
      <>
        {nodes.slice(0, rowGroups)}
        {more}
        {inMore && fit !== null && (
          // biome-ignore lint/a11y/useSemanticElements: a fieldset cannot be a flex row in every browser.
          <div
            ref={morePanel}
            id={`${id}-more`}
            role="group"
            aria-label="More"
            className="foli-toolbar-more-panel"
            hidden={!moreOpen}
          >
            {nodes.slice(rowGroups)}
          </div>
        )}
      </>
    );
  };

  let index = 0;
  return (
    <>
      {panel(
        <div
          role="toolbar"
          aria-label={label}
          ref={bar}
          // With tabs, `className` is the ribbon's.
          className={[
            "foli-toolbar",
            overflowing && "foli-toolbar-overflow",
            // Measuring: every group in the row, what does not fit cut off for now.
            overflowing && fit === null && "foli-toolbar-measuring",
            !tab && className,
          ]
            .filter(Boolean)
            .join(" ")}
          onKeyDown={onKeyDown}
        >
          {overflowed(
            groups.map((group, g) => {
              const controls = group.items.map((item) => {
                const i = index++;
                const state = states[i];
                // Inserting a picture needs the app's upload; editing a selected one does not.
                // A menu without entries (or colors) cannot open, whatever its `enabled` says.
                const off =
                  disabled ||
                  !state?.enabled ||
                  (item.dialog === "picture" && state?.value === "insert" && !upload) ||
                  (item.actions !== undefined && actionsOf(item, body).length === 0) ||
                  item.colors?.options.length === 0;
                if (item.render) {
                  return (
                    <CustomItem
                      key={item.key}
                      render={item.render}
                      editor={editor}
                      disabled={off}
                      tabIndex={i === active ? 0 : -1}
                      setRef={(element) => {
                        buttons.current[i] = element;
                      }}
                      onFocus={() => setActive(i)}
                    />
                  );
                }
                if (item.select) {
                  const { select } = item;
                  const value = state?.value ?? "";
                  // Read now: the list may come from outside the editor (the state's copy of it
                  // only makes the toolbar render again when it changes with the document).
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
                    aria-label={item.icon !== undefined ? item.label : undefined}
                    title={item.label}
                    aria-pressed={item.pressed ? Boolean(state?.pressed) : undefined}
                    aria-haspopup={
                      item.colors || item.actions ? "menu" : item.dialog ? "dialog" : undefined
                    }
                    aria-expanded={item.colors || item.actions ? menu === item.key : undefined}
                    aria-disabled={off || undefined}
                    tabIndex={i === active ? 0 : -1}
                    // Keep the focus (and the selection) in the document on click.
                    onMouseDown={(event) => event.preventDefault()}
                    onFocus={() => setActive(i)}
                    onClick={(event) => run(i, event)}
                    onKeyDown={(event) => {
                      // ArrowDown opens a menu (the WAI-ARIA menu button pattern).
                      if (!(item.colors || item.actions) || off || event.key !== "ArrowDown")
                        return;
                      event.preventDefault();
                      setMenu(item.key);
                    }}
                  >
                    {item.icon ?? item.text ?? item.label}
                    {item.colors && (
                      <span
                        className="foli-toolbar-swatch"
                        aria-hidden="true"
                        style={{ background: state?.value ?? "transparent" }}
                      />
                    )}
                  </button>
                );
                if (item.actions) {
                  const actions = actionsOf(item, body);
                  return (
                    <span key={item.key} className="foli-toolbar-menu">
                      {button}
                      {menu === item.key && !disabled && actions.length > 0 && (
                        <ActionMenu
                          label={item.label}
                          actions={actions}
                          editor={editor}
                          state={editor.state}
                          onPick={(action, pointer) => {
                            setMenu(null);
                            if (action.dialog) {
                              openBuiltIn(action.dialog, buttons.current[i] ?? null);
                              return;
                            }
                            editor.run(action.command);
                            if (action.movesFocus) return;
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
                const options = item.colors?.options;
                if (!options || !item.colors) return button;
                const { pick } = item.colors;
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
                        onCustom={
                          item.colors.custom
                            ? (pointer) => {
                                setMenu(null);
                                // The entry goes with the menu: its button keeps the focus, also
                                // when the user leaves the field without choosing.
                                buttons.current[i]?.focus();
                                const field = colorFields.current[item.key];
                                if (!field) return;
                                customColor.current = { pointer, editor, state: editor.state };
                                // It opens on the color at the selection.
                                field.value = state?.value ?? "#000000";
                                try {
                                  field.showPicker();
                                } catch {
                                  // No `showPicker` (older browsers), or it refused: a click opens it.
                                  field.click();
                                }
                              }
                            : undefined
                        }
                      />
                    )}
                    {item.colors.custom && !disabled && (
                      <ColorField
                        setRef={(element) => {
                          colorFields.current[item.key] = element;
                        }}
                        onPick={(color) => {
                          const opened = customColor.current;
                          // The color is for the selection the field opened on: a click in the
                          // document that closed the field may have moved it since.
                          if (
                            opened?.editor === editor &&
                            opened.state.doc === editor.state.doc &&
                            !opened.state.selection.eq(editor.state.selection)
                          )
                            editor.dispatch(editor.state.tr.setSelection(opened.state.selection));
                          editor.run(pick(color));
                          if (opened?.pointer) onClickCommand?.();
                        }}
                      />
                    )}
                  </span>
                );
              });
              return (
                <Fragment key={group.items[0]?.key}>
                  {g > 0 && <hr className="foli-toolbar-separator" aria-orientation="vertical" />}
                  {group.label === undefined ? (
                    controls
                  ) : (
                    // biome-ignore lint/a11y/useSemanticElements: a fieldset cannot be a flex row in every browser.
                    <div role="group" aria-label={group.label} className="foli-toolbar-group">
                      <div className="foli-toolbar-group-items">{controls}</div>
                      <div className="foli-toolbar-group-label" aria-hidden="true">
                        {group.label}
                      </div>
                    </div>
                  )}
                </Fragment>
              );
            }),
          )}
        </div>,
      )}
      {appDialog && typeof appDialogItem?.dialog === "function" && !disabled && !builtInDialog && (
        <AppDialog
          // Each item's dialog is its own component: its hooks are not another dialog's.
          key={appDialogItem.key}
          label={appDialogItem.label}
          name={appDialogItem.key}
          content={appDialogItem.dialog}
          editor={editor}
          close={(applied) => {
            setAppDialog(null);
            if (applied && onClickCommand) onClickCommand();
            // Its button as it is now: the items may have changed while it was open.
            else
              giveBack(
                buttons.current[shown.current.findIndex((item) => item.key === appDialogItem.key)],
              );
          }}
        />
      )}
      {pictureDialog && !disabled && (
        <PictureDialog
          editor={editor}
          pos={pictureDialog.pos}
          upload={upload}
          onClose={(done) => {
            const { restore } = pictureDialog;
            setPictureDialog(null);
            if (done && onClickCommand) onClickCommand();
            else giveBack(restore);
          }}
        />
      )}
      {setupDialog && !disabled && (
        <PageSetupDialog
          editor={editor}
          onClose={(applied) => {
            const { restore } = setupDialog;
            setSetupDialog(null);
            if (applied && onClickCommand) onClickCommand();
            else giveBack(restore);
          }}
        />
      )}
      {referenceDialog && !disabled && (
        <CrossReferenceDialog
          editor={editor}
          layout={() => body.storyView?.fieldLayout ?? null}
          onClose={(inserted) => {
            const { restore } = referenceDialog;
            setReferenceDialog(null);
            if (inserted && onClickCommand) onClickCommand();
            else giveBack(restore);
          }}
        />
      )}
      {noteDialog && !disabled && (
        <NoteOptionsDialog
          editor={body}
          onClose={(applied) => {
            const { restore } = noteDialog;
            setNoteDialog(null);
            if (applied && onClickCommand) onClickCommand();
            else giveBack(restore);
          }}
        />
      )}
      {controlDialog && !disabled && (
        <ControlDialog
          editor={editor}
          onClose={(applied) => {
            const { restore } = controlDialog;
            setControlDialog(null);
            if (applied && onClickCommand) onClickCommand();
            else giveBack(restore);
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
            else giveBack(restore);
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

/** An app's own control: a component, so that its `render` may use hooks. */
function CustomItem({
  render,
  setRef,
  ...props
}: Omit<ToolbarCustomProps, "ref"> & {
  render: ToolbarCustom["render"];
  setRef: ToolbarCustomProps["ref"];
}) {
  return <>{render({ ...props, ref: setRef })}</>;
}

/** An app's dialog: the focus goes into it on open; Escape closes it. */
function AppDialog({
  label,
  name,
  content,
  editor,
  close,
}: {
  label: string;
  name: string;
  content: (props: ToolbarDialogProps) => ReactNode;
  editor: Editor;
  close: ToolbarDialogProps["close"];
}) {
  const box = useRef<HTMLDivElement>(null);
  // A `close` kept by the app (called after an await) does nothing once this dialog is gone.
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    const element = box.current;
    // Its first field or button, else the dialog itself (Escape works from there).
    if (element && !element.contains(document.activeElement))
      (
        element.querySelector<HTMLElement>(
          'input, select, textarea, button, [tabindex]:not([tabindex="-1"])',
        ) ?? element
      ).focus();
    return () => {
      open.current = false;
    };
  }, []);
  const closeOnce: typeof close = (applied) => {
    if (!open.current) return;
    open.current = false;
    close(applied);
  };
  return (
    <div
      ref={box}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className={`foli-link-dialog foli-toolbar-dialog foli-toolbar-${name}-dialog`}
      onKeyDown={(event) => {
        // An Escape the content took (its own pop-up) is not the dialog's.
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        closeOnce(false);
      }}
    >
      {content({ editor, close: closeOnce })}
    </div>
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
  onCustom,
}: {
  label: string;
  options: readonly ToolbarColor[];
  current: string | null;
  onPick: (color: string | null, pointer: boolean) => void;
  onClose: (refocus: boolean) => void;
  /** With it, a last entry that asks for any color. */
  onCustom?: ((pointer: boolean) => void) | undefined;
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
    const count = options.length + (onCustom ? 1 : 0);
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
      {onCustom && (
        <button
          ref={(element) => {
            items.current[options.length] = element;
          }}
          type="button"
          role="menuitem"
          aria-haspopup="dialog"
          tabIndex={-1}
          className="foli-menu-item foli-menu-custom"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => onCustom(event.detail > 0)}
        >
          More colors…
        </button>
      )}
    </div>
  );
}

/**
 * The browser's color field behind a color menu's "More colors…": not shown (the entry opens
 * it), and heard on `change` (the color chosen), not while the user is still choosing.
 */
function ColorField({
  setRef,
  onPick,
}: {
  setRef: (element: HTMLInputElement | null) => void;
  onPick: (color: string) => void;
}) {
  const field = useRef<HTMLInputElement | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    const onChange = () => pick.current(element.value.toLowerCase());
    element.addEventListener("change", onChange);
    return () => element.removeEventListener("change", onChange);
  }, []);
  return (
    <input
      ref={(element) => {
        field.current = element;
        setRef(element);
      }}
      type="color"
      className="foli-toolbar-color-input"
      // Only its picker is for people: the entry in the menu is what they find and use.
      aria-hidden="true"
      tabIndex={-1}
      defaultValue="#000000"
    />
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
  editor,
  state,
  onPick,
  onClose,
}: {
  label: string;
  actions: readonly Action[];
  /** For `checked`, with `state`. */
  editor: Editor;
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
            aria-checked={action.checked(state, editor)}
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
 * The cross-reference dialog: what to refer to (the document's bookmarks and headings), what to
 * show of it, whether it links there; Insert and Cancel; Escape cancels.
 */
function CrossReferenceDialog({
  editor,
  layout,
  onClose,
}: {
  editor: Editor;
  layout: () => FieldLayout | null;
  onClose: (inserted: boolean) => void;
}) {
  const [{ bookmarks, headings }] = useState(() => crossReferenceTargets(editor.state));
  const options = [
    ...headings.map((h) => ({
      value: `h${h.pos}`,
      label: `${"\u00a0".repeat((h.level - 1) * 2)}${h.number ? `${h.number} ` : ""}${h.text}`,
    })),
    ...bookmarks.map((b) => ({ value: `b${b.name}`, label: `Bookmark: ${b.name}` })),
  ];
  const [target, setTarget] = useState(options[0]?.value ?? "");
  const [show, setShow] = useState<"text" | "page" | "number">("text");
  const [link, setLink] = useState(true);
  const [failed, setFailed] = useState(false);
  const first = useRef<HTMLSelectElement>(null);
  const id = useId();
  useEffect(() => {
    first.current?.focus();
  }, []);
  const insert = (event: FormEvent) => {
    event.preventDefault();
    const to = target[0] === "h" ? Number(target.slice(1)) : target.slice(1);
    if (editor.run(insertCrossReference({ to, show, link, layout: layout() }))) onClose(true);
    else setFailed(true);
  };
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Insert cross-reference"
      className="foli-link-dialog foli-table-dialog"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose(false);
        }
        if (event.key !== "Tab") return;
        // Tab goes round inside the dialog.
        const stops = [
          ...event.currentTarget.querySelectorAll<HTMLElement>("select, input, button"),
        ];
        const at = stops.indexOf(event.target as HTMLElement);
        const next = (at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length;
        event.preventDefault();
        stops[next]?.focus();
      }}
    >
      <form onSubmit={insert} noValidate>
        <label htmlFor={`${id}-target`}>Refer to</label>
        <select
          ref={first}
          id={`${id}-target`}
          value={target}
          onChange={(event) => {
            setTarget(event.target.value);
            setFailed(false);
          }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-show`}>Show</label>
        <select
          id={`${id}-show`}
          value={show}
          onChange={(event) => setShow(event.target.value as typeof show)}
        >
          <option value="text">Its text</option>
          <option value="page">Its page number</option>
          <option value="number">Its paragraph number</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={link}
            onChange={(event) => setLink(event.target.checked)}
          />
          Link to it
        </label>
        <button type="submit">Insert</button>
        <button type="button" onClick={() => onClose(false)}>
          Cancel
        </button>
        {failed && (
          <p className="foli-link-error" role="alert">
            A cross-reference cannot be inserted here.
          </p>
        )}
      </form>
    </div>
  );
}

/** Word's number formats for notes. */
const NOTE_FORMATS = [
  ["decimal", "1, 2, 3"],
  ["lowerLetter", "a, b, c"],
  ["upperLetter", "A, B, C"],
  ["lowerRoman", "i, ii, iii"],
  ["upperRoman", "I, II, III"],
  ["chicago", "*, †, ‡"],
] as const;

/**
 * How notes are placed and numbered, for the whole document as Word's dialog applies it: where
 * they go, the number format, where numbers start and when they restart; Escape cancels.
 */
function NoteOptionsDialog({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: (applied: boolean) => void;
}) {
  const [kind, setKind] = useState<NoteKind>("footnote");
  const valuesOf = (of: NoteKind) => {
    const envelope = wordContext(editor.state)?.envelope;
    const section = sectionAt(editor.state)?.setup;
    return noteProperties(envelope ?? {}, of, section);
  };
  const [values, setValues] = useState(() => valuesOf("footnote"));
  const [start, setStart] = useState(String(values.start));
  const first = useRef<HTMLSelectElement>(null);
  const id = useId();
  useEffect(() => {
    first.current?.focus();
  }, []);
  const set = (change: Partial<typeof values>) => setValues((v) => ({ ...v, ...change }));
  const restarts = values.restart !== "continuous";
  const number = Number(start);
  const invalid = !restarts && (!Number.isInteger(number) || number < 1 || number > 16383);
  const apply = (event: FormEvent) => {
    event.preventDefault();
    if (invalid) return;
    const properties: NotePropertiesJSON = {
      position: values.position,
      format: values.format,
      restart: values.restart,
      start: restarts ? 1 : number,
    };
    onClose(editor.run(setNoteProperties(kind, properties)));
  };
  return (
    <div
      role="dialog"
      aria-label="Note options"
      className="foli-link-dialog foli-table-dialog"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose(false);
      }}
    >
      <form onSubmit={apply} noValidate>
        <label htmlFor={`${id}-kind`}>Notes</label>
        <select
          ref={first}
          id={`${id}-kind`}
          value={kind}
          onChange={(event) => {
            const next = event.target.value as NoteKind;
            const shown = valuesOf(next);
            setKind(next);
            setValues(shown);
            setStart(String(shown.start));
          }}
        >
          <option value="footnote">Footnotes</option>
          <option value="endnote">Endnotes</option>
        </select>
        <label htmlFor={`${id}-position`}>Position</label>
        <select
          id={`${id}-position`}
          value={values.position}
          onChange={(event) =>
            set({ position: event.target.value as NonNullable<NotePropertiesJSON["position"]> })
          }
        >
          {kind === "footnote" ? (
            <>
              <option value="pageBottom">Bottom of page</option>
              <option value="beneathText">Below text</option>
            </>
          ) : (
            <>
              <option value="docEnd">End of document</option>
              <option value="sectEnd">End of section</option>
            </>
          )}
        </select>
        <label htmlFor={`${id}-format`}>Number format</label>
        <select
          id={`${id}-format`}
          value={values.format}
          onChange={(event) => set({ format: event.target.value })}
        >
          {NOTE_FORMATS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-start`}>Start at</label>
        <input
          id={`${id}-start`}
          type="number"
          min={1}
          value={restarts ? "1" : start}
          disabled={restarts}
          aria-invalid={invalid || undefined}
          onChange={(event) => setStart(event.target.value)}
        />
        <label htmlFor={`${id}-restart`}>Numbering</label>
        <select
          id={`${id}-restart`}
          value={values.restart}
          onChange={(event) =>
            set({ restart: event.target.value as NonNullable<NotePropertiesJSON["restart"]> })
          }
        >
          <option value="continuous">Continuous</option>
          <option value="eachSect">Restart each section</option>
          {kind === "footnote" && <option value="eachPage">Restart each page</option>}
        </select>
        <button type="submit">Apply</button>
        <button type="button" onClick={() => onClose(false)}>
          Cancel
        </button>
        {invalid && (
          <p className="foli-link-error" role="alert">
            The start must be a whole number from 1.
          </p>
        )}
      </form>
    </div>
  );
}

/** A list's items as the dialog shows them: one a line, `shown | value` where they differ. */
const itemsText = (items: ControlJSON["items"]) =>
  (items ?? [])
    .map((item) =>
      item.display === undefined || item.display === item.value
        ? item.value
        : `${item.display} | ${item.value}`,
    )
    .join("\n");

function parseItems(text: string): NonNullable<ControlJSON["items"]> {
  const seen = new Set<string>();
  return text.split("\n").flatMap((line) => {
    const [shown = "", value = shown] = line.split("|").map((part) => part.trim());
    // Word refuses two items of one value.
    if (!shown || seen.has(value)) return [];
    seen.add(value);
    return [{ value, display: shown }];
  });
}

/**
 * The properties of the control at the caret: title, tag, locks and what its kind has (list items,
 * date format, line breaks); OK and Cancel; Escape cancels.
 */
function ControlDialog({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: (applied: boolean) => void;
}) {
  const [selected] = useState(() => selectedControl(editor.state));
  const control = selected?.control;
  const [title, setTitle] = useState(control?.alias ?? "");
  const [tag, setTag] = useState(control?.tag ?? "");
  const [noDelete, setNoDelete] = useState(
    control?.lock === "sdtLocked" || control?.lock === "sdtContentLocked",
  );
  const [noEdit, setNoEdit] = useState(
    control?.lock === "contentLocked" || control?.lock === "sdtContentLocked",
  );
  const [items, setItems] = useState(itemsText(control?.items));
  const [dateFormat, setDateFormat] = useState(control?.dateFormat ?? "d MMMM yyyy");
  const [multiLine, setMultiLine] = useState(control?.multiLine === true);
  const first = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    first.current?.focus();
  }, []);
  if (!selected || !control) return null;
  const { kind } = control;
  const hasList = kind === "dropDown" || kind === "comboBox";
  const apply = (event: FormEvent) => {
    event.preventDefault();
    const lock = noDelete
      ? noEdit
        ? "sdtContentLocked"
        : "sdtLocked"
      : noEdit
        ? "contentLocked"
        : "unlocked";
    onClose(
      editor.run(
        setControlProperties(selected.id, {
          title,
          tag,
          lock,
          // Unedited items are left alone: the text form cannot carry a value with a `|` in it.
          ...(hasList && items !== itemsText(control?.items) ? { items: parseItems(items) } : {}),
          ...(kind === "date" ? { dateFormat } : {}),
          ...(kind === "text" ? { multiLine } : {}),
        }),
      ),
    );
  };
  return (
    <div
      role="dialog"
      aria-label="Content control properties"
      className="foli-link-dialog foli-table-dialog"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose(false);
      }}
    >
      <form onSubmit={apply} noValidate>
        <label htmlFor={`${id}-title`}>Title</label>
        <input
          ref={first}
          id={`${id}-title`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <label htmlFor={`${id}-tag`}>Tag</label>
        <input id={`${id}-tag`} value={tag} onChange={(event) => setTag(event.target.value)} />
        <label>
          <input
            type="checkbox"
            checked={noDelete}
            onChange={(event) => setNoDelete(event.target.checked)}
          />
          The control cannot be deleted
        </label>
        <label>
          <input
            type="checkbox"
            checked={noEdit}
            onChange={(event) => setNoEdit(event.target.checked)}
          />
          The contents cannot be edited
        </label>
        {hasList && (
          <>
            <label htmlFor={`${id}-items`}>List items, one per line (shown | value)</label>
            <textarea
              id={`${id}-items`}
              rows={4}
              value={items}
              onChange={(event) => setItems(event.target.value)}
            />
          </>
        )}
        {kind === "date" && (
          <>
            <label htmlFor={`${id}-format`}>Date format</label>
            <input
              id={`${id}-format`}
              value={dateFormat}
              onChange={(event) => setDateFormat(event.target.value)}
            />
          </>
        )}
        {kind === "text" && (
          <label>
            <input
              type="checkbox"
              checked={multiLine}
              onChange={(event) => setMultiLine(event.target.checked)}
            />
            Allow line breaks
          </label>
        )}
        <button type="submit">OK</button>
        <button type="button" onClick={() => onClose(false)}>
          Cancel
        </button>
      </form>
    </div>
  );
}

const TWIPS_PER_CM = 1440 / 2.54;
const MAX_TWIPS = 31_680;
/** Word's limit on a section's columns. */
const MAX_SECTION_COLUMNS = 45;
const toCm = (twips: number) => String(Number((twips / TWIPS_PER_CM).toFixed(2)));
/** A length in cm as whole twips (a decimal comma too), or null when it is not one in range. */
function toTwips(text: string, min: number): number | null {
  const value = Number(text.trim().replace(",", "."));
  const twips = Math.round(value * TWIPS_PER_CM);
  return text.trim() && Number.isFinite(value) && twips >= min && twips <= MAX_TWIPS ? twips : null;
}

const SECTION_STARTS = [
  ["nextPage", "Next page"],
  ["continuous", "Continuous"],
  ["evenPage", "Even page"],
  ["oddPage", "Odd page"],
  ["nextColumn", "Next column"],
] as const;
type SetupField =
  | "width"
  | "height"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "count"
  | "space"
  | "widths";
const SETUP_LABELS: Record<SetupField, string> = {
  width: "Page width (cm)",
  height: "Page height (cm)",
  top: "Top margin (cm)",
  bottom: "Bottom margin (cm)",
  left: "Left margin (cm)",
  right: "Right margin (cm)",
  count: "Columns",
  space: "Space between columns (cm)",
  widths: "Set column widths (cm, separated by ;)",
};

/**
 * The page setup dialog, for the caret's section: how it starts, its page size and orientation,
 * margins and columns (equal, or set widths; the line between them), in centimetres. Only what
 * was changed is applied. Apply and Cancel; Escape cancels; a wrong field is marked and announced.
 */
function PageSetupDialog({
  editor,
  onClose,
}: {
  editor: Editor;
  /** `applied`: the setup changed (the focus may go to the document). */
  onClose: (applied: boolean) => void;
}) {
  const id = useId();
  const [initial] = useState(() => {
    const setup = sectionAt(editor.state)?.setup ?? {};
    const width = setup.pageSize?.width ?? 12_240;
    const height = setup.pageSize?.height ?? 15_840;
    const m = setup.margins ?? {};
    const set = setup.columns?.equalWidth === false ? (setup.columns.widths ?? []) : [];
    return {
      start: setup.type ?? "nextPage",
      orientation: setup.pageSize?.orientation ?? (width > height ? "landscape" : "portrait"),
      separator: setup.columns?.separator === true,
      columns: setup.columns,
      fields: {
        width: toCm(width),
        height: toCm(height),
        top: toCm(Math.abs(m.top ?? 1440)),
        bottom: toCm(Math.abs(m.bottom ?? 1440)),
        left: toCm(m.left ?? 1440),
        right: toCm(m.right ?? 1440),
        count: String(set.length || (setup.columns?.count ?? 1)),
        space: toCm(setup.columns?.space ?? 720),
        widths: set.map((column) => toCm(column.width)).join("; "),
      } satisfies Record<SetupField, string>,
    };
  });
  const [start, setStart] = useState<string>(initial.start);
  const [orientation, setOrientation] = useState<string>(initial.orientation);
  const [separator, setSeparator] = useState(initial.separator);
  const [fields, setFields] = useState(initial.fields);
  const [error, setError] = useState<SetupField | "setup" | "mismatch" | null>(null);
  const first = useRef<HTMLSelectElement>(null);
  useEffect(() => first.current?.focus(), []);

  const apply = (event: FormEvent) => {
    event.preventDefault();
    const wrong = (field: SetupField) => {
      setError(field);
      document.getElementById(`${id}-${field}`)?.focus();
    };
    const changed = (field: SetupField) => fields[field] !== initial.fields[field];
    const setup: SectionSetup = {};
    if (start !== initial.start)
      setup.type = start === "nextPage" ? undefined : (start as SectionJSON["type"]);
    const lengths: Partial<Record<SetupField, number>> = {};
    for (const field of ["width", "height", "top", "bottom", "left", "right"] as const) {
      if (!changed(field)) continue;
      const twips = toTwips(fields[field], field === "width" || field === "height" ? 1 : 0);
      if (twips === null) return wrong(field);
      lengths[field] = twips;
    }
    if (
      lengths.width !== undefined ||
      lengths.height !== undefined ||
      orientation !== initial.orientation
    )
      setup.pageSize = {
        ...(lengths.width !== undefined ? { width: lengths.width } : {}),
        ...(lengths.height !== undefined ? { height: lengths.height } : {}),
        orientation: orientation as "portrait" | "landscape",
      };
    const margins = {
      top: lengths.top,
      bottom: lengths.bottom,
      left: lengths.left,
      right: lengths.right,
    };
    const given = Object.entries(margins).filter(([, value]) => value !== undefined);
    if (given.length) setup.margins = Object.fromEntries(given);
    if (
      changed("count") ||
      changed("space") ||
      changed("widths") ||
      separator !== initial.separator
    ) {
      // What was not changed stays exactly as it is, each column's own space included.
      const before = initial.columns;
      const set = before?.equalWidth === false ? (before.widths ?? []) : [];
      const space = changed("space") ? toTwips(fields.space, 0) : (before?.space ?? 720);
      if (space === null) return wrong("space");
      let widths: (number | null)[] = set.map((column) => column.width);
      if (changed("widths"))
        widths = fields.widths.trim()
          ? fields.widths
              .trim()
              .split(/[;\s]+/)
              .map((width) => toTwips(width, 1))
          : [];
      if (widths.includes(null)) return wrong("widths");
      const asked = Number(fields.count);
      if (widths.length && changed("count") && asked !== widths.length) {
        setError("mismatch");
        document.getElementById(`${id}-count`)?.focus();
        return;
      }
      const count = widths.length || asked;
      if (!Number.isInteger(count) || count < 1 || count > MAX_SECTION_COLUMNS)
        return wrong("count");
      const { separator: _line, equalWidth: _equal, widths: _widths, ...rest } = before ?? {};
      setup.columns = {
        ...rest,
        count,
        ...(changed("space") || before?.space === undefined ? { space } : {}),
        ...(separator ? { separator } : {}),
        ...(widths.length
          ? {
              equalWidth: false,
              widths: widths.map((width, i) => {
                const own = changed("space") ? undefined : set[i]?.space;
                const gap = own ?? (i < widths.length - 1 ? space : undefined);
                return { width: width as number, ...(gap === undefined ? {} : { space: gap }) };
              }),
            }
          : {}),
      };
    }
    if (!Object.keys(setup).length) return onClose(false);
    if (editor.run(setSectionSetup(setup))) return onClose(true);
    setError("setup");
  };
  const setOrientationSwapping = (next: string) => {
    if (next !== orientation)
      setFields((current) => ({ ...current, width: current.height, height: current.width }));
    setOrientation(next);
    setError(null);
  };
  const marked = (name: SetupField) => error === name || (name === "count" && error === "mismatch");
  const field = (name: SetupField) => (
    <div key={name} className="foli-setup-field">
      <label htmlFor={`${id}-${name}`}>{SETUP_LABELS[name]}</label>
      <input
        id={`${id}-${name}`}
        type="text"
        inputMode={name === "widths" ? "text" : "decimal"}
        value={fields[name]}
        aria-invalid={marked(name) || undefined}
        aria-describedby={marked(name) ? `${id}-error` : undefined}
        onChange={(event) => {
          setFields((current) => ({ ...current, [name]: event.target.value }));
          setError(null);
        }}
      />
    </div>
  );

  return (
    <div
      role="dialog"
      aria-label="Page setup"
      className="foli-link-dialog foli-setup-dialog"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose(false);
      }}
    >
      <form onSubmit={apply} noValidate>
        <div className="foli-setup-field">
          <label htmlFor={`${id}-start`}>Section starts</label>
          <select
            ref={first}
            id={`${id}-start`}
            value={start}
            onChange={(event) => setStart(event.target.value)}
          >
            {SECTION_STARTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="foli-setup-field">
          <label htmlFor={`${id}-orientation`}>Orientation</label>
          <select
            id={`${id}-orientation`}
            value={orientation}
            onChange={(event) => setOrientationSwapping(event.target.value)}
          >
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </div>
        {(["width", "height", "top", "bottom", "left", "right", "count", "space"] as const).map(
          field,
        )}
        <div className="foli-setup-field foli-setup-check">
          <input
            id={`${id}-separator`}
            type="checkbox"
            checked={separator}
            onChange={(event) => setSeparator(event.target.checked)}
          />
          <label htmlFor={`${id}-separator`}>Line between columns</label>
        </div>
        {field("widths")}
        <button type="submit">Apply</button>
        <button type="button" onClick={() => onClose(false)}>
          Cancel
        </button>
        {error && (
          <p id={`${id}-error`} className="foli-link-error" role="alert">
            {error === "setup"
              ? "This setup leaves no room for text, or its columns do not fit the page."
              : error === "mismatch"
                ? "The number of columns differs from the set widths: list one width per column, or clear them for equal columns."
                : `Check this value: ${SETUP_LABELS[error]}.`}
          </p>
        )}
      </form>
    </div>
  );
}

/** The largest picture side the schema takes, in px (2^31 - 1 EMU). */
const MAX_PICTURE_PX = Math.floor(2_147_483_647 / EMU_PER_PX);

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
  const fileField = useRef<HTMLInputElement>(null);
  const altField = useRef<HTMLInputElement>(null);
  const decorativeField = useRef<HTMLInputElement>(null);
  const widthField = useRef<HTMLInputElement>(null);
  const id = useId();
  const tracking = trackState(editor.state)?.on === true;
  const ratio = picture ? Number(attrs.height) / Number(attrs.width) : 1;
  // The first field that can take the focus (a decorative picture's alt text cannot).
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus once, on open.
  useEffect(() => {
    (pos === null
      ? fileField.current
      : decorative
        ? decorativeField.current
        : altField.current
    )?.focus();
  }, []);
  // A dialog closed while an upload runs: what the upload finds then is not inserted. Set in
  // the effect too: StrictMode runs effects twice (setup, cleanup, setup).
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);

  const messages = {
    file: "Choose an image file.",
    alt: "Describe the picture, or mark it as decorative.",
    size: `Enter a width and height in pixels, from 1 to ${MAX_PICTURE_PX}.`,
    failed: "The picture could not be inserted: the file could not be read or uploaded here.",
  };
  const invalid = (field: string) => (error === field ? true : undefined);
  const described = (field: string) => (error === field ? `${id}-error` : undefined);
  /** Marks `field` wrong and puts the focus on it. */
  const fail = (field: NonNullable<typeof error>) => {
    setError(field);
    const target = {
      file: fileField,
      alt: altField,
      size: widthField,
      failed: fileField,
    }[field].current;
    target?.focus();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!decorative && !alt.trim()) {
      fail("alt");
      return;
    }
    if (pos !== null) {
      // The picture is gone (the dialog closes on a change; this is a guard).
      if (!picture) {
        onClose(false);
        return;
      }
      const w = Math.round(Number(width));
      const h = Math.round(Number(height));
      const sizeChanged = w !== Number(px(attrs.width)) || h !== Number(px(attrs.height));
      const valid = (n: number) => Number.isFinite(n) && n >= 1 && n <= MAX_PICTURE_PX;
      if (sizeChanged && !tracking && !(valid(w) && valid(h))) {
        fail("size");
        return;
      }
      editor.run(setPictureAlt(pos, alt, decorative));
      if (sizeChanged && !tracking)
        editor.run(setPictureSize(pos, Math.round(w * EMU_PER_PX), Math.round(h * EMU_PER_PX)));
      onClose(true);
      return;
    }
    if (!file || !upload || !file.type.startsWith("image/")) {
      fail("file");
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
      fail("failed");
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
  const sizeNote = tracking ? `${id}-tracking` : undefined;
  const sizeDescribed = [described("size"), sizeNote].filter(Boolean).join(" ") || undefined;

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
              ref={fileField}
              id={`${id}-file`}
              type="file"
              accept="image/*"
              required
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
          ref={altField}
          id={`${id}-alt`}
          type="text"
          maxLength={65_535}
          value={decorative ? "" : alt}
          disabled={decorative}
          required={!decorative}
          aria-invalid={invalid("alt")}
          aria-describedby={described("alt")}
          onChange={(event) => {
            setAlt(event.target.value);
            setError(null);
          }}
        />
        <label>
          <input
            ref={decorativeField}
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
              ref={widthField}
              id={`${id}-width`}
              type="number"
              min={1}
              max={MAX_PICTURE_PX}
              step={1}
              value={width}
              disabled={tracking}
              aria-invalid={invalid("size")}
              aria-describedby={sizeDescribed}
              onChange={(event) => changeWidth(event.target.value)}
            />
            <label htmlFor={`${id}-height`}>Height (px)</label>
            <input
              id={`${id}-height`}
              type="number"
              min={1}
              max={MAX_PICTURE_PX}
              step={1}
              value={height}
              disabled={tracking}
              aria-invalid={invalid("size")}
              aria-describedby={sizeDescribed}
              onChange={(event) => changeHeight(event.target.value)}
            />
            <label>
              <input
                type="checkbox"
                checked={keep}
                disabled={tracking}
                aria-describedby={sizeNote}
                onChange={(event) => setKeep(event.target.checked)}
              />
              Keep proportions
            </label>
            {tracking && <p id={sizeNote}>The size does not change while changes are tracked.</p>}
          </>
        )}
        {/* Not `disabled` while uploading: the focus stays on it (Escape still cancels). */}
        <button type="submit" aria-disabled={busy || undefined}>
          {pos === null ? "Insert" : "Apply"}
        </button>
        <button type="button" onClick={() => onClose(false)}>
          Cancel
        </button>
        <p role="status" className="foli-picture-status">
          {busy ? "Inserting the picture…" : ""}
        </p>
        {error && (
          <p id={`${id}-error`} className="foli-link-error" role="alert">
            {messages[error]}
          </p>
        )}
      </form>
    </div>
  );
}
