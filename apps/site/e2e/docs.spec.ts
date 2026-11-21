import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// The docs site (12.8): pages built from docs/*.md, the API reports and the changelogs; the live
// examples; search; keyboard use, axe, a 375px screen and dark mode.

const docsNav = (page: Page) => page.getByRole("navigation", { name: "Documentation" });
const axe = async (page: Page) =>
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

test("every nav entry opens its page, marked as the current one", async ({ page }) => {
  test.slow();
  await page.goto("/docs/");
  const links = await docsNav(page)
    .locator("ul:not([data-search-results]) a")
    .evaluateAll((as) => as.map((a) => ({ href: a.getAttribute("href"), text: a.textContent })));
  expect(links.length).toBeGreaterThan(25);
  for (const { href, text } of links) {
    await page.goto(href ?? "");
    // The page title, not its h1: a package README keeps its package name as its heading.
    await expect(page).toHaveTitle(`${text} · Foli docs`);
    await expect(docsNav(page).locator('[aria-current="page"]')).toHaveText(text ?? "");
  }
});

test("relative links between docs stay on the site; source files go to GitHub", async ({
  page,
}) => {
  test.slow(); // long pages, slow in Firefox under a full run's load
  await page.goto("/docs/");
  await expect(page.locator(".prose a", { hasText: "known limitations" }).first()).toHaveAttribute(
    "href",
    "/docs/limitations/",
  );
  await page.goto("/docs/contributing/");
  await expect(page.locator('.prose a[href*="changeset/config.json"]')).toHaveAttribute(
    "href",
    "https://github.com/josep-audenis/foli/blob/main/.changeset/config.json",
  );
  await page.goto("/docs/api/");
  const anchor = page.locator('.prose a[href="/docs/contributing/#api-reports"]').first();
  await expect(anchor).toBeVisible();
  await anchor.click();
  await expect(page).toHaveURL(/\/docs\/contributing\/#api-reports$/);
  await expect(page.locator("#api-reports")).toBeInViewport();
});

test("the API pages list each entry's exports and every declaration with its doc", async ({
  page,
}) => {
  test.slow(); // the core page is 250 kB of HTML
  await page.goto("/docs/api/react/");
  const editor = page.locator("section.api-decl", { has: page.locator("h3#folieditor") });
  await expect(editor.locator("h3")).toHaveText("FoliEditor");
  await expect(editor.locator("p").first()).toContainText("An editable document on real pages");
  await expect(editor.locator("pre")).toContainText("export declare const FoliEditor");
  await page.getByRole("link", { name: "FoliEditor", exact: true }).first().click();
  await expect(page).toHaveURL(/#folieditor$/);
  await page.goto("/docs/api/core/");
  await expect(
    page.getByRole("heading", { name: "Exports of @folijs/core/internal" }),
  ).toBeVisible();
});

test("search finds headings and API names", async ({ page }) => {
  await page.goto("/docs/");
  await page.getByLabel("Search the docs").fill("createeditor");
  await expect(page.locator("[data-search-status]")).toContainText("result");
  const first = page.locator("[data-search-results] a").first();
  await expect(first).toContainText("createEditor");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/docs\/api\/core\/#createeditor$/);
  await page.getByLabel("Search the docs").fill("no such thing anywhere");
  await expect(page.locator("[data-search-status]")).toHaveText("0 results");
});

test("the skip link moves the focus to the page", async ({ page, browserName }) => {
  await page.goto("/docs/");
  const skip = page.getByRole("link", { name: "Skip to content" });
  // WebKit's Tab skips links (Safari's default), so there it is focused directly.
  if (browserName === "webkit") await skip.focus();
  else await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});

test("the docs nav works from the keyboard", async ({ page, browserName }) => {
  // Playwright's WebKit reached no link with Tab or Alt+Tab. Its search box and results are
  // driven from the keyboard in the search test.
  test.skip(browserName === "webkit", "WebKit's Tab skips links");

  await page.goto("/docs/");
  const styling = docsNav(page).getByRole("link", { name: "Styling" });
  for (let i = 0; i < 30 && !(await styling.evaluate((a) => a === document.activeElement)); i++)
    await page.keyboard.press("Tab");
  await expect(styling).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/docs\/styling\/$/);
  await expect(docsNav(page).getByRole("link", { name: "Styling" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

for (const path of [
  "/docs/",
  "/docs/limitations/",
  "/docs/keyboard/",
  "/docs/guides/extensions/",
  "/docs/guides/docx/",
  "/docs/guides/agent/",
  "/docs/benchmarks/",
  "/docs/changelog/",
  "/docs/api/react/",
  "/docs/api/core/",
]) {
  test(`${path} is axe-clean`, async ({ page }) => {
    test.slow(); // axe takes seconds per run in Firefox, more on the long pages
    await page.goto(path);
    await axe(page);
  });
}

test("the editor example is live and axe-clean", async ({ page }) => {
  test.slow();
  await page.goto("/docs/examples/editor/");
  const doc = page.getByRole("textbox", { name: "Example document" });
  await expect(doc.locator(".foli-page").first()).toBeVisible();
  await doc.locator("h1").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" typed here");
  await expect(doc).toContainText("typed here");
  await axe(page);
});

test("the custom node example draws, inserts and undoes its node; axe-clean", async ({ page }) => {
  test.slow();
  await page.goto("/docs/examples/custom-node/");
  const doc = page.getByRole("textbox", { name: "Example document" });
  const chips = doc.locator(".foli-page .example-chip");
  await expect(chips).toHaveText(["@Grace Hopper"]);
  await doc.getByText("about the schedule").click();
  await page.getByRole("button", { name: "Insert mention" }).click();
  await expect(chips).toHaveText(["@Grace Hopper", "@Ada Lovelace"]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(chips).toHaveCount(1);
  await axe(page);
});

test("the plugin example's key, command and decorations work; axe-clean", async ({ page }) => {
  test.slow();
  await page.goto("/docs/examples/plugin/");
  const doc = page.getByRole("textbox", { name: "Example document" });
  const todos = doc.locator(".foli-page .example-todo");
  await expect(todos).toHaveCount(1);
  await doc.getByText("The rest is done.").click();
  await page.keyboard.press("End");
  await page.keyboard.press("ControlOrMeta+Shift+o");
  await expect(todos).toHaveCount(2);
  await page.getByRole("button", { name: "Insert TODO" }).click();
  await expect(todos).toHaveCount(3);
  await axe(page);
});

test.describe("on a 375px screen", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  for (const path of [
    "/docs/",
    "/docs/contributing/",
    "/docs/benchmarks/",
    "/docs/api/core/",
    "/docs/examples/editor/",
  ])
    test(`${path} does not scroll sideways`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("main h1").first()).toBeVisible();
      if (path.includes("examples")) await expect(page.locator(".foli-page").first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        375,
      );
    });

  test("the nav is folded behind Contents and opens", async ({ page }) => {
    await page.goto("/docs/");
    const styling = docsNav(page).getByRole("link", { name: "Styling" });
    await expect(styling).toBeHidden();
    await page.getByText("Contents", { exact: true }).click();
    await expect(styling).toBeVisible();
  });
});

test.describe("in dark mode", () => {
  test.use({ colorScheme: "dark" });

  test("a page and an example are axe-clean", async ({ page }) => {
    test.slow();
    await page.goto("/docs/styling/");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      "rgb(22, 22, 21)",
    );
    await axe(page);
    await page.goto("/docs/examples/plugin/");
    await expect(page.locator(".foli-page").first()).toBeVisible();
    await axe(page);
  });
});
