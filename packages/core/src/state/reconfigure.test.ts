import { describe, expect, it } from "vitest";
import { createDocument, type FoliDocument, SCHEMA_VERSION } from "../v3/document.js";
import { collab, getVersion, sendableSteps } from "./collab.js";
import { createEditor } from "./editor.js";
import { Plugin, PluginKey } from "./state.js";

const DOCUMENT: FoliDocument = {
  ...createDocument(),
  schemaVersion: SCHEMA_VERSION,
  section: { headers: { default: "h1" } },
  content: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "ab" }] }],
  },
  stories: {
    h1: {
      kind: "header",
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Head" }] }],
      },
    },
  },
};

/** A plugin counting the transactions it saw, from what `init` saw. */
const counter = (key = new PluginKey<{ seen: number; size: number }>("counter")) => ({
  key,
  plugin: new Plugin<{ seen: number; size: number }>({
    key,
    state: {
      init: (state) => ({ seen: 0, size: state.doc.content.size }),
      apply: (_tr, value) => ({ ...value, seen: value.seen + 1 }),
    },
  }),
});

describe("editor.reconfigure (24.5)", () => {
  it("adds and removes collab: the document, the selection and undo stay", () => {
    const editor = createEditor({ document: DOCUMENT });
    editor.select(3);
    editor.commands.insertText("c");
    expect(() => getVersion(editor.state)).toThrow(RangeError);
    const doc = editor.state.doc;
    editor.reconfigure({ plugins: [collab({ clientID: 1 })] });
    expect(editor.state.doc).toBe(doc);
    expect(editor.state.selection.head).toBe(4);
    expect(getVersion(editor.state)).toBe(0);
    // What was typed before the session is the session's document, not steps to send.
    expect(sendableSteps(editor.state)).toBeNull();
    editor.commands.insertText("d");
    expect(sendableSteps(editor.state)?.steps.length).toBeGreaterThan(0);
    // Undo reaches back past the start of the session (typing close together is one step).
    let undone = 0;
    while (editor.commands.undo()) undone++;
    expect(undone).toBeGreaterThan(0);
    expect(editor.state.doc.textContent).toBe("ab");
    editor.reconfigure({ plugins: [] });
    expect(() => getVersion(editor.state)).toThrow(RangeError);
    while (editor.commands.redo());
    expect(editor.state.doc.textContent).toBe("abcd");
  });

  it("keeps a plugin given again, starts a new one on the state as it is", () => {
    const kept = counter(new PluginKey("kept"));
    const editor = createEditor({ document: DOCUMENT, plugins: [kept.plugin] });
    editor.select(3);
    editor.commands.insertText("xyz");
    const seen = kept.key.getState(editor.state)?.seen;
    expect(seen).toBeGreaterThan(0);
    const added = counter(new PluginKey("added"));
    editor.reconfigure({ plugins: [kept.plugin, added.plugin] });
    expect(kept.key.getState(editor.state)?.seen).toBe(seen);
    expect(added.key.getState(editor.state)).toEqual({
      seen: 0,
      size: editor.state.doc.content.size,
    });
    editor.reconfigure({ plugins: [added.plugin] });
    expect(kept.key.getState(editor.state)).toBeUndefined();
    expect(added.key.getState(editor.state)?.size).toBe(editor.state.doc.content.size);
  });

  it("tells the listeners, and an open story's editor follows", () => {
    const editor = createEditor({ document: DOCUMENT });
    const head = editor.story("h1");
    if (!head) throw new Error("no header");
    let told = 0;
    editor.subscribe(() => told++);
    let storyTold = 0;
    head.subscribe(() => storyTold++);
    const { key, plugin } = counter();
    editor.reconfigure({ plugins: [plugin] });
    expect(told).toBe(1);
    expect(storyTold).toBe(1);
    expect(key.getState(head.state)).toBeDefined();
    head.select(2);
    head.commands.insertText("!");
    expect(editor.getDocument().stories?.h1?.content).toMatchObject({
      content: [{ content: [{ text: "H!ead" }] }],
    });
    expect(head.commands.undo()).toBe(true);
  });

  it("gives the added plugins' commands, takes the removed ones'", () => {
    const shout = new Plugin({
      commands: {
        shout: () => (state, dispatch) => {
          dispatch?.(state.tr.insertText("!", state.selection.from));
          return true;
        },
      },
    });
    const editor = createEditor({ document: DOCUMENT });
    expect("shout" in editor.commands).toBe(false);
    editor.reconfigure({ plugins: [shout] });
    editor.select(1);
    expect((editor.commands as unknown as { shout(): boolean }).shout()).toBe(true);
    expect(editor.state.doc.textContent).toBe("!ab");
    editor.reconfigure({ plugins: [] });
    expect("shout" in editor.commands).toBe(false);
  });

  it("throws on a command name taken twice, changing nothing", () => {
    const twice = () => new Plugin({ commands: { same: () => () => true } });
    const editor = createEditor({ document: DOCUMENT });
    const before = editor.state;
    expect(() => editor.reconfigure({ plugins: [twice(), twice()] })).toThrow(RangeError);
    expect(editor.state).toBe(before);
    const builtIn = new Plugin({ commands: { insertText: () => () => true } });
    expect(() => editor.reconfigure({ plugins: [builtIn] })).toThrow(RangeError);
    expect(editor.state).toBe(before);
  });

  it("setDocument after it keeps the new plugins", () => {
    const { key, plugin } = counter();
    const editor = createEditor({ document: DOCUMENT });
    editor.reconfigure({ plugins: [plugin] });
    editor.setDocument(DOCUMENT);
    expect(key.getState(editor.state)?.seen).toBe(0);
  });
});
