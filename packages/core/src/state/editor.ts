import type { DocumentSettings, FoliDocumentV2 } from "../document.js";
import { type Attrs, type Node, type Schema, Slice } from "../model/index.js";
import type { Alignment } from "../schema.js";
import {
  createDocument,
  type FoliDocument,
  parseContent,
  parseDocument,
  type SectionJSON,
} from "../v3/document.js";
import { type Extension, schemaWith, writeCustom } from "../v3/extensions.js";
import { twipsToMm as mm } from "../v3/units.js";
import {
  baseKeymap,
  type DeleteUnit,
  deleteBackward,
  deleteForward,
  deleteSelection,
  insertHardBreak,
  insertPageBreak,
  insertText,
  isMarkActive,
  joinBackward,
  joinForward,
  selectAll,
  setBlockType,
  splitBlock,
  toggleMark,
} from "./commands.js";
import {
  addComment,
  type CommentContent,
  type CommentOptions,
  commentsPlugin,
  deleteAllComments,
  deleteComment,
  editComment,
  replyToComment,
  resolveComment,
} from "./comments.js";
import {
  type ControlValue,
  type ControlValueInput,
  controlsIn,
  controlsPlugin,
  controlValues,
  setControlValue,
} from "./controls.js";
import { type DialogName, openDialog } from "./dialogs.js";
import { fieldsPlugin } from "./fields.js";
import type { FieldLayout, FieldsReport, UpdateFieldsOptions } from "./fieldupdate.js";
import type { FindMatch, FindOptions } from "./find.js";
import { setAlign, setHighlight, setTextColor } from "./format.js";
import { history, redo, undo } from "./history.js";
import type { ObjectPlacement } from "./layout.js";
import { cropPlugin } from "./layout.js";
import { removeLink, setLink } from "./links.js";
import { liftListItem, listKeymap, sinkListItem, toggleList, wrapInList } from "./lists.js";
import { notesPlugin } from "./notes.js";
import {
  acceptAllChanges,
  acceptChange,
  nextChange,
  previousChange,
  rejectAllChanges,
  rejectChange,
} from "./review.js";
import type { StorySide, StoryVariant } from "./sections.js";
import { Selection, TextSelection } from "./selection.js";
import { type Command, EditorState, Plugin, PluginKey, type Transaction } from "./state.js";
import { callListener, StoryEditing } from "./stories.js";
import { tableKeymap } from "./tables.js";
import { textBoxesPlugin } from "./textboxes.js";
import {
  type ReviewView,
  setReviewView,
  setTrackChanges,
  type TrackState,
  trackPlugin,
  trackState,
  trackTransaction,
} from "./track.js";
import {
  documentJSON,
  storyBody,
  type WordContext,
  type WordEnvelope,
  wordContext,
  wordPlugin,
} from "./word.js";
import type { TabStop } from "./wordformat.js";
import {
  formatPainterPlugin,
  formattingMarksPlugin,
  type ListKind,
  rulerPlugin,
} from "./wordformat.js";

/**
 * A document an editor loads: schema v3 (Word's model), or one saved by 0.1.0 or 0.2.0, migrated
 * to v3 when loaded (`parseDocument`).
 */
export type EditorDocument = FoliDocument | FoliDocumentV2;

export interface EditorOptions {
  /** Trusted or not, it is validated (and migrated: `parseDocument`). Default: an empty one. */
  document?: EditorDocument;
  /** Run before the built-in plugins, so their keymaps take precedence. */
  plugins?: readonly Plugin[];
  /**
   * Custom node and mark types and their plugins (ADR-0008), added to the Word schema. Their
   * plugins run after `plugins`, before the built-ins. Content of types none of them declares is
   * kept as foreign nodes and marks and saved back unchanged.
   */
  extensions?: readonly Extension[];
  /** Who edits: tracked changes are made in this name. Default "Author". */
  author?: string;
  /**
   * Record edits as tracked changes from the start, while the document's settings say nothing
   * (`settings.trackRevisions`, which an imported `.docx` that tracks changes has, wins). Schema
   * v3 only. Default false.
   */
  trackChanges?: boolean;
  /** How the editor's views show tracked changes at first (default `markup`). */
  reviewView?: ReviewView;
}

