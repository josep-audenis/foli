import type { Node } from "../model/index.js";
import { type Mappable, Mapping, type MapResult, type StepMap } from "../transform/stepmap.js";
import { AddMarkStep, RemoveMarkStep, ReplaceStep, type Step } from "../transform/steps.js";
import { TransformError } from "../transform/transform.js";
import { Selection, type SelectionJSON } from "./selection.js";
import { type Command, type EditorState, Plugin, PluginKey, type Transaction } from "./state.js";

/** One undoable unit: inverted steps in the order they apply, and the selection to restore. */
interface HistoryEvent {
  readonly steps: readonly Step[];
  readonly selection: SelectionJSON;
}

/** @internal The history plugin's state; its shape will change (collaboration, Phase 12). */
interface HistoryState {
  /** Undo stack, oldest first. The last event applies to the current document. */
  readonly done: readonly HistoryEvent[];
  /** Redo stack, oldest first. */
  readonly undone: readonly HistoryEvent[];
  /** Time and changed ranges (in current-document positions) of the last recorded change. */
  readonly prevTime: number;
  readonly prevRanges: readonly number[] | null;
}

export interface HistoryOptions {
  /** Changes closer together than this (ms) and adjacent in the document merge into one undo step. */
  newGroupDelay?: number;
  /** Maximum number of undo events kept. */
  depth?: number;
}

const historyKey = new PluginKey<HistoryState>("history");
/** Meta set on undo/redo transactions: which operation produced them. */
const historyOp = "historyOp";

/** Set this meta on a transaction to stop it merging into the previous undo event. */
export const closeHistory = "closeHistory";

const EMPTY: HistoryState = { done: [], undone: [], prevTime: 0, prevRanges: null };

/**
 * Undo/redo history. Recorded changes become inverted steps (consecutive typing collapses into
 * one step). Unrecorded changes (`addToHistory: false`) are rebased into every stored event, so
 * undo still targets the right content after them. Changes appended by plugins join the event
 * of the transaction they react to.
 */
export function history({ newGroupDelay = 500, depth = 100 }: HistoryOptions = {}): Plugin {
  return new Plugin<HistoryState>({
    key: historyKey,
    state: {
      init: () => EMPTY,
      apply(tr, hist, oldState) {
        const own = tr.getMeta(historyKey) as HistoryState | undefined;
        if (own) return own;
        if (!tr.docChanged) return hist;

        const root = tr.getMeta("appendedTransaction") as Transaction | undefined;
        const rootOp = root?.getMeta(historyOp) as "undo" | "redo" | undefined;
        const inverted = tr.steps.map((step, i) => step.invert(tr.docs[i] as Node)).reverse();

        if (rootOp) {
          // A plugin reacted to undo/redo: undoing that undo/redo must also revert the reaction.
          const stack = rootOp === "undo" ? hist.undone : hist.done;
          const top = stack[stack.length - 1];
          const merged = top
            ? [
                ...stack.slice(0, -1),
                { steps: prepend(inverted, top.steps), selection: top.selection },
              ]
            : [...stack, { steps: inverted, selection: oldState.selection.toJSON() }];
          // The other stack still applies to the document before the reaction: move it past it.
          return rootOp === "undo"
            ? { ...hist, undone: merged, done: rebase(hist.done, tr.mapping, tr.doc) }
            : { ...hist, done: merged, undone: rebase(hist.undone, tr.mapping, tr.doc) };
        }

        if (!tr.addToHistory || (root && !root.addToHistory)) {
          return {
            done: rebase(hist.done, tr.mapping, tr.doc),
            undone: rebase(hist.undone, tr.mapping, tr.doc),
            prevTime: 0,
            prevRanges: null,
          };
        }

        const last = hist.done[hist.done.length - 1];
        const merge =
          last !== undefined &&
          (root !== undefined ||
            (!tr.getMeta(closeHistory) &&
              tr.time - hist.prevTime < newGroupDelay &&
              isAdjacent(hist.prevRanges, tr)));
        const done = merge
          ? [
              ...hist.done.slice(0, -1),
              { steps: prepend(inverted, last.steps), selection: last.selection },
            ]
          : [...hist.done, { steps: inverted, selection: oldState.selection.toJSON() }];
        return {
          done: done.slice(-depth),
          undone: [],
          prevTime: root ? hist.prevTime : tr.time,
          prevRanges: root ? mapRanges(hist.prevRanges, tr.mapping) : changedRanges(tr),
        };
      },
    },
  });
}

