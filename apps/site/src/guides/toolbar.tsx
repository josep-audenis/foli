import {
  defaultToolbarItems,
  FoliEditor,
  type ToolbarAction,
  type ToolbarButton,
  type ToolbarMenu,
  toolbarItems,
  useCommand,
} from "@folijs/react";
import { insertCard } from "./card.js";
import { acme } from "./commands.js";
import { keys } from "./keymap.js";
import { insertMention } from "./mention.js";
import { toggleTopic } from "./topic.js";

/** A button: enabled while its command's dry run says it would apply. */
const mentionButton: ToolbarButton = {
  key: "acme-mention",
  label: "Mention Ada Lovelace",
  text: "@Ada",
  command: insertMention("u-42", "Ada Lovelace"),
};

/** A menu button: its entries are dry-run when it opens. */
const topicMenu: ToolbarMenu = {
  key: "acme-topic",
  label: "Topic",
  actions: ["finance", "legal"].map(
    (name): ToolbarAction => ({ key: name, label: `Topic: ${name}`, command: toggleTopic(name) }),
  ),
};

/** A built-in menu with one more entry: Controls takes a list. */
const controls = toolbarItems.controls.actions as readonly ToolbarAction[];
const controlsWithCard: ToolbarMenu = {
  ...toolbarItems.controls,
  actions: [
    ...controls,
    { key: "acme-card", label: "Card", command: insertCard("Checklist", ["Owner", "Due date"]) },
  ],
};

/** The default toolbar, Controls swapped for the menu above, and a group of the app's own. */
const toolbar = [
  ...defaultToolbarItems.map((group) =>
    group.map((item) => (item === toolbarItems.controls ? controlsWithCard : item)),
  ),
  [mentionButton, topicMenu],
];

/** A button outside the toolbar, through a named command (typed by `FoliCommands`). */
function MentionGrace() {
  const { enabled, run } = useCommand("insertMention", "u-7", "Grace Hopper");
  return (
    <button type="button" disabled={!enabled} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      Mention Grace
    </button>
  );
}

export function AcmeEditor() {
  return (
    <FoliEditor extensions={acme} plugins={[keys]} toolbar={toolbar} label="Document">
      <MentionGrace />
    </FoliEditor>
  );
}
