/*
 * The fonts installed on the machine, for the Font box: the Local Font Access API
 * (`queryLocalFonts`, Chromium browsers). Asking needs the user's permission, and a first ask
 * a user gesture: the box asks when the user opens it. Elsewhere (Firefox, Safari, a refusal)
 * the list stays empty and the box offers its own fonts.
 */

type QueryLocalFonts = () => Promise<readonly { family: string }[]>;

let families: readonly string[] = [];
let asked = false;
const listeners = new Set<() => void>();

/** The installed font families found so far (none before an ask is granted). @internal */
export const localFontFamilies = (): readonly string[] => families;

/** Calls `listener` when the families change; returns the unsubscribe. @internal */
export function subscribeLocalFonts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Reads the installed fonts. Without `gesture` only when the permission is already granted
 * (no prompt); with it (in a user's click or key press) it may prompt, once a page.
 * @internal
 */
export async function loadLocalFonts(gesture: boolean): Promise<void> {
  const query = (globalThis as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts;
  if (!query || asked) return;
  if (!gesture) {
    const status = await globalThis.navigator?.permissions
      ?.query({ name: "local-fonts" as PermissionName })
      .catch(() => null);
    if (status?.state !== "granted" || asked) return;
  }
  asked = true;
  try {
    const fonts = await query.call(globalThis);
    families = [...new Set(fonts.map((font) => font.family))];
    for (const listener of listeners) listener();
  } catch {
    // Refused, or not allowed here (a frame without the permission): the box's own fonts.
  }
}

/** Forgets the fonts and the ask (tests). @internal */
export function resetLocalFonts(): void {
  families = [];
  asked = false;
}
