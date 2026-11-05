import { expect, type Page, test } from "@playwright/test";

const STORAGE_KEY = "foli-playground-document";
const MOD = "ControlOrMeta";
/** Word movement and deletion: Option on macOS, Ctrl elsewhere. */
const WORD = process.platform === "darwin" ? "Alt" : "Control";

interface Inline {
  type: string;
  text?: string;
  marks?: { type: string }[];
}
interface Block {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Inline[];
}

const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const texts = (page: Page) => editor(page).locator(":scope > *").allTextContents();

/** The model as the playground saved it, or null. Saving is debounced (300 ms): poll it. */
async function saved(page: Page): Promise<Block[] | null> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  return raw ? JSON.parse(raw).content.content : null;
}

/** Each saved block as its plain text (hard breaks as "\n"), or null. */
async function savedTexts(page: Page): Promise<string[] | null> {
  const blocks = await saved(page);
  return blocks?.map((b) => (b.content ?? []).map((i) => i.text ?? "\n").join("")) ?? null;
}

const expectSaved = (page: Page, expected: string[]) =>
  expect.poll(() => savedTexts(page)).toEqual(expected);

async function openEmpty(page: Page): Promise<void> {
  await page.goto("/");
  await editor(page).click();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press("Backspace");
  await expect.poll(() => texts(page)).toEqual([""]);
}

/** Whether the caret is inside the window, below the playground's sticky bar. */
function caretVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const sel = getSelection();
    if (!sel?.focusNode) return false;
    const range = document.createRange();
    range.setStart(sel.focusNode, sel.focusOffset);
    // An element point (next to a <br>) has no rects: measure the <br> after it, else before.
    const { focusNode: node, focusOffset: offset } = sel;
    const near = node.childNodes[offset] ?? node.childNodes[offset - 1];
    const rect =
      range.getClientRects()[0] ??
      (near instanceof Element ? near : (node as Element)).getBoundingClientRect();
    const bar = document.querySelector(".playground-bar")?.getBoundingClientRect().bottom ?? 0;
    return rect.top >= bar - 1 && rect.bottom <= innerHeight + 1;
  });
}

test("Home and End move to the line edges, across marks and hard breaks", async ({ page }) => {
  await openEmpty(page);
  await page.keyboard.type("ab ");
  await page.keyboard.press(`${MOD}+b`);
  await page.keyboard.type("cd");
  await page.keyboard.press(`${MOD}+b`);
  await page.keyboard.type(" ef");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("two");
  await page.keyboard.press("Home");
  await page.keyboard.type("X");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("End");
  await page.keyboard.type("Y");
  await page.keyboard.press("Home");
  await page.keyboard.type("Z");
  await expectSaved(page, ["Zab cd efY\nXtwo"]);
});

test("arrow keys cross block edges and empty blocks", async ({ page }) => {
  await openEmpty(page);
  await page.keyboard.type("abc");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("def");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.type("X");
  await expectSaved(page, ["abc", "X", "def"]);
  await page.keyboard.press("Backspace");
  await page.keyboard.press(`${MOD}+Home`);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("Y");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("Z");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("W");
  await expectSaved(page, ["abc", "YW", "Zdef"]);
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.type("!");
  await expectSaved(page, ["abc", "YW", "Zdef!"]);
});

test("word movement and word deletion follow the browser", async ({ page }) => {
  await openEmpty(page);
  await page.keyboard.type("hello ");
  await page.keyboard.press(`${MOD}+b`);
  await page.keyboard.type("big");
  await page.keyboard.press(`${MOD}+b`);
  await page.keyboard.type(" world");
  await page.keyboard.press(`${WORD}+ArrowLeft`);
  await page.keyboard.press(`${WORD}+ArrowLeft`);
  await page.keyboard.type("X");
  await expectSaved(page, ["hello Xbig world"]);
  await page.keyboard.press("End");
  // Not a keymap binding any more: the browser sends its own word-delete input type.
  await editor(page).evaluate((host) => {
    const types: string[] = [];
    (window as unknown as { inputTypes: string[] }).inputTypes = types;
    host.addEventListener("beforeinput", (event) => {
      if (event.isTrusted) types.push((event as InputEvent).inputType);
    });
  });
  await page.keyboard.press(`${WORD}+Backspace`);
  expect(
    await page.evaluate(() => (window as unknown as { inputTypes: string[] }).inputTypes),
  ).toEqual(["deleteWordBackward"]);
  await expectSaved(page, ["hello Xbig "]);
  await page.keyboard.press("Home");
  await page.keyboard.press(`${WORD}+Delete`);
  await expect.poll(async () => (await savedTexts(page))?.[0]).toMatch(/^ ?Xbig $/);
  await page.keyboard.press("Home");
  await page.keyboard.press(`${WORD}+Shift+ArrowRight`);
  await page.keyboard.type("Y");
  await expect.poll(async () => (await savedTexts(page))?.[0]).toMatch(/^Y ?$/);
});

