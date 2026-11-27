/**
 * Layout ▸ Line Numbers (32.5): numbers in the left margin, one per line, Suppress for current
 * paragraph, the options dialog, one undo step each; axe.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/edit.html");
  await page.waitForFunction(() => "foliEdit" in window);
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole("tab", { name: "Layout" }).click();
}
const numbers = (page: Page) => page.locator("section.foli-page [data-foli-line-numbers] span");
const menu = async (page: Page, entry: string) => {
  await page.getByRole("button", { name: "Line numbers" }).click();
  await page.getByRole("menuitemcheckbox", { name: entry }).click();
};

test("Continuous numbers every line in the margin; Suppress and undo", async ({ page }) => {
  await open(page);
  await menu(page, "Continuous");
  await expect(numbers(page).first()).toHaveText("1");
  const count = await numbers(page).count();
  expect(count).toBeGreaterThanOrEqual(2);
  const texts = await numbers(page).allTextContents();
  expect(texts).toEqual(texts.map((_, i) => String(i + 1)));
  // Left of the text.
  const first = await numbers(page).first().boundingBox();
  const heading = await page.locator("section.foli-page h1").first().boundingBox();
  expect((first?.x ?? 0) + (first?.width ?? 0)).toBeLessThan(heading?.x ?? 0);
  const results = await new AxeBuilder({ page }).include("section.foli-page").analyze();
  expect(results.violations).toEqual([]);
  await page.evaluate(() => window.foliEdit.editor.select(3));
  await menu(page, "Suppress for current paragraph");
  await expect(numbers(page)).toHaveCount(count - 1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(numbers(page)).toHaveCount(count);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(numbers(page)).toHaveCount(0);
});

test("Line numbering options… sets start and count by", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Line numbers" }).click();
  await page.getByRole("menuitem", { name: "Line numbering options…" }).click();
  const dialog = page.getByRole("dialog", { name: "Line Numbers" });
  await dialog.getByLabel("Add line numbering").check();
  await dialog.getByLabel("Start at").fill("10");
  const results = await new AxeBuilder({ page }).include(".foli-line-numbers-dialog").analyze();
  expect(results.violations).toEqual([]);
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect(numbers(page).first()).toHaveText("10");
  expect(
    await page.evaluate(() => window.foliEdit.editor.getDocument().section.lineNumbers),
  ).toEqual({ countBy: 1, start: 9, restart: "newPage" });
});
