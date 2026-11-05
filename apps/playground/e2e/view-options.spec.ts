import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const STORAGE_KEY = "foli-playground-document";
const MOD = "ControlOrMeta";

const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const readOnly = (page: Page) => page.getByRole("checkbox", { name: "Read-only" });
const texts = (page: Page) => editor(page).locator(":scope > *").allTextContents();

/** The placeholder text CSS shows on the first block, or "" when there is none. */
const placeholderShown = (page: Page) =>
  editor(page)
    .locator(":scope > :first-child")
    .evaluate((block) => {
      const content = getComputedStyle(block, "::before").content;
      // Drop the alternative text ("…" / "") where the engine reports it.
      return content === "none" || content === "normal" ? "" : content.split(" / ")[0];
    });

async function openEmpty(page: Page): Promise<void> {
  await page.goto("/");
  await editor(page).click();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press("Backspace");
  await expect.poll(() => texts(page)).toEqual([""]);
}

async function axe(page: Page, disabled: string[] = []): Promise<string[]> {
  const results = await new AxeBuilder({ page }).disableRules(disabled).analyze();
  return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`);
}

test("the playground has no axe violations: editable, read-only and empty", async ({ page }) => {
  test.slow(); // axe takes several seconds per run in Firefox
  await page.goto("/");
  await expect(editor(page)).toContainText("Foli Playground");
  expect(await axe(page)).toEqual([]);
  await readOnly(page).check();
  await expect(editor(page)).toHaveAttribute("aria-readonly", "true");
  expect(await axe(page)).toEqual([]);
  await readOnly(page).uncheck();
  await openEmpty(page);
  // The heading is the sample document's: an emptied document has none.
  expect(await axe(page, ["page-has-heading-one"])).toEqual([]);
});

test("the editor is a labelled multi-line textbox of semantic blocks", async ({ page }) => {
  await page.goto("/");
  const host = editor(page);
  await expect(host).toHaveAttribute("aria-multiline", "true");
  await expect(host).toHaveAttribute("aria-placeholder", "Start writing…");
  await expect(host).not.toHaveAttribute("aria-readonly", /.*/);
  await expect(host.getByRole("heading", { level: 1, name: "Foli Playground" })).toBeVisible();
  await expect(host.getByRole("paragraph").first()).toContainText("Edited by Foli");
});

test("read-only mode keeps the document unchanged and still copies", async ({ page }) => {
  await page.goto("/");
  const before = await texts(page);
  await readOnly(page).check();
  await expect(editor(page)).toHaveAttribute("contenteditable", "false");

  await editor(page).getByRole("heading").click();
  for (const key of ["x", "Enter", "Backspace", "Delete", `${MOD}+b`, `${MOD}+z`]) {
    await page.keyboard.press(key);
  }
  await page.keyboard.type("typed");
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "pasted");
    document
      .querySelector(".foli-content h1")
      ?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  });
  expect(await texts(page)).toEqual(before);
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull();

  // The text stays selectable, and a real copy writes the model's content.
  await page.evaluate(() => {
    document.addEventListener("copy", (event) => {
      const data = event.clipboardData;
      (window as unknown as { copied: unknown }).copied = {
        text: data?.getData("text/plain"),
        json: data?.getData("application/x-foli+json"),
      };
    });
  });
  // Drag across "Foli" (a double-click at the heading's centre lands past its text).
  const word = await editor(page)
    .getByRole("heading")
    .evaluate((h1) => {
      const range = document.createRange();
      range.setStart(h1.firstChild as Text, 0);
      range.setEnd(h1.firstChild as Text, 4);
      const { left, right, top, height } = range.getBoundingClientRect();
      return { left, right, y: top + height / 2 };
    });
  await page.mouse.move(word.left + 1, word.y);
  await page.mouse.down();
  await page.mouse.move(word.right, word.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press(`${MOD}+c`);
  const copied = await page.evaluate(
    () => (window as unknown as { copied?: { text: string; json: string } }).copied,
  );
  expect(copied?.text).toBe("Foli");
  expect(copied?.json).toContain('"Foli');

  // Editable again: typing works.
  await readOnly(page).uncheck();
  await expect(editor(page)).toHaveAttribute("contenteditable", "true");
  await editor(page).getByRole("heading").click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await expect.poll(async () => (await texts(page))[0]).toBe("Foli Playground!");
});

test("read-only mode reached by keyboard: focusable, Mod+A selects only the document", async ({
  page,
}) => {
  await page.goto("/");
  await readOnly(page).check();
  await page.keyboard.press("Tab"); // checkbox → Reset
  await page.keyboard.press("Tab"); // Reset → editor
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press(`${MOD}+a`);
  const selected = await page.evaluate(() => String(getSelection()));
  expect(selected).toContain("Foli Playground");
  expect(selected).not.toContain("Reset");
});

test("the placeholder shows only while the document is empty", async ({ page }) => {
  await page.goto("/");
  expect(await placeholderShown(page)).toBe("");
  await openEmpty(page);
  expect(await placeholderShown(page)).toBe('"Start writing…"');
  // Not part of the text: the caret sits at the start of the line, and typing replaces it.
  const caretLeft = await page.evaluate(() => {
    const range = getSelection()?.getRangeAt(0);
    const block = document.querySelector(".foli-content > *");
    const rect =
      range?.getClientRects()[0] ??
      range?.startContainer.childNodes[0]?.parentElement?.getBoundingClientRect();
    return rect && block ? rect.left - block.getBoundingClientRect().left : null;
  });
  expect(caretLeft).not.toBeNull();
  expect(Math.abs(caretLeft as number)).toBeLessThan(4);
  await page.keyboard.type("a");
  expect(await placeholderShown(page)).toBe("");
  await expect.poll(() => texts(page)).toEqual(["a"]);
  await page.keyboard.press("Backspace");
  await expect.poll(() => texts(page)).toEqual([""]);
  expect(await placeholderShown(page)).toBe('"Start writing…"');
  // Two empty blocks are not an empty document.
  await page.keyboard.press("Enter");
  expect(await placeholderShown(page)).toBe("");
});

test("Tab back into the editor keeps the caret where it was", async ({ page }) => {
  await openEmpty(page);
  await page.keyboard.type("abc");
  await page.keyboard.press("ArrowLeft");
  // Selecting text elsewhere moves the page selection out of the editor.
  await page.locator(".playground-hint").dblclick();
  await page.locator(".playground-bar button").focus();
  await page.keyboard.press("Tab");
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("X");
  await expect.poll(() => texts(page)).toEqual(["abXc"]);

  // A click still puts the caret where it lands.
  await page.locator(".playground-hint").dblclick();
  const box = await editor(page).locator(":scope > *").first().boundingBox();
  if (!box) throw new Error("no block box");
  await page.mouse.click(box.x + 1, box.y + box.height / 2);
  await page.keyboard.type("Y");
  await expect.poll(() => texts(page)).toEqual(["YabXc"]);
});
