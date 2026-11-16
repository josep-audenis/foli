/**
 * Inline pictures in the editable view (10.8b): the corpus's picture report (07) opened on the
 * editing page, its pictures drawn from the package's images at their size, laid out in their
 * lines, with the text around them editable.
 */
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });

async function open(page: Page, name: string): Promise<void> {
  await page.goto("/edit.html");
  await page.waitForFunction(() => "foliEdit" in window);
  const base64 = readFileSync(new URL(name, CORPUS)).toString("base64");
  await page.evaluate((data) => window.foliEdit.loadDocx(data), base64);
  await page.waitForFunction(() => document.querySelectorAll("section.foli-page").length >= 1);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

const pictures = (page: Page) => editor(page).locator("img[data-foli-picture]");

test("pictures are drawn from the package's images at their size, with their alt text", async ({
  page,
}) => {
  await open(page, "07-picture-report.docx");
  await expect(pictures(page)).toHaveCount(2);
  // Loaded (an object URL for the package's part), at 4572638 × 2667372 EMU.
  await expect
    .poll(() =>
      pictures(page).evaluateAll((imgs) =>
        (imgs as HTMLImageElement[]).map((img) => ({
          loaded: img.complete && img.naturalWidth > 0,
          width: Math.round(img.getBoundingClientRect().width),
          height: Math.round(img.getBoundingClientRect().height),
        })),
      ),
    )
    .toEqual([
      { loaded: true, width: 480, height: 280 },
      { loaded: true, width: 480, height: 280 },
    ]);
  await expect(pictures(page).first()).toHaveAttribute(
    "alt",
    "Bar chart of monthly readings rising from 120 to 240",
  );
  // The second has no alt text: marked.
  await expect(pictures(page).nth(1)).toHaveAttribute("data-foli-no-alt", "");
  // Not editable inside: no browser resize handles, one position in the text.
  expect(
    await pictures(page)
      .first()
      .evaluate((img) => (img.parentElement as HTMLElement).contentEditable),
  ).toBe("false");
});

test("text typed beside a picture goes around it, the picture kept", async ({ page }) => {
  await open(page, "07-picture-report.docx");
  // The caret right after the first picture, then typing.
  await page.evaluate(() => {
    const { editor } = window.foliEdit;
    let at = -1;
    editor.state.doc.descendants((node, pos) => {
      if (at < 0 && node.type.name === "picture") at = pos + 1;
    });
    editor.select(at);
  });
  await editor(page).focus();
  await page.keyboard.type("Fig. 1");
  const around = await page.evaluate(() => {
    let text = "";
    window.foliEdit.editor.state.doc.descendants((node) => {
      let has = false;
      node.forEach((child) => {
        if (child.type.name === "picture") has = true;
      });
      if (!text && node.isTextblock && has)
        node.forEach((child) => {
          text +=
            child.type.name === "picture" ? "[picture]" : child.isText ? (child.text ?? "") : "";
        });
    });
    return text;
  });
  expect(around).toContain("[picture]Fig. 1");
  await expect(pictures(page)).toHaveCount(2);
  expect(await page.evaluate(() => window.foliEdit.validate())).toBe(true);
});

test("pages with pictures have no axe violations", async ({ page }) => {
  test.slow(); // axe takes several seconds per run in Firefox
  await open(page, "07-picture-report.docx");
  const violations = (await new AxeBuilder({ page }).include("#editor > .foli-page").analyze())
    .violations;
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
});
