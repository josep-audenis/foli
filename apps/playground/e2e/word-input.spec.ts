/**
 * Clipboard and input on a schema v3 document (8.7c): T3 and T4 on Word's model, on the editing
 * page (`/edit.html`). Real IME and dead keys need real platforms (docs/testing/ime.md); the
 * composition tests drive Chromium's IME emulation (CDP), which mutates the DOM as one does.
 */
import { readFileSync } from "node:fs";
import { type CDPSession, expect, type Page, test } from "@playwright/test";

const MOD = "ControlOrMeta";

type Json = Record<string, unknown>;
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });

/** Word's Normal and Heading 1, a numbered list, A4 with inch margins, the given paragraphs. */
function documentOf(blocks: Json[]): Json {
  return {
    schemaVersion: 3,
    section: {
      pageSize: { width: 11906, height: 16838 },
      margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
    },
    defaults: { paragraph: { spacing: { after: 160 } } },
    styles: [
      { id: "Normal", type: "paragraph", name: "Normal", isDefault: true },
      {
        id: "Heading1",
        type: "paragraph",
        name: "heading 1",
        basedOn: "Normal",
        next: "Normal",
        paragraph: { keepNext: true, outlineLevel: 0 },
        run: [{ type: "bold" }, { type: "fontSize", attrs: { value: 32 } }],
      },
    ],
    numbering: {
      abstracts: [{ id: 0, levels: [{ level: 0, start: 1, format: "decimal", text: "%1." }] }],
      instances: [{ id: 1, abstract: 0 }],
    },
    comments: [],
    content: { type: "doc", content: blocks },
  };
}

const text = (value: string, ...marks: string[]): Json => ({
  type: "text",
  text: value,
  ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
});
const paragraph = (attrs: Json, ...content: Json[]): Json => ({
  type: "paragraph",
  ...(Object.keys(attrs).length ? { attrs } : {}),
  ...(content.length ? { content } : {}),
});
const numbered = { numbering: { id: 1, level: 0 } };

async function open(page: Page, blocks: Json[]): Promise<void> {
  await page.goto("/edit.html");
  await page.waitForFunction(() => "foliEdit" in window);
  await page.evaluate((doc) => window.foliEdit.load(doc as never), documentOf(blocks));
  await editor(page).focus();
}

/** The whole document, its envelope included. */
const documentNow = (page: Page) =>
  page.evaluate(() => window.foliEdit.editor.getDocument() as unknown as Json);
const content = async (page: Page) =>
  ((await documentNow(page)).content as { content: Json[] }).content;
const texts = (page: Page) => editor(page).locator(".foli-page > *").allTextContents();

/** Dispatches a paste with the given clipboard types, as the browser would (deterministic). */
async function paste(page: Page, types: Record<string, string>): Promise<void> {
  await editor(page).evaluate((host, data) => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: (type: string) => data[type] ?? "", types: Object.keys(data) },
    });
    host.dispatchEvent(event);
  }, types);
}

test("T3 on v3: copy and paste inside the editor keep styles, lists and marks", async ({
  page,
  browserName,
}) => {
  // Measured: Playwright's WebKit on Windows lists the types in a paste event but getData()
  // returns "" for each; Playwright's Firefox keeps text and HTML but drops Foli's own type (the
  // HTML read-back is in the unit tests). Both browsers are in the manual checklist
  // (docs/testing/ime.md).
  test.skip(browserName !== "chromium", "no Foli clipboard type in Playwright WebKit or Firefox");
  await open(page, [
    paragraph({ style: "Heading1" }, text("Head")),
    paragraph(numbered, text("one "), text("two", "bold")),
    paragraph({}),
  ]);
  // The heading and the item, whole.
  await page.keyboard.press(`${MOD}+Home`);
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press(`${MOD}+c`);
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.press(`${MOD}+v`);
  await expect
    .poll(() => content(page))
    .toEqual([
      paragraph({ style: "Heading1" }, text("Head")),
      paragraph(numbered, text("one "), text("two", "bold")),
      paragraph({ style: "Heading1" }, text("Head")),
      paragraph(numbered, text("one "), text("two", "bold")),
    ]);
  // The pasted item goes on numbering the list.
  await expect.poll(() => texts(page)).toEqual(["Head", "1.\tone two", "Head", "2.\tone two"]);
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => texts(page)).toEqual(["Head", "1.\tone two", ""]);
});

test("T3 on v3: the HTML it copies keeps Word's list markup and reads back as lists", async ({
  page,
}) => {
  await open(page, [
    paragraph({ style: "Heading1" }, text("Head")),
    paragraph(numbered, text("a")),
  ]);
  // The HTML the view writes on copy, read inside the event (as the clipboard gets it).
  await page.evaluate(() => {
    window.addEventListener("copy", (event) => {
      (window as unknown as { copied: string }).copied =
        event.clipboardData?.getData("text/html") ?? "";
    });
  });
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press(`${MOD}+c`);
  const html = await page.evaluate(() => (window as unknown as { copied: string }).copied);
  expect(html).toMatch(/<h1[^>]*>/);
  expect(html).toMatch(/mso-list:l1 level1 lfo1/);
  expect(html).toMatch(/mso-list:Ignore/);
  await page.evaluate(() => window.foliEdit.editor.commands.selectAll());
  await paste(page, { "text/html": html });
  const [heading, item] = await content(page);
  expect(heading?.attrs).toEqual({ style: "Heading1" });
  expect(heading?.content).toEqual([text("Head")]);
  expect(((item?.attrs ?? {}) as Json).style).toBe("ListParagraph");
  expect((((item?.attrs ?? {}) as Json).numbering as Json).level).toBe(0);
  // Numbered again (Word's levels: the number sits in the hanging indent, no tab character).
  await expect.poll(() => texts(page)).toEqual(["Head", "1.a"]);
});

