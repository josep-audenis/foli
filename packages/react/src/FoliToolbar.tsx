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
  items?: readonly (readonly ToolbarItem[])[] | undefined;
  className?: string | undefined;
}

/** What every toolbar item has. */
interface ToolbarItemBase {
  /** Unique in the toolbar; also its class, `foli-toolbar-<key>`. */
  readonly key: string;
  /** What it does: the tooltip, and the accessible name when an `icon` stands for the text. */
  readonly label: string;
  /** Visible text, which is then the accessible name (default `label`). */
  readonly text?: string | undefined;
  /** Shown instead of the text (a symbol or an SVG): `label` is then the accessible name. */
  readonly icon?: ReactNode | undefined;
  /**
   * Whether it can be used now. Default: a button's dry run of its `command` (`editor.can`); for
   * a menu, whether it has entries; a box or a color menu, always (its `pick` is not dry-run).
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
}

/** A toolbar menu button: a WAI-ARIA menu of its `actions`. */
export interface ToolbarMenu extends ToolbarItemBase {
  /**
   * Its entries, in order, or a function of the body's editor making them (as the built-in
   * menus do). Each entry is dry-run when the menu opens; without entries the button is disabled.
   */
  readonly actions: readonly ToolbarAction[] | ((editor: Editor) => readonly ToolbarAction[]);
  readonly command?: undefined;
  readonly pressed?: undefined;
  readonly select?: undefined;
  readonly colors?: undefined;
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
    /** Its entries now. Runs on every render of the toolbar: keep it cheap. */
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
  };
  readonly command?: undefined;
  readonly actions?: undefined;
  readonly select?: undefined;
}

/**
 * A toolbar item, built-in (`toolbarItems`) or the app's own: a button running a command, a
 * menu button, a box or a color menu. The toolbar keeps one tab stop for all its items (arrow keys, Home and End move
 * between them), gives toggles `aria-pressed` and an item that cannot apply now `aria-disabled`
 * (still focusable), and leaves the focus and selection in the document on click.
 */
export type ToolbarItem = ToolbarButton | ToolbarMenu | ToolbarSelect | ToolbarColorMenu;

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
  /** A button opening a dialog (the picture's). */
  dialog?: "picture";
  select?: ToolbarSelect["select"] | undefined;
}

/** A built-in menu's entry: it may open a dialog or move the focus. */
interface Action extends ToolbarAction {
  /** With `dialog`, `command` says whether it applies: the dialog does the rest. */
  dialog?: "insertTable" | "pageSetup" | "crossReference" | "controlProperties" | "noteOptions";
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
        : item.actions
          ? actionsOf(item, body).length > 0
          : !item.command || editor.can(item.command),
      value:
        item.colors?.value(state) ??
        item.select?.value(state) ??
        (item.dialog ? (selectedPicture(state) ? "edit" : "insert") : undefined),
    }));

/** A menu button's entries (made from the body's editor when a function). */
const actionsOf = (item: Item, body: Editor): readonly Action[] =>
  typeof item.actions === "function" ? item.actions(body) : (item.actions ?? []);

/** The same groups of the same items (an inline `items` array is not a change). */
const sameGroups = (
  a: readonly (readonly ToolbarItem[])[] | undefined,
  b: readonly (readonly ToolbarItem[])[] | undefined,
) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((group, i) => sameItems(group, b[i])));

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
  items: itemGroups,
}: FoliToolbarProps) {
  const body = useEditorOrContext(given, "FoliToolbar");
  // A story open on its page takes the formatting commands; the body otherwise.
  const editor = useActiveEditor(body);
  // Without "New comment" where no comments pane lets a comment be written.
  const lastGroups = useRef(itemGroups);
  if (!sameGroups(lastGroups.current, itemGroups)) lastGroups.current = itemGroups;
  const stableGroups = lastGroups.current;
  const { groups, items, selectStates } = useMemo(() => {
    const groups = ((stableGroups ?? GROUPS) as readonly (readonly Item[])[])
      .map((group) => group.filter((item) => comments || item.key !== "newComment"))
      .filter((group) => group.length > 0);
    const items = groups.flat();
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
  // The tab stop stays on the toolbar when items are taken away.
  const active = focused < items.length ? focused : 0;
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
      closeDialogs();
      setPictureDialog({
        pos: selected?.pos ?? null,
        selection: editor.state.selection,
        restore: buttons.current[index] ?? null,
      });
      return;
    }
    if (item.actions && !actionsOf(item, body).length) return;
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

  // One dialog at a time: opening one closes the rest (`keep` reopens itself, counting requests).
  function closeDialogs(keep?: "table") {
    setDialog(null);
    if (keep !== "table") setTableDialog(null);
    setPictureDialog(null);
    setSetupDialog(null);
    setReferenceDialog(null);
    setControlDialog(null);
    setNoteDialog(null);
  }

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
              // A menu without entries cannot open, whatever its `enabled` says.
              const off =
                disabled ||
                !state?.enabled ||
                (item.dialog === "picture" && state?.value === "insert" && !upload) ||
                (item.actions !== undefined && actionsOf(item, body).length === 0);
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
                    if (!(item.colors || item.actions) || off || event.key !== "ArrowDown") return;
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
                          if (action.dialog === "noteOptions") {
                            closeDialogs();
                            setNoteDialog({ restore: buttons.current[i] ?? null });
                            return;
                          }
                          if (action.dialog === "controlProperties") {
                            closeDialogs();
                            setControlDialog({
                              restore: buttons.current[i] ?? null,
                              selection: editor.state.selection,
                            });
                            return;
                          }
                          if (action.dialog === "crossReference") {
                            closeDialogs();
                            setReferenceDialog({
                              restore: buttons.current[i] ?? null,
                              selection: editor.state.selection,
                            });
                            return;
                          }
                          if (action.dialog === "pageSetup") {
                            closeDialogs();
                            setSetupDialog({
                              restore: buttons.current[i] ?? null,
                              selection: editor.state.selection,
                            });
                            return;
                          }
                          if (action.dialog) {
                            closeDialogs("table");
                            setTableDialog((current) => ({
                              restore: buttons.current[i] ?? null,
                              selection: editor.state.selection,
                              request: (current?.request ?? -1) + 1,
                            }));
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
      {setupDialog && !disabled && (
        <PageSetupDialog
          editor={editor}
          onClose={(applied) => {
            const { restore } = setupDialog;
            setSetupDialog(null);
            if (applied && onClickCommand) onClickCommand();
            else restore?.focus();
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
            else restore?.focus();
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
            else restore?.focus();
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
  options: readonly ToolbarColor[];
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
