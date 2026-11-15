import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/** Alignment, colors and horizontal rules (task 7.7). */

const MOD = "ControlOrMeta";
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Formatting" });
const button = (page: Page, name: string) => toolbar(page).getByRole("button", { name });
const blocks = (page: Page) => editor(page).locator(":scope > .foli-page > *");

/** An empty document with `text` typed in, the caret at its end. */
async function openWith(page: Page, text: string): Promise<void> {
  await page.goto("/");
  await editor(page).click();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press("Backspace");
  await page.keyboard.type(text);
  await expect(editor(page)).toHaveText(text);
}

test("alignment and color menus apply to the selection; the open menu passes axe", async ({
  page,
}) => {
  test.slow(); // axe takes several seconds per run in Firefox
  await openWith(page, "colored text");
  await button(page, "Center").click();
  await expect(blocks(page).first()).toHaveCSS("text-align", "center");
  await expect(button(page, "Center")).toHaveAttribute("aria-pressed", "true");

  await editor(page).focus();
  await page.keyboard.press(`${MOD}+a`);
  // Text color by keyboard: the menu opens on the current color, Enter picks.
  await button(page, "Text color").focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "Text color" });
  await expect(menu.getByRole("menuitemradio", { name: "Automatic" })).toBeFocused();
  const violations = (await new AxeBuilder({ page }).include(".foli-toolbar").analyze()).violations;
  expect(violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitemradio", { name: "Red" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  await expect(button(page, "Text color")).toBeFocused();
  await expect(editor(page).locator("span").first()).toHaveCSS("color", "rgb(192, 0, 0)");

  // Highlight with the mouse: the focus goes back to the document.
  await button(page, "Highlight").click();
  await page.getByRole("menuitemradio", { name: "Yellow" }).click();
  await expect(editor(page)).toBeFocused();
  // Word's yellow highlight.
  await expect(editor(page).locator('span[style*="background"]')).toHaveCSS(
    "background-color",
    "rgb(255, 255, 0)",
  );
  // Escape closes a menu without a change.
  await button(page, "Highlight").click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
});
