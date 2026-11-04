import { Schema } from "./model/index.js";

/**
 * Schema v1: the node and mark types a Foli document may contain, defined through the same
 * spec API third-party extensions use. The JSON types below describe the persisted shape of v1
 * content ({type, attrs, content, text, marks}); that shape is permanent.
 */

export const MARK_TYPES = ["bold", "italic", "underline", "strike"] as const;
export type MarkName = (typeof MARK_TYPES)[number];

export const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;
export type HeadingLevel = (typeof HEADING_LEVELS)[number];

export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
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
      },
    },
    text: { group: "inline" },
    hardBreak: { group: "inline", inline: true },
  },
  marks: Object.fromEntries(MARK_TYPES.map((name) => [name, {}])),
});

export interface MarkNameJSON {
  type: MarkName;
}

export interface TextJSON {
  type: "text";
  text: string;
  marks?: MarkNameJSON[];
}

export interface HardBreakJSON {
  type: "hardBreak";
  marks?: MarkNameJSON[];
}

export type InlineJSON = TextJSON | HardBreakJSON;

export interface ParagraphJSON {
  type: "paragraph";
  content?: InlineJSON[];
}

export interface HeadingJSON {
  type: "heading";
  attrs: { level: HeadingLevel };
  content?: InlineJSON[];
}

export type BlockJSON = ParagraphJSON | HeadingJSON;

export interface DocJSON {
  type: "doc";
  content: BlockJSON[];
}
