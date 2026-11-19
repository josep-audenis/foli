/**
 * Content controls in the editable view (11.9), on the editing page (`/edit.html`): their frames,
 * placeholders, lists, date picker and check boxes, by mouse and keyboard, in the body and a header;
 * T1 to T3 inside a rich text control; the toolbar's menu and dialog.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

type Json = Record<string, unknown>;
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const text = (value: string, marks?: Json[]): Json => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const hint = (value: string) => text(value, [{ type: "characterStyle", attrs: { id: "Hint" } }]);
const inline = (id: string, ...content: Json[]): Json[] => [
  { type: "controlStart", attrs: { id } },
  ...content,
  { type: "controlEnd", attrs: { id } },
];
const paragraph = (...content: (Json | Json[] | string)[]): Json => ({
  type: "paragraph",
  content: content.flat().map((c) => (typeof c === "string" ? text(c) : c)),
});
const inBlock = (block: Json, ...ids: string[]): Json => ({ ...block, attrs: { controls: ids } });
const showing = { showing: true, docPart: "DefaultPlaceholder_-1854013440", text: "Enter it" };
const CONTROLS: Record<string, Json> = {
  name: { kind: "text", alias: "Name", tag: "name", placeholder: showing },
  rich: { kind: "richText", alias: "Notes", tag: "rich" },
  list: {
    kind: "dropDown",
    alias: "Role",
    tag: "list",
    items: [
      { value: "e", display: "Engineer" },
      { value: "m", display: "Manager" },
    ],
    placeholder: { ...showing, text: "Choose" },
  },
  combo: {
    kind: "comboBox",
    tag: "combo",
    items: [{ value: "a", display: "Alpha" }],
    placeholder: { ...showing, text: "Pick" },
  },
  when: {
    kind: "date",
    alias: "When",
    tag: "when",
    dateFormat: "d MMMM yyyy",
    placeholder: { ...showing, text: "Date" },
  },
  box: { kind: "checkbox", tag: "box", checked: false },
  locked: { kind: "richText", tag: "locked", lock: "sdtContentLocked" },
};
const body = [
  paragraph("Name: ", inline("name", hint("Enter it")), "."),
  paragraph("Role: ", inline("list", hint("Choose")), " or ", inline("combo", hint("Pick")), "."),
  paragraph("On ", inline("when", hint("Date")), " ", inline("box", text("☐")), " done"),
  paragraph("Kept ", inline("locked", text("fixed")), " end"),
  inBlock(paragraph("First note"), "rich"),
  paragraph("after"),
];
const documentOf = (blocks: Json[], more: Json = {}): Json => ({
  schemaVersion: 5,
  section: {
    pageSize: { width: 11906, height: 16838 },
    margins: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 500, footer: 400 },
    ...((more.section as Json) ?? {}),
  },
  defaults: { paragraph: { spacing: { after: 0 } } },
  styles: [
    { id: "Normal", type: "paragraph", name: "Normal", isDefault: true },
    {
      id: "Hint",
      type: "character",
      name: "Placeholder Text",
      run: [{ type: "color", attrs: { value: "666666" } }],
    },
  ],
  numbering: { abstracts: [], instances: [] },
  comments: [],
  controls: CONTROLS,
  content: { type: "doc", content: blocks },
  ...(more.stories ? { stories: more.stories } : {}),
});

async function load(page: Page, document: Json = documentOf(body)) {
  await page.goto("/edit.html");
  await page.waitForFunction(() => "foliEdit" in window);
  await page.evaluate((doc) => window.foliEdit.load(doc as never), document);
}
/** Puts the caret in control `id` (`at` characters in) from code, and the focus on the page. */
const enter = (page: Page, id: string, at = 0) =>
  page.evaluate(
    ([key, offset]) => {
      const { editor, view } = window.foliEdit;
      let pos = -1;
      editor.state.doc.descendants((node, p) => {
        if (node.type.name === "controlStart" && node.attrs.id === key) pos = p + 1;
        if ((node.attrs.controls as string[] | null)?.includes(key as string) && pos < 0)
          pos = p + 1;
        return true;
      });
      editor.select(pos + (offset as number));
      view.focus();
    },
    [id, at] as const,
  );
