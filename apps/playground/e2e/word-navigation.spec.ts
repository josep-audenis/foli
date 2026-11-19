/**
 * Finding and going places (11.11), on the editing page (`/edit.html`): the find and replace panel
 * over the body and the stories, the marks on the pages, bookmarks, the outline, Word's keys.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

type Json = Record<string, unknown>;
const MOD = "ControlOrMeta";
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const inStory = (page: Page) => page.locator(".foli-story-mount [contenteditable=true]");
const panel = (page: Page) => page.getByRole("dialog", { name: "Find and replace" });
const query = (page: Page) => page.getByLabel("Find what");
const status = (page: Page) => panel(page).getByRole("status");

const text = (value: string): Json => ({ type: "text", text: value });
const paragraph = (value: string, style?: string): Json => ({
  type: "paragraph",
  ...(style ? { attrs: { style } } : {}),
  content: [text(value)],
});
const storyDoc = (...content: Json[]): Json => ({ type: "doc", content });

const documentOf = (content: Json[]): Json => ({
  schemaVersion: 5,
  section: {
    pageSize: { width: 8391, height: 11906 },
    margins: { top: 1440, right: 1000, bottom: 1440, left: 1000, header: 500, footer: 400 },
    headers: { default: "h1" },
    footers: { default: "f1" },
  },
  defaults: { paragraph: { spacing: { after: 120 } } },
  styles: [
    { id: "Normal", type: "paragraph", name: "Normal", isDefault: true },
    {
      id: "Heading1",
      type: "paragraph",
      name: "heading 1",
      basedOn: "Normal",
      paragraph: { outlineLevel: 0 },
      run: [{ type: "bold" }],
    },
    {
      id: "Heading2",
      type: "paragraph",
      name: "heading 2",
      basedOn: "Normal",
      paragraph: { outlineLevel: 1 },
    },
    { id: "FootnoteText", type: "paragraph", name: "footnote text", basedOn: "Normal" },
    { id: "FootnoteReference", type: "character", name: "footnote reference" },
  ],
  numbering: { abstracts: [], instances: [] },
  comments: [],
  content: { type: "doc", content },
  stories: {
    h1: { kind: "header", content: storyDoc(paragraph("The cat header")) },
    f1: { kind: "footer", content: storyDoc(paragraph("No match here")) },
    "footnote:1": {
      kind: "footnote",
      content: storyDoc({
        type: "paragraph",
        attrs: { style: "FootnoteText" },
        content: [
          {
            type: "noteMark",
            marks: [{ type: "characterStyle", attrs: { id: "FootnoteReference" } }],
          },
          text(" A cat in the note"),
        ],
      }),
    },
  },
});

/** Two headings, a note reference, and enough text for three or four pages. */
const sample = (): Json =>
  documentOf([
    paragraph("First chapter", "Heading1"),
    {
      type: "paragraph",
      content: [
        text("A cat sat here"),
        {
          type: "noteReference",
          attrs: { story: "footnote:1" },
          marks: [{ type: "characterStyle", attrs: { id: "FootnoteReference" } }],
        },
        text("."),
      ],
    },
    ...Array.from({ length: 60 }, (_, i) => paragraph(`Filler line number ${i} of the text.`)),
    paragraph("Second chapter", "Heading2"),
    paragraph("Another cat at the end."),
  ]);

async function load(page: Page, document: Json = sample()) {
  await page.goto("/edit.html");
  await page.waitForFunction(() => !!window.foliEdit);
  await page.evaluate((doc) => window.foliEdit.load(doc as never), document);
  await editor(page).click({ position: { x: 200, y: 200 } });
}
const marks = (page: Page, name = "foli-find") =>
  page.evaluate((n) => {
    const registry = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights;
    return [...(registry.get(n) ?? [])].map((r) => r.toString());
  }, name);
const documentJson = (page: Page) =>
  page.evaluate(() => JSON.stringify(window.foliEdit.editor.getDocument()));
