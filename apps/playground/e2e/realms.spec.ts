/**
 * An editor inside a shadow root and inside a same-origin iframe (21.8, "verify first"): typing,
 * selecting and deleting reach the model as in the page's own document, and the pages are laid
 * out (`observeSizes`, `instanceof Element` across realms).
 */
import { expect, type Page, test } from "@playwright/test";

const text = (page: Page, which: "shadow" | "frame") =>
  page.evaluate((w) => window.foliRealms.text(w), which);

test.beforeEach(async ({ page }) => {
  // The frame's editor loads after the page: slow on a busy machine (Firefox).
  test.setTimeout(60_000);
  await page.goto("/realms.html");
});

test("an editor in a shadow root types, selects and deletes", async ({ page, browserName }) => {
  // WebKit gives a shadow root no selection of its own (docs/limitations.md).
  test.fixme(browserName === "webkit", "WebKit: no selection inside a shadow root");
  // Playwright's locators pierce open shadow roots.
  const editor = page.locator("#shadow-host").getByRole("textbox", { name: "Document" });
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" world");
  await expect.poll(() => text(page, "shadow")).toBe("Hello world");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.type("Bye");
  await expect.poll(() => text(page, "shadow")).toBe("Bye");
  await page.keyboard.press("Backspace");
  await expect.poll(() => text(page, "shadow")).toBe("By");
  expect(await page.evaluate(() => window.foliRealms.pages("shadow"))).toBe(1);
});

test("an editor in a same-origin iframe types, selects and deletes", async ({ page }) => {
  const editor = page.frameLocator("#frame").getByRole("textbox", { name: "Document" });
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" world");
  await expect.poll(() => text(page, "frame")).toBe("Hello world");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.type("Bye");
  await expect.poll(() => text(page, "frame")).toBe("Bye");
  await page.keyboard.press("Backspace");
  await expect.poll(() => text(page, "frame")).toBe("By");
  expect(await page.evaluate(() => window.foliRealms.pages("frame"))).toBe(1);
});
