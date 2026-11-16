/**
 * Tables on pages in the editable view (10.5): the corpus's price schedule (06) opened on the
 * editing page, laid out as Word lays it out (two pages, the header row repeated, the row that
 * may not split moved whole), with its cells' text editable and read back.
 */
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });

async function open(page: Page, name: string): Promise<void> {
  await page.goto("/edit.html");
  await page.waitForFunction(() => "foliEdit" in window);
  const base64 = readFileSync(new URL(name, CORPUS)).toString("base64");
  await page.evaluate((data) => window.foliEdit.loadDocx(data), base64);
  await page.waitForFunction(() => document.querySelectorAll("section.foli-page").length >= 2);
  // Settled: fonts loaded and the relayout they cause drawn.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

/** Per page: the rows of the table it shows, and the repeated header rows among them. */
const pages = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("section.foli-page")].map((section) => ({
      rows: [
        ...section.querySelectorAll(":scope > [data-foli-frame=table] > table > tbody > tr"),
      ].map((tr) => (tr.hasAttribute("data-foli-repeated") ? "header" : (tr.textContent ?? ""))),
    })),
  );

test("the price schedule is on two pages, as in Word, with its header row repeated", async ({
  page,
}) => {
  await open(page, "06-price-schedule.docx");
  const shown = await pages(page);
  expect(shown.length).toBe(2);
  // Word's page 2 starts with the row that may not split ("Support item 34", too tall to fit).
  const second = shown[1]?.rows ?? [];
  expect(second[0]).toBe("header");
  expect(second[1]).toContain("Support item 34 with a longer description");
  expect(shown[0]?.rows.some((r) => r.includes("Support item 33"))).toBe(true);
  // Every row once (the repeated header aside).
  expect([...(shown[0]?.rows ?? []), ...second].filter((r) => r !== "header").length).toBe(41);
});

test("text typed in a cell on the second page goes into its paragraph", async ({ page }) => {
  await open(page, "06-price-schedule.docx");
  const cell = page.locator("td", { hasText: /^Support item 35$/ }).first();
  await cell.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" plus");
  const texts = await page.evaluate(() => {
    const out: string[] = [];
    window.foliEdit.editor.state.doc.descendants((node) => {
      if (node.isTextblock && node.textContent.startsWith("Support item 35"))
        out.push(node.textContent);
    });
    return out;
  });
  expect(texts).toEqual(["Support item 35 plus"]);
  expect(await page.evaluate(() => window.foliEdit.validate())).toBe(true);
  await expect(editor(page)).toContainText("Support item 35 plus");
});

test("a click on the repeated header row puts the caret in the first row below it", async ({
  page,
}) => {
  await open(page, "06-price-schedule.docx");
  await page.locator("[data-foli-repeated] td").first().click();
  const row = await page.evaluate(() => {
    const { selection, doc } = window.foliEdit.editor.state;
    const $pos = doc.resolve(selection.from);
    return $pos.depth >= 2 ? $pos.index(1) : -1;
  });
  // Row 38 (index 37): the first row on page 2.
  expect(row).toBe(37);
});

/** The table row (index) and cell (index) the caret is in. */
const where = (page: Page) =>
  page.evaluate(() => {
    const { selection, doc } = window.foliEdit.editor.state;
    const $pos = doc.resolve(selection.head);
    for (let d = $pos.depth; d > 0; d--)
      if ($pos.node(d).type.name === "tableCell")
        return { row: $pos.index(d - 2), cell: $pos.index(d - 1), text: $pos.parent.textContent };
    return { row: -1, cell: -1, text: $pos.parent.textContent };
  });

test("Tab goes to the next cell; Down from the last row on page 1 goes to the first on page 2", async ({
  page,
}) => {
  await open(page, "06-price-schedule.docx");
  await page
    .locator("td", { hasText: /^Support item 33$/ })
    .first()
    .click();
  await page.keyboard.press("Tab");
  expect(await where(page)).toMatchObject({ row: 36, cell: 2, text: "each" });
  await page.keyboard.press("ArrowDown");
  // Row 38 starts page 2 (under the repeated header).
  expect(await where(page)).toMatchObject({ row: 37, cell: 2 });
  await page.keyboard.press("Shift+Tab");
  expect((await where(page)).cell).toBe(1);
});

test("Up from the header row leaves the table, to the paragraph above it", async ({ page }) => {
  await open(page, "06-price-schedule.docx");
  await page
    .locator("td", { hasText: /^Unit$/ })
    .first()
    .click();
  await page.keyboard.press("ArrowUp");
  expect((await where(page)).row).toBe(-1);
});

