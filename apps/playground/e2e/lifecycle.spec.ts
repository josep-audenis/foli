import { expect, type Page, test } from "@playwright/test";
import { FIXTURES, stored } from "./fixtures.js";

const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const pages = (page: Page) => editor(page).locator(":scope > .foli-page");
/** Opens a file the way a user does: the "Open…" button, then the browser's file chooser. */
async function open(page: Page, name: string, body: string): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name, mimeType: "application/json", buffer: Buffer.from(body) });
}

const letter = FIXTURES.find((fixture) => fixture.name === "different-margins");
if (!letter) throw new Error("fixture missing");
const LETTER_WIDTH_PX = (215.9 * 96) / 25.4;

test("opening a document replaces content, page size and history; it is saved", async ({
  page,
}) => {
  await page.goto("/");
  await editor(page).click();
  await page.keyboard.type("unsaved edit ");
  // Far down a long page: opening must bring the new document's start (the caret) into view.
  await page.evaluate(() => {
    document.body.style.paddingBottom = "3000px";
    window.scrollTo(0, document.body.scrollHeight);
  });
  await open(page, "letter.json", JSON.stringify(stored(letter.settings, letter.blocks)));
  await expect(editor(page).locator(":scope > .foli-page > *").first()).toBeInViewport();

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
  // Undo reaches the opened document and stops there.
  for (let i = 0; i < 3; i++) await page.keyboard.press("ControlOrMeta+z");
  await expect(editor(page)).not.toContainText("Opened");
  await expect(editor(page)).toContainText("US Letter, uneven margins");
  await expect(editor(page)).not.toContainText("unsaved edit");
  await expect(undo).toHaveAttribute("aria-disabled", "true");

  await page.reload();
  await expect(editor(page)).toContainText("US Letter, uneven margins");
});

for (const [name, body, reason] of [
  ["not-json.json", "{ this is not JSON", /JSON/i],
  [
    "bad-node.json",
    JSON.stringify(stored(letter.settings, [{ type: "nope", content: [] }])),
    /nope/,
  ],
] as const) {
  test(`a file that is not a Foli document is refused and changes nothing (${name})`, async ({
    page,
  }) => {
    await page.goto("/");
    const message = new Promise<string>((resolve) =>
      page.once("dialog", (dialog) => {
        resolve(dialog.message());
        void dialog.accept();
      }),
    );
    await open(page, name, body);
    const text = await message;
    expect(text.startsWith(`Could not open ${name}:`)).toBe(true);
    expect(text).toMatch(reason);
    await expect(editor(page)).toContainText("Foli Playground");
  });
}
