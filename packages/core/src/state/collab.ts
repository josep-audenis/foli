/**
 * The collaboration client (22.7, ADR-0012). An authority orders every step; this plugin keeps
 * the steps this editor made that the authority has not confirmed yet, gives them to send
 * (`sendableSteps`), and applies what the authority broadcasts (`receiveTransaction`): its own
 * steps confirmed, everyone else's applied with its unconfirmed steps taken back first and
 * applied again over them (mapped, with mirrored maps, so positions inside them come back).
 * Headless: the app moves the messages.
 */
import type { Node } from "../model/index.js";
import { AddMarkStep, RemoveMarkStep, type Step } from "../transform/steps.js";
import type { CommentJSON } from "../v3/document.js";
import { collabKey, idSlot } from "./ids.js";
import { type EditorState, isRemote, Plugin, remote, type Transaction } from "./state.js";
import {
  afterEnvelopeSteps,
  applyCommentSteps,
  CommentStep,
  EnvelopeStep,
  StoryEditStep,
  storyStepsApply,
  wordContext,
} from "./word.js";

export interface CollabOptions {
  /** The authority's version the document was loaded at. Default 0. */
  version?: number;
  /**
   * Who this editor is to the authority: unique among the live clients of one document. A small
   * integer also gives the editor's new ids their own class (ADR-0012); a string is hashed.
   */
  clientID: string | number;
}

/** A step not confirmed yet, and its inverse on the document it was applied to. */
interface Unconfirmed {
  readonly step: Step;
  /** What takes it back, in order: one step, or several for a mark step (below). */
  readonly inverted: readonly Step[];
}

interface CollabState {
  readonly slot: number;
  readonly version: number;
  readonly clientID: string | number;
  readonly unconfirmed: readonly Unconfirmed[];
}

/** Steps to send: from `version` (the authority's last this editor has), made by `clientID`. */
export interface SendableSteps {
  readonly version: number;
  readonly steps: readonly Step[];
  readonly clientID: string | number;
}

/**
 * The steps that take `step` back on the document it made of `before`. A mark step's own inverse
 * is exact only on the document `Transform.addMark` built it for; mapped onto another (a mark of
 * the same type with other attributes there, which it replaced), it is not: there, the marks each
 * inline node lost are added back and those it gained removed, node by node (mark steps move no
 * position, so these map like the step).
 */
function inverseOf(step: Step, before: Node, comments: readonly CommentJSON[] = []): Step[] {
  // A comment removed goes back where it was in the list, not where it was first added.
  if (step instanceof CommentStep && step.previous && !step.comment) {
    const at = comments.findIndex((c) => c.id === step.id);
    return [new CommentStep(step.id, step.previous, null, at < 0 ? step.index : at)];
  }
  const inverted = step.invert(before);
  if (!(step instanceof AddMarkStep || step instanceof RemoveMarkStep)) return [inverted];
  const after = step.apply(before).doc;
  if (!after || inverted.apply(after).doc?.eq(before)) return [inverted];
  const removes: Step[] = [];
  const adds: Step[] = [];
  before.nodesBetween(step.from, step.to, (node, pos) => {
    if (!node.isInline) return true;
    const from = Math.max(pos, step.from);
    const to = Math.min(pos + node.nodeSize, step.to);
    const now = after.nodeAt(pos);
    if (!now || from >= to) return false;
    for (const mark of now.marks)
      if (!mark.isInSet(node.marks)) removes.push(new RemoveMarkStep(from, to, mark));
    for (const mark of node.marks)
      if (!mark.isInSet(now.marks)) adds.push(new AddMarkStep(from, to, mark));
    return false;
  });
  return [...removes, ...adds];
}

/**
 * The inverse of each step of `tr`, in order (each against the document it was applied to, and
 * the comments as the steps before it left them, from `comments`).
 */
function inversesOf(
  steps: readonly Step[],
  docs: readonly Node[],
  comments: readonly CommentJSON[],
): Unconfirmed[] {
  let list = comments;
  return steps.map((step, i) => {
    const inverted = inverseOf(step, docs[i] as Node, list);
    list = applyCommentSteps(list, [step]);
    return { step, inverted };
  });
}

const commentsOf = (state: EditorState): readonly CommentJSON[] =>
  wordContext(state)?.envelope.comments ?? [];

/**
 * The collaboration plugin: give it to `createEditor` (`plugins`) with the version the document
 * was loaded at and this editor's client id.
 */