/** The model selection's kind and, for cells, how many and the cells marked in the DOM. */
const selected = (page: Page) =>
  page.evaluate(() => {
    const json = window.foliEdit.editor.state.selection.toJSON();
    const cells = (window.foliEdit.editor.state.selection as unknown as { cells?: number[] }).cells;
    return {
      type: json.type,
      cells: cells?.length ?? 0,
      marked: document.querySelectorAll("td.foli-selected-cell").length,
    };
  });

test("a drag across cells selects them; Delete empties them", async ({ page }) => {
  await open(page, "06-price-schedule.docx");
  const from = page.locator("td", { hasText: /^Hardware item 4$/ }).first();
  const to = page.locator("td", { hasText: /^Hardware item 5$/ }).first();
  await from.scrollIntoViewIfNeeded();
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("no cells");
  // Inside each cell's text (a cell's edge can belong to the merged category cell beside it).
  await page.mouse.move(a.x + a.width / 3, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 3, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  // `selectionchange` is asynchronous: the view reads the drag when it arrives.
  await expect.poll(() => selected(page)).toEqual({ type: "cell", cells: 2, marked: 2 });
  await page.keyboard.press("Delete");
  const texts = await page.evaluate(() => {
    const out: string[] = [];
    window.foliEdit.editor.state.doc.descendants((node) => {
      if (node.isTextblock && /^Hardware item [45]$/.test(node.textContent))
        out.push(node.textContent);
    });
    return out;
  });
  expect(texts).toEqual([]);
  expect(await page.evaluate(() => window.foliEdit.validate())).toBe(true);
});

test("Shift+Down from a cell's last line selects cells; Shift+Right widens them", async ({
  page,
}) => {
  await open(page, "06-price-schedule.docx");
  await page
    .locator("td", { hasText: /^Hardware item 3$/ })
    .first()
    .click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+ArrowDown");
  expect(await selected(page)).toEqual({ type: "cell", cells: 2, marked: 2 });
  await page.keyboard.press("Shift+ArrowRight");
  expect(await selected(page)).toEqual({ type: "cell", cells: 4, marked: 4 });
});

test("a paste over selected cells goes into the anchor cell; the table stays", async ({ page }) => {
  await open(page, "06-price-schedule.docx");
  await page
    .locator("td", { hasText: /^Hardware item 3$/ })
    .first()
    .click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowRight");
  expect((await selected(page)).cells).toBe(4);
  const tables = () =>
    page.evaluate(() => {
      let count = 0;
      window.foliEdit.editor.state.doc.descendants((node) => {
        if (node.type.name === "table") count++;
      });
      return count;
    });
  const before = await tables();
  await page.evaluate(() =>
    window.foliEdit.view.paste({ getData: (type: string) => (type === "text/plain" ? "Z" : "") }),
  );
  expect(await tables()).toBe(before);
  await expect(page.locator("td", { hasText: /^Z$/ })).toHaveCount(1);
  await expect(page.locator("td", { hasText: /^Hardware item 4$/ })).toHaveCount(1);
  expect(await page.evaluate(() => window.foliEdit.validate())).toBe(true);
});

// ---------- copy, cut and paste of cells; T1–T5 in cells (10.6d) ----------

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const cellOf = (page: Page, value: string) =>
  page.locator("td", { hasText: new RegExp(`^${value}$`) }).first();
/** The document's content JSON. */
const docJSON = (page: Page) =>
  page.evaluate(() => JSON.stringify(window.foliEdit.editor.state.doc.toJSON()));
const modelSelection = (page: Page) =>
  page.evaluate(() => window.foliEdit.editor.state.selection.toJSON());
/** The texts of the paragraphs of the cell holding the selection's head. */
const headCell = (page: Page) =>
  page.evaluate(() => {
    const { selection } = window.foliEdit.editor.state;
    const $pos = selection.$head;
    for (let d = $pos.depth; d > 0; d--)
      if ($pos.node(d).type.name === "tableCell") {
        const out: string[] = [];
        $pos.node(d).forEach((p) => {
          out.push(p.textContent);
        });
        return out;
      }
    return null;
  });
const count = (page: Page, value: string) =>
  page.evaluate((v) => {
    let n = 0;
    window.foliEdit.editor.state.doc.descendants((node) => {
      if (node.isTextblock && node.textContent === v) n++;
    });
    return n;
  }, value);

/** Selects the cell holding `from` and the one below it (Shift+Down from its last line). */
async function selectDown(page: Page, from: string): Promise<void> {
  await cellOf(page, from).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+ArrowDown");
  await expect.poll(async () => (await modelSelection(page)).type).toBe("cell");
}

/** Copies (or cuts) through a dispatched event, as the browser would; returns the data set. */
const clipboard = (page: Page, type: "copy" | "cut") =>
  editor(page).evaluate((host, kind) => {
    const store: Record<string, string> = {};
    const event = new Event(kind, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { setData: (k: string, v: string) => (store[k] = v), getData: () => "" },
    });
    host.dispatchEvent(event);
    return store;
  }, type);
