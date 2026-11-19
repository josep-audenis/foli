/**
 * Find on a long document (11.11, tracked by `pnpm bench` since 12.7): the find panel on 1,640
 * paragraphs (about 107 A5 pages), from the input event to the next frame after it, the panel
 * updated and the matches marked. The same document and queries as the e2e test in
 * `e2e/word-navigation.spec.ts`; method and numbers in docs/benchmarks.md.
 */
import { expect, test } from "@playwright/test";

const LINE = "The quick brown fox jumps over the lazy dog and runs across the wide field.";
const QUERIES = ["t", "th", "the", "the ", "the l", "the la", "lazy", "zebra"];
/** Each query typed this many times over (cleared in between); the median is kept. */
const ROUNDS = 5;

const longDocument = {
  schemaVersion: 5,
  section: {
    pageSize: { width: 8391, height: 11906 },
    margins: { top: 1440, right: 1000, bottom: 1440, left: 1000, header: 500, footer: 400 },
  },
  defaults: { paragraph: { spacing: { after: 120 } } },
  styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
  numbering: { abstracts: [], instances: [] },
  comments: [],
  content: {
    type: "doc",
    content: Array.from({ length: 1640 }, (_, i) => ({
      type: "paragraph",
      content: [{ type: "text", text: `${i} ${LINE}` }],
    })),
  },
};

test("find on a hundred pages", async ({ page, browserName }) => {
  test.setTimeout(300_000);
  await page.goto("/edit.html");
  await page.waitForFunction(() => !!window.foliEdit);
  await page.evaluate((doc) => window.foliEdit.load(doc as never), longDocument);
  const editor = page.getByRole("textbox", { name: "Document" });
  await editor.click({ position: { x: 200, y: 200 } });
  const pages = await page.locator(".foli-page").count();
  await page.keyboard.press("ControlOrMeta+f");
  await expect(page.getByRole("dialog", { name: "Find and replace" })).toBeVisible();
  const rounds = await page.evaluate(
    async ([queries, rounds]) => {
      const input = document.querySelector<HTMLInputElement>(".foli-find-panel input");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      const status = document.querySelector(".foli-find-panel [role=status]") as Element;
      const frame = () =>
        new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
      const type = (value: string) => {
        setter?.call(input, value);
        input?.dispatchEvent(new Event("input", { bubbles: true }));
      };
      const out: { query: string; ms: number; found: string }[][] = [];
      for (let round = 0; round < rounds; round++) {
        const times: { query: string; ms: number; found: string }[] = [];
        // Typed one character more each time, as a person types the query.
        for (const query of queries) {
          const start = performance.now();
          type(query);
          await frame();
          times.push({ query, ms: performance.now() - start, found: status.textContent ?? "" });
        }
        out.push(times);
        type("");
        await frame();
      }
      return out;
    },
    [QUERIES, ROUNDS] as const,
  );
  expect(rounds.every((times) => times.at(-1)?.found === "No results")).toBe(true);
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1] ?? NaN;
  const times = Object.fromEntries(
    QUERIES.map((query, i) => [
      query,
      Math.round(median(rounds.map((times) => times[i]?.ms ?? NaN)) * 10) / 10,
    ]),
  );
  const result = { bench: "find", browser: browserName, pages, times };
  console.log(`BENCH ${JSON.stringify(result)}`);
  test.info().annotations.push({ type: "bench", description: JSON.stringify(result) });
});
