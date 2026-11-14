/**
 * Word formatting on a schema v3 document (8.7b), through the toolbar and keys of the editing
 * page (`/edit.html`): styles, font size, alignment, highlight, lists and their levels.
 */
import { expect, type Page, test } from "@playwright/test";

const MOD = "ControlOrMeta";
type Json = Record<string, unknown>;

const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Formatting" });

const paragraph = (value: string, attrs?: Json): Json => ({
  type: "paragraph",
  ...(attrs ? { attrs } : {}),
  content: [{ type: "text", text: value }],
});

/** Opens the editing page on paragraphs of Word's Normal (with Heading 1 and List Paragraph). */
async function open(page: Page, blocks: Json[]): Promise<void> {
  await page.goto("/edit.html");
  await page.waitForFunction(() => "foliEdit" in window);
  await page.evaluate(
    (content) =>
      window.foliEdit.load({
        ...window.foliEdit.sample,
        styles: [
          ...window.foliEdit.sample.styles,
          { id: "ListParagraph", type: "paragraph", name: "List Paragraph", basedOn: "Normal" },
        ],
        content: { type: "doc", content },
      } as never),
    blocks,
  );
  await editor(page).focus();
}

const attrs = (page: Page) =>
  page.evaluate(() =>
    (window.foliEdit.editor.getDocument().content.content ?? []).map((b) => b.attrs ?? {}),
  );
const markers = (page: Page) =>
  editor(page)
    .locator("[data-foli-marker]")
    .evaluateAll((els) => els.map((el) => el.textContent?.trim()));

test("the style box makes a heading; Enter after it goes back to Normal", async ({ page }) => {
  await open(page, [paragraph("Title"), paragraph("Body")]);
  await page.keyboard.press(`${MOD}+Home`);
  await toolbar(page).getByRole("combobox", { name: "Paragraph style" }).selectOption("Heading1");
  await expect(editor(page).locator("h1")).toHaveText("Title");
  await editor(page).focus();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Next");
  expect(await attrs(page)).toEqual([{ style: "Heading1" }, { style: "Normal" }, {}]);
  await expect(toolbar(page).getByRole("combobox", { name: "Paragraph style" })).toHaveValue(
    "Normal",
  );
});

test("font size and alignment apply to the selection, and undo one at a time", async ({ page }) => {
  await open(page, [paragraph("Sized text")]);
  await page.keyboard.press(`${MOD}+a`);
  await toolbar(page).getByRole("combobox", { name: "Font size" }).selectOption("14");
  const size = await editor(page)
    .locator("p span")
    .first()
    .evaluate((el) => getComputedStyle(el).fontSize);
  expect(Number.parseFloat(size)).toBeCloseTo((14 * 96) / 72, 1);
  await toolbar(page).getByRole("button", { name: "Center" }).click();
  await expect(editor(page).locator("p").first()).toHaveCSS("text-align", "center");
  await page.keyboard.press(`${MOD}+z`);
  await expect(editor(page).locator("p").first()).not.toHaveCSS("text-align", "center");
  await expect(toolbar(page).getByRole("combobox", { name: "Font size" })).toHaveValue("14");
});

test("highlight takes Word's colors", async ({ page }) => {
  await open(page, [paragraph("Marked")]);
  await page.keyboard.press(`${MOD}+a`);
  await toolbar(page).getByRole("button", { name: "Highlight" }).click();
  await page.getByRole("menuitemradio", { name: "Yellow" }).click();
  await expect(editor(page).locator("p span").first()).toHaveCSS(
    "background-color",
    "rgb(255, 255, 0)",
  );
});

test("bullets and numbers: levels with Tab and Shift+Tab, Enter on an empty item ends the list", async ({
  page,
}) => {
  await open(page, [paragraph("One")]);
  await toolbar(page).getByRole("button", { name: "Bulleted list" }).click();
  await editor(page).focus();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Two");
  expect(await markers(page)).toEqual(["•", "o"]);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.type("Three");
  expect(await markers(page)).toEqual(["•", "o", "•"]);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("After");
  expect((await attrs(page)).map((a) => (a.numbering as Json | undefined)?.level ?? null)).toEqual([
    0,
    1,
    0,
    null,
  ]);
  expect(await markers(page)).toEqual(["•", "o", "•"]);
  // The same paragraphs as a numbered list.
  await page.keyboard.press(`${MOD}+a`);
  await toolbar(page).getByRole("button", { name: "Numbered list" }).click();
  expect(await markers(page)).toEqual(["1.", "a.", "2.", "3."]);
  await expect(toolbar(page).getByRole("button", { name: "Numbered list" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("Tab types a tab outside a list", async ({ page }) => {
  await open(page, [paragraph("ab")]);
  await page.keyboard.press(`${MOD}+Home`);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Tab");
  const content = await page.evaluate(
    () => window.foliEdit.editor.getDocument().content.content?.[0]?.content,
  );
  expect(content).toEqual([
    { type: "text", text: "a" },
    { type: "tab" },
    { type: "text", text: "b" },
  ]);
  await expect(editor(page)).toBeFocused();
});