/** Puts `inverted` (applied first) before `steps`, merging adjacent replace steps (typing runs). */
function prepend(inverted: readonly Step[], steps: readonly Step[]): Step[] {
  const last = inverted[inverted.length - 1];
  const first = steps[0];
  const merged = last instanceof ReplaceStep && first ? last.merge(first) : null;
  return merged ? [...inverted.slice(0, -1), merged, ...steps.slice(1)] : [...inverted, ...steps];
}

/** Whether `tr`'s first change touches a range changed by the previous recorded transaction. */
function isAdjacent(prev: readonly number[] | null, tr: Transaction): boolean {
  const first = tr.mapping.maps[0];
  if (!prev || !first) return false;
  let adjacent = false;
  first.forEach((start, end) => {
    for (let i = 0; i < prev.length; i += 2) {
      if (start <= (prev[i + 1] as number) && end >= (prev[i] as number)) adjacent = true;
    }
  });
  return adjacent;
}

/** Ranges changed by `tr`, in positions of its final document. */
function changedRanges(tr: Transaction): number[] {
  const ranges: number[] = [];
  tr.mapping.maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      ranges.push(rest.map(newStart, -1), rest.map(newEnd, 1));
    });
  });
  return ranges;
}

function mapRanges(ranges: readonly number[] | null, mapping: Mappable): number[] | null {
  return ranges && ranges.map((pos, i) => mapping.map(pos, i % 2 ? 1 : -1));
}

/**
 * Maps positions from the space of an original inverted step into the rebased space:
 * invert(m_k) · … · invert(m_1) · base · m'_1 · … · m'_k, where m_i is an original step's map and
 * m'_i its rebased copy's (null if dropped). Each pair is mirrored: a position inside content the
 * inverse removes is recovered at its copy. Linear in the number of steps per lookup.
 */
class RebaseMapping implements Mappable {
  private readonly inverted: StepMap[] = [];
  private readonly rebased: (StepMap | null)[] = [];

  constructor(private readonly base: Mappable) {}

  push(original: Step, rebased: Step | null): void {
    this.inverted.push(original.getMap().invert());
    this.rebased.push(rebased ? rebased.getMap() : null);
  }

  map(pos: number, assoc = 1): number {
    return this.mapResult(pos, assoc).pos;
  }

  mapResult(pos: number, assoc = 1): MapResult {
    let deleted = false;
    let from = 0;
    let recovered = false;
    for (let i = this.inverted.length - 1; i >= 0; i--) {
      const result = (this.inverted[i] as StepMap).mapResult(pos, assoc);
      const mirror = this.rebased[i];
      if (result.recover !== null && mirror) {
        pos = mirror.recover(result.recover);
        from = i + 1;
        recovered = true;
        break;
      }
      deleted ||= result.deleted;
      pos = result.pos;
    }
    if (!recovered) {
      const result = this.base.mapResult(pos, assoc);
      deleted ||= result.deleted;
      pos = result.pos;
    }
    for (let i = from; i < this.rebased.length; i++) {
      const result = this.rebased[i]?.mapResult(pos, assoc);
      if (!result) continue;
      deleted ||= result.deleted;
      pos = result.pos;
    }
    return { pos, deleted, recover: null };
  }
}

/** Range ends stick to the content they bound (start leftwards, end rightwards); a caret sticks left. */
function mapSelection(sel: SelectionJSON, mapping: Mappable): SelectionJSON {
  const anchorAssoc = sel.anchor <= sel.head ? -1 : 1;
  const headAssoc = sel.anchor === sel.head ? -1 : -anchorAssoc;
  return {
    ...sel,
    anchor: mapping.map(sel.anchor, anchorAssoc),
    head: mapping.map(sel.head, headAssoc),
  };
}

