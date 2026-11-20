import { expect, test } from "@playwright/test";

// The built site (`vite build`, served by `vite preview`): a docs page, an API page and an example
// load from the production bundle without errors.

for (const [path, check] of [
  ["/docs/", "main h1"],
  ["/docs/api/core/", "#createeditor"],
  ["/docs/examples/custom-node/", ".foli-page .example-chip"],
] as const)
  test(`${path} loads from the build without errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.locator(check).first()).toBeVisible();
    // The page's own script ran (search is wired to its stylesheet and index).
    await page.getByLabel("Search the docs").fill("styling");
    await expect(page.locator("[data-search-results] a").first()).toBeVisible();
    expect(errors).toEqual([]);
  });
