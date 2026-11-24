/**
 * Headers and footers (23.7): which there are, and where each is used, as `read` names them.
 * Their blocks have handles of their own (`h1`, `f1`…) and the session's operations edit them
 * through the story's editor, as the body's through the body's.
 */
import type { EditorState, SectionJSON } from "@folijs/core";
import { wordContext } from "@folijs/core/internal";

/** @internal */
export type StoryKind = "header" | "footer";
type Slot = "default" | "first" | "even";
const SLOTS: readonly Slot[] = ["default", "first", "even"];
const WHICH: Record<Slot, string> = {
  default: "",
  first: "first page",
  even: "even pages",
};

/** @internal A header or footer, and the sections that use it. */
export interface StoryUse {
  id: string;
  kind: StoryKind;
  /** In words, for a read: "header of sections 1–2, first page". */
  label: string;
}

/** The document's sections in order: each paragraph that ends one, then the last. */
function sections(state: EditorState): SectionJSON[] {
  const out: SectionJSON[] = [];
  state.doc.forEach((node) => {
    const section = node.attrs.section as SectionJSON | null | undefined;
    if (node.type.name === "paragraph" && section) out.push(section);
  });
  const last = wordContext(state)?.envelope.section;
  if (last) out.push(last);
  return out;
}

const range = (numbers: number[]) => {
  const parts: string[] = [];
  for (let i = 0; i < numbers.length; i++) {
    let j = i;
    while (j + 1 < numbers.length && (numbers[j + 1] as number) === (numbers[j] as number) + 1) j++;
    parts.push(j > i ? `${numbers[i]}–${numbers[j]}` : String(numbers[i]));
    i = j;
  }
  return parts.join(", ");
};

/**
 * @internal
 * The headers and footers, in the order the sections first use them (a section without its own
 * goes on with the one before's, as in Word); those no section uses last.
 */
export function storyUses(state: EditorState): StoryUse[] {
  const stories = wordContext(state)?.stories;
  if (!stories) return [];
  const uses = new Map<string, { kind: StoryKind; slots: Map<Slot, number[]> }>();
  // As Word shows them: a first page's own only with the section's title page on, even pages'
  // only with the document's even-and-odd setting.
  const evenAndOdd = wordContext(state)?.envelope.settings?.evenAndOddHeaders === true;
  const kinds: StoryKind[] = ["header", "footer"];
  const current: Record<StoryKind, Partial<Record<Slot, string>>> = { header: {}, footer: {} };
  sections(state).forEach((section, i) => {
    for (const kind of kinds) {
      const own = section[kind === "header" ? "headers" : "footers"];
      if (own) current[kind] = { ...current[kind], ...own };
      for (const slot of SLOTS) {
        if (slot === "first" && section.titlePage !== true) continue;
        if (slot === "even" && !evenAndOdd) continue;
        const id = current[kind][slot];
        if (!id || stories.get(id)?.kind !== kind) continue;
        const use = uses.get(id) ?? { kind, slots: new Map() };
        use.slots.set(slot, [...(use.slots.get(slot) ?? []), i + 1]);
        uses.set(id, use);
      }
    }
  });
  const out: StoryUse[] = [];
  for (const [id, { kind, slots }] of uses) {
    const where = [...slots].map(([slot, numbers]) => {
      const which = WHICH[slot];
      const of = `${numbers.length > 1 ? "sections" : "section"} ${range(numbers)}`;
      return which ? `${of}, ${which}` : of;
    });
    out.push({ id, kind, label: `${kind} of ${where.join("; ")}` });
  }
  for (const [id, story] of stories)
    if ((story.kind === "header" || story.kind === "footer") && !uses.has(id))
      out.push({ id, kind: story.kind, label: `${story.kind} not shown (no section uses it)` });
  return out;
}
