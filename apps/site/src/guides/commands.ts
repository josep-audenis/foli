import { createEditor, Plugin } from "@folijs/core";
import type { ViewExtension } from "@folijs/view";
import { card, insertCard } from "./card.js";
import { insertMention, mention } from "./mention.js";
import { review, setLocked } from "./plugin.js";
import { toggleTopic, topic } from "./topic.js";

declare module "@folijs/core" {
  interface FoliCommands {
    insertMention(id: string, name: string): boolean;
    toggleTopic(name: string): boolean;
    insertCard(title: string, list: string[]): boolean;
    setLocked(locked: boolean): boolean;
  }
}

const commands: ViewExtension = {
  name: "acme-commands",
  plugins: [new Plugin({ commands: { insertMention, toggleTopic, insertCard, setLocked } })],
};

/** Everything above, for `createEditor`, `parseDocument`, `exportDocx` and `FoliEditor`. */
export const acme: readonly ViewExtension[] = [mention, topic, card, review, commands];

export function demo() {
  const editor = createEditor({ extensions: acme });
  editor.commands.insertText("Ask ");
  editor.commands.insertMention("u-7", "Grace Hopper"); // true: it applied
  editor.can(insertMention("u-7", "Grace Hopper")); // a dry run, as a toolbar asks
  editor.run(toggleTopic("finance")); // the same as editor.commands.toggleTopic("finance")
  return editor;
}
