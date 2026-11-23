/**
 * Editing a schema v3 document as Word edits it (8.7). An editor holding a v3 document keeps
 * the document's envelope (styles, numbering, defaults, theme) in a plugin state field, and the
 * generic commands consult it: Enter splits a paragraph as Word does, the bold, italic,
 * underline and strike toggles act on the formatting text shows (a heading's style bold
 * included), and Backspace and Delete step over the invisible markers (bookmarks, comment
 * ranges) and select opaque content before deleting it.
 */
import { deepEqual } from "../model/attrs.js";
import { fail } from "../model/errors.js";
import type { Attrs, Mark, MarkType, Node, Schema } from "../model/index.js";
import { natural, record, Step, type StepJSON, StepResult } from "../transform/steps.js";
import { text } from "../v3/check.js";
import type { CommentJSON, FoliDocument, StoryJSON } from "../v3/document.js";
import {
  checkCommentJSON,
  envelopeValueError,
  parseContent,
  parseStory,
  schemaVersionOf,
} from "../v3/document.js";
import { writeCustom } from "../v3/extensions.js";
import { Resolver, type RunFormat } from "../v3/resolve.js";
import { MARK_ATTRS } from "./mark.js";
import { NodeSelection, type SelectionJSON, TextSelection } from "./selection.js";
import { type Command, EditorState, Plugin, PluginKey, type Transaction } from "./state.js";

/** A v3 document without its content: what the editor keeps beside the edited tree. */
export type WordEnvelope = Omit<FoliDocument, "content">;

/**
 * The document of an editor's `envelope` and tree `doc`, as apps get it (`getDocument`, React's
 * `onChange`): a copy, foreign nodes and marks written back as the custom types they stand for.
 */
export function documentJSON(envelope: WordEnvelope, doc: Node): FoliDocument {
  const { stories, comments, ...rest } = structuredClone(envelope);
  const out: FoliDocument = {
    ...rest,
    comments: comments.map((c) => ({ ...c, content: c.content.map(writeCustom) })),
    ...(stories && {
      stories: Object.fromEntries(
        Object.entries(stories).map(([id, s]) => [id, { ...s, content: writeCustom(s.content) }]),
      ),
    }),
    content: writeCustom(doc.toJSON()),
  };
  // Saved with the lowest schema its content needs now (ADR-0008).
  out.schemaVersion = schemaVersionOf(out);
  return out;
}

/** A story as the editor holds it: its tree, and what the envelope says beside it. */
export interface Story extends Omit<StoryJSON, "content"> {
  readonly doc: Node;
}

export interface WordContext {
  readonly envelope: WordEnvelope;
  readonly resolver: Resolver;
  /** The envelope's `stories` as trees: what `StoryStep`s hold and compare. */
  readonly stories: ReadonlyMap<string, Story>;
  /**
   * Made when the document is loaded and kept while it is edited: a copy carries it, so a paste
   * tells this document's lists from another's (Word's `w:nsid`; Foli makes equal definitions
   * in every document).
   */
  readonly id: string;
}

const key = new PluginKey<WordContext>("word");

/**
 * Sets, adds or removes the envelope's comment `id` (`comment` null removes it). A step, unlike
 * `withEnvelope`, so undo and redo take comments with the text they annotate. It leaves the
 * tree as it is; `index` is where an added comment goes in the list (a removed one's place).
 */
export class CommentStep extends Step {
  constructor(
    readonly id: number,
    readonly comment: CommentJSON | null,
    readonly previous: CommentJSON | null,
    readonly index: number,
  ) {
    super();
  }

  apply(doc: Node): StepResult {
    return StepResult.ok(doc);
  }

  invert(): Step {
    return new CommentStep(this.id, this.previous, this.comment, this.index);
  }

  map(): Step {
    return this;
  }

  override toJSON(): StepJSON {
    const { id, comment, previous, index } = this;
    return { stepType: "comment", id, comment, previous, index };
  }
}

