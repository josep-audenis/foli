import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/** Alignment, colors and horizontal rules (task 7.7). */

const MOD = "ControlOrMeta";
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Formatting" });
const button = (page: Page, name: string) => toolbar(page).getByRole("button", { name });
const blocks = (page: Page) => editor(page).locator(":scope > .foli-page > *");
const rule = (page: Page) => editor(page).locator("hr");

/** An empty document with `text` typed in, the caret at its end. */
async function openWith(page: Page, text: string): Promise<void> {
  await page.goto("/");
  await editor(page).click();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press("Backspace");
  await page.keyboard.type(text);
  await expect(editor(page)).toHaveText(text);
}

/** Tag and text of each top-level block. */
const outline = (page: Page) =>
  blocks(page).evaluateAll((elements) =>
    elements.map((element) => `${element.tagName.toLowerCase()}:${element.textContent}`),
  );

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
  await expect(editor(page).locator('span[style*="background"]')).toHaveCSS(
    "background-color",
    "rgb(255, 245, 157)",
  );
  // Escape closes a menu without a change.
  await button(page, "Highlight").click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("rules: insert, select with a click or the arrows, leave with the arrows, type over", async ({
  page,
}) => {
  await openWith(page, "first");
  await button(page, "Horizontal rule").click();
  await page.keyboard.type("second");
  await expect.poll(() => outline(page)).toEqual(["p:first", "hr:", "p:second"]);

  // Up from the first line of the text after the rule selects it; Up again goes past it.
  await page.keyboard.press("ArrowUp");
  await expect(rule(page)).toHaveClass(/foli-selected-node/);
  await page.keyboard.press("ArrowUp");
  await expect(rule(page)).not.toHaveClass(/foli-selected-node/);
  await page.keyboard.type("!");
  await expect.poll(() => outline(page)).toEqual(["p:first!", "hr:", "p:second"]);
  // Down from the last line before it, and on into the text after it.
  await page.keyboard.press("ArrowDown");
  await expect(rule(page)).toHaveClass(/foli-selected-node/);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type(">");
  await expect.poll(() => outline(page)).toEqual(["p:first!", "hr:", "p:>second"]);
  // Left from the start of the text after it, Right back.
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowLeft");
  await expect(rule(page)).toHaveClass(/foli-selected-node/);
  await page.keyboard.press("ArrowRight");
  await expect(rule(page)).not.toHaveClass(/foli-selected-node/);

  // A click anywhere on its box selects it (taller than the line); typing replaces it.
  const box = await rule(page).boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(10);
  await page.mouse.click((box?.x ?? 0) + 40, (box?.y ?? 0) + 2);
  await expect(rule(page)).toHaveClass(/foli-selected-node/);
  await page.keyboard.type("x");
  await expect.poll(() => outline(page)).toEqual(["p:first!", "p:x", "p:>second"]);
});

test("Up from the second line of a paragraph moves in the text, not onto the rule", async ({
  page,
}) => {
  await openWith(page, "a");
  await button(page, "Horizontal rule").click();
  await page.keyboard.type("long words ".repeat(40).trim());
  await expect.poll(() => blocks(page).count()).toBe(3);
  // The caret is on the paragraph's last line: Up moves to the line above.
  await page.keyboard.press("ArrowUp");
  await expect(rule(page)).not.toHaveClass(/foli-selected-node/);
  await page.keyboard.press(`${MOD}+Home`);
  await page.keyboard.press("ArrowDown");
  await expect(rule(page)).toHaveClass(/foli-selected-node/);
  await page.keyboard.press("Backspace");
  await expect(rule(page)).toHaveCount(0);
});