const bodyText = (page: Page) => page.evaluate(() => window.foliEdit.editor.state.doc.textContent);
const storyText = (page: Page, id: string) =>
  page.evaluate((s) => window.foliEdit.editor.story(s)?.state.doc.textContent, id);

test("Ctrl+F is taken only while the focus is in the editor", async ({ page }) => {
  await load(page);
  await page.evaluate(() => {
    (window as unknown as { keys: boolean[] }).keys = [];
    window.addEventListener("keydown", (e) => {
      if (e.key === "f") (window as unknown as { keys: boolean[] }).keys.push(e.defaultPrevented);
    });
  });
  await page.getByLabel("Open a .docx").focus();
  await page.keyboard.press(`${MOD}+f`);
  await expect(panel(page)).toHaveCount(0);
  await editor(page).click({ position: { x: 200, y: 200 } });
  await page.keyboard.press(`${MOD}+f`);
  await expect(panel(page)).toBeVisible();
  await expect(query(page)).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as { keys: boolean[] }).keys)).toEqual([
    false,
    true,
  ]);
});

test("matches are marked on the pages and nowhere in the document", async ({ page }) => {
  await load(page);
  const before = await documentJson(page);
  const html = await editor(page).evaluate((host) => host.textContent);
  await page.keyboard.press(`${MOD}+f`);
  await query(page).fill("cat");
  await expect(status(page)).toContainText("of 4");
  // The pages near the window: the body's first, the header's copies, the note.
  const shown = await marks(page);
  expect(shown.every((t) => t.toLowerCase() === "cat")).toBe(true);
  expect(shown.length).toBeGreaterThanOrEqual(3);
  expect(await page.locator(".foli-page").count()).toBeGreaterThan(1);
  // Those further on when they come near.
  const onScreen = () =>
    page.evaluate(() => {
      const registry = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights;
      return [...(registry.get("foli-find") ?? [])].filter((r) => {
        const { top, bottom } = r.getBoundingClientRect();
        return bottom > 0 && top < innerHeight;
      }).length;
    });
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(onScreen).toBeGreaterThan(0);
  expect(await marks(page, "foli-find-current")).toEqual(["cat"]);
  expect(await documentJson(page)).toBe(before);
  expect(await editor(page).evaluate((host) => host.textContent)).toBe(html);
  // Not printed.
  await page.emulateMedia({ media: "print" });
  const printed = await page.evaluate(
    () =>
      getComputedStyle(document.querySelector("p") as Element, "::highlight(foli-find)")
        .backgroundColor,
  );
  await page.emulateMedia({ media: "screen" });
  if (printed) expect(printed).toBe("rgba(0, 0, 0, 0)");
  // The panel does not print either: the focus left it.
  await query(page).focus();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
  expect(await marks(page)).toEqual([]);
});

test("Enter walks the matches through the stories and back to the body", async ({ page }) => {
  await load(page);
  await page.keyboard.press(`${MOD}+Home`);
  await page.keyboard.press(`${MOD}+f`);
  await query(page).fill("cat");
  await expect(status(page)).toHaveText("1 of 4");
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => window.foliEdit.editor.state.selection.from)).toBeGreaterThan(1);
  await page.keyboard.press("Enter");
  await expect(status(page)).toHaveText("2 of 4");
  // The second is on a later page: in view now.
  const seen = await page.evaluate(() => {
    const registry = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights;
    const [range] = [...(registry.get("foli-find-current") ?? [])];
    const rect = (range as Range).getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight;
  });
  expect(seen).toBe(true);
  await page.keyboard.press("Enter");
  await expect(status(page)).toHaveText("3 of 4, in a header");
  await expect(inStory(page)).toHaveCount(1);
  await expect(query(page)).toBeFocused();
  await expect(inStory(page)).toContainText("The cat header");
  expect(await marks(page, "foli-find-current")).toEqual(["cat"]);
  await page.keyboard.press("Enter");
  await expect(status(page)).toHaveText("4 of 4, in a footnote");
  await expect(inStory(page)).toContainText("A cat in the note");
  await page.keyboard.press("Enter");
  await expect(status(page)).toHaveText("1 of 4");
  await expect(inStory(page)).toHaveCount(0);
  await page.keyboard.press("Shift+Enter");
  await expect(status(page)).toHaveText("4 of 4, in a footnote");
  await page.keyboard.press("Escape");
  // The note stays open, with the focus, where the search left it.
  await expect(inStory(page)).toBeFocused();
});

