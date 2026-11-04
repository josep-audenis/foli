import type { AnyExtension } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";

/**
 * The extension set that defines Foli's document schema.
 * Every consumer (editor, validation, serialization) must use the same set,
 * otherwise documents may not round-trip.
 */
export function createExtensions(): AnyExtension[] {
  return [StarterKit];
}
