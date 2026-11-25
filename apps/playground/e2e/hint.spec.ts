/**
 * The hint (Phase 18), on the editing page (`/edit.html`): a place marked for a few seconds on
 * real pages, without moving the caret. A far page, a header, an edit while it shows, a range
 * over two pages, reduced motion.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

type Json = Record<string, unknown>;
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const text = (value: string): Json => ({ type: "text", text: value });
const paragraph = (value: string): Json => ({ type: "paragraph", content: [text(value)] });

/** A header, and enough text for three or four pages. */
const sample = (): Json => ({
  schemaVersion: 5,
  section: {
    pageSize: { width: 8391, height: 11906 },
    margins: { top: 1440, right: 1000, bottom: 1440, left: 1000, header: 500, footer: 400 },
    headers: { default: "h1" },
  },
  defaults: { paragraph: { spacing: { after: 120 } } },
  styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
  numbering: { abstracts: [], instances: [] },
  comments: [],
  content: {
    type: "doc",
    content: [
      paragraph("First chapter"),
      ...Array.from({ length: 60 }, (_, i) => paragraph(`Filler line number ${i} of the text.`)),
      paragraph("Another cat at the end."),
    ],
  },
  stories: {
    h1: { kind: "header", content: { type: "doc", content: [paragraph("The cat header")] } },
  },
});

async function load(page: Page) {
  await page.goto("/edit.html?toolbar");
  await page.waitForFunction(() => !!window.foliEdit);
  await page.evaluate((doc) => window.foliEdit.load(doc as never), sample());
  await editor(page).click({ position: { x: 200, y: 200 } });
}

const marks = (page: Page, name = "foli-hint") =>
  page.evaluate((n) => {
    const registry = (CSS as unknown as { highlights?: Map<string, Set<Range>> }).highlights;
    return [...(registry?.get(n) ?? [])].map((r) => r.toString());
  }, name);

/** Where a paragraph's text is in the body: its first and last positions. */
const where = (page: Page, needle: string) =>
  page.evaluate((n) => {
    let found: [number, number] | null = null;
    window.foliEdit.editor.state.doc.descendants((node, pos) => {
      if (!found && node.isTextblock && node.textContent.includes(n)) {
        const at = pos + 1 + node.textContent.indexOf(n);
        found = [at, at + n.length];
      }
      return !found;
    });
    return found as unknown as [number, number];
  }, needle);

const hint = (page: Page, target: Json, ms = 2000) =>
  page.evaluate(
    ([t, m]) => window.foliEdit.view.hint(t as never, { ms: m as number }),
    [target, ms],
  );

const selection = (page: Page) =>
  page.evaluate(() => JSON.stringify(window.foliEdit.editor.state.selection.toJSON()));

