/**
 * Word's Layout tab (30.5): Margins, Orientation, Size, Columns and Breaks set the caret's
 * section; the Indent and Spacing boxes set the paragraph; axe on the open menu.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function open(page: Page): Promise<void> {
  await page.goto("/edit.html");
  await page.waitForFunction(() => "foliEdit" in window);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.foliEdit.editor.select(3));
  await page.getByRole("tab", { name: "Layout" }).click();
}
const section = (page: Page) => page.evaluate(() => window.foliEdit.editor.getDocument().section);

test("the page menus set the caret's section", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Margins" }).click();
  const results = await new AxeBuilder({ page }).include(".foli-toolbar").analyze();
  expect(results.violations).toEqual([]);
  await page.getByRole("menuitemcheckbox", { name: "Wide" }).click();
  expect((await section(page)).margins).toMatchObject({ left: 2880, right: 2880 });
  await page.getByRole("button", { name: "Size" }).click();
  await page.getByRole("menuitemcheckbox", { name: "A4" }).click();
  await page.getByRole("button", { name: "Orientation" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Landscape" }).click();
  expect((await section(page)).pageSize).toEqual({
    width: 16838,
    height: 11906,
    orientation: "landscape",
  });
  await page.getByRole("button", { name: "Columns" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Three" }).click();
  expect((await section(page)).columns).toMatchObject({ count: 3 });
  // The pages follow: wider than tall now.
  const box = await page.locator("section.foli-page").first().boundingBox();
  expect((box?.width ?? 0) > (box?.height ?? 0)).toBe(true);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await section(page)).columns?.count ?? 1).toBe(1);
});

test("Custom margins… opens Page setup; Breaks inserts a page break", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Margins" }).click();
  await page.getByRole("menuitem", { name: "Custom margins…" }).click();
  await expect(page.getByRole("dialog", { name: "Page setup" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Breaks" }).click();
  await page.getByRole("menuitem", { name: "Page", exact: true }).click();
  await expect(page.locator("section.foli-page")).toHaveCount(2);
});

test("the Indent and Spacing boxes set the paragraph", async ({ page }) => {
  await open(page);
  const left = page.getByRole("textbox", { name: "Indent left" });
  await left.fill("1");
  await left.press("Enter");
  const after = page.getByRole("textbox", { name: "Spacing after" });
  await after.press("ArrowUp");
  const attrs = await page.evaluate(() => window.foliEdit.editor.state.doc.child(0).attrs);
  expect(attrs.indent).toMatchObject({ left: 1440 });
  expect(attrs.spacing).toMatchObject({ after: expect.any(Number) });
});