test("T3 on v3: Word's HTML maps to Word's styles and lists", async ({ page }) => {
  await open(page, [paragraph({})]);
  const html = readFileSync("packages/view/fixtures/clipboard/word-lists.html", "utf8");
  await paste(page, { "text/html": html, "text/plain": "ignored when HTML is readable" });
  const doc = await documentNow(page);
  const blocks = (doc.content as { content: Json[] }).content;
  const attrs = blocks.map((b) => (b.attrs ?? {}) as Json);
  // Numbered paragraphs in List Paragraph (added: the document lacked it), with levels.
  const items = attrs.filter((a) => a.numbering);
  expect(items.length).toBeGreaterThan(2);
  expect(items.every((a) => a.style === "ListParagraph")).toBe(true);
  expect(new Set(items.map((a) => (a.numbering as { level: number }).level)).size).toBeGreaterThan(
    1,
  );
  const styles = (doc.styles as { id: string }[]).map((s) => s.id);
  expect(styles).toContain("ListParagraph");
  // The pasted lists show their numbers.
  await expect(editor(page).locator("[contenteditable=false]").first()).toBeVisible();
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => content(page)).toEqual([paragraph({})]);
});

test("T3 on v3: pasted HTML never runs scripts or loads images", async ({ page }) => {
  await open(page, [paragraph({})]);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.evaluate(() => {
    (window as unknown as { pwned: boolean }).pwned = false;
  });
  await paste(page, {
    "text/html":
      '<h1>safe<img src="/should-not-load.png" onerror="window.pwned=true"><script>window.pwned=true</script></h1>',
  });
  await expect.poll(() => content(page)).toEqual([paragraph({ style: "Heading1" }, text("safe"))]);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { pwned: boolean }).pwned)).toBe(false);
  expect(requests.filter((url) => url.includes("should-not-load"))).toEqual([]);
  await expect(editor(page).locator("img, script")).toHaveCount(0);
});

test.describe("T4 on v3", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "CDP IME emulation is Chromium-only");

  async function openIME(
    page: Page,
    blocks: Json[],
  ): Promise<{ cdp: CDPSession; warnings: string[] }> {
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning" || message.type() === "error") warnings.push(message.text());
    });
    await open(page, blocks);
    return { cdp: await page.context().newCDPSession(page), warnings };
  }

  /** Composes each step in turn, then commits `commit`. */
  async function compose(cdp: CDPSession, steps: string[], commit: string): Promise<void> {
    for (const value of steps) {
      await cdp.send("Input.imeSetComposition", {
        text: value,
        selectionStart: value.length,
        selectionEnd: value.length,
      });
    }
    await cdp.send("Input.insertText", { text: commit });
  }

  test("an IME composition in a numbered paragraph is committed and undone in one step", async ({
    page,
  }) => {
    const { cdp, warnings } = await openIME(page, [paragraph(numbered)]);
    await page.keyboard.type("Hello ");
    await page.waitForTimeout(600); // close the typing history group
    await compose(cdp, ["に", "にほ", "にほん"], "日本");
    await expect.poll(() => content(page)).toEqual([paragraph(numbered, text("Hello 日本"))]);
    await expect.poll(() => texts(page)).toEqual(["1.\tHello 日本"]);
    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(() => content(page)).toEqual([paragraph(numbered, text("Hello "))]);
    await page.keyboard.press(`${MOD}+y`);
    await page.keyboard.type("!");
    await expect.poll(() => content(page)).toEqual([paragraph(numbered, text("Hello 日本!"))]);
    expect(warnings).toEqual([]);
  });

  test("a dead-key composition in a heading's text keeps the style and the marks", async ({
    page,
  }) => {
    const { cdp, warnings } = await openIME(page, [
      paragraph({ style: "Heading1" }, text("caf", "italic"), text("!")),
    ]);
    await page.keyboard.press(`${MOD}+Home`);
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
    await compose(cdp, ["´"], "é");
    await expect
      .poll(() => content(page))
      .toEqual([paragraph({ style: "Heading1" }, text("café", "italic"), text("!"))]);
    await expect(editor(page).locator("h1")).toHaveText("café!");
    expect(warnings).toEqual([]);
  });

  test("a composition over a selection across paragraphs replaces it", async ({ page }) => {
    const { cdp, warnings } = await openIME(page, [
      paragraph({ style: "Heading1" }, text("one")),
      paragraph(numbered, text("two")),
    ]);
    await page.keyboard.press(`${MOD}+Home`);
    await page.keyboard.press("ArrowRight");
    for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
    await compose(cdp, ["あ"], "亜");
    await expect
      .poll(() => content(page))
      .toEqual([paragraph({ style: "Heading1" }, text("o亜o"))]);
    await page.keyboard.press(`${MOD}+z`);
    await expect
      .poll(() => content(page))
      .toEqual([paragraph({ style: "Heading1" }, text("one")), paragraph(numbered, text("two"))]);
    expect(warnings).toEqual([]);
  });
});
