/**
 * Phase 11.1 spike (ADR-0007): a header and a footnote edited in place, the host turned off
 * while a story is the editing host, and a footnote following its reference across pages. The
 * asserted facts are the ones ADR-0007 rests on; the editable-island variant is only recorded.
 */
import { expect, type Page, test } from "@playwright/test";

type Spike = { model: { lines: string[] }; insertLines(n: number): void };
const spike = () => (window as unknown as { __spike: Spike }).__spike;

const header = (page: Page, n: number) => page.locator(".page").nth(n).locator(".header");
const note = (page: Page) => page.locator("#note");
const pageOf = (page: Page, id: string) =>
  page.evaluate(
    (target) =>
      [...document.querySelectorAll(".page")].indexOf(
        document.getElementById(target)?.closest(".page") as Element,
      ),
    id,
  );
/** The focus: the story or line holding it and the text offset from that element's start. */
const focus = (page: Page) =>
  page.evaluate(() => {
    const sel = getSelection() as Selection;
    const node = sel.focusNode as Node;
    const element = (node.nodeType === Node.TEXT_NODE ? node.parentElement : node) as Element;
    const holder = element.closest(".header, #note, p") as HTMLElement | null;
    if (!holder) return { in: element.nodeName, offset: -1, active: "" };
    const range = document.createRange();
    range.selectNodeContents(holder);
    range.setEnd(node, sel.focusOffset);
    const active = document.activeElement as HTMLElement;
    return {
      in: holder.id || holder.className,
      offset: range.toString().length,
      active: active.id || active.className,
    };
  });
const caretInLine = (page: Page, line: number, offset: number) =>
  page.evaluate(
    ([id, at]) => {
      document.getElementById("editor")?.focus();
      getSelection()?.collapse(
        document.getElementById(id as string)?.firstChild as Node,
        at as number,
      );
    },
    [`l${line}`, offset] as const,
  );
/** The line as the page shows it: the model only changes while no story is being edited. */
const lineText = (page: Page, line: number) =>
  page.locator(`#l${line}`).evaluate((p) => p.firstChild?.textContent ?? "");
const MORE = " and some more words so the note takes a second line";

test.beforeEach(async ({ page }) => {
  await page.goto("/stories.html");
});

test("typing in a header goes to the header and every page's copy, not the body", async ({
  page,
}) => {
  await caretInLine(page, 1, 2);
  await header(page, 0).dblclick();
  expect((await focus(page)).in).toBe("header");
  await expect(page.locator("#editor")).toHaveAttribute("contenteditable", "false");
  await page.keyboard.type("XY");
  await expect(header(page, 0)).toHaveText("Header textXY");
  await expect(header(page, 1)).toHaveText("Header textXY");
  expect(await lineText(page, 1)).toBe("Line 1");
});

test("a header on a later page edits the same story", async ({ page }) => {
  await header(page, 1).dblclick();
  await page.keyboard.type("Z");
  await expect(header(page, 0)).toHaveText("Header textZ");
});

test("the caret and select-all stay inside the story", async ({ page }) => {
  await header(page, 0).dblclick();
  for (const key of ["ArrowDown", "ArrowRight", "End", "PageDown", "Control+End"]) {
    await page.keyboard.press(key);
    expect((await focus(page)).in, key).toBe("header");
  }
  for (const key of ["Home", "Control+Home", "ArrowUp", "ArrowLeft", "Backspace"]) {
    await page.keyboard.press(key);
    expect((await focus(page)).in, key).toBe("header");
  }
  await page.keyboard.press("Control+a");
  expect(await page.evaluate(() => getSelection()?.toString())).toBe("Header text");
  await page.keyboard.type("New");
  await expect(header(page, 1)).toHaveText("New");
  expect(await lineText(page, 0)).toBe("Line 0");
});

test("Escape returns to the body at the saved caret", async ({ page }) => {
  await caretInLine(page, 1, 2);
  await header(page, 0).dblclick();
  await page.keyboard.type("H");
  await page.keyboard.press("Escape");
  await expect(page.locator("#editor")).toHaveAttribute("contenteditable", "true");
  expect(await focus(page)).toMatchObject({ in: "l1", offset: 2 });
  await page.keyboard.type("b");
  expect(await lineText(page, 1)).toBe("Libne 1");
  await expect(header(page, 0)).toHaveText("Header textH");
});

test("a click on the body leaves the story and places the caret there", async ({ page }) => {
  await header(page, 0).dblclick();
  await page.locator("#l4").click({ position: { x: 1, y: 12 } });
  await expect(page.locator("#editor")).toHaveAttribute("contenteditable", "true");
  expect((await focus(page)).in).toBe("l4");
  await page.keyboard.type("c");
  expect(await lineText(page, 4)).toContain("c");
  await expect(header(page, 0)).toHaveText("Header text");
});

test("a footnote follows its reference to another page", async ({ page }) => {
  expect(await pageOf(page, "note")).toBe(0);
  await page.evaluate(`(${spike})().insertLines(8)`);
  expect(await pageOf(page, "l11")).toBe(1);
  expect(await pageOf(page, "note")).toBe(1);
});

test("a growing note pushes lines to the next page and keeps the caret", async ({ page }) => {
  expect(await pageOf(page, "l8")).toBe(0);
  await note(page).dblclick();
  await page.keyboard.type(MORE);
  expect(await pageOf(page, "note")).toBe(0);
  expect(await pageOf(page, "l8")).toBe(1);
  expect(await focus(page)).toMatchObject({ in: "note", offset: 7 + MORE.length });
});