const values = (page: Page) =>
  page.evaluate(() =>
    Object.fromEntries(window.foliEdit.editor.controlValues().map((v) => [v.tag ?? v.id, v.value])),
  );
const docText = (page: Page) => page.evaluate(() => window.foliEdit.editor.state.doc.textContent);
const selected = (page: Page) =>
  page.evaluate(() => {
    const { selection, doc } = window.foliEdit.editor.state;
    return doc.textBetween(selection.from, selection.to, "|");
  });
const frames = (page: Page) => page.locator("[data-foli-control-frame]");
const valid = (page: Page) => page.evaluate(() => window.foliEdit.validate());

test("a control shows its frame and title with the caret in it or the pointer over it", async ({
  page,
}) => {
  await load(page);
  const before = await docText(page);
  await expect(frames(page)).toHaveCount(0);
  await enter(page, "rich", 2);
  await expect(page.locator('[data-foli-control-frame="active"]')).toHaveCount(1);
  await expect(page.locator('[data-foli-control-tab="title"]')).toHaveText("Notes");
  const box = await page.locator('[data-foli-control-frame="active"]').boundingBox();
  const line = await page.getByText("First note").boundingBox();
  expect(box?.y).toBeLessThanOrEqual(line?.y as number);
  // Hovering another shows it too; none of it is document text.
  await page.getByText("fixed").hover();
  await expect(frames(page)).toHaveCount(2);
  expect(await docText(page)).toBe(before);
  // The positions still map: a click goes to its place.
  await page.getByText("after").click();
  await page.keyboard.press("Home");
  await page.keyboard.type("x");
  expect(await docText(page)).toContain("xafter");
  await expect(page.locator('[data-foli-control-frame="active"]')).toHaveCount(0);
});

test("a placeholder is selected whole, typing replaces it, emptying brings it back", async ({
  page,
}) => {
  await load(page);
  await enter(page, "name", 2);
  expect(await selected(page)).toBe("Enter it");
  await page.keyboard.type("Ada");
  expect((await values(page)).name).toBe("Ada");
  expect(await docText(page)).toContain("Name: Ada.");
  const color = await page.getByText("Ada").evaluate((el) => getComputedStyle(el).color);
  expect(color).not.toBe("rgb(102, 102, 102)");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Backspace");
  expect((await values(page)).name).toBeNull();
  expect(await selected(page)).toBe("Enter it");
  await expect(page.getByText("Enter it")).toHaveCSS("color", "rgb(102, 102, 102)");
  await page.keyboard.press("ControlOrMeta+z");
  await valid(page);
});

test("a click or the arrows into a placeholder select it; text typed at an edge stays in", async ({
  page,
}) => {
  await load(page);
  await page.getByText("Enter it").click();
  await expect.poll(() => selected(page)).toBe("Enter it");
  await page.keyboard.type("Ada");
  await page.keyboard.type(" B");
  expect((await values(page)).name).toBe("Ada B");
  await page.getByText("after").click();
  await enter(page, "name");
  await page.keyboard.press("Home");
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");
  await enter(page, "list");
  expect(await selected(page)).toBe("Choose");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");
  expect(await selected(page)).toBe("Choose");
});

test("the arrows stop at a control's edges and go past a placeholder", async ({ page }) => {
  await load(page);
  await enter(page, "name");
  expect(await selected(page)).toBe("Enter it");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("!");
  expect(await docText(page)).toContain("Enter it!.");
  expect((await values(page)).name).toBeNull();
  await enter(page, "rich", 1);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("^");
  expect(await valid(page)).toBe(true);
});

