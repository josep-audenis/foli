// @vitest-environment jsdom
import {
  type Command,
  createDocument,
  createEditor,
  type Editor,
  fieldCodesShown,
  insertText,
  Plugin,
} from "@folijs/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView, keyName } from "./index.js";

// The view's own keys (ADR-0008, docs/keyboard.md): the overridable ones run after the user's
// keymaps, so a plugin's binding of the same name wins; the reserved ones stay the view's.

declare module "@folijs/core" {
  interface FoliCommands {
    shout(text: string): boolean;
  }
}

let views: EditorView[] = [];
afterEach(() => {
  for (const view of views) {
    view.destroy();
    view.host.remove();
  }
  views = [];
});

function mount(plugins: Plugin[] = []): { host: HTMLElement; editor: Editor } {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = createEditor({
    document: createDocument({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "ab" }] }],
    }),
    plugins,
  });
  views.push(new EditorView(host, editor));
  host.focus();
  editor.select(2);
  return { host, editor };
}

/** A keydown for a key name (jsdom is not an Apple platform: Mod is Ctrl). */
function press(host: HTMLElement, name: string): KeyboardEvent {
  const parts = name.split("-");
  const key = parts.pop() as string;
  const event = new KeyboardEvent("keydown", {
    key: parts.includes("Shift") && key.length === 1 ? key.toUpperCase() : key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    ctrlKey: parts.includes("Mod"),
    altKey: parts.includes("Alt"),
    shiftKey: parts.includes("Shift"),
    cancelable: true,
    bubbles: true,
  });
  host.dispatchEvent(event);
  return event;
}

/** Every key the view handles itself that a keymap may take (docs/keyboard.md). */
const OVERRIDABLE = [
  "Mod-Home",
  "Mod-End",
  "Mod-Shift-Home",
  "Mod-Shift-End",
  "F9",
  "Alt-F9",
  "Alt-ArrowDown",
  "Mod-Alt-f",
  "Mod-Alt-d",
  "Alt-Shift-n",
  "Mod-f",
  "Mod-h",
  "Mod-g",
  "F3",
  "Shift-F3",
  "Mod-Shift-F5",
];

describe("the view's keys and user keymaps", () => {
  it.each(OVERRIDABLE)("a user keymap overrides %s", (name) => {
    const seen: string[] = [];
    const record: Command = () => {
      seen.push(name);
      return true;
    };
    const { host, editor } = mount([new Plugin({ keymap: { [name]: record } })]);
    const navigation = vi.fn(() => true);
    editor.navigation = navigation;
    const before = JSON.stringify(editor.getDocument());
    const event = press(host, name);
    expect(seen).toEqual([name]);
    expect(event.defaultPrevented).toBe(true);
    // The built-in did not run: no navigation request, no note, no field codes, caret kept.
    expect(navigation).not.toHaveBeenCalled();
    expect(JSON.stringify(editor.getDocument())).toBe(before);
    expect(fieldCodesShown(editor.state)).toBe(false);
    expect(editor.state.selection.head).toBe(2);
  });

  it("runs the built-in when no keymap takes the key", () => {
    const { host, editor } = mount([new Plugin({ keymap: { "Mod-f": () => false } })]);
    const navigation = vi.fn(() => true);
    editor.navigation = navigation;
    expect(press(host, "Mod-f").defaultPrevented).toBe(true);
    expect(press(host, "Shift-F3").defaultPrevented).toBe(true);
    expect(navigation.mock.calls).toEqual([["find"], ["previous"]]);
    press(host, "Alt-F9");
    expect(fieldCodesShown(editor.state)).toBe(true);
  });

  it("keeps Tab after Escape reserved: it leaves the editor even when a keymap binds Tab", () => {
    const tab = vi.fn(() => true);
    const { host } = mount([new Plugin({ keymap: { Tab: tab } })]);
    press(host, "Escape");
    expect(press(host, "Tab").defaultPrevented).toBe(false);
    expect(tab).not.toHaveBeenCalled();
    expect(press(host, "Tab").defaultPrevented).toBe(true);
    expect(tab).toHaveBeenCalledOnce();
  });
});

describe("plugin commands", () => {
  it("are typed through FoliCommands and run on the editor", () => {
    const shout =
      (text: string): Command =>
      (state, dispatch) =>
        insertText(text.toUpperCase())(state, dispatch);
    const { editor } = mount([new Plugin({ commands: { shout } })]);
    expect(editor.commands.shout("hi")).toBe(true);
    expect(editor.state.doc.textContent).toBe("aHIb");
  });
});

describe("keyName with Alt", () => {
  const key = (init: KeyboardEventInit) => keyName(new KeyboardEvent("keydown", init));

  it("names Option combos by the physical key (macOS types a character for them)", () => {
    expect(key({ key: "˜", code: "KeyN", altKey: true, shiftKey: true })).toBe("Alt-Shift-n");
    expect(key({ key: "Dead", code: "KeyE", altKey: true })).toBe("Alt-e");
    expect(key({ key: "n", code: "KeyN", altKey: true })).toBe("Alt-n");
    expect(key({ key: "F9", code: "F9", altKey: true })).toBe("Alt-F9");
  });
});