export type EditorListener = (state: EditorState, transactions: readonly Transaction[]) => void;

/** A header, footer or note open for editing on its page. */
export interface OpenStory {
  id: string;
  side: StorySide | "note" | "textBox";
  variant: StoryVariant;
  /** The section it was opened from (a linked one shows an earlier section's story). */
  section: number;
}

/** A place to show: `from..to` of the body (`story` null) or of a story. */
export interface DocumentTarget {
  story: string | null;
  from: number;
  to: number;
}

/** What find shows on the pages. */
export interface FoundMatches extends FindOptions {
  query: string;
  matches: readonly FindMatch[];
  /** The one marked apart, if any. */
  current: FindMatch | null;
  /** Scroll to `current`: on a search or a step, not when the document changed under it. */
  scroll?: boolean;
}

/** The commands Word has keys for, answered by what the app shows for them. */
export type NavigationRequest =
  | "find"
  | "replace"
  | "goTo"
  | "next"
  | "previous"
  | "bookmarks"
  | "outline";

/**
 * Where a ruler's parts are on the screen (31.1): x and y in client px (as
 * `getBoundingClientRect` gives them), read when asked, so they follow scrolling and the zoom.
 * For the page the caret is on and the paragraph it is in.
 */
export interface RulerGeometry {
  /** Px on the screen per twip, at the zoom the pages are drawn at. */
  pxPerTwip: number;
  /** The width of the section's gutter (px), inside `margins.left`; 0 without one. */
  gutter: number;
  /** The caret's page (its index from 0) and its box. */
  page: { index: number; left: number; top: number; right: number; bottom: number };
  /**
   * Where the page's margins are: the edges of its text area as its section sets them (the left
   * one after the gutter, as Word adds it; the top and bottom ones as set, even where a taller
   * header or footer pushes the text down or up).
   */
  margins: { left: number; top: number; right: number; bottom: number };
  /**
   * What the caret's paragraph lines up in: its column of the page, or its table cell's
   * content. Indents and tab stops are measured from `left` (and the right indent from `right`).
   */
  text: { left: number; right: number };
  /**
   * The caret's paragraph as shown: where its left indent (the hanging marker), its first line
   * and its right indent are (with its table cell's formatting), and its tab stops (its style's
   * and its own, as `setTabStops` takes them, with their `x`): `position` in points from
   * `text.left`; Word's start, end and list stops as left, right and left. Null when the caret
   * is in no paragraph (a node selection).
   */
  paragraph: {
    left: number;
    firstLine: number;
    right: number;
    tabs: (TabStop & { x: number })[];
  } | null;
  /**
   * The top-level table of the body the caret is in: its position, its left edge and each grid
   * column's right edge with its width in twips, as drawn (`setColumnWidth`). Null outside one,
   * in a table nested in a cell, and in a header, footer or note.
   */
  table: { pos: number; left: number; columns: { right: number; width: number }[] } | null;
}

