/**
 * The corpus run's renderer pass (Phase 20, 20.3; ADR-0011): every file the Node pass imported
 * (`pnpm corpus:run`), laid out by `renderDocument` in Chromium on the Word page. Per file: the
 * pages, the time, an exception (thrown, or a page error), the pages whose content overflows
 * their sheet. Written beside the Node pass's results as `<run>.render.jsonl`; no document text.
 *
 *   pnpm corpus:render            the latest run in `.corpus-cache/results/`
 *                                 (`playwright.corpus.config.ts`; `corpus:pages` leaves it out)
 *   FOLI_CORPUS_RESULTS=<file>    another run's `.jsonl`
 */
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, test } from "@playwright/test";

const ROOT = new URL("../../../", import.meta.url);
const RESULTS = new URL(".corpus-cache/results/", ROOT);
/** Per file: longer is counted as a hang, and the page is opened again. */
const MS = 60_000;

interface Line {
  sha256: string;
  names: string[];
  /** The file the Node pass read. */
  path: string;
  import: string;
}

/** The Node pass's results to follow: the env's, else the latest run's. */
function runFile(): string | null {
  if (process.env.FOLI_CORPUS_RESULTS) return process.env.FOLI_CORPUS_RESULTS;
  if (!existsSync(RESULTS)) return null;
  const runs = readdirSync(RESULTS)
    .filter((f) => f.endsWith(".jsonl") && !f.endsWith(".render.jsonl"))
    .sort();
  const last = runs[runs.length - 1];
  return last ? join(fileURLToPath(RESULTS), last) : null;
}

async function open(page: Page, errors: string[]) {
  page.removeAllListeners("pageerror");
  page.on("pageerror", (error) => errors.push(`${error.name}: ${error.message.slice(0, 120)}`));
  await page.goto("/word.html");
  await page.waitForFunction(() => "foliWord" in window);
}

test("every imported file of the run lays out in Chromium", async ({ browser }) => {
  test.setTimeout(0);
  const run = runFile();
  test.skip(!run, "no corpus run yet: pnpm corpus:run first");
  const lines = readFileSync(run as string, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Line)
    .filter((l) => l.import === "ok");
  const out = (run as string).replace(/\.jsonl$/, ".render.jsonl");
  writeFileSync(out, "");
  let page = await browser.newPage();
  const errors: string[] = [];
  await open(page, errors);
  let done = 0;
  for (const line of lines) {
    if (!existsSync(line.path)) continue;
    const base64 = readFileSync(line.path).toString("base64");
    errors.length = 0;
    const start = Date.now();
    let result: Record<string, unknown>;
    try {
      const shown = await Promise.race([
        page.evaluate(async (data) => {
          const word = (
            window as unknown as { foliWord: { render(d: string, r: string): Promise<unknown> } }
          ).foliWord;
          await word.render(data, "markup");
          const pages = [...document.querySelectorAll<HTMLElement>(".foli-word-page")];
          // A page's content past its sheet: what Word would have put on the next page.
          const overflowing = pages.filter((p) => p.scrollHeight > p.clientHeight + 1).length;
          return { pages: pages.length, overflowing };
        }, base64),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), MS)),
      ]);
      result = { render: errors.length ? "page error" : "ok", ...shown };
    } catch (error) {
      const message = String((error as Error).message);
      result = {
        render:
          message === "timeout" ? "timeout" : /crash|closed/i.test(message) ? "crash" : "error",
        error: message.split("\n")[0]?.slice(0, 160),
      };
      // A hung or crashed tab: a new one for the next file.
      await page.close().catch(() => {});
      page = await browser.newPage();
      await open(page, errors);
    }
    appendFileSync(
      out,
      `${JSON.stringify({ sha256: line.sha256, names: line.names, ms: Date.now() - start, errors: [...errors], ...result })}\n`,
    );
    // A fresh page now and then: one document's leftovers do not weigh on the next.
    if (++done % 200 === 0) {
      await page.close();
      page = await browser.newPage();
      await open(page, errors);
      console.log(`  ${done} / ${lines.length}`);
    }
  }
  await page.close();
  console.log(`render results: ${out}`);
});