export function collab({ version = 0, clientID }: CollabOptions): Plugin<CollabState> {
  return new Plugin<CollabState>({
    key: collabKey as never,
    state: {
      init: () => ({ slot: idSlot(clientID), version, clientID, unconfirmed: [] }),
      apply(tr, value, before) {
        const own = tr.getMeta(collabKey) as CollabState | undefined;
        if (own) return own;
        if (!tr.docChanged || isRemote(tr)) return value;
        return {
          ...value,
          unconfirmed: [...value.unconfirmed, ...inversesOf(tr.steps, tr.docs, commentsOf(before))],
        };
      },
    },
  });
}

const stateOf = (state: EditorState): CollabState => {
  const value = collabKey.getState(state) as CollabState | undefined;
  if (!value || !("version" in value)) throw new RangeError("The editor has no collab plugin");
  return value;
};

/** The authority's version this editor has received up to. */
export const getVersion = (state: EditorState): number => stateOf(state).version;

/** The steps to send the authority, or null when every step of this editor is confirmed. */
export function sendableSteps(state: EditorState): SendableSteps | null {
  const { version, unconfirmed, clientID } = stateOf(state);
  return unconfirmed.length ? { version, steps: unconfirmed.map((u) => u.step), clientID } : null;
}

/**
 * The transaction that applies `steps` the authority broadcast (from this editor's version, in
 * its order, `clientIDs[i]` the author of `steps[i]`): dispatch it. This editor's own steps
 * among them are confirmed; the others are applied, its unconfirmed steps rebased over them.
 * It is `remote`: not undoable, not tracked, nothing appended; history maps over it.
 */
export function receiveTransaction(
  state: EditorState,
  steps: readonly Step[],
  clientIDs: readonly (string | number)[],
): Transaction {
  const current = stateOf(state);
  const version = current.version + steps.length;
  // The authority keeps one client's steps together, in order: ours come first.
  let ours = 0;
  // Compared as text: a transport may give `"1"` for `1`.
  const own = String(current.clientID);
  while (ours < clientIDs.length && String(clientIDs[ours]) === own) ours++;
  let unconfirmed = current.unconfirmed.slice(ours);
  const theirs = steps.slice(ours);
  const tr = state.tr.setMeta(remote, true);
  if (!theirs.length) return tr.setMeta(collabKey, { ...current, version, unconfirmed });
  const count = unconfirmed.length;
  // Ours taken back, last first; where each one's inverse ends in the mapping.
  const ends: number[] = [];
  for (let i = count - 1; i >= 0; i--) {
    for (const inverse of (unconfirmed[i] as Unconfirmed).inverted) tr.step(inverse);
    ends[i] = tr.steps.length;
  }
  for (const step of theirs) tr.step(step);
  const context = wordContext(state);
  const rebased: Step[] = [];
  unconfirmed.forEach(({ step, inverted }, i) => {
    const end = ends[i] as number;
    let mapped: Step | null = step.map(tr.mapping.slice(end));
    if (context) {
      // An envelope change made from what the others changed since: merged over it.
      if (mapped instanceof EnvelopeStep)
        mapped = mapped.rebase(afterEnvelopeSteps(context.envelope, tr.steps));
      // A comment changed since by someone else: this change goes on from theirs (undo then
      // gives theirs back, not what this editor saw).
      if (mapped instanceof CommentStep && mapped.comment) {
        const id = mapped.id;
        const now = applyCommentSteps(context.envelope.comments, tr.steps).find((c) => c.id === id);
        mapped = new CommentStep(id, mapped.comment, now ?? null, mapped.index);
      }
      // A story edit whose steps no longer apply to the story: left out (an edit lost, as
      // typing into text someone deleted is), never a receive the word plugin would refuse.
      if (
        mapped instanceof StoryEditStep &&
        !storyStepsApply(context.stories, [...tr.steps, mapped])
      )
        mapped = null;
    }
    if (mapped && !tr.maybeStep(mapped).failed) {
      // Mirrored when its inverse was one step: a position it took back is found again.
      if (inverted.length === 1) tr.mapping.setMirror(end - 1, tr.steps.length - 1);
      rebased.push(mapped);
    }
  });
  // Story edits learn the trees they apply to, so they can be inverted.
  if (context) storyStepsApply(context.stories, tr.steps);
  const start = tr.steps.length - rebased.length;
  const comments = applyCommentSteps(commentsOf(state), tr.steps.slice(0, start));
  unconfirmed = inversesOf(rebased, tr.docs.slice(start), comments);
  return tr.setMeta(collabKey, { ...current, version, unconfirmed });
}
