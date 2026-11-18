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
  migrateToV4,
  migrateToV5,
  type NumberingInstanceJSON,
  type NumberingLevelJSON,
  type ParagraphPropertiesJSON,
  parseContent,
  parseDocument,
  SCHEMA_VERSION,
  type StyleJSON,
} from "../v3/document.js";
import { migrateToV3 } from "../v3/migrate.js";
import { Resolver } from "../v3/resolve.js";
import type { EditorState } from "./state.js";
import { type WordContext, type WordEnvelope, wordContext } from "./word.js";
import { builtinStyle, levels } from "./wordformat.js";

/** What a v3 copy carries beside its content: the definitions the content references. */
export interface WordDefinitions {
  /** The document copied from (`WordContext.id`). */
  document?: string;
  styles: StyleJSON[];
  numbering: { abstracts: AbstractNumberingJSON[]; instances: NumberingInstanceJSON[] };
  comments: CommentJSON[];
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
  const { styles, numbering, comments } = context.envelope;
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
    marks(node.marks);
  };
  visit([content.toJSON()], references);
  const copied = comments.filter((c) => commentIds.has(c.id));
  visit(
    copied.flatMap((c) => c.content),
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
  return { doc: parseContent(json), envelope: fitted.envelope };
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
export function fitPaste(
  state: EditorState,
  content: unknown,
  definitions?: unknown,
): { doc: Node; envelope: WordEnvelope } {
  const context = wordContext(state) as WordContext;
  const target = context.envelope;
  // Taken as this document's own, but it cannot be told to be: no unsafe link comes in.
  if (definitions === undefined || definitions === null)
    return fit(state, target, safeLinks(parseContent(content, "content", true).toJSON()), true);
  const { document, styles, numbering, comments } = definitions as Partial<WordDefinitions>;
  // Validated as a document's envelope: types, ranges, no style based on itself; the content
  // as content to paste (a table may end it).
  const checked = parseDocument({
    schemaVersion: SCHEMA_VERSION,
    section: target.section,
    defaults: {},
    styles,
    numbering,
    comments,
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
  const json = parseContent(content, "content", true).toJSON();
  return fit(state, checked, json, document === context.id);
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
): { doc: Node; envelope: WordEnvelope } {
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
  state.doc.descendants((node, pos) => {
    const id = (node.attrs.id as number) + 1;
    if (COMMENT_ANCHORS.has(node.type.name)) nextId.comment = Math.max(nextId.comment, id);
    // A bookmark in the selection goes with it.
    if (node.type.name === "bookmarkStart" && (pos < from || pos >= to))
      names.add(String(node.attrs.name));
    if (node.type.name.startsWith("bookmark")) nextId.bookmark = Math.max(nextId.bookmark, id);
    return node.type.name === "doc" || node.isTextblock;
  });
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

  const hasControl = (id: unknown) =>
    same && typeof id === "string" && Object.hasOwn(target.controls ?? {}, id);
  // A note has one reference: one still in the document keeps it (cut and paste moves it).
  const referredTo = new Set<string>();
  state.doc.descendants((node, pos) => {
    if (node.type.name === "noteReference" && (pos < from || pos >= to))
      referredTo.add(String(node.attrs.story));
  });
  const noteAvailable = (story: string) =>
    same && Object.hasOwn(target.stories ?? {}, story) && !referredTo.has(story);

  const mapNode = (node: NodeJSON): NodeJSON | null => {
    const attrs = node.attrs as Json | undefined;
    // From another document their definitions are not here: the content comes without them.
    if ((node.type === "controlStart" || node.type === "controlEnd") && !hasControl(attrs?.id))
      return null;
    if (node.type === "noteReference" && !noteAvailable(String(attrs?.story))) return null;
    let next: Json | undefined = attrs;
    if (node.type === "paragraph" && attrs) {
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
    if (next?.controls) {
      const controls = (next.controls as string[]).filter(hasControl);
      next = { ...next };
      if (controls.length) next.controls = controls;
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

  const doc = parseContent(mapNode(json), "content", true);
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
    comments !== target.comments;
  return {
    doc,
    envelope: changed
      ? { ...target, styles, numbering: { abstracts, instances }, comments }
      : target,
  };
}
