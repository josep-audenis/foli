/**
 * The collaboration client (22.7, ADR-0012). An authority orders every step; this plugin keeps
 * the steps this editor made that the authority has not confirmed yet, gives them to send
 * (`sendableSteps`), and applies what the authority broadcasts (`receiveTransaction`): its own
 * steps confirmed, everyone else's applied with its unconfirmed steps taken back first and
 * applied again over them (mapped, with mirrored maps, so positions inside them come back).
 * Headless: the app moves the messages.
 */
import type { Node } from "../model/index.js";
import type { Mappable } from "../transform/stepmap.js";
import { AddMarkStep, RemoveMarkStep, type Step } from "../transform/steps.js";
import type { CommentJSON } from "../v3/document.js";
import { collabKey, idSlot } from "./ids.js";
import type { SelectionJSON } from "./selection.js";
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
  /** The others' presence, their selections mapped through every change since. */
  readonly peers: ReadonlyMap<string | number, Presence>;
  /** Presence sent from a version this editor has not reached yet, shown once it does. */
  readonly early: ReadonlyMap<string | number, PresenceMessage>;
}

/** Another client as this editor shows it (22.9): who, in what colour, where. */
export interface Presence {
  readonly clientID: string | number;
  readonly name: string;
  /** `#rgb` or `#rrggbb`. */
  readonly color: string;
  /** In this editor's document; null: nowhere (not editing the body). */
  readonly selection: SelectionJSON | null;
}

/** What a client sends the others about itself: its selection at the authority's `version`. */
export interface PresenceMessage extends Presence {
  readonly version: number;
}