test("replace all reaches every story, and one undo takes it all back", async ({ page }) => {
  await load(page);
  const before = await documentJson(page);
  await page.keyboard.press(`${MOD}+h`);
  await query(page).fill("cat");
  await page.getByLabel("Replace with").fill("dog");
  await page.getByRole("button", { name: "Replace all" }).click();
  await expect(status(page)).toHaveText("Replaced 4.");
  expect(await bodyText(page)).toContain("A dog sat here");
  expect(await storyText(page, "h1")).toBe("The dog header");
  expect(await storyText(page, "footnote:1")).toContain("A dog in the note");
  await expect(page.locator(".foli-region").first()).toContainText("The dog header");
  await page.keyboard.press("Escape");
  await editor(page).click({ position: { x: 200, y: 200 } });
  await page.keyboard.press(`${MOD}+z`);
  expect(await documentJson(page)).toBe(before);
});

test("replacing one at a time shows it first, and is tracked while tracking", async ({ page }) => {
  await load(page);
  await page.evaluate(() => window.foliEdit.editor.commands.setTrackChanges(true));
  await page.keyboard.press(`${MOD}+Home`);
  await page.keyboard.press(`${MOD}+h`);
  await query(page).fill("cat");
  await page.getByLabel("Replace with").fill("dog");
  const button = page.getByRole("button", { name: "Replace", exact: true });
  await button.click();
  await expect(status(page)).toHaveText("1 of 4");
  await button.click();
  await expect(status(page)).toHaveText("Replaced 1.");
  expect(await bodyText(page)).toContain("A catdog sat here");
  await page.getByRole("button", { name: "Replace all" }).click();
  const json = await page.evaluate(() =>
    JSON.stringify(window.foliEdit.editor.getDocument().stories?.h1),
  );
  expect(json).toContain("insertion");
  expect(json).toContain("deletion");
});

test("F3 goes on from the keyboard with the panel closed", async ({ page }) => {
  await load(page);
  await page.keyboard.press(`${MOD}+f`);
  await query(page).fill("chapter");
  await page.keyboard.press("Escape");
  await page.keyboard.press(`${MOD}+Home`);
  await page.keyboard.press("F3");
  const selected = () => page.evaluate(() => getSelection()?.toString());
  await expect.poll(selected).toBe("chapter");
  const first = await page.evaluate(() => window.foliEdit.editor.state.selection.from);
  await page.keyboard.press("F3");
  await expect
    .poll(() => page.evaluate(() => window.foliEdit.editor.state.selection.from))
    .toBeGreaterThan(first);
  await page.keyboard.press("Shift+F3");
  await expect
    .poll(() => page.evaluate(() => window.foliEdit.editor.state.selection.from))
    .toBe(first);
});

