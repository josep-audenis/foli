import { TransformError } from "../transform/transform.js";
import type { EditorState, Transaction } from "./state.js";

/** @internal Runs `build`; a TransformError, or a transaction that changes nothing, does not apply. */
export function attempt(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  build: (tr: Transaction) => void,
): boolean {
  const tr = state.tr;
  try {
    build(tr);
  } catch (error) {
    if (error instanceof TransformError) return false;
    throw error;
  }
  if (!tr.docChanged && tr.selection.eq(state.selection) && tr.storedMarks === state.storedMarks) {
    return false;
  }
  dispatch?.(tr);
  return true;
}
