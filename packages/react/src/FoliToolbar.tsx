import {
  type Alignment,
  acceptAllChanges,
  acceptChangeAndNext,
  addComment,
  addRepeatingItem,
  alignAt,
  CellSelection,
  type Command,
  type ControlJSON,
  canOutdent,
  changeCase,
  changeIndent,
  clearFormatting,
  colorAt,
  columnAt,
  controlAt,
  controlProperties,
  convertNotes,
  copyFormat,
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
  formatPainterState,
  formattingMarksShown,
  insertColumn,
  insertColumnBreak,
  insertControl,
  insertCrossReference,
  insertDate,
  insertHardBreak,
  insertHorizontalRule,
  insertNote,
  insertPageBreak,
  insertPageNumber,
  insertPicture,
  insertRow,
  insertSectionBreak,
  insertTable,
  insertTableOfContents,
  insertTextBox,
  isHeaderRow,
  isSafeHref,
  lineSpacingAt,
  linkAt,
  listKindAt,
  mergeCells,
  type NavigationRequest,
  type NoteKind,
  type NotePropertiesJSON,
  nextChangeWrapping,
  normalizeHref,
  noteAtSelection,
  noteProperties,
  OBJECT_WRAPS,
  type ObjectPosition,
  type ObjectWrap,
  objectMovesWithText,
  objectPosition,
  objectWrap,
  openLinkEditor,
  pageColorOf,
  paragraphBordersAt,
  paragraphFormatAt,
  paragraphStyleAt,
  paragraphStyles,
  paragraphsHaveBorder,
  previousChangeWrapping,
  type ReviewView,
  redo,
  redoDepth,
  rejectAllChanges,
  rejectChangeAndNext,
  removeLink,
  removeSectionBreak,
  requestedDialog,
  requestsLinkEditor,
  rulerShown,
  type SectionJSON,
  type SectionSetup,
  type StorySide,
  sectionAt,
  selectedObject,
  selectedPicture,
  selectedTextBox,
  setAlign,
  setCellShading,
  setColumnWidth,
  setControlProperties,
  setDifferentEvenPages,
  setDifferentFirstPage,
  setFontFamily,
  setFontSize,
  setHighlight,
  setLineSpacing,
  setLink,
  setNoteProperties,
  setObjectMovesWithText,
  setObjectPosition,
  setObjectWrap,
  setPageColor,
  setParagraphBorder,
  setParagraphFlags,
  setParagraphShading,
  setParagraphStyle,
  setPictureAlt,
  setPictureCrop,
  setPictureRotation,
  setPictureSize,
  setReviewView,
  setSectionSetup,
  setStoryLinked,
  setTableStyle,
  setTextColor,
  setTrackChanges,
  setUnderline,
  setWatermark,
  splitCell,
  stepFontSize,
  stopFormatPainter,
  type TextCase,
  tableStyleAt,
  tableStyles,
  toggleFieldCodes,
  toggleFormattingMarks,
  toggleHeaderRow,
  toggleList,
  toggleMark,
  toggleRuler,
  toggleVerticalAlign,
  trackState,
  type UNDERLINE_STYLES,
  type UpdateFieldsOptions,
  underlineAt,
  undo,
  undoDepth,
  updateFields,
  verticalAlignAt,
  watermarkOf,
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
  useSyncExternalStore,
} from "react";
import {
  BordersShadingDialog,
  LineNumbersDialog,
  PageBordersDialog,
  textWatermark,
  WatermarkDialog,
} from "./DesignDialogs.js";
import {
  development,
  sameItems,
  useActiveEditor,
  useEditorOrContext,
  useEditorState,
  useIsomorphicLayoutEffect,
} from "./editor.js";
import { toolbarIcons } from "./icons.js";
import { loadLocalFonts, localFontFamilies, subscribeLocalFonts } from "./localFonts.js";
import {
  MessagesContext,
  type ToolbarMessage,
  type ToolbarMessages,
  translator,
  useT,
} from "./messages.js";
import { shade, shadesOf } from "./palette.js";
import { StyleGallery } from "./StyleGallery.js";
import { defaultUnit, formatLength, type LengthUnit, parseLength } from "./units.js";
import {
  FontDialog,
  ParagraphBox,
  ParagraphDialog,
  TabsDialog,
  UnitContext,
} from "./WordDialogs.js";

export interface FoliToolbarProps {
  /** Default: the editor of the nearest `FoliEditorProvider`. */
  editor?: Editor | undefined;
  /**
   * Every button is disabled. Pass it whenever the canvas is `readOnly`: commands run through
   * the editor, which code may always change (`FoliEditor` does this for you).
   */
  disabled?: boolean | undefined;
  /**
   * Comment-only (`FoliEditor`'s `commentOnly`): every item is off but "New comment", undo and
   * redo, the review view and change navigation, Navigate, the navigation pane, the ruler and
   * field codes.
   */
  commentOnly?: boolean | undefined;
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
   * The Font box also lists the fonts installed on the machine (Chromium browsers): opening it
   * the first time asks the browser's permission. Default true; false never asks.
   */
  localFonts?: boolean | undefined;
  /**
   * The unit of the dialogs' and boxes' lengths (Page setup, Paragraph, Tabs, column width,
   * Layout's Indent boxes): inches or centimetres. Default: the locale's, as Word's (inches in
   * the United States, Liberia and Myanmar, by `navigator.language`), else centimetres. Points
   * stay points where Word shows points (spacing, line spacing, character spacing). A box also
   * takes a length typed with its unit (`2 cm`, `1"`, `12 pt`). (1.11)
   */
  units?: LengthUnit | undefined;
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
   * With tabs: the ribbon shows its tabs only, as Word's collapsed ribbon. A click on a tab (or
   * Enter, or ArrowDown) then shows its panel over the document until a command runs, Escape, or
   * a press or the focus goes elsewhere. A double-click on a tab, Ctrl+F1 and the ribbon's
   * collapse button toggle it. With it the app decides (change it in `onCollapsedChange`).
   */
  collapsed?: boolean | undefined;
  /** Collapsed at first, while the app does not pass `collapsed` (default false). */
  defaultCollapsed?: boolean | undefined;
  /** Someone collapsed or pinned the ribbon. */
  onCollapsedChange?: ((collapsed: boolean) => void) | undefined;
  /**
   * With tabs: Word's KeyTips. Alt pressed and released alone (the focus in the ribbon or the
   * document) shows a letter on each tab; a tab's letter shows that tab with a letter on each
   * of its items, an item's letter presses it (or focuses its box). Escape steps back; any other
   * key or a press puts them away. Default true.
   */
  keyTips?: boolean | undefined;
  /**
   * What happens to items that do not fit the toolbar's width: `"wrap"` (the default) puts
   * them on more rows; `"menu"` keeps one row and puts the groups that do not fit, whole, in a
   * panel under a "More" button at its end. The arrow keys go on into the panel (it opens) and
   * back; Escape closes it.
   */
  overflow?: "wrap" | "menu" | undefined;
  /**
   * The toolbar's strings in another language, each by its English text (`toolbarMessages`):
   * its items' names and tooltips, menus, colors, tabs, dialogs and their messages. A string not
   * given stays English. An app's own labels are its own to translate.
   */
  messages?: ToolbarMessages | undefined;
  className?: string | undefined;
}

/**
 * A group of toolbar items with a caption: a `role="group"` named by `label`, shown under it.
 * It has no `key` (a tab has: that tells them apart in `FoliEditor`'s `toolbar`).
 */
export interface ToolbarGroup {
  readonly label: string;
  readonly items: readonly ToolbarItem[];
  /**
   * Word's dialog launcher: an item shown as a small button in the caption's corner
   * (`.foli-toolbar-launcher`), named by its `label`, after the group's items for the arrow keys.
   * Usually a `ToolbarDialog` (`{ ...toolbarItems.pageSetup }`).
   */
  readonly launcher?: ToolbarItem | undefined;
  /**
   * The key of the item that starts the group's second row (Word's Font and Paragraph groups):
   * the items before it make the first row (1.11).
   */
  readonly wrapBefore?: string | undefined;
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
  /**
   * A tab of the selection, as Word's Table Design: drawn apart from the others
   * (`.foli-ribbon-tab-contextual`, in the accent color). Usually with `visible`.
   */
  readonly contextual?: boolean | undefined;
  /** Its KeyTip, a letter or digit (default: Word's for its key, else one from its label). */
  readonly keyTip?: string | undefined;
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
   * `"large"`: as Word's large buttons, the group's height, its `icon` (if any) over its text,
   * which is then the accessible name (`.foli-toolbar-large`). Buttons, menus, color menus and
   * dialog buttons; a box or an app's control stays as it is. `"medium"`: as Word's small buttons
   * with a label, its `icon` beside its text, which names it (`.foli-toolbar-medium`). Both are
   * drawn small (the icon alone, else the text) when the row is too narrow.
   */
  readonly size?: "large" | "medium" | undefined;
  /** Its KeyTip, a letter or digit (default: one from its label that its tab has free). */
  readonly keyTip?: string | undefined;
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
  /**
   * A shade of the color `name` names, in percent: lighter above 0, darker below. Its
   * accessible name says so ("Accent 1, lighter 80%").
   */
  readonly shade?: number | undefined;
}

/**
 * A toolbar color menu button (a WAI-ARIA menu of `menuitemradio`s, the current color checked
 * and shown on the button), as the text color's. A built-in one with another palette is a copy:
 * `{ ...toolbarItems.textColor, colors: { ...toolbarItems.textColor.colors, options: mine } }`.
 */
