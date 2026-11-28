/**
 * Word's Insert tab extras (Phase 35): Symbol (its recent symbols and dialog), one undo step
 * each; axe.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/edit.html");
  await page.waitForFunction(() => "foliEdit" in window);
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole("tab", { name: "Insert" }).click();
}
/** The first paragraph's text, the caret put at its start. */
const firstText = (page: Page) =>
  page.evaluate(() => window.foliEdit.editor.state.doc.child(0).textContent);

test.describe("Insert ▸ Symbol (35.1)", () => {
  test("the recent symbols insert at the caret; More Symbols… opens the dialog", async ({
    page,
  }) => {
    await open(page);
    await page.evaluate(() => window.foliEdit.editor.select(1));
    const before = await firstText(page);
    await page.getByRole("button", { name: "Symbol" }).click();
    const menu = page.getByRole("menu", { name: "Symbol" });
    await expect(menu.getByRole("menuitem")).toHaveCount(21);
    const results = await new AxeBuilder({ page }).include(".foli-menu").analyze();
    expect(results.violations).toEqual([]);
    await menu.getByRole("menuitem", { name: "©" }).click();
    expect(await firstText(page)).toBe(`©${before}`);
    await page.keyboard.press("ControlOrMeta+z");
    expect(await firstText(page)).toBe(before);
  });

  test("the dialog inserts a subset's character in its font, from the keyboard too", async ({
    page,
  }) => {
    await open(page);
    await page.evaluate(() => window.foliEdit.editor.select(1));
    const before = await firstText(page);
    await page.getByRole("button", { name: "Symbol" }).click();
    await page.getByRole("menuitem", { name: "More Symbols…" }).click();
    const dialog = page.getByRole("dialog", { name: "Symbol" });
    await dialog.getByLabel("Subset").selectOption({ label: "Arrows" });
    const results = await new AxeBuilder({ page }).include(".foli-symbol-dialog").analyze();
    expect(results.violations).toEqual([]);
    const grid = dialog.getByRole("listbox", { name: "Symbols" });
    await grid.getByRole("option", { selected: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByLabel("Character code (Unicode, hex)")).toHaveValue("2191");
    await page.keyboard.press("Enter");
    expect(await firstText(page)).toBe(`↑${before}`);
    // Still open: Special Characters, by name.
    await dialog.getByRole("tab", { name: "Special Characters" }).click();
    await dialog.getByRole("option", { name: /Section/ }).dblclick();
    expect(await firstText(page)).toBe(`↑§${before}`);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("Word's keys type its special characters", async ({ page }) => {
    await open(page);
    await page.locator("section.foli-page").first().click();
    await page.evaluate(() => window.foliEdit.editor.select(1));
    const before = await firstText(page);
    await page.keyboard.press("Control+Alt+c");
    await page.keyboard.press("Control+Alt+t");
    await page.keyboard.press("Control+Shift+Space");
    expect(await firstText(page)).toBe(`©™ ${before}`);
  });
});
