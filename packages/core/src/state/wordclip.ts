/**
 * Copy and paste of schema v3 content (8.7c). A copy carries the definitions its content
 * references (styles, numbering, comments); a paste fits them to the target document, as Word
 * does with its default "use destination styles":
 * - A style the target has by name is used; any other is added (a free id if its id is taken).
 * - A list keeps its numbering where the target has the same instance and definition (a copy
 *   inside one document); otherwise it gets an instance of its own (the target's definition
 *   when one is the same).
 * - Comments are copied with new ids, as Word duplicates them.
 * - A bookmark whose name the target already uses is left out, as in Word; others get new ids.
 * - Paragraph ids (`w14:paraId`, `w14:textId`) are left out: export makes the ones it needs.
 *
 * shortcut: ids inside opaque content (a table's bookmarks and paragraph ids) and tracked-change
 * ids are pasted as they are; Word tolerates repeats of both. Map them when a file shows otherwise.
 */
import { DEFAULT_SETTINGS } from "../document.js";
import type { Node, NodeJSON } from "../model/index.js";
import type { DocJSON } from "../schema.js";
import {
  type AbstractNumberingJSON,
  type CommentJSON,
  type NumberingInstanceJSON,
  type NumberingLevelJSON,
  type ParagraphPropertiesJSON,
  parseContentV3,
  parseDocumentV3,
  type StyleJSON,
} from "../v3/document.js";
import { migrateToV3 } from "../v3/migrate.js";
import { Resolver } from "../v3/resolve.js";
import type { EditorState } from "./state.js";
import { type WordContext, type WordEnvelope, wordContext } from "./word.js";
import { builtinStyle, levels } from "./wordformat.js";

