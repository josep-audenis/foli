import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/** `/toolbar.html`: `FoliEditor` with its own toolbar items (12.6). */
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Formatting" });
const button = (page: Page, name: string) => toolbar(page).getByRole("button", { name });
const paragraph = (page: Page, n: number) => editor(page).locator(":scope > .foli-page > *").nth(n);
/** The caret at the start of the first paragraph. */
async function caretAtStart(page: Page) {
  await paragraph(page, 0).click({ position: { x: 2, y: 4 } });
  await page.keyboard.press("Home");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/toolbar.html");
  await expect(paragraph(page, 0)).toHaveText("Review this text.");
});

test("shows the items given, in order, without axe violations", async ({ page }) => {
  test.slow(); // axe takes several seconds per run in Firefox
  const names = await toolbar(page)
    .getByRole("button")
    .evaluateAll((buttons) => buttons.map((b) => b.getAttribute("aria-label") ?? b.textContent));
  expect(names).toEqual(["Undo", "Redo", "Bold", "Italic", "Cross out", "Approve", "Insert"]);
  await expect(toolbar(page).locator("hr")).toHaveCount(2);
  await expect(toolbar(page).getByRole("combobox")).toHaveCount(0);
  const scan = async () =>
    (
      await new AxeBuilder({ page }).include(".foli-toolbar").include(".sign").analyze()
    ).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`);
  expect(await scan()).toEqual([]);
  // With the custom menu open too.
  await caretAtStart(page);
  await button(page, "Insert").click();
  await expect(page.getByRole("menu", { name: "Insert" })).toBeVisible();
  expect(await scan()).toEqual([]);
});

test("mouse: a custom item runs its command, is disabled by its dry run, keeps the focus in the document", async ({
  page,
}) => {
  await caretAtStart(page);
  await expect(button(page, "Approve")).not.toHaveAttribute("aria-disabled");
  await button(page, "Approve").click();
  await expect(paragraph(page, 0)).toHaveText("[APPROVED]Review this text.");
  await expect(editor(page)).toBeFocused();
  // Typing goes on at the caret.
  await page.keyboard.type(" ");
  await expect(paragraph(page, 0)).toHaveText("[APPROVED] Review this text.");

  // Over a selection the command does not apply: the dry run disables the button.
  await page.keyboard.press("End");
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft");
  await expect(button(page, "Approve")).toHaveAttribute("aria-disabled", "true");
  // aria-disabled, still focusable and clickable: the click does nothing.
  await button(page, "Approve").click({ force: true });
  await expect(paragraph(page, 0)).toHaveText("[APPROVED] Review this text.");

  // A custom toggle: pressed after its command, the selection kept.
  await expect(button(page, "Cross out")).toHaveAttribute("aria-pressed", "false");
  await button(page, "Cross out").click();
  await expect(button(page, "Cross out")).toHaveAttribute("aria-pressed", "true");
  await expect(editor(page)).toBeFocused();
  expect(await page.evaluate(() => String(getSelection()))).toBe("text.");
  await expect(paragraph(page, 0).locator('span[style*="line-through"]')).toHaveText("text.");

  // Undo from the toolbar, then the button outside it (`useCommand`).
  await button(page, "Undo").click();
  await expect(button(page, "Cross out")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Sign" })).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: "Sign" })).toBeEnabled();
  await page.getByRole("button", { name: "Sign" }).click();
  await expect(paragraph(page, 0)).toHaveText("[APPROVED] Review this text.[SIGNED]");
});

test("keyboard only: arrows to a custom item, Enter runs it, its menu by ArrowDown", async ({
  page,
}) => {
  await caretAtStart(page);
  // The app's Sign button sits between the toolbar and the pages.
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Sign" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(button(page, "Undo")).toBeFocused();
  // One tab stop: End goes to the last item, arrows wrap.
  await page.keyboard.press("End");
  await expect(button(page, "Insert")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(button(page, "Undo")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(button(page, "Approve")).toBeFocused();
  await expect(button(page, "Approve")).toHaveCSS("outline-style", /solid|auto/);
  await page.keyboard.press("Enter");
  await expect(paragraph(page, 0)).toHaveText("[APPROVED]Review this text.");
  // Keyboard activation keeps the focus on the item.
  await expect(button(page, "Approve")).toBeFocused();

  // The menu: ArrowDown opens it on its first entry, Escape back to its button.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "Insert" });
  await expect(menu.getByRole("menuitem", { name: "Draft stamp" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(button(page, "Insert")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(paragraph(page, 0)).toHaveText("[APPROVED][DRAFT]Review this text.");
  await expect(button(page, "Insert")).toBeFocused();

  // Tab goes back to the document (past the app's button), where the caret was.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("!");
  await expect(paragraph(page, 0)).toHaveText("[APPROVED][DRAFT]!Review this text.");
});