/** What opens stories on the pages: the view of the editor's document. */
export interface StoryView {
  readonly open: OpenStory | null;
  /** Opens the header or footer of a page (default: the selection's). Whether it is open now. */
  edit(side: StorySide, page?: number): boolean;
  /** Opens a note where it is: `id`, or the one whose reference is at the selection. */
  editNote(id?: string): boolean;
  /**
   * Opens text box `id` where it is drawn, the caret in it (33.3). Optional: a view made before
   * Phase 33 has none.
   */
  editTextBox?(id: string): boolean;
  /**
   * Where the picture or text box at `pos` is drawn (33.4): what a change of its layout keeps
   * it at. Null when it is not drawn. Optional: a view made before Phase 33 has none.
   */
  objectPlacement?(pos: number): ObjectPlacement | null;
  /** Where that object is on the screen (viewport px), or null. Optional, as `objectPlacement`. */
  objectRect?(pos: number): DOMRect | null;
  /** Back from the note being edited to its reference, the caret after it. */
  toReference(): boolean;
  close(): void;
  /** The pages as last laid out, for fields; null when there are none. */
  readonly fieldLayout: FieldLayout | null;
  /**
   * Updates fields with the pages in view (of the body, or of `editor`, a story's), again when
   * that moved them. One undo step.
   */
  updateFields(options?: UpdateFieldsOptions, editor?: Editor): FieldsReport;
  /** Marks what find found on the pages (never in the document, not printed); null: nothing. */
  showMatches(found: FoundMatches | null): void;
  /**
   * Selects `target` and scrolls to it, opening its story where it is, or leaving the open one.
   * `focus`: the document takes the focus. False when no page shows it.
   */
  reveal(target: DocumentTarget, options?: { focus?: boolean }): boolean;
  /**
   * Scrolls to `target` and marks it for `ms` milliseconds, then lets the mark fade; the
   * document, the selection and the focus stay. False when no page shows it. Optional: a view
   * made before 1.3 has none.
   */
  hint?(target: DocumentTarget, options?: { ms?: number }): boolean;
  /** The caret to the start of page `page` (1-based), scrolled to. False when there is none. */
  goToPage(page: number, options?: { focus?: boolean }): boolean;
  /** Focuses the document, or the story open in it. */
  focus(): void;
  /**
   * Where the ruler's parts are on the screen for the caret (31.1); null when the pages are
   * not laid out. Optional: a view older than this one has none.
   */
  rulerGeometry?(): RulerGeometry | null;
}

/** The built-in commands on `editor.commands`. */
export interface BuiltInCommands {
  insertText(text: string): boolean;
  deleteSelection(): boolean;
  deleteBackward(unit?: DeleteUnit): boolean;
  deleteForward(unit?: DeleteUnit): boolean;
  joinBackward(): boolean;
  joinForward(): boolean;
  splitBlock(): boolean;
  insertHardBreak(): boolean;
  insertPageBreak(): boolean;
  toggleMark(type: string, attrs?: Attrs | null): boolean;
  setBlockType(type: string, attrs?: Attrs | null): boolean;
  selectAll(): boolean;
  undo(): boolean;
  redo(): boolean;
  /** Numbers the selected paragraphs as a list ("bulletList" or "orderedList"). */
  wrapInList(kind: ListKind): boolean;
  /** The list buttons: removes the selection's numbering when it is a list of `kind`, else numbers it. */
  toggleList(kind: ListKind): boolean;
  /** Tab in a list: one level deeper. */
  indentListItem(): boolean;
  /** Shift+Tab in a list: one level up (out of the list at the top). */
  outdentListItem(): boolean;
  /**
   * Links the selection to `href` (normalized, then validated: unsafe hrefs do not apply); at
   * a caret in a link, changes it; elsewhere inserts the href as linked text.
   */
  setLink(href: string): boolean;
  /** Removes the links in the selection, or the link around the caret. */
  removeLink(): boolean;
  /** Aligns the selected paragraphs and headings ("start", "center", "end", "justify"). */
  setAlign(align: Alignment): boolean;
  /** Text color (lowercase `#rrggbb`) of the selected or next typed text; null removes it. */
  setTextColor(color: string | null): boolean;
  /** Highlight (`#rrggbb`) of the selected or next typed text; null removes it. */
  setHighlight(color: string | null): boolean;
  /** Turns tracked changes on or off (`author` changes who makes them). */
  setTrackChanges(on: boolean, author?: string): boolean;
  /** How the editor's views show tracked changes. */
  setReviewView(view: ReviewView): boolean;
  /** Accepts the change at the caret, or the changes in the selection. */
  acceptChange(): boolean;
  /** Rejects the change at the caret, or the changes in the selection. */
  rejectChange(): boolean;
  /** Accepts every change, or every change of `author`. */
  acceptAllChanges(author?: string): boolean;
  /** Rejects every change, or every change of `author`. */
  rejectAllChanges(author?: string): boolean;
  /** Selects the next change after the selection. */
  nextChange(): boolean;
  /** Selects the previous change before the selection. */
  previousChange(): boolean;
  /** Comments the selection (at a caret, the point there). */
  addComment(content: CommentContent, options?: CommentOptions): boolean;
  /** Replies to a comment's thread. */
  replyToComment(id: number, content: CommentContent, options?: CommentOptions): boolean;
  /** Replaces a comment's content. */
  editComment(id: number, content: CommentContent): boolean;
  /** Resolves (`done` false: reopens) a comment's thread. */
  resolveComment(id: number, done?: boolean): boolean;
  /** Deletes a comment, its replies and their anchors. */
  deleteComment(id: number): boolean;
  /** Deletes every comment. */
  deleteAllComments(): boolean;
  /**
   * Fills the content controls with this id or tag, here and in the stories (from the body's
   * editor): one undo step, tracked when tracking is on. False when none could take it.
   */
  setControlValue(target: string, value: ControlValueInput): boolean;
  /** Asks the toolbar to open Word's Font, Paragraph or Tabs dialog (`openDialog`). */
  openDialog(name: DialogName): boolean;
}