test("a far page is scrolled to and marked, then the mark fades and goes; the caret stays", async ({
  page,
}) => {
  await load(page);
  // A caret of the test's own, once the click's has reached the model: what must not move.
  await page.waitForFunction(() => window.foliEdit.editor.state.selection.from > 1);
  await page.evaluate(() => window.foliEdit.editor.select(3));
  const before = await selection(page);
  const top = await page.evaluate(() => scrollY);
  const [from, to] = await where(page, "Another cat");
  expect(await hint(page, { story: null, from, to }, 800)).toBe(true);
  expect(await marks(page)).toEqual(["Another cat"]);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(top + 500);
  expect(await selection(page)).toBe(before);
  // The marked text is on the screen.
  const shown = await page.evaluate(() => {
    const range = [
      ...((CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get("foli-hint") ??
        []),
    ][0];
    const rect = range?.getBoundingClientRect();
    return !!rect && rect.top >= 0 && rect.bottom <= innerHeight;
  });
  expect(shown).toBe(true);
  // The fade lasts 400 ms: poll often enough not to step over it.
  await expect
    .poll(() => marks(page, "foli-hint-fading"), { intervals: [50] })
    .toEqual(["Another cat"]);
  await expect.poll(() => marks(page, "foli-hint-fading")).toEqual([]);
  expect(await marks(page)).toEqual([]);
  expect(await selection(page)).toBe(before);
  // The pages while marked (a hint long enough for axe): it adds nothing to them to find.
  await hint(page, { story: null, from, to }, 60_000);
  const axe = await new AxeBuilder({ page }).include(".foli-page").analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

test("a range over two pages is marked on both", async ({ page }) => {
  await load(page);
  const [from] = await where(page, "Filler line number 20");
  const [, to] = await where(page, "Filler line number 45 of the text.");
  expect(await hint(page, { story: null, from, to })).toBe(true);
  const pages = await page.evaluate(() => {
    const ranges = [
      ...((CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get("foli-hint") ??
        []),
    ];
    const of = (r: Range) => (r.startContainer.parentElement as Element).closest(".foli-page");
    return new Set(ranges.map(of)).size;
  });
  expect(pages).toBeGreaterThan(1);
});

test("an edit while it shows: the mark follows its text, and goes with it", async ({ page }) => {
  await load(page);
  const [from, to] = await where(page, "First chapter");
  await hint(page, { story: null, from: from + 6, to }, 5000);
  expect(await marks(page)).toEqual(["chapter"]);
  await page.evaluate(() => {
    window.foliEdit.editor.select(1);
    window.foliEdit.editor.commands.insertText("New ");
  });
  expect(await marks(page)).toEqual(["chapter"]);
  await page.evaluate(
    ([a, b]) => {
      window.foliEdit.editor.select(a as number, b as number);
      window.foliEdit.editor.commands.deleteSelection();
    },
    [from + 10, to + 4],
  );
  expect(await marks(page)).toEqual([]);
});

test("a header's range is marked where the pages draw it, without opening it", async ({ page }) => {
  await load(page);
  // "cat" in "The cat header": the story's positions.
  expect(await hint(page, { story: "h1", from: 5, to: 8 }, 3000)).toBe(true);
  const shown = await marks(page);
  expect(shown.length).toBeGreaterThan(0);
  expect(new Set(shown)).toEqual(new Set(["cat"]));
  expect(await page.locator(".foli-story-mount").count()).toBe(0);
  expect(await hint(page, { story: "nope", from: 1, to: 2 })).toBe(false);
});

test("under reduced motion it goes without fading", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await load(page);
  const [from, to] = await where(page, "First chapter");
  await hint(page, { story: null, from, to }, 600);
  expect(await marks(page)).toEqual(["First chapter"]);
  await expect.poll(() => marks(page)).toEqual([]);
  // At no point after its time was there a fading step: polled at once, and still none.
  expect(await marks(page, "foli-hint-fading")).toEqual([]);
});

test("in a header with a tab and in a note with its number, the mark is on the story's text", async ({
  page,
}) => {
  const doc = sample() as { stories: Json; content: { content: Json[] }; styles: Json[] };
  doc.styles.push(
    { id: "FootnoteText", type: "paragraph", name: "footnote text", basedOn: "Normal" },
    { id: "FootnoteReference", type: "character", name: "footnote reference" },
  );
  const reference = { type: "characterStyle", attrs: { id: "FootnoteReference" } };
  doc.stories = {
    h1: {
      kind: "header",
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [text("Left"), { type: "tab" }, text("cat right")] },
        ],
      },
    },
    "footnote:1": {
      kind: "footnote",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { style: "FootnoteText" },
            content: [{ type: "noteMark", marks: [reference] }, text(" A cat in the note")],
          },
        ],
      },
    },
  };
  doc.content.content.splice(1, 0, {
    type: "paragraph",
    content: [
      text("A note here"),
      { type: "noteReference", attrs: { story: "footnote:1" }, marks: [reference] },
    ],
  });
  await page.goto("/edit.html?toolbar");
  await page.waitForFunction(() => !!window.foliEdit);
  await page.evaluate((d) => window.foliEdit.load(d as never), doc);
  // "Left" 1..5, the tab 5..6, "cat" 6..9.
  expect(await hint(page, { story: "h1", from: 6, to: 9 }, 3000)).toBe(true);
  expect(new Set(await marks(page))).toEqual(new Set(["cat"]));
  // The note's number 1..2, " A " 2..5, "cat" 5..8.
  expect(await hint(page, { story: "footnote:1", from: 5, to: 8 }, 3000)).toBe(true);
  expect(await marks(page)).toEqual(["cat"]);
});