// Registered when this module loads, which every editor does (`createEditor`, the word plugin).
Step.jsonID("comment", (schema, value) => {
  const json = record(value, "$", ["stepType", "id", "comment", "previous", "index"]);
  const id = natural(json, "id");
  const read = (key: "comment" | "previous"): CommentJSON | null => {
    const comment = json[key];
    if (comment === null) return null;
    checkCommentJSON(comment, schema, `$.${key}`);
    if ((comment as CommentJSON).id !== id) fail(`$.${key}.id`, "must be the step's id");
    return structuredClone(comment as CommentJSON);
  };
  const comment = read("comment");
  const previous = read("previous");
  if (!comment && !previous) fail("$", "a comment step changes a comment");
  return new CommentStep(id, comment, previous, natural(json, "index"));
});

/**
 * `comments` after the comment steps among `steps`.
 * @internal
 */
export function applyCommentSteps(
  comments: readonly CommentJSON[],
  steps: readonly Step[],
): readonly CommentJSON[] {
  let next = comments;
  for (const step of steps) {
    if (!(step instanceof CommentStep)) continue;
    const at = next.findIndex((c) => c.id === step.id);
    // A change made since (outside history) wins: undo does not bring back or overwrite it.
    if ((step.previous === null) !== at < 0) continue;
    const rest = at < 0 ? next : [...next.slice(0, at), ...next.slice(at + 1)];
    if (!step.comment) next = rest;
    else {
      const index = at < 0 ? Math.min(step.index, rest.length) : at;
      next = [...rest.slice(0, index), step.comment, ...rest.slice(index)];
    }
  }
  return next;
}

/**
 * Makes `tr` change the comments from `from` (the state's) to `to`, one `CommentStep` per
 * comment added, changed or removed, after any comment steps `tr` already has. Comments kept
 * keep their order (a new one goes at its index in `to`).
 */
export function setComments(
  tr: Transaction,
  from: readonly CommentJSON[],
  to: readonly CommentJSON[],
): Transaction {
  let current = applyCommentSteps(from, tr.steps);
  const wanted = new Map(to.map((c) => [c.id, c]));
  for (const c of current)
    if (!wanted.has(c.id)) {
      tr.step(new CommentStep(c.id, null, c, current.indexOf(c)));
      current = applyCommentSteps(current, tr.steps.slice(-1));
    }
  to.forEach((c, index) => {
    const before = current.find((p) => p.id === c.id) ?? null;
    if (before === c || (before && JSON.stringify(before) === JSON.stringify(c))) return;
    tr.step(new CommentStep(c.id, c, before, index));
    current = applyCommentSteps(current, tr.steps.slice(-1));
  });
  return tr;
}

/** What `EnvelopeStep` can change (ADR-0007). */
export type EnvelopeKey = "section" | "settings" | "controls";

/**
 * Changes one value of the envelope (the last section's setup, the document's settings) from
 * `before` to `after`. A step, unlike `withEnvelope`, so undo and redo take it with the edit it
 * belongs to. It leaves the tree as it is; history refuses an undo whose `before` no longer holds.
 */
export class EnvelopeStep<K extends EnvelopeKey = EnvelopeKey> extends Step {
  constructor(
    readonly key: K,
    readonly before: WordEnvelope[K],
    readonly after: WordEnvelope[K],
  ) {
    super();
  }

  apply(doc: Node): StepResult {
    return StepResult.ok(doc);
  }

  invert(): Step {
    return new EnvelopeStep(this.key, this.after, this.before);
  }

  map(): Step {
    return this;
  }

  override toJSON(): StepJSON {
    return { stepType: "envelope", key: this.key, before: this.before, after: this.after };
  }
}

const ENVELOPE_KEYS: readonly string[] = ["section", "settings", "controls"];