/**
 * The commands on `editor.commands`: the built-in ones and those plugins add. Apps add the names
 * of their plugins' commands by augmenting it:
 * `declare module "@folijs/core" { interface FoliCommands { insertMention(id: string): boolean } }`.
 */
export interface FoliCommands extends BuiltInCommands {}

/** A headless editor: state, commands, history and change notifications, no DOM. */
export interface Editor {
  readonly state: EditorState;
  /**
   * Page size and margins of the current document. For a schema v3 document, its last
   * section's (the view lays each section out with its own).
   */
  readonly settings: DocumentSettings;
  dispatch(tr: Transaction): void;
  /** Runs a command; returns whether it applied. */
  run(command: Command): boolean;
  /** Dry run: whether a command would apply now. */
  can(command: Command): boolean;
  /** Runs the first keymap command bound to `key` that applies, e.g. "Mod-b". */
  handleKey(key: string): boolean;
  /** Places a text selection (positions are clamped into the document). */
  select(anchor: number, head?: number): void;
  /**
   * The named commands: the built-in ones and those plugins add (`PluginSpec.commands`), each
   * run on this editor; whether it applied.
   */
  readonly commands: FoliCommands;
  /** The content controls' values, the stories' after the body's (from the body's editor). */
  controlValues(): ControlValue[];
  /** Whether edits are recorded as tracked changes. */
  readonly trackingChanges: boolean;
  isMarkActive(type: string): boolean;
  /** The current document (schema v3). */
  getDocument(): FoliDocument;
  /** Replaces the whole document (an older one migrated) and resets history. */
  setDocument(document: EditorDocument): void;
  /**
   * Replaces the plugins the editor was made with (`EditorOptions.plugins`) and keeps the
   * document, the selection, undo history and the state of every plugin in both lists (the same
   * instance): one added starts from its `init`, one left out is dropped. Its stories' editors
   * follow; extensions' plugins and the built-in ones stay. Starting or leaving a shared session
   * (`collab`) without making the editor again. Throws, changing nothing, on a command name taken
   * twice.
   */
  reconfigure(options: { plugins: readonly Plugin[] }): void;
  subscribe(listener: EditorListener): () => void;
  /**
   * An editor over a story (a header, footer or note) by id, null when there is none. It has its
   * own selection, and its changes go through this editor: one undo history, in `state.doc` order
   * of the changes. On a story's editor `getDocument` gives the story as a document's content and
   * `setDocument` replaces its content.
   */
  story(id: string): Editor | null;
  /** Set by the view showing the pages: what opens a story there, shared with stories' editors. */
  storyView: StoryView | null;
  /** The view opened or closed a story: tells the editor's listeners (no transaction). */
  storyChanged(): void;
  /**
   * Set by the app's navigation UI: what Word's keys for it do. The view asks it first and leaves
   * a key to the browser when it answers false, or when there is none.
   */
  navigation: ((request: NavigationRequest) => boolean) | null;
  /**
   * The extensions it was made with (`EditorOptions.extensions`), the same list on its stories'
   * editors: a view reads its view hooks from them (`ViewExtension` in `@folijs/view`).
   */
  readonly extensions: readonly Extension[];
}

