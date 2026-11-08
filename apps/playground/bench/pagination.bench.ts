/**
 * Pagination benchmarks (Phase 5.7): initial layout, keystroke-to-paint and full re-flow for
 * documents of 1 to 200 pages, in each engine. Not part of `pnpm check` or `pnpm test:e2e`:
 * run with `pnpm bench:layout` and read docs/benchmarks.md for the method.
 */
import { expect, test } from "@playwright/test";
import { benchDocument, loadTestFont, routeTestFont } from "../e2e/fixtures.js";

const SIZES = [1, 10, 50, 100, 200];
/** Every size with paragraphs; 100 sections also with each section's paragraphs as a list (7.4). */
const CASES = [
  ...SIZES.map((sections) => ({ sections, lists: false })),
  { sections: 100, lists: true },
];
const MOUNTS = 5;
const TYPED = "the quick brown fox jumps over the lazy dog ".repeat(2);
const ENTERS = 40;
/** Even: as many re-flows into the other font as back into the test font. */
const REFLOWS = 6;

const median = (values: number[]) => percentile(values, 50);
function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN;
}
const round = (value: number) => Math.round(value * 10) / 10;

test.describe.configure({ mode: "serial" });

for (const { sections, lists } of CASES) {
  test(`${sections}-section document${lists ? " with lists" : ""}`, async ({
    page,
    browserName,
  }) => {
    test.setTimeout(600_000);
    await routeTestFont(page);
    await page.goto("/bench.html");
    await loadTestFont(page);
    const json = benchDocument(sections, lists);

    const mounts: { layoutMs: number; paintMs: number; pages: number }[] = [];
    for (let i = 0; i < MOUNTS; i++) {
      mounts.push(await page.evaluate((doc) => window.foliBench.mount(doc), json));
    }
    const pages = mounts[0]?.pages ?? 0;
    expect(mounts.every((mount) => mount.pages === pages)).toBe(true);

    // Into the first paragraph of page 1: a key that changes its line count moves every later
    // page (each Enter does; a typed character rarely does).
    // The first paragraph of the first section's text (a list item's with lists).
    await page
      .locator('[role="textbox"] p')
      .first()
      .click({ position: { x: 2, y: 4 } });
    let lastSeq: number | undefined;
    const keys = async (press: () => Promise<void>, count: number) => {
      const samples: { seq: number; handlerMs: number; paintMs: number }[] = [];
      for (let i = 0; i < count; i++) {
        // Real keys arrive at any point of a frame; pressed right after a paint they would
        // always wait a whole frame. 40-56 ms apart, about a fast typist's pace.
        await page.waitForTimeout(40 + ((i * 7) % 17));
        await press();
        const sample = await page.evaluate(() => window.foliBench.lastKey());
        // One keydown per press, read after it: not the previous key's sample again.
        if (lastSeq !== undefined) expect(sample.seq).toBe(lastSeq + 1);
        lastSeq = sample.seq;
        samples.push(sample);
      }
      return samples;
    };
    let typedChars = 0;
    const typed = await keys(() => page.keyboard.type(TYPED[typedChars++] ?? ""), TYPED.length);
    const enters = await keys(() => page.keyboard.press("Enter"), ENTERS);

    const reflows: { ms: number; pages: number }[] = [];
    for (let i = 0; i < REFLOWS; i++) {
      reflows.push(await page.evaluate(() => window.foliBench.reflow()));
    }

    const paint = (samples: { paintMs: number }[]) => samples.map((sample) => sample.paintMs);
    const handler = (samples: { handlerMs: number }[]) => samples.map((s) => s.handlerMs);
    const result = {
      browser: browserName,
      sections,
      lists,
      pages,
      layoutMs: round(median(mounts.map((mount) => mount.layoutMs))),
      layoutPaintMs: round(median(mounts.map((mount) => mount.paintMs))),
      typeHandlerP50: round(median(handler(typed))),
      typePaintP50: round(median(paint(typed))),
      typePaintP95: round(percentile(paint(typed), 95)),
      enterHandlerP50: round(median(handler(enters))),
      enterPaintP50: round(median(paint(enters))),
      enterPaintP95: round(percentile(paint(enters), 95)),
      reflowMs: round(median(reflows.map((reflow) => reflow.ms))),
      // Pages in the other font, then in the test font again: the font swap re-flowed.
      reflowPages: [reflows[0]?.pages, reflows[1]?.pages],
    };
    console.log(`BENCH ${JSON.stringify(result)}`);
    test.info().annotations.push({ type: "bench", description: JSON.stringify(result) });
  });
}
