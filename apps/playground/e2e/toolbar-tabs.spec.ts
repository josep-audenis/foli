import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/** `/toolbar.html?tabs`: `FoliEditor` with `defaultToolbarTabs` and a tab of the app's (15.3). */
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Formatting" });
const tab = (page: Page, name: string) => page.getByRole("tab", { name });
const paragraph = (page: Page, n: number) => editor(page).locator(":scope > .foli-page > *").nth(n);

test.beforeEach(async ({ page }) => {
  await page.goto("/toolbar.html?tabs");
  await expect(paragraph(page, 0)).toHaveText("Review this text.");
});

test("shows one tab's items at a time, without axe violations", async ({ page }) => {
  test.slow(); // axe takes several seconds per run in Firefox
  await expect(page.getByRole("tab")).toHaveText(["Home", "Insert", "Layout", "Review", "Stamps"]);
  await expect(tab(page, "Home")).toHaveAttribute("aria-selected", "true");
  await expect(toolbar(page).getByRole("button", { name: "Bold" })).toBeVisible();
  const scan = async () =>
    (
      await new AxeBuilder({ page })
        .include(".foli-ribbon-tabs")
        .include(".foli-ribbon-panel")
        .analyze()
    ).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`);
  expect(await scan()).toEqual([]);
  await tab(page, "Review").click();
  await expect(toolbar(page).getByRole("button", { name: "Bold" })).toHaveCount(0);
  await expect(toolbar(page).getByRole("button", { name: "Track changes" })).toBeVisible();
  expect(await scan()).toEqual([]);
});

test("mouse: a tab's click keeps the focus in the document, and its items act there", async ({
  page,
}) => {
  await paragraph(page, 0).dblclick({ position: { x: 10, y: 6 } });
  await tab(page, "Insert").click();
  await expect(editor(page)).toBeFocused();
  await tab(page, "Home").click();
  await toolbar(page).getByRole("button", { name: "Bold" }).click();
  await expect(editor(page)).toBeFocused();
  await expect(toolbar(page).getByRole("button", { name: "Bold" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("keyboard: arrow keys show each tab; Tab goes on into its toolbar", async ({ page }) => {
  await tab(page, "Home").focus();
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Insert")).toBeFocused();
  await expect(tab(page, "Insert")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(tab(page, "Stamps")).toBeFocused();
  await expect(toolbar(page).getByRole("button")).toHaveText(["Approve", "Insert"]);
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Home")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(toolbar(page).getByRole("button", { name: "Undo" })).toBeFocused();
});