/** Word's page when a section leaves it out: Letter, 1 inch margins. */
const LETTER = { width: 12240, height: 15840, margin: 1440 };

/** A section's page setup as page settings (mm; the gutter added to the left margin, as Word does). */
export function sectionSettings(section: SectionJSON): DocumentSettings {
  const m = section.margins ?? {};
  return {
    pageSize: {
      width: mm(section.pageSize?.width ?? LETTER.width),
      height: mm(section.pageSize?.height ?? LETTER.height),
    },
    margins: {
      top: mm(Math.abs(m.top ?? LETTER.margin)),
      right: mm(m.right ?? LETTER.margin),
      bottom: mm(Math.abs(m.bottom ?? LETTER.margin)),
      left: mm((m.left ?? LETTER.margin) + (m.gutter ?? 0)),
    },
  };
}

interface Loaded {
  doc: Node;
  settings: DocumentSettings;
  envelope: WordEnvelope;
}

/** Validates (and migrates) a document and reads what the editor keeps of it. */
function loadDocument(
  document: EditorDocument,
  extensions: readonly Extension[],
  schema: Schema,
): Loaded {
  const { content, ...envelope } = parseDocument(document, { extensions });
  return {
    doc: parseContent(content, { schema }),
    settings: sectionSettings(envelope.section),
    envelope,
  };
}

/** What differs between the editor of the body and of a story. */
interface EditorParts {
  state(): EditorState;
  dispatch(tr: Transaction): void;
  settings(): DocumentSettings;
  getDocument(): FoliDocument;
  setDocument(document: EditorDocument): void;
  subscribe(listener: EditorListener): () => void;
  story(id: string): Editor | null;
  /** The view opening stories, and the navigation UI: one for the body and its stories. */
  views: { current: StoryView | null; navigation: Editor["navigation"] };
  storyChanged(): void;
  extensions: readonly Extension[];
  /** The user's and extensions' plugins: their `commands` join the built-in ones. */
  plugins(): readonly Plugin[];
  /** `plugins` with the extensions' after them, as `plugins()` would give them. */
  withExtensions(plugins: readonly Plugin[]): readonly Plugin[];
  /** Makes `plugins` (with the extensions') the editor's own, in the body and its stories. */
  reconfigure(plugins: readonly Plugin[]): void;
}

