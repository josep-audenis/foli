/**
 * Equations shown (35.4): the corpus's Word-made equations (13) drawn as MathML by the browser on
 * the editing pages and in `renderDocument`'s pages (print, exportPdf): fractions, scripts,
 * radicals, n-ary operators, delimiters, matrices, functions; a display equation on a line of its
 * own, centered, an inline one in its sentence; their text for screen readers; axe.
 */
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const NAME = "13-equations.docx";

async function open(page: Page): Promise<void> {
  await page.goto("/edit.html?toolbar");
  await page.waitForFunction(() => "foliEdit" in window);
  const base64 = readFileSync(new URL(NAME, CORPUS)).toString("base64");
  await page.evaluate((data) => window.foliEdit.loadDocx(data), base64);
  await page.waitForFunction(
    () => document.querySelectorAll("section.foli-page [data-foli-math] math").length >= 11,
  );
}

/** What the page's equations are made of. */
const drawn = (page: Page, root: string) =>
  page.evaluate((selector) => {
    const maths = [...document.querySelectorAll(`${selector} [data-foli-math] math`)];
    return {
      count: maths.length,
      display: maths.filter((m) => m.getAttribute("display") === "block").length,
      tags: [
        ...new Set(maths.flatMap((m) => [...m.querySelectorAll("*")].map((e) => e.localName))),
      ],
    };
  }, root);

test("draws Word's equations as MathML on the editing pages; axe", async ({ page }) => {
  await open(page);
  const math = await drawn(page, "section.foli-page");
  expect(math.count).toBe(11);
  expect(math.display).toBe(10);
  for (const tag of ["mfrac", "msqrt", "mroot", "msup", "msubsup", "munderover", "mtable", "mo"])
    expect(math.tags, tag).toContain(tag);
  // A fraction is drawn as one: its numerator above its denominator.
  const fraction = await page.evaluate(() => {
    const f = document.querySelector("section.foli-page mfrac") as Element;
    const [num, den] = [...f.children].map((c) => c.getBoundingClientRect());
    return { above: (num?.bottom ?? 0) <= (den?.top ?? 0) + 1 };
  });
  expect(fraction.above).toBe(true);
  // A display equation is centered in its line; the inline one sits in its sentence.
  const placement = await page.evaluate(() => {
    const block = document.querySelector(
      'section.foli-page [data-foli-math="display"] math',
    ) as Element;
    const page = (block.closest("section.foli-page") as Element).getBoundingClientRect();
    const r = block.getBoundingClientRect();
    const inline = document.querySelector('section.foli-page [data-foli-math="inline"]') as Element;
    return {
      center: (r.left + r.right) / 2 - (page.left + page.right) / 2,
      sentence: (inline.closest("p, [data-foli-block]")?.textContent ?? "").includes("Pythagoras"),
    };
  });
  expect(Math.abs(placement.center)).toBeLessThan(40);
  expect(placement.sentence).toBe(true);
  const results = await new AxeBuilder({ page }).include("section.foli-page").analyze();
  expect(results.violations).toEqual([]);
});

test("a press beside an equation puts the caret there: typing and arrows go around it", async ({
  page,
}) => {
  await open(page);
  const text = (index: number) =>
    page.evaluate((i) => window.foliEdit.editor.state.doc.child(i).textContent, index);
  const box = async (selector: string) => {
    await page.locator(selector).first().scrollIntoViewIfNeeded();
    const b = await page.locator(selector).first().boundingBox();
    if (!b) throw new Error(selector);
    return b;
  };
  // Right of a display equation's glyphs, on its line: after it.
  const display = await box('section.foli-page [data-foli-math="display"] math');
  await page.mouse.click(display.x + display.width - 2, display.y + display.height / 2);
  await page.keyboard.type("Q");
  await expect.poll(() => text(1)).toBe("Q");
  await page.keyboard.press("Backspace");
  await expect.poll(() => text(1)).toBe("");
  // Left of the inline equation: in its sentence, before it.
  const inline = await box('section.foli-page [data-foli-math="inline"] math');
  await page.mouse.click(inline.x - 1, inline.y + inline.height / 2);
  await page.keyboard.type("Z");
  await expect
    .poll(() => text(11))
    .toBe("The sides of a right triangle give Z, as Pythagoras showed.");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("W");
  // Over the equation (one position), then past the comma.
  await expect
    .poll(() => text(11))
    .toBe("The sides of a right triangle give Z,W as Pythagoras showed.");
});

