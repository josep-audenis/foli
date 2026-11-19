/**
 * Copy and paste of schema v3 content (8.7c). A copy carries the definitions its content
 * references (styles, numbering, comments); a paste fits them to the target document, as Word
 * does with its default "use destination styles":
 * - A style the target has by name is used; any other is added (a free id if its id is taken).
 * - A list copied inside one document (the copy carries the document's id, `WordContext.id`)
 *   goes on; otherwise it gets an instance of its own (the target's definition when one is the
 *   same). Lists of different documents are never taken for each other: Foli makes equal ids
 *   and definitions in every document.
 * - Comments are copied with new ids, as Word duplicates them; an anchor without its comment
 *   is left out.
 * - A bookmark whose name the target already uses (outside the selection the paste replaces)
 *   is left out, as in Word; others get new ids.
 * - From another document, a style or list the copy does not define is not one: the text is in
 *   the default style, not numbered (not the target's style or list of that id).
 * - Paragraph ids (`w14:paraId`, `w14:textId`) are left out: export makes the ones it needs.
 * - A note reference brings its note, carried by the copy, as a new story with a new id: a copy
 *   is a second note, and what was cut was removed with its reference (ADR-0007).
 * - A content control copied inside its document is a new control with the same properties while
 *   the original stays (cut and pasted, it is the same one). From elsewhere its content comes
 *   without it.
 *
 * shortcut: ids inside opaque content (a table's bookmarks and paragraph ids) and tracked-change
 * ids are pasted as they are; Word tolerates repeats of both. Map them when a file shows otherwise.
 */
import { DEFAULT_SETTINGS } from "../document.js";
import type { MarkJSON, Node, NodeJSON } from "../model/index.js";
import { type DocJSON, isSafeLink } from "../schema.js";
import {
  type AbstractNumberingJSON,
  type CommentJSON,
  type ControlJSON,
  migrateToV4,
  migrateToV5,
  type NumberingInstanceJSON,
  type NumberingLevelJSON,
  type ParagraphPropertiesJSON,
  parseContent,
  parseDocument,
  SCHEMA_VERSION,
  type StoryJSON,
  type StyleJSON,
} from "../v3/document.js";
import { migrateToV3 } from "../v3/migrate.js";
import { Resolver } from "../v3/resolve.js";
import { controlsIn, copiedControl, freshControlId } from "./controls.js";
import { noteIds, noteKindOf } from "./notes.js";
import type { EditorState } from "./state.js";
import {
  otherTrees,
  type Story,
  storyBody,
  type WordContext,
  type WordEnvelope,
  wordContext,
} from "./word.js";
import { builtinStyle, levels } from "./wordformat.js";

/** What a v3 copy carries beside its content: the definitions the content references. */
export interface WordDefinitions {
  /** The document copied from (`WordContext.id`). */
  document?: string;
  styles: StyleJSON[];
  numbering: { abstracts: AbstractNumberingJSON[]; instances: NumberingInstanceJSON[] };
  comments: CommentJSON[];
  /** The notes the content refers to, by story id. */
  notes?: Record<string, StoryJSON>;
}

/** What a paste brings: the content, the envelope it needs, and new notes. */
export interface FittedPaste {
  doc: Node;
  envelope: WordEnvelope;
  /** The stories of the notes the references in `doc` now name, to add with it. */
  notes?: { id: string; story: Story }[];
}

type Json = Record<string, unknown>;

function visit(nodes: readonly NodeJSON[], f: (node: NodeJSON) => void): void {
  for (const node of nodes) {
    f(node);
    visit(node.content ?? [], f);
  }
}

const COMMENT_ANCHORS = new Set(["commentStart", "commentEnd", "commentReference"]);

type Properties = Pick<ParagraphPropertiesJSON, "style" | "numbering" | "markFormat">;

/**
 * The definitions `content` (copied from the document of `context`) references: its paragraphs'
 * and runs' styles (the paragraph mark's and a tracked change's too) with the styles they are
 * based on, link to or are followed by, its lists' numbering (a style's included), and its
 * comments; with the document's id.
 */