function makeEditor(parts: EditorParts): Editor {
  const { dispatch } = parts;
  const run = (command: Command) => command(parts.state(), dispatch);
  /** This editor and, from the body's, those of the stories holding controls. */
  const withStories = (): { editor: Editor; story?: string }[] => {
    const state = parts.state();
    const context = storyBody(state) ? null : wordContext(state);
    const held = [...(context?.stories ?? [])].filter(([, s]) => controlsIn(s.doc).length);
    return [
      { editor: self },
      ...held.flatMap(([story]) => {
        const editor = parts.story(story);
        return editor ? [{ editor, story }] : [];
      }),
    ];
  };
  // Each named command as a factory, so `editorCommand` can give it for a dry run.
  const builtIns: BuiltInFactories = {
    insertText: (text) => insertText(text),
    deleteSelection: () => deleteSelection,
    deleteBackward: (unit) => deleteBackward(unit),
    deleteForward: (unit) => deleteForward(unit),
    joinBackward: () => joinBackward,
    joinForward: () => joinForward,
    splitBlock: () => splitBlock,
    insertHardBreak: () => insertHardBreak,
    insertPageBreak: () => insertPageBreak,
    toggleMark: (type, attrs) => toggleMark(type, attrs),
    setBlockType: (type, attrs) => setBlockType(type, attrs),
    selectAll: () => selectAll,
    undo: () => undo,
    redo: () => redo,
    wrapInList: (kind) => wrapInList(kind),
    toggleList: (kind) => toggleList(kind),
    indentListItem: () => sinkListItem,
    outdentListItem: () => liftListItem,
    setLink: (href) => setLink(href),
    removeLink: () => removeLink,
    setAlign: (align) => setAlign(align),
    openDialog: (name) => openDialog(name),
    setTextColor: (color) => setTextColor(color),
    setHighlight: (color) => setHighlight(color),
    setTrackChanges: (on, name) => setTrackChanges(on, name),
    setReviewView: (view) => setReviewView(view),
    acceptChange: () => acceptChange,
    rejectChange: () => rejectChange,
    acceptAllChanges: (name) => acceptAllChanges(name),
    rejectAllChanges: (name) => rejectAllChanges(name),
    nextChange: () => nextChange,
    previousChange: () => previousChange,
    addComment: (content, options) => addComment(content, options),
    replyToComment: (id, content, options) => replyToComment(id, content, options),
    editComment: (id, content) => editComment(id, content),
    resolveComment: (id, done) => resolveComment(id, done),
    deleteComment: (id) => deleteComment(id),
    deleteAllComments: () => deleteAllComments,
    // Across the body and its stories: `state` is the body's; a dry run asks each editor.
    setControlValue: (target, value) => (_state, dispatch) => {
      let done = false;
      for (const { editor } of withStories())
        if (
          dispatch
            ? editor.run(setControlValue(target, value, done))
            : editor.can(setControlValue(target, value, done))
        )
          done = true;
      return done;
    },
  };
  /** The commands, made again when the plugins change (`reconfigure`). */
  let made: { plugins: readonly Plugin[]; factories: Factories; commands: FoliCommands } | null =
    null;
  const current = () => {
    const plugins = parts.plugins();
    if (made?.plugins !== plugins) {
      const factories = withPluginFactories(plugins, builtIns);
      made = { plugins, factories, commands: commandsOf(factories, run) };
    }
    return made;
  };
  // A command name taken twice throws here, when the editor is made.
  current();
  const self: Editor = {
    get settings() {
      return parts.settings();
    },
    get state() {
      return parts.state();
    },
    dispatch,
    run,
    can: (command) => command(parts.state()),
    handleKey(key) {
      const state = parts.state();
      return state.plugins.some((plugin) => {
        const command = plugin.spec.keymap?.[key];
        return command ? command(state, dispatch) : false;
      });
    },
    select(anchor, head = anchor) {
      const state = parts.state();
      const size = state.doc.content.size;
      const clamp = (pos: number) => Math.max(0, Math.min(pos, size));
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, clamp(anchor), clamp(head))));
    },
    get commands() {
      return current().commands;
    },
    controlValues: () =>
      withStories().flatMap(({ editor, story }) =>
        controlValues(editor.state).map((value) => (story ? { ...value, story } : value)),
      ),
    get trackingChanges() {
      return trackState(parts.state())?.on ?? false;
    },
    isMarkActive: (type) => isMarkActive(parts.state(), type),
    getDocument: parts.getDocument,
    setDocument: parts.setDocument,
    reconfigure({ plugins }) {
      const next = parts.withExtensions(plugins);
      withPluginFactories(next, builtIns); // throws before anything changes
      parts.reconfigure(next);
    },
    subscribe: parts.subscribe,
    story: parts.story,
    get storyView() {
      return parts.views.current;
    },
    set storyView(view) {
      parts.views.current = view;
    },
    storyChanged: parts.storyChanged,
    extensions: parts.extensions,
    get navigation() {
      return parts.views.navigation;
    },
    set navigation(handler) {
      parts.views.navigation = handler;
    },
  };
  commandFactories.set(self, () => current().factories);
  return self;
}

