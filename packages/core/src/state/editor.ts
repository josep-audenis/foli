import type { DocumentSettings, FoliDocumentV2 } from "../document.js";
import { type Attrs, type Node, Slice } from "../model/index.js";
import type { Alignment } from "../schema.js";
import {
  createDocument,
  type FoliDocument,
  parseContent,
  parseDocument,
  type SectionJSON,
} from "../v3/document.js";
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
import { fieldsPlugin } from "./fields.js";
import type { FieldLayout, FieldsReport, UpdateFieldsOptions } from "./fieldupdate.js";
import { setAlign, setHighlight, setTextColor } from "./format.js";
import { history, redo, undo } from "./history.js";
import { removeLink, setLink } from "./links.js";
import { liftListItem, listKeymap, sinkListItem, toggleList, wrapInList } from "./lists.js";
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
import { type Command, EditorState, type Plugin, type Transaction } from "./state.js";
import { StoryEditing } from "./stories.js";
import { tableKeymap } from "./tables.js";
import {
  type ReviewView,
  setReviewView,
  setTrackChanges,
  type TrackState,
  trackPlugin,
  trackState,
  trackTransaction,
} from "./track.js";
import { type WordContext, type WordEnvelope, wordContext, wordPlugin } from "./word.js";
import type { ListKind } from "./wordformat.js";

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
  /** Who edits: tracked changes are made in this name. Default "Author". */
  author?: string;
  /**
   * Record edits as tracked changes from the start (a `.docx`'s `w:trackRevisions`:
   * `DocxImport.trackRevisions`). Schema v3 only. Default false.
   */
  trackChanges?: boolean;
  /** How the editor's views show tracked changes at first (default `markup`). */
  reviewView?: ReviewView;
}

export type EditorListener = (state: EditorState, transactions: readonly Transaction[]) => void;

/** A header or footer open for editing on its page. */
export interface OpenStory {
  id: string;
  side: StorySide;
  variant: StoryVariant;
  /** The section it was opened from (a linked one shows an earlier section's story). */
  section: number;
}

/** What opens stories on the pages: the view of the editor's document. */
export interface StoryView {
  readonly open: OpenStory | null;
  /** Opens the header or footer of a page (default: the selection's). Whether it is open now. */
  edit(side: StorySide, page?: number): boolean;
  close(): void;
  /** The pages as last laid out, for fields; null when there are none. */
  readonly fieldLayout: FieldLayout | null;
  /**
   * Updates fields with the pages in view (of the body, or of `editor`, a story's), again when
   * that moved them. One undo step.
   */
  updateFields(options?: UpdateFieldsOptions, editor?: Editor): FieldsReport;
}

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
  readonly commands: {
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
  };
  /** Whether edits are recorded as tracked changes. */
  readonly trackingChanges: boolean;
  isMarkActive(type: string): boolean;
  /** The current document (schema v3). */
  getDocument(): FoliDocument;
  /** Replaces the whole document (an older one migrated) and resets history. */
  setDocument(document: EditorDocument): void;
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
function load(document: EditorDocument): Loaded {
  const { content, ...envelope } = parseDocument(document);
  return { doc: parseContent(content), settings: sectionSettings(envelope.section), envelope };
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
  /** The view opening stories, one for the body and its stories. */
  views: { current: StoryView | null };
  storyChanged(): void;
}

