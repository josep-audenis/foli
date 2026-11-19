/**
 * The spike's extension: one custom inline node and one custom mark, as an app outside the
 * packages would declare them (ADR-0008). Only specs here and no runtime import of the packages:
 * the patched Word schema imports this module (vite.config.ts), so it must not import core back.
 */
import type { MarkSpec, NodeSpec } from "@folijs/core";

const id = (value: unknown) =>
  typeof value === "string" && /^[\w-]{1,64}$/.test(value) ? undefined : "must be an id";
const label = (value: unknown) =>
  typeof value === "string" && value.length > 0 && value.length <= 200
    ? undefined
    : "must be a non-empty string of at most 200 characters";

/** A person mentioned: one position, drawn as a chip with `@label`. */
export const MENTION = "acme:mention";
/** Text about a topic: a mark with one attribute. */
export const TOPIC = "acme:topic";

export const extension: {
  nodes: Record<string, NodeSpec>;
  marks: Record<string, MarkSpec>;
} = {
  nodes: {
    [MENTION]: {
      group: "inline",
      inline: true,
      attrs: { id: { validate: id }, label: { validate: label } },
    },
  },
  marks: {
    [TOPIC]: { attrs: { topic: { validate: id } }, inclusive: false },
  },
};

/** The text a custom node stands for (plain text, `.docx`). */
export const mentionText = (attrs: { label?: unknown }): string => `@${String(attrs.label)}`;