Step.jsonID("envelope", (_schema, value) => {
  const json = record(value, "$", ["stepType", "key", "before", "after"]);
  const key = json.key as EnvelopeKey;
  if (!ENVELOPE_KEYS.includes(key)) fail("$.key", `unknown envelope key ${JSON.stringify(key)}`);
  for (const side of ["before", "after"]) {
    const error = envelopeValueError(key, [], json[side]);
    if (error) fail(`$.${side}`, error);
  }
  return new EnvelopeStep(
    key,
    structuredClone(json.before) as never,
    structuredClone(json.after) as never,
  );
});

/**
 * Changes story `id` from `before` to `after` (null: no story), a step of the body's transaction
 * (ADR-0007): its inverse needs no document, it moves no position of the body. The selections are
 * the story's around the change, so undo can give it back.
 */
export class StoryStep extends Step {
  constructor(
    readonly id: string,
    readonly before: Story | null,
    readonly after: Story | null,
    readonly selectionBefore: SelectionJSON | null = null,
    readonly selectionAfter: SelectionJSON | null = null,
  ) {
    super();
  }

  apply(doc: Node): StepResult {
    return StepResult.ok(doc);
  }

  invert(): Step {
    return new StoryStep(
      this.id,
      this.after,
      this.before,
      this.selectionAfter,
      this.selectionBefore,
    );
  }

  map(): Step {
    return this;
  }

  override toJSON(): StepJSON {
    return {
      stepType: "story",
      id: this.id,
      before: this.before && storyJSON(this.before),
      after: this.after && storyJSON(this.after),
      selectionBefore: this.selectionBefore,
      selectionAfter: this.selectionAfter,
    };
  }

  /** This step followed by `next`, when `next` starts from what this one leaves. */
  merge(next: StoryStep): StoryStep | null {
    if (next.id !== this.id || !sameStory(this.after, next.before)) return null;
    return new StoryStep(
      this.id,
      this.before,
      next.after,
      this.selectionBefore,
      next.selectionAfter,
    );
  }
}

/** A selection's JSON, checked: a known type and two positions (clamped when restored). */
function selectionJSON(value: unknown, path: string): SelectionJSON | null {
  if (value === null) return null;
  const json = record(value, path, ["type", "anchor", "head"]);
  if (!["text", "node", "all", "cell"].includes(json.type as string))
    fail(`${path}.type`, "unknown selection type");
  return {
    type: json.type as SelectionJSON["type"],
    anchor: natural(json, "anchor", path),
    head: natural(json, "head", path),
  };
}

Step.jsonID("story", (schema, value) => {
  const json = record(value, "$", [
    "stepType",
    "id",
    "before",
    "after",
    "selectionBefore",
    "selectionAfter",
  ]);
  // As `parseDocument` reads the keys of `stories`: an own `__proto__` would be lost.
  const idError =
    typeof json.id !== "string"
      ? "expected a story id"
      : json.id === "__proto__"
        ? "is not a story id"
        : text()(json.id);
  if (idError) fail("$.id", idError);
  const read = (key: "before" | "after"): Story | null => {
    if (json[key] === null) return null;
    const doc = parseStory(json[key], schema, `$.${key}`);
    const { content: _content, ...rest } = structuredClone(json[key] as StoryJSON);
    return { ...rest, doc };
  };
  const before = read("before");
  const after = read("after");
  if (!before && !after) fail("$", "a story step changes a story");
  return new StoryStep(
    json.id as string,
    before,
    after,
    selectionJSON(json.selectionBefore ?? null, "$.selectionBefore"),
    selectionJSON(json.selectionAfter ?? null, "$.selectionAfter"),
  );
});

/**
 * Whether two stories are the same: identical trees are the usual case.
 * @internal
 */
export function sameStory(a: Story | null | undefined, b: Story | null | undefined): boolean {
  if (a === b || (!a && !b)) return true;
  return (
    !!a &&
    !!b &&
    a.kind === b.kind &&
    a.noteType === b.noteType &&
    a.ext === b.ext &&
    (a.doc === b.doc || a.doc.eq(b.doc))
  );
}

