/**
 * Design ▸ Watermark (32.3): Word's gallery and its dialog, drawn behind the text of every
 * page, one undo step; axe.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function open(page: Page): Promise<void> {
  await page.goto("/edit.html");
  await page.waitForFunction(() => "foliEdit" in window);
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole("tab", { name: "Design" }).click();
}
const marks = (page: Page) => page.locator("section.foli-page [data-foli-watermark]");

test("a watermark from the gallery shows behind the text, and goes with Remove", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Watermark" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Confidential" }).click();
  await expect(marks(page)).toHaveCount(1);
  await expect(marks(page).locator("text")).toHaveText("CONFIDENTIAL");
  expect(await marks(page).evaluate((el) => getComputedStyle(el).zIndex)).toBe("-1");
  expect(await marks(page).evaluate((el) => getComputedStyle(el).transform)).not.toBe("none");
  const results = await new AxeBuilder({ page }).include("section.foli-page").analyze();
  expect(results.violations).toEqual([]);
  await page.getByRole("button", { name: "Watermark" }).click();
  await page.getByRole("menuitem", { name: "Remove watermark" }).click();
  await expect(marks(page)).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(marks(page)).toHaveCount(1);
});

test("Custom watermark… sets a horizontal red text in one undo step", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Watermark" }).click();
  await page.getByRole("menuitem", { name: "Custom watermark…" }).click();
  const dialog = page.getByRole("dialog", { name: "Watermark" });
  await expect(dialog.getByRole("radio", { name: "No watermark" })).toBeChecked();
  await dialog.getByRole("radio", { name: "Text watermark" }).check();
  const results = await new AxeBuilder({ page }).include(".foli-watermark-dialog").analyze();
  expect(results.violations).toEqual([]);
  await dialog.getByLabel("Text", { exact: true }).fill("Internal");
  await dialog.getByLabel("Horizontal").check();
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(marks(page).locator("text")).toHaveText("Internal");
  expect(await marks(page).evaluate((el) => getComputedStyle(el).transform)).toBe("none");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(marks(page)).toHaveCount(0);
});