export interface ToolbarColorMenu extends ToolbarItemBase {
  readonly colors: {
    /** The palette, or one for the state (the document's theme colors, say). */
    readonly options: readonly ToolbarColor[] | ((state: EditorState) => readonly ToolbarColor[]);
    /**
     * The colors as swatches in a grid of this many columns, as Word's (the null entry a row
     * above it). Default: a list, each color by its name.
     */
    readonly columns?: number | undefined;
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
 * `"crossReference"`, `"controlProperties"` (the content control at the caret), `"noteOptions"`,
 * `"columnWidth"` (the width of the selection's column, 19.4), `"paragraph"`, `"font"` and
 * `"tabs"` (Word's Paragraph, Font and Tabs dialogs for the selection, 1.11), `"pageBorders"`
 * (Word's Page Borders, the caret's section or the document), `"watermark"` (its Printed
 * Watermark dialog, every header), `"bordersShading"` (its Borders and Shading dialog for the
 * selected paragraphs), `"lineNumbers"` (its Line Numbers dialog, the caret's section).
 */
export type ToolbarDialogName =
  | "bordersShading"
  | "lineNumbers"
  | "pageBorders"
  | "watermark"
  | "paragraph"
  | "font"
  | "tabs"
  | "link"
  | "picture"
  | "insertTable"
  | "pageSetup"
  | "crossReference"
  | "controlProperties"
  | "noteOptions"
  | "columnWidth";

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
  /**
   * A menu's entry as a button of its own (the ribbon's), made from the body's editor: a press
   * runs it as its menu does (its dialog, its focus). `command` is then only what applies
   * without the toolbar (no pages, no story to open).
   */
  entry?: ((body: Editor) => Action) | undefined;
  /** What a double-click runs instead (the format painter's: on until Escape). */
  double?: Command | undefined;
}

/** A built-in menu's entry: it may open a dialog or move the focus. */
interface Action extends ToolbarAction {
  /** With `dialog`, `command` says whether it applies: the dialog does the rest. */
  dialog?: Exclude<ToolbarDialogName, "link" | "picture">;
  /** It takes the focus where it belongs (into a story, or back to the body). */
  movesFocus?: boolean;
}

/** Office's default theme (2023) for a document without one: its colors as `RRGGBB`. */
const OFFICE_THEME: Readonly<Record<string, string>> = {
  lt1: "FFFFFF",
  dk1: "000000",
  lt2: "E8E8E8",
  dk2: "0E2841",
  accent1: "156082",
  accent2: "E97132",
  accent3: "196B24",
  accent4: "0F9ED5",
  accent5: "A02B93",
  accent6: "4EA72E",
};
/** Word's theme columns, in its order: the theme's slot, and its name. */
const THEME_SLOTS = [
  ["lt1", "Background 1"],
  ["dk1", "Text 1"],
  ["lt2", "Background 2"],
  ["dk2", "Text 2"],
  ["accent1", "Accent 1"],
  ["accent2", "Accent 2"],
  ["accent3", "Accent 3"],
  ["accent4", "Accent 4"],
  ["accent5", "Accent 5"],
  ["accent6", "Accent 6"],
] as const;
/** Word's standard colors, the row under the theme's. */
const STANDARD_COLORS: readonly ToolbarColor[] = [
  { name: "Dark red", color: "#c00000" },
  { name: "Red", color: "#ff0000" },
  { name: "Orange", color: "#ffc000" },
  { name: "Yellow", color: "#ffff00" },
  { name: "Light green", color: "#92d050" },
  { name: "Green", color: "#00b050" },
  { name: "Light blue", color: "#00b0f0" },
  { name: "Blue", color: "#0070c0" },
  { name: "Dark blue", color: "#002060" },
  { name: "Purple", color: "#7030a0" },
];

/** Word's color grid for a theme: each theme color and five shades, then the standard colors. */
const themeGrid = (theme: Readonly<Record<string, string>>): ToolbarColor[] => {
  const columns = THEME_SLOTS.map(([slot, name]) => {
    const value = theme[slot];
    const color = `#${(value && /^[0-9a-f]{6}$/i.test(value) ? value : (OFFICE_THEME[slot] as string)).toLowerCase()}`;
    return { name, color, shades: shadesOf(color) };
  });
  const rows: ToolbarColor[] = columns.map(({ name, color }) => ({ name, color }));
  for (let row = 0; row < 5; row++)
    for (const { name, color, shades } of columns) {
      const percent = shades[row] as number;
      rows.push({ name, color: shade(color, percent), shade: percent });
    }
  return [...rows, ...STANDARD_COLORS];
};
// One grid per theme: it is the same until the theme changes.
const grids = new WeakMap<object, ToolbarColor[]>();
const themeColors = (state: EditorState): readonly ToolbarColor[] => {
  const theme = wordContext(state)?.envelope.theme?.colors ?? OFFICE_THEME;
  let grid = grids.get(theme);
  if (!grid) {
    grid = themeGrid(theme);
    grids.set(theme, grid);
  }
  return grid;
};
const TEXT_COLORS = (state: EditorState): readonly ToolbarColor[] => [
  { name: "Automatic", color: null },
  ...themeColors(state),
];
/** Word's highlight colors, in its order (a document opened in Word shows these exactly). */
const HIGHLIGHTS: readonly ToolbarColor[] = [
  { name: "None", color: null },
  { name: "Yellow", color: "#ffff00" },
  { name: "Bright green", color: "#00ff00" },
  { name: "Turquoise", color: "#00ffff" },
  { name: "Pink", color: "#ff00ff" },
  { name: "Blue", color: "#0000ff" },
  { name: "Red", color: "#ff0000" },
  { name: "Dark blue", color: "#000080" },
  { name: "Teal", color: "#008080" },
  { name: "Green", color: "#008000" },
  { name: "Violet", color: "#800080" },
  { name: "Dark red", color: "#800000" },
  { name: "Dark yellow", color: "#808000" },
  { name: "Gray 50%", color: "#808080" },
  { name: "Gray 25%", color: "#c0c0c0" },
  { name: "Black", color: "#000000" },
];
/** Page colors (Design ▸ Page Color): Word's grid, as the text color's. */
const PAGE_COLORS = (state: EditorState): readonly ToolbarColor[] => [
  { name: "No Color", color: null },
  ...themeColors(state),
];
/** Cell shadings: Word's grid, as the text color's. */
const SHADINGS = (state: EditorState): readonly ToolbarColor[] => [
  { name: "None", color: null },
  ...themeColors(state),
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
/** Column widths change only when not tracking (Foli does not record them; style, shading do). */
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
    key: "columnWidth",
    label: "Column width…",
    dialog: "columnWidth",
    command: canFormatTable,
  },
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

// ---------- Word's Layout tab: Margins, Orientation, Size, Columns, Breaks (30.5) ----------

/** The caret's section's page as Word measures it (Letter when the file gives none). */
const pageOf = (state: EditorState) => {
  const setup = sectionAt(state)?.setup ?? {};
  const width = setup.pageSize?.width ?? 12_240;
  const height = setup.pageSize?.height ?? 15_840;
  const landscape =
    (setup.pageSize?.orientation ?? (width > height ? "landscape" : "portrait")) === "landscape";
  return { setup, width, height, landscape };
};
/** A command that sets the caret's section, checked where it already shows `shows`. */
const sectionEntry = (
  key: string,
  label: string,
  setup: (state: EditorState) => SectionSetup,
  shows: (state: EditorState) => boolean,
): ToolbarAction => ({
  key,
  label,
  // The one already shown stays enabled (Word's menus pick it again): it changes nothing.
  command: (state, dispatch) => {
    const at = sectionAt(state);
    if (!at) return false;
    if (shows(state)) return true;
    return setSectionSetup(refitted(at.setup, setup(state)))(state, dispatch);
  },
  checked: (state) => sectionAt(state) !== null && shows(state),
});

/** Word's margin presets, in twips: top, bottom, left, right. */
const MARGINS = [
  { key: "normal", label: "Normal", top: 1440, bottom: 1440, left: 1440, right: 1440 },
  { key: "narrow", label: "Narrow", top: 720, bottom: 720, left: 720, right: 720 },
  { key: "moderate", label: "Moderate", top: 1440, bottom: 1440, left: 1080, right: 1080 },
  { key: "wide", label: "Wide", top: 1440, bottom: 1440, left: 2880, right: 2880 },
] as const;
const MARGIN_ACTIONS: readonly Action[] = [
  ...MARGINS.map(({ key, label, top, bottom, left, right }) =>
    sectionEntry(
      `margins-${key}`,
      label,
      () => ({ margins: { top, bottom, left, right } }),
      (state) => {
        const m = pageOf(state).setup.margins ?? {};
        return (
          Math.abs(m.top ?? 1440) === top &&
          Math.abs(m.bottom ?? 1440) === bottom &&
          (m.left ?? 1440) === left &&
          (m.right ?? 1440) === right
        );
      },
    ),
  ),
  {
    key: "customMargins",
    label: "Custom margins…",
    command: (state) => sectionAt(state) !== null,
    dialog: "pageSetup",
  },
];

/** Word's Wrap Text options (33.4), in its menu's order and words. */
const WRAP_LABELS: Readonly<Record<ObjectWrap, { label: string }>> = {
  inline: { label: "In Line with Text" },
  square: { label: "Square" },
  tight: { label: "Tight" },
  through: { label: "Through" },
  topAndBottom: { label: "Top and Bottom" },
  behind: { label: "Behind Text" },
  inFront: { label: "In Front of Text" },
};

/** Word's Position presets (33.4), in its menu's order. */
const POSITION_LABELS: Readonly<Record<ObjectPosition, { label: string }>> = {
  topLeft: { label: "Top left" },
  topCenter: { label: "Top center" },
  topRight: { label: "Top right" },
  middleLeft: { label: "Middle left" },
  middleCenter: { label: "Middle center" },
  middleRight: { label: "Middle right" },
  bottomLeft: { label: "Bottom left" },
  bottomCenter: { label: "Bottom center" },
  bottomRight: { label: "Bottom right" },
};

/**
 * The selected object's place on its page, as the view draws it: the body's only (an object in an
 * open header, footer or box is not measured; its layout changes keep its offsets).
 */
const placementOf = (editor: Editor, pos: number) =>
  editor.storyView && !editor.storyView.open
    ? (editor.storyView.objectPlacement?.(pos) ?? undefined)
    : undefined;

/** Wrap Text (Layout ▸ Arrange, Picture Format, Layout Options): the selected object's wrapping. */
function wrapActions(editor: Editor): readonly Action[] {
  return [
    ...OBJECT_WRAPS.map(
      (wrap): Action => ({
        key: `wrap-${wrap}`,
        label: WRAP_LABELS[wrap].label,
        checked: (state) => {
          const object = selectedObject(state);
          return !!object && objectWrap(object.node) === wrap;
        },
        command: (state, dispatch) => {
          const object = selectedObject(state);
          if (!object || trackState(state)?.on === true) return false;
          // The current choice stays enabled, as Word's; measured only when it runs.
          if (objectWrap(object.node) === wrap) return true;
          if (!dispatch) return setObjectWrap(object.pos, wrap)(state);
          return setObjectWrap(object.pos, wrap, placementOf(editor, object.pos))(state, dispatch);
        },
      }),
    ),
    ...(
      [
        { key: "moveWithText", label: "Move with Text", moves: true },
        { key: "fixOnPage", label: "Fix Position on Page", moves: false },
      ] as const
    ).map(
      ({ key, label, moves }): Action => ({
        key,
        label,
        checked: (state) => {
          const object = selectedObject(state);
          return !!object?.node.attrs.float && objectMovesWithText(object.node) === moves;
        },
        command: (state, dispatch) => {
          const object = selectedObject(state);
          if (!object?.node.attrs.float || trackState(state)?.on === true) return false;
          if (objectMovesWithText(object.node) === moves) return true;
          if (!dispatch) return true;
          return setObjectMovesWithText(
            object.pos,
            moves,
            placementOf(editor, object.pos),
          )(state, dispatch);
        },
      }),
    ),
  ];
}

/** Position (Layout ▸ Arrange, Picture Format): in line, or one of Word's nine presets. */
function positionActions(editor: Editor): readonly Action[] {
  return [
    {
      key: "position-inline",
      label: "In Line with Text",
      checked: (state) => {
        const object = selectedObject(state);
        return !!object && !object.node.attrs.float;
      },
      command: (state, dispatch) => {
        const object = selectedObject(state);
        if (!object || trackState(state)?.on === true) return false;
        if (!object.node.attrs.float) return true;
        return setObjectWrap(object.pos, "inline")(state, dispatch);
      },
    },
    ...(Object.keys(POSITION_LABELS) as ObjectPosition[]).map(
      (position): Action => ({
        key: `position-${position}`,
        label: POSITION_LABELS[position].label,
        checked: (state) => {
          const object = selectedObject(state);
          return !!object && objectPosition(object.node) === position;
        },
        command: (state, dispatch) => {
          const object = selectedObject(state);
          if (!object || trackState(state)?.on === true) return false;
          if (objectPosition(object.node) === position) return true;
          return setObjectPosition(object.pos, position)(state, dispatch);
        },
      }),
    ),
  ];
}

/** Whether a picture or text box is selected and its layout can change (not while tracking). */
const objectLayoutEnabled = (state: EditorState) =>
  !!selectedObject(state) && trackState(state)?.on !== true;

/** Layout ▸ Line Numbers: Word's menu for the caret's section and paragraph. */
const LINE_NUMBER_ACTIONS: readonly Action[] = [
  sectionEntry(
    "lineNumbers-none",
    "None",
    () => ({ lineNumbers: undefined }),
    (state) => !sectionAt(state)?.setup.lineNumbers,
  ),
  ...(
    [
      ["continuous", "Continuous"],
      ["newPage", "Restart each page"],
      ["newSection", "Restart each section"],
    ] as const
  ).map(([restart, label]) =>
    sectionEntry(
      `lineNumbers-${restart}`,
      label,
      (state) => {
        const { restart: _old, ...numbers } = sectionAt(state)?.setup.lineNumbers ?? {};
        // Continuous as Word writes it: no restart.
        return {
          lineNumbers: {
            countBy: 1,
            ...numbers,
            ...(restart === "continuous" ? {} : { restart }),
          },
        };
      },
      (state) => {
        const numbers = sectionAt(state)?.setup.lineNumbers;
        return !!numbers && (numbers.restart ?? "continuous") === restart;
      },
    ),
  ),
  {
    key: "suppressLineNumbers",
    label: "Suppress for current paragraph",
    command: (state, dispatch) =>
      setParagraphFlags({
        suppressLineNumbers: !paragraphFormatAt(state)?.suppressLineNumbers,
      })(state, dispatch),
    checked: (state) => paragraphFormatAt(state)?.suppressLineNumbers === true,
  },
  {
    key: "lineNumberOptions",
    label: "Line numbering options…",
    command: (state) => sectionAt(state) !== null,
    dialog: "lineNumbers",
  },
];

/** Home ▸ Borders: Word's menu for the selected paragraphs. */
const BORDER_ACTIONS: readonly Action[] = [
  ...(
    [
      ["bottom", "Bottom border"],
      ["top", "Top border"],
      ["left", "Left border"],
      ["right", "Right border"],
      ["none", "No border"],
      ["all", "All borders"],
      ["outside", "Outside borders"],
      ["inside", "Inside horizontal border"],
    ] as const
  ).map(
    ([preset, label]): Action => ({
      key: `border-${preset}`,
      label,
      command: setParagraphBorder(preset),
      ...(preset === "none"
        ? {}
        : { checked: (state: EditorState) => paragraphsHaveBorder(state, preset) }),
    }),
  ),
  { key: "borderLine", label: "Horizontal line", command: insertHorizontalRule },
  {
    key: "bordersShading",
    label: "Borders and Shading…",
    command: (state) => paragraphBordersAt(state) !== null,
    dialog: "bordersShading",
  },
];

/** Design ▸ Watermark: Word's gallery (its diagonal ones), Custom…, Remove. */
const WATERMARK_ACTIONS: readonly Action[] = [
  ...(
    [
      ["CONFIDENTIAL", "Confidential"],
      ["DO NOT COPY", "Do not copy"],
      ["DRAFT", "Draft"],
      ["SAMPLE", "Sample"],
      ["ASAP", "ASAP"],
      ["URGENT", "Urgent"],
    ] as const
  ).map(
    ([text, label]): Action => ({
      key: `watermark-${text.toLowerCase().replace(/ /g, "-")}`,
      label,
      command: (state, dispatch) => setWatermark(textWatermark(state, { text }))(state, dispatch),
      checked: (state) => {
        const now = watermarkOf(state);
        return now?.kind === "text" && now.text === text;
      },
    }),
  ),
  {
    key: "customWatermark",
    label: "Custom watermark…",
    command: (state) => wordContext(state) !== null,
    dialog: "watermark",
  },
  { key: "removeWatermark", label: "Remove watermark", command: setWatermark(null) },
];

const ORIENTATION_ACTIONS: readonly Action[] = (
  [
    ["portrait", "Portrait"],
    ["landscape", "Landscape"],
  ] as const
).map(([orientation, label]) =>
  sectionEntry(
    orientation,
    label,
    (state) => {
      const { width, height, landscape } = pageOf(state);
      // The page turns: its sides swap when it changes orientation.
      const turn = landscape !== (orientation === "landscape");
      return {
        pageSize: { width: turn ? height : width, height: turn ? width : height, orientation },
      };
    },
    (state) => pageOf(state).landscape === (orientation === "landscape"),
  ),
);

/** Word's paper sizes (portrait), in twips. */
const PAPER = [
  { key: "letter", label: "Letter", width: 12_240, height: 15_840 },
  { key: "legal", label: "Legal", width: 12_240, height: 20_160 },
  { key: "a3", label: "A3", width: 16_838, height: 23_811 },
  { key: "a4", label: "A4", width: 11_906, height: 16_838 },
  { key: "a5", label: "A5", width: 8_391, height: 11_906 },
  { key: "executive", label: "Executive", width: 10_440, height: 15_120 },
] as const;
const SIZE_ACTIONS: readonly Action[] = [
  ...PAPER.map(({ key, label, width, height }) =>
    sectionEntry(
      `size-${key}`,
      label,
      (state) => {
        const { landscape } = pageOf(state);
        return landscape
          ? { pageSize: { width: height, height: width, orientation: "landscape" } }
          : { pageSize: { width, height, orientation: "portrait" } };
      },
      (state) => {
        const page = pageOf(state);
        const short = Math.min(page.width, page.height);
        const long = Math.max(page.width, page.height);
        // Within a millimetre: files round A sizes differently.
        return Math.abs(short - width) <= 57 && Math.abs(long - height) <= 57;
      },
    ),
  ),
  {
    key: "morePaperSizes",
    label: "More paper sizes…",
    command: (state) => sectionAt(state) !== null,
    dialog: "pageSetup",
  },
];

/** Word's space between columns (half an inch) and its Left and Right columns' narrow share. */
const COLUMN_SPACE = 720;
const NARROW = 0.305;
const COLUMN_ACTIONS: readonly Action[] = [
  ...(
    [
      { key: "one", label: "One", count: 1 },
      { key: "two", label: "Two", count: 2 },
      { key: "three", label: "Three", count: 3 },
    ] as const
  ).map(({ key, label, count }) =>
    sectionEntry(
      `columns-${key}`,
      label,
      (state) => {
        const separator = pageOf(state).setup.columns?.separator;
        return {
          columns:
            count === 1
              ? { count: 1, ...(separator ? { separator } : {}) }
              : { count, space: COLUMN_SPACE, ...(separator ? { separator } : {}) },
        };
      },
      (state) => {
        const columns = pageOf(state).setup.columns;
        return (columns?.count ?? 1) === count && columns?.equalWidth !== false;
      },
    ),
  ),
  ...(
    [
      ["left", "Left"],
      ["right", "Right"],
    ] as const
  ).map(([side, label]) =>
    sectionEntry(
      `columns-${side}`,
      label,
      (state) => {
        const { setup } = pageOf(state);
        const usable = textWidthOf(setup) - COLUMN_SPACE;
        const narrow = Math.round(usable * NARROW);
        const wide = usable - narrow;
        const [first, second] = side === "left" ? [narrow, wide] : [wide, narrow];
        return {
          columns: {
            count: 2,
            space: COLUMN_SPACE,
            equalWidth: false,
            widths: [{ width: first, space: COLUMN_SPACE }, { width: second }],
            ...(setup.columns?.separator ? { separator: true } : {}),
          },
        };
      },
      (state) => {
        const columns = pageOf(state).setup.columns;
        const [a, b] = columns?.widths ?? [];
        return (
          columns?.equalWidth === false &&
          columns.widths?.length === 2 &&
          !!a &&
          !!b &&
          (side === "left" ? a.width < b.width : a.width > b.width)
        );
      },
    ),
  ),
  {
    key: "moreColumns",
    label: "More columns…",
    command: (state) => sectionAt(state) !== null,
    dialog: "pageSetup",
  },
];

/** The width between the side margins, in twips. */
const textWidthOf = (setup: SectionJSON) =>
  (setup.pageSize?.width ?? 12_240) -
  (setup.margins?.left ?? 1440) -
  (setup.margins?.right ?? 1440) -
  (setup.margins?.gutter ?? 0);

/**
 * `change` with a section's unequal columns scaled to the text width it leaves, as Word does
 * when the page or its margins change (their widths are absolute).
 */
function refitted(current: SectionJSON, change: SectionSetup): SectionSetup {
  const columns = change.columns ?? current.columns;
  if (change.columns || columns?.equalWidth !== false || !columns.widths?.length) return change;
  const next: SectionJSON = {
    ...current,
    pageSize: { ...current.pageSize, ...change.pageSize },
    margins: { ...current.margins, ...change.margins },
  };
  const before = textWidthOf(current);
  const after = textWidthOf(next);
  if (before <= 0 || after <= 0 || before === after) return change;
  const scale = after / before;
  const widths = columns.widths.map((c) => ({
    // Rounded down: the columns and spaces still fit.
    width: Math.max(1, Math.floor(c.width * scale)),
    ...(c.space === undefined ? {} : { space: Math.floor(c.space * scale) }),
  }));
  // The columns' own space, for those without one, scales too.
  const space = columns.space === undefined ? {} : { space: Math.floor(columns.space * scale) };
  return { ...change, columns: { ...columns, ...space, widths } };
}

const BREAK_ACTIONS: readonly Action[] = [
  { key: "pageBreak", label: "Page", command: insertPageBreak },
  { key: "columnBreak", label: "Column", command: insertColumnBreak },
  { key: "textWrapping", label: "Text wrapping", command: insertHardBreak },
  { key: "breakNext", label: "Next page", command: insertSectionBreak("nextPage") },
  { key: "breakContinuous", label: "Continuous", command: insertSectionBreak("continuous") },
  { key: "breakEven", label: "Even page", command: insertSectionBreak("evenPage") },
  { key: "breakOdd", label: "Odd page", command: insertSectionBreak("oddPage") },
  { key: "removeBreak", label: "Remove section break", command: removeSectionBreak },
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
    if (story.side !== "header" && story.side !== "footer") return false;
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
        return story && (story.side === "header" || story.side === "footer")
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

/** Insert ▸ Text Box (33.3): a new box, the caret in it. */
function textBoxActions(body: Editor): readonly Action[] {
  return [
    {
      key: "textBox",
      label: "Insert text box",
      movesFocus: true,
      command: (state, dispatch) => {
        if (!insertTextBox()(state)) return false;
        if (dispatch) {
          insertTextBox()(state, dispatch);
          const box = selectedTextBox(body.state);
          if (box) body.storyView?.editTextBox?.(String(box.attrs.story));
        }
        return true;
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

/** The ribbon's collapse button: a chevron up; pinned again: a pin. */
const COLLAPSE_ICON = (
  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
    <path d="M2 8l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);
const PIN_ICON = (
  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
    <path d="M4 1h4M5 1v4L3 7h6L7 5V1M6 7v4" fill="none" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

/** Word's dialog launcher: a small arrow out of a corner. */
const LAUNCHER_ICON = (
  <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false">
    <path d="M1 1h4M1 1v4M3 3l6 6M5 9h4V5" fill="none" stroke="currentColor" strokeWidth="1.2" />
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

/**
 * The fonts the font box offers (with the document's theme fonts, and the one shown now):
 * Office's and the web's common ones. A font the machine lacks shows in a substitute; the
 * document keeps its name.
 */
const FONTS = [
  "Aptos",
  "Aptos Display",
  "Arial",
  "Arial Black",
  "Arial Narrow",
  "Bahnschrift",
  "Book Antiqua",
  "Bookman Old Style",
  "Calibri",
  "Calibri Light",
  "Cambria",
  "Candara",
  "Century Gothic",
  "Comic Sans MS",
  "Consolas",
  "Constantia",
  "Corbel",
  "Courier New",
  "Franklin Gothic Medium",
  "Garamond",
  "Georgia",
  "Gill Sans MT",
  "Helvetica",
  "Impact",
  "Lucida Console",
  "Lucida Sans Unicode",
  "Palatino Linotype",
  "Segoe UI",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
];
/** The Font box's entries: the theme's fonts, `FONTS`, and the machine's once it lets us read them. */
const fontOptions = (state: EditorState) => {
  const theme = wordContext(state)?.envelope.theme?.fonts;
  const minor = theme?.minor.latin;
  const major = theme?.major.latin;
  const families = localFontFamilies();
  // Read after every transaction: built again only when its inputs change (hundreds of fonts).
  const last = fontCache;
  if (last && last.minor === minor && last.major === major && last.families === families)
    return last.options;
  const names = [minor, major, ...FONTS, ...families];
  const options = [...new Set(names.filter((n): n is string => !!n))]
    .sort(collator.compare)
    .map((name) => ({ value: name, label: name }));
  fontCache = { minor, major, families, options };
  return options;
};
const collator = new Intl.Collator();
let fontCache: {
  minor: string | undefined;
  major: string | undefined;
  families: readonly string[];
  options: { value: string; label: string }[];
} | null = null;
/** Keys that open a box's list (not the arrows that step its value on Windows). */
const OPEN_KEYS = new Set([" ", "Enter", "F4"]);
const NO_FONTS: readonly string[] = [];
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
        options: fontOptions,
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
        columns: 10,
        custom: true,
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
        columns: 5,
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
      command: previousChangeWrapping,
    },
    {
      key: "nextChange",
      label: "Next change",
      text: "Next change",
      enabled: (state) => trackState(state) !== null,
      command: nextChangeWrapping,
    },
    {
      key: "acceptChange",
      label: "Accept the change here, or the changes selected",
      text: "Accept",
      enabled: (state) => trackState(state) !== null,
      // Word's Accept: and on to the next change.
      command: acceptChangeAndNext,
    },
    {
      key: "rejectChange",
      label: "Reject the change here, or the changes selected",
      text: "Reject",
      enabled: (state) => trackState(state) !== null,
      command: rejectChangeAndNext,
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
      colors: {
        options: SHADINGS,
        columns: 10,
        custom: true,
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
      key: "horizontalRule",
      label: "Horizontal line",
      text: "Horizontal line",
      enabled: (state) => wordContext(state) !== null && hasTextblock(state),
      command: insertHorizontalRule,
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

/** A static menu's entry as a button of its own. */
const fromEntry = (
  actions: readonly Action[],
  key: string,
  item: Omit<Item, "key" | "label" | "command">,
): Item => {
  const action = actions.find((a) => a.key === key) as Action;
  return {
    key,
    label: action.label,
    ...(action.dialog ? { dialog: action.dialog } : { command: action.command }),
    ...(action.checked ? { pressed: action.checked } : {}),
    ...item,
  };
};

/** A menu's entry made from the body's editor, as a button of its own (see `Item.entry`). */
const bodyEntry = (
  actions: (body: Editor) => readonly Action[],
  entry: string,
  item: Omit<Item, "entry">,
): Item => ({
  ...item,
  entry: (body) => actions(body).find((a) => a.key === entry) as Action,
});

/** A quarter turn, in Word's unit (60,000ths of a degree). */
const QUARTER_TURN = 5_400_000;
const rotate =
  (by: number): Command =>
  (state, dispatch) => {
    const picture = selectedPicture(state);
    return (
      !!picture &&
      setPictureRotation(picture.pos, Number(picture.node.attrs.rotation ?? 0) + by)(
        state,
        dispatch,
      )
    );
  };
const pictureSelected = (state: EditorState) => selectedPicture(state) !== null;
const isWord = (state: EditorState) => wordContext(state) !== null;
// The table entries' cheap checks: a dry run of an insertion would build it after every change.
const rowsOf = { enabled: inTable };
const columnsOf = { enabled: canFormatTable };

/** Word's underline styles, with Word's names. */
const UNDERLINES: readonly (readonly [(typeof UNDERLINE_STYLES)[number], string])[] = [
  ["single", "Single"],
  ["words", "Words only"],
  ["double", "Double"],
  ["thick", "Thick"],
  ["dotted", "Dotted"],
  ["dash", "Dashed"],
  ["dotDash", "Dot-dash"],
  ["dotDotDash", "Dot-dot-dash"],
  ["wave", "Wave"],
];

/**
 * Built-in items that are not in the default toolbar: menus' entries as buttons of their own,
 * for the ribbon (`wordRibbonTabs`) and an app's tabs.
 */
const RIBBON_ITEMS: readonly Item[] = [
  fromEntry(TABLE_ACTIONS, "rowAbove", { text: "Insert above", ...rowsOf }),
  fromEntry(TABLE_ACTIONS, "rowBelow", { text: "Insert below", ...rowsOf }),
  fromEntry(TABLE_ACTIONS, "columnLeft", { text: "Insert left", ...columnsOf }),
  fromEntry(TABLE_ACTIONS, "columnRight", { text: "Insert right", ...columnsOf }),
  fromEntry(TABLE_ACTIONS, "deleteRows", rowsOf),
  fromEntry(TABLE_ACTIONS, "deleteColumns", columnsOf),
  fromEntry(TABLE_ACTIONS, "deleteTable", rowsOf),
  fromEntry(TABLE_ACTIONS, "mergeCells", {
    enabled: (state) => canFormatTable(state) && state.selection instanceof CellSelection,
  }),
  // A dry run returns before building anything: it only finds whether a cell is merged.
  fromEntry(TABLE_ACTIONS, "splitCell", {
    enabled: (state) => canFormatTable(state) && splitCell(state),
  }),
  fromEntry(TABLE_ACTIONS, "columnWidth", {}),
  fromEntry(TABLE_ACTIONS, "headerRow", { text: "Header row", ...rowsOf }),
  fromEntry(SECTION_ACTIONS, "pageSetup", {}),
  // Word's Paragraph group's launcher (Home and Layout).
  { key: "paragraphSettings", label: "Paragraph settings", dialog: "paragraph", enabled: isWord },
  // Word's Font group's launcher (Home).
  { key: "fontSettings", label: "Font settings", dialog: "font", enabled: isWord },
  fromEntry(CONTROL_ACTIONS, "controlProperties", { text: "Properties…" }),
  bodyEntry(textBoxActions, "textBox", {
    key: "textBox",
    label: "Insert text box",
    text: "Text Box",
    command: insertTextBox(),
  }),
  bodyEntry(noteActions, "footnote", {
    key: "footnote",
    label: "Insert footnote",
    text: "Footnote",
    command: insertNote("footnote"),
  }),
  bodyEntry(noteActions, "endnote", {
    key: "endnote",
    label: "Insert endnote",
    text: "Endnote",
    command: insertNote("endnote"),
  }),
  bodyEntry(noteActions, "goToNote", {
    key: "goToNote",
    label: "Go to note or reference",
    text: "Show notes",
    command: (state) => noteAtSelection(state) !== null,
  }),
  { key: "noteOptions", label: "Note options…", dialog: "noteOptions" },
  bodyEntry(fieldActions, "tableOfContents", {
    key: "tableOfContents",
    label: "Table of contents",
    enabled: (state) => isWord(state) && insertPageBreak(state),
    command: insertTableOfContents({ layout: null }),
  }),
  bodyEntry(fieldActions, "updateAll", {
    key: "updateFields",
    label: "Update all fields",
    text: "Update fields",
    enabled: isWord,
    command: () => true,
  }),
  bodyEntry(fieldActions, "pageNumber", {
    key: "pageNumber",
    label: "Page number",
    enabled: (state) => isWord(state) && insertPageBreak(state),
    command: insertPageNumber({ layout: null }),
  }),
  {
    key: "date",
    label: "Date",
    enabled: (state) => isWord(state) && insertPageBreak(state),
    command: insertDate(),
  },
  { key: "crossReference", label: "Cross-reference…", dialog: "crossReference" },
  {
    key: "fieldCodes",
    label: "Show field codes",
    text: "Field codes",
    enabled: isWord,
    pressed: fieldCodesShown,
    command: toggleFieldCodes,
  },
  bodyEntry(navigationActions, "outline", {
    key: "navigationPane",
    label: "Navigation pane",
    command: () => false,
  }),
  {
    key: "wrapText",
    label: "Wrap Text",
    text: "Wrap Text",
    enabled: objectLayoutEnabled,
    actions: wrapActions,
  },
  {
    key: "layoutOptions",
    label: "Layout Options",
    enabled: objectLayoutEnabled,
    actions: wrapActions,
  },
  {
    key: "position",
    label: "Position",
    text: "Position",
    enabled: objectLayoutEnabled,
    actions: positionActions,
  },
  {
    key: "rotateLeft",
    label: "Rotate left 90°",
    enabled: (state) => pictureSelected(state) && trackState(state)?.on !== true,
    command: rotate(-QUARTER_TURN),
  },
  {
    key: "rotateRight",
    label: "Rotate right 90°",
    enabled: (state) => pictureSelected(state) && trackState(state)?.on !== true,
    command: rotate(QUARTER_TURN),
  },
  {
    key: "formatPainter",
    label: "Format painter",
    pressed: (state) => formatPainterState(state).armed !== null,
    enabled: hasTextblock,
    // A click copies for the next selection; a second click puts it away; a double-click keeps
    // it on until Escape.
    command: (state, dispatch) =>
      formatPainterState(state).armed
        ? stopFormatPainter(state, dispatch)
        : copyFormat("once")(state, dispatch),
    double: copyFormat("sticky"),
  },
  {
    key: "formattingMarks",
    label: "Show formatting marks",
    pressed: formattingMarksShown,
    enabled: isWord,
    command: toggleFormattingMarks,
  },
  {
    key: "ruler",
    label: "Ruler",
    pressed: rulerShown,
    enabled: isWord,
    command: toggleRuler,
  },
  {
    key: "styleGallery",
    label: "Styles",
    enabled: hasTextblock,
    render: StyleGallery,
  },
  // Word's Design tab (Phase 32): its Page Background group.
  {
    key: "pageColor",
    label: "Page color",
    text: "Page Color",
    enabled: isWord,
    colors: {
      options: PAGE_COLORS,
      columns: 10,
      custom: true,
      value: (state) => {
        const color = pageColorOf(state);
        return color ? `#${color.toLowerCase()}` : null;
      },
      pick: (color) => setPageColor(color ? color.slice(1).toUpperCase() : null),
    },
  },
  {
    key: "lineNumbers",
    label: "Line numbers",
    text: "Line Numbers",
    enabled: isWord,
    actions: LINE_NUMBER_ACTIONS,
  },
  // Home's Paragraph group (32.4): Shading and Borders.
  {
    key: "shading",
    label: "Shading",
    enabled: (state) => isWord(state) && hasTextblock(state),
    colors: {
      options: SHADINGS,
      columns: 10,
      custom: true,
      value: (state) => {
        const fill = paragraphBordersAt(state)?.shading?.fill;
        return fill && fill.toLowerCase() !== "auto" ? `#${fill.toLowerCase()}` : null;
      },
      pick: (color) =>
        setParagraphShading(
          color ? { pattern: "clear", color: "auto", fill: color.slice(1).toUpperCase() } : null,
        ),
    },
  },
  {
    key: "borders",
    label: "Borders",
    enabled: (state) => isWord(state) && hasTextblock(state),
    actions: BORDER_ACTIONS,
  },
  {
    key: "watermark",
    label: "Watermark",
    text: "Watermark",
    enabled: isWord,
    actions: WATERMARK_ACTIONS,
  },
  {
    key: "pageBorders",
    label: "Page borders",
    text: "Page Borders",
    enabled: isWord,
    dialog: "pageBorders",
  },
  // Word's Layout tab (30.5): its page menus and its Paragraph group's boxes.
  { key: "margins", label: "Margins", text: "Margins", enabled: isWord, actions: MARGIN_ACTIONS },
  {
    key: "orientation",
    label: "Orientation",
    text: "Orientation",
    enabled: isWord,
    actions: ORIENTATION_ACTIONS,
  },
  { key: "pageSize", label: "Size", text: "Size", enabled: isWord, actions: SIZE_ACTIONS },
  { key: "columns", label: "Columns", text: "Columns", enabled: isWord, actions: COLUMN_ACTIONS },
  { key: "breaks", label: "Breaks", text: "Breaks", enabled: isWord, actions: BREAK_ACTIONS },
  {
    key: "indentLeft",
    label: "Indent left",
    enabled: isWord,
    render: (props) => <ParagraphBox {...props} field="left" label="Indent left" />,
  },
  {
    key: "indentRight",
    label: "Indent right",
    enabled: isWord,
    render: (props) => <ParagraphBox {...props} field="right" label="Indent right" />,
  },
  {
    key: "spaceBefore",
    label: "Spacing before",
    enabled: isWord,
    render: (props) => <ParagraphBox {...props} field="before" label="Spacing before" />,
  },
  {
    key: "spaceAfter",
    label: "Spacing after",
    enabled: isWord,
    render: (props) => <ParagraphBox {...props} field="after" label="Spacing after" />,
  },
  // Word's Font group (29.3).
  {
    key: "superscript",
    label: "Superscript",
    pressed: (state) => verticalAlignAt(state) === "superscript",
    enabled: hasTextblock,
    command: toggleVerticalAlign("superscript"),
  },
  {
    key: "subscript",
    label: "Subscript",
    pressed: (state) => verticalAlignAt(state) === "subscript",
    enabled: hasTextblock,
    command: toggleVerticalAlign("subscript"),
  },
  {
    key: "growFont",
    label: "Increase font size",
    enabled: hasTextblock,
    command: stepFontSize(1),
  },
  {
    key: "shrinkFont",
    label: "Decrease font size",
    enabled: hasTextblock,
    command: stepFontSize(-1),
  },
  {
    key: "clearFormatting",
    label: "Clear all formatting",
    enabled: hasTextblock,
    command: clearFormatting({ all: true }),
  },
  {
    key: "changeCase",
    label: "Change case",
    enabled: isWord,
    actions: (
      [
        ["sentence", "Sentence case."],
        ["lower", "lowercase"],
        ["upper", "UPPERCASE"],
        ["title", "Capitalize Each Word"],
        ["toggle", "tOGGLE cASE"],
      ] as const
    ).map(
      ([kind, label]): ToolbarAction => ({
        key: kind,
        label,
        command: changeCase(kind as TextCase),
      }),
    ),
  },
  {
    key: "underlineStyle",
    label: "Underline style",
    enabled: isWord,
    actions: [
      ...UNDERLINES.map(
        ([style, label]): ToolbarAction => ({
          key: style,
          label,
          command: setUnderline(style),
          checked: (state) => underlineAt(state) === style,
        }),
      ),
      { key: "none", label: "No underline", command: setUnderline(null) },
    ],
  },
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
  | "horizontalRule"
  | "section"
  | "headerFooter"
  | "fields"
  | "navigate"
  | "notes"
  | "controls"
  | "rowAbove"
  | "rowBelow"
  | "columnLeft"
  | "columnRight"
  | "deleteRows"
  | "deleteColumns"
  | "deleteTable"
  | "mergeCells"
  | "splitCell"
  | "columnWidth"
  | "headerRow"
  | "pageSetup"
  | "controlProperties"
  | "textBox"
  | "footnote"
  | "endnote"
  | "goToNote"
  | "noteOptions"
  | "tableOfContents"
  | "updateFields"
  | "pageNumber"
  | "date"
  | "crossReference"
  | "fieldCodes"
  | "navigationPane"
  | "wrapText"
  | "layoutOptions"
  | "position"
  | "rotateLeft"
  | "rotateRight"
  | "superscript"
  | "subscript"
  | "growFont"
  | "shrinkFont"
  | "clearFormatting"
  | "changeCase"
  | "underlineStyle"
  | "formatPainter"
  | "formattingMarks"
  | "ruler"
  | "styleGallery"
  | "paragraphSettings"
  | "fontSettings"
  | "margins"
  | "orientation"
  | "pageSize"
  | "columns"
  | "breaks"
  | "indentLeft"
  | "indentRight"
  | "spaceBefore"
  | "spaceAfter"
  | "pageColor"
  | "pageBorders"
  | "watermark"
  | "shading"
  | "borders"
  | "lineNumbers";

/** The built-in menu buttons of `actions`. */
type ToolbarMenuName =
  | "lineNumbers"
  | "watermark"
  | "borders"
  | "margins"
  | "orientation"
  | "pageSize"
  | "columns"
  | "breaks"
  | "changeCase"
  | "underlineStyle"
  | "table"
  | "section"
  | "headerFooter"
  | "fields"
  | "navigate"
  | "notes"
  | "controls";
type ToolbarSelectName = "style" | "font" | "size" | "lineSpacing" | "reviewView" | "tableStyle";
type ToolbarColorName = "textColor" | "highlight" | "cellShading" | "pageColor" | "shading";
type ToolbarDialogItemName =
  | "pageBorders"
  | "paragraphSettings"
  | "fontSettings"
  | "columnWidth"
  | "pageSetup"
  | "controlProperties"
  | "noteOptions"
  | "crossReference";

/**
 * The built-in items by name, to place in `FoliToolbarProps.items` (an item's `key` is its name,
 * except the alignments: `align-start`, `align-center`, `align-end`, `align-justify`). A copy
 * with another `label` or `icon` keeps what the built-in does.
 */
export const toolbarItems = Object.fromEntries(
  [...GROUPS.flat(), ...RIBBON_ITEMS].map((item) => [
    item.key.replace(/-(\w)/, (_, c: string) => c.toUpperCase()),
    item,
  ]),
) as unknown as {
  readonly [Name in ToolbarItemName]: Name extends ToolbarMenuName
    ? ToolbarMenu
    : Name extends ToolbarSelectName
      ? ToolbarSelect
      : Name extends ToolbarColorName
        ? ToolbarColorMenu
        : Name extends ToolbarDialogItemName
          ? ToolbarDialog
          : Name extends "styleGallery"
            ? ToolbarCustom
            : ToolbarButton;
};

/** The default toolbar: groups of `toolbarItems`, a separator between groups. */
export const defaultToolbarItems = GROUPS as unknown as readonly (readonly ToolbarItem[])[];

/** The boxes whose entries are the document's names (styles, fonts, table styles) or numbers. */
const DATA_BOXES = new Set(["style", "font", "size", "lineSpacing", "tableStyle"]);

/** A group's items, with or without a caption. */
const itemsOf = (group: ToolbarGroups[number]): readonly ToolbarItem[] =>
  Array.isArray(group) ? group : (group as ToolbarGroup).items;
const labelOf = (group: ToolbarGroups[number]): string | undefined =>
  Array.isArray(group) ? undefined : (group as ToolbarGroup).label;
const launcherOf = (group: ToolbarGroups[number]): ToolbarItem | undefined =>
  Array.isArray(group) ? undefined : (group as ToolbarGroup).launcher;
const wrapOf = (group: ToolbarGroups[number]): string | undefined =>
  Array.isArray(group) ? undefined : (group as ToolbarGroup).wrapBefore;

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
      items: [
        [t.table, t.picture, t.link],
        [t.pageBreak, t.horizontalRule],
        [t.fields, t.notes, t.controls],
      ],
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

/** Whether the selection is in a table (a cell selection included): Word's Table tabs show then. */
export const selectionInTable = (state: EditorState): boolean => inTable(state);

/**
 * Word's ribbon: Home, Insert, Layout, References, Review and View in captioned groups, then the
 * Table Design and Table Layout tabs while the selection is in a table and Picture Format while
 * a picture is selected. Every built-in item is in it. For `FoliToolbarProps.tabs` (or
 * `FoliEditor`'s `toolbar`); a tab, a group or an item is left out or added as with any tabs.
 */
export const wordRibbonTabs: readonly ToolbarTab[] = (() => {
  const t = toolbarItems;
  // Word's ribbon draws icons: alone for formatting, Undo and Redo; beside the text for the
  // rest; over it for the large ones. Boxes keep theirs.
  const iconOnly = new Set([
    ...["undo", "redo", "bold", "italic", "underline", "strike", "textColor", "highlight"],
    ...["superscript", "subscript", "growFont", "shrinkFont", "clearFormatting", "changeCase"],
    "underlineStyle",
    "formatPainter",
    "formattingMarks",
    ...["align-start", "align-center", "align-end", "align-justify"],
    ...["bulletList", "orderedList", "outdent", "indent"],
  ]);
  const drawn = new Map<ToolbarItem, ToolbarItem>();
  const withIcon = (item: ToolbarItem): ToolbarItem => {
    const icon = toolbarIcons[item.key];
    if (!icon || item.select || item.render) return item;
    let copy = drawn.get(item);
    if (!copy) {
      const size = item.size ?? (iconOnly.has(item.key) ? undefined : "medium");
      copy = { ...item, icon, size } as ToolbarItem;
      drawn.set(item, copy);
    }
    return copy;
  };
  const drawIcons = (tab: ToolbarTab): ToolbarTab => ({
    ...tab,
    items: tab.items.map((group) =>
      "label" in group
        ? {
            ...group,
            items: group.items.map(withIcon),
            // A launcher is drawn as Word's corner arrow whatever its size.
            launcher: group.launcher && {
              ...group.launcher,
              icon: toolbarIcons[group.launcher.key],
            },
          }
        : group.map(withIcon),
    ),
  });
  const group = (label: string, ...items: ToolbarItem[]): ToolbarGroup => ({ label, items });
  // Word's large buttons: copies, so the default toolbar's items stay as they are.
  const large = (item: ToolbarItem): ToolbarItem => ({ ...item, size: "large" });
  return [
    {
      key: "home",
      label: "Home",
      items: [
        group("Undo", t.undo, t.redo),
        group("Clipboard", t.formatPainter),
        {
          ...group(
            "Font",
            t.font,
            t.size,
            t.growFont,
            t.shrinkFont,
            t.changeCase,
            t.clearFormatting,
            t.bold,
            t.italic,
            t.underline,
            t.underlineStyle,
            t.strike,
            t.subscript,
            t.superscript,
            t.textColor,
            t.highlight,
          ),
          wrapBefore: "bold",
          launcher: t.fontSettings,
        },
        {
          ...group(
            "Paragraph",
            t.bulletList,
            t.orderedList,
            t.outdent,
            t.indent,
            t.formattingMarks,
            t.alignStart,
            t.alignCenter,
            t.alignEnd,
            t.alignJustify,
            t.lineSpacing,
            t.shading,
            t.borders,
          ),
          wrapBefore: "align-start",
          launcher: t.paragraphSettings,
        },
        group("Styles", t.styleGallery),
        group("Editing", t.navigate),
      ],
    },
    {
      key: "insert",
      label: "Insert",
      items: [
        group("Pages", t.pageBreak, t.horizontalRule),
        group("Tables", large(t.table)),
        group("Illustrations", large(t.picture)),
        group("Links", t.link, t.crossReference),
        group("Header & Footer", t.headerFooter, t.pageNumber),
        group("Text", large(t.textBox), t.controls, t.controlProperties, t.fields, t.date),
      ],
    },
    {
      key: "design",
      label: "Design",
      items: [
        group("Page Background", large(t.watermark), large(t.pageColor), large(t.pageBorders)),
      ],
    },
    {
      key: "layout",
      label: "Layout",
      items: [
        {
          ...group(
            "Page Setup",
            large(t.margins),
            large(t.orientation),
            large(t.pageSize),
            large(t.columns),
            t.breaks,
            t.lineNumbers,
          ),
          launcher: t.pageSetup,
        },
        {
          ...group(
            "Paragraph",
            t.indentLeft,
            t.indentRight,
            t.spaceBefore,
            t.spaceAfter,
            t.outdent,
            t.indent,
            t.lineSpacing,
          ),
          wrapBefore: "spaceBefore",
          launcher: t.paragraphSettings,
        },
        group("Arrange", large(t.position), large(t.wrapText)),
      ],
    },
    {
      key: "references",
      label: "References",
      items: [
        group("Table of Contents", large(t.tableOfContents), t.updateFields),
        {
          ...group("Footnotes", large(t.footnote), t.endnote, t.goToNote, t.notes),
          launcher: t.noteOptions,
        },
        group("Captions", t.crossReference),
      ],
    },
    {
      key: "review",
      label: "Review",
      items: [
        group("Comments", large(t.newComment)),
        group("Tracking", large(t.trackChanges), t.reviewView),
        group(
          "Changes",
          large(t.acceptChange),
          large(t.rejectChange),
          t.acceptAll,
          t.rejectAll,
          t.previousChange,
          t.nextChange,
        ),
      ],
    },
    {
      key: "view",
      label: "View",
      items: [group("Show", t.ruler, t.navigationPane, t.fieldCodes, t.formattingMarks)],
    },
    {
      key: "tableDesign",
      label: "Table Design",
      contextual: true,
      visible: inTable,
      items: [group("Table Styles", t.tableStyle, t.headerRow), group("Shading", t.cellShading)],
    },
    {
      key: "tableLayout",
      label: "Table Layout",
      contextual: true,
      visible: inTable,
      items: [
        group("Delete", t.deleteRows, t.deleteColumns, t.deleteTable),
        group("Rows & Columns", t.rowAbove, t.rowBelow, t.columnLeft, t.columnRight),
        group("Merge", t.mergeCells, t.splitCell),
        group("Cell Size", t.columnWidth),
      ],
    },
    {
      key: "pictureFormat",
      label: "Picture Format",
      contextual: true,
      visible: pictureSelected,
      items: [
        group("Picture", t.picture),
        group("Arrange", large(t.position), large(t.wrapText), t.rotateLeft, t.rotateRight),
      ],
    },
  ].map(drawIcons);
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
  columnWidth: canFormatTable,
  paragraph: isWord,
  font: isWord,
  tabs: isWord,
  pageBorders: isWord,
  watermark: isWord,
  bordersShading: (state) => paragraphBordersAt(state) !== null,
  lineNumbers: (state) => sectionAt(state) !== null,
};

/** The built-in items a comment-only toolbar keeps: commenting, review navigation, the view. */
const COMMENT_ONLY_ITEMS: ReadonlySet<string> = new Set([
  "newComment",
  "undo",
  "redo",
  "reviewView",
  "previousChange",
  "nextChange",
  "navigate",
  "navigationPane",
  "ruler",
  "fieldCodes",
]);

/**
 * Runs after every transaction: the built-ins' checks are O(selection), no transactions built;
 * an app's item without `enabled` gets a dry run of its command.
 */
const statesOf =
  (items: readonly Item[], body: Editor, commentOnly: boolean) =>
  (state: EditorState, editor: Editor): ItemState[] =>
    items.map((item) => ({
      pressed: item.pressed?.(state, editor),
      enabled:
        commentOnly && !COMMENT_ONLY_ITEMS.has(item.key)
          ? false
          : item.enabled
            ? item.enabled(state, editor)
            : item.entry
              ? // A menu's entry: its own dry run, as its menu does (theirs are cheap).
                item.entry(body).command(state)
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

/** Word's KeyTips for its tabs. */
const TAB_TIPS: Readonly<Record<string, string>> = {
  home: "H",
  insert: "N",
  design: "G",
  layout: "P",
  references: "S",
  review: "R",
  view: "W",
};

/**
 * One KeyTip each (a letter or digit; "" for none left): the one asked for, else Word's, else
 * the first letter of the name that is free, else any free letter, else a digit.
 */
function keyTipsFor(entries: readonly { tip?: string | undefined; name: string }[]): string[] {
  const taken = new Set<string>();
  const take = (c: string | undefined) => {
    const tip = c?.toUpperCase();
    if (!tip || !/^[A-Z0-9]$/.test(tip) || taken.has(tip)) return null;
    taken.add(tip);
    return tip;
  };
  const tips: (string | null)[] = entries.map((e) => take(e.tip));
  return tips.map(
    (tip, i) =>
      tip ??
      [...(entries[i]?.name ?? ""), ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789"].reduce<string | null>(
        (found, c) => found ?? take(c),
        null,
      ) ??
      "",
  );
}

/** The mounted ribbons, in order: Ctrl+F1 is the focused one's, else the first one's. */
const ribbons: { holds: (node: Node | null) => boolean }[] = [];

/** The mounted, enabled toolbars of each editor, in order: one of them opens its link dialog. */
const linkOwners = new WeakMap<Editor, LinkOwner[]>();
type LinkOwner = {
  holds: (node: Node | null) => boolean;
  disabled: boolean;
  /** Comment-only: it opens no formatting dialog (`openDialog`). */
  commentOnly: boolean;
  /** Its link dialog is open. */
  open: boolean;
  /** Its own button is asking for the link dialog now. */
  here: boolean;
};

/** ArrowRight's step (WAI-ARIA): mirrored right to left, where it goes to the previous one. */
const rightStep = (element: Element) =>
  // The `dir` attribute only where `direction` is not computed (no layout: jsdom).
  (getComputedStyle(element).direction ||
    element.closest("[dir]")?.getAttribute("dir")?.toLowerCase()) === "rtl"
    ? -1
    : 1;

/** The same groups of the same items (an inline `items` array is not a change). */
const sameGroups = (a: ToolbarGroups | undefined, b: ToolbarGroups | undefined) =>
  a === b ||
  (!!a &&
    !!b &&
    a.length === b.length &&
    a.every((group, i) => {
      const other = b[i] as ToolbarGroups[number];
      return (
        labelOf(group) === labelOf(other) &&
        launcherOf(group) === launcherOf(other) &&
        wrapOf(group) === wrapOf(other) &&
        sameItems(itemsOf(group), itemsOf(other))
      );
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
const IS_APPLE = typeof navigator !== "undefined" && /Mac|iP(hone|[oa]d)/.test(navigator.platform);

/** Keys that step a closed select box through its values. */
const STEP_KEYS = new Set(["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

export function FoliToolbar({
  editor: given,
  disabled = false,
  commentOnly = false,
  onClickCommand: givenClickCommand,
  label: givenLabel,
  className,
  comments = false,
  localFonts = true,
  units,
  upload,
  items: givenGroups,
  tabs: allTabs,
  tab: givenTab,
  defaultTab,
  onTabChange,
  collapsed: givenCollapsed,
  defaultCollapsed = false,
  onCollapsedChange,
  keyTips = true,
  overflow = "wrap",
  messages,
}: FoliToolbarProps) {
  const unit = units ?? defaultUnit();
  // A collapsed ribbon's panel shown over the document: a command run from it puts it away.
  const [floating, setFloating] = useState(false);
  const onClickCommand = () => {
    setFloating(false);
    givenClickCommand?.();
  };
  const tr = translator(messages);
  /** A label that may be one of the toolbar's messages (a built-in item's, a tab's…). */
  const trLabel = (text: string) => tr(text as ToolbarMessage);
  const label = givenLabel ?? tr("Formatting");
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
  // A collapsed ribbon: the tabs only, the panel over the document while `floating`.
  const [collapsedState, setCollapsedState] = useState(defaultCollapsed);
  const collapsed = !!tab && (givenCollapsed ?? collapsedState);
  const panelShown = !collapsed || floating;
  useEffect(() => {
    if (!collapsed) setFloating(false);
  }, [collapsed]);
  const setCollapsed = (next: boolean) => {
    const panelNow = ribbon.current?.querySelector(".foli-ribbon-panel");
    if (next && panelNow?.contains(document.activeElement)) focusTab();
    if (givenCollapsed === undefined) setCollapsedState(next);
    setFloating(false);
    onCollapsedChange?.(next);
  };
  // A pick taken out of `tabs` is forgotten: it is not selected again when the app adds it back
  // (one hidden by its `visible` stays wanted).
  // Only a key seen before: a `defaultTab` that arrives later is still wanted.
  const seenTabs = useRef(new Set<string>());
  for (const t of allTabs ?? []) seenTabs.current.add(t.key);
  const pickGone =
    tabKey !== null && seenTabs.current.has(tabKey) && !allTabs?.some((t) => t.key === tabKey);
  useEffect(() => {
    if (pickGone) setTabKey(null);
  }, [pickGone]);
  const itemGroups = tab ? tab.items : givenGroups;
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  // Without "New comment" where no comments pane lets a comment be written.
  const lastGroups = useRef(itemGroups);
  if (!sameGroups(lastGroups.current, itemGroups)) lastGroups.current = itemGroups;
  const stableGroups = lastGroups.current;
  const { groups, items, selectStates } = useMemo(() => {
    const groups = ((stableGroups ?? GROUPS) as ToolbarGroups)
      .map((group) => {
        const launcher = launcherOf(group) as Item | undefined;
        const own = (itemsOf(group) as readonly Item[]).filter(
          (item) => comments || item.key !== "newComment",
        );
        // The launcher is the group's last item, for the arrow keys and the More panel.
        return {
          label: labelOf(group),
          wrapBefore: wrapOf(group),
          launcher: own.length > 0 && launcher ? launcher : null,
          items: own.length > 0 && launcher ? [...own, launcher] : own,
        };
      })
      .filter((group) => group.items.length > 0);
    const items = groups.flatMap((group) => group.items);
    if (development()) {
      const keys = items.map((item) => item.key);
      const twice = keys.find((key, i) => keys.indexOf(key) !== i);
      if (twice !== undefined)
        console.warn(`FoliToolbar: two items have the key "${twice}"; each needs its own`);
    }
    return { groups, items, selectStates: statesOf(items, body, commentOnly) };
  }, [stableGroups, comments, body, commentOnly]);
  const states = useEditorState(selectStates, { editor, isEqual: sameStates });
  // The Font box lists the machine's fonts once read: at once when already allowed.
  // The server renders none (hydration matches); the client re-renders when they come.
  useSyncExternalStore(subscribeLocalFonts, localFontFamilies, () => NO_FONTS);
  useEffect(() => {
    if (localFonts) void loadLocalFonts(false);
  }, [localFonts]);
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
  // Before groups go under More, Word's large buttons become small: this many of the groups that
  // have one, from the end of the row.
  const [small, setSmall] = useState(0);
  const largeGroups = useMemo(
    // Groups with a button whose small form is narrower: large, or medium with an icon.
    () =>
      groups.flatMap((group, g) =>
        group.items.some(
          (i) =>
            i !== group.launcher &&
            (i.size === "large" || (i.size === "medium" && i.icon !== undefined)),
        )
          ? [g]
          : [],
      ),
    [groups],
  );
  const smallGroups = new Set(largeGroups.slice(largeGroups.length - small));
  /** While measuring: the row's width before the last group drawn small, and whether to stop. */
  const shrinking = useRef<{ from: number | null; done: boolean }>({ from: null, done: false });
  /** The row's width when it was last measured: another width measures again. */
  const measuredWidth = useRef<number | null>(null);
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
    setSmall(0);
    shrinking.current = { from: null, done: false };
    setFit(null);
  }, [overflowing, groups, panelShown]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `fitNow` reads what this effect measures.
  useIsomorphicLayoutEffect(() => {
    const element = bar.current;
    if (!overflowing || fit !== null || !element) return;
    // Too wide with large buttons left: the last group of them is drawn small first, kept so
    // only if that narrowed the row (a large button with text only is often the narrower: its
    // text wraps under the icon), else drawn large again and the shrinking stops.
    // (More is in the row while measuring, hidden: not counted, the groups may fit without it.)
    const more = moreButton.current?.getBoundingClientRect().width ?? 0;
    const before = shrinking.current.from;
    shrinking.current.from = null;
    if (before !== null && element.scrollWidth >= before - 0.5) {
      shrinking.current.done = true;
      setSmall(small - 1);
      return;
    }
    if (
      !shrinking.current.done &&
      small < largeGroups.length &&
      element.scrollWidth - more > element.clientWidth + 0.5
    ) {
      shrinking.current.from = element.scrollWidth;
      setSmall(small + 1);
      return;
    }
    measuredWidth.current = element.clientWidth;
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
  }, [overflowing, fit, groups, small]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `fitNow` reads refs only.
  useEffect(() => {
    const element = bar.current;
    if (!overflowing || !element || typeof ResizeObserver === "undefined") return;
    // Another width: the groups are counted again from what was measured (they stay where
    // they are, with their state and the focus, unless they change sides).
    const observer = new ResizeObserver(() => {
      const next = fitNow(element);
      // With large buttons, measured again only when they may change size: wider with some
      // drawn small, or narrower with groups to put under More and some still large. Otherwise
      // (a scrollbar coming) the groups stay where they are, as without large buttons.
      const width = element.clientWidth;
      const was = measuredWidth.current;
      const { large, small: smallNow } = shrinkNow.current;
      if (
        measured.current !== null &&
        was !== null &&
        ((width > was && smallNow > 0) ||
          (width < was &&
            smallNow < large &&
            !shrinking.current.done &&
            next !== null &&
            next < measured.current.ends.length))
      ) {
        measured.current = null;
        setSmall(0);
        shrinking.current = { from: null, done: false };
        setFit(null);
        return;
      }
      if (next !== null) setFit((current) => (current === null ? current : next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [overflowing]);
  const shrinkNow = useRef({ large: 0, small: 0 });
  shrinkNow.current = { large: largeGroups.length, small };
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
    if (element?.closest<HTMLElement>(".foli-ribbon-panel")?.hidden) {
      focusTab();
      return;
    }
    const closed = morePanel.current?.hidden && morePanel.current.contains(element ?? null);
    (closed ? moreButton.current : element)?.focus();
  };
  /**
   * A dialog closed: applied, the focus goes to the document (`onClickCommand`) and a panel shown
   * over it goes away (without `onClickCommand`, the focus then goes to its tab); otherwise back
   * to `restore`, its button.
   */
  const closed = (applied: boolean | undefined, restore: HTMLElement | null | undefined) => {
    if (applied && givenClickCommand) onClickCommand();
    else if (applied && floating) {
      setFloating(false);
      focusTab();
    } else giveBack(restore);
  };
  /** The focus to the selected tab (a ribbon's). */
  function focusTab() {
    tabButtons.current[tabs?.findIndex((t) => t.key === tab?.key) ?? -1]?.focus();
  }
  /** The items as last rendered: where a dialog closed later finds its button. */
  const shown = useRef(items);
  shown.current = items;
  // Whether a select box was last used with the pointer (its pick then goes back to the document).
  const pointer = useRef(false);
  // A select box's value picked with the keyboard (Up and Down on a closed box): applied on
  // Enter or when the box loses the focus, not on each value passed; Escape drops it.
  const [pending, setPending] = useState<{ key: string; value: string } | null>(null);
  // The last key on a select box steps through its values (Up, Down…): a change then is held.
  const stepped = useRef(false);
  // The open menu (a menu button's key), if any.
  const [menu, setMenu] = useState<string | null>(null);
  // The color fields behind "More colors…" (by item key), and what the last one opened on.
  const colorFields = useRef<Record<string, HTMLInputElement | null>>({});
  const customColor = useRef<{ pointer: boolean; editor: Editor; state: EditorState } | null>(null);
  // Nor does it come back with its item, once that has left the toolbar.
  // Nor stays open once its item's `enabled` says no (read-only, another selection).
  const menuGone =
    menu !== null && !items.some((item, i) => item.key === menu && states[i]?.enabled !== false);
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
    if (item.entry) {
      const action = item.entry(body);
      if (action.dialog) {
        openBuiltIn(action.dialog, buttons.current[index] ?? null);
        return;
      }
      runHere(action.command);
      if (!action.movesFocus && event.detail > 0) onClickCommand?.();
      return;
    }
    if (item.actions && !actionsOf(item, body).length) return;
    if (item.colors && !paletteOf(item.colors, editor.state).length) return;
    if (item.colors || item.actions) {
      if (menu !== item.key) {
        setMenu(item.key);
        return;
      }
      // Closing by its button: the focus was in the menu, which goes away.
      setMenu(null);
      if (event.detail > 0 && givenClickCommand) givenClickCommand();
      else buttons.current[index]?.focus();
      return;
    }
    if (!item.command) return;
    runHere(item.double && event.detail === 2 ? item.double : item.command);
    // `detail` counts pointer clicks; Enter and Space on a button give 0.
    if (event.detail > 0) onClickCommand?.();
  };

  // The link dialog opens on a request from the link button or Mod-K in the document, and
  // gives the focus back to where it was (the document, or the button) when it closes. It is
  // for the selection it opened on: a change to the document or the selection (a click in the
  // document) closes it. A second request while it is open focuses it again.
  const [dialog, setDialog] = useState<LinkDialogState | null>(null);
  // Several toolbars on one editor open one link dialog: the one already open, else the toolbar's
  // whose button asked, else the one that has the focus, else the first enabled one mounted's.
  const linkOwner = useRef<LinkOwner>({
    holds: (node: Node | null) => !!(ribbon.current ?? bar.current)?.contains(node),
    disabled,
    commentOnly,
    open: false,
    here: false,
  });
  linkOwner.current.disabled = disabled;
  linkOwner.current.commentOnly = commentOnly;
  linkOwner.current.open = dialog !== null;
  const runHere = (command: Command) => {
    linkOwner.current.here = true;
    try {
      editor.run(command);
    } finally {
      linkOwner.current.here = false;
    }
  };
  // Registered once per editor: the mount order survives `disabled` flips.
  useEffect(() => {
    const owner = linkOwner.current;
    linkOwners.set(editor, [...(linkOwners.get(editor) ?? []), owner]);
    return () => {
      linkOwners.set(
        editor,
        (linkOwners.get(editor) ?? []).filter((o) => o !== owner),
      );
    };
  }, [editor]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `openBuiltIn` only sets state and reads the editor.
  useEffect(
    () =>
      editor.subscribe((state, transactions) => {
        if (disabled) return;
        // `openDialog`: one toolbar opens it, as one opens the link dialog.
        const asked = transactions.map(requestedDialog).find((name) => name !== null);
        if (asked) {
          const active = typeof document === "undefined" ? null : document.activeElement;
          const owners = (linkOwners.get(editor) ?? []).filter(
            (owner) => !owner.disabled && !owner.commentOnly,
          );
          const owner =
            owners.find((o) => o.here) ?? owners.find((o) => o.holds(active)) ?? owners[0];
          if (owner === linkOwner.current)
            openBuiltIn(asked, active instanceof HTMLElement ? active : null);
          return;
        }
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
          // So is the paragraph dialog: its paragraphs may have changed.
          setWordDialog((current) =>
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
        const owners = (linkOwners.get(editor) ?? []).filter((owner) => !owner.disabled);
        const owner =
          owners.find((o) => o.open) ??
          owners.find((o) => o.here) ??
          owners.find((o) => o.holds(active)) ??
          owners[0];
        if (owner !== linkOwner.current) return;
        setTableDialog(null);
        setPictureDialog(null);
        setSetupDialog(null);
        setReferenceDialog(null);
        setControlDialog(null);
        setNoteDialog(null);
        setWordDialog(null);
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
    const restore = dialog?.restore;
    // What had the focus went (an app's or the picture dialog, closed for this one): the Link
    // button, else the document.
    if (restore && !restore.isConnected) {
      const link = buttons.current[shown.current.findIndex((item) => item.key === "link")];
      if (link) giveBack(link);
      else onClickCommand?.();
    } else giveBack(restore);
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
  // Word's Paragraph or Font dialog, for the selection it opened on.
  const [wordDialog, setWordDialog] = useState<{
    name:
      | "paragraph"
      | "font"
      | "tabs"
      | "pageBorders"
      | "watermark"
      | "bordersShading"
      | "lineNumbers";
    restore: HTMLElement | null;
    selection: EditorState["selection"];
  } | null>(null);
  useEffect(() => {
    if (disabled) setWordDialog(null);
  }, [disabled]);
  // The note options dialog (from the notes menu).
  const [noteDialog, setNoteDialog] = useState<{ restore: HTMLElement | null } | null>(null);
  const [columnDialog, setColumnDialog] = useState<{ restore: HTMLElement | null } | null>(null);
  useEffect(() => {
    if (disabled) setColumnDialog(null);
  }, [disabled]);
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
      noteDialog ||
      columnDialog ||
      wordDialog,
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
  // A built-in dialog closed by the editor (an edit or a selection from elsewhere), not by its
  // own buttons: the focus it held went with it, back to where it came from.
  const openDialog =
    dialog ??
    tableDialog ??
    pictureDialog ??
    setupDialog ??
    referenceDialog ??
    controlDialog ??
    noteDialog ??
    columnDialog ??
    wordDialog;
  const lastRestore = useRef<HTMLElement | null | undefined>(undefined);
  useEffect(() => {
    const was = lastRestore.current;
    lastRestore.current = openDialog ? openDialog.restore : undefined;
    if (openDialog || was === undefined || typeof document === "undefined") return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    if (was?.isConnected) giveBack(was);
    else onClickCommand?.();
  });

  // One dialog at a time: opening one closes the rest (`keep` reopens itself, counting requests).
  // A built-in dialog, from its menu entry or from an item that names it; the focus goes back
  // to `restore` when it closes.
  function openBuiltIn(name: ToolbarDialogName, restore: HTMLElement | null) {
    const { selection } = editor.state;
    if (name === "link") {
      // As Mod-K: the toolbar hears the request (and keeps the focus to give back).
      runHere(openLinkEditor);
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
      else if (
        name === "paragraph" ||
        name === "font" ||
        name === "tabs" ||
        name === "pageBorders" ||
        name === "watermark" ||
        name === "bordersShading" ||
        name === "lineNumbers"
      )
        setWordDialog({ name, restore, selection });
      else if (name === "columnWidth") setColumnDialog({ restore });
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
    setColumnDialog(null);
    setWordDialog(null);
  }

  // Another tab: its items from the first, and nothing of the last tab's left open.
  // A pick: the app's to follow when it passes `tab`. Picking the tab that shows only because
  // the wanted one went (a tab with `visible`) is a pick too.
  const showTab = (next: ToolbarTab, open = false) => {
    // Collapsed: a click (Enter, ArrowDown) shows the tab's panel over the document, or puts the
    // shown one away; the arrow keys between tabs only pick.
    if (collapsed && open) setFloating(!(floating && next.key === tab?.key));
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
    const right = rightStep(event.currentTarget);
    const moves: Record<string, number> = {
      ArrowRight: (at + right + count) % count,
      ArrowLeft: (at - right + count) % count,
      Home: 0,
      End: count - 1,
    };
    if (event.key === "ArrowDown") {
      // Into the panel (Word's): a collapsed ribbon shows it first.
      event.preventDefault();
      if (panelShown) buttons.current[active]?.focus();
      else {
        focusInto.current = true;
        setFloating(true);
      }
      return;
    }
    const next = tabs[moves[event.key] ?? -1];
    if (!next) return;
    event.preventDefault();
    showTab(next);
    tabButtons.current[tabs.indexOf(next)]?.focus();
  };
  // The panel a key opened over the document takes the focus.
  const focusInto = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the panel shows.
  useEffect(() => {
    if (!floating || !focusInto.current) return;
    focusInto.current = false;
    buttons.current[active]?.focus();
  }, [floating]);
  // The panel over the document goes with a press elsewhere (a dialog of the toolbar's is not
  // elsewhere: it comes from the panel).
  useEffect(() => {
    if (!floating) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (ribbon.current?.contains(target) || target?.closest?.(".foli-link-dialog")) return;
      setFloating(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [floating]);
  // Ctrl+F1 collapses or pins the ribbon that has the focus, else the first one mounted.
  const toggleCollapsed = useRef(() => {});
  toggleCollapsed.current = () => setCollapsed(!collapsed);
  const hasRibbon = !!tab;
  const ribbonOwner = useRef<(typeof ribbons)[number] | null>(null);
  useEffect(() => {
    if (!hasRibbon) return;
    const owner = { holds: (node: Node | null) => !!ribbon.current?.contains(node) };
    ribbons.push(owner);
    ribbonOwner.current = owner;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "F1" || !event.ctrlKey || event.altKey || event.shiftKey || event.metaKey)
        return;
      const focused = document.activeElement;
      if ((ribbons.find((o) => o.holds(focused)) ?? ribbons[0]) !== owner) return;
      event.preventDefault();
      toggleCollapsed.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      ribbons.splice(ribbons.indexOf(owner), 1);
    };
  }, [hasRibbon]);
  // KeyTips: none, the tabs', or the shown tab's items'.
  const [tips, setTips] = useState<null | "tabs" | "items">(null);
  const tabTips =
    tips && tabs
      ? keyTipsFor(tabs.map((t) => ({ tip: t.keyTip ?? TAB_TIPS[t.key], name: trLabel(t.label) })))
      : [];
  const itemTips =
    tips === "items"
      ? keyTipsFor(items.map((i) => ({ tip: i.keyTip, name: trLabel(i.text ?? i.label) })))
      : [];
  /** What the keys see, as rendered last. */
  const tipsNow = useRef({
    tips,
    tabTips,
    itemTips,
    tabs,
    firstInMore,
    moreOpen,
    disabled,
    collapsed,
  });
  tipsNow.current = {
    tips,
    tabTips,
    itemTips,
    tabs,
    firstInMore,
    moreOpen,
    disabled,
    collapsed,
  };
  const showTabNow = useRef(showTab);
  showTabNow.current = showTab;
  const useTips = hasRibbon && keyTips;
  useEffect(() => {
    if (!useTips) return;
    // Alt pressed and released with nothing between: armed by its keydown.
    let armed = false;
    const mine = () => {
      const focused = document.activeElement;
      // The ribbon that has the focus, else (the focus in a document) the first one mounted.
      const editable =
        focused === document.body || (focused instanceof HTMLElement && focused.isContentEditable);
      const owner = ribbons.find((o) => o.holds(focused)) ?? (editable ? ribbons[0] : undefined);
      return owner !== undefined && owner === ribbonOwner.current;
    };
    const press = (index: number) => {
      const { firstInMore: inMoreFrom, moreOpen: open } = tipsNow.current;
      const press = () => {
        const element = buttons.current[index];
        if (!element) return;
        element.focus();
        if (!(element instanceof HTMLSelectElement)) element.click();
      };
      if (index >= inMoreFrom && !open) {
        setMoreOpen(true);
        setTimeout(press);
      } else press();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const now = tipsNow.current;
      if (!now.tips) {
        armed =
          event.key === "Alt" &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          !now.disabled;
        return;
      }
      armed = false;
      const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
      const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
      if (key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setTips(now.tips === "items" ? "tabs" : null);
        return;
      }
      if (!plain || !/^[A-Z0-9]$/.test(key)) {
        setTips(null);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (now.tips === "tabs") {
        const t = now.tabs?.[now.tabTips.indexOf(key)];
        if (!t) return;
        // Its panel shows (over the document when collapsed), also when it already did.
        showTabNow.current(t);
        if (now.collapsed) setFloating(true);
        setTips("items");
        return;
      }
      const index = now.itemTips.indexOf(key);
      if (index < 0) return;
      setTips(null);
      press(index);
    };
    const onKeyUp = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Alt" || !armed) return;
      armed = false;
      if (!mine()) return;
      // Firefox would open its menu bar on this Alt.
      event.preventDefault();
      setTips((current) => (current ? null : "tabs"));
    };
    const off = () => {
      armed = false;
      if (tipsNow.current.tips) setTips(null);
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
    document.addEventListener("pointerdown", off, true);
    window.addEventListener("blur", off);
    return () => {
      setTips(null);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keyup", onKeyUp, true);
      document.removeEventListener("pointerdown", off, true);
      window.removeEventListener("blur", off);
    };
  }, [useTips]);
  useEffect(() => {
    if (disabled) setTips(null);
  }, [disabled]);
  // The letters over the tabs and items they press (positions read after layout).
  const [badges, setBadges] = useState<{ tip: string; x: number; y: number }[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: placed again whenever they show.
  useIsomorphicLayoutEffect(() => {
    const root = ribbon.current;
    if (!tips || !root) {
      setBadges((current) => (current.length ? [] : current));
      return;
    }
    const box = root.getBoundingClientRect();
    const place = (element: HTMLElement | null | undefined, tip: string) => {
      const rect = element?.getBoundingClientRect();
      // Not shown (in a closed More panel): no letter to see.
      if (!rect || !tip || (rect.width === 0 && rect.height === 0)) return [];
      return [{ tip, x: rect.left - box.left + rect.width / 2, y: rect.bottom - box.top }];
    };
    setBadges(
      tips === "tabs"
        ? tabTips.flatMap((tip, n) => place(tabButtons.current[n], tip))
        : itemTips.flatMap((tip, i) => place(buttons.current[i], tip)),
    );
  }, [tips, tab?.key, floating, items, fit, small]);
  // With tabs, a ribbon: the tab list and the selected tab's panel, which holds the toolbar.
  const panel = (bar: ReactNode) =>
    tabs && tab ? (
      // biome-ignore lint/a11y/noStaticElementInteractions: it only notes whether the focus is inside.
      <div
        ref={ribbon}
        className={[
          "foli-ribbon",
          collapsed && "foli-ribbon-collapsed",
          collapsed && floating && "foli-ribbon-floating",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        onFocus={() => {
          ribbonFocused.current = true;
        }}
        onBlur={(event) => {
          const to = event.relatedTarget as Element | null;
          // Not fired when the focused element is removed: the flag then stays.
          if (!event.currentTarget.contains(to)) {
            ribbonFocused.current = false;
            // Tabbing out puts the panel over the document away (not into its own dialog).
            if (to && !to.closest(".foli-link-dialog")) setFloating(false);
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.defaultPrevented || !floating) return;
          event.preventDefault();
          setFloating(false);
          tabButtons.current[tabs.findIndex((t) => t.key === tab.key)]?.focus();
        }}
      >
        {badges.length > 0 && (
          <div className="foli-keytips" aria-hidden="true">
            {badges.map((b) => (
              <span key={b.tip} className="foli-keytip" style={{ left: b.x, top: b.y }}>
                {b.tip}
              </span>
            ))}
          </div>
        )}
        <div className="foli-ribbon-head">
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
                className={`foli-ribbon-tab foli-ribbon-tab-${t.key}${t.contextual ? " foli-ribbon-tab-contextual" : ""}`}
                aria-selected={t.key === tab.key}
                aria-controls={`${id}-panel`}
                tabIndex={t.key === tab.key ? 0 : -1}
                // Keep the focus (and the selection) in the document on click.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => showTab(t, true)}
                onDoubleClick={() => setCollapsed(!collapsed)}
              >
                {trLabel(t.label)}
              </button>
            ))}
          </div>
        </div>
        <div
          role="tabpanel"
          id={`${id}-panel`}
          aria-labelledby={`${id}-tab-${tabs.findIndex((t) => t.key === tab.key)}`}
          className="foli-ribbon-panel"
          hidden={!panelShown}
          // A tab without items has nothing to focus: the panel takes the tab stop.
          tabIndex={items.length ? undefined : 0}
        >
          {bar}
        </div>
        {/* After the panel: Tab goes from the tabs into the toolbar, then here. */}
        <button
          type="button"
          className="foli-ribbon-collapse"
          aria-label={collapsed ? tr("Pin the ribbon") : tr("Collapse the ribbon")}
          title={collapsed ? tr("Pin the ribbon") : tr("Collapse the ribbon")}
          aria-expanded={panelShown}
          aria-controls={`${id}-panel`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? PIN_ICON : COLLAPSE_ICON}
        </button>
      </div>
    ) : (
      bar
    );

  const onKeyDown = (event: KeyboardEvent) => {
    // Alt+Left (back) and other shortcuts are the browser's.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const count = items.length;
    const right = rightStep(event.currentTarget);
    const moves: Record<string, number> = {
      ArrowRight: (active + right + count) % count,
      ArrowLeft: (active - right + count) % count,
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
        {tr("More")}
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
            aria-label={tr("More")}
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
    <MessagesContext.Provider value={messages}>
      <UnitContext.Provider value={unit}>
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
                  const launcher = item === group.launcher;
                  const drawn = smallGroups.has(g) ? undefined : item.size;
                  const large = drawn === "large";
                  const medium = drawn === "medium" && item.icon !== undefined;
                  // Inserting a picture needs the app's upload; editing a selected one does not.
                  // A menu without entries (or colors) cannot open, whatever its `enabled` says.
                  const off =
                    disabled ||
                    !state?.enabled ||
                    (item.dialog === "picture" && state?.value === "insert" && !upload) ||
                    (item.actions !== undefined && actionsOf(item, body).length === 0) ||
                    (item.colors !== undefined &&
                      paletteOf(item.colors, editor.state).length === 0);
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
                    const held = pending?.key === item.key ? pending.value : null;
                    const apply = () => {
                      setPending(null);
                      if (held !== null && held !== value && !off) editor.run(select.pick(held));
                    };
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
                        aria-label={trLabel(item.label)}
                        title={trLabel(item.label)}
                        // Still focusable when it cannot apply, like the buttons.
                        aria-disabled={off || undefined}
                        tabIndex={i === active ? 0 : -1}
                        value={held ?? value}
                        onFocus={() => setActive(i)}
                        // Leaving it another way than Tab (a click in the document) drops it: the
                        // selection it was stepped on may be gone.
                        onBlur={() => setPending(null)}
                        onMouseDown={() => {
                          pointer.current = true;
                          stepped.current = false;
                          // Opening the built-in Font box asks for the machine's fonts (a gesture).
                          if (localFonts && select.options === fontOptions)
                            void loadLocalFonts(true);
                        }}
                        onKeyDown={(event) => {
                          pointer.current = false;
                          // Keys that open the list (Alt+Down too), not the arrows that step it: a
                          // prompt taking the focus would drop the stepped value.
                          if (
                            localFonts &&
                            select.options === fontOptions &&
                            (OPEN_KEYS.has(event.key) ||
                              (event.altKey && event.key === "ArrowDown"))
                          )
                            void loadLocalFonts(true);
                          // Alt+Down opens the list, and on Apple platforms the arrows do: a pick
                          // there is a pick, applied at once.
                          stepped.current = STEP_KEYS.has(event.key) && !event.altKey && !IS_APPLE;
                          if (event.key === "Tab") apply();
                          if (event.key === "Escape" && held !== null) {
                            event.preventDefault();
                            event.stopPropagation();
                            setPending(null);
                          }
                        }}
                        // After the change an open list's Enter makes.
                        onKeyUp={(event) => {
                          if (event.key === "Enter") apply();
                        }}
                        onChange={(event) => {
                          if (off) return;
                          if (stepped.current) {
                            setPending({ key: item.key, value: event.target.value });
                            return;
                          }
                          setPending(null);
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
                            {DATA_BOXES.has(item.key) ? o.label : trLabel(o.label)}
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
                      className={`foli-toolbar-button foli-toolbar-${item.key}${launcher ? " foli-toolbar-launcher" : large ? " foli-toolbar-large" : medium ? " foli-toolbar-medium" : ""}`}
                      // Speech input users say what they see: "H1", "Undo"; symbols get a name.
                      // A large button shows its text, which names it.
                      aria-label={
                        launcher || (item.icon !== undefined && !large && !medium)
                          ? trLabel(item.label)
                          : undefined
                      }
                      title={trLabel(item.label)}
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
                      {/* A letter for an icon (B for bold) is a message too. */}
                      {launcher ? (
                        LAUNCHER_ICON
                      ) : large ? (
                        <>
                          {item.icon !== undefined && (
                            <span className="foli-toolbar-large-icon" aria-hidden="true">
                              {typeof item.icon === "string" ? trLabel(item.icon) : item.icon}
                            </span>
                          )}
                          <span className="foli-toolbar-large-text">
                            {trLabel(item.text ?? item.label)}
                          </span>
                        </>
                      ) : medium ? (
                        <>
                          <span className="foli-toolbar-medium-icon" aria-hidden="true">
                            {typeof item.icon === "string" ? trLabel(item.icon) : item.icon}
                          </span>
                          <span className="foli-toolbar-medium-text">
                            {trLabel(item.text ?? item.label)}
                          </span>
                        </>
                      ) : typeof item.icon === "string" ? (
                        trLabel(item.icon)
                      ) : (
                        (item.icon ?? trLabel(item.text ?? item.label))
                      )}
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
                            label={trLabel(item.label)}
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
                  const options = item.colors && paletteOf(item.colors, editor.state);
                  if (!options || !item.colors) return button;
                  const { pick } = item.colors;
                  return (
                    <span key={item.key} className="foli-toolbar-menu">
                      {button}
                      {menu === item.key && !disabled && (
                        <ColorMenu
                          label={trLabel(item.label)}
                          options={options}
                          columns={item.colors.columns}
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
                // Word's two-row groups: the items before `wrapBefore`, then the rest (the
                // launcher stays last, in the caption's corner).
                const wrap = group.items.findIndex((item) => item.key === group.wrapBefore);
                const rows = (row: ReactNode[]) =>
                  wrap > 0 ? (
                    <>
                      <div className="foli-toolbar-row">{row.slice(0, wrap)}</div>
                      <div className="foli-toolbar-row">{row.slice(wrap)}</div>
                    </>
                  ) : (
                    row
                  );
                return (
                  <Fragment key={group.items[0]?.key}>
                    {g > 0 && <hr className="foli-toolbar-separator" aria-orientation="vertical" />}
                    {group.label === undefined ? (
                      controls
                    ) : group.launcher ? (
                      // biome-ignore lint/a11y/useSemanticElements: a fieldset cannot be a flex row in every browser.
                      <div
                        role="group"
                        aria-label={trLabel(group.label)}
                        className="foli-toolbar-group"
                      >
                        <div
                          className={`foli-toolbar-group-items${wrap > 0 ? " foli-toolbar-group-rows" : ""}`}
                        >
                          {rows(controls.slice(0, -1))}
                        </div>
                        <div className="foli-toolbar-group-foot">
                          <div className="foli-toolbar-group-label" aria-hidden="true">
                            {trLabel(group.label)}
                          </div>
                          {controls.at(-1)}
                        </div>
                      </div>
                    ) : (
                      // biome-ignore lint/a11y/useSemanticElements: a fieldset cannot be a flex row in every browser.
                      <div
                        role="group"
                        aria-label={trLabel(group.label)}
                        className="foli-toolbar-group"
                      >
                        <div
                          className={`foli-toolbar-group-items${wrap > 0 ? " foli-toolbar-group-rows" : ""}`}
                        >
                          {rows(controls)}
                        </div>
                        <div className="foli-toolbar-group-label" aria-hidden="true">
                          {trLabel(group.label)}
                        </div>
                      </div>
                    )}
                  </Fragment>
                );
              }),
            )}
          </div>,
        )}
        {appDialog &&
          typeof appDialogItem?.dialog === "function" &&
          !disabled &&
          !builtInDialog && (
            <AppDialog
              // Each item's dialog is its own component: its hooks are not another dialog's.
              key={appDialogItem.key}
              label={trLabel(appDialogItem.label)}
              name={appDialogItem.key}
              content={appDialogItem.dialog}
              editor={editor}
              close={(applied) => {
                setAppDialog(null);
                // Its button as it is now: the items may have changed while it was open.
                closed(
                  applied,
                  buttons.current[
                    shown.current.findIndex((item) => item.key === appDialogItem.key)
                  ],
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
              closed(done, restore);
            }}
          />
        )}
        {setupDialog && !disabled && (
          <PageSetupDialog
            editor={editor}
            unit={unit}
            onClose={(applied) => {
              const { restore } = setupDialog;
              setSetupDialog(null);
              closed(applied, restore);
            }}
          />
        )}
        {wordDialog?.name === "paragraph" && !disabled && (
          <ParagraphDialog
            editor={editor}
            unit={unit}
            onClose={(applied) => {
              const { restore } = wordDialog;
              setWordDialog(null);
              closed(applied, restore);
            }}
            onTabs={() =>
              // After this dialog's changes (which close it): the Tabs dialog, for the same focus.
              setWordDialog({ ...wordDialog, name: "tabs", selection: editor.state.selection })
            }
          />
        )}
        {wordDialog?.name === "tabs" && !disabled && (
          <TabsDialog
            editor={editor}
            unit={unit}
            onClose={(applied) => {
              const { restore } = wordDialog;
              setWordDialog(null);
              closed(applied, restore);
            }}
          />
        )}
        {wordDialog?.name === "pageBorders" && !disabled && (
          <PageBordersDialog
            editor={editor}
            colors={themeColors(editor.state).filter(
              (c): c is ToolbarColor & { color: string; name: ToolbarMessage } =>
                c.shade === undefined && c.color !== null,
            )}
            onClose={(applied) => {
              const { restore } = wordDialog;
              setWordDialog(null);
              closed(applied, restore);
            }}
          />
        )}
        {wordDialog?.name === "lineNumbers" && !disabled && (
          <LineNumbersDialog
            editor={editor}
            unit={unit}
            onClose={(applied) => {
              const { restore } = wordDialog;
              setWordDialog(null);
              closed(applied, restore);
            }}
          />
        )}
        {wordDialog?.name === "bordersShading" && !disabled && (
          <BordersShadingDialog
            editor={editor}
            colors={themeColors(editor.state).filter(
              (c): c is ToolbarColor & { color: string; name: ToolbarMessage } =>
                c.shade === undefined && c.color !== null,
            )}
            onClose={(applied) => {
              const { restore } = wordDialog;
              setWordDialog(null);
              closed(applied, restore);
            }}
          />
        )}
        {wordDialog?.name === "watermark" && !disabled && (
          <WatermarkDialog
            editor={editor}
            fonts={fontOptions(editor.state).map((option) => option.value)}
            colors={themeColors(editor.state).filter(
              (c): c is ToolbarColor & { color: string; name: ToolbarMessage } =>
                c.shade === undefined && c.color !== null,
            )}
            upload={upload ?? undefined}
            onClose={(applied) => {
              const { restore } = wordDialog;
              setWordDialog(null);
              closed(applied, restore);
            }}
          />
        )}
        {wordDialog?.name === "font" && !disabled && (
          <FontDialog
            editor={editor}
            fonts={fontOptions(editor.state).map((option) => option.value)}
            sizes={SIZES}
            colors={themeColors(editor.state).filter(
              (c): c is ToolbarColor & { color: string; name: ToolbarMessage } =>
                c.shade === undefined && c.color !== null,
            )}
            onClose={(applied) => {
              const { restore } = wordDialog;
              setWordDialog(null);
              closed(applied, restore);
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
              closed(inserted, restore);
            }}
          />
        )}
        {columnDialog && !disabled && (
          <ColumnWidthDialog
            editor={editor}
            unit={unit}
            onClose={(applied) => {
              const { restore } = columnDialog;
              setColumnDialog(null);
              closed(applied, restore);
            }}
          />
        )}
        {noteDialog && !disabled && (
          <NoteOptionsDialog
            editor={body}
            onClose={(applied) => {
              const { restore } = noteDialog;
              setNoteDialog(null);
              closed(applied, restore);
            }}
          />
        )}
        {controlDialog && !disabled && (
          <ControlDialog
            editor={editor}
            onClose={(applied) => {
              const { restore } = controlDialog;
              setControlDialog(null);
              closed(applied, restore);
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
              closed(inserted, restore);
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
      </UnitContext.Provider>
    </MessagesContext.Provider>
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

/** A color menu's palette for `state`. */
const paletteOf = (colors: ToolbarColorMenu["colors"], state: EditorState) =>
  typeof colors.options === "function" ? colors.options(state) : colors.options;

/**
 * A color menu (WAI-ARIA menu with radio items): the current color checked and focused on
 * open; arrow keys, Home and End move (in a grid, Left and Right along a row, Up and Down along
 * a column); Enter or Space (or a click) picks; Escape closes it back to its button, Tab closes
 * it and moves on; leaving it (a click elsewhere) closes it.
 */
function ColorMenu({
  label,
  options,
  columns,
  current,
  onPick,
  onClose,
  onCustom,
}: {
  label: string;
  options: readonly ToolbarColor[];
  /** With it, the colors are swatches in a grid this wide, under the null entries. */
  columns?: number | undefined;
  current: string | null;
  onPick: (color: string | null, pointer: boolean) => void;
  onClose: (refocus: boolean) => void;
  /** With it, a last entry that asks for any color. */
  onCustom?: ((pointer: boolean) => void) | undefined;
}) {
  const t = useT();
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  // One entry checked, also when two swatches have the same color.
  const checked = options.findIndex((option) => option.color === current);
  const grid = columns !== undefined && columns > 0;
  const rows = options.flatMap((option, i) => (grid && option.color === null ? [i] : []));
  const swatches = options.flatMap((option, i) => (grid && option.color === null ? [] : [i]));
  // The entries in the order shown: the rows, the swatches, "More colors…".
  const order = [...rows, ...swatches, ...(onCustom ? [options.length] : [])];
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus once, on open.
  useEffect(() => {
    items.current[checked >= 0 ? checked : (order[0] ?? 0)]?.focus();
  }, []);

  const nameOf = (option: ToolbarColor) => {
    const name = t(option.name as ToolbarMessage);
    if (option.shade === undefined) return name;
    const percent = Math.abs(option.shade);
    return `${name}, ${option.shade > 0 ? t("Lighter {percent}%", { percent }) : t("Darker {percent}%", { percent })}`;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const count = order.length;
    const at = order.indexOf(items.current.indexOf(event.target as HTMLButtonElement));
    const step = (by: number) => (at + by + count) % count;
    const first = rows.length;
    const end = rows.length + swatches.length;
    const inGrid = grid && at >= first && at < end;
    // Up and Down in the grid: the swatch above or below, or out of the grid at its edge.
    const vertical = (by: number) => {
      const to = at + by;
      if (to >= first && to < end) return to;
      if (to >= end) return end % count;
      return first > 0 ? first - 1 : count - 1;
    };
    const moves: Record<string, number | undefined> = {
      ArrowDown: inGrid ? vertical(columns as number) : step(1),
      ArrowUp: inGrid ? vertical(-(columns as number)) : step(-1),
      ArrowRight: inGrid ? step(1) : undefined,
      ArrowLeft: inGrid ? step(-1) : undefined,
      Home: 0,
      End: count - 1,
    };
    const next = moves[event.key];
    // The toolbar's own arrow keys must not see these.
    event.stopPropagation();
    if (next !== undefined) {
      event.preventDefault();
      items.current[order[next] as number]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose(true);
    } else if (event.key === "Tab") {
      // Back to the button, then the browser's Tab moves on from it (out of the toolbar).
      onClose(true);
    }
  };

  const entry = (i: number) => {
    const option = options[i] as ToolbarColor;
    const name = nameOf(option);
    const cell = grid && option.color !== null;
    return (
      <button
        key={i}
        ref={(element) => {
          items.current[i] = element;
        }}
        type="button"
        role="menuitemradio"
        aria-checked={i === checked}
        aria-label={cell ? name : undefined}
        title={cell ? name : undefined}
        tabIndex={-1}
        className={cell ? "foli-menu-cell" : "foli-menu-item"}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => onPick(option.color, event.detail > 0)}
      >
        <span
          className="foli-menu-swatch"
          aria-hidden="true"
          style={{ background: option.color ?? "transparent" }}
        />
        {!cell && name}
      </button>
    );
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
      {grid ? (
        <>
          {rows.map(entry)}
          <div
            role="none"
            className="foli-menu-grid"
            style={{ gridTemplateColumns: `repeat(${columns}, auto)` }}
          >
            {swatches.map(entry)}
          </div>
        </>
      ) : (
        swatches.map(entry)
      )}
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
          {t("More colors…")}
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
  const t = useT();
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
      aria-label={href ? t("Edit link") : t("Add link")}
      className="foli-link-dialog"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
    >
      <form onSubmit={apply} noValidate>
        <label htmlFor={`${id}-url`}>{t("URL")}</label>
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
        <button type="submit">{t("Apply")}</button>
        {href && (
          <button type="button" onClick={remove}>
            {t("Remove link")}
          </button>
        )}
        <button type="button" onClick={onClose}>
          {t("Cancel")}
        </button>
        {invalid && (
          <p id={`${id}-error`} className="foli-link-error" role="alert">
            {t("Enter a web or email address, or a link starting with http, https, mailto or tel.")}
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
  const t = useT();
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
            {t(action.label as ToolbarMessage)}
          </button>
        ) : (
          <button key={action.key} {...props} role="menuitem">
            {t(action.label as ToolbarMessage)}
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
  const t = useT();
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
    rows: t("Enter a number of rows from 1 to {max}.", { max: MAX_TABLE_ROWS }),
    columns: t("Enter a number of columns from 1 to {max}.", { max: MAX_TABLE_COLUMNS }),
    place: t("A table cannot be inserted here: put the caret in a paragraph."),
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
      aria-label={t("Insert table")}
      className="foli-link-dialog foli-table-dialog"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose(false);
      }}
    >
      <form onSubmit={insert} noValidate>
        {field("rows", t("Rows"), rows, setRows, MAX_TABLE_ROWS, rowsField)}
        {field("columns", t("Columns"), columns, setColumns, MAX_TABLE_COLUMNS, columnsField)}
        <button type="submit">{t("Insert")}</button>
        <button type="button" onClick={() => onClose(false)}>
          {t("Cancel")}
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
  const t = useT();
  const [{ bookmarks, headings }] = useState(() => crossReferenceTargets(editor.state));
  const options = [
    ...headings.map((h) => ({
      value: `h${h.pos}`,
      label: `${"\u00a0".repeat((h.level - 1) * 2)}${h.number ? `${h.number} ` : ""}${h.text}`,
    })),
    ...bookmarks.map((b) => ({
      value: `b${b.name}`,
      label: t("Bookmark: {name}", { name: b.name }),
    })),
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
      aria-label={t("Insert cross-reference")}
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
        <label htmlFor={`${id}-target`}>{t("Refer to")}</label>
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
        <label htmlFor={`${id}-show`}>{t("Show")}</label>
        <select
          id={`${id}-show`}
          value={show}
          onChange={(event) => setShow(event.target.value as typeof show)}
        >
          <option value="text">{t("Its text")}</option>
          <option value="page">{t("Its page number")}</option>
          <option value="number">{t("Its paragraph number")}</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={link}
            onChange={(event) => setLink(event.target.checked)}
          />
          {t("Link to it")}
        </label>
        <button type="submit">{t("Insert")}</button>
        <button type="button" onClick={() => onClose(false)}>
          {t("Cancel")}
        </button>
        {failed && (
          <p className="foli-link-error" role="alert">
            {t("A cross-reference cannot be inserted here.")}
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

/** The width of the selection's table column (19.4), in the toolbar's unit: what dragging its border sets. */
function ColumnWidthDialog({
  editor,
  unit,
  onClose,
}: {
  editor: Editor;
  unit: LengthUnit;
  onClose: (applied: boolean) => void;
}) {
  const t = useT();
  const [at] = useState(() => columnAt(editor.state));
  const [width, setWidth] = useState(() => (at ? formatLength(at.width, unit) : ""));
  const [invalid, setInvalid] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);
  const apply = (event: FormEvent) => {
    event.preventDefault();
    // The width shown, unchanged: nothing to do (the unit rounds to a few twips).
    if (at && width === formatLength(at.width, unit)) {
      onClose(false);
      return;
    }
    const twips = at && toTwips(width, at.min, unit);
    if (
      !at ||
      twips === null ||
      twips > at.max ||
      !editor.run(setColumnWidth(at.pos, at.column, twips))
    ) {
      setInvalid(true);
      field.current?.focus();
      return;
    }
    onClose(true);
  };
  return (
    <div
      role="dialog"
      aria-label={t("Column width")}
      className="foli-link-dialog foli-table-dialog"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose(false);
      }}
    >
      <form onSubmit={apply} noValidate>
        <label htmlFor={`${id}-width`}>{t("Column width")}</label>
        <input
          ref={field}
          id={`${id}-width`}
          type="text"
          inputMode="decimal"
          value={width}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-error` : undefined}
          onChange={(event) => {
            setWidth(event.target.value);
            setInvalid(false);
          }}
        />
        <button type="submit">{t("Apply")}</button>
        <button type="button" onClick={() => onClose(false)}>
          {t("Cancel")}
        </button>
        {invalid && (
          <p id={`${id}-error`} className="foli-link-error" role="alert">
            {at && at.max >= at.min
              ? t("Enter a width from {min} to {max}.", {
                  // Rounded inwards: each end, typed back, is in range.
                  min: formatLength(at.min, unit, "up"),
                  max: formatLength(at.max, unit, "down"),
                })
              : t("This column cannot be made wider or narrower.")}
          </p>
        )}
      </form>
    </div>
  );
}

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
  const t = useT();
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
      aria-label={t("Note options")}
      className="foli-link-dialog foli-table-dialog"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose(false);
      }}
    >
      <form onSubmit={apply} noValidate>
        <label htmlFor={`${id}-kind`}>{t("Notes")}</label>
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
          <option value="footnote">{t("Footnotes")}</option>
          <option value="endnote">{t("Endnotes")}</option>
        </select>
        <label htmlFor={`${id}-position`}>{t("Position")}</label>
        <select
          id={`${id}-position`}
          value={values.position}
          onChange={(event) =>
            set({ position: event.target.value as NonNullable<NotePropertiesJSON["position"]> })
          }
        >
          {kind === "footnote" ? (
            <>
              <option value="pageBottom">{t("Bottom of page")}</option>
              <option value="beneathText">{t("Below text")}</option>
            </>
          ) : (
            <>
              <option value="docEnd">{t("End of document")}</option>
              <option value="sectEnd">{t("End of section")}</option>
            </>
          )}
        </select>
        <label htmlFor={`${id}-format`}>{t("Number format")}</label>
        <select
          id={`${id}-format`}
          value={values.format}
          onChange={(event) => set({ format: event.target.value })}
        >
          {NOTE_FORMATS.map(([value, label]) => (
            <option key={value} value={value}>
              {t(label)}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-start`}>{t("Start at")}</label>
        <input
          id={`${id}-start`}
          type="number"
          min={1}
          value={restarts ? "1" : start}
          disabled={restarts}
          aria-invalid={invalid || undefined}
          onChange={(event) => setStart(event.target.value)}
        />
        <label htmlFor={`${id}-restart`}>{t("Numbering")}</label>
        <select
          id={`${id}-restart`}
          value={values.restart}
          onChange={(event) =>
            set({ restart: event.target.value as NonNullable<NotePropertiesJSON["restart"]> })
          }
        >
          <option value="continuous">{t("Continuous")}</option>
          <option value="eachSect">{t("Restart each section")}</option>
          {kind === "footnote" && <option value="eachPage">{t("Restart each page")}</option>}
        </select>
        <button type="submit">{t("Apply")}</button>
        <button type="button" onClick={() => onClose(false)}>
          {t("Cancel")}
        </button>
        {invalid && (
          <p className="foli-link-error" role="alert">
            {t("The start must be a whole number from 1.")}
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
  const t = useT();
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
      aria-label={t("Content control properties")}
      className="foli-link-dialog foli-table-dialog"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose(false);
      }}
    >
      <form onSubmit={apply} noValidate>
        <label htmlFor={`${id}-title`}>{t("Title")}</label>
        <input
          ref={first}
          id={`${id}-title`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <label htmlFor={`${id}-tag`}>{t("Tag")}</label>
        <input id={`${id}-tag`} value={tag} onChange={(event) => setTag(event.target.value)} />
        <label>
          <input
            type="checkbox"
            checked={noDelete}
            onChange={(event) => setNoDelete(event.target.checked)}
          />
          {t("The control cannot be deleted")}
        </label>
        <label>
          <input
            type="checkbox"
            checked={noEdit}
            onChange={(event) => setNoEdit(event.target.checked)}
          />
          {t("The contents cannot be edited")}
        </label>
        {hasList && (
          <>
            <label htmlFor={`${id}-items`}>{t("List items, one per line (shown | value)")}</label>
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
            <label htmlFor={`${id}-format`}>{t("Date format")}</label>
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
            {t("Allow line breaks")}
          </label>
        )}
        <button type="submit">{t("OK")}</button>
        <button type="button" onClick={() => onClose(false)}>
          {t("Cancel")}
        </button>
      </form>
    </div>
  );
}

const MAX_TWIPS = 31_680;
/** Word's limit on a section's columns. */
const MAX_SECTION_COLUMNS = 45;
/** A length typed in `unit` (or with a unit of its own) as twips, or null when not one in range. */
function toTwips(text: string, min: number, unit: LengthUnit): number | null {
  const twips = parseLength(text, unit);
  return twips !== null && twips >= min && twips <= MAX_TWIPS ? twips : null;
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
const SETUP_LABELS: Record<SetupField, ToolbarMessage> = {
  width: "Page width",
  height: "Page height",
  top: "Top margin",
  bottom: "Bottom margin",
  left: "Left margin",
  right: "Right margin",
  count: "Columns",
  space: "Space between columns",
  widths: "Set column widths (separated by ;)",
};

/**
 * The page setup dialog, for the caret's section: how it starts, its page size and orientation,
 * margins and columns (equal, or set widths; the line between them), in centimetres. Only what
 * was changed is applied. Apply and Cancel; Escape cancels; a wrong field is marked and announced.
 */
function PageSetupDialog({
  editor,
  unit,
  onClose,
}: {
  editor: Editor;
  unit: LengthUnit;
  /** `applied`: the setup changed (the focus may go to the document). */
  onClose: (applied: boolean) => void;
}) {
  const t = useT();
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
      width,
      height,
      fields: {
        width: formatLength(width, unit),
        height: formatLength(height, unit),
        top: formatLength(Math.abs(m.top ?? 1440), unit),
        bottom: formatLength(Math.abs(m.bottom ?? 1440), unit),
        left: formatLength(m.left ?? 1440, unit),
        right: formatLength(m.right ?? 1440, unit),
        count: String(set.length || (setup.columns?.count ?? 1)),
        space: formatLength(setup.columns?.space ?? 720, unit),
        widths: set.map((column) => formatLength(column.width, unit)).join("; "),
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
      // A side swapped by the orientation, untouched: its exact twips, not the rounded text.
      const other = field === "width" ? "height" : field === "height" ? "width" : null;
      if (other && fields[field] === initial.fields[other]) {
        lengths[field] = other === "width" ? initial.width : initial.height;
        continue;
      }
      const twips = toTwips(fields[field], field === "width" || field === "height" ? 1 : 0, unit);
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
      const space = changed("space") ? toTwips(fields.space, 0, unit) : (before?.space ?? 720);
      if (space === null) return wrong("space");
      let widths: (number | null)[] = set.map((column) => column.width);
      if (changed("widths"))
        widths = fields.widths.trim()
          ? fields.widths
              .trim()
              .split(";")
              .map((width) => width.trim())
              .filter(Boolean)
              .map((width) => toTwips(width, 1, unit))
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
      <label htmlFor={`${id}-${name}`}>{t(SETUP_LABELS[name])}</label>
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
      aria-label={t("Page setup")}
      className="foli-link-dialog foli-setup-dialog"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose(false);
      }}
    >
      <form onSubmit={apply} noValidate>
        <div className="foli-setup-field">
          <label htmlFor={`${id}-start`}>{t("Section starts")}</label>
          <select
            ref={first}
            id={`${id}-start`}
            value={start}
            onChange={(event) => setStart(event.target.value)}
          >
            {SECTION_STARTS.map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </select>
        </div>
        <div className="foli-setup-field">
          <label htmlFor={`${id}-orientation`}>{t("Orientation")}</label>
          <select
            id={`${id}-orientation`}
            value={orientation}
            onChange={(event) => setOrientationSwapping(event.target.value)}
          >
            <option value="portrait">{t("Portrait")}</option>
            <option value="landscape">{t("Landscape")}</option>
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
          <label htmlFor={`${id}-separator`}>{t("Line between columns")}</label>
        </div>
        {field("widths")}
        <button type="submit">{t("Apply")}</button>
        <button type="button" onClick={() => onClose(false)}>
          {t("Cancel")}
        </button>
        {error && (
          <p id={`${id}-error`} className="foli-link-error" role="alert">
            {error === "setup"
              ? t("This setup leaves no room for text, or its columns do not fit the page.")
              : error === "mismatch"
                ? t(
                    "The number of columns differs from the set widths: list one width per column, or clear them for equal columns.",
                  )
                : t("Check this value: {field}.", { field: t(SETUP_LABELS[error]) })}
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
type CropSide = "left" | "top" | "right" | "bottom";
const CROP_SIDES: readonly CropSide[] = ["left", "top", "right", "bottom"];

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
  const t = useT();
  const picture = pos === null ? null : editor.state.doc.nodeAt(pos);
  const attrs = picture?.attrs ?? {};
  const px = (emu: unknown) => String(Math.round(Number(emu) / EMU_PER_PX));
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState(String(attrs.alt ?? ""));
  const [decorative, setDecorative] = useState(attrs.decorative === true);
  const [width, setWidth] = useState(picture ? px(attrs.width) : "");
  const [height, setHeight] = useState(picture ? px(attrs.height) : "");
  const [keep, setKeep] = useState(true);
  // Rotation in degrees, crop in percent (19.5): the model's 60 000ths and 1000ths shown plainly.
  const shownRotation = String(Number(((Number(attrs.rotation) || 0) / 60_000).toFixed(2)));
  const [rotation, setRotation] = useState(shownRotation);
  const cropAttr = (attrs.crop ?? {}) as Record<string, number | undefined>;
  const percent = (side: string) => String((cropAttr[side] ?? 0) / 1000);
  // A file's crop or rotation the model does not hold (a JSON document of 1.0 to 1.3: only in
  // the drawing's XML): not edited here, where it would show as none and be lost.
  const ext = typeof attrs.ext === "string" ? attrs.ext : "";
  const fileCrops = attrs.crop == null && /<(?:\w+:)?srcRect\b/.test(ext);
  const fileTurns = attrs.rotation == null && /<(?:\w+:)?xfrm\b[^>]*\brot="/.test(ext);
  /** The picture's size (px) once cropped as `sides` say (percent), the image's scale kept. */
  const croppedSize = (sides: Record<CropSide, string>) => {
    const n = (side: CropSide) => Number(sides[side].trim().replace(",", ".") || "0");
    const was = (a: CropSide, b: CropSide) =>
      100 - ((cropAttr[a] ?? 0) + (cropAttr[b] ?? 0)) / 1000;
    const across = 100 - n("left") - n("right");
    const down = 100 - n("top") - n("bottom");
    if (!(across > 0 && down > 0)) return null;
    return {
      width: Math.round((Number(attrs.width) / EMU_PER_PX / was("left", "right")) * across),
      height: Math.round((Number(attrs.height) / EMU_PER_PX / was("top", "bottom")) * down),
    };
  };
  const [crop, setCrop] = useState<Record<CropSide, string>>(() => ({
    left: percent("left"),
    top: percent("top"),
    right: percent("right"),
    bottom: percent("bottom"),
  }));
  const [error, setError] = useState<
    "file" | "alt" | "size" | "rotation" | "crop" | "failed" | null
  >(null);
  const rotationField = useRef<HTMLInputElement>(null);
  const cropField = useRef<HTMLInputElement>(null);
  const cropLabels: Record<CropSide, string> = {
    left: t("Left"),
    top: t("Top"),
    right: t("Right"),
    bottom: t("Bottom"),
  };
  /** The rotation field turned by `by` degrees, kept from 0 to 360. */
  const rotateBy = (by: number) => {
    const now = Number(rotation.trim().replace(",", ".") || "0");
    if (!Number.isFinite(now)) {
      fail("rotation");
      return;
    }
    setRotation(String(Number(((((now + by) % 360) + 360) % 360).toFixed(2))));
    setError(null);
  };
  const [busy, setBusy] = useState(false);
  const fileField = useRef<HTMLInputElement>(null);
  const altField = useRef<HTMLInputElement>(null);
  const decorativeField = useRef<HTMLInputElement>(null);
  const widthField = useRef<HTMLInputElement>(null);
  const id = useId();
  const tracking = trackState(editor.state)?.on === true;
  // What keeps its proportions: the size the fields show (after a crop typed in, its own).
  const ratio = Number(width) > 0 && Number(height) > 0 ? Number(height) / Number(width) : 1;
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
    file: t("Choose an image file."),
    alt: t("Describe the picture, or mark it as decorative."),
    size: t("Enter a width and height in pixels, from 1 to {max}.", { max: MAX_PICTURE_PX }),
    rotation: t("Enter a rotation in degrees."),
    crop: t("Enter what to crop in percent, leaving some of the picture."),
    failed: t("The picture could not be inserted: the file could not be read or uploaded here."),
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
      rotation: rotationField,
      crop: cropField,
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
      const cropChanged =
        !tracking && !fileCrops && CROP_SIDES.some((side) => crop[side] !== percent(side));
      // The size a crop gives is what the fields follow: only a size typed besides is applied.
      const fromCrop = cropChanged ? croppedSize(crop) : null;
      const sizeChanged = fromCrop
        ? w !== fromCrop.width || h !== fromCrop.height
        : w !== Number(px(attrs.width)) || h !== Number(px(attrs.height));
      const valid = (n: number) => Number.isFinite(n) && n >= 1 && n <= MAX_PICTURE_PX;
      if (sizeChanged && !tracking && !(valid(w) && valid(h))) {
        fail("size");
        return;
      }
      const turned = Number(rotation.trim().replace(",", "."));
      // Against what the field showed: an untouched field changes nothing.
      const rotationChanged = !tracking && !fileTurns && rotation.trim() !== shownRotation;
      if (rotationChanged && (!rotation.trim() || !Number.isFinite(turned))) {
        fail("rotation");
        return;
      }
      const cut = Object.fromEntries(
        CROP_SIDES.map((side) => [side, Number(crop[side].trim().replace(",", ".") || "0")]),
      ) as Record<CropSide, number>;
      // Negative sides add space around the image, as Word's do.
      const cropValid =
        CROP_SIDES.every((side) => Number.isFinite(cut[side]) && cut[side] > -1000) &&
        cut.left + cut.right < 100 &&
        cut.top + cut.bottom < 100;
      if (cropChanged && !cropValid) {
        fail("crop");
        return;
      }
      // Crop first, refused as a whole (too small or too large a picture would come of it).
      if (
        cropChanged &&
        !editor.run(
          setPictureCrop(
            pos,
            Object.fromEntries(CROP_SIDES.map((side) => [side, cut[side] * 1000])),
          ),
        )
      ) {
        fail("crop");
        return;
      }
      editor.run(setPictureAlt(pos, alt, decorative));
      if (rotationChanged) editor.run(setPictureRotation(pos, turned * 60_000));
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
      aria-label={pos === null ? t("Insert picture") : t("Edit picture")}
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
            <label htmlFor={`${id}-file`}>{t("Image")}</label>
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
        <label htmlFor={`${id}-alt`}>{t("Alt text")}</label>
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
          {t("Decorative (no alt text)")}
        </label>
        {pos !== null && (
          <>
            <label htmlFor={`${id}-width`}>{t("Width (px)")}</label>
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
            <label htmlFor={`${id}-height`}>{t("Height (px)")}</label>
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
              {t("Keep proportions")}
            </label>
            <label htmlFor={`${id}-rotation`}>{t("Rotation (degrees)")}</label>
            <input
              ref={rotationField}
              id={`${id}-rotation`}
              type="text"
              inputMode="decimal"
              value={rotation}
              disabled={tracking || fileTurns}
              aria-invalid={invalid("rotation")}
              aria-describedby={
                [described("rotation"), sizeNote].filter(Boolean).join(" ") || undefined
              }
              onChange={(event) => {
                setRotation(event.target.value);
                setError(null);
              }}
            />
            <button
              type="button"
              disabled={tracking || fileTurns}
              aria-describedby={sizeNote}
              onClick={() => rotateBy(-90)}
            >
              {t("Rotate left 90°")}
            </button>
            <button
              type="button"
              disabled={tracking || fileTurns}
              aria-describedby={sizeNote}
              onClick={() => rotateBy(90)}
            >
              {t("Rotate right 90°")}
            </button>
            <fieldset
              className="foli-picture-crop"
              disabled={tracking || fileCrops}
              aria-describedby={sizeNote ?? (fileCrops ? `${id}-file-crop` : undefined)}
            >
              <legend>{t("Crop (%)")}</legend>
              {CROP_SIDES.map((side, i) => (
                <span key={side}>
                  <label htmlFor={`${id}-crop-${side}`}>{cropLabels[side]}</label>
                  <input
                    ref={i === 0 ? cropField : undefined}
                    id={`${id}-crop-${side}`}
                    type="text"
                    inputMode="decimal"
                    value={crop[side]}
                    aria-invalid={invalid("crop")}
                    aria-describedby={described("crop")}
                    onChange={(event) => {
                      const next = { ...crop, [side]: event.target.value };
                      setCrop(next);
                      setError(null);
                      // The size follows what shows, the image's scale kept.
                      const size = croppedSize(next);
                      if (size) {
                        setWidth(String(size.width));
                        setHeight(String(size.height));
                      }
                    }}
                  />
                </span>
              ))}
            </fieldset>
            {tracking && (
              <p id={sizeNote}>
                {t("The size, rotation and crop do not change while changes are tracked.")}
              </p>
            )}
            {(fileCrops || fileTurns) && (
              <p id={`${id}-file-crop`}>
                {t("This picture's crop or rotation is the file's: import it again to change it.")}
              </p>
            )}
          </>
        )}
        {/* Not `disabled` while uploading: the focus stays on it (Escape still cancels). */}
        <button type="submit" aria-disabled={busy || undefined}>
          {pos === null ? t("Insert") : t("Apply")}
        </button>
        <button type="button" onClick={() => onClose(false)}>
          {t("Cancel")}
        </button>
        <p role="status" className="foli-picture-status">
          {busy ? t("Inserting the picture…") : ""}
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
