/**
 * Shapes drawn (34.2, ADR-0017): the corpus's shapes poster (12) on the editing page, each
 * preset of its grid at the place and size Word gives it (fixed on the page: the builder's
 * points), flipped, turned and with its text as the file says, the header's line on both pages;
 * and in `renderDocument`'s pages (print, exportPdf). Drawn as Word draws them: by ink against
 * Word's PDF in `apps/playground/word/shapes.word.ts` (`pnpm corpus:pages`).
 */
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const NAME = "12-shapes-poster.docx";
/** CSS px per point. */
const PX = 96 / 72;

async function open(page: Page): Promise<void> {
  await page.goto("/edit.html?toolbar");
  await page.waitForFunction(() => "foliEdit" in window);
  const base64 = readFileSync(new URL(NAME, CORPUS)).toString("base64");
  await page.evaluate((data) => window.foliEdit.loadDocx(data), base64);
  await page.waitForFunction(() => document.querySelectorAll("[data-foli-shape]").length >= 44);
  await page.waitForTimeout(300);
}

/** A shape's box from its page's corner, in points, unturned. */
const placed = (page: Page, alt: string) =>
  page.evaluate((name) => {
    const shape = document.querySelector(`[data-foli-shape][aria-label="${name}"]`) as HTMLElement;
    const section = shape.closest("section.foli-page") as HTMLElement;
    const s = section.getBoundingClientRect();
    const r = shape.getBoundingClientRect();
    const scale = s.width / section.offsetWidth;
    return {
      left: (r.left - s.left) / scale,
      top: (r.top - s.top) / scale,
      width: r.width / scale,
      height: r.height / scale,
      geometry: shape.getAttribute("data-foli-shape"),
    };
  }, alt);

test("draws the poster's presets where Word puts them, at their size", async ({ page }) => {
  await open(page);
  const grid = [
    1, 5, 9, 7, 8, 2, 3, 4, 12, 10, 6, 11, 13, 14, 18, 28, 33, 34, 35, 36, 37, 39, 51, 52, 92, 91,
    21, 22, 105, 106, 107, 16,
  ];
  for (const [i, type] of grid.entries()) {
    const box = await placed(page, `Preset ${type}`);
    expect(Math.abs(box.left - (90 + (i % 4) * 110) * PX), `Preset ${type}`).toBeLessThan(1.5);
    expect(Math.abs(box.top - (170 + Math.floor(i / 4) * 78) * PX), `Preset ${type}`).toBeLessThan(
      1.5,
    );
    expect(Math.abs(box.width - 80 * PX)).toBeLessThan(1);
    expect(Math.abs(box.height - 56 * PX)).toBeLessThan(1);
  }
  // Each as its geometry, every path drawn.
  const paths = await page.evaluate(() =>
    [...document.querySelectorAll("[data-foli-shape] svg g path")].map(
      (p) => p.getAttribute("d") ?? "",
    ),
  );
  expect(paths.every((d) => d.startsWith("M") && !/NaN/.test(d))).toBe(true);
  expect((await placed(page, "Preset 107")).geometry).toBe("wedgeEllipseCallout");
});

test("draws flips, gradients, dashes, line ends, a freeform and a shape's text", async ({
  page,
}) => {
  await open(page);
  const look = await page.evaluate(() => {
    const by = (name: string) =>
      document.querySelector(`[data-foli-shape][aria-label="${name}"]`) as HTMLElement;
    return {
      flipped: by("Right triangle flipped").querySelector("svg g")?.getAttribute("transform"),
      gradient: !!by("Gradient rectangle").querySelector("linearGradient"),
      dashed: by("Dashed oval, no fill").querySelector("g path")?.getAttribute("stroke-dasharray"),
      ends: by("Line with two ends").querySelectorAll("marker").length,
      free: by("Freeform").getAttribute("data-foli-shape"),
      text: by("Rounded rectangle with text").textContent,
      color: getComputedStyle(
        by("Rounded rectangle with text").querySelector("[data-foli-text-box] p") as HTMLElement,
      ).color,
      rules: document.querySelectorAll('.foli-region [data-foli-shape="line"]').length,
    };
  });
  expect(look.flipped).toMatch(/scale\(-1 -1\)/);
  expect(look.gradient).toBe(true);
  expect(look.dashed).toBeTruthy();
  expect(look.ends).toBe(2);
  expect(look.free).toBe("custom");
  expect(look.text).toBe("Open day");
  expect(look.rules).toBe(2);
  const results = await new AxeBuilder({ page }).include("section.foli-page").analyze();
  expect(results.violations).toEqual([]);
});