test("bookmarks: added, listed, gone to, offered to cross-references", async ({ page }) => {
  await load(page);
  await page.keyboard.press(`${MOD}+Home`);
  await page.keyboard.press("Shift+End");
  await page.keyboard.press(`${MOD}+Shift+F5`);
  const dialog = page.getByRole("dialog", { name: "Bookmarks" });
  await expect(page.getByLabel("Bookmark name")).toBeFocused();
  await page.keyboard.type("1 bad");
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("starts with a letter");
  await page.getByLabel("Bookmark name").fill("Start");
  await page.keyboard.press("Enter");
  await expect(dialog.locator("option")).toHaveCount(1);
  expect((await new AxeBuilder({ page }).include(".foli-bookmarks").analyze()).violations).toEqual(
    [],
  );
  await page.keyboard.press("Escape");
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.press(`${MOD}+Shift+F5`);
  await dialog.locator("select").selectOption("Start");
  await dialog.getByRole("button", { name: "Go to" }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe("First chapter");
  await page.getByRole("button", { name: "Fields", exact: true }).click();
  await page.getByRole("menuitem", { name: /Cross-reference/ }).click();
  await expect(page.getByRole("dialog", { name: "Insert cross-reference" })).toContainText(
    "Bookmark: Start",
  );
});

test("the outline lists the headings with pages, from the keyboard too", async ({ page }) => {
  await load(page);
  const menu = page.getByRole("button", { name: "Navigate", exact: true });
  await menu.focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("menuitem", { name: "Outline" }).click();
  const outline = page.getByRole("navigation", { name: "Document outline" });
  const second = outline.getByRole("button", { name: /Second chapter/ });
  await expect(outline.getByRole("button", { name: /First chapter/ })).toContainText("1");
  const pages = await page.locator(".foli-page").count();
  await expect(second).toContainText(String(pages));
  expect((await new AxeBuilder({ page }).include(".foli-outline").analyze()).violations).toEqual(
    [],
  );
  await outline.getByRole("button", { name: /First chapter/ }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(second).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(editor(page)).toBeFocused();
  const inView = await page.evaluate(() => {
    const node = getSelection()?.anchorNode as Node;
    const element = node.nodeType === 1 ? (node as Element) : (node.parentElement as Element);
    const rect = element.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight;
  });
  expect(inView).toBe(true);
  await expect(second).toHaveAttribute("aria-current", "location");
});

test("the panel goes to a page and a heading, and passes axe in every mode", async ({ page }) => {
  await load(page);
  await page.keyboard.press(`${MOD}+f`);
  await query(page).fill("cat");
  await expect(status(page)).toContainText("of 4");
  const axe = async () =>
    expect(
      (await new AxeBuilder({ page }).include(".foli-find-panel").analyze()).violations,
    ).toEqual([]);
  await axe();
  await page.keyboard.press(`${MOD}+h`);
  await expect(page.getByLabel("Replace with")).toBeVisible();
  await expect(query(page)).toBeFocused();
  await axe();
  await page.keyboard.press(`${MOD}+g`);
  await expect(page.getByLabel("Page number")).toBeFocused();
  await axe();
  await page.getByLabel("Page number").fill("2");
  await page.keyboard.press("Enter");
  await expect(panel(page)).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
  const onPage = await page.evaluate(() => {
    const node = getSelection()?.anchorNode as Node;
    const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
    return [...document.querySelectorAll(".foli-page")].indexOf(
      element?.closest(".foli-page") as Element,
    );
  });
  expect(onPage).toBe(1);
});

test("finding on a hundred pages keeps up with typing", async ({ page }, info) => {
  test.setTimeout(180_000);
  const line = "The quick brown fox jumps over the lazy dog and runs across the wide field.";
  const content = Array.from({ length: 1640 }, (_, i) => paragraph(`${i} ${line}`));
  await load(page, documentOf(content));
  const pages = await page.locator(".foli-page").count();
  expect(pages).toBeGreaterThanOrEqual(100);
  await page.keyboard.press(`${MOD}+f`);
  await expect(panel(page)).toBeVisible();
  const times = await page.evaluate(async () => {
    const input = document.querySelector<HTMLInputElement>(".foli-find-panel input");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    const status = document.querySelector(".foli-find-panel [role=status]") as Element;
    const out: { query: string; ms: number; found: string }[] = [];
    for (const query of ["t", "th", "the", "the ", "the l", "the la", "lazy", "zebra"]) {
      const start = performance.now();
      setter?.call(input, query);
      input?.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
      out.push({
        query,
        ms: Math.round(performance.now() - start),
        found: status.textContent ?? "",
      });
    }
    return out;
  });
  await info.attach("timings", { body: JSON.stringify({ pages, times }) });
  console.log(`find on ${pages} pages (${info.project.name}):`, JSON.stringify(times));
  expect(times[times.length - 1]?.found).toBe("No results");
  // What a person would notice; the numbers are in docs/benchmarks.md.
  for (const { query, ms } of times) if (query.length > 1) expect(ms).toBeLessThan(500);
});