/** A story's JSON in the envelope. */
function storyJSON({ doc, ...rest }: Story): StoryJSON {
  return { ...rest, content: doc.toJSON() };
}

/** The value of `key` as `steps` leave it, from `value`. */
function afterEnvelopeSteps<K extends EnvelopeKey>(
  key: K,
  value: WordEnvelope[K],
  steps: readonly Step[],
): WordEnvelope[K] {
  let current = value;
  for (const step of steps)
    if (step instanceof EnvelopeStep && step.key === key) current = step.after as WordEnvelope[K];
  return current;
}

/**
 * Makes `tr` set the envelope's `key` to `value`, from what it holds after `tr` so far.
 * @internal
 */
export function setEnvelopeValue<K extends EnvelopeKey>(
  state: EditorState,
  tr: Transaction,
  key: K,
  value: WordEnvelope[K],
): Transaction {
  const envelope = wordContext(state)?.envelope;
  if (!envelope) return tr;
  return tr.step(new EnvelopeStep(key, afterEnvelopeSteps(key, envelope[key], tr.steps), value));
}

/**
 * Whether stored `steps` can apply to `context`: every `EnvelopeStep` and `StoryStep` finds what
 * it expects, given the ones before it. A change made outside history makes them stale.
 * @internal
 */
export function storedStepsApply(context: WordContext, steps: readonly Step[]): boolean {
  const values = new Map<EnvelopeKey, unknown>();
  const stories = new Map<string, Story | null>();
  for (const step of steps) {
    if (step instanceof EnvelopeStep) {
      const key = step.key as EnvelopeKey;
      const current = values.has(key) ? values.get(key) : context.envelope[key];
      if (!deepEqual(current, step.before)) return false;
      values.set(key, step.after);
    } else if (step instanceof StoryStep) {
      const current = stories.has(step.id)
        ? stories.get(step.id)
        : (context.stories.get(step.id) ?? null);
      if (!sameStory(current, step.before)) return false;
      stories.set(step.id, step.after);
    }
  }
  return true;
}

/**
 * The story as `tr` leaves it (`state`'s, after the story steps `tr` already has).
 * @internal
 */
export function storyAfter(state: EditorState, tr: Transaction, id: string): Story | null {
  let story = wordContext(state)?.stories.get(id) ?? null;
  for (const step of tr.steps) if (step instanceof StoryStep && step.id === id) story = step.after;
  return story;
}

/**
 * What a story's editor knows of the body's: undo, and the trees it allocates ids across.
 * @internal
 */
export interface StoryBody {
  readonly state: EditorState;
  dispatch(tr: Transaction): void;
  run(command: Command): boolean;
  can(command: Command): boolean;
}

/**
 * On the state of a story's editor: the body it belongs to.
 * @internal
 */
export const storyBodyKey = new PluginKey<StoryBody>("storyBody");

/**
 * The body of the story `state` edits; null when `state` is the body's.
 * @internal
 */
export const storyBody = (state: EditorState): StoryBody | null =>
  storyBodyKey.getState(state) ?? null;

/**
 * A state over a story's `doc` for working on it, with `state`'s word context (and `envelope`).
 * @internal
 */
export function storyState(state: EditorState, doc: Node, envelope?: WordEnvelope): EditorState {
  const context = wordContext(state) as WordContext;
  const given = envelope ? { ...context, envelope } : context;
  return EditorState.create({ doc, plugins: [wordPlugin(given.envelope, given)] });
}

/**
 * Every tree of the document but `state`'s own: ids are allocated across them (ADR-0007).
 * @internal
 */
export function otherTrees(state: EditorState): Node[] {
  const trees = [...(wordContext(state)?.stories.values() ?? [])].map((story) => story.doc);
  const body = storyBody(state)?.state.doc;
  return (body ? [body, ...trees] : trees).filter((tree) => tree !== state.doc);
}