test("a line delete without a target range deletes to the visual line edge", async ({ page }) => {
  await openEmpty(page);
  await page.keyboard.type("one");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("two three");
  // Synthetic: no target range, so the view asks the browser for the line edge itself.
  const lineDelete = (inputType: string) =>
    editor(page).evaluate((host, type) => {
      host.dispatchEvent(new InputEvent("beforeinput", { inputType: type, cancelable: true }));
    }, inputType);
  await lineDelete("deleteSoftLineBackward");
  await expectSaved(page, ["one\n"]);
  await page.keyboard.type("x");
  await page.keyboard.press(`${MOD}+Home`);
  await lineDelete("deleteSoftLineForward");
  await expectSaved(page, ["\nx"]);
});

test("carets move over whole grapheme clusters; deletes remove them whole", async ({ page }) => {
  await openEmpty(page);
  await page.keyboard.insertText("a👍🏽é👨‍👩‍👧b");
  await page.keyboard.press("ArrowLeft"); // before b
  await page.keyboard.press("ArrowLeft"); // before the family
  await page.keyboard.press("ArrowLeft"); // before é
  await page.keyboard.type("X");
  await expectSaved(page, ["a👍🏽Xé👨‍👩‍👧b"]);
  await page.keyboard.press("Delete");
  await expectSaved(page, ["a👍🏽X👨‍👩‍👧b"]);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Backspace");
  await expectSaved(page, ["aX👨‍👩‍👧b"]);
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Backspace");
  await expectSaved(page, ["aXb"]);
});

test("Backspace and Delete at block and document edges", async ({ page }) => {
  await openEmpty(page);
  await page.keyboard.type("a");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("b");
  await page.keyboard.press("Home");
  await page.keyboard.press("Backspace"); // removes the empty block before
  await expectSaved(page, ["a", "b"]);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Delete"); // joins the next block
  await expectSaved(page, ["ab"]);
  await page.keyboard.press(`${MOD}+Home`);
  await page.keyboard.press("Backspace"); // nothing before the first block
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.press("Delete"); // nothing after the last block
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("c");
  await page.keyboard.press("Home");
  await page.keyboard.press("Backspace"); // the hard break
  await expectSaved(page, ["abc"]);
});

test("a mark toggled at the caret is dropped once the caret moves", async ({ page }) => {
  await openEmpty(page);
  await page.keyboard.type("abc");
  await page.keyboard.press(`${MOD}+b`);
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("ArrowRight"); // back where the mark was toggled
  await page.keyboard.type("X");
  await expect
    .poll(() => saved(page))
    .toEqual([{ type: "paragraph", content: [{ type: "text", text: "abcX" }] }]);
});

test("the caret scrolls into view after typing, Enter and undo", async ({ page }) => {
  await openEmpty(page);
  for (let i = 0; i < 40; i++) {
    await page.keyboard.type(`line ${i}`);
    await page.keyboard.press("Enter");
  }
  await page.keyboard.type("end");
  expect(await caretVisible(page)).toBe(true);

  await page.keyboard.press(`${MOD}+Home`);
  expect(await caretVisible(page)).toBe(true);
  await page.keyboard.press(`${MOD}+z`); // undoes the typing at the bottom
  await expect.poll(() => caretVisible(page)).toBe(true);
  await expect.poll(async () => (await savedTexts(page))?.at(-1)).not.toBe("end");

  await page.evaluate(() => scrollTo(0, 0));
  await page.keyboard.type("x");
  expect(await caretVisible(page)).toBe(true);
});

test("the caret scrolls into view on hard-break lines of a tall paragraph", async ({ page }) => {
  test.slow(); // ~280 keys: about 20 s in WebKit on Windows, past the timeout under parallel load
  await openEmpty(page);
  for (let i = 0; i < 40; i++) {
    await page.keyboard.type(`line ${i}`);
    await page.keyboard.press("Shift+Enter");
  }
  // The caret sits after the last hard break, an element point with no box of its own.
  expect(await caretVisible(page)).toBe(true);
  await page.keyboard.press("Shift+Enter");
  expect(await caretVisible(page)).toBe(true);
});

test("the caret scrolls into view inside a scrollable container", async ({ page }) => {
  await openEmpty(page);
  await page.addStyleTag({ content: ".foli-canvas { height: 300px; overflow: auto; }" });
  for (let i = 0; i < 30; i++) await page.keyboard.press("Enter");
  await page.keyboard.type("end");
  const inside = () =>
    page.evaluate(() => {
      const scroller = document.querySelector(".foli-canvas") as Element;
      const box = scroller.getBoundingClientRect();
      const rect = getSelection()?.getRangeAt(0).getClientRects()[0];
      return !!rect && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1;
    });
  expect(await inside()).toBe(true);
  await page.locator(".foli-canvas").evaluate((el) => el.scrollTo(0, 0));
  await page.keyboard.type("!");
  expect(await inside()).toBe(true);
});

