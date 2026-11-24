import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

/**
 * The collab example (22.11): two browsers over WebSocket edit one paragraph and converge, see
 * each other's text, carets and names; tracked changes carry each user's name; one drops its
 * connection, edits, comes back and catches up; the exported .docx opens.
 */

async function open(page: Page, name: string): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/?name=${name}`);
  await expect(page.locator("#who")).toHaveText(`You are ${name}.`);
  expect(errors).toEqual([]);
}

const paragraph = (page: Page) => page.locator("#editor p").first();

/** Both pages end with the same text (each may still be receiving). */
async function converged(a: Page, b: Page): Promise<string> {
  await expect
    .poll(async () => (await paragraph(a).textContent()) === (await paragraph(b).textContent()))
    .toBe(true);
  return (await paragraph(a).textContent()) ?? "";
}

/** Puts the caret in the first paragraph, `offset` characters in, and types `text`. */
async function typeAt(page: Page, offset: number, text: string): Promise<void> {
  await page.evaluate((at) => {
    const p = document.querySelector("#editor p");
    if (!p) throw new Error("no paragraph");
    // The text node `at` characters in, across the runs a change splits the text into.
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    let left = at;
    while (node && left > node.length) {
      left -= node.length;
      const next = walker.nextNode() as Text | null;
      if (!next) break;
      node = next;
    }
    if (!node) throw new Error("no text");
    const range = document.createRange();
    range.setStart(node, Math.min(left, node.length));
    range.collapse(true);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, offset);
  await page.keyboard.type(text);
}

test("two people edit one paragraph and converge", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await open(a, "Ann");
  await open(b, "Bob");
  await paragraph(a).click();
  await paragraph(b).click();
  await typeAt(a, 0, "Ann ");
  await typeAt(b, 4, " Bob");
  await expect(paragraph(a)).toHaveText(/Ann .*Bob|Bob.*Ann /);
  await converged(a, b);
  // Each sees the other: the name in the list and a caret labelled with it.
  await expect(a.locator("#people")).toContainText("Bob");
  await expect(b.locator("#people")).toContainText("Ann");
  // The named one: other browsers' runs share the server, and their people show too.
  await expect(a.locator("[data-foli-peer]", { hasText: "Bob" }).first()).toBeAttached();
  await expect(b.locator("[data-foli-peer]", { hasText: "Ann" }).first()).toBeAttached();

  // Tracked: each change in its author's name. (The server's document may say so already.)
  if ((await a.locator("#track").getAttribute("aria-pressed")) !== "true")
    await a.locator("#track").click();
  await expect(b.locator("#track")).toHaveAttribute("aria-pressed", "true");
  await typeAt(a, 0, "X");
  await typeAt(b, 1, "Y");
  await converged(a, b);
  for (const page of [a, b])
    for (const who of ["Ann", "Bob"])
      await expect(page.locator(`#editor [title^="Inserted by ${who}"]`).first()).toBeAttached();

  // Bob drops his connection, types, comes back: both converge.
  await b.locator("#connection").click();
  await typeAt(b, 2, "offline ");
  await typeAt(a, 0, "online ");
  await b.locator("#connection").click();
  await expect(paragraph(b)).toContainText("online ");
  await expect(paragraph(a)).toContainText("offline ");
  await converged(a, b);

  // The exported .docx opens (read back by @folijs/docx in Node).
  const [download] = await Promise.all([a.waitForEvent("download"), a.locator("#export").click()]);
  const path = await download.path();
  // The example's own install of the packed package (the e2e folder has none).
  const docx = new URL("../collab/node_modules/@folijs/docx/dist/index.js", import.meta.url);
  const { importDocx } = (await import(docx.href)) as typeof import("@folijs/docx");
  const imported = await importDocx(new Uint8Array(await readFile(path)));
  expect(JSON.stringify(imported.document.content)).toContain("offline");
  expect(JSON.stringify(imported.document.content)).toContain('"author":"Bob"');
});