/** The trees of `envelope`'s stories, in the editor's `schema`. */
function storyTrees(envelope: WordEnvelope, schema: Schema): Map<string, Story> {
  return new Map(
    Object.entries(envelope.stories ?? {}).map(([id, { content, ...rest }]) => [
      id,
      {
        ...rest,
        doc: parseContent(content, { path: `stories[${JSON.stringify(id)}].content`, schema }),
      },
    ]),
  );
}

/**
 * The plugin that gives commands a v3 document's envelope. A transaction changes it with
 * `withEnvelope` (a new list's numbering definition); undo leaves such additions, as Word does.
 * Comments change only through `CommentStep`s, the last section, the settings and the controls'
 * properties through `EnvelopeStep`s and stories through `StoryStep`s, which undo takes back (a
 * paste adds the properties of the controls it copies with `withEnvelope`). A story's editor is
 * given its body's `context` as it stands.
 * @internal
 */
export function wordPlugin(envelope: WordEnvelope, context?: WordContext): Plugin<WordContext> {
  // Not a secret: only tells documents apart.
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return new Plugin({
    key,
    state: {
      init: (state) =>
        context ?? {
          envelope,
          resolver: new Resolver(envelope),
          stories: storyTrees(envelope, state.schema),
          id,
        },
      apply: (tr, value) => {
        const adopted = tr.getMeta(ADOPT) as WordContext | undefined;
        if (adopted) return adopted;
        const next = tr.getMeta(key) as WordEnvelope | undefined;
        const comments = applyCommentSteps(value.envelope.comments, tr.steps);
        const base = next ?? value.envelope;
        const section = afterEnvelopeSteps("section", base.section, tr.steps);
        const settings = afterEnvelopeSteps("settings", value.envelope.settings, tr.steps);
        const controls = afterEnvelopeSteps("controls", base.controls, tr.steps);
        let { stories } = value;
        let storiesJSON = value.envelope.stories;
        for (const step of tr.steps) {
          if (!(step instanceof StoryStep)) continue;
          const trees = new Map(stories);
          const json = { ...storiesJSON };
          if (step.after) {
            trees.set(step.id, step.after);
            json[step.id] = storyJSON(step.after);
          } else {
            trees.delete(step.id);
            delete json[step.id];
          }
          stories = trees;
          storiesJSON = json;
        }
        if (
          !next &&
          comments === value.envelope.comments &&
          section === base.section &&
          settings === value.envelope.settings &&
          controls === value.envelope.controls &&
          stories === value.stories
        )
          return value;
        const { stories: _stories, settings: _settings, controls: _controls, ...rest } = base;
        const envelope: WordEnvelope = {
          ...rest,
          section,
          comments: comments as CommentJSON[],
          ...(storiesJSON && Object.keys(storiesJSON).length ? { stories: storiesJSON } : {}),
          ...(settings ? { settings } : {}),
          ...(controls ? { controls } : {}),
        };
        // Only comments, stories or steps changed: they do not affect formatting.
        const resolver = next ? new Resolver(envelope) : value.resolver;
        return { envelope, resolver, stories, id: value.id };
      },
    },
  });
}

/**
 * Makes `tr` change the document's envelope to `envelope` (styles, numbering…). Its comments
 * are ignored: those change through `setComments`, so undo takes them back.
 */
export function withEnvelope(tr: Transaction, envelope: WordEnvelope): Transaction {
  return tr.setMeta(key, envelope);
}

const ADOPT = "adoptWordContext";

/**
 * Makes `tr` give a story's state the body's context as it now is.
 * @internal
 */
export const withContext = (tr: Transaction, context: WordContext): Transaction =>
  tr.setMeta(ADOPT, context);

/**
 * The envelope `tr` gives the document through `withEnvelope`, if any.
 * @internal
 */
export const envelopeChange = (tr: Transaction): WordEnvelope | undefined =>
  tr.getMeta(key) as WordEnvelope | undefined;

/** The envelope and resolver of the v3 document in `state`, or null for a v2 editor. */
export function wordContext(state: EditorState): WordContext | null {
  return key.getState(state) ?? null;
}

