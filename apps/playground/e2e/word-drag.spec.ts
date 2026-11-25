/**
 * Drag and drop of text (19.6) on the editing page: the selection dragged moves where it is
 * dropped (one undo step), copies with Ctrl or Option, and text dragged from elsewhere is
 * pasted where it lands. Synthetic drag events with a real `DataTransfer`: the browsers' own
 * drag of selected text is not driven by Playwright.
 */
import { expect, type Page, test } from "@playwright/test";

type Json = Record<string, unknown>;
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const paragraph = (text: string): Json => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

async function open(
  page: Page,
  texts: string[],
  tracking = false,
  more: { blocks?: Json[]; controls?: Json } = {},
): Promise<void> {
  await page.goto("/edit.html?toolbar");
  await page.waitForFunction(() => "foliEdit" in window);
  await page.evaluate(
    ({ content, tracking, more }) =>
      window.foliEdit.load(
        {
          schemaVersion: 5,
          section: {},
          defaults: {},
          styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
          numbering: { abstracts: [], instances: [] },
          comments: [],
          ...(more.controls ? { controls: more.controls } : {}),
          content: { type: "doc", content },
        } as never,
        tracking,
      ),
    { content: [...texts.map(paragraph), ...(more.blocks ?? [])], tracking, more },
  );
  await editor(page).focus();
}

const texts = (page: Page) =>
  page.evaluate(() => {
    const out: string[] = [];
    window.foliEdit.editor.state.doc.forEach((node) => {
      out.push(node.textContent);
    });
    return out;
  });

/**
 * Selects `word` (the first of the document), then drags it to just before `target` (the
 * first after the word, or with `outside` text dragged from another page), with `ctrlKey`.
 */
async function drag(
  page: Page,
  word: string | null,
  target: string,
  options: { ctrlKey?: boolean; outside?: string } = {},
) {
  await page.evaluate(
    ({ word, target, options }) => {
      const host = document.querySelector("[role=textbox]") as HTMLElement;
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      const find = (value: string) => {
        walker.currentNode = host;
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const at = (n.textContent ?? "").indexOf(value);
          if (at >= 0) return { node: n, at };
        }
        throw new Error(`no ${value}`);
      };
      const data = new DataTransfer();
      let source: Element = host;
      if (word) {
        const { node, at } = find(word);
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + word.length);
        const selection = getSelection() as Selection;
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
        source = node.parentElement as Element;
      } else data.setData("text/plain", options.outside ?? "");
      const { node, at } = find(target);
      const range = document.createRange();
      range.setStart(node, at);
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      const point = {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
        clientX: rect.left + 1,
        clientY: rect.top + rect.height / 2,
        ctrlKey: options.ctrlKey === true,
      };
      if (word) source.dispatchEvent(new DragEvent("dragstart", point));
      const over = document.elementFromPoint(point.clientX, point.clientY) as Element;
      over.dispatchEvent(new DragEvent("dragover", point));
      over.dispatchEvent(new DragEvent("drop", point));
      if (word) source.dispatchEvent(new DragEvent("dragend", point));
    },
    { word, target, options },
  );
}

test("dragged text moves where it is dropped, in one undo step", async ({ page }) => {
  await open(page, ["alpha beta gamma", "delta epsilon"]);
  await drag(page, "beta ", "epsilon");
  await expect.poll(() => texts(page)).toEqual(["alpha gamma", "delta beta epsilon"]);
  expect(await page.evaluate(() => window.foliEdit.validate())).toBe(true);
  await page.evaluate(() => window.foliEdit.editor.commands.undo());
  expect(await texts(page)).toEqual(["alpha beta gamma", "delta epsilon"]);
});

test("with Ctrl it is copied; dropped into itself nothing changes", async ({ page }) => {
  await open(page, ["alpha beta gamma"]);
  await drag(page, "beta ", "alpha", { ctrlKey: true });
  await expect.poll(() => texts(page)).toEqual(["beta alpha beta gamma"]);
  await open(page, ["alpha beta gamma"]);
  await drag(page, "alpha beta", "beta");
  expect(await texts(page)).toEqual(["alpha beta gamma"]);
});

test("text dragged from elsewhere is pasted where it lands", async ({ page }) => {
  await open(page, ["alpha gamma"]);
  await drag(page, null, "gamma", { outside: "beta " });
  await expect.poll(() => texts(page)).toEqual(["alpha beta gamma"]);
});

test("a move while tracking is a tracked deletion and a tracked insertion", async ({ page }) => {
  await open(page, ["alpha beta gamma", "delta epsilon"], true);
  await drag(page, "beta ", "epsilon");
  const marks = await page.evaluate(() => {
    const out: string[] = [];
    window.foliEdit.editor.state.doc.descendants((node) => {
      if (node.isText)
        for (const mark of node.marks)
          if (mark.type.name === "insertion" || mark.type.name === "deletion")
            out.push(`${mark.type.name}:${node.text}`);
    });
    return out;
  });
  expect(marks).toEqual(["deletion:beta ", "insertion:beta "]);
  expect(await page.evaluate(() => window.foliEdit.validate())).toBe(true);
});

test("a drop into a content-locked control is refused, the dragged text left where it was", async ({
  page,
}) => {
  const locked: Json = {
    type: "paragraph",
    content: [
      { type: "controlStart", attrs: { id: "c1" } },
      { type: "text", text: "locked text" },
      { type: "controlEnd", attrs: { id: "c1" } },
    ],
  };
  await open(page, ["alpha beta gamma"], false, {
    blocks: [locked],
    controls: { c1: { kind: "richText", lock: "contentLocked" } },
  });
  await drag(page, "beta ", "text");
  expect(await texts(page)).toEqual(["alpha beta gamma", "locked text"]);
});