test("a drag from text over equations selects across them", async ({ page }) => {
  await open(page);
  const title = page.locator("section.foli-page h1, section.foli-page p").first();
  const from = await title.boundingBox();
  const target = page.locator('section.foli-page [data-foli-math="display"] math').nth(3);
  await target.scrollIntoViewIfNeeded();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("no boxes");
  await page.mouse.move(from.x + 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width - 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  const selection = await page.evaluate(() => window.foliEdit.editor.state.selection.toJSON());
  // Past the first three display equations at least.
  expect(Math.max(selection.anchor, selection.head)).toBeGreaterThan(20);
});

test("renderDocument draws them too (print, exportPdf)", async ({ page }) => {
  await page.goto("/word.html");
  await page.waitForFunction(() => "foliWord" in window);
  const base64 = readFileSync(new URL(NAME, CORPUS)).toString("base64");
  await page.evaluate((data) => window.foliWord.render(data, "final"), base64);
  const math = await drawn(page, "body");
  expect(math.count).toBe(11);
  expect(math.tags).toContain("mfrac");
});

test.describe("Insert ▸ Equation (35.5)", () => {
  async function ribbon(page: Page): Promise<void> {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto("/edit.html");
    await page.waitForFunction(() => "foliEdit" in window);
    await page.getByRole("tab", { name: "Insert" }).click();
  }
  /** A new empty paragraph at the end, the caret in it. */
  const newParagraph = (page: Page) =>
    page.evaluate(() => {
      const { editor } = window.foliEdit;
      editor.run((state, dispatch) => {
        dispatch?.(state.tr.insert(state.doc.content.size, state.schema.node("paragraph")));
        return true;
      });
      editor.select(editor.state.doc.content.size - 1);
    });

  test("inserts Word's gallery and a typed equation, edited in its box, saved as OMML; axe", async ({
    page,
  }) => {
    await ribbon(page);
    const names = [
      "Area of Circle",
      "Binomial Theorem",
      "Expansion of a Sum",
      "Fourier Series",
      "Pythagorean Theorem",
      "Quadratic Formula",
      "Taylor Expansion",
      "Trig Identity 1",
      "Trig Identity 2",
    ];
    for (const name of names) {
      await newParagraph(page);
      await page.getByRole("button", { name: "Equation", exact: true }).click();
      await page.getByRole("menuitem", { name }).click();
    }
    await expect(page.locator('section.foli-page [data-foli-math="display"] math')).toHaveCount(9);
    // A typed one in a sentence: inline.
    await page.evaluate(() => window.foliEdit.editor.select(2));
    await page.getByRole("button", { name: "Equation", exact: true }).click();
    await page.getByRole("menuitem", { name: "Insert New Equation…" }).click();
    const dialog = page.getByRole("dialog", { name: "Equation" });
    await dialog.getByLabel("Linear form").fill("E=mc^2");
    await expect(dialog.locator(".foli-equation-preview math msup")).toHaveCount(1);
    const results = await new AxeBuilder({ page }).include(".foli-equation-dialog").analyze();
    expect(results.violations).toEqual([]);
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('section.foli-page [data-foli-math="inline"] math')).toHaveCount(1);
    // Edited: the selected equation's linear form.
    await page.getByRole("button", { name: "Equation", exact: true }).click();
    await page.getByRole("menuitem", { name: "Edit Equation…" }).click();
    await expect(dialog.getByLabel("Linear form")).toHaveValue("E=mc^2");
    await dialog.getByLabel("Linear form").fill("E=mc^2+p");
    await dialog.getByRole("button", { name: "OK" }).click();
    const xml = await page.evaluate(() => {
      let found = "";
      window.foliEdit.editor.state.doc.descendants((n) => {
        if (n.type.name === "equation" && !String(n.attrs.xml).startsWith("<m:oMathPara"))
          found = String(n.attrs.xml);
      });
      return found;
    });
    expect(xml).toContain("<m:t>+p</m:t>");
    await page.keyboard.press("ControlOrMeta+z");
    // For Word to open (FOLI_EQUATIONS_OUT): the saved file.
    const out = process.env.FOLI_EQUATIONS_OUT;
    if (out) {
      const download = page.waitForEvent("download");
      await page.locator("#save").click();
      await (await download).saveAs(out);
    }
  });
});