/** On a transaction: a peer's presence set, or removed (its id). */
const PRESENCE = "collabPresence";

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
      init: () => ({
        slot: idSlot(clientID),
        version,
        clientID,
        unconfirmed: [],
        peers: new Map(),
        early: new Map(),
      }),
      apply(tr, value, before) {
        let { peers, early } = value;
        if (tr.docChanged) peers = mapPeers(peers, tr.mapping, tr.doc.content.size);
        const change = tr.getMeta(PRESENCE) as
          | Presence
          | PresenceMessage
          | string
          | number
          | undefined;
        if (change !== undefined) {
          const next = new Map(peers);
          const later = new Map(early);
          if (typeof change !== "object") {
            next.delete(change);
            later.delete(change);
          } else if ("version" in change) later.set(change.clientID, change);
          else {
            next.set(change.clientID, change);
            later.delete(change.clientID);
          }
          peers = next;
          early = later;
        }
        const own = tr.getMeta(collabKey) as CollabState | undefined;
        if (own) {
          // Presence from the version now reached: shown, over this editor's unconfirmed steps.
          // A version reached or passed (a broadcast moves it by its steps); one passed is
          // from before what this editor now has: shown at its positions, as near as they go.
          const ready = [...early.values()].filter((m) => m.version <= own.version);
          if (ready.length) {
            const next = new Map(peers);
            const later = new Map(early);
            for (const m of ready) {
              next.set(m.clientID, placed(m, own.unconfirmed, tr.doc.content.size));
              later.delete(m.clientID);
            }
            peers = next;
            early = later;
          }
          return { ...own, peers, early };
        }
        if (!tr.docChanged || isRemote(tr))
          return peers === value.peers && early === value.early
            ? value
            : { ...value, peers, early };
        return {
          ...value,
          peers,
          early,
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

/** `peers` with their selections moved through `mapping` (clamped into a document of `size`). */
function mapPeers(
  peers: ReadonlyMap<string | number, Presence>,
  mapping: Mappable,
  size: number,
): ReadonlyMap<string | number, Presence> {
  if (!peers.size) return peers;
  const out = new Map<string | number, Presence>();
  for (const [id, peer] of peers) {
    const s = peer.selection;
    const at = (pos: number) => Math.max(0, Math.min(size, mapping.map(pos, -1)));
    out.set(
      id,
      s ? { ...peer, selection: { ...s, anchor: at(s.anchor), head: at(s.head) } } : peer,
    );
  }
  return out;
}

const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** How many others an editor shows at most. */
const MAX_PEERS = 100;

/**
 * A name as shown: without control or bidirectional-override characters (a name that reorders
 * what is around it), at most 100 characters, whole code points.
 */
const cleanName = (name: string): string =>
  [...name.replace(/[\p{Cc}\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, "")]
    .slice(0, 100)
    .join("")
    .trim();

/**
 * What to send the others about this editor: `name`, `color` and its selection, mapped back to
 * the authority's version (out of this editor's unconfirmed steps). Send it when the selection
 * changes and after receiving steps.
 */
export function presenceMessage(
  state: EditorState,
  who: { name: string; color: string },
): PresenceMessage {
  const { version, clientID, unconfirmed } = stateOf(state);
  const json = state.selection.toJSON();
  // Out of this editor's unconfirmed steps, last first: a position they inserted goes to its edge.
  let { anchor, head } = json;
  for (let i = unconfirmed.length - 1; i >= 0; i--) {
    // Through the step's own map inverted: its inverse may be several mark steps (no positions).
    const map = (unconfirmed[i] as Unconfirmed).step.getMap().invert();
    anchor = map.map(anchor, -1);
    head = map.map(head, -1);
  }
  return {
    clientID,
    name: who.name,
    color: who.color,
    selection: { type: json.type === "node" ? "node" : "text", anchor, head },
    version,
  };
}

/**
 * The transaction that shows another client's presence (`message`, as untrusted input): dispatch
 * it. Its selection is moved over this editor's unconfirmed steps; one sent at another version
 * than this editor's is left out (its next one comes). Nothing in the document or its undo.
 */
export function receivePresence(state: EditorState, message: unknown): Transaction {
  const tr = state.tr.setMeta("addToHistory", false);
  const { version, clientID, unconfirmed } = stateOf(state);
  if (typeof message !== "object" || message === null) return tr;
  const m = message as Partial<PresenceMessage>;
  const id = m.clientID;
  const validID =
    (typeof id === "string" && id.length > 0 && id.length <= 256) ||
    (typeof id === "number" && Number.isSafeInteger(id));
  if (!validID || id === clientID || !Number.isSafeInteger(m.version)) return tr;
  if (typeof m.name !== "string" || typeof m.color !== "string" || !COLOR.test(m.color)) return tr;
  const s = m.selection as Partial<SelectionJSON> | null | undefined;
  const valid = s && Number.isSafeInteger(s.anchor) && Number.isSafeInteger(s.head) ? s : null;
  const read: PresenceMessage = {
    clientID: id as string | number,
    name: cleanName(m.name),
    color: m.color,
    selection: valid && {
      type: "text",
      anchor: valid.anchor as number,
      head: valid.head as number,
    },
    version: m.version as number,
  };
  // From an older version: its next one comes. From a later one: kept until this editor is there.
  if (read.version < version || !read.name) return tr;
  // One per client, and not without end: a relay that sends ever new ids is not followed.
  const known = stateOf(state);
  const count = new Set([...known.peers.keys(), ...known.early.keys()]).size;
  if (count >= MAX_PEERS && !known.peers.has(read.clientID) && !known.early.has(read.clientID))
    return tr;
  return tr.setMeta(
    PRESENCE,
    read.version > version ? read : placed(read, unconfirmed, state.doc.content.size),
  );
}

/** `message`'s presence in a document with `unconfirmed` on top of its version. */
function placed(
  message: PresenceMessage,
  unconfirmed: readonly Unconfirmed[],
  size: number,
): Presence {
  const { version: _version, selection, ...rest } = message;
  if (!selection) return { ...rest, selection: null };
  let { anchor, head } = selection;
  for (const { step } of unconfirmed) {
    const map = step.getMap();
    anchor = map.map(anchor, -1);
    head = map.map(head, -1);
  }
  const clamp = (pos: number) => Math.max(0, Math.min(size, pos));
  return { ...rest, selection: { type: "text", anchor: clamp(anchor), head: clamp(head) } };
}

/** The transaction that stops showing client `clientID` (it left): dispatch it. */
export const removePresence = (state: EditorState, clientID: string | number): Transaction =>
  state.tr.setMeta("addToHistory", false).setMeta(PRESENCE, clientID);

/** The other clients this editor shows, with their selections in its document. */
export function presence(state: EditorState): readonly Presence[] {
  const value = collabKey.getState(state) as CollabState | undefined;
  return value?.peers ? [...value.peers.values()] : [];
}
