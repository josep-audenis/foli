import { expect, type Page, test } from "@playwright/test";

const STORAGE_KEY = "foli-playground-document";
const MOD = "ControlOrMeta";

interface Inline {
  type: string;
  text?: string;
  marks?: { type: string }[];
}
interface Block {
  type: string;
  content?: Inline[];
}

const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });

/** Each rendered block as its text (the view renders synchronously after every change). */
const texts = (page: Page) => editor(page).locator(":scope > *").allTextContents();

/** The model as the playground saved it, or null. Saving is debounced (300 ms): poll it. */
async function saved(page: Page): Promise<Block[] | null> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  return raw ? JSON.parse(raw).content.content : null;
}

/** Each saved block as its plain text, or null. */
async function savedTexts(page: Page): Promise<string[] | null> {
  const blocks = await saved(page);
  return blocks?.map((b) => (b.content ?? []).map((i) => i.text ?? "\n").join("")) ?? null;
}

/** Opens the playground and replaces the sample with an empty document, caret inside it. */
async function openEmpty(page: Page): Promise<void> {
  await page.goto("/");
  await editor(page).click();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press("Backspace");
  await expect.poll(() => texts(page)).toEqual([""]);
}

test("typing inserts text at the caret", async ({ page }) => {
  await openEmpty(page);
  await page.keyboard.type("Hello world");
  await expect(editor(page)).toHaveText("Hello world");
  await expect.poll(() => savedTexts(page)).toEqual(["Hello world"]);
});

test("typing after native caret movement uses the live DOM selection", async ({ page }) => {
  await openEmpty(page);
  await page.keyboard.type("ac");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("b");
  await page.keyboard.press("End");
  await page.keyboard.type("d");
  await expect.poll(() => texts(page)).toEqual(["abcd"]);

  // Away and back to the caret position the view last wrote.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("e");
  await expect.poll(() => savedTexts(page)).toEqual(["abcde"]);
});

test("Enter splits the paragraph and Backspace joins it again", async ({ page }) => {
  await openEmpty(page);
  await page.keyboard.type("onetwo");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(editor(page).locator("p")).toHaveText(["one", "two"]);
  await expect.poll(() => savedTexts(page)).toEqual(["one", "two"]);

  await page.keyboard.press("Backspace");
  await expect.poll(() => texts(page)).toEqual(["onetwo"]);
  await page.keyboard.press("Backspace");
  await page.keyboard.type("!");
  await expect.poll(() => savedTexts(page)).toEqual(["on!two"]);
});

test("triple-click selects one paragraph; typing replaces only it", async ({ page }) => {
  await openEmpty(page);
  await page.keyboard.type("one");
  await page.keyboard.press("Enter");
  await page.keyboard.type("two");
  await page.keyboard.press("Enter");
  await page.keyboard.type("three");
  await editor(page).locator("p").nth(1).click({ clickCount: 3 });
  await page.keyboard.type("X");
  await expect.poll(() => savedTexts(page)).toEqual(["one", "X", "three"]);
});

test("Mod-b toggles bold for the next typed text and on a selection", async ({ page }) => {
  await openEmpty(page);
  await page.keyboard.type("a");
  await page.keyboard.press(`${MOD}+b`);
  await page.keyboard.type("b");
  await page.keyboard.press(`${MOD}+b`);
  await page.keyboard.type("c");
  await expect
    .poll(() => saved(page))
    .toEqual([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b", marks: [{ type: "bold" }] },
          { type: "text", text: "c" },
        ],
      },
    ]);
  await expect(editor(page).locator("strong")).toHaveText("b");

  await page.keyboard.press("Shift+Home");
  await page.keyboard.press(`${MOD}+b`);
  await expect
    .poll(() => saved(page))
    .toEqual([
      { type: "paragraph", content: [{ type: "text", text: "abc", marks: [{ type: "bold" }] }] },
    ]);
});

test("undo and redo restore exact documents", async ({ page }) => {
  await openEmpty(page);
  // Let the history group of the initial select-all delete close (500 ms).
  await page.waitForTimeout(600);
  await page.keyboard.type("one");
  await page.keyboard.press("Enter");
  await page.keyboard.type("two");
  await expect.poll(() => savedTexts(page)).toEqual(["one", "two"]);
  const edited = await saved(page);

  for (let i = 0; i < 20 && (await texts(page)).join("|") !== ""; i++)
    await page.keyboard.press(`${MOD}+z`);
  expect(await texts(page)).toEqual([""]);

  for (let i = 0; i < 20 && (await texts(page)).length < 2; i++)
    await page.keyboard.press(`${MOD}+Shift+z`);
  for (let i = 0; i < 20 && (await texts(page)).join("|") !== "one|two"; i++)
    await page.keyboard.press(`${MOD}+y`);
  await expect.poll(() => saved(page)).toEqual(edited);

  // The caret is back where the redone typing ended.
  await page.keyboard.type("!");
  await expect.poll(() => savedTexts(page)).toEqual(["one", "two!"]);
});

test("a reload right after typing keeps the edited document", async ({ page }) => {
  await openEmpty(page);
  await page.keyboard.type("Kept ");
  await page.keyboard.press(`${MOD}+b`);
  await page.keyboard.type("bold");
  await page.keyboard.press("Enter");
  await page.keyboard.type("second");
  await expect.poll(() => texts(page)).toEqual(["Kept bold", "second"]);
  const html = await editor(page).innerHTML();

  // No wait for the debounced save: leaving the page saves what is still pending.
  await page.reload();
  await expect(editor(page)).toHaveText(/Kept bold/);
  expect(await editor(page).innerHTML()).toBe(html);
  expect(await savedTexts(page)).toEqual(["Kept bold", "second"]);

  await editor(page).click();
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.type(" more");
  await expect.poll(() => savedTexts(page)).toEqual(["Kept bold", "second more"]);
});
