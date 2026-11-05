import { type CDPSession, expect, type Page, test } from "@playwright/test";

// Real IME and dead keys need real platforms: see docs/testing/ime.md. This drives Chromium's
// IME emulation (CDP), which mutates the DOM like a composition does, and checks the read-back.
test.skip(({ browserName }) => browserName !== "chromium", "CDP IME emulation is Chromium-only");

const MOD = "ControlOrMeta";
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const texts = (page: Page) => editor(page).locator(":scope > .foli-page > *").allTextContents();

/** Opens an empty document; returns a CDP session and the console warnings seen so far. */
async function openEmpty(page: Page): Promise<{ cdp: CDPSession; warnings: string[] }> {
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning") warnings.push(message.text());
  });
  await page.goto("/");
  await editor(page).click();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press("Backspace");
  await expect.poll(() => texts(page)).toEqual([""]);
  return { cdp: await page.context().newCDPSession(page), warnings };
}

/** Composes each step in turn, then commits `commit`. */
async function compose(cdp: CDPSession, steps: string[], commit: string): Promise<void> {
  for (const text of steps) {
    await cdp.send("Input.imeSetComposition", {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
    });
  }
  await cdp.send("Input.insertText", { text: commit });
}

test("an IME composition is committed into the model and undone in one step", async ({ page }) => {
  const { cdp, warnings } = await openEmpty(page);
  await page.keyboard.type("Hello ");
  await page.waitForTimeout(600); // close the typing history group
  await compose(cdp, ["に", "にほ", "にほん"], "日本");
  await expect.poll(() => texts(page)).toEqual(["Hello 日本"]);

  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => texts(page)).toEqual(["Hello "]);
  await page.keyboard.press(`${MOD}+y`);
  await expect.poll(() => texts(page)).toEqual(["Hello 日本"]);
  await page.keyboard.type("!");
  await expect.poll(() => texts(page)).toEqual(["Hello 日本!"]);
  expect(warnings).toEqual([]);
});

test("a dead-key style composition in the middle of bold text keeps the mark", async ({ page }) => {
  const { cdp, warnings } = await openEmpty(page);
  await page.keyboard.press(`${MOD}+b`);
  await page.keyboard.type("caf");
  await page.keyboard.type("!");
  await page.keyboard.press("ArrowLeft");
  await compose(cdp, ["´"], "é");
  await expect.poll(() => texts(page)).toEqual(["café!"]);
  await expect(editor(page).locator("strong")).toHaveText("café!");

  await page.keyboard.type("s");
  await expect.poll(() => texts(page)).toEqual(["cafés!"]);
  expect(warnings).toEqual([]);
});

test("a composition over a selection across paragraphs replaces it", async ({ page }) => {
  const { cdp, warnings } = await openEmpty(page);
  await page.keyboard.type("one");
  await page.keyboard.press("Enter");
  await page.keyboard.type("two");
  await page.waitForTimeout(600);
  await page.keyboard.press(`${MOD}+Home`);
  await page.keyboard.press("ArrowRight");
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
  await compose(cdp, ["あ"], "亜");
  await expect.poll(() => texts(page)).toEqual(["o亜o"]);

  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => texts(page)).toEqual(["one", "two"]);
  expect(warnings).toEqual([]);
});