test("T1: typing and formatting keep a valid document after every keystroke", async ({ page }) => {
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") warnings.push(message.text());
  });
  await openEmpty(page);
  /** The host holds only blocks the renderer makes, with only mark elements and <br> inside. */
  const valid = () =>
    editor(page).evaluate((host) => {
      if (!host.childNodes.length) return false;
      return [...host.childNodes].every(
        (block) =>
          block instanceof Element &&
          /^(P|H[1-6])$/.test(block.tagName) &&
          [...block.querySelectorAll("*")].every((el) => /^(STRONG|EM|U|S|BR)$/.test(el.tagName)),
      );
    });
  const steps = [
    "Title",
    "Enter",
    "Some ",
    `${MOD}+b`,
    "bold",
    `${MOD}+i`,
    " both",
    `${MOD}+b`,
    `${MOD}+i`,
    " plain",
    "Shift+Enter",
    "next line",
    "Enter",
    `${MOD}+u`,
    "under",
    "Backspace",
    "Backspace",
    `${MOD}+u`,
    "lined",
    "ArrowLeft",
    "Enter",
    "Backspace",
    "Delete",
  ];
  const keys = new Set(["Enter", "Shift+Enter", "Backspace", "Delete", "ArrowLeft"]);
  for (const step of steps) {
    const presses = keys.has(step) || step.startsWith(MOD) ? [step] : [...step];
    for (const press of presses) {
      if (press.length === 1) await page.keyboard.type(press);
      else await page.keyboard.press(press);
      expect(await valid(), `after ${press}`).toBe(true);
    }
  }
  const t = (text: string, ...marks: string[]) => ({
    type: "text",
    text,
    ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
  });
  const expected = [
    { type: "paragraph", content: [t("Title")] },
    {
      type: "paragraph",
      content: [
        t("Some "),
        t("bold", "bold"),
        t(" both", "bold", "italic"),
        t(" plain"),
        { type: "hardBreak" },
        t("next line"),
      ],
    },
    { type: "paragraph", content: [t("und", "underline"), t("line")] },
  ];
  await expect.poll(() => saved(page)).toEqual(expected);
  const html = await editor(page).innerHTML();
  await page.reload();
  await expect(editor(page)).toHaveText(/Title/);
  expect(await editor(page).innerHTML()).toBe(html);
  expect(warnings).toEqual([]);
});

test("T2: replacing a selection across mixed formatting and undoing restores doc and selection", async ({
  page,
}) => {
  await openEmpty(page);
  await page.keyboard.type("one ");
  await page.keyboard.press(`${MOD}+b`);
  await page.keyboard.type("two");
  await page.keyboard.press(`${MOD}+b`);
  await page.keyboard.type(" three");
  await page.keyboard.press("Enter");
  await page.keyboard.type("four ");
  await page.keyboard.press(`${MOD}+i`);
  await page.keyboard.type("five");
  await page.keyboard.press(`${MOD}+i`);
  await page.keyboard.press("Enter");
  await page.keyboard.type("six");
  await page.keyboard.press(`${MOD}+Home`);
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight"); // "one t|wo"
  for (let i = 0; i < 15; i++) await page.keyboard.press("Shift+ArrowRight"); // to "four f|ive"
  /** The DOM selection as text offsets inside the host (blocks counted as one character). */
  const selection = () =>
    editor(page).evaluate((host) => {
      const sel = getSelection() as Selection;
      const offset = (node: Node, at: number) => {
        const range = document.createRange();
        range.setStart(host, 0);
        range.setEnd(node, at);
        let block = node;
        while (block.parentNode !== host) block = block.parentNode as Node;
        return range.toString().length + [...host.childNodes].indexOf(block as ChildNode);
      };
      return {
        text: sel.toString(),
        anchor: offset(sel.anchorNode as Node, sel.anchorOffset),
        focus: offset(sel.focusNode as Node, sel.focusOffset),
      };
    });
  const before = await selection();
  expect(before.text.replace(/\s+/g, " ")).toBe("wo three four f");
  await expectSaved(page, ["one two three", "four five", "six"]);
  const original = await saved(page);
  await page.waitForTimeout(600); // a new history group, not part of the typing above

  await page.keyboard.type("X");
  await expectSaved(page, ["one tXive", "six"]);
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => saved(page)).toEqual(original);
  expect(await selection()).toEqual(before);
});
