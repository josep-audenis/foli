import { Schema } from "./model/index.js";

/**
 * Schema v2: the node and mark types a Foli document may contain, defined through the same spec
 * API third-party extensions use. The JSON types below describe the persisted shape of v2
 * content ({type, attrs, content, text, marks}); that shape is permanent. v1 content (0.1.0) is
 * valid v2 content: v2 only adds types and attributes with defaults.
 */

/** Marks without attributes. */
export const SIMPLE_MARK_TYPES = ["bold", "italic", "underline", "strike"] as const;
export type SimpleMarkName = (typeof SIMPLE_MARK_TYPES)[number];

/** Every mark type, in canonical order (the order of mark sets and of nesting when rendered). */
export const MARK_TYPES = ["link", ...SIMPLE_MARK_TYPES, "textColor", "highlight"] as const;
export type MarkName = (typeof MARK_TYPES)[number];

export const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;
export type HeadingLevel = (typeof HEADING_LEVELS)[number];

/** `start` and `end` follow the text direction (left and right in left-to-right text). */
export const ALIGNMENTS = ["start", "center", "end", "justify"] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

/** URL schemes a link may use; anything else (javascript:, data:, file:…) is rejected. */
export const SAFE_LINK_PROTOCOLS = ["http:", "https:", "mailto:", "tel:"] as const;

/**
 * Whether `href` may be stored in a link: an absolute URL with a safe protocol, or a relative
 * URL (path, `?query`, `#fragment`, `//host`). Rejects control characters and spaces anywhere
 * (browsers strip tabs and newlines inside schemes, so `java\tscript:` would run) and
 * backslashes (some browsers read `\\` as `//`).
 */
export function isSafeHref(href: unknown): href is string {
  if (typeof href !== "string" || !href || href.length > 8192) return false;
  // Control characters, spaces and backslashes are never part of a URL we keep.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
  if (/[\u0000- \u007f-\u009f\\]/.test(href)) return false;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(href);
  if (!scheme) return true; // relative
  return (SAFE_LINK_PROTOCOLS as readonly string[]).includes(`${scheme[1]?.toLowerCase()}:`);
}

/** Whether `color` is a canonical color value: `#rrggbb`, lowercase. */
export function isColor(color: unknown): color is string {
  return typeof color === "string" && /^#[0-9a-f]{6}$/.test(color);
}

const align = {
  default: "start",
  validate: (value: unknown) =>
    (ALIGNMENTS as readonly unknown[]).includes(value)
      ? undefined
      : `align must be one of ${ALIGNMENTS.join(", ")}`,
};

const color = {
  validate: (value: unknown) =>
    isColor(value) ? undefined : "color must be a lowercase #rrggbb value",
};

export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*", attrs: { align } },
    heading: {
      group: "block",
      content: "inline*",
      attrs: {
        level: {
          validate: (value) =>
            HEADING_LEVELS.includes(value as HeadingLevel)
              ? undefined
              : "heading level must be an integer from 1 to 6",
        },
        align,
      },
    },
    bulletList: { group: "block", content: "listItem+" },
    orderedList: {
      group: "block",
      content: "listItem+",
      attrs: {
        start: {
          default: 1,
          validate: (value) =>
            Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 99_999
              ? undefined
              : "start must be an integer from 0 to 99999",
        },
      },
    },
    // A list item starts with a paragraph; nested lists and other blocks may follow.
    listItem: { content: "paragraph block*" },
    horizontalRule: { group: "block" },
    text: { group: "inline" },
    hardBreak: { group: "inline", inline: true, selectable: false },
    // An explicit page break: inline like a hard break (as in DOCX, `<w:br w:type="page"/>`);
    // the line it ends is the last on its page.
    pageBreak: { group: "inline", inline: true, selectable: false },
  },
  marks: {
    // First, so a link wraps the formatting inside it when rendered.
    link: {
      attrs: {
        href: {
          validate: (value) =>
            isSafeHref(value)
              ? undefined
              : "href must be a relative URL or use http, https, mailto or tel",
        },
      },
      inclusive: false,
    },
    bold: {},
    italic: {},
    underline: {},
    strike: {},
    textColor: { attrs: { color } },
    highlight: { attrs: { color } },
  },
});

export interface SimpleMarkJSON {
  type: SimpleMarkName;
}

export interface LinkMarkJSON {
  type: "link";
  attrs: { href: string };
}

export interface ColorMarkJSON {
  type: "textColor" | "highlight";
  attrs: { color: string };
}

export type MarkNameJSON = SimpleMarkJSON | LinkMarkJSON | ColorMarkJSON;

export interface TextJSON {
  type: "text";
  text: string;
  marks?: MarkNameJSON[];
}

export interface HardBreakJSON {
  type: "hardBreak";
  marks?: MarkNameJSON[];
}

export interface PageBreakJSON {
  type: "pageBreak";
  marks?: MarkNameJSON[];
}

export type InlineJSON = TextJSON | HardBreakJSON | PageBreakJSON;

/** Attributes equal to their default (`align: "start"`, `start: 1`) are omitted. */
export interface ParagraphJSON {
  type: "paragraph";
  attrs?: { align?: Alignment };
  content?: InlineJSON[];
}

export interface HeadingJSON {
  type: "heading";
  attrs: { level: HeadingLevel; align?: Alignment };
  content?: InlineJSON[];
}

export interface ListItemJSON {
  type: "listItem";
  content: [ParagraphJSON, ...BlockJSON[]];
}

export interface BulletListJSON {
  type: "bulletList";
  content: ListItemJSON[];
}

export interface OrderedListJSON {
  type: "orderedList";
  attrs?: { start?: number };
  content: ListItemJSON[];
}

export interface HorizontalRuleJSON {
  type: "horizontalRule";
}

export type BlockJSON =
  | ParagraphJSON
  | HeadingJSON
  | BulletListJSON
  | OrderedListJSON
  | HorizontalRuleJSON;

export interface DocJSON {
  type: "doc";
  content: BlockJSON[];
}