const paste = (page: Page, data: Record<string, string>) =>
  editor(page).evaluate((host, types) => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: (type: string) => types[type] ?? "", types: Object.keys(types) },
    });
    host.dispatchEvent(event);
  }, data);

test("cells copied and pasted into another cell fill the cells from there; undo restores", async ({
  page,
}) => {
  await open(page, "06-price-schedule.docx");
  const original = await docJSON(page);
  await selectDown(page, "Hardware item 3");
  const data = await clipboard(page, "copy");
  expect(data["text/plain"]).toBe("Hardware item 3\nHardware item 4");
  await cellOf(page, "Support item 33").click();
  await paste(page, data);
  await expect.poll(() => count(page, "Hardware item 3")).toBe(2);
  expect(await count(page, "Support item 33")).toBe(0);
  expect(await count(page, "Hardware item 4")).toBe(2);
  expect(await page.evaluate(() => window.foliEdit.validate())).toBe(true);
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => docJSON(page)).toBe(original);
});

test("cut empties the selected cells and keeps their text on the clipboard", async ({ page }) => {
  await open(page, "06-price-schedule.docx");
  await selectDown(page, "Hardware item 3");
  const data = await clipboard(page, "cut");
  expect(data["text/plain"]).toBe("Hardware item 3\nHardware item 4");
  await expect.poll(() => count(page, "Hardware item 3")).toBe(0);
  expect(await count(page, "Hardware item 4")).toBe(0);
  expect(await page.evaluate(() => window.foliEdit.validate())).toBe(true);
});

test("Ctrl+C and Ctrl+V of cells through the system clipboard", async ({ page, browserName }) => {
  // Playwright's Firefox and WebKit drop Foli's own clipboard type (see word-input.spec.ts).
  test.skip(browserName !== "chromium", "no Foli clipboard type in Playwright WebKit or Firefox");
  await open(page, "06-price-schedule.docx");
  await selectDown(page, "Hardware item 3");
  await page.keyboard.press(`${MOD}+c`);
  await cellOf(page, "Support item 33").click();
  await page.keyboard.press(`${MOD}+v`);
  await expect.poll(() => count(page, "Hardware item 3")).toBe(2);
  expect(await page.evaluate(() => window.foliEdit.validate())).toBe(true);
});

test("T1 in a cell: typing and formatting keep a valid document after every keystroke", async ({
  page,
}) => {
  await open(page, "06-price-schedule.docx");
  await cellOf(page, "Hardware item 3").click();
  await page.keyboard.press("End");
  const steps = [" x", `${MOD}+b`, "bold", `${MOD}+b`, "Enter", "next", "Backspace", "Backspace"];
  const keys = new Set(["Enter", "Backspace"]);
  for (const step of steps) {
    const presses = keys.has(step) || step.startsWith(MOD) ? [step] : [...step];
    for (const press of presses) {
      if (press.length === 1) await page.keyboard.type(press);
      else await page.keyboard.press(press);
      expect(await page.evaluate(() => window.foliEdit.validate()), `after ${press}`).toBe(true);
    }
  }
  await expect.poll(() => headCell(page)).toEqual(["Hardware item 3 xbold", "ne"]);
  // "bold" is bold, in the cell's first paragraph.
  const marks = await page.evaluate(() => {
    const out: string[] = [];
    window.foliEdit.editor.state.doc.descendants((node) => {
      if (node.isText && node.text === "bold") out.push(...node.marks.map((m) => m.type.name));
    });
    return out;
  });
  expect(marks).toContain("bold");
});

test("T2 in a cell: a selection across mixed formatting is replaced, then undone exactly", async ({
  page,
}) => {
  await open(page, "06-price-schedule.docx");
  await cellOf(page, "Hardware item 3").click();
  await page.keyboard.press("End");
  await page.keyboard.press(`${MOD}+b`);
  await page.keyboard.type("B");
  await page.keyboard.press(`${MOD}+b`);
  await page.waitForTimeout(600); // close the typing history group
  // " 3B": plain text and the bold B (Firefox's Shift+Home after typing in a cell does not
  // extend; recorded in docs/architecture.md).
  // Firefox stops twice at the edge between two runs: pressed until three characters are in.
  const length = async () => {
    const { anchor, head } = await modelSelection(page);
    return anchor - head;
  };
  for (let i = 0; i < 6 && (await length()) < 3; i++) {
    await page.keyboard.press("Shift+ArrowLeft");
    await page.waitForTimeout(50);
  }
  expect(await length()).toBe(3);
  const before = { doc: await docJSON(page), selection: await modelSelection(page) };
  await page.keyboard.type("Z");
  await expect.poll(() => headCell(page)).toEqual(["Hardware itemZ"]);
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => docJSON(page)).toBe(before.doc);
  expect(await modelSelection(page)).toEqual(before.selection);
});