/**
 * What the paragraph mark carries alone (`MARK_ATTRS`): a split leaves it on the second
 * paragraph, which keeps the original mark.
 */
const MARK_ONLY = Object.fromEntries(MARK_ATTRS.map((key) => [key, null]));

/** The id of the default paragraph style: the last one marked default, as `Resolver` reads it. */
function defaultParagraphStyle(envelope: WordEnvelope): string | undefined {
  let id: string | undefined;
  for (const style of envelope.styles)
    if (style.type === "paragraph" && style.isDefault) id = style.id;
  return id;
}

/**
 * The attributes of the two paragraphs Enter makes of `paragraph`. The first gets a new mark
 * with the same properties; the second keeps the original mark. At the end of a paragraph whose
 * style names another as the next (a heading: Normal), the second paragraph is in that style,
 * without the first's direct formatting. `before` is null when the first keeps every attribute.
 * @internal
 */
export function splitAttrs(
  context: WordContext,
  paragraph: Node,
  atEnd: boolean,
): { before: Attrs | null; after: Attrs } {
  const attrs = paragraph.attrs;
  const markOnly = Object.keys(MARK_ONLY).some((k) => attrs[k] !== null);
  const before = markOnly ? { ...attrs, ...MARK_ONLY } : null;
  if (!atEnd) return { before, after: attrs };
  const id = (attrs.style as string | null) ?? defaultParagraphStyle(context.envelope);
  const style = context.envelope.styles.find((s) => s.id === id);
  const next = style?.next;
  if (next === undefined || next === id) return { before, after: attrs };
  const mark = Object.fromEntries(Object.keys(MARK_ONLY).map((k) => [k, attrs[k] ?? null]));
  // The new paragraph is in the same content controls.
  return { before, after: { ...mark, controls: attrs.controls, style: next } };
}

/** Run toggles: whether text shows the property, from its resolved formatting. */
const TOGGLES: Record<string, (run: RunFormat) => boolean> = {
  bold: (run) => run.bold,
  italic: (run) => run.italic,
  underline: (run) => run.underline !== null,
  strike: (run) => run.strike,
  doubleStrike: (run) => run.doubleStrike,
  caps: (run) => run.caps,
  smallCaps: (run) => run.smallCaps,
  hidden: (run) => run.hidden,
};

/**
 * Whether `type` is a run property the toggles handle on a v3 document.
 * @internal
 */
export function isWordToggle(context: WordContext | null, type: MarkType): boolean {
  return context !== null && Object.hasOwn(TOGGLES, type.name);
}

/** Whether text with `marks` in `paragraph` shows the toggle `type` (marks included or not). */
function shows(
  context: WordContext,
  paragraph: Node,
  marks: readonly Mark[],
  type: MarkType,
  own = true,
): boolean {
  const { run } = context.resolver.paragraph(paragraph.attrs);
  const json = marks.filter((m) => own || m.type !== type).map((m) => m.toJSON());
  return (TOGGLES[type.name] as (run: RunFormat) => boolean)(context.resolver.run(run, json));
}

/**
 * The direct mark that makes text show the toggle `type` as `on`, given what it shows without
 * one (`inherited`); null when no mark is needed. Bold and italic keep their complex-script twin.
 */
function directMark(type: MarkType, on: boolean, inherited: boolean, existing?: Mark): Mark | null {
  const twin = existing?.attrs.complexScript ?? null;
  const hasTwin = Object.hasOwn(type.spec.attrs ?? {}, "complexScript");
  if (on === inherited)
    return hasTwin && twin !== null ? type.create({ value: null, complexScript: twin }) : null;
  if (type.name === "underline") return type.create({ style: on ? "single" : "none" });
  return type.create(hasTwin ? { value: on, complexScript: twin } : { value: on });
}

/**
 * The inline nodes a toggle formats in a range (not markers: nothing to format), and those it
 * judges: text nodes, or every one when there is none.
 */
