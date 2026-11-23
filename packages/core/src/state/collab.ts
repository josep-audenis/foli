/**
 * The collaboration client (22.7, ADR-0012). An authority orders every step; this plugin keeps
 * the steps this editor made that the authority has not confirmed yet, gives them to send
 * (`sendableSteps`), and applies what the authority broadcasts (`receiveTransaction`): its own
 * steps confirmed, everyone else's applied with its unconfirmed steps taken back first and
 * applied again over them (mapped, with mirrored maps, so positions inside them come back).
 * Headless: the app moves the messages.
 */
import type { Node } from "../model/index.js";
import type { Step } from "../transform/steps.js";
import { collabKey, idSlot } from "./ids.js";
import { type EditorState, isRemote, Plugin, remote, type Transaction } from "./state.js";
import { afterEnvelopeSteps, EnvelopeStep, storyStepsApply, wordContext } from "./word.js";

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
  readonly inverted: Step;
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

/** The inverse of each step of `tr`, in order (each against the document it was applied to). */
function unconfirmedOf(tr: Transaction): Unconfirmed[] {
  return tr.steps.map((step, i) => ({ step, inverted: step.invert(tr.docs[i] as Node) }));
}

/**
 * The collaboration plugin: give it to `createEditor` (`plugins`) with the version the document
 * was loaded at and this editor's client id.
 */
export function collab({ version = 0, clientID }: CollabOptions): Plugin<CollabState> {
  return new Plugin<CollabState>({
    key: collabKey as never,
    state: {
      init: () => ({ slot: idSlot(clientID), version, clientID, unconfirmed: [] }),
      apply(tr, value) {
        const own = tr.getMeta(collabKey) as CollabState | undefined;
        if (own) return own;
        if (!tr.docChanged || isRemote(tr)) return value;
        return { ...value, unconfirmed: [...value.unconfirmed, ...unconfirmedOf(tr)] };
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
  while (ours < clientIDs.length && clientIDs[ours] === current.clientID) ours++;
  let unconfirmed = current.unconfirmed.slice(ours);
  const theirs = steps.slice(ours);
  const tr = state.tr.setMeta(remote, true);
  if (!theirs.length) return tr.setMeta(collabKey, { ...current, version, unconfirmed });
  const count = unconfirmed.length;
  // Ours taken back, last first.
  for (let i = count - 1; i >= 0; i--) tr.step((unconfirmed[i] as Unconfirmed).inverted);
  for (const step of theirs) tr.step(step);
  const envelope = wordContext(state)?.envelope;
  const rebased: Step[] = [];
  let mapFrom = count;
  for (const { step } of unconfirmed) {
    let mapped = step.map(tr.mapping.slice(mapFrom));
    mapFrom--;
    // An envelope change made from what the others changed since: merged over it.
    if (mapped instanceof EnvelopeStep && envelope)
      mapped = mapped.rebase(afterEnvelopeSteps(envelope, tr.steps));
    if (mapped && !tr.maybeStep(mapped).failed) {
      tr.mapping.setMirror(mapFrom, tr.steps.length - 1);
      rebased.push(mapped);
    }
  }
  // Story edits learn the trees they apply to, so they can be inverted.
  const context = wordContext(state);
  if (context) storyStepsApply(context.stories, tr.steps);
  const start = tr.steps.length - rebased.length;
  unconfirmed = rebased.map((step, i) => ({
    step,
    inverted: step.invert(tr.docs[start + i] as Node),
  }));
  return tr.setMeta(collabKey, { ...current, version, unconfirmed });
}
