/**
 * Phase 10.1 spike (ADR-0006): what browsers do natively with a table split across two pages in
 * one contenteditable host (header row repeated as non-editable content, one row split at a
 * line). Each experiment records where the caret or selection lands; the asserted facts are
 * the ones ADR-0006's decisions rest on, and the rest is written to the test output.
 */
import { expect, type Page, test } from "@playwright/test";

/** Where the selection's focus is: the id of the paragraph holding it (or "header" inside a
 * repeated header row), and the offset. */
const focus = (page: Page) =>
  page.evaluate(() => {
    const sel = getSelection();
    const node = sel?.focusNode;
    const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
    const header = !!element?.closest("thead[contenteditable=false]");
    return {
      id: header ? "header" : element?.closest("p")?.id || element?.nodeName || null,
      offset: sel?.focusOffset ?? -1,
      ranges: sel?.rangeCount ?? 0,
    };
  });

/** Presses `key` `times` times, recording where the focus is after each press. */
async function presses(page: Page, key: string, times: number) {
  const out: string[] = [];
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    const at = await focus(page);
    out.push(`${at.id}:${at.offset}${at.ranges > 1 ? `(${at.ranges} ranges)` : ""}`);
  }
  return out.join(" -> ");
}

async function caretAt(page: Page, id: string, offset: number | "end") {
  await page.evaluate(
    ([target, at]) => {
      const p = document.getElementById(target as string) as HTMLElement;
      const text = p.firstChild ?? p;
      const n = at === "end" ? (text.textContent?.length ?? 0) : (at as number);
      getSelection()?.collapse(text, n);
    },
    [id, offset] as const,
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/tables.html");
  await page.locator("#editor").focus();
});

test("ArrowRight at the end of a cell's text goes to the next cell", async ({ page }, info) => {
  await caretAt(page, "a1", "end");
  await page.keyboard.press("ArrowRight");
  const at = await focus(page);
  info.annotations.push({ type: "observed", description: JSON.stringify(at) });
  // Native: the caret leaves the cell (to the next cell's start).
  expect(at.id).toBe("b1");
});

test("ArrowDown from the last row on page 1, press by press", async ({ page }, info) => {
  await caretAt(page, "a3", 3);
  info.annotations.push({ type: "observed", description: await presses(page, "ArrowDown", 3) });
  // Recorded, not asserted: native vertical movement differs between engines.
});

test("ArrowUp from the first row on page 2, press by press", async ({ page }, info) => {
  await caretAt(page, "a3b", 2);
  info.annotations.push({ type: "observed", description: await presses(page, "ArrowUp", 2) });
});

test("typing in a cell on the second page stays in that cell's paragraph", async ({ page }) => {
  await caretAt(page, "a4", "end");
  await page.keyboard.type("!");
  await expect(page.locator("#a4")).toHaveText("Dates!");
});

test("Shift+ArrowDown from a cell, press by press", async ({ page }, info) => {
  await caretAt(page, "a1", 2);
  info.annotations.push({
    type: "observed",
    description: await presses(page, "Shift+ArrowDown", 2),
  });
});

test("a mouse drag across cells: one range or several", async ({ page }, info) => {
  const from = await page.locator("#a1").boundingBox();
  const to = await page.locator("#b2").boundingBox();
  if (!from || !to) throw new Error("no boxes");
  await page.mouse.move(from.x + 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width - 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  const ranges = await page.evaluate(() => getSelection()?.rangeCount ?? 0);
  info.annotations.push({ type: "observed", description: `${ranges} range(s)` });
});

test("a click in the repeated header: where the caret goes", async ({ page }, info) => {
  await page.locator("section:nth-of-type(2) thead th").first().click();
  const at = await focus(page);
  info.annotations.push({ type: "observed", description: JSON.stringify(at) });
  const inHeader = await page.evaluate(() => {
    const node = getSelection()?.focusNode;
    const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
    return !!element?.closest("thead[contenteditable=false]");
  });
  info.annotations.push({ type: "caret in repeated header", description: String(inHeader) });
});

test("Enter in a cell: what the browser would insert", async ({ page }, info) => {
  await caretAt(page, "b1", "end");
  const before = await page.locator("tbody tr").first().innerHTML();
  await page.keyboard.press("Enter");
  const after = await page.locator("tbody tr").first().innerHTML();
  info.annotations.push({ type: "observed", description: after === before ? "nothing" : after });
  // The view handles Enter itself (beforeinput): recorded to show what it must prevent.
});