export function copiedDefinitions(context: WordContext, content: Node): WordDefinitions {
  const { styles, numbering, comments, stories } = context.envelope;
  const noteStories = new Set<string>();
  const styleIds = new Set<string>();
  const numberingIds = new Set<number>();
  const commentIds = new Set<number>();
  const marks = (list: readonly MarkJSON[] | null | undefined) => {
    for (const mark of list ?? [])
      if (mark.type === "characterStyle") styleIds.add(String(mark.attrs?.id));
  };
  const properties = (p: Properties | null | undefined) => {
    if (p?.style) styleIds.add(p.style);
    if (p?.numbering?.id) numberingIds.add(p.numbering.id);
    marks(p?.markFormat);
  };
  const references = (node: NodeJSON) => {
    const attrs = (node.attrs ?? {}) as Properties & {
      id?: number;
      formatChange?: { previous: Properties } | null;
    };
    if (node.type === "paragraph") {
      properties(attrs);
      properties(attrs.formatChange?.previous);
    }
    // A table's style, and a row's exceptions' style.
    if (node.type === "table") properties(attrs);
    if (node.type === "tableRow") properties((attrs as { exceptions?: Properties }).exceptions);
    if (COMMENT_ANCHORS.has(node.type)) commentIds.add(attrs.id as number);
    if (node.type === "noteReference") noteStories.add(String(node.attrs?.story));
    marks(node.marks);
  };
  visit([content.toJSON()], references);
  const copied = comments.filter((c) => commentIds.has(c.id));
  visit(
    copied.flatMap((c) => c.content),
    references,
  );
  const notes = Object.fromEntries(
    [...noteStories].flatMap((id) => {
      const story = stories && Object.hasOwn(stories, id) ? stories[id] : undefined;
      return story ? [[id, story] as const] : [];
    }),
  );
  visit(
    Object.values(notes).map((note) => note.content),
    references,
  );
  const instances = () => numbering.instances.filter((n) => numberingIds.has(n.id));
  const abstracts = () => {
    const ids = new Set(instances().map((n) => n.abstract));
    return numbering.abstracts.filter((a) => ids.has(a.id));
  };
  // Until nothing new: styles name styles and numbering; numbering levels name styles.
  for (let size = -1; size !== styleIds.size + numberingIds.size; ) {
    size = styleIds.size + numberingIds.size;
    for (const style of styles) {
      if (!styleIds.has(style.id)) continue;
      for (const id of [style.basedOn, style.next, style.link]) if (id) styleIds.add(id);
      const id = style.paragraph?.numbering?.id;
      if (id) numberingIds.add(id);
    }
    for (const abstract of abstracts())
      for (const id of [
        abstract.styleLink,
        abstract.numStyleLink,
        ...abstract.levels.map((l) => l.style),
      ])
        if (id) styleIds.add(id);
    for (const instance of instances())
      for (const o of instance.overrides ?? [])
        if (o.definition?.style) styleIds.add(o.definition.style);
  }
  return {
    document: context.id,
    styles: styles.filter((s) => styleIds.has(s.id)),
    numbering: { abstracts: abstracts(), instances: instances() },
    comments: copied,
    ...(Object.keys(notes).length ? { notes } : {}),
  };
}

/**
 * Pasted HTML, read as schema v2 content (`htmlToDoc`, validated), fitted to the v3 document in
 * `state` like `fitPaste`: structured by `migrateToV3`, with Word's built-in heading, List
 * Paragraph and Hyperlink styles where the document lacks them, and the list levels the list
 * buttons make (the document's definition where it has one). Each list is a new one.
 */
export function fitPastedV2(
  state: EditorState,
  content: Node,
): { doc: Node; envelope: WordEnvelope } {
  const migrated = migrateToV5(
    migrateToV4(
      migrateToV3({
        schemaVersion: 2,
        settings: DEFAULT_SETTINGS,
        content: content.toJSON() as DocJSON,
      }),
    ),
  );
  const definitions: WordDefinitions = {
    styles: migrated.styles.map((style) => {
      // Based on the paste's Normal, which is the target's by name.
      const builtin = style.name ? builtinStyle({ envelope: migrated }, style.name) : null;
      return builtin ? { ...builtin, id: style.id } : style;
    }),
    numbering: {
      // The definitions `newList` makes, so a paste reuses the document's where it has them.
      abstracts: migrated.numbering.abstracts.map((a) => ({
        id: a.id,
        multiLevelType: "hybridMultilevel" as const,
        levels: levels(a.levels[0]?.format === "bullet" ? "bulletList" : "orderedList"),
      })),
      instances: migrated.numbering.instances,
    },
    comments: [],
  };
  const fitted = fit(state, definitions, migrated.content, false);
  // Bold, italic, underline and strike the paragraph's style already gives (HTML writes a
  // heading's bold on its text) are not the text's own, so a style change still applies.
  const resolver = new Resolver(fitted.envelope);
  const json = fitted.doc.toJSON();
  for (const block of json.content ?? []) {
    const { run } = resolver.paragraph(block.attrs ?? {});
    const given: Record<string, boolean> = {
      bold: run.bold,
      italic: run.italic,
      underline: run.underline === "single",
      strike: run.strike,
    };
    for (const child of block.content ?? []) {
      const marks = child.marks?.filter((m) => !given[m.type]);
      if (marks?.length) child.marks = marks;
      else delete child.marks;
    }
  }
  return { doc: parseContent(json, { schema: state.schema }), envelope: fitted.envelope };
}

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const PARAGRAPH_IDS = ["w14:paraId", "w14:textId"];

