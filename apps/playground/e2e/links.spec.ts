import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/** Links (task 7.6): the link dialog, Ctrl/Cmd+click, autolink on paste. */

const STORAGE_KEY = "foli-playground-document";
const MOD = "ControlOrMeta";
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const dialog = (page: Page) => page.getByRole("dialog");
const url = (page: Page) => dialog(page).getByRole("textbox", { name: "URL" });

async function saved(page: Page): Promise<unknown[] | null> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  return raw ? JSON.parse(raw).content.content : null;
}

/** An empty document with `text` typed in, the caret at its end. */
async function openWith(page: Page, text: string): Promise<void> {
  await page.goto("/");
  await editor(page).click();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press("Backspace");
  await page.keyboard.type(text);
  await expect(editor(page)).toHaveText(text);
}

const linked = (text: string, href: string) => ({
  type: "text",
  text,
  marks: [{ type: "link", attrs: { href } }],
});

test("Mod-K opens the link dialog; the link applies, and Ctrl/Cmd+click opens it", async ({
  page,
}) => {
  await page
    .context()
    .route("https://example.test/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<p>opened</p>" }),
    );
  await openWith(page, "visit site");
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press(`${MOD}+k`);
  await expect(dialog(page)).toHaveAccessibleName("Add link");
  await expect(url(page)).toBeFocused();
  // An unsafe URL is refused with an announced message; the dialog stays.
  await page.keyboard.type("javascript:alert(1)");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(url(page)).toHaveAttribute("aria-invalid", "true");
  await url(page).fill("example.test/page");
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
  const link = editor(page).locator("a");
  await expect(link).toHaveText("site");
  await expect(link).toHaveAttribute("href", "https://example.test/page");
  await expect
    .poll(() => saved(page))
    .toEqual([
      {
        type: "paragraph",
        content: [{ type: "text", text: "visit " }, linked("site", "https://example.test/page")],
      },
    ]);

  // A plain click places the caret: no navigation, no new tab.
  const start = page.url();
  await link.click();
  await expect(page).toHaveURL(start);
  expect(page.context().pages()).toHaveLength(1);

  // Ctrl/Cmd+click opens it in a new tab, without access to this page.
  const opened = page.context().waitForEvent("page");
  await link.click({ modifiers: ["ControlOrMeta"] });
  const popup = await opened;
  await popup.waitForLoadState();
  expect(popup.url()).toBe("https://example.test/page");
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await expect(page).toHaveURL(start);
});

test("the link dialog edits, removes, cancels with Escape, and has no axe violations", async ({
  page,
}) => {
  test.slow(); // axe takes several seconds per run in Firefox
  await openWith(page, "a word here");
  await page.keyboard.press("Home");
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
  // Through the toolbar button, by keyboard: the focus comes back to the button.
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  const button = page.getByRole("toolbar").getByRole("button", { name: "Link" });
  await button.click();
  await expect(url(page)).toBeFocused();
  const violations = (await new AxeBuilder({ page }).include(".foli-link-dialog").analyze())
    .violations;
  expect(violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.type("https://a.test");
  await page.keyboard.press("Enter");
  await expect(editor(page).locator("a")).toHaveText("word");
  await expect(button).toHaveAttribute("aria-pressed", "true");

  // Edit: the caret in the link, Mod-K shows its URL.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press(`${MOD}+k`);
  await expect(dialog(page)).toHaveAccessibleName("Edit link");
  await expect(url(page)).toHaveValue("https://a.test");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press(`${MOD}+k`);
  await url(page).fill("https://b.test");
  await page.keyboard.press("Enter");
  await expect(editor(page).locator("a")).toHaveAttribute("href", "https://b.test");

  await page.keyboard.press(`${MOD}+k`);
  await dialog(page).getByRole("button", { name: "Remove link" }).click();
  await expect(editor(page).locator("a")).toHaveCount(0);
  await expect(editor(page)).toHaveText("a word here");
});

test("pasting a URL makes a link", async ({ page, browserName }) => {
  // Measured: Playwright's WebKit on Windows lists the types in a paste event but getData()
  // returns "" for each (clipboard.spec.ts); the synthetic paste below reads them in all three.
  test.skip(browserName === "webkit", "no clipboard contents in Playwright WebKit paste events");
  await openWith(page, "see ");
  await editor(page).evaluate((host) => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        getData: (type: string) => (type === "text/plain" ? "www.example.test" : ""),
        types: ["text/plain"],
      },
    });
    host.dispatchEvent(event);
  });
  const link = editor(page).locator("a");
  await expect(link).toHaveText("www.example.test");
  await expect(link).toHaveAttribute("href", "https://www.example.test");
  // Typing after it is not linked.
  await page.keyboard.type("!");
  await expect(link).toHaveText("www.example.test");
});
