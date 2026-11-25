/**
 * Tracked changes in the view (9.5), on the editing page (`/edit.html`): recording typing and
 * deletion from the keyboard, the review views, going to, accepting and rejecting changes from
 * the toolbar, undo; axe on the toolbar and pages with changes. The document is read from the
 * editor itself.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

type Json = Record<string, unknown>;
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Formatting" });
const button = (page: Page, name: string) =>
  toolbar(page).getByRole("button", { name, exact: true });

function documentOf(blocks: Json[]): Json {
  return {
    schemaVersion: 3,
    section: {
      pageSize: { width: 11906, height: 16838 },
      margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
    },
    defaults: {},
    styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
    numbering: { abstracts: [], instances: [] },
    comments: [],
    content: { type: "doc", content: blocks },
  };
}
const paragraph = (text: string): Json => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

async function open(page: Page, blocks: Json[]): Promise<void> {
  await page.goto("/edit.html?toolbar");
  await page.waitForFunction(() => "foliEdit" in window);
  await page.evaluate((doc) => window.foliEdit.load(doc as never), documentOf(blocks));
  await editor(page).focus();
}

/** Each paragraph's runs as `text`, `+text` (inserted) or `-text` (deleted). */
const runs = (page: Page) =>
  page.evaluate(() =>
    (window.foliEdit.editor.getDocument().content.content ?? []).map((p) =>
      (p.content ?? []).map((n) => {
        const types = (n.marks ?? []).map((m) => m.type);
        const sign = types.includes("deletion") ? "-" : types.includes("insertion") ? "+" : "";
        return `${sign}${n.text ?? ""}`;
      }),
    ),
  );
const placeCaret = (page: Page, pos: number) =>
  page.evaluate((at) => window.foliEdit.editor.select(at), pos);

test("records typing and deletion from the keyboard; undo takes them back", async ({ page }) => {
  await open(page, [paragraph("Hello world")]);
  await button(page, "Track changes").click();
  await expect(button(page, "Track changes")).toHaveAttribute("aria-pressed", "true");
  await editor(page).focus();
  await placeCaret(page, 6);
  await page.keyboard.type(" big");
  await placeCaret(page, 16);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  expect(await runs(page)).toEqual([["Hello", "+ big", " wor", "-ld"]]);
  await expect(editor(page).locator("ins")).toHaveText(" big");
  await expect(editor(page).locator("del")).toHaveText("ld");
  // Backspace steps over what is already deleted.
  await placeCaret(page, 17);
  await page.keyboard.press("Backspace");
  expect(await runs(page)).toEqual([["Hello", "+ big", " wo", "-rld"]]);
  for (let i = 0; i < 6; i++) await page.keyboard.press("ControlOrMeta+z");
  expect(await runs(page)).toEqual([["Hello world"]]);
});

test("shows changes as all markup, simple markup or no markup, and keeps editing", async ({
  page,
}) => {
  await open(page, [paragraph("Hello world")]);
  await button(page, "Track changes").click();
  await editor(page).focus();
  await placeCaret(page, 12);
  await page.keyboard.press("Backspace");
  await page.keyboard.type("D");
  const del = editor(page).locator("del");
  await expect(del).toBeVisible();
  const show = toolbar(page).getByRole("combobox", { name: "Show changes as" });
  await show.selectOption("simple");
  await expect(del).toBeHidden();
  await show.selectOption("final");
  await expect(del).toBeHidden();
  await expect(editor(page)).toContainText("Hello worlD");
  // Typing goes on where the caret is, after what the final text shows.
  await editor(page).focus();
  await page.keyboard.type("!");
  // Backspace left the caret before the deleted "d": what is typed goes there, as in Word.
  expect(await runs(page)).toEqual([["Hello worl", "+D!", "-d"]]);
  await show.selectOption("markup");
  await expect(del).toBeVisible();
});

test("goes to, accepts and rejects changes from the toolbar", async ({ page }) => {
  await open(page, [paragraph("One two three")]);
  await button(page, "Track changes").click();
  await editor(page).focus();
  await placeCaret(page, 4);
  await page.keyboard.type(" and");
  await placeCaret(page, 18);
  await page.keyboard.press("Backspace");
  await placeCaret(page, 0);
  await button(page, "Next change").click();
  await button(page, "Reject").click();
  expect(await runs(page)).toEqual([["One two thre", "-e"]]);
  await button(page, "Undo").click();
  expect(await runs(page)).toEqual([["One", "+ and", " two thre", "-e"]]);
  await button(page, "Accept all").click();
  expect(await runs(page)).toEqual([["One and two thre"]]);
  await button(page, "Undo").click();
  await button(page, "Reject all").click();
  expect(await runs(page)).toEqual([["One two three"]]);
});

test("the review controls and pages with changes have no axe violations", async ({ page }) => {
  test.slow(); // axe takes several seconds per run in Firefox
  await open(page, [paragraph("Hello world")]);
  await button(page, "Track changes").click();
  await editor(page).focus();
  await placeCaret(page, 6);
  await page.keyboard.type(" big");
  await placeCaret(page, 15);
  await page.keyboard.press("Backspace");
  const scan = async (selector: string) =>
    (await new AxeBuilder({ page }).include(selector).analyze()).violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`,
    );
  expect(await scan(".foli-toolbar")).toEqual([]);
  // The pages (the playground's own host element is not under test).
  expect(await scan("#editor > .foli-page")).toEqual([]);
});