/** The built-in commands as factories of the commands they run. */
type BuiltInFactories = {
  [K in keyof BuiltInCommands]: (...args: Parameters<BuiltInCommands[K]>) => Command;
};
type Factories = Record<string, (...args: never[]) => Command>;

/**
 * Adds the command factories `plugins` name (`PluginSpec.commands`) to the built-in ones. A name
 * taken twice, or by a built-in command, throws.
 */
function withPluginFactories(plugins: readonly Plugin[], builtIns: BuiltInFactories): Factories {
  const factories: Factories = { ...builtIns };
  for (const plugin of plugins)
    for (const [name, factory] of Object.entries(plugin.spec.commands ?? {})) {
      if (Object.hasOwn(factories, name))
        throw new RangeError(
          `Command "${name}" is already defined: plugin commands need names of their own`,
        );
      if (typeof factory !== "function")
        throw new TypeError(`Command "${name}" is not a function returning a command`);
      // defineProperty: a name such as "__proto__" is a command, not the object's prototype.
      Object.defineProperty(factories, name, { value: factory, enumerable: true });
    }
  return factories;
}

/** `editor.commands`: each factory's command run on the editor. */
function commandsOf(factories: Factories, run: (command: Command) => boolean): FoliCommands {
  const commands = {};
  for (const [name, factory] of Object.entries(factories))
    Object.defineProperty(commands, name, {
      value: (...args: never[]) => run(factory(...args)),
      enumerable: true,
    });
  return commands as FoliCommands;
}

const commandFactories = new WeakMap<Editor, () => Factories>();

/**
 * The command `editor.commands[name](...args)` would run, for a dry run (`editor.can`): built-in
 * or a plugin's; undefined when the editor has no command of that name.
 */
export function editorCommand(
  editor: Editor,
  name: string,
  args: readonly unknown[],
): Command | undefined {
  const factories = commandFactories.get(editor)?.();
  const factory = factories && Object.hasOwn(factories, name) ? factories[name] : undefined;
  return factory?.(...(args as never[]));
}

/**
 * Where the view's own overridable keys run (ADR-0008, `docs/keyboard.md`): a plugin
 * with no keymap placed after the user's plugins and before the built-in ones.
 */
export const viewKeys = new PluginKey<never>("viewKeys");

