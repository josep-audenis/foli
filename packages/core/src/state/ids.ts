/**
 * Ids unique across clients (22.5, ADR-0012). New revision, comment, note, control and numbering
 * ids and the numbers of generated bookmark names are the next free number after the largest in
 * the document; with an id slot (the collab plugin's, from its client id) only numbers of the
 * client's own class are taken, `id ≡ slot (mod ID_SPACE)`, so two editors of one document never
 * give two changes one id. Without a slot nothing changes.
 */
import { type EditorState, Plugin, PluginKey } from "./state.js";
import { storyBody } from "./word.js";

/** How many id classes there are: the live clients of one document each take one. */
export const ID_SPACE = 256;

const key = new PluginKey<number>("idSlot");

/**
 * The class of `clientID`'s ids: an integer's remainder, a string's hash.
 * @internal
 */
export function idSlot(clientID: string | number): number {
  if (typeof clientID === "number" && Number.isSafeInteger(clientID))
    return ((clientID % ID_SPACE) + ID_SPACE) % ID_SPACE;
  // FNV-1a.
  let hash = 0x811c9dc5;
  for (const char of String(clientID)) {
    hash ^= char.codePointAt(0) as number;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % ID_SPACE;
}

/** Gives an editor's new ids `clientID`'s class (what `collab` does, without the rest). */
export const idSlotPlugin = (clientID: string | number): Plugin<number> =>
  new Plugin({ key, state: { init: () => idSlot(clientID), apply: (_tr, slot) => slot } });

/**
 * The next id after `after` an editor of `state` may take (a story's: its body's class).
 * @internal
 */
export function freshId(state: EditorState, after: number): number {
  const slot = key.getState(storyBody(state)?.state ?? state);
  const next = Math.floor(after) + 1;
  return slot === undefined ? next : next + ((slot - (next % ID_SPACE) + ID_SPACE) % ID_SPACE);
}

/**
 * `freshId` for `state`, for code that allocates without a state at hand.
 * @internal
 */
export const idsOf =
  (state: EditorState): ((after: number) => number) =>
  (after) =>
    freshId(state, after);