test("renderDocument draws the shapes too (print, exportPdf)", async ({ page }) => {
  await page.goto("/word.html");
  await page.waitForFunction(() => "foliWord" in window);
  const base64 = readFileSync(new URL(NAME, CORPUS)).toString("base64");
  await page.evaluate((data) => window.foliWord.render(data, "final"), base64);
  const drawn = await page.evaluate(() => ({
    shapes: document.querySelectorAll("[data-foli-shape]").length,
    text: [...document.querySelectorAll("[data-foli-shape] [data-foli-text-box]")].map(
      (b) => b.textContent,
    ),
  }));
  expect(drawn.shapes).toBe(44);
  expect(drawn.text).toContain("Open day");
});

/** The editing page with its ribbon, an empty paragraph to draw beside. */
async function ribbon(page: Page): Promise<void> {
  await page.goto("/edit.html");
  await page.waitForFunction(() => "foliEdit" in window);
  await page.getByRole("tab", { name: "Insert" }).click();
}

const drawn = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("section.foli-page [data-foli-shape]")].map((shape) => {
      const r = shape.getBoundingClientRect();
      const p = (shape.closest("section.foli-page") as HTMLElement).getBoundingClientRect();
      return {
        geometry: shape.getAttribute("data-foli-shape"),
        left: Math.round(r.left - p.left),
        top: Math.round(r.top - p.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
        selected: !!shape.closest("[data-foli-picture-selected]"),
      };
    }),
  );

test("Insert ▸ Shapes: a shape drawn by dragging on the page, Shift for a square (34.3)", async ({
  page,
}) => {
  await ribbon(page);
  await page.getByRole("button", { name: "Shapes" }).click();
  const menu = page.getByRole("menu", { name: "Shapes" });
  await expect(menu).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include(".foli-shape-gallery-menu").analyze()).violations,
  ).toEqual([]);
  await menu.getByRole("menuitem", { name: "Arrow: Right", exact: true }).click();
  await expect(menu).toBeHidden();
  const box = (await page.locator("section.foli-page").first().boundingBox()) as {
    x: number;
    y: number;
  };
  await page.mouse.move(box.x + 200, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 340, { steps: 4 });
  await page.mouse.move(box.x + 400, box.y + 380, { steps: 4 });
  await page.mouse.up();
  // Where it was dragged, at its size (a pixel of rounding either way).
  await expect.poll(async () => (await drawn(page)).length).toBe(1);
  const [arrow] = await drawn(page);
  expect(arrow?.geometry).toBe("rightArrow");
  expect(arrow?.selected).toBe(true);
  for (const [key, value] of [
    ["left", 200],
    ["top", 300],
    ["width", 200],
    ["height", 80],
  ] as const)
    expect(Math.abs((arrow?.[key] ?? 0) - value), key).toBeLessThanOrEqual(1);
  // Undo takes it away in one step.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await drawn(page)).length).toBe(0);
  // Shift keeps it square.
  await page.getByRole("button", { name: "Shapes" }).click();
  await page.getByRole("menuitem", { name: "Oval", exact: true }).click();
  await page.mouse.move(box.x + 200, box.y + 300);
  await page.mouse.down();
  await page.keyboard.down("Shift");
  await page.mouse.move(box.x + 330, box.y + 340, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect.poll(async () => (await drawn(page))[0]).toMatchObject({ width: 130, height: 130 });
  // A Line Arrow drawn up and to the right: its arrow where the drag ended (flipped up).
  await page.keyboard.press("ControlOrMeta+z");
  await page.getByRole("button", { name: "Shapes" }).click();
  await page.getByRole("menuitem", { name: "Line Arrow", exact: true }).click();
  await page.mouse.move(box.x + 200, box.y + 400);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 340, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() =>
        document
          .querySelector('[data-foli-shape="straightConnector1"] svg g')
          ?.getAttribute("transform"),
      ),
    )
    .toMatch(/scale\(1 -1\)/);
});

test("Insert ▸ Shapes from the keyboard: an inch square at the selection; Escape stops drawing", async ({
  page,
}) => {
  await ribbon(page);
  const button = page.getByRole("button", { name: "Shapes" });
  await button.focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "Shapes" });
  await expect(menu.getByRole("menuitem", { name: "Line", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();
  await page.keyboard.press("ArrowDown");
  // Line, Line Arrow, … Rectangle is the first of the second group: the fifth.
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  await expect(menu.getByRole("menuitem", { name: "Rectangle", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect
    .poll(() => drawn(page))
    .toEqual([
      expect.objectContaining({ geometry: "rect", width: 96, height: 96, selected: true }),
    ]);
  // A click starts drawing; Escape stops it: nothing is drawn.
  await button.click();
  await menu.getByRole("menuitem", { name: "Oval", exact: true }).click();
  await page.keyboard.press("Escape");
  const box = (await page.locator("section.foli-page").first().boundingBox()) as {
    x: number;
    y: number;
  };
  await page.mouse.click(box.x + 300, box.y + 500);
  expect((await drawn(page)).map((s) => s.geometry)).toEqual(["rect"]);
});