function makeEditor(parts: EditorParts): Editor {
  const { dispatch } = parts;
  const run = (command: Command) => command(parts.state(), dispatch);
  return {
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
    commands: {
      insertText: (text) => run(insertText(text)),
      deleteSelection: () => run(deleteSelection),
      deleteBackward: (unit) => run(deleteBackward(unit)),
      deleteForward: (unit) => run(deleteForward(unit)),
      joinBackward: () => run(joinBackward),
      joinForward: () => run(joinForward),
      splitBlock: () => run(splitBlock),
      insertHardBreak: () => run(insertHardBreak),
      insertPageBreak: () => run(insertPageBreak),
      toggleMark: (type, attrs) => run(toggleMark(type, attrs)),
      setBlockType: (type, attrs) => run(setBlockType(type, attrs)),
      selectAll: () => run(selectAll),
      undo: () => run(undo),
      redo: () => run(redo),
      wrapInList: (kind) => run(wrapInList(kind)),
      toggleList: (kind) => run(toggleList(kind)),
      indentListItem: () => run(sinkListItem),
      outdentListItem: () => run(liftListItem),
      setLink: (href) => run(setLink(href)),
      removeLink: () => run(removeLink),
      setAlign: (align) => run(setAlign(align)),
      setTextColor: (color) => run(setTextColor(color)),
      setHighlight: (color) => run(setHighlight(color)),
      setTrackChanges: (on, name) => run(setTrackChanges(on, name)),
      setReviewView: (view) => run(setReviewView(view)),
      acceptChange: () => run(acceptChange),
      rejectChange: () => run(rejectChange),
      acceptAllChanges: (name) => run(acceptAllChanges(name)),
      rejectAllChanges: (name) => run(rejectAllChanges(name)),
      nextChange: () => run(nextChange),
      previousChange: () => run(previousChange),
      addComment: (content, options) => run(addComment(content, options)),
      replyToComment: (id, content, options) => run(replyToComment(id, content, options)),
      editComment: (id, content) => run(editComment(id, content)),
      resolveComment: (id, done) => run(resolveComment(id, done)),
      deleteComment: (id) => run(deleteComment(id)),
      deleteAllComments: () => run(deleteAllComments),
    },
    get trackingChanges() {
      return trackState(parts.state())?.on ?? false;
    },
    isMarkActive: (type) => isMarkActive(parts.state(), type),
    getDocument: parts.getDocument,
    setDocument: parts.setDocument,
    subscribe: parts.subscribe,
    story: parts.story,
    get storyView() {
      return parts.views.current;
    },
    set storyView(view) {
      parts.views.current = view;
    },
    storyChanged: parts.storyChanged,
  };
}

export function createEditor({
  document = createDocument(),
  plugins = [],
  author = "Author",
  trackChanges = false,
  reviewView = "markup",
}: EditorOptions = {}): Editor {
  let loaded = load(document);
  let track: TrackState = { on: trackChanges, author, view: reviewView };
  const pluginsFor = ({ envelope }: Loaded) => [
    ...plugins,
    history(),
    wordPlugin(envelope),
    trackPlugin(track),
    fieldsPlugin(),
    commentsPlugin(),
    tableKeymap(),
    listKeymap(),
    baseKeymap(),
  ];
  let state = EditorState.create({ doc: loaded.doc, plugins: pluginsFor(loaded) });
  const listeners = new Set<EditorListener>();
  const views: EditorParts["views"] = { current: null };
  /** The stories being edited, by id. */
  const stories = new Map<string, { editing: StoryEditing; editor: Editor }>();

  const notify = (transactions: readonly Transaction[]) => {
    for (const listener of listeners) listener(state, transactions);
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
  const getDocument = (): FoliDocument => ({
    ...structuredClone(wordContext(state)?.envelope ?? loaded.envelope),
    content: state.doc.toJSON(),
  });

  const storyEditor = (id: string): Editor => {
    const editing = new StoryEditing(id, {
      get state() {
        return state;
      },
      run,
      can: (command) => command(state),
      dispatch,
      plugins: (context: WordContext, value) => [
        ...plugins,
        wordPlugin(context.envelope, context),
        trackPlugin(value ?? track),
        fieldsPlugin(),
        commentsPlugin(),
        tableKeymap(),
        listKeymap(),
        baseKeymap(),
      ],
    });
    const editor = makeEditor({
      state: () => editing.state,
      dispatch: editing.dispatch,
      settings,
      getDocument: () => ({ ...getDocument(), content: editing.state.doc.toJSON() }),
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
    });
    stories.set(id, { editing, editor });
    return editor;
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
  });
}