test("a drop-down list opens by keyboard and by its button, and takes no typing", async ({
  page,
}) => {
  await load(page);
  await enter(page, "list");
  await page.keyboard.type("x");
  expect((await values(page)).list).toBeNull();
  await page.keyboard.press("Alt+ArrowDown");
  const list = page.getByRole("listbox", { name: "Role" });
  await expect(list).toBeFocused();
  expect(
    (await new AxeBuilder({ page }).include("[data-foli-control-popup]").analyze()).violations,
  ).toEqual([]);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(list).toHaveCount(0);
  expect((await values(page)).list).toBe("m");
  expect(await docText(page)).toContain("Role: Manager");
  await expect(editor(page)).toBeFocused();
  await page.locator('[data-foli-control-tab="open"]').click();
  await page.getByRole("option", { name: "Engineer" }).click();
  expect((await values(page)).list).toBe("e");
  await enter(page, "list");
  await page.keyboard.press("Alt+ArrowDown");
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
});

test("a combo box takes an item or typed text", async ({ page }) => {
  await load(page);
  await enter(page, "combo");
  await page.keyboard.type("Other");
  expect((await values(page)).combo).toBe("Other");
  await page.keyboard.press("Alt+ArrowDown");
  await page.keyboard.press("Enter");
  expect((await values(page)).combo).toBe("a");
  expect(await docText(page)).toContain("or Alpha.");
});

test("a date is picked from the keyboard", async ({ page }) => {
  await load(page);
  await enter(page, "when");
  await page.keyboard.press("Alt+ArrowDown");
  const input = page.getByLabel("When");
  await expect(input).toBeFocused();
  expect(
    (await new AxeBuilder({ page }).include("[data-foli-control-popup]").analyze()).violations,
  ).toEqual([]);
  await input.fill("2026-03-03");
  await input.press("Enter");
  expect((await values(page)).when).toBe("2026-03-03");
  expect(await docText(page)).toContain("On 3 March 2026 ");
  await expect(editor(page)).toBeFocused();
});

test("a check box changes by click and by Space", async ({ page }) => {
  await load(page);
  await page.getByText("☐").click();
  expect((await values(page)).box).toBe(true);
  expect(await docText(page)).toContain("☒");
  await enter(page, "box");
  await page.keyboard.press("Space");
  expect((await values(page)).box).toBe(false);
  expect(await docText(page)).toContain("☐");
  await page.keyboard.press("ControlOrMeta+z");
  expect((await values(page)).box).toBe(true);
});

test("a click beside a block check box on its line does not change it", async ({ page }) => {
  await load(page, documentOf([inBlock(paragraph(text("\u2610")), "box"), paragraph("after")]));
  const line = await page.locator(".foli-page p").first().boundingBox();
  await page.mouse.click((line?.x ?? 0) + (line?.width ?? 0) - 10, (line?.y ?? 0) + 5);
  expect((await values(page)).box).toBe(false);
  await page.getByText("\u2610").click();
  expect((await values(page)).box).toBe(true);
});

test("a list open on the page breaks no axe rule, its landmarks included", async ({ page }) => {
  await load(page);
  await enter(page, "list");
  await page.keyboard.press("Alt+ArrowDown");
  const { violations } = await new AxeBuilder({ page })
    .include("[data-foli-control-popup]")
    .withRules(["region", "aria-required-children", "aria-input-field-name"])
    .analyze();
  expect(violations).toEqual([]);
});

test("a locked control takes nothing, and neither does a range over it", async ({ page }) => {
  await load(page);
  const before = await docText(page);
  await enter(page, "locked", 2);
  await page.keyboard.type("x");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Delete");
  await page.keyboard.press("Enter");
  expect(await docText(page)).toBe(before);
  await page.keyboard.press("Shift+Home");
  await page.keyboard.press("Backspace");
  expect(await docText(page)).toBe(before);
  await page
    .locator(".foli-page")
    .first()
    .click({ position: { x: 5, y: 5 } });
  await valid(page);
});

