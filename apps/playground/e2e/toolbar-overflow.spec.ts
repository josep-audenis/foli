import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/** `/toolbar.html?overflow`: the default toolbar with `overflow="menu"` (17.4). */
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Formatting" });
const more = (page: Page) => toolbar(page).locator(".foli-toolbar-more");
const panel = (page: Page) => toolbar(page).getByRole("group", { name: "More" });
const paragraph = (page: Page, n: number) => editor(page).locator(":scope > .foli-page > *").nth(n);
const rows = (page: Page) =>
  toolbar(page).evaluate((bar) => {
    const tops = [...bar.querySelectorAll(":scope > .foli-toolbar-button, :scope > select")]
      .filter((el) => getComputedStyle(el).visibility !== "hidden")
      .map((el) => Math.round(el.getBoundingClientRect().top / 8));
    return new Set(tops).size;
  });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 600 });
  await page.goto("/toolbar.html?overflow");
  await expect(paragraph(page, 0)).toHaveText("Review this text.");
});

test("keeps one row: what does not fit is under More, without axe violations", async ({ page }) => {
  test.slow(); // axe takes several seconds per run in Firefox
  await expect(more(page)).toBeVisible();
  expect(await rows(page)).toBe(1);
  // Nothing sticks out of the toolbar.
  const fits = await toolbar(page).evaluate((bar) => bar.scrollWidth <= bar.clientWidth + 1);
  expect(fits).toBe(true);
  await expect(panel(page)).toBeHidden();
  await expect(toolbar(page).getByRole("button", { name: "Bold" })).toBeVisible();
  await expect(toolbar(page).getByRole("button", { name: "Page break" })).toBeHidden();
  const scan = async () =>
    (await new AxeBuilder({ page }).include(".foli-toolbar").analyze()).violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`,
    );
  expect(await scan()).toEqual([]);
  await more(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(more(page)).toHaveAttribute("aria-expanded", "true");
  expect(await scan()).toEqual([]);
});

test("mouse: an item in the panel acts on the document, which keeps the focus; a press outside closes it", async ({
  page,
}) => {
  await paragraph(page, 0).click({ position: { x: 2, y: 4 } });
  await more(page).click();
  await expect(editor(page)).toBeFocused();
  await panel(page).getByRole("button", { name: "Page break" }).click();
  await expect(editor(page)).toBeFocused();
  await expect(editor(page).locator(".foli-page")).toHaveCount(2);
  await expect(panel(page)).toBeVisible();
  await paragraph(page, 0).click();
  await expect(panel(page)).toBeHidden();
});

test("keyboard: the arrow keys go on into the panel and back; Escape closes it", async ({
  page,
}) => {
  await toolbar(page).getByRole("combobox", { name: "Paragraph style" }).focus();
  await page.keyboard.press("End");
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Controls" })).toBeFocused();
  // On from the last item to the first: the panel closes.
  await page.keyboard.press("ArrowRight");
  await expect(panel(page)).toBeHidden();
  await expect(toolbar(page).getByRole("combobox", { name: "Paragraph style" })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(more(page)).toBeFocused();
});

test("a wider place takes more groups, and all of them when they fit", async ({ page }) => {
  const inRow = () => toolbar(page).locator(":scope > .foli-toolbar-button:visible").count();
  const narrow = await inRow();
  await page.setViewportSize({ width: 1100, height: 600 });
  await expect.poll(inRow).toBeGreaterThan(narrow);
  await page.setViewportSize({ width: 3000, height: 600 });
  await expect(more(page)).toBeHidden();
  await expect(toolbar(page).getByRole("button", { name: "Controls" })).toBeVisible();
});
