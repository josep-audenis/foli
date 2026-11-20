/**
 * The extension example (`examples/extension`, from the packed tarballs): a custom inline node
 * inserted by a toolbar item and by the plugin's key, undone, a custom mark from a toolbar item,
 * the plugin's decorations, then saved to .docx and opened again with node and mark intact.
 * No console errors, axe-clean.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const mentions = (page: Page) => editor(page).locator(".acme-mention");
const topics = (page: Page) => editor(page).locator(".acme-topic");
const todos = (page: Page) => editor(page).locator(".acme-todo");

test("custom node, mark, plugin and toolbar items, through .docx and back", async ({
  page,
}, info) => {
  test.slow(); // axe takes several seconds per run in Firefox
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(editor(page)).toHaveAttribute("contenteditable", "true");
  await editor(page).click();
  await page.keyboard.type("Ask ");
  // The toolbar item, then the plugin's key: each inserts a mention drawn by its node view.
  await page.getByRole("button", { name: "@Ada", exact: true }).click();
  await expect(mentions(page)).toHaveCount(1);
  await expect(mentions(page)).toHaveText("@Ada Lovelace");
  await page.keyboard.type(" and ");
  await page.keyboard.press("ControlOrMeta+Shift+m");
  await expect(mentions(page)).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(mentions(page)).toHaveCount(1);

  // The mark from its toolbar item; the plugin's decorations on "TODO".
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" TODO budget");
  for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowLeft");
  const topic = page.getByRole("button", { name: "Finance", exact: true });
  await topic.click();
  await expect(topics(page)).toHaveText("budget");
  await expect(topic).toHaveAttribute("aria-pressed", "true");
  await expect(todos(page)).toHaveText("TODO");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // Saved as .docx, then opened in a fresh editor.
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save .docx" }).click();
  const file = info.outputPath("acme.docx");
  await (await downloading).saveAs(file);
  await page.reload();
  await expect(mentions(page)).toHaveCount(0);
  await page.getByLabel("Open .docx").setInputFiles(file);
  await expect(page.locator(".files").getByRole("status")).toHaveText("Opened acme.docx.");
  await expect(mentions(page)).toHaveCount(1);
  await expect(mentions(page)).toHaveText("@Ada Lovelace");
  await expect(topics(page)).toHaveText("budget");
  await expect(todos(page)).toHaveText("TODO");
  await expect(editor(page)).toContainText("Ask @Ada Lovelace");

  // A file that is no .docx: refused, the document kept.
  await page.getByLabel("Open .docx").setInputFiles({
    name: "bad.docx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("not a zip"),
  });
  await expect(page.locator(".files").getByRole("status")).toContainText("Not opened");
  await expect(mentions(page)).toHaveCount(1);
  expect(errors).toEqual([]);
});
