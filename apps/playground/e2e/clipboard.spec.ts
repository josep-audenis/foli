import { readFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";

const STORAGE_KEY = "foli-playground-document";
const MOD = "ControlOrMeta";
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });

/**
 * The text a locator shows in `css` (Word's run formatting is inline CSS on the text's spans:
 * `font-weight: 700`, `font-style: italic`).
 */
const styledText = (locator: Locator, css: string) =>
  locator.evaluate(
    (element, wanted) =>
      [...element.querySelectorAll(`span[style*="${wanted}"]`)]
        .map((span) => span.textContent)
        .join(""),
    css,
  );
const texts = (page: Page) => editor(page).locator(":scope > .foli-page > *").allTextContents();

async function saved(page: Page): Promise<unknown[] | null> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  return raw ? JSON.parse(raw).content.content : null;
}

async function openEmpty(page: Page): Promise<void> {
  await page.goto("/");
  await editor(page).click();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press("Backspace");
  await expect.poll(() => texts(page)).toEqual([""]);
}

/** Dispatches a paste with the given clipboard types, as the browser would (deterministic). */
async function paste(page: Page, types: Record<string, string>): Promise<void> {
  await editor(page).evaluate((host, data) => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: (type: string) => data[type] ?? "", types: Object.keys(data) },
    });
    host.dispatchEvent(event);
  }, types);
}

const text = (value: string, ...marks: string[]) => ({
  type: "text",
  text: value,
  ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
});

test("copy and paste inside the editor keep blocks and marks", async ({ page, browserName }) => {
  // Measured: Playwright's WebKit on Windows lists the types in a paste event but getData()
  // returns "" for each. Safari copy/paste is in the manual checklist (docs/testing/ime.md).
  test.skip(browserName === "webkit", "no clipboard contents in Playwright WebKit paste events");
  await openEmpty(page);
  await page.keyboard.type("one ");
  await page.keyboard.press(`${MOD}+b`);
  await page.keyboard.type("two");
  await page.keyboard.press(`${MOD}+b`);
  await page.keyboard.press("Enter");
  await page.keyboard.type("three");
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press(`${MOD}+c`);
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.press(`${MOD}+v`);
  await expect.poll(() => texts(page)).toEqual(["one two", "threeone two", "three"]);
  await expect
    .poll(() => saved(page))
    .toEqual([
      { type: "paragraph", content: [text("one "), text("two", "bold")] },
      { type: "paragraph", content: [text("threeone "), text("two", "bold")] },
      { type: "paragraph", content: [text("three")] },
    ]);
});

test("cut removes the selection and paste puts it back", async ({ page, browserName }) => {
  // Measured: Playwright's WebKit on Windows lists the types in a paste event but getData()
  // returns "" for each. Safari copy/paste is in the manual checklist (docs/testing/ime.md).
  test.skip(browserName === "webkit", "no clipboard contents in Playwright WebKit paste events");
  await openEmpty(page);
  await page.keyboard.type("abcdef");
  for (let i = 0; i < 2; i++) await page.keyboard.press("ArrowLeft");
  for (let i = 0; i < 2; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press(`${MOD}+x`);
  await expect.poll(() => texts(page)).toEqual(["abef"]);
  await page.keyboard.press("Home");
  await page.keyboard.press(`${MOD}+v`);
  await expect.poll(() => texts(page)).toEqual(["cdabef"]);
});

test("pasting Word HTML maps it to the schema", async ({ page }) => {
  await openEmpty(page);
  const html = readFileSync("packages/view/fixtures/clipboard/word.html", "utf8");
  await paste(page, { "text/html": html, "text/plain": "ignored when HTML is readable" });
  await expect
    .poll(() => texts(page))
    .toEqual([
      "Quarterly report",
      "Revenue grew twelve percent and margins held.",
      "",
      // A list paragraph: its bullet is shown before the text.
      "\u2022First point",
      "Line oneline two  end",
    ]);
  await expect(editor(page).locator("h1")).toHaveText("Quarterly report");
  // In the body text (the heading is bold by its style).
  const body = editor(page).locator(".foli-page > p").first();
  await expect.poll(() => styledText(body, "font-weight: 700")).toBe("twelve percent");

  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => texts(page)).toEqual([""]);
});

test("pasted HTML never runs scripts or loads images", async ({ page }) => {
  await openEmpty(page);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.evaluate(() => {
    (window as unknown as { pwned: boolean }).pwned = false;
  });
  await paste(page, {
    "text/html":
      '<p>safe<img src="/should-not-load.png" onerror="window.pwned=true"><script>window.pwned=true</script></p>',
  });
  await expect.poll(() => texts(page)).toEqual(["safe"]);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { pwned: boolean }).pwned)).toBe(false);
  expect(requests.filter((url) => url.includes("should-not-load"))).toEqual([]);
  await expect(editor(page).locator("img, script")).toHaveCount(0);
});

test("pasting Google Docs lists keeps nesting, numbering, links, colors, rules and alignment", async ({
  page,
}) => {
  await openEmpty(page);
  const html = readFileSync("packages/view/fixtures/clipboard/google-docs-lists.html", "utf8");
  await paste(page, { "text/html": html, "text/plain": "Alpha" });
  const content = editor(page);
  // Word's lists: numbered paragraphs, each showing its bullet or number.
  const markers = () =>
    content.evaluate((host) =>
      [...host.querySelectorAll(".foli-page > p")].map((p) => {
        const shown = p.querySelector(":scope > [contenteditable=false]");
        return shown
          ? `${(shown.textContent ?? "").trim()} ${p.textContent?.slice(shown.textContent?.length ?? 0)}`
          : null;
      }),
    );
  const numbered = (await markers()).filter((m): m is string => m !== null);
  expect(numbered.map((m) => m.split(" ")[0])).toEqual(["\u2022", "o", "\u2022", "2."]);
  expect(numbered[3]).toBe("2. Two");
  await expect(content.getByRole("link", { name: "a link" })).toHaveAttribute(
    "href",
    "https://example.com/x",
  );
  // The rule: an empty paragraph with a bottom border, as in Word.
  await expect(content.locator('.foli-page > p[style*="border-bottom"]')).toHaveCount(1);
  await expect(content.locator(".foli-page > p").filter({ hasText: "Beta" })).toHaveCSS(
    "text-align",
    "center",
  );
  await expect(content.locator("span", { hasText: "Red" })).toHaveCSS("color", "rgb(255, 0, 0)");
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => texts(page)).toEqual([""]);
});