test("a note being edited moves with its reference, caret and focus kept", async ({ page }) => {
  await page.goto("/stories.html?ref=8");
  expect(await pageOf(page, "note")).toBe(0);
  await note(page).dblclick();
  await page.keyboard.type(MORE);
  expect(await pageOf(page, "l8")).toBe(1);
  expect(await pageOf(page, "note")).toBe(1);
  expect(await focus(page)).toMatchObject({
    in: "note",
    offset: 7 + MORE.length,
    active: "note",
  });
  await page.keyboard.type("!");
  await expect(note(page)).toHaveText(/second line!$/);
});

test("IME composition in a header, and in a note that moves when committed", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CDP");
  const cdp = await page.context().newCDPSession(page);
  await header(page, 0).dblclick();
  await cdp.send("Input.imeSetComposition", { text: "か", selectionStart: 1, selectionEnd: 1 });
  await cdp.send("Input.insertText", { text: "漢" });
  await expect(header(page, 0)).toHaveText("Header text漢");
  await expect(header(page, 1)).toHaveText("Header text漢");
  await page.goto("/stories.html?ref=8");
  await note(page).dblclick();
  const long = " 漢字".repeat(30);
  await page.evaluate(() => {
    const seen = { composing: false };
    (window as unknown as { seen: typeof seen }).seen = seen;
    document.getElementById("editor")?.addEventListener("input", (event) => {
      if ((event as InputEvent).isComposing) seen.composing = true;
    });
  });
  await cdp.send("Input.imeSetComposition", {
    text: long,
    selectionStart: long.length,
    selectionEnd: long.length,
  });
  await expect(note(page)).toContainText("漢字");
  expect(
    await page.evaluate(
      () => (window as unknown as { seen: { composing: boolean } }).seen.composing,
    ),
  ).toBe(true);
  expect(await pageOf(page, "note")).toBe(0);
  await cdp.send("Input.insertText", { text: long });
  await expect.poll(() => pageOf(page, "note")).toBe(1);
  expect((await focus(page)).in).toBe("note");
});

test("recorded: an editable island inside the still-editable host", async ({ page }, info) => {
  await page.goto("/stories.html?nested=1");
  await caretInLine(page, 1, 2);
  await header(page, 0).dblclick();
  await page.keyboard.type("Q");
  const typed = await header(page, 0).textContent();
  const body = await lineText(page, 1);
  await page.keyboard.press("Control+a");
  const selected = await page.evaluate(() => getSelection()?.toString().length);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  const after = await focus(page);
  info.annotations.push({
    type: "observed",
    description: JSON.stringify({ typed, body, selected, after }),
  });
  console.log(info.project.name, JSON.stringify({ typed, body, selected, after }));
});

type Real = {
  main: { state: { doc: { textContent: string }; tr: never; selection: { toJSON(): unknown } } };
  story: { state: { doc: { textContent: string } } };
  wrapper: HTMLElement;
  mount(): void;
};
const real = (page: Page) =>
  page.evaluate(() => {
    const { main, story, wrapper } = (window as unknown as { __real: Real }).__real;
    return {
      main: main.state.doc.textContent,
      story: story.state.doc.textContent,
      mounted: wrapper.isConnected,
      selection: main.state.selection.toJSON(),
    };
  });

test.describe("a real EditorView mounted on a page of a read-only one", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/story-view.html");
    await page.waitForFunction(() => "__real" in window);
    await page.locator("section.foli-page").first().waitFor();
  });

  test("typing, Enter and Backspace reach the story only, in a non-editable wrapper", async ({
    page,
  }) => {
    const warnings: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "warning") warnings.push(m.text());
    });
    await page.evaluate(() => (window as unknown as { __real: Real }).__real.mount());
    const before = await real(page);
    await page.keyboard.press("Control+End");
    await page.keyboard.type("XY");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Z");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("W");
    const after = await real(page);
    expect(after.story).toBe("HeaderXYW");
    expect(after.main).toBe("Body oneBody two");
    expect(after.mounted).toBe(true);
    expect(after.selection).toEqual(before.selection);
    expect(warnings).toEqual([]);
  });

  test("left alone, the main view removes the mounted story as stray DOM", async ({ page }) => {
    await page.goto("/story-view.html?bare=1");
    await page.waitForFunction(() => "__real" in window);
    await page.locator("section.foli-page").first().waitFor();
    await page.evaluate(() => (window as unknown as { __real: Real }).__real.mount());
    await expect.poll(async () => (await real(page)).mounted).toBe(false);
  });

  test("recorded: what the unchanged main view does around a mounted story", async ({
    page,
  }, info) => {
    await page.evaluate(() => (window as unknown as { __real: Real }).__real.mount());
    await page.keyboard.press("Control+a");
    const copied = await page.evaluate(() => {
      const data = new DataTransfer();
      const event = new ClipboardEvent("copy", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      });
      document.getElementById("story")?.dispatchEvent(event);
      return { text: data.getData("text/plain"), prevented: event.defaultPrevented };
    });
    const selectionAfterSelectAll = (await real(page)).selection;
    const survives = await page.evaluate(() => {
      const r = (window as unknown as { __real: Real }).__real as unknown as {
        main: {
          state: { tr: { insertText(t: string, at: number): unknown } };
          dispatch(t: unknown): void;
        };
        wrapper: HTMLElement;
      };
      r.main.dispatch(r.main.state.tr.insertText("x", 1));
      return r.wrapper.isConnected;
    });
    const observed = { copied, selectionAfterSelectAll, survivesMainRender: survives };
    info.annotations.push({ type: "observed", description: JSON.stringify(observed) });
    console.log(info.project.name, JSON.stringify(observed));
  });
});
