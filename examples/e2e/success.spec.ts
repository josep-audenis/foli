/**
 * The success criterion on apps that install Foli from its packed tarballs (`pnpm examples`):
 * type, format with a shortcut, undo, serialize, reload without loss. Also: no console errors
 * (hydration included), and the server HTML of the Next.js app holds the editor's shell.
 */
import { expect, type Page, test } from "@playwright/test";

const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });

test("type, format with a shortcut, undo, save, reload without loss", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(editor(page)).toHaveAttribute("contenteditable", "true");
  await expect(page.getByRole("toolbar", { name: "Formatting" })).toBeVisible();
  await editor(page).click();
  await page.keyboard.type("Hello Foli");
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("ControlOrMeta+b");
  await expect(editor(page).locator("strong")).toHaveText("Foli");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor(page).locator("strong")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(editor(page).locator("strong")).toHaveText("Foli");

  // Saved (serialized after a pause) and back after a reload.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("foli-example") ?? ""))
    .toContain('"bold"');
  const saved = JSON.parse(
    (await page.evaluate(() => localStorage.getItem("foli-example"))) ?? "null",
  );
  expect(saved).toMatchObject({
    schemaVersion: expect.any(Number),
    settings: { pageSize: { width: 210 } },
  });
  await page.reload();
  await expect(editor(page)).toHaveText("Hello Foli");
  await expect(editor(page).locator("strong")).toHaveText("Foli");
  expect(errors).toEqual([]);
});

test("the server HTML holds the editor's shell (Next.js)", async ({ request }, info) => {
  test.skip(!info.project.name.startsWith("next"), "server rendering: the Next.js example");
  const html = await (await request.get("/")).text();
  expect(html).toContain('role="toolbar"');
  expect(html).toContain('role="textbox"');
  expect(html).toContain('aria-label="Document"');
});

test("a document saved by 0.1.0 loads (schema v1 → v2); lists from the keyboard save as v2", async ({
  page,
}) => {
  await page.goto("/");
  // What 0.1.0 saved: schema v1, which the packages migrate on load.
  await page.evaluate(() =>
    localStorage.setItem(
      "foli-example",
      JSON.stringify({
        schemaVersion: 1,
        settings: {
          pageSize: { width: 210, height: 297 },
          margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
        },
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "from 0.1.0" }] }],
        },
      }),
    ),
  );
  await page.reload();
  await expect(editor(page)).toHaveText("from 0.1.0");
  await editor(page).click();
  await page.keyboard.press("End");
  await page.keyboard.press("ControlOrMeta+Shift+8");
  await expect(editor(page).locator("ul > li")).toHaveText("from 0.1.0");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("foli-example") ?? ""))
    .toContain('"bulletList"');
  const saved = JSON.parse(
    (await page.evaluate(() => localStorage.getItem("foli-example"))) ?? "null",
  );
  expect(saved.schemaVersion).toBe(2);
});
