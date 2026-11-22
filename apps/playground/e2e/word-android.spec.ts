/**
 * Android keyboards (19.7), emulated: their input reaches the editor differently from a
 * desktop keyboard's. Backspace at a paragraph's start comes as a `beforeinput` delete whose
 * target range is the boundary before it; some keyboards split a paragraph with no `beforeinput`
 * at all, the browser changing the DOM. Not checked on a device (docs/limitations.md).
 */
import { expect, type Page, test } from "@playwright/test";

type Json = Record<string, unknown>;
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const numbered = { numbering: { id: 1, level: 0 } };
const paragraph = (text: string, attrs?: Json): Json => ({
  type: "paragraph",
  ...(attrs ? { attrs } : {}),
  content: [{ type: "text", text }],
});

async function open(page: Page, blocks: Json[]): Promise<void> {
  await page.goto("/edit.html");
  await page.waitForFunction(() => "foliEdit" in window);
  await page.evaluate(
    (content) =>
      window.foliEdit.load({
        schemaVersion: 5,
        section: {},
        defaults: {},
        styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
        numbering: {
          abstracts: [{ id: 0, levels: [{ level: 0, start: 1, format: "decimal", text: "%1." }] }],
          instances: [{ id: 1, abstract: 0 }],
        },
        comments: [],
        content: { type: "doc", content },
      } as never),
    blocks,
  );
  await editor(page).focus();
}

/** Each paragraph's text and whether it is numbered. */
const blocks = (page: Page) =>
  page.evaluate(() => {
    const out: [string, boolean][] = [];
    window.foliEdit.editor.state.doc.forEach((node) => {
      out.push([node.textContent, !!node.attrs.numbering]);
    });
    return out;
  });

/** The text node holding `text` in the editor, and where `text` starts in it. */
const textNode = (text: string) => {
  const host = document.querySelector("[role=textbox]") as HTMLElement;
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const at = (n.textContent ?? "").indexOf(text);
    if (at >= 0) return { node: n as Text, at };
  }
  throw new Error(`no ${text}`);
};

test("Backspace at a numbered paragraph's start, as Android sends it, removes its number", async ({
  page,
}) => {
  await open(page, [paragraph("first", numbered), paragraph("second", numbered)]);
  await page.evaluate((find) => {
    const at = new Function(`return (${find})`)() as typeof textNode;
    const before = at("first");
    const after = at("second");
    // The caret at "second"'s start.
    getSelection()?.collapse(after.node, 0);
    document.dispatchEvent(new Event("selectionchange"));
    const range = new StaticRange({
      startContainer: before.node,
      startOffset: before.node.length,
      endContainer: after.node,
      endOffset: 0,
    });
    const event = new InputEvent("beforeinput", {
      inputType: "deleteContentBackward",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "getTargetRanges", { value: () => [range] });
    (document.querySelector("[role=textbox]") as HTMLElement).dispatchEvent(event);
  }, textNode.toString());
  // Word's Backspace: the number goes, the paragraphs stay apart.
  expect(await blocks(page)).toEqual([
    ["first", true],
    ["second", false],
  ]);
});

test("a paragraph split in the DOM without beforeinput is read back as Enter", async ({ page }) => {
  await open(page, [paragraph("abcd", numbered), paragraph("end")]);
  await page.evaluate((find) => {
    const at = new Function(`return (${find})`)() as typeof textNode;
    const { node } = at("abcd");
    // What a keyboard's Enter does to the DOM when the browser handles it: the paragraph's
    // element cloned after it, the text after the caret moved there, the caret at its start.
    const block = node.parentElement?.closest("p, h1, h2, h3, div[style]") as HTMLElement;
    const clone = block.cloneNode(false) as HTMLElement;
    const tail = node.splitText(2);
    clone.append(tail);
    block.after(clone);
    getSelection()?.collapse(tail, 0);
  }, textNode.toString());
  await expect
    .poll(() => blocks(page))
    .toEqual([
      ["ab", true],
      ["cd", true],
      ["end", false],
    ]);
  expect(await page.evaluate(() => window.foliEdit.validate())).toBe(true);
  // Typing goes on in the new paragraph.
  await page.keyboard.type("X");
  expect((await blocks(page))[1]?.[0]).toBe("Xcd");
});