/** `json` without the link marks that are not safe (`isSafeLink`; the text stays). */
function safeLinks(json: NodeJSON): NodeJSON {
  const marks = json.marks?.filter((m) => m.type !== "link" || isSafeLink(m.attrs));
  return {
    ...json,
    ...(marks && { marks }),
    ...(json.content && { content: json.content.map(safeLinks) }),
  };
}

/**
 * Fits pasted v3 `content` (untrusted) to the document in `state`: `definitions` are the ones
 * the copy carried (`copiedDefinitions`, untrusted), or none for content of this document (plain
 * text, older copies). Returns the content to insert and the envelope with what it added (the
 * same object when nothing was added). Throws FoliDocumentError on invalid input.
 */
export function fitPaste(state: EditorState, content: unknown, definitions?: unknown): FittedPaste {
  const context = wordContext(state) as WordContext;
  const target = context.envelope;
  // Taken as this document's own, but it cannot be told to be: no unsafe link comes in.
  if (definitions === undefined || definitions === null)
    return fit(
      state,
      target,
      safeLinks(parseContent(content, { fragment: true, schema: state.schema }).toJSON()),
      true,
    );
  const { document, styles, numbering, comments, notes } = definitions as Partial<WordDefinitions>;
  // Validated as a document's envelope: types, ranges, no style based on itself; the content
  // as content to paste (a table may end it).
  const checked = parseDocument({
    schemaVersion: SCHEMA_VERSION,
    section: target.section,
    defaults: {},
    styles,
    numbering,
    comments,
    ...(notes ? { stories: notes } : {}),
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
  const json = parseContent(content, { fragment: true, schema: state.schema }).toJSON();
  const source: WordDefinitions = {
    styles: checked.styles,
    numbering: checked.numbering,
    comments: checked.comments,
    ...(checked.stories ? { notes: checked.stories } : {}),
  };
  return fit(state, source, json, document === context.id);
}

/**
 * Adds to `out` the field and inline control markers of `nodes` without partners (ADR-0007): a
 * field that lost its end loses its start and code too, so the code never becomes text. What they
 * held stays. `open` carries what is open from one node to the next.
 */
function unpairedMarkers(
  nodes: readonly NodeJSON[],
  out: Set<NodeJSON>,
  open: {
    fields: { parts: NodeJSON[]; separated: boolean }[];
    controls: Map<unknown, NodeJSON[]>;
  } = { fields: [], controls: new Map() },
  top = true,
): void {
  for (const node of nodes) {
    const field = open.fields[open.fields.length - 1];
    const id = node.attrs?.id;
    if (node.type === "fieldStart") open.fields.push({ parts: [node], separated: false });
    else if (node.type === "fieldCode") {
      if (field && !field.separated) field.parts.push(node);
      else out.add(node);
    } else if (node.type === "fieldSeparator") {
      if (field && !field.separated) {
        field.parts.push(node);
        field.separated = true;
      } else out.add(node);
    } else if (node.type === "fieldEnd") {
      if (!open.fields.pop()) out.add(node);
    } else if (node.type === "controlStart")
      open.controls.set(id, [...(open.controls.get(id) ?? []), node]);
    else if (node.type === "controlEnd") {
      if (!open.controls.get(id)?.pop()) out.add(node);
    } else if (node.content) unpairedMarkers(node.content, out, open, false);
  }
  if (!top) return;
  for (const { parts } of open.fields) for (const part of parts) out.add(part);
  for (const starts of open.controls.values()) for (const start of starts) out.add(start);
}

/**
 * `fitPaste` on validated input. `same`: the content is the target document's own (its lists go
 * on, and an id the definitions lack is kept; from elsewhere it names nothing).
 */
function fit(
  state: EditorState,
  source: WordDefinitions,
  json: NodeJSON,
  same: boolean,
): FittedPaste {
  const target = (wordContext(state) as WordContext).envelope;
  let styles = target.styles;
  let { abstracts, instances } = target.numbering;
  const styleIds = new Map<string, string>();
  const numberingIds = new Map<number, number>();

  const mapStyle = (id: string): string | null => {
    const known = styleIds.get(id);
    if (known !== undefined) return known;
    const style = source.styles.find((s) => s.id === id);
    if (!style) return same ? id : null;
    const name = style.name?.toLowerCase();
    const found = styles.find(
      (s) =>
        s.type === style.type && (name ? s.name?.toLowerCase() === name : !s.name && s.id === id),
    );
    if (found) {
      styleIds.set(id, found.id);
      return found.id;
    }
    const ids = new Set(styles.map((s) => s.id));
    let next = id;
    for (let i = 1; ids.has(next); i++) next = `${id}${i}`;
    // Reserved first: styles name each other (a paragraph style and its linked character style).
    styleIds.set(id, next);
    const copy: StyleJSON = { ...style, id: next };
    // The target keeps its own default style.
    delete copy.isDefault;
    styles = [...styles, copy];
    for (const key of ["basedOn", "next", "link"] as const) {
      const ref = style[key] && mapStyle(style[key]);
      if (ref) copy[key] = ref;
      else delete copy[key];
    }
    if (style.paragraph) copy.paragraph = paragraphProperties(style.paragraph);
    return next;
  };

  const mapLevel = (level: NumberingLevelJSON): NumberingLevelJSON => {
    const { style, ...rest } = level;
    const mapped = style && mapStyle(style);
    return mapped ? { ...level, style: mapped } : rest;
  };

  const mapNumbering = (id: number): number => {
    const known = numberingIds.get(id);
    if (known !== undefined) return known;
    const instance = source.numbering.instances.find((n) => n.id === id);
    const abstract = source.numbering.abstracts.find((a) => a.id === instance?.abstract);
    if (!instance || !abstract) return same ? id : 0;
    // The target's own list, not one this paste added.
    const own = same && target.numbering.instances.find((n) => n.id === id);
    if (
      own &&
      equal(own, instance) &&
      equal(
        target.numbering.abstracts.find((a) => a.id === own.abstract),
        abstract,
      )
    ) {
      numberingIds.set(id, id);
      return id;
    }
    // Reserved first: a level's style may be numbered by this list.
    const copy: NumberingInstanceJSON = {
      ...instance,
      id: Math.max(0, ...instances.map((n) => n.id)) + 1,
    };
    numberingIds.set(id, copy.id);
    instances = [...instances, copy];
    if (instance.overrides)
      copy.overrides = instance.overrides.map((o) =>
        o.definition ? { ...o, definition: mapLevel(o.definition) } : o,
      );
    const mapped: AbstractNumberingJSON = { ...abstract, levels: abstract.levels.map(mapLevel) };
    for (const key of ["styleLink", "numStyleLink"] as const) {
      const ref = abstract[key] && mapStyle(abstract[key]);
      if (ref) mapped[key] = ref;
      else delete mapped[key];
    }
    let existing = abstracts.find((a) => equal({ ...a, id: 0 }, { ...mapped, id: 0 }));
    if (!existing) {
      existing = { ...mapped, id: Math.max(-1, ...abstracts.map((a) => a.id)) + 1 };
      abstracts = [...abstracts, existing];
    }
    copy.abstract = existing.id;
    return copy.id;
  };

  const runMarks = (marks: readonly MarkJSON[]) =>
    marks.flatMap((m) => {
      // A document keeps any link target its file has; another source gives only safe ones.
      if (m.type === "link") return same || isSafeLink(m.attrs) ? [m] : [];
      if (m.type !== "characterStyle") return [m];
      const id = mapStyle(String(m.attrs?.id));
      return id ? [{ ...m, attrs: { id } }] : [];
    });

  /** Properties with their style, list and the mark's character style mapped (none: left out). */
  function paragraphProperties<T extends ParagraphPropertiesJSON>(properties: T): T {
    const { style, numbering, markFormat } = properties;
    const next: T = { ...properties };
    const mapped = style && mapStyle(style);
    if (mapped) next.style = mapped;
    else if (style) delete next.style;
    if (numbering?.id) next.numbering = { ...numbering, id: mapNumbering(numbering.id) };
    if (markFormat) next.markFormat = runMarks(markFormat);
    return next;
  }

  // New ids start above the target's; a pasted bookmark whose name it uses is left out.
  const nextId = { comment: 0, bookmark: 0 };
  for (const c of target.comments) nextId.comment = Math.max(nextId.comment, c.id + 1);
  const names = new Set<string>();
  const { from, to } = state.selection;
  /** What every tree says about ids and names in use (ids are allocated across them). */
  const scan = (tree: Node, inSelection: (pos: number) => boolean) =>
    tree.descendants((node, pos) => {
      const id = (node.attrs.id as number) + 1;
      if (COMMENT_ANCHORS.has(node.type.name)) nextId.comment = Math.max(nextId.comment, id);
      // A bookmark in the selection goes with it.
      if (node.type.name === "bookmarkStart" && !inSelection(pos))
        names.add(String(node.attrs.name));
      if (node.type.name.startsWith("bookmark")) nextId.bookmark = Math.max(nextId.bookmark, id);
      return node.type.name === "doc" || node.isBlock;
    });
  scan(state.doc, (pos) => pos >= from && pos < to);
  for (const tree of otherTrees(state)) scan(tree, () => false);
  // A story holds no comments, note references or section breaks (ADR-0007).
  const inStory = storyBody(state) !== null;
  const fresh = (kind: keyof typeof nextId, map: Map<number, number>, id: number) => {
    let next = map.get(id);
    if (next === undefined) {
      next = nextId[kind]++;
      map.set(id, next);
    }
    return next;
  };
  const commentIds = new Map<number, number>();
  const defined = new Set(source.comments.map((c) => c.id));
  const bookmarkIds = new Map<number, number>();
  const leftOut = new Set<number>();

  // Controls that stay in the document: what is pasted of them is a copy, under a new id.
  let controls = target.controls;
  const staying = new Set<string>();
  for (const range of controlsIn(state.doc))
    if (range.from < from || range.to > to) staying.add(range.id);
  for (const tree of otherTrees(state)) for (const range of controlsIn(tree)) staying.add(range.id);
  const copiedControls = new Map<string, string>();
  const mapControl = (id: unknown): string | null => {
    if (!same || typeof id !== "string" || !Object.hasOwn(target.controls ?? {}, id)) return null;
    if (!staying.has(id)) return id;
    let copy = copiedControls.get(id);
    if (!copy) {
      copy = freshControlId(controls);
      copiedControls.set(id, copy);
      controls = { ...controls, [copy]: copiedControl(target.controls?.[id] as ControlJSON) };
    }
    return copy;
  };
  // A note has one reference: one still in the document keeps it (cut and paste moves it).
  const referredTo = new Set<string>();
  state.doc.descendants((node, pos) => {
    if (node.type.name === "noteReference" && (pos < from || pos >= to))
      referredTo.add(String(node.attrs.story));
  });
  const noteAvailable = (story: string) =>
    same && Object.hasOwn(target.stories ?? {}, story) && !referredTo.has(story);
  const carried = (story: string) =>
    source.notes && Object.hasOwn(source.notes, story) ? source.notes[story] : undefined;
  const newNoteId = noteIds(state);
  /** The new note of each story a pasted reference was copied with. */
  const pastedNotes = new Map<string, string>();

  // Half a field or control from elsewhere: its markers go, what it held stays.
  const unpaired = new Set<NodeJSON>();
  unpairedMarkers([json], unpaired);
  for (const comment of source.comments) unpairedMarkers(comment.content, unpaired);
  for (const note of Object.values(source.notes ?? {})) unpairedMarkers([note.content], unpaired);

  const mapNode = (node: NodeJSON): NodeJSON | null => {
    if (unpaired.has(node)) return null;
    const attrs = node.attrs as Json | undefined;
    if (inStory && (COMMENT_ANCHORS.has(node.type) || node.type === "noteReference")) return null;
    let next: Json | undefined = attrs;
    if (node.type === "noteReference") {
      const story = String(attrs?.story);
      const kind = noteKindOf(story);
      if (kind && carried(story)) {
        const id = pastedNotes.get(story) ?? newNoteId(kind);
        pastedNotes.set(story, id);
        next = { ...attrs, story: id };
      } else if (!noteAvailable(story)) return null;
    } else if (node.type === "controlStart" || node.type === "controlEnd") {
      // From another document their definitions are not here: the content comes without them.
      const id = mapControl(attrs?.id);
      if (!id) return null;
      next = { ...attrs, id };
    } else if (node.type === "paragraph" && attrs) {
      next = paragraphProperties(attrs as ParagraphPropertiesJSON) as Json;
      const change = attrs.formatChange as { previous: ParagraphPropertiesJSON } | null | undefined;
      if (change) next.formatChange = { ...change, previous: paragraphProperties(change.previous) };
      const own = attrs.attributes as Record<string, string> | null | undefined;
      if (own && PARAGRAPH_IDS.some((key) => key in own)) {
        const rest = Object.fromEntries(
          Object.entries(own).filter(([key]) => !PARAGRAPH_IDS.includes(key)),
        );
        if (Object.keys(rest).length) next.attributes = rest;
        else delete next.attributes;
      }
    } else if (node.type === "table" && attrs?.style) {
      next = { ...attrs, style: mapStyle(String(attrs.style)) };
    } else if (node.type === "tableRow" && attrs) {
      const exceptions = attrs.exceptions as Json | null | undefined;
      // A copied row is a new row: not its identity (`w14:paraId`…).
      next = { ...attrs, attributes: null };
      if (exceptions?.style)
        next.exceptions = { ...exceptions, style: mapStyle(String(exceptions.style)) };
    } else if (COMMENT_ANCHORS.has(node.type)) {
      const id = attrs?.id as number;
      if (!defined.has(id)) return null;
      next = { ...attrs, id: fresh("comment", commentIds, id) };
    } else if (node.type === "bookmarkStart" || node.type === "bookmarkEnd") {
      const id = attrs?.id as number;
      if (node.type === "bookmarkStart" && names.has(String(attrs?.name))) leftOut.add(id);
      if (leftOut.has(id)) return null;
      if (node.type === "bookmarkStart") names.add(String(attrs?.name));
      next = { ...attrs, id: fresh("bookmark", bookmarkIds, id) };
    }
    if (inStory && next?.section) {
      next = { ...next };
      delete next.section;
    }
    if (next?.controls) {
      const ids = (next.controls as string[]).flatMap((id) => mapControl(id) ?? []);
      next = { ...next };
      if (ids.length) next.controls = ids;
      else delete next.controls;
    }
    const marks = node.marks && runMarks(node.marks);
    const children = node.content
      ?.map(mapNode)
      .filter((child): child is NodeJSON => child !== null);
    return {
      ...node,
      ...(next ? { attrs: next } : {}),
      ...(marks ? { marks } : {}),
      ...(node.content ? { content: children } : {}),
    } as NodeJSON;
  };

  // Pasted into a block control, the new paragraphs are in it as the one at the caret is.
  const around = (
    from === to || state.selection.$from.parent === state.selection.$to.parent
      ? state.selection.$from.parent.attrs.controls
      : null
  ) as string[] | null | undefined;
  const mapped = mapNode(json) as NodeJSON;
  const inPlace = around?.length
    ? {
        ...mapped,
        content: mapped.content?.map((block) => {
          const attrs = block.attrs as Json | undefined;
          const own = (attrs?.controls as string[] | undefined) ?? [];
          return { ...block, attrs: { ...attrs, controls: [...around, ...own] } };
        }),
      }
    : mapped;
  const doc = parseContent(inPlace, { fragment: true, schema: state.schema });
  const notes = [...pastedNotes].map(([from, id]) => {
    const note = carried(from) as StoryJSON;
    return {
      id,
      story: {
        kind: note.kind,
        doc: parseContent(mapNode(note.content), { schema: state.schema }),
      },
    };
  });
  let comments = target.comments;
  const copiedComments = source.comments.filter((c) => commentIds.has(c.id));
  if (copiedComments.length) {
    comments = [
      ...comments,
      ...copiedComments.map(
        ({ parent, ...comment }): CommentJSON => ({
          ...comment,
          id: commentIds.get(comment.id) as number,
          // A reply whose comment was not copied becomes a comment of its own.
          ...(parent !== undefined && commentIds.has(parent)
            ? { parent: commentIds.get(parent) as number }
            : {}),
          content: comment.content.map((block) => mapNode(block) as NodeJSON),
        }),
      ),
    ];
  }
  const changed =
    styles !== target.styles ||
    abstracts !== target.numbering.abstracts ||
    instances !== target.numbering.instances ||
    comments !== target.comments ||
    controls !== target.controls;
  return {
    doc,
    envelope: changed
      ? {
          ...target,
          styles,
          numbering: { abstracts, instances },
          comments,
          ...(controls ? { controls } : {}),
        }
      : target,
    ...(notes.length ? { notes } : {}),
  };
}