function inlineIn(state: EditorState, from: number, to: number, type: MarkType) {
  const found: { node: Node; pos: number; parent: Node }[] = [];
  state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (!node.isInline || !parent?.type.allowsMarkType(type)) return undefined;
    if (MARKERS.has(node.type.name)) return false;
    found.push({ node, pos, parent });
    return false;
  });
  const text = found.filter((f) => f.node.isText);
  return text.length ? { all: found, judged: text } : { all: found, judged: found };
}

/**
 * Whether all the selected text (or the text typed at a caret) shows the toggle `type`.
 * @internal
 */
export function wordToggleActive(
  context: WordContext,
  state: EditorState,
  type: MarkType,
  caretMarks: readonly Mark[] | null,
): boolean {
  const { selection } = state;
  if (caretMarks) return shows(context, selection.$from.parent, caretMarks, type);
  const judged = selection.ranges.flatMap((r) => inlineIn(state, r.from, r.to, type).judged);
  return judged.length > 0 && judged.every((f) => shows(context, f.parent, f.node.marks, type));
}

/**
 * The stored marks for a toggle at a caret: what makes the next typed text show the opposite of
 * what text typed there would show now.
 * @internal
 */
export function toggledCaretMarks(
  context: WordContext,
  paragraph: Node,
  marks: readonly Mark[],
  type: MarkType,
): readonly Mark[] {
  const on = !shows(context, paragraph, marks, type);
  const existing = type.isInSet(marks);
  const rest = existing ? existing.removeFromSet(marks) : marks;
  const mark = directMark(type, on, shows(context, paragraph, marks, type, false), existing);
  return mark ? mark.addToSet(rest) : rest;
}

/**
 * The mark changes that make every inline node in `from..to` show the toggle `type` as `on`:
 * per node, a direct mark where its style does not already give that, none where it does.
 * @internal
 */
export function toggleRanges(
  context: WordContext,
  state: EditorState,
  from: number,
  to: number,
  type: MarkType,
  on: boolean,
): { from: number; to: number; mark: Mark | null }[] {
  return inlineIn(state, from, to, type).all.map(({ node, pos, parent }) => ({
    from: Math.max(from, pos),
    to: Math.min(to, pos + node.nodeSize),
    mark: directMark(
      type,
      on,
      shows(context, parent, node.marks, type, false),
      type.isInSet(node.marks),
    ),
  }));
}

/** Zero-width markers: nothing to see, so the caret and deletion step over them. */
const MARKERS = new Set([
  "bookmarkStart",
  "bookmarkEnd",
  "commentStart",
  "commentEnd",
  "controlStart",
  "controlEnd",
  // A field's parts and a note's own number: deleting one alone would break what it belongs to.
  "fieldStart",
  "fieldCode",
  "fieldSeparator",
  "fieldEnd",
  "noteMark",
  // A comment's reference mark: deleting it would take the comment's anchor.
  "commentReference",
]);

/**
 * Whether `node` is an invisible marker of a v3 document.
 * @internal
 */
export function isMarker(context: WordContext | null, node: Node | null | undefined): boolean {
  return context !== null && !!node && MARKERS.has(node.type.name);
}

const OPAQUE = new Set(["opaqueInline", "opaqueBlock", "foreignInline", "foreignBlock"]);

/**
 * Opaque content (and foreign nodes, ADR-0008): deleted only once selected, as Word selects a field before deleting it.
 * @internal
 */
export function isOpaque(context: WordContext | null, node: Node | null | undefined): boolean {
  return context !== null && !!node && OPAQUE.has(node.type.name);
}

/**
 * A node selection of the node at `pos`, or a text selection when it cannot be selected.
 * @internal
 */
export function selectionAt(state: EditorState, pos: number): NodeSelection | TextSelection {
  const node = state.doc.nodeAt(pos);
  return node && NodeSelection.isSelectable(node)
    ? NodeSelection.create(state.doc, pos)
    : TextSelection.create(state.doc, pos);
}
