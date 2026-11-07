import { expect, type Page, test } from "@playwright/test";
import { FIXTURES, stored } from "./fixtures.js";

const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const pages = (page: Page) => editor(page).locator(":scope > .foli-page");
const open = (page: Page, name: string, body: string) =>
  page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(body),
  });

const letter = FIXTURES.find((fixture) => fixture.name === "different-margins");
if (!letter) throw new Error("fixture missing");
const LETTER_WIDTH_PX = (215.9 * 96) / 25.4;

test("opening a document replaces content, page size and history; it is saved", async ({
  page,
}) => {
  await page.goto("/");
  await editor(page).click();
  await page.keyboard.type("unsaved edit ");
  await open(page, "letter.json", JSON.stringify(stored(letter.settings, letter.blocks)));

  await expect(editor(page)).toContainText("US Letter, uneven margins");
  await expect(editor(page)).not.toContainText("unsaved edit");
  await expect.poll(() => pages(page).count()).toBeGreaterThan(1);
  const width = await pages(page)
    .first()
    .evaluate((sheet) => sheet.getBoundingClientRect().width);
  expect(Math.abs(width - LETTER_WIDTH_PX)).toBeLessThan(1);
  // Every page holds its content: the new margins and size were applied before the flow.
  const overflow = await pages(page).evaluateAll((sheets) =>
    sheets.map((sheet) => sheet.scrollHeight - sheet.clientHeight),
  );
  for (const extra of overflow) expect(extra).toBeLessThanOrEqual(1);

  // A fresh history: undo cannot bring the old document back.
  const undo = page.getByRole("toolbar").getByRole("button", { name: "Undo" });
  await expect(undo).toHaveAttribute("aria-disabled", "true");
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("Opened: ");
  await expect(editor(page)).toContainText("Opened: US Letter");
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor(page)).toContainText("US Letter, uneven margins");
  await expect(editor(page)).not.toContainText("unsaved edit");

  await page.reload();
  await expect(editor(page)).toContainText("US Letter, uneven margins");
});

test("a file that is not a Foli document is refused and changes nothing", async ({ page }) => {
  await page.goto("/");
  const message = new Promise<string>((resolve) =>
    page.once("dialog", (dialog) => {
      resolve(dialog.message());
      void dialog.accept();
    }),
  );
  await open(page, "broken.json", '{"schemaVersion": 1, "content": {"type": "nope"}}');
  expect(await message).toMatch(/^Could not open broken\.json:/);
  await expect(editor(page)).toContainText("Foli Playground");
});
