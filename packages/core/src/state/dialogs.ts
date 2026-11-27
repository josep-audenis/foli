/**
 * Word's formatting dialogs (Phase 30): a command asks the UI to open one, as `openLinkEditor`
 * asks for the link dialog, and `chainCommands` applies what a dialog set in one undo step.
 */

import type { Command, Transaction } from "./state.js";
import { paragraphFormatAt } from "./wordformat.js";

/** The formatting dialogs a UI opens on request (the React toolbar's built-in ones). */
export type DialogName = "paragraph";

const DIALOGS: readonly DialogName[] = ["paragraph"];

/** Transaction metadata set by `openDialog`: the dialog's name. */
export const dialogRequest = "dialogRequest";

/**
 * Asks the UI to open Word's Paragraph dialog for the selection, with a
 * transaction that changes nothing and carries `dialogRequest`. Applies in a Word document where the selection has a paragraph; without such
 * a UI nothing opens.
 */
export function openDialog(name: DialogName): Command {
  return (state, dispatch) => {
    if (!DIALOGS.includes(name) || !paragraphFormatAt(state)) return false;
    dispatch?.(state.tr.setMeta(dialogRequest, name));
    return true;
  };
}

/** The dialog `tr` asks for (`openDialog`), or null. */
export function requestedDialog(tr: Transaction): DialogName | null {
  const name = tr.getMeta(dialogRequest);
  return DIALOGS.includes(name as DialogName) ? (name as DialogName) : null;
}

/**
 * Runs `commands` one after another as one transaction (one undo step), each on the state the
 * ones before it left; applies when any of them does. A dialog's OK runs what it set this way.
 */
export function chainCommands(commands: readonly Command[]): Command {
  return (state, dispatch) => {
    let current = state;
    let tr: Transaction | null = null;
    for (const command of commands) {
      command(current, (next) => {
        if (!tr) tr = next;
        else {
          for (const step of next.steps) tr.step(step);
          if (next.storedMarks !== current.storedMarks) tr.setStoredMarks(next.storedMarks);
        }
        current = current.apply(next);
      });
    }
    if (!tr) return false;
    dispatch?.(tr);
    return true;
  };
}