/**
 * Moves stored events (the last applies to `doc` first) through an unrecorded change. Every
 * rebased step is applied to a running copy of the document; a step that no longer applies is
 * dropped and its map left out, so the remaining steps stay positioned for what undo will really do.
 */
function rebase(events: readonly HistoryEvent[], mapping: Mappable, doc: Node): HistoryEvent[] {
  const remap = new RebaseMapping(mapping);
  let current = doc;
  const out: HistoryEvent[] = [];
  for (let e = events.length - 1; e >= 0; e--) {
    const event = events[e] as HistoryEvent;
    const steps: Step[] = [];
    for (const step of event.steps) {
      const mapped = step.map(remap);
      const result = mapped?.apply(current);
      const applied = result?.doc ? mapped : null;
      if (applied && result?.doc) {
        current = result.doc;
        steps.push(applied);
      }
      remap.push(step, applied);
    }
    if (steps.length) out.unshift({ steps, selection: mapSelection(event.selection, remap) });
  }
  return out;
}

/**
 * Applies a stored step during undo/redo. Mark steps go through addMark/removeMark so only ranges
 * that actually change get steps; otherwise a mark already present (e.g. added outside history)
 * would make the recorded reverse remove it, and redo would not be exact.
 */
function applyStored(tr: Transaction, step: Step): boolean {
  if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
    if (step.from < 0 || step.to > tr.doc.content.size || step.from >= step.to) return false;
    try {
      if (step instanceof AddMarkStep) tr.addMark(step.from, step.to, step.mark);
      else tr.removeMark(step.from, step.to, step.mark);
      return true;
    } catch (error) {
      if (error instanceof TransformError) return false;
      throw error;
    }
  }
  return tr.maybeStep(step).failed === null;
}

function historyCommand(redo: boolean): Command {
  return (state, dispatch) => {
    const hist = historyKey.getState(state);
    const source = hist && (redo ? hist.undone : hist.done);
    const event = source?.[source.length - 1];
    if (!hist || !source || !event) return false;
    if (dispatch) {
      const tr = state.tr;
      // Rebasing keeps stored steps applicable; should one still fail, later steps are remapped
      // as if it never existed rather than applied at positions that assumed it.
      let remap: RebaseMapping | null = null;
      for (const step of event.steps) {
        const mapped = remap ? step.map(remap) : step;
        const applied = mapped !== null && applyStored(tr, mapped);
        if (!applied && !remap) remap = new RebaseMapping(new Mapping());
        remap?.push(step, applied ? mapped : null);
      }
      const selection = remap ? mapSelection(event.selection, remap) : event.selection;
      tr.setSelection(Selection.fromJSON(tr.doc, selection));
      const reverse: HistoryEvent = {
        steps: tr.steps.map((step, i) => step.invert(tr.docs[i] as Node)).reverse(),
        selection: state.selection.toJSON(),
      };
      const rest = source.slice(0, -1);
      // If nothing could be applied, the event is discarded rather than turned into an empty reverse.
      const pushed = reverse.steps.length ? [reverse] : [];
      tr.setMeta(historyKey, {
        done: redo ? [...hist.done, ...pushed] : rest,
        undone: redo ? rest : [...hist.undone, ...pushed],
        prevTime: 0,
        prevRanges: null,
      } satisfies HistoryState);
      tr.setMeta(historyOp, redo ? "redo" : "undo");
      dispatch(tr);
    }
    return true;
  };
}

export const undo: Command = historyCommand(false);
export const redo: Command = historyCommand(true);

export function undoDepth(state: EditorState): number {
  return historyKey.getState(state)?.done.length ?? 0;
}

export function redoDepth(state: EditorState): number {
  return historyKey.getState(state)?.undone.length ?? 0;
}
