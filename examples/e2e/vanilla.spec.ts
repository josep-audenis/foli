/**
 * The framework-free example (`examples/vanilla`: `@folijs/view` and `@folijs/core`, no React):
 * its buttons run commands, and the document saves to JSON and loads back (a bad one refused).
 * The success criterion itself runs on it from success.spec.ts.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const bold = (page: Page) =>
  editor(page).evaluate((host) =>
    [...host.querySelectorAll('span[style*="font-weight: 700"]')]
      .map((span) => span.textContent)
      .join(""),
  );

test("buttons run commands; JSON saves and loads", async ({ page }) => {
  test.slow(); // axe takes several seconds per run in Firefox
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  const button = (name: string) => page.getByRole("button", { name, exact: true });
  await expect(button("Undo")).toBeDisabled();
  await editor(page).click();
  await page.keyboard.type("Hello world");
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft");
  await button("Bold").click();
  await expect.poll(() => bold(page)).toBe("world");
  await expect(button("Bold")).toHaveAttribute("aria-pressed", "true");
  await button("Undo").click();
  await expect.poll(() => bold(page)).toBe("");
  await button("Redo").click();
  await expect.poll(() => bold(page)).toBe("world");

  await button("Save JSON").click();
  await expect(page.getByLabel("JSON", { exact: true })).toHaveValue(/"bold"/);
  // The button took the focus: back to the document, at its end.
  await editor(page).focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" again");
  await expect(editor(page)).toHaveText("Hello world again");
  await button("Load JSON").click();
  await expect(editor(page)).toHaveText("Hello world");
  await expect.poll(() => bold(page)).toBe("world");

  await page.getByLabel("JSON", { exact: true }).fill('{"schemaVersion": 5}');
  await button("Load JSON").click();
  await expect(page.locator("#status")).toContainText("Not loaded");
  await expect(editor(page)).toHaveText("Hello world");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(errors).toEqual([]);
});
