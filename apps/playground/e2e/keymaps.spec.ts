/**
 * User keymaps over the view's own keys (12.5, ADR-0008, `docs/keyboard.md`), on the editing page
 * with `?keys=override`: a plugin binds every key the view handles itself that is overridable, and
 * each press reaches the plugin instead of the built-in, where the built-in would have acted (a
 * header and footer, a drop-down control, a footnote, the find panel).
 */
import { expect, type Page, test } from "@playwright/test";

type Json = Record<string, unknown>;
const MOD = "ControlOrMeta";
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const inStory = (page: Page) => page.locator(".foli-story-mount [contenteditable=true]");

const text = (value: string): Json => ({ type: "text", text: value });
const paragraph = (...content: Json[]): Json => ({ type: "paragraph", content });
const story = (kind: string, value: string): Json => ({
  kind,
  content: { type: "doc", content: [paragraph(text(value))] },
});
const DOCUMENT: Json = {
  schemaVersion: 5,
  section: {
    pageSize: { width: 8391, height: 11906 },
    margins: { top: 1440, right: 1000, bottom: 1440, left: 1000, header: 500, footer: 400 },
    headers: { default: "h" },
    footers: { default: "f" },
  },
  defaults: { paragraph: { spacing: { after: 0 } } },
  styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
  numbering: { abstracts: [], instances: [] },
  comments: [],
  controls: {
    role: {
      kind: "dropDown",
      alias: "Role",
      items: [
        { value: "e", display: "Engineer" },
        { value: "m", display: "Manager" },
      ],
    },
  },
  content: {
    type: "doc",
    content: [
      paragraph(text("First line")),
      paragraph(text("Role: "), { type: "controlStart", attrs: { id: "role" } }, text("Engineer"), {
        type: "controlEnd",
        attrs: { id: "role" },
      }),
      paragraph(text("Note"), { type: "noteReference", attrs: { story: "footnote:1" } }, text(".")),
      paragraph(text("Last line")),
    ],
  },
  stories: {
    h: story("header", "Head"),
    f: story("footer", "Foot"),
    "footnote:1": {
      kind: "footnote",
      content: { type: "doc", content: [paragraph({ type: "noteMark" }, text(" The note"))] },
    },
  },
};

async function load(page: Page) {
  await page.goto("/edit.html?toolbar&keys=override");
  await page.waitForFunction(() => "foliEdit" in window);
  await page.evaluate((doc) => window.foliEdit.load(doc as never), DOCUMENT);
}

/** Places the caret after the first `before` in the body, the focus in the document. */
const caretAfter = (page: Page, before: string) =>
  page.evaluate((wanted) => {
    const { editor, view } = window.foliEdit;
    let pos = -1;
    editor.state.doc.descendants((node, p) => {
      const at = node.isText ? (node.text as string).indexOf(wanted) : -1;
      if (pos < 0 && at >= 0) pos = p + at + wanted.length;
      return pos < 0;
    });
    editor.select(pos);
    view.focus();
    return pos;
  }, before);

const state = (page: Page) =>
  page.evaluate(() => {
    const { editor } = window.foliEdit;
    return {
      doc: JSON.stringify(editor.getDocument()),
      head: editor.state.selection.head,
      anchor: editor.state.selection.anchor,
    };
  });

test("a user keymap takes every overridable key of the view", async ({ page }) => {
  await load(page);
  const original = await state(page);
  const expectUntouched = async (key: string) => {
    expect(await state(page), key).toEqual(original);
    await expect(page.getByRole("dialog", { name: "Find and replace" })).toHaveCount(0);
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(inStory(page)).toHaveCount(0);
    await expect(editor(page)).toBeFocused();
  };
  const keys: [string, string, string][] = [
    // [caret after, Playwright key, key name]
    ["First", `${MOD}+Home`, "Mod-Home"],
    ["First", `${MOD}+End`, "Mod-End"],
    ["First", `${MOD}+Shift+Home`, "Mod-Shift-Home"],
    ["First", `${MOD}+Shift+End`, "Mod-Shift-End"],
    ["First", "F9", "F9"],
    ["First", "Alt+F9", "Alt-F9"],
    ["Engi", "Alt+ArrowDown", "Alt-ArrowDown"],
    ["First", `${MOD}+Alt+KeyF`, "Mod-Alt-f"],
    ["First", `${MOD}+Alt+KeyD`, "Mod-Alt-d"],
    ["Note", "Shift+Alt+KeyN", "Alt-Shift-n"],
    ["First", `${MOD}+f`, "Mod-f"],
    ["First", `${MOD}+h`, "Mod-h"],
    ["First", `${MOD}+g`, "Mod-g"],
    ["First", "F3", "F3"],
    ["First", "Shift+F3", "Shift-F3"],
    ["First", `${MOD}+Shift+F5`, "Mod-Shift-F5"],
  ];
  for (const [before, key, name] of keys) {
    const pos = await caretAfter(page, before);
    original.head = original.anchor = pos;
    await page.keyboard.press(key);
    await expect.poll(() => page.evaluate(() => window.foliEdit.overridden.at(-1))).toBe(name);
    await expectUntouched(key);
  }
  expect(await page.evaluate(() => window.foliEdit.overridden)).toEqual(keys.map(([, , n]) => n));
});

test("in an open note, Shift+Alt+N goes to the user's binding, Escape still leaves", async ({
  page,
}) => {
  await load(page);
  await page.evaluate(() => window.foliEdit.editor.storyView?.editNote("footnote:1"));
  await expect(inStory(page)).toBeFocused();
  await page.keyboard.press("Shift+Alt+KeyN");
  await expect.poll(() => page.evaluate(() => window.foliEdit.overridden)).toEqual(["Alt-Shift-n"]);
  await expect(inStory(page)).toBeFocused();
  // Reserved: the way out of the note.
  await page.keyboard.press("Escape");
  await expect(inStory(page)).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
});
