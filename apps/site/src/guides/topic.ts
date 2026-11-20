import { type Command, toggleMark } from "@folijs/core";
import type { ViewExtension } from "@folijs/view";

export const topic: ViewExtension = {
  name: "acme-topic",
  marks: {
    "acme:topic": {
      attrs: {
        topic: {
          validate: (v) =>
            typeof v === "string" && /^[a-z-]{1,32}$/.test(v) ? undefined : "must be a topic",
        },
      },
      // Text typed at the end of a marked run does not get the mark.
      inclusive: false,
    },
  },
  markViews: {
    "acme:topic": (mark) => ({ class: "acme-topic", title: `Topic: ${mark.attrs.topic}` }),
  },
};

/** Adds the topic to the selected text, or removes it. */
export const toggleTopic = (name: string): Command => toggleMark("acme:topic", { topic: name });
