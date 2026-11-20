/**
 * The success criterion on apps that install Foli from its packed tarballs (`pnpm examples`):
 * type, format with a shortcut, undo, serialize, reload without loss. Also: no console errors
 * (hydration included), and the server HTML of the Next.js app holds the editor's shell. Runs on
 * the React apps (`vite`, `next`) and the framework-free one (`vanilla`, its own buttons).
 */
import { expect, type Page, test } from "@playwright/test";

const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
/** The bold text shown (Word's run formatting is inline CSS on the text's spans). */
const bold = (page: Page) =>
  editor(page).evaluate((host) =>
    [...host.querySelectorAll('span[style*="font-weight: 700"]')]
      .map((span) => span.textContent)
      .join(""),
  );

test("type, format with a shortcut, undo, save, reload without loss", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(editor(page)).toHaveAttribute("contenteditable", "true");
  // FoliToolbar's (React) or the vanilla app's own buttons.
  await expect(page.getByRole("button", { name: "Bold", exact: true })).toBeVisible();
  await editor(page).click();
  await page.keyboard.type("Hello Foli");
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("ControlOrMeta+b");
  await expect.poll(() => bold(page)).toBe("Foli");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => bold(page)).toBe("");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(() => bold(page)).toBe("Foli");

  // Saved (serialized after a pause) and back after a reload.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("foli-example") ?? ""))
    .toContain('"bold"');
  const saved = JSON.parse(
    (await page.evaluate(() => localStorage.getItem("foli-example"))) ?? "null",
  );
  // Schema v5: Word's model, the page in twips (A4).
  expect(saved).toMatchObject({ schemaVersion: 5, section: { pageSize: { width: 11906 } } });
  await page.reload();
  await expect(editor(page)).toHaveText("Hello Foli");
  await expect.poll(() => bold(page)).toBe("Foli");
  expect(errors).toEqual([]);
});

test("the server HTML holds the editor's shell (Next.js)", async ({ request }, info) => {
  test.skip(!info.project.name.startsWith("next"), "server rendering: the Next.js example");
  const html = await (await request.get("/")).text();
  expect(html).toContain('role="toolbar"');
  expect(html).toContain('role="textbox"');
  expect(html).toContain('aria-label="Document"');
});

test("a document saved by 0.1.0 loads (schema v1 → v5); lists from the keyboard save as v5", async ({
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
  // A Word list paragraph: numbered, its bullet shown before the text.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("foli-example") ?? ""))
    .toContain('"numbering"');
  await expect(editor(page).locator("[contenteditable=false]")).toHaveCount(1);
  const saved = JSON.parse(
    (await page.evaluate(() => localStorage.getItem("foli-example"))) ?? "null",
  );
  expect(saved.schemaVersion).toBe(5);
  expect(saved.content.content[0]).toMatchObject({
    attrs: { numbering: { level: 0 } },
    content: [{ type: "text", text: "from 0.1.0" }],
  });
});