test("T1 in a rich text control: typing and formatting keep the tree valid", async ({ page }) => {
  await load(page);
  await enter(page, "rich", 10);
  for (const key of [" more", "Enter", "second", "Enter", "third"]) {
    if (key === "Enter") await page.keyboard.press("Enter");
    else
      for (const char of key) {
        await page.keyboard.type(char);
        expect(await valid(page)).toBe(true);
      }
  }
  await page.keyboard.press("Shift+Home");
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("!");
  expect(await valid(page)).toBe(true);
  const info = await page.evaluate(() => {
    const { doc } = window.foliEdit.editor.state;
    const blocks: { text: string; controls: unknown; bold: boolean }[] = [];
    doc.forEach((node) => {
      blocks.push({
        text: node.textContent,
        controls: node.attrs.controls,
        bold: JSON.stringify(node.toJSON()).includes('"bold"'),
      });
    });
    return blocks.slice(4);
  });
  expect(info).toEqual([
    { text: "First note more", controls: ["rich"], bold: false },
    { text: "second", controls: ["rich"], bold: false },
    { text: "third!", controls: ["rich"], bold: true },
    { text: "after", controls: null, bold: false },
  ]);
});

test("T2 in a rich text control: a selection is replaced, undo restores it exactly", async ({
  page,
}) => {
  const bold = text("bold", [{ type: "bold" }]);
  await load(
    page,
    documentOf([
      paragraph("before"),
      inBlock(paragraph("one ", bold, " two"), "rich"),
      inBlock(paragraph("three"), "rich"),
      inBlock(paragraph("four"), "rich"),
      paragraph("after"),
    ]),
  );
  const state = () =>
    page.evaluate(() => {
      const { doc, selection } = window.foliEdit.editor.state;
      return { doc: doc.toJSON(), from: selection.from, to: selection.to };
    });
  await enter(page, "rich", 2);
  await page.evaluate(() => {
    const { editor } = window.foliEdit;
    let last = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === "four") last = pos + 3;
      return true;
    });
    editor.select(editor.state.selection.from, last);
  });
  const before = await state();
  await page.keyboard.type("Z");
  expect(await docText(page)).toBe("beforeonZurafter");
  expect(await valid(page)).toBe(true);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await state()).toEqual(before);
});

test("T3 in a rich text control: pasted text and HTML go in, and plain text in a text one", async ({
  page,
}) => {
  await load(page);
  const paste = (types: Record<string, string>) =>
    page.evaluate((data) => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: { getData: (type: string) => data[type] ?? "", files: [], types: Object.keys(data) },
      });
      document.querySelector('[role="textbox"]')?.dispatchEvent(event);
    }, types);
  await enter(page, "rich", 10);
  await paste({ "text/plain": " plain" });
  expect(await docText(page)).toContain("First note plain");
  await paste({ "text/html": "<p>one</p><p><b>two</b></p>" });
  expect(await valid(page)).toBe(true);
  const blocks = await page.evaluate(() => {
    const out: unknown[] = [];
    window.foliEdit.editor.state.doc.forEach((node) => {
      if (node.attrs.controls) out.push(node.textContent);
    });
    return out;
  });
  expect((blocks as string[]).join("|")).toContain("one");
  expect((blocks as string[]).join("|")).toContain("two");
  await enter(page, "name");
  await paste({ "text/plain": "line\nnext", "text/html": "<p><b>x</b></p>" });
  expect((await values(page)).name).toBe("line next");
  expect(await valid(page)).toBe(true);
});