test("T3 in a cell: pasted HTML goes into the cell, never out of the table", async ({ page }) => {
  await open(page, "06-price-schedule.docx");
  await cellOf(page, "Hardware item 3").click();
  await page.keyboard.press("End");
  await paste(page, {
    "text/html": "<p>one <b>two</b></p><p>three</p><script>window.hacked = 1</script>",
    "text/plain": "one two\nthree",
  });
  await expect.poll(() => headCell(page)).toEqual(["Hardware item 3one two", "three"]);
  expect(await page.evaluate(() => (window as unknown as { hacked?: number }).hacked)).toBe(
    undefined,
  );
  expect(await page.evaluate(() => window.foliEdit.validate())).toBe(true);
});

test("T4 in a cell: an IME composition is committed and undone in one step", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CDP IME emulation is Chromium-only");
  await open(page, "06-price-schedule.docx");
  await cellOf(page, "Hardware item 3").click();
  await page.keyboard.press("End");
  await page.waitForTimeout(600);
  const original = await docJSON(page);
  const cdp = await page.context().newCDPSession(page);
  for (const value of ["に", "にほ", "にほん"])
    await cdp.send("Input.imeSetComposition", {
      text: value,
      selectionStart: value.length,
      selectionEnd: value.length,
    });
  await cdp.send("Input.insertText", { text: "日本" });
  await expect.poll(() => headCell(page)).toEqual(["Hardware item 3日本"]);
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => docJSON(page)).toBe(original);
});

test("T5 in a table: cells selected across the page break are emptied and undone exactly", async ({
  page,
}) => {
  await open(page, "06-price-schedule.docx");
  const original = await docJSON(page);
  // Row 37 ends page 1; Shift+Down selects its cell and the one below it, on page 2.
  await selectDown(page, "Support item 33");
  const marked = await page.evaluate(() =>
    [...document.querySelectorAll("td.foli-selected-cell")].map((td) =>
      [...document.querySelectorAll("section.foli-page")].findIndex((s) => s.contains(td)),
    ),
  );
  expect(marked).toEqual([0, 1]);
  await page.keyboard.press("Delete");
  await expect.poll(() => count(page, "Support item 33")).toBe(0);
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => docJSON(page)).toBe(original);
});

// ---------- column borders (10.7c) ----------

/** The first top-level table's grid, and its first column's right border on the screen. */
const firstBorder = (page: Page) =>
  page.evaluate(() => {
    let grid: number[] = [];
    window.foliEdit.editor.state.doc.forEach((node) => {
      if (!grid.length && node.type.name === "table") grid = node.attrs.grid as number[];
    });
    const table = document.querySelector("section.foli-page table[data-foli-frame]") as HTMLElement;
    const rect = table.getBoundingClientRect();
    const perTwip = rect.width / grid.reduce((a, b) => a + b, 0);
    return {
      grid,
      perTwip,
      x: rect.left + (grid[0] ?? 0) * perTwip,
      y: rect.top + Math.min(rect.height / 2, 60),
    };
  });

test("dragging a column border sets the column's width; the next column gives it", async ({
  page,
}) => {
  await open(page, "06-price-schedule.docx");
  const before = await firstBorder(page);
  await page.mouse.move(before.x, before.y);
  await expect
    .poll(() => editor(page).evaluate((host) => (host as HTMLElement).style.cursor))
    .toBe("col-resize");
  await page.mouse.down();
  await page.mouse.move(before.x + 40, before.y, { steps: 4 });
  await expect(page.locator("body > div[aria-hidden=true]")).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator("body > div[aria-hidden=true]")).toHaveCount(0);
  const after = await firstBorder(page);
  const moved = (after.grid[0] ?? 0) - (before.grid[0] ?? 0);
  // 40 px, in twips (within rounding).
  expect(Math.abs(moved - 40 / before.perTwip)).toBeLessThan(30);
  expect((after.grid[1] ?? 0) - (before.grid[1] ?? 0)).toBe(-moved);
  expect(await page.evaluate(() => window.foliEdit.validate())).toBe(true);
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(async () => (await firstBorder(page)).grid).toEqual(before.grid);
});

test("Escape cancels a column border drag", async ({ page }) => {
  await open(page, "06-price-schedule.docx");
  const before = await firstBorder(page);
  await page.mouse.move(before.x, before.y);
  await page.mouse.down();
  await page.mouse.move(before.x + 40, before.y, { steps: 4 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect((await firstBorder(page)).grid).toEqual(before.grid);
});
