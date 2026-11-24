/**
 * Text formatting (23.4): bold, italic, underline, strike, font, size, color, highlight and links
 * on a paragraph or on text in it, each through core's command for it, so every change is
 * tracked as the editor tracks it (a formatting change; a link as the text deleted and inserted
 * again, 23.2).
 */
import {
  HIGHLIGHT_HEX,
  isMarkActive,
  isSafeHref,
  normalizeHref,
  removeLink,
  setFontFamily,
  setFontSize,
  setHighlight,
  setLink,
  setTextColor,
  toggleMark,
} from "@folijs/core";
import { type Changed, type Context, changed, paragraphAt, placesIn, quote } from "./operations.js";
import { type Result, refuse } from "./result.js";

/** What to change of the text; what is left out stays as it is. */
export interface TextFormat {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** A font's name ("Arial"); null: the style's. */
  font?: string | null;
  /** In points (11, 10.5); null: the style's. */
  size?: number | null;
  /** RRGGBB ("1F3864"); null: the style's. */
  color?: string | null;
  /** One of Word's highlight colors by name ("yellow"); null: none. */
  highlight?: string | null;
  /** A link's address; null takes the link off. */
  link?: string | null;
}

export interface FormatOptions {
  /** Text of the paragraph, as read shows it: only there. Default: the whole paragraph. */
  on?: string;
  /** With `on`: every place it is in the paragraph. */
  all?: boolean;
}

const TOGGLES = ["bold", "italic", "underline", "strike"] as const;
const KEYS = new Set<string>([...TOGGLES, "font", "size", "color", "highlight", "link"]);
const HIGHLIGHTS = Object.keys(HIGHLIGHT_HEX);

/** Why `format` cannot be applied as given, or null. */
function wrong(format: unknown): string | null {
  if (!format || typeof format !== "object" || Array.isArray(format))
    return 'format is an object of what to change: { "bold": true, "color": "1F3864" }.';
  const f = format as Record<string, unknown>;
  const keys = Object.keys(f);
  if (!keys.length) return "format names nothing to change.";
  const unknown = keys.find((k) => !KEYS.has(k));
  if (unknown) return `format has no ${quote(unknown)}: it takes ${[...KEYS].join(", ")}.`;
  for (const k of TOGGLES)
    if (f[k] !== undefined && typeof f[k] !== "boolean") return `${k} is true or false.`;
  if (f.font !== undefined && f.font !== null && (typeof f.font !== "string" || !f.font.trim()))
    return "font is a font's name, or null.";
  if (
    f.size !== undefined &&
    f.size !== null &&
    !(typeof f.size === "number" && f.size >= 1 && f.size <= 1638)
  )
    return "size is in points, 1 to 1638, or null.";
  if (
    f.color !== undefined &&
    f.color !== null &&
    !(typeof f.color === "string" && /^#?[0-9A-Fa-f]{6}$/.test(f.color.trim()))
  )
    return 'color is RRGGBB ("1F3864"), or null.';
  if (
    f.highlight !== undefined &&
    f.highlight !== null &&
    !(typeof f.highlight === "string" && HIGHLIGHTS.includes(f.highlight.trim().toLowerCase()))
  )
    return `highlight is one of Word's: ${HIGHLIGHTS.join(", ")}; or null.`;
  if (f.link !== undefined && f.link !== null) {
    if (typeof f.link !== "string" || !isSafeHref(normalizeHref(f.link)))
      return "link is an address (https://…, mailto:…), or null to take a link off.";
  }
  return null;
}

/** @internal */
export function formatText(
  context: Context,
  handle: string,
  format: TextFormat,
  options: FormatOptions = {},
): Result<Changed> {
  const { editor } = context;
  const why = wrong(format);
  if (why) return refuse("invalid", why);
  const target = paragraphAt(context, handle, "text is formatted in paragraphs");
  if ("ok" in target) return target;
  const places = placesIn(context, handle, target, options.on, options.all === true);
  if (!Array.isArray(places)) return places;
  const before = editor.state.doc;
  // From the last place: a link while tracking is the text deleted and inserted again, which
  // moves what comes after it.
  for (const { from, to } of [...places].reverse()) {
    if (from === to) continue;
    const select = () => editor.select(from, to);
    for (const name of TOGGLES) {
      const value = format[name];
      if (value === undefined) continue;
      select();
      if (isMarkActive(editor.state, name) !== value) editor.run(toggleMark(name));
    }
    if (format.font !== undefined) {
      select();
      editor.run(setFontFamily(format.font));
    }
    if (format.size !== undefined) {
      select();
      editor.run(setFontSize(format.size));
    }
    if (format.color !== undefined) {
      select();
      editor.run(
        setTextColor(format.color === null ? null : `#${format.color.trim().replace(/^#/, "")}`),
      );
    }
    if (format.highlight !== undefined) {
      select();
      const name = format.highlight?.trim().toLowerCase();
      editor.run(setHighlight(name ? (HIGHLIGHT_HEX[name] as string) : null));
    }
    if (format.link !== undefined) {
      select();
      editor.run(format.link === null ? removeLink : setLink(format.link));
    }
  }
  if (editor.state.doc === before) {
    const read = changed(context, [handle]);
    return {
      ok: true,
      blocks: read.blocks,
      text: `Nothing changed: the text already has that formatting (or is in a locked content control).\n${read.text}`,
    };
  }
  return { ok: true, ...changed(context, [handle]) };
}