/** What a v3 copy carries beside its content: the definitions the content references. */
export interface WordDefinitions {
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

/**
 * The definitions `content` (copied from the document of `envelope`) references: its paragraphs' and
 * runs' styles with the styles they are based on, link to or are followed by, its lists'
 * numbering (a style's included), and its comments.
 */
export function copiedDefinitions(envelope: WordEnvelope, content: Node): WordDefinitions {
  const { styles, numbering, comments } = envelope;
  const styleIds = new Set<string>();
  const numberingIds = new Set<number>();
  const commentIds = new Set<number>();
  const references = (node: NodeJSON) => {
    const attrs = (node.attrs ?? {}) as {
      style?: string;
      numbering?: { id?: number };
      id?: number;
    };
    if (node.type === "paragraph") {
      if (attrs.style) styleIds.add(attrs.style);
      if (attrs.numbering?.id) numberingIds.add(attrs.numbering.id);
    }
    if (COMMENT_ANCHORS.has(node.type)) commentIds.add(attrs.id as number);
    for (const mark of node.marks ?? [])
      if (mark.type === "characterStyle") styleIds.add(String(mark.attrs?.id));
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
  }
  return {
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
  const context = wordContext(state) as WordContext;
  const migrated = migrateToV3({
    schemaVersion: 2,
    settings: DEFAULT_SETTINGS,
    content: content.toJSON() as DocJSON,
  });
  const definitions: WordDefinitions = {
    styles: migrated.styles.map((style) => {
      const builtin = style.name ? builtinStyle(context, style.name) : null;
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
  return { doc: parseContentV3(json), envelope: fitted.envelope };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const PARAGRAPH_IDS = ["w14:paraId", "w14:textId"];

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
  const target = (wordContext(state) as WordContext).envelope;
  if (definitions === undefined || definitions === null)
    return fit(state, target, parseContentV3(content).toJSON(), true);
  const { styles, numbering, comments } = definitions as Partial<WordDefinitions>;
  // Validated as a document's envelope: types, ranges, no style based on itself.
  const checked = parseDocumentV3({
    schemaVersion: 3,
    section: target.section,
    defaults: {},
    styles,
    numbering,
    comments,
    content,
  });
  return fit(state, checked, checked.content, true);
}

/** `fitPaste` on validated input; `keepLists`: a list the target has the same goes on. */
function fit(
  state: EditorState,
  source: WordDefinitions,
  json: NodeJSON,
  keepLists: boolean,
): { doc: Node; envelope: WordEnvelope } {
  const target = (wordContext(state) as WordContext).envelope;
  let styles = target.styles;
  let { abstracts, instances } = target.numbering;
  const styleIds = new Map<string, string>();
  const numberingIds = new Map<number, number>();

  const mapStyle = (id: string): string => {
    const known = styleIds.get(id);
    if (known !== undefined) return known;
    const style = source.styles.find((s) => s.id === id);
    if (!style) return id; // a style that does not exist stays one
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
    styles = [...styles, copy];
    for (const key of ["basedOn", "next", "link"] as const) {
      const ref = style[key];
      if (ref) copy[key] = mapStyle(ref);
    }
    if (style.paragraph) copy.paragraph = paragraphProperties(style.paragraph);
    return next;
  };

  const mapLevel = (level: NumberingLevelJSON): NumberingLevelJSON => ({
    ...level,
    ...(level.style ? { style: mapStyle(level.style) } : {}),
  });

  const mapNumbering = (id: number): number => {
    const known = numberingIds.get(id);
    if (known !== undefined) return known;
    const instance = source.numbering.instances.find((n) => n.id === id);
    const abstract = source.numbering.abstracts.find((a) => a.id === instance?.abstract);
    if (!instance || !abstract) return id;
    const own = keepLists && instances.find((n) => n.id === id);
    if (
      own &&
      same(own, instance) &&
      same(
        abstracts.find((a) => a.id === own.abstract),
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
    const mapped: AbstractNumberingJSON = {
      ...abstract,
      levels: abstract.levels.map(mapLevel),
      ...(abstract.styleLink ? { styleLink: mapStyle(abstract.styleLink) } : {}),
      ...(abstract.numStyleLink ? { numStyleLink: mapStyle(abstract.numStyleLink) } : {}),
    };
    let existing = abstracts.find((a) => same({ ...a, id: 0 }, { ...mapped, id: 0 }));
    if (!existing) {
      existing = { ...mapped, id: Math.max(-1, ...abstracts.map((a) => a.id)) + 1 };
      abstracts = [...abstracts, existing];
    }
    copy.abstract = existing.id;
    return copy.id;
  };

  function paragraphProperties<T extends ParagraphPropertiesJSON>(properties: T): T {
    const { style, numbering } = properties;
    return {
      ...properties,
      ...(style ? { style: mapStyle(style) } : {}),
      ...(numbering?.id ? { numbering: { ...numbering, id: mapNumbering(numbering.id) } } : {}),
    };
  }

  // New ids start above the target's; a pasted bookmark whose name it uses is left out.
  const nextId = { comment: 0, bookmark: 0 };
  for (const c of target.comments) nextId.comment = Math.max(nextId.comment, c.id + 1);
  const names = new Set<string>();
  state.doc.descendants((node) => {
    const id = (node.attrs.id as number) + 1;
    if (COMMENT_ANCHORS.has(node.type.name)) nextId.comment = Math.max(nextId.comment, id);
    if (node.type.name === "bookmarkStart") names.add(String(node.attrs.name));
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
  const bookmarkIds = new Map<number, number>();
  const leftOut = new Set<number>();

  const mapNode = (node: NodeJSON): NodeJSON | null => {
    const attrs = node.attrs as Json | undefined;
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
    } else if (COMMENT_ANCHORS.has(node.type)) {
      next = { ...attrs, id: fresh("comment", commentIds, attrs?.id as number) };
    } else if (node.type === "bookmarkStart" || node.type === "bookmarkEnd") {
      const id = attrs?.id as number;
      if (node.type === "bookmarkStart" && names.has(String(attrs?.name))) leftOut.add(id);
      if (leftOut.has(id)) return null;
      if (node.type === "bookmarkStart") names.add(String(attrs?.name));
      next = { ...attrs, id: fresh("bookmark", bookmarkIds, id) };
    }
    const marks = node.marks?.map((m) =>
      m.type === "characterStyle" ? { ...m, attrs: { id: mapStyle(String(m.attrs?.id)) } } : m,
    );
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

  const doc = parseContentV3(mapNode(json));
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
