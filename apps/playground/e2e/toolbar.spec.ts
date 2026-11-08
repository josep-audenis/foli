import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Formatting" });
const button = (page: Page, name: string) => toolbar(page).getByRole("button", { name });
const blocks = (page: Page) => editor(page).locator(":scope > .foli-page > *");

test("the toolbar has no axe violations, editable and read-only", async ({ page }) => {
  test.slow(); // axe takes several seconds per run in Firefox
  await page.goto("/");
  const scan = async () =>
    (await new AxeBuilder({ page }).include(".foli-toolbar").analyze()).violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`,
    );
  expect(await scan()).toEqual([]);
  await page.getByRole("checkbox", { name: "Read-only" }).check();
  await expect(button(page, "Bold")).toHaveAttribute("aria-disabled", "true");
  expect(await scan()).toEqual([]);
});

test("a click formats the selection and leaves focus and selection in the document", async ({
  page,
}) => {
  await page.goto("/");
  const paragraph = blocks(page).nth(1);
  await paragraph.click({ position: { x: 2, y: 4 } });
  await page.keyboard.press("Home");
  for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowRight");
  const selected = await page.evaluate(() => String(getSelection()));
  expect(selected).toBe("Edited");

  await button(page, "Italic").click();
  await expect(editor(page)).toBeFocused();
  await expect(paragraph.locator("em").first()).toHaveText(/^Edited/);
  await expect(button(page, "Italic")).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => String(getSelection()))).toBe("Edited");

  // Typing goes on at the selection; Undo from the toolbar puts the text back.
  await page.keyboard.type("Changed");
  await expect(paragraph).toContainText("Changed by Foli");
  await button(page, "Undo").click();
  await expect(paragraph).toContainText("Edited by Foli");
  await expect(editor(page)).toBeFocused();
});

test("keyboard only: Tab to the toolbar, arrows to a heading level, Enter, Tab back to typing", async ({
  page,
}) => {
  await page.goto("/");
  await blocks(page)
    .nth(1)
    .click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("Shift+Tab");
  await expect(button(page, "Bold")).toBeFocused();
  // Italic, Underline, Strikethrough, Link, Text color, Highlight, Paragraph, H1.
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowRight");
  await expect(button(page, "H1")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(button(page, "H1")).toHaveAttribute("aria-pressed", "true");
  await expect(blocks(page).nth(1)).toHaveJSProperty("tagName", "H1");
  // The toolbar is one tab stop: Tab goes to the document, where the caret was.
  await page.keyboard.press("Tab");
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("> ");
  await expect(blocks(page).nth(1)).toHaveText(/^> Edited by Foli/);
  // Back in the toolbar, the last used button has the tab stop.
  await page.keyboard.press("Shift+Tab");
  await expect(button(page, "H1")).toBeFocused();
});

test("a click while the document is not focused focuses it and shows the change", async ({
  page,
}) => {
  await page.goto("/");
  const paragraph = blocks(page).nth(1);
  await paragraph.click({ position: { x: 2, y: 4 } });
  await page.keyboard.press("Home");
  for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowRight");
  await page.getByRole("checkbox", { name: "Read-only" }).focus();
  await button(page, "Bold").click();
  await expect(editor(page)).toBeFocused();
  await expect(paragraph.locator("strong").first()).toHaveText("Edited");
  expect(await page.evaluate(() => String(getSelection()))).toBe("Edited");
});

test("keyboard activation over a selected range: Tab back and typing replaces the range", async ({
  page,
}) => {
  await page.goto("/");
  const paragraph = blocks(page).nth(1);
  await paragraph.click({ position: { x: 2, y: 4 } });
  await page.keyboard.press("Home");
  for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("ArrowRight"); // Italic
  await page.keyboard.press("Enter");
  await expect(paragraph.locator("em").first()).toHaveText("Edited");
  await page.keyboard.press("Tab");
  await expect(editor(page)).toBeFocused();
  expect(await page.evaluate(() => String(getSelection()))).toBe("Edited");
  await page.keyboard.type("Typed");
  await expect(paragraph).toContainText("Typed by Foli");
});
