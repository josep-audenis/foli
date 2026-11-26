import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// The try page (29.11): Word's look, light by default with a theme switch, the status bar, the
// ribbon's Styles gallery; axe in light and dark.

async function open(page: Page): Promise<void> {
  await page.goto("/test/");
  await expect(
    page.getByRole("group", { name: "Status bar" }).getByText(/^Page 1 of \d+$/),
  ).toBeVisible({
    timeout: 20_000,
  });
}
const axe = async (page: Page) =>
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

test("opens light, as Word, and switches to dark and back; axe-clean in both", async ({ page }) => {
  test.slow(); // axe on the whole editor takes seconds per run in Firefox
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page);
  // Light though the system is dark: the reader has not picked yet.
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
  await expect(page.getByRole("listbox", { name: "Styles" })).toBeVisible();
  await axe(page);
  await page.getByLabel("Theme").selectOption("dark");
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await axe(page);
  // Kept in this browser.
  await page.reload();
  await expect(page.getByLabel("Theme")).toHaveValue("dark");
  await page.getByLabel("Theme").selectOption("system");
  expect(await page.evaluate(() => document.documentElement.hasAttribute("data-theme"))).toBe(
    false,
  );
});

test("the status bar counts the words and zooms the pages", async ({ page }) => {
  await open(page);
  const bar = page.getByRole("group", { name: "Status bar" });
  await expect(bar.getByRole("button", { name: /^[\d,.]+ words$/ })).toBeVisible();
  await bar.getByRole("button", { name: "Zoom in" }).click();
  await expect(bar.getByText("125%")).toBeVisible();
});