export function createEditor({
  document = createDocument(),
  plugins = [],
  extensions = [],
  author = "Author",
  trackChanges = false,
  reviewView = "markup",
}: EditorOptions = {}): Editor {
  const schema = schemaWith(extensions);
  const withExtensions = (list: readonly Plugin[]) => [
    ...list,
    ...extensions.flatMap((e) => e.plugins ?? []),
  ];
  /** The app's plugins and the extensions': first in every state, swapped by `reconfigure`. */
  let own: readonly Plugin[] = withExtensions(plugins);
  const load = (next: EditorDocument) => loadDocument(next, extensions, schema);
  let loaded = load(document);
  let track: TrackState = { on: trackChanges, author, view: reviewView };
  const pluginsFor = ({ envelope }: Loaded) => [
    ...own,
    new Plugin({ key: viewKeys }),
    history(),
    wordPlugin(envelope),
    trackPlugin(track),
    fieldsPlugin(),
    controlsPlugin(),
    commentsPlugin(),
    notesPlugin(),
    textBoxesPlugin(),
    cropPlugin(),
    formatPainterPlugin(),
    formattingMarksPlugin(),
    rulerPlugin(),
    tableKeymap(),
    listKeymap(),
    baseKeymap(),
  ];
  let state = EditorState.create({ doc: loaded.doc, plugins: pluginsFor(loaded) });
  const listeners = new Set<EditorListener>();
  const views: EditorParts["views"] = { current: null, navigation: null };
  /** The stories being edited, by id. */
  const stories = new Map<string, { editing: StoryEditing; editor: Editor }>();

  const notify = (transactions: readonly Transaction[]) => {
    for (const listener of listeners) callListener(listener, state, transactions);
  };
  const storyChanged = () => notify([]);
  const dispatch = (tr: Transaction) => {
    // With tracking on, the edit is rebuilt as tracked changes; one that cannot be is not made.
    const tracked = trackTransaction(state, tr);
    if (!tracked) return;
    const result = state.applyTransaction(tracked);
    state = result.state;
    if (!result.transactions.length) return;
    // The stories first: a view of the body redraws them from what they now are.
    for (const [id, { editing }] of stories) {
      editing.sync(result.transactions);
      if (!editing.alive) stories.delete(id);
    }
    notify(result.transactions);
  };
  const run = (command: Command) => command(state, dispatch);
  let current = { section: loaded.envelope.section, settings: loaded.settings };
  const settings = () => {
    // The last section's page setup, as it is now (`setSectionSetup` changes it).
    const section = wordContext(state)?.envelope.section ?? current.section;
    if (section !== current.section) current = { section, settings: sectionSettings(section) };
    return current.settings;
  };
  const getDocument = (): FoliDocument =>
    documentJSON(wordContext(state)?.envelope ?? loaded.envelope, state.doc);

  const storyEditor = (id: string): Editor => {
    const editing = new StoryEditing(id, {
      get state() {
        return state;
      },
      run,
      can: (command) => command(state),
      dispatch,
      plugins: (context: WordContext, value) => [
        ...own,
        new Plugin({ key: viewKeys }),
        wordPlugin(context.envelope, context),
        trackPlugin(value ?? track),
        fieldsPlugin(),
        controlsPlugin(),
        commentsPlugin(),
        formatPainterPlugin(),
        formattingMarksPlugin(),
        rulerPlugin(),
        tableKeymap(),
        listKeymap(),
        baseKeymap(),
      ],
    });
    const editor = makeEditor({
      state: () => editing.state,
      dispatch: editing.dispatch,
      settings,
      getDocument: () => ({ ...getDocument(), content: writeCustom(editing.state.doc.toJSON()) }),
      setDocument(next) {
        const { doc } = load(next);
        const tr = editing.state.tr.replace(
          0,
          editing.state.doc.content.size,
          new Slice(doc.content, 0, 0),
        );
        editing.dispatch(tr.setSelection(Selection.atStart(tr.doc)));
      },
      subscribe(listener) {
        editing.listeners.add(listener);
        return () => editing.listeners.delete(listener);
      },
      story,
      views,
      storyChanged,
      extensions,
      plugins: () => own,
      withExtensions,
      reconfigure: (next) => reconfigure(next),
    });
    stories.set(id, { editing, editor });
    return editor;
  };
  const reconfigure = (next: readonly Plugin[]) => {
    const before = own.length;
    own = next;
    // `own` leads each state's plugins (after a story's own two): the rest keep their state.
    const swap = (list: readonly Plugin[], at: number) => [
      ...list.slice(0, at),
      ...own,
      ...list.slice(at + before),
    ];
    state = state.reconfigure(swap(state.plugins, 0));
    for (const { editing } of stories.values()) editing.reconfigure(swap);
    notify([]);
  };
  const story = (id: string): Editor | null =>
    wordContext(state)?.stories.has(id) ? (stories.get(id)?.editor ?? storyEditor(id)) : null;

  return makeEditor({
    state: () => state,
    dispatch,
    settings,
    getDocument,
    setDocument(next) {
      track = trackState(state) ?? track;
      loaded = load(next);
      state = EditorState.create({ doc: loaded.doc, plugins: pluginsFor(loaded) });
      for (const { editing } of stories.values()) editing.retire();
      stories.clear();
      notify([]);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    story,
    views,
    storyChanged,
    extensions,
    plugins: () => own,
    withExtensions,
    reconfigure,
  });
}
