/**
 * Home ▸ Borders and Shading (32.4): the menu and the dialog on the caret's paragraph, drawn,
 * one undo step; axe.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/edit.html");
  await page.waitForFunction(() => "foliEdit" in window);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.foliEdit.editor.select(3));
}
const firstBlock = (page: Page) => page.locator("section.foli-page :is(h1, p)").first();

test("Borders ▸ Bottom border draws a line under the paragraph, undone in one step", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Borders" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Bottom border" }).click();
  await expect
    .poll(() => firstBlock(page).evaluate((el) => getComputedStyle(el).borderBottomStyle))
    .toBe("solid");
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(() => firstBlock(page).evaluate((el) => getComputedStyle(el).borderBottomStyle))
    .toBe("none");
});

test("the Borders and Shading dialog sets a box and a fill", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Borders" }).click();
  await page.getByRole("menuitem", { name: "Borders and Shading…" }).click();
  const dialog = page.getByRole("dialog", { name: "Borders and Shading" });
  await dialog.getByLabel("Box").check();
  await dialog.getByLabel("Fill").selectOption({ label: "Accent 1" });
  const results = await new AxeBuilder({ page }).include(".foli-borders-dialog").analyze();
  expect(results.violations).toEqual([]);
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => firstBlock(page).evaluate((el) => getComputedStyle(el).borderLeftStyle))
    .toBe("solid");
  expect(await firstBlock(page).evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
    "rgba(0, 0, 0, 0)",
  );
});
