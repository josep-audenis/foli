/**
 * Word's Design tab (Phase 32): Page Color and the Page Borders dialog, drawn on the pages, one
 * undo step each; axe.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function open(page: Page): Promise<void> {
  await page.goto("/edit.html");
  await page.waitForFunction(() => "foliEdit" in window);
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole("tab", { name: "Design" }).click();
}
const firstPage = (page: Page) => page.locator("section.foli-page").first();

test("Page Color colors every page and No Color takes it away", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Page color" }).click();
  await page.getByRole("menuitemradio", { name: "Accent 4, Lighter 80%" }).click();
  const color = await firstPage(page).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(color).not.toBe("rgb(255, 255, 255)");
  expect(
    await page.evaluate(() => window.foliEdit.editor.getDocument().settings?.background?.color),
  ).toMatch(/^[0-9A-F]{6}$/);
  await page.keyboard.press("ControlOrMeta+z");
  expect(
    await page.evaluate(() => window.foliEdit.editor.getDocument().settings?.background),
  ).toBeUndefined();
  await page.getByRole("button", { name: "Page color" }).click();
  await page.getByRole("menuitemradio", { name: "Accent 1", exact: true }).click();
  await page.getByRole("button", { name: "Page color" }).click();
  await page.getByRole("menuitemradio", { name: "No Color" }).click();
  expect(
    await page.evaluate(() => window.foliEdit.editor.getDocument().settings?.background),
  ).toBeUndefined();
});

test("the Page Borders dialog draws a box on the pages, in one undo step", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Page borders" }).click();
  const dialog = page.getByRole("dialog", { name: "Page Borders" });
  await expect(dialog.getByLabel("None")).toBeFocused();
  await dialog.getByLabel("Box").check();
  const results = await new AxeBuilder({ page }).include(".foli-page-borders-dialog").analyze();
  expect(results.violations).toEqual([]);
  await dialog.getByLabel("Style").selectOption("double");
  await dialog.getByLabel("Width").selectOption("24");
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect(dialog).toHaveCount(0);
  const frame = firstPage(page).locator("[data-foli-page-borders]");
  await expect(frame).toHaveCount(1);
  const box = await frame.boundingBox();
  const pageBox = await firstPage(page).boundingBox();
  // 24 pt (32 px) from the page's edge.
  expect(Math.abs((box?.x ?? 0) - (pageBox?.x ?? 0) - 32)).toBeLessThan(1.5);
  expect(await frame.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("double");
  const pageResults = await new AxeBuilder({ page }).include("section.foli-page").analyze();
  expect(pageResults.violations).toEqual([]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(frame).toHaveCount(0);
});