test("controls work in a header, by keyboard", async ({ page }) => {
  await load(
    page,
    documentOf([paragraph("body")], {
      section: { headers: { default: "h" } },
      stories: {
        h: {
          kind: "header",
          content: {
            type: "doc",
            content: [
              paragraph("Head ", inline("list", hint("Choose")), " ", inline("box", text("☐"))),
            ],
          },
        },
      },
    }),
  );
  await page.evaluate(() => window.foliEdit.editor.storyView?.edit("header"));
  const header = () => page.evaluate(() => window.foliEdit.editor.story("h") as never);
  expect(header).toBeDefined();
  const select = (id: string) =>
    page.evaluate((key) => {
      const story = window.foliEdit.editor.story("h");
      let pos = 0;
      story?.state.doc.descendants((node, p) => {
        if (node.type.name === "controlStart" && node.attrs.id === key) pos = p + 1;
        return true;
      });
      story?.select(pos);
    }, id);
  await select("list");
  await expect(page.locator('[data-foli-control-frame="active"]')).toHaveCount(1);
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page.getByRole("listbox", { name: "Role" })).toBeFocused();
  await page.keyboard.press("Enter");
  await select("box");
  await page.keyboard.press("Space");
  const read = await page.evaluate(() => window.foliEdit.editor.controlValues());
  expect(read.map((v) => [v.story, v.value])).toEqual([
    ["h", "e"],
    ["h", true],
  ]);
  await page.keyboard.press("Escape");
  await expect(page.locator("section.foli-page .foli-header").first()).toContainText("Engineer");
});

test("the toolbar inserts a control and edits its properties, by keyboard and axe-clean", async ({
  page,
}) => {
  await load(page, documentOf([paragraph("x")]));
  await enter(page, "name").catch(() => undefined);
  await page.evaluate(() => {
    window.foliEdit.editor.select(2);
    window.foliEdit.view.focus();
  });
  const button = page.getByRole("button", { name: "Controls", exact: true });
  await button.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Drop-down list" })).toBeVisible();
  expect((await new AxeBuilder({ page }).include(".foli-menu").analyze()).violations).toEqual([]);
  await page.getByRole("menuitem", { name: "Drop-down list" }).click();
  await button.focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("menuitem", { name: "Control properties…" }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Content control properties" });
  await expect(page.getByLabel("Title")).toBeFocused();
  expect(
    (await new AxeBuilder({ page }).include(".foli-table-dialog").analyze()).violations,
  ).toEqual([]);
  await page.keyboard.type("Size");
  await page.getByLabel("Tag").fill("size");
  await page.getByLabel(/List items/).fill("Small | s\nLarge | l");
  await page.getByLabel("The control cannot be deleted").check();
  await page.keyboard.press("Tab");
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect(dialog).toHaveCount(0);
  const control = await page.evaluate(() => {
    const { controls } = window.foliEdit.editor.getDocument();
    return Object.values(controls ?? {}).find((c) => c.tag === "size");
  });
  expect(control).toMatchObject({
    alias: "Size",
    lock: "sdtLocked",
    items: [
      { value: "s", display: "Small" },
      { value: "l", display: "Large" },
    ],
  });
});

test("a repeating section that forbids new items offers none", async ({ page }) => {
  await load(page, {
    ...documentOf([inBlock(paragraph("item"), "r", "i"), paragraph("end")]),
    controls: { r: { kind: "repeating", noInsertDelete: true }, i: { kind: "repeatingItem" } },
  });
  await enter(page, "i", 1);
  await expect(page.locator('[data-foli-control-frame="active"]')).toHaveCount(1);
  await expect(page.locator('[data-foli-control-tab="add"]')).toHaveCount(0);
});

test("a repeating section gets another item", async ({ page }) => {
  await load(page, documentOf([paragraph("item"), paragraph("end")]));
  await page.evaluate(() => {
    const { editor, view, commands } = window.foliEdit;
    editor.select(2);
    editor.run(commands.insertControl("repeating", { title: "Rows" }));
    view.focus();
  });
  await page.locator('[data-foli-control-tab="add"]').click();
  expect(await docText(page)).toBe("itemitemend");
  await page.keyboard.press("ControlOrMeta+z");
  expect(await docText(page)).toBe("itemend");
});
