/**
 * The comments pane (9.7) on the editing page (`/edit.html`): a comment made from the toolbar and
 * written in the pane, next to its text; reply, resolve, delete and undo; keyboard use; axe;
 * not printed.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

type Json = Record<string, unknown>;
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const pane = (page: Page) => page.getByRole("complementary", { name: "Comments" });
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Formatting" });

function documentOf(blocks: Json[], comments: Json[] = []): Json {
  return {
    schemaVersion: 3,
    section: {
      pageSize: { width: 11906, height: 16838 },
      margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
    },
    defaults: {},
    styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
    numbering: { abstracts: [], instances: [] },
    comments,
    content: { type: "doc", content: blocks },
  };
}
const paragraph = (...content: Json[]): Json => ({ type: "paragraph", content });
const text = (value: string): Json => ({ type: "text", text: value });
const anchor = (type: string, id: number): Json => ({ type, attrs: { id } });

async function open(page: Page, blocks: Json[], comments: Json[] = []): Promise<void> {
  await page.goto("/edit.html");
  await page.waitForFunction(() => "foliEdit" in window);
  await page.evaluate((doc) => window.foliEdit.load(doc as never), documentOf(blocks, comments));
  await editor(page).focus();
}
const comments = (page: Page) =>
  page.evaluate(() =>
    window.foliEdit.editor.getDocument().comments.map((c) => ({
      author: c.author,
      parent: c.parent,
      done: c.done ?? false,
      text: c.content.map((p) => (p.content ?? []).map((n) => n.text ?? "").join("")).join("\n"),
    })),
  );

test("a comment made from the toolbar is written in the pane, next to its text", async ({
  page,
}) => {
  const many = Array.from({ length: 6 }, (_, i) => paragraph(text(`Paragraph ${i + 1} text.`)));
  await open(page, many);
  // "text" in the fifth paragraph.
  await page.evaluate(() => {
    const doc = window.foliEdit.editor.state.doc;
    let from = 0;
    doc.forEach((block, offset, index) => {
      if (index === 4) from = offset + 1 + "Paragraph 5 ".length;
    });
    window.foliEdit.editor.select(from, from + 4);
  });
  await toolbar(page).getByRole("button", { name: "New comment" }).click();
  const field = pane(page).getByRole("textbox", { name: "Comment" });
  await expect(field).toBeFocused();
  await page.keyboard.type("Is this the right text?");
  await page.keyboard.press("ControlOrMeta+Enter");
  expect(await comments(page)).toEqual([
    { author: "Foli user", parent: undefined, done: false, text: "Is this the right text?" },
  ]);
  // The thread's top is level with its text.
  const thread = pane(page).getByRole("article");
  const commented = editor(page).locator('[data-foli-comments~="0"]').first();
  const [threadBox, textBox] = [await thread.boundingBox(), await commented.boundingBox()];
  expect(Math.abs((threadBox?.y ?? 0) - (textBox?.y ?? 1e9))).toBeLessThan(4);
  // Focusing the thread marks its text.
  await thread.getByRole("button", { name: "Reply" }).focus();
  await expect(commented).toHaveClass(/foli-comment-active/);
});

test("reply, resolve, delete from the keyboard, and undo in the document", async ({ page }) => {
  await open(
    page,
    [
      paragraph(
        text("Hello "),
        anchor("commentStart", 0),
        text("world"),
        anchor("commentEnd", 0),
        anchor("commentReference", 0),
      ),
    ],
    [{ id: 0, author: "Ana", content: [paragraph(text("Which world?"))] }],
  );
  // From the document, Escape then Tab goes on into the pane (Tab alone types a tab).
  await editor(page).focus();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  await expect(pane(page).getByRole("button", { name: "Reply" })).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.type("This one.");
  await page.keyboard.press("ControlOrMeta+Enter");
  await pane(page).getByRole("button", { name: "Resolve" }).click();
  expect(await comments(page)).toEqual([
    { author: "Ana", parent: undefined, done: true, text: "Which world?" },
    // Resolving marks the whole thread, as Word does.
    { author: "Foli user", parent: 0, done: true, text: "This one." },
  ]);
  await expect(pane(page).getByRole("article")).toHaveAttribute("data-done", "true");
  await pane(page).getByRole("button", { name: "Delete" }).first().click();
  expect(await comments(page)).toEqual([]);
  await expect(editor(page).locator("[data-foli-comments]")).toHaveCount(0);
  await editor(page).focus();
  await page.keyboard.press("ControlOrMeta+z");
  expect((await comments(page)).map((c) => c.text)).toEqual(["Which world?", "This one."]);
});

test("the pane has no axe violations and is not printed", async ({ page }) => {
  test.slow(); // axe takes several seconds per run in Firefox
  await open(
    page,
    [
      paragraph(
        anchor("commentStart", 0),
        text("Hi"),
        anchor("commentEnd", 0),
        anchor("commentReference", 0),
      ),
    ],
    [{ id: 0, author: "Ana", content: [paragraph(text("A note"))] }],
  );
  const violations = (await new AxeBuilder({ page }).include("#comments").analyze()).violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`,
  );
  expect(violations).toEqual([]);
  await page.emulateMedia({ media: "print" });
  await expect(pane(page)).toBeHidden();
});
