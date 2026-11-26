/**
 * The status bar (29.7): page X of Y, the word count and its dialog, tracking, the zoom; axe.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const bar = (page: Page) => page.getByRole("group", { name: "Status bar" });

async function open(page: Page): Promise<void> {
  await page.goto("/edit.html?toolbar");
  await page.waitForFunction(() => "foliEdit" in window);
  await page.evaluate(() => document.fonts.ready);
}

test("shows the page and the words, counts them, tracks and zooms", async ({ page }) => {
  await open(page);
  await expect(bar(page).getByText(/^Page 1 of \d+$/)).toBeVisible();
  const words = bar(page).getByRole("button", { name: /^\d+ words$/ });
  await expect(words).toBeVisible();
  await words.click();
  const dialog = page.getByRole("dialog", { name: "Word count" });
  await expect(dialog).toContainText("Paragraphs");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await bar(page).getByRole("button", { name: "Track changes: off" }).click();
  await expect(bar(page).getByRole("button", { name: "Track changes: on" })).toBeVisible();
  await bar(page).getByRole("button", { name: "Zoom in" }).click();
  await expect(bar(page).getByText("125%")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (document.getElementById("editor") as HTMLElement).style.zoom))
    .toBe("1.25");
  await bar(page).getByRole("button", { name: "Whole page" }).click();
  await expect(bar(page).getByText("125%")).toHaveCount(0);
  const results = await new AxeBuilder({ page }).include("#status").analyze();
  expect(results.violations).toEqual([]);
});
