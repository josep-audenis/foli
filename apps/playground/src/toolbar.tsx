/**
 * A customized toolbar (`/toolbar.html`, dev server only, 12.6): `FoliEditor` with its toolbar
 * reordered and cut down to built-in items (`toolbarItems`), a plugin's command as a toolbar item
 * enabled by its dry run, a custom toggle, a custom menu, and a button of the app's own outside
 * the toolbar driven by `useCommand`. Driven by `e2e/toolbar-items.spec.ts`.
 */
import {
  type Command,
  createDocument,
  insertPageBreak,
  insertText,
  Plugin,
  PluginKey,
  toggleMark,
} from "@folijs/core";
import { FoliEditor, type ToolbarItem, toolbarItems, useCommand } from "@folijs/react";
import "@folijs/react/styles.css";
import "./playground.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

declare module "@folijs/core" {
  interface FoliCommands {
    /** Inserts `[label]` at a caret (the stamp plugin's command); not over a selection. */
    insertStamp(label: string): boolean;
  }
}

const insertStamp =
  (label: string): Command =>
  (state, dispatch) =>
    state.selection.empty && insertText(`[${label}]`)(state, dispatch);

const stamps = new Plugin({ key: new PluginKey("stamps"), commands: { insertStamp } });

const stamp: ToolbarItem = {
  key: "stamp",
  label: "Insert an approved stamp",
  text: "Approve",
  command: insertStamp("APPROVED"),
};
const strike: ToolbarItem = {
  key: "strikeToggle",
  label: "Cross out",
  icon: "✗",
  pressed: (_state, editor) => editor.isMarkActive("strike"),
  command: toggleMark("strike"),
};
const insertMenu: ToolbarItem = {
  key: "insertMenu",
  label: "Insert",
  actions: [
    { key: "draft", label: "Draft stamp", command: insertStamp("DRAFT") },
    { key: "break", label: "Page break", command: insertPageBreak },
  ],
};

function SignButton() {
  const { enabled, run } = useCommand("insertStamp", "SIGNED");
  return (
    <button type="button" className="sign" disabled={!enabled} onClick={run}>
      Sign
    </button>
  );
}

const initial = createDocument({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Review this text." }] },
    { type: "paragraph", content: [{ type: "text", text: "Second paragraph." }] },
  ],
});

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing");
createRoot(root).render(
  <StrictMode>
    <FoliEditor
      initialContent={initial}
      plugins={[stamps]}
      toolbar={[
        [toolbarItems.undo, toolbarItems.redo],
        [toolbarItems.bold, toolbarItems.italic, strike],
        [stamp, insertMenu],
      ]}
    >
      <SignButton />
    </FoliEditor>
  </StrictMode>,
);
