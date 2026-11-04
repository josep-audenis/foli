import { Mapping } from "../transform/stepmap.js";
import type { Step } from "../transform/steps.js";
import { Selection, type SelectionJSON } from "./selection.js";
import { type Command, Plugin, PluginKey, type Transaction } from "./state.js";

/** One undoable unit: inverted steps in the order they apply, and the selection to restore. */
interface HistoryEvent {
  readonly steps: readonly Step[];
  readonly selection: SelectionJSON;
}

export interface HistoryState {
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

export const historyKey = new PluginKey<HistoryState>("history");

/** Set this meta on a transaction to stop it merging into the previous undo event. */
export const closeHistory = "closeHistory";

const EMPTY: HistoryState = { done: [], undone: [], prevTime: 0, prevRanges: null };

/**
 * Undo/redo history. Recorded changes become inverted steps; unrecorded changes
 * (`addToHistory: false`) are rebased into every stored event, so undo still targets the right
 * content after them. Rebasing uses mirrored mappings so positions inside re-inserted content stay exact.
 */
export function history({
  newGroupDelay = 500,
  depth = 100,
}: HistoryOptions = {}): Plugin<HistoryState> {
  return new Plugin<HistoryState>({
    key: historyKey,
    state: {
      init: () => EMPTY,
      apply(tr, hist, oldState) {
        const own = tr.getMeta(historyKey) as HistoryState | undefined;
        if (own) return own;
        if (!tr.docChanged) return hist;
        if (!tr.addToHistory) {
          return {
            done: rebase(hist.done, tr.mapping),
            undone: rebase(hist.undone, tr.mapping),
            prevTime: 0,
            prevRanges: null,
          };
        }
        const inverted = tr.steps
          .map((step, i) => step.invert(tr.docs[i] as typeof tr.doc))
          .reverse();
        const last = hist.done[hist.done.length - 1];
        const merge =
          last !== undefined &&
          !tr.getMeta(closeHistory) &&
          tr.time - hist.prevTime < newGroupDelay &&
          isAdjacent(hist.prevRanges, tr);
        const done = merge
          ? [
              ...hist.done.slice(0, -1),
              { steps: [...inverted, ...last.steps], selection: last.selection },
            ]
          : [...hist.done, { steps: inverted, selection: oldState.selection.toJSON() }];
        return {
          done: done.slice(-depth),
          undone: [],
          prevTime: tr.time,
          prevRanges: changedRanges(tr),
        };
      },
    },
  });
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

/**
 * Moves stored events (newest applies first) through an unrecorded change `mapping`.
 * For each inverted step S in space A (output space A'), the mapping into the rebased space is
 * carried forward as: invert(map(S)) · mapping · map(S'), with the first and last mirrored.
 */
function rebase(events: readonly HistoryEvent[], mapping: Mapping): HistoryEvent[] {
  // shortcut: rebuilds mappings per step (quadratic in history size); bounded by `depth`, revisit with collaboration (Phase 12).
  let current = mapping;
  const out: HistoryEvent[] = [];
  for (let e = events.length - 1; e >= 0; e--) {
    const event = events[e] as HistoryEvent;
    const steps: Step[] = [];
    for (const step of event.steps) {
      const mapped = step.map(current);
      const next = new Mapping();
      next.appendMap(step.getMap().invert());
      next.appendMapping(current);
      if (mapped) {
        next.appendMap(mapped.getMap(), 0);
        steps.push(mapped);
      }
      current = next;
    }
    // Range ends stick to the content they bound (start leftwards, end rightwards); a caret sticks left.
    const sel = event.selection;
    const anchorAssoc = sel.anchor <= sel.head ? -1 : 1;
    const headAssoc = sel.anchor === sel.head ? -1 : -anchorAssoc;
    const moved: SelectionJSON = {
      ...sel,
      anchor: current.map(sel.anchor, anchorAssoc),
      head: current.map(sel.head, headAssoc),
    };
    if (steps.length) out.unshift({ steps, selection: moved });
  }
  return out;
}

function historyCommand(redo: boolean): Command {
  return (state, dispatch) => {
    const hist = historyKey.getState(state);
    const source = hist && (redo ? hist.undone : hist.done);
    const event = source?.[source.length - 1];
    if (!hist || !source || !event) return false;
    if (dispatch) {
      const tr = state.tr;
      // Rebased steps can conflict with later content; skip those rather than fail the whole undo.
      for (const step of event.steps) tr.maybeStep(step);
      tr.setSelection(Selection.fromJSON(tr.doc, event.selection));
      const reverse: HistoryEvent = {
        steps: tr.steps.map((step, i) => step.invert(tr.docs[i] as typeof tr.doc)).reverse(),
        selection: state.selection.toJSON(),
      };
      const rest = source.slice(0, -1);
      tr.setMeta(historyKey, {
        done: redo ? [...hist.done, reverse] : rest,
        undone: redo ? rest : [...hist.undone, reverse],
        prevTime: 0,
        prevRanges: null,
      } satisfies HistoryState);
      dispatch(tr);
    }
    return true;
  };
}

export const undo: Command = historyCommand(false);
export const redo: Command = historyCommand(true);

export function undoDepth(state: Parameters<Command>[0]): number {
  return historyKey.getState(state)?.done.length ?? 0;
}
