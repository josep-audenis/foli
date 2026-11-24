/**
 * Paragraph formatting and lists (23.5): alignment, line spacing, space before and after,
 * indentation and list numbering of paragraphs, each through core's command for it, so every
 * change is a tracked formatting change as the editor makes it.
 */
import {
  type Alignment,
  changeIndent,
  listKindAt,
  type Node,
  setAlign,
  setLineSpacing,
  setParagraphSpacing,
  toggleList,
  wrapInList,
} from "@folijs/core";
import { type Changed, type Context, changed, paragraphAt, quote } from "./operations.js";
import { type Refusal, type Result, refuse } from "./result.js";

/** What to change of the paragraphs; what is left out stays as it is. */
export interface ParagraphFormat {
  /** left, center, right or justify. */
  align?: "left" | "center" | "right" | "justify";
  /** A multiple of single spacing (1, 1.15, 1.5, 2); null: the style's. */
  lineSpacing?: number | null;
  /** Space before, in points; null: the style's. */
  spaceBefore?: number | null;
  /** Space after, in points; null: the style's. */
  spaceAfter?: number | null;
  /** Half an inch in or out; in a list, a level deeper or higher. */
  indent?: "more" | "less";
  /** Number the paragraphs as a list (one list for paragraphs next to each other); null: none. */
  list?: "bullet" | "numbered" | null;
}

const ALIGN: Record<string, Alignment> = {
  left: "start",
  center: "center",
  right: "end",
  justify: "justify",
};
const KEYS = new Set(["align", "lineSpacing", "spaceBefore", "spaceAfter", "indent", "list"]);
const points = (v: unknown) => v === null || (typeof v === "number" && v >= 0 && v <= 1584);

/** Why `format` cannot be applied as given, or null. */
function wrong(format: unknown): string | null {
  if (!format || typeof format !== "object" || Array.isArray(format))
    return 'format is an object of what to change: { "align": "center", "spaceAfter": 6 }.';
  const f = format as Record<string, unknown>;
  const keys = Object.keys(f);
  if (!keys.length) return "format names nothing to change.";
  const unknown = keys.find((k) => !KEYS.has(k));
  if (unknown) return `format has no ${quote(unknown)}: it takes ${[...KEYS].join(", ")}.`;
  if (f.align !== undefined && !Object.hasOwn(ALIGN, String(f.align)))
    return "align is left, center, right or justify.";
  if (
    f.lineSpacing !== undefined &&
    f.lineSpacing !== null &&
    !(typeof f.lineSpacing === "number" && f.lineSpacing > 0 && f.lineSpacing <= 132)
  )
    return "lineSpacing is a multiple of single spacing (1, 1.15, 1.5, 2), or null.";
  if (f.spaceBefore !== undefined && !points(f.spaceBefore))
    return "spaceBefore is in points, 0 to 1584, or null.";
  if (f.spaceAfter !== undefined && !points(f.spaceAfter))
    return "spaceAfter is in points, 0 to 1584, or null.";
  if (f.indent !== undefined && f.indent !== "more" && f.indent !== "less")
    return 'indent is "more" or "less".';
  if (f.list !== undefined && f.list !== null && f.list !== "bullet" && f.list !== "numbered")
    return 'list is "bullet", "numbered", or null to take the numbering off.';
  return null;
}

/** Paragraphs next to each other, as runs: one list for each run. */
function runsOf(targets: { pos: number; node: Node }[]): { from: number; to: number }[][] {
  const runs: { from: number; to: number }[][] = [];
  let last: { pos: number; node: Node } | null = null;
  for (const t of [...targets].sort((a, b) => a.pos - b.pos)) {
    const range = { from: t.pos + 1, to: t.pos + t.node.nodeSize - 1 };
    if (last && last.pos + last.node.nodeSize === t.pos) runs[runs.length - 1]?.push(range);
    else runs.push([range]);
    last = t;
  }
  return runs;
}

/** @internal */
export function formatParagraphs(
  context: Context,
  handles: string | readonly string[],
  format: ParagraphFormat,
): Result<Changed> {
  const { editor } = context;
  const why = wrong(format);
  if (why) return refuse("invalid", why);
  const list = typeof handles === "string" ? [handles] : handles;
  if (!Array.isArray(list) || !list.length || list.some((h) => typeof h !== "string"))
    return refuse("invalid", 'handles is a paragraph\'s handle, or a list of them: ["b4", "b5"].');
  const targets: { pos: number; node: Node }[] = [];
  for (const handle of new Set(list)) {
    const target: Refusal | { pos: number; node: Node } = paragraphAt(
      context,
      handle,
      "paragraphs are formatted",
    );
    if ("ok" in target) return target;
    targets.push(target);
  }
  const before = editor.state.doc;
  // Each run of paragraphs from the last: nothing here moves positions but a list (none).
  for (const run of runsOf(targets).reverse()) {
    const first = run[0] as { from: number };
    const last = run[run.length - 1] as { to: number };
    const select = () => editor.select(first.from, last.to);
    if (format.align !== undefined) {
      select();
      editor.run(setAlign(ALIGN[format.align] as Alignment));
    }
    if (format.lineSpacing !== undefined) {
      select();
      editor.run(setLineSpacing(format.lineSpacing));
    }
    if (format.spaceBefore !== undefined || format.spaceAfter !== undefined) {
      select();
      editor.run(
        setParagraphSpacing({
          ...(format.spaceBefore === undefined ? {} : { before: format.spaceBefore }),
          ...(format.spaceAfter === undefined ? {} : { after: format.spaceAfter }),
        }),
      );
    }
    if (format.list !== undefined) {
      select();
      const now = listKindAt(editor.state);
      if (format.list === null) {
        if (now) editor.run(toggleList(now));
      } else {
        const kind = format.list === "bullet" ? "bulletList" : "orderedList";
        if (now !== kind) editor.run(wrapInList(kind));
      }
    }
    if (format.indent !== undefined) {
      select();
      editor.run(changeIndent(format.indent === "more" ? 1 : -1));
    }
  }
  const handlesNow = [...new Set(list)];
  if (editor.state.doc === before) {
    const read = changed(context, handlesNow);
    return {
      ok: true,
      blocks: read.blocks,
      text: `Nothing changed: the paragraphs already are so (or are in a locked content control).\n${read.text}`,
    };
  }
  return { ok: true, ...changed(context, handlesNow) };
}
