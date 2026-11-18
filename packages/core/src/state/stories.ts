/**
 * Editing a story (ADR-0007): a header, footer or note has an `EditorState` of its own (selection,
 * stored marks, tracking) but no history. **The body goes first:** a story's transaction is
 * computed without being kept, the body receives it as a `StoryStep`, and the story takes the new
 * state only if the body then holds its tree. A `StoryStep` arriving from the body (undo, another
 * editor of the story) replaces the state's document.
 */
import { FoliDocumentError, type Node } from "../model/index.js";
import type { StoryJSON } from "../v3/document.js";
import { storyRules } from "../v3/document.js";
import { closeHistory, joinHistory, type StoryEdit, storyEdit } from "./history.js";
import { Selection, type SelectionJSON } from "./selection.js";
import { EditorState, Plugin, type Transaction } from "./state.js";
import {
  type TrackState,
  trackState,
  trackTransaction,
  untracked,
  withTrackState,
} from "./track.js";
import {
  CommentStep,
  EnvelopeStep,
  envelopeChange,
  type Story,
  type StoryBody,
  StoryStep,
  storyBodyKey,
  type WordContext,
  withContext,
  withEnvelope,
  wordContext,
} from "./word.js";

/** What a story's editor needs of the body's. */
export interface StoryHost extends StoryBody {
  dispatch(tr: Transaction): void;
  /** The plugins of a story's state (keymaps, tracking, the word context). */
  plugins(context: WordContext, track: TrackState | null): Plugin[];
}

export type StoryListener = (state: EditorState, transactions: readonly Transaction[]) => void;

/** A story's editing state, kept in step with the body. */
export class StoryEditing {
  state: EditorState;
  /** Set while the story's own transaction goes through the body. */
  private own = false;
  /** Whether the story still exists: a removed one takes no more changes. */
  alive = true;
  readonly listeners = new Set<StoryListener>();

  constructor(
    readonly id: string,
    private readonly host: StoryHost,
  ) {
    const doc = this.tree()?.doc as Node;
    this.state = this.create(doc);
  }

  private tree(): Story | undefined {
    return wordContext(this.host.state)?.stories.get(this.id);
  }

  private create(doc: Node): EditorState {
    const { host, id } = this;
    const context = wordContext(host.state) as WordContext;
    const kind = context.stories.get(id)?.kind as StoryJSON["kind"];
    return EditorState.create({
      doc,
      selection: Selection.atStart(doc),
      plugins: [
        new Plugin<StoryBody>({
          key: storyBodyKey,
          state: { init: () => host, apply: () => host },
        }),
        // What a story may not hold (a section break, a comment) is never put in it.
        new Plugin({
          filterTransaction(tr) {
            if (!tr.docChanged) return true;
            try {
              storyRules(tr.doc, kind, "story");
              return true;
            } catch (error) {
              if (error instanceof FoliDocumentError) return false;
              throw error;
            }
          },
        }),
        ...host.plugins(context, trackState(host.state)),
      ],
    });
  }

  private notify(transactions: readonly Transaction[]): void {
    for (const listener of this.listeners) listener(this.state, transactions);
  }

  /** `state` with the body's context and tracking; its plugins keep their state. */
  private current(state: EditorState): EditorState {
    const context = wordContext(this.host.state) as WordContext;
    const track = trackState(this.host.state);
    if (wordContext(state) === context && trackState(state) === track) return state;
    const tr = withContext(state.tr, context);
    if (track) withTrackState(tr, track);
    return state.apply(tr);
  }

  dispatch = (tr: Transaction): void => {
    if (!this.alive) return;
    const { host, id, state: before } = this;
    const tracked = trackTransaction(before, tr);
    if (!tracked) return;
    const result = before.applyTransaction(tracked);
    if (!result.transactions.length) return;
    const next = result.state;
    const bodyState = host.state;
    const bodyContext = wordContext(bodyState) as WordContext;
    const story = bodyContext.stories.get(id) as Story;
    const bodyTr = bodyState.tr;
    let after = story;
    if (next.doc !== before.doc) {
      after = { ...story, doc: next.doc };
      bodyTr.step(
        new StoryStep(id, story, after, before.selection.toJSON(), next.selection.toJSON()),
      );
    }
    let patched = false;
    for (const t of result.transactions) {
      // What belongs to the document, not to the story: the body takes it.
      for (const step of t.steps)
        if (step instanceof CommentStep || step instanceof EnvelopeStep) bodyTr.step(step);
      patched ||= envelopeChange(t) !== undefined;
    }
    // Only these: the story's copy of the rest of the envelope may be behind the body's.
    if (patched) {
      const { numbering, styles, resources, controls } = (wordContext(next) as WordContext)
        .envelope;
      const { resources: _resources, controls: _controls, ...rest } = bodyContext.envelope;
      withEnvelope(bodyTr, {
        ...rest,
        numbering,
        styles,
        ...(resources ? { resources } : {}),
        ...(controls ? { controls } : {}),
      });
    }
    const track = trackState(next);
    const trackChanged = !!track && track !== trackState(before);
    if (trackChanged) withTrackState(bodyTr, track);
    if (bodyTr.steps.length || patched || trackChanged) {
      bodyTr.setMeta(untracked, true);
      bodyTr.setMeta(storyEdit, { id, tr: tracked } satisfies StoryEdit);
      bodyTr.time = tracked.time;
      if (!tracked.addToHistory) bodyTr.setMeta("addToHistory", false);
      if (tracked.getMeta(closeHistory)) bodyTr.setMeta(closeHistory, true);
      if (tracked.getMeta(joinHistory)) bodyTr.setMeta(joinHistory, true);
      this.own = true;
      try {
        host.dispatch(bodyTr);
      } finally {
        this.own = false;
      }
      // Refused by the body: the story stays as it was.
      if (after !== story && wordContext(host.state)?.stories.get(id) !== after) return;
    }
    this.state = this.current(next);
    this.notify(result.transactions);
  };

  /** After a change of the body. */
  sync(transactions: readonly Transaction[]): void {
    if (this.own) return;
    const tree = this.tree();
    if (!tree) {
      this.retire();
      return;
    }
    const { state } = this;
    let selection: SelectionJSON | null = null;
    for (const tr of transactions)
      for (const step of tr.steps)
        if (step instanceof StoryStep && step.id === this.id) selection = step.selectionAfter;
    if (tree.doc !== state.doc) {
      const json = selection ?? state.selection.toJSON();
      this.state = this.current(state.withDocument(tree.doc, Selection.fromJSON(tree.doc, json)));
      this.notify([]);
      return;
    }
    const current = this.current(state);
    if (current === state) return;
    this.state = current;
    this.notify([]);
  }

  retire(): void {
    this.alive = false;
  }
}