test("in a header's copy: the final view's joined paragraph and deleted text, a merged cell", async ({
  page,
}) => {
  const doc = sample() as { stories: Json };
  const change = { id: 90, author: "Someone", date: "2026-01-01T00:00:00Z" };
  const cell = (content: Json[], attrs?: Json) => ({
    type: "tableCell",
    ...(attrs ? { attrs } : {}),
    content,
  });
  doc.stories = {
    h1: {
      kind: "header",
      content: {
        type: "doc",
        content: [
          // Its mark deleted: in the final view it joins the next paragraph.
          { type: "paragraph", attrs: { revision: { deletion: change } }, content: [text("Gone")] },
          {
            type: "paragraph",
            content: [
              text("Left "),
              { type: "text", text: "removed ", marks: [{ type: "deletion", attrs: change }] },
              text("cat right"),
            ],
          },
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [cell([paragraph("Top")], { vMerge: "restart" }), cell([paragraph("A")])],
              },
              {
                type: "tableRow",
                content: [
                  cell([paragraph("covered")], { vMerge: "continue" }),
                  cell([paragraph("dog")]),
                ],
              },
            ],
          },
          paragraph("end"),
        ],
      },
    },
  };
  await page.goto("/edit.html?toolbar");
  await page.waitForFunction(() => !!window.foliEdit);
  await page.evaluate((d) => window.foliEdit.load(d as never), doc);
  await page.evaluate(() => window.foliEdit.editor.commands.setReviewView("final"));
  // The header drawn again for the final view: its two first paragraphs as one.
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".foli-region-content")].some((r) =>
      /GoneLeft cat right/.test(r.textContent ?? ""),
    ),
  );
  // Where "cat" and "dog" are in the story's own positions.
  const at = (needle: string) =>
    page.evaluate((n) => {
      let found: [number, number] | null = null;
      window.foliEdit.editor.story("h1")?.state.doc.descendants((node, pos) => {
        if (!found && node.isTextblock && node.textContent.includes(n)) {
          const i = pos + 1 + node.textContent.indexOf(n);
          found = [i, i + n.length];
        }
        return !found;
      });
      return found as unknown as [number, number];
    }, needle);
  const [catFrom, catTo] = await at("cat");
  expect(await hint(page, { story: "h1", from: catFrom, to: catTo }, 3000)).toBe(true);
  expect(new Set(await marks(page))).toEqual(new Set(["cat"]));
  const [dogFrom, dogTo] = await at("dog");
  expect(await hint(page, { story: "h1", from: dogFrom, to: dogTo }, 3000)).toBe(true);
  expect(new Set(await marks(page))).toEqual(new Set(["dog"]));
});

test("in a header's table, a cell's paragraph with a deleted mark is not joined (final view)", async ({
  page,
}) => {
  const doc = sample() as { stories: Json };
  const change = { id: 91, author: "Someone", date: "2026-01-01T00:00:00Z" };
  doc.stories = {
    h1: {
      kind: "header",
      content: {
        type: "doc",
        content: [
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    content: [
                      {
                        type: "paragraph",
                        attrs: { revision: { deletion: change } },
                        content: [text("Gone")],
                      },
                      paragraph("Kept"),
                    ],
                  },
                ],
              },
            ],
          },
          paragraph("the cat line"),
        ],
      },
    },
  };
  await page.goto("/edit.html?toolbar");
  await page.waitForFunction(() => !!window.foliEdit);
  await page.evaluate((d) => window.foliEdit.load(d as never), doc);
  await page.evaluate(() => window.foliEdit.editor.commands.setReviewView("final"));
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".foli-region-content")].some((r) =>
      /the cat line/.test(r.textContent ?? ""),
    ),
  );
  const [from, to] = await page.evaluate(() => {
    let found: [number, number] = [0, 0];
    window.foliEdit.editor.story("h1")?.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === "the cat line") found = [pos + 5, pos + 8];
      return true;
    });
    return found;
  });
  expect(await hint(page, { story: "h1", from, to }, 3000)).toBe(true);
  expect(new Set(await marks(page))).toEqual(new Set(["cat"]));
});
