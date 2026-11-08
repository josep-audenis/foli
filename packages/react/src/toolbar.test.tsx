// @vitest-environment jsdom
import { createDocument, EditorState } from "@folijs/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FoliEditor, type FoliEditorHandle } from "./index.js";

const doc = createDocument({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Hello Foli" }] },
    { type: "paragraph", content: [{ type: "text", text: "Second" }] },
  ],
});

function setup(props: Parameters<typeof FoliEditor>[0] = {}) {
  const ref = createRef<FoliEditorHandle>();
  render(<FoliEditor ref={ref} initialContent={doc} {...props} />);
  const handle = ref.current;
  if (!handle) throw new Error("no handle");
  return handle;
}
const button = (name: string) => screen.getByRole("button", { name });
const buttons = () => screen.getAllByRole("button");

describe("FoliToolbar", () => {
  afterEach(cleanup);

  it("is one labelled toolbar with named buttons and a single tab stop", () => {
    setup();
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeTruthy();
    const names = buttons().map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(names).toEqual([
      "Bold",
      "Italic",
      "Underline",
      "Strikethrough",
      "Link",
      "Text color",
      "Highlight",
      "Paragraph",
      "H1",
      "H2",
      "H3",
      "Align left",
      "Center",
      "Align right",
      "Justify",
      "Bulleted list",
      "Numbered list",
      "Decrease indent",
      "Increase indent",
      "Undo",
      "Redo",
      "Horizontal rule",
      "Page break",
    ]);
    expect(buttons().filter((b) => b.tabIndex === 0)).toHaveLength(1);
    expect(button("H1").title).toBe("Heading 1");
  });

  it("moves focus with the arrow keys, Home and End, wrapping, and keeps one tab stop", () => {
    setup();
    const all = buttons();
    act(() => all[0]?.focus());
    fireEvent.keyDown(all[0] as HTMLElement, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(all.at(-1));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowRight" });
    expect(document.activeElement).toBe(all[0]);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "End" });
    expect(document.activeElement).toBe(all.at(-1));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Home" });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowRight" });
    expect(document.activeElement).toBe(all[1]);
    expect(buttons().filter((b) => b.tabIndex === 0)).toEqual([all[1]]);
  });

  it("toggles a mark on the selection and shows it pressed; a click keeps the focus", () => {
    const { editor } = setup();
    act(() => editor.select(1, 6));
    expect(button("Bold").getAttribute("aria-pressed")).toBe("false");
    // The mousedown is prevented, so the focus stays in the document.
    expect(fireEvent.mouseDown(button("Bold"))).toBe(false);
    act(() => button("Bold").click());
    expect(editor.isMarkActive("bold")).toBe(true);
    expect(button("Bold").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("textbox").querySelector("strong")?.textContent).toBe("Hello");
  });

  it("sets heading levels, shows the block type pressed, and a second press goes back", () => {
    const { editor } = setup();
    act(() => editor.select(2));
    expect(button("Paragraph").getAttribute("aria-pressed")).toBe("true");
    act(() => button("H2").click());
    expect(editor.state.doc.firstChild?.type.name).toBe("heading");
    expect(editor.state.doc.firstChild?.attrs.level).toBe(2);
    expect(button("H2").getAttribute("aria-pressed")).toBe("true");
    expect(button("Paragraph").getAttribute("aria-pressed")).toBe("false");
    act(() => button("H2").click());
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
    // A selection over a heading and a paragraph: neither type is pressed.
    act(() => button("H1").click());
    act(() => editor.select(2, 15));
    expect(button("H1").getAttribute("aria-pressed")).toBe("false");
    expect(button("Paragraph").getAttribute("aria-pressed")).toBe("false");
    // A pressed block type stays enabled.
    act(() => editor.select(2));
    expect(button("H1").hasAttribute("aria-disabled")).toBe(false);
  });

  it("enables Undo and Redo from dry runs, and runs them", () => {
    const { editor } = setup();
    expect(button("Undo").getAttribute("aria-disabled")).toBe("true");
    expect(button("Redo").getAttribute("aria-disabled")).toBe("true");
    act(() => editor.commands.insertText("x"));
    expect(button("Undo").hasAttribute("aria-disabled")).toBe(false);
    act(() => button("Undo").click());
    expect(editor.state.doc.textContent).toBe("Hello FoliSecond");
    expect(button("Redo").hasAttribute("aria-disabled")).toBe(false);
    // A disabled button does nothing.
    expect(button("Undo").getAttribute("aria-disabled")).toBe("true");
    act(() => button("Undo").click());
    expect(editor.state.doc.textContent).toBe("Hello FoliSecond");
  });

  it("makes lists, shows the list type pressed, and indents and outdents items", () => {
    const { editor } = setup();
    const pressed = (name: string) => button(name).getAttribute("aria-pressed");
    const disabled = (name: string) => button(name).getAttribute("aria-disabled");
    // A heading cannot become a list item: the list buttons are disabled there.
    act(() => editor.select(2));
    act(() => button("H1").click());
    expect(disabled("Bulleted list")).toBe("true");
    expect(disabled("Numbered list")).toBe("true");
    act(() => button("H1").click());
    expect(disabled("Bulleted list")).toBeNull();
    act(() => editor.select(2, 15)); // both paragraphs
    expect(disabled("Increase indent")).toBe("true");
    expect(disabled("Decrease indent")).toBe("true");
    act(() => button("Bulleted list").click());
    expect(editor.getDocument().content.content[0]?.type).toBe("bulletList");
    expect(pressed("Bulleted list")).toBe("true");
    expect(pressed("Numbered list")).toBe("false");
    act(() => button("Numbered list").click());
    expect(editor.getDocument().content.content[0]?.type).toBe("orderedList");
    expect(pressed("Numbered list")).toBe("true");
    // One item per paragraph: put the caret in the second, split into its own item first.
    act(() => button("Numbered list").click()); // off again
    act(() => editor.select(1, 15));
    act(() => button("Bulleted list").click());
    act(() => editor.select(editor.state.doc.content.size - 3));
    act(() => editor.handleKey("Enter"));
    expect(disabled("Increase indent")).toBeNull(); // the new item has one before it
    act(() => button("Increase indent").click());
    expect(JSON.stringify(editor.getDocument().content)).toContain(
      '"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph"}]}]',
    );
    act(() => button("Decrease indent").click());
    expect(editor.getDocument().content.content).toHaveLength(1);
  });

  it("inserts a page break", () => {
    const { editor } = setup();
    act(() => editor.select(6));
    act(() => button("Page break").click());
    expect(JSON.stringify(editor.getDocument().content)).toContain('"pageBreak"');
  });

  it("is disabled with a read-only editor, and absent with toolbar={false}", () => {
    const { editor } = setup({ readOnly: true });
    expect(buttons().every((b) => b.getAttribute("aria-disabled") === "true")).toBe(true);
    act(() => editor.select(1, 6));
    act(() => button("Bold").click());
    expect(editor.isMarkActive("bold")).toBe(false);
    cleanup();
    setup({ toolbar: false });
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("builds no transactions to update its state, however large the selection", {
    timeout: 30_000,
  }, () => {
    const big = createDocument({
      type: "doc",
      content: Array.from({ length: 2000 }, (_, i) => ({
        type: "paragraph",
        content: [{ type: "text", text: `Paragraph ${i}` }],
      })),
    });
    const transactionsFor = (toolbar: boolean) => {
      const { editor } = setup({ initialContent: big, toolbar });
      const tr = vi.spyOn(EditorState.prototype, "tr", "get");
      act(() => editor.select(0, editor.state.doc.content.size));
      act(() => editor.select(5));
      const count = tr.mock.calls.length;
      tr.mockRestore();
      cleanup();
      return count;
    };
    // Only the selection changes themselves: none from the toolbar's dry runs.
    expect(transactionsFor(true)).toBe(transactionsFor(false));
  });

  it("a click focuses the document to show the result; keyboard activation keeps the focus", () => {
    const { editor } = setup();
    const outside = document.createElement("button");
    document.body.append(outside);
    act(() => outside.focus());
    act(() => editor.select(1, 6));
    fireEvent.click(button("Bold"), { detail: 1 });
    expect(document.activeElement).toBe(screen.getByRole("textbox"));
    act(() => button("Italic").focus());
    fireEvent.click(button("Italic"), { detail: 0 });
    expect(editor.isMarkActive("italic")).toBe(true);
    expect(document.activeElement).toBe(button("Italic"));
    outside.remove();
  });

  it("aligns the selected blocks and shows the alignment pressed", () => {
    const handle = setup();
    const { editor } = handle;
    act(() => editor.select(2));
    expect(button("Align left").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button("Center"), { detail: 1 });
    expect(editor.getDocument().content.content[0]).toMatchObject({ attrs: { align: "center" } });
    expect(button("Center").getAttribute("aria-pressed")).toBe("true");
    expect(button("Align left").getAttribute("aria-pressed")).toBe("false");
    act(() => editor.select(2, 15)); // mixed: none pressed
    for (const name of ["Align left", "Center", "Align right", "Justify"]) {
      expect(button(name).getAttribute("aria-pressed")).toBe("false");
    }
    fireEvent.click(button("Justify"), { detail: 1 });
    expect(JSON.stringify(editor.getDocument())).not.toContain('"center"');
    expect(button("Justify").getAttribute("aria-pressed")).toBe("true");
  });

  it("colors text from a menu button: keyboard, current color checked, Escape", () => {
    const handle = setup();
    const { editor } = handle;
    act(() => handle.focus());
    act(() => editor.select(1, 6)); // "Hello"
    const textColor = button("Text color");
    expect(textColor.getAttribute("aria-haspopup")).toBe("menu");
    expect(textColor.getAttribute("aria-expanded")).toBe("false");
    act(() => textColor.focus());
    fireEvent.keyDown(textColor, { key: "ArrowDown" });
    screen.getByRole("menu", { name: "Text color" });
    expect(textColor.getAttribute("aria-expanded")).toBe("true");
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual([
      "Automatic",
      "Gray",
      "Red",
      "Orange",
      "Green",
      "Blue",
      "Purple",
    ]);
    expect(document.activeElement).toBe(items[0]); // the checked one: no color yet
    expect(items[0]?.getAttribute("aria-checked")).toBe("true");
    // Arrow keys stay in the menu (the toolbar does not move).
    fireEvent.keyDown(items[0] as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1] as HTMLElement, { key: "End" });
    expect(document.activeElement).toBe(items[6]);
    fireEvent.keyDown(items[6] as HTMLElement, { key: "ArrowUp" });
    fireEvent.keyDown(items[5] as HTMLElement, { key: "ArrowUp" });
    fireEvent.click(items[4] as HTMLElement, { detail: 0 }); // Green, by keyboard
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(textColor);
    expect(JSON.stringify(editor.getDocument())).toContain('"color":"#2e7d32"');
    // Open again: Green is checked and focused; Escape closes back to the button.
    fireEvent.click(textColor, { detail: 0 });
    const green = screen.getByRole("menuitemradio", { name: "Green" });
    expect(green.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(green);
    fireEvent.keyDown(green, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(textColor);
  });

  it("highlights and removes a highlight with the mouse; focus goes back to the document", () => {
    const handle = setup();
    const { editor } = handle;
    const documentBox = screen.getByRole("textbox", { name: "Document" });
    act(() => handle.focus());
    act(() => editor.select(1, 6));
    fireEvent.click(button("Highlight"), { detail: 1 });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Yellow" }), { detail: 1 });
    expect(document.activeElement).toBe(documentBox);
    expect(JSON.stringify(editor.getDocument())).toContain(
      '"highlight","attrs":{"color":"#fff59d"}',
    );
    const swatch = button("Highlight").querySelector(".foli-toolbar-swatch") as HTMLElement;
    expect(swatch.style.background).toBe("rgb(255, 245, 157)");
    fireEvent.click(button("Highlight"), { detail: 1 });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "None" }), { detail: 1 });
    expect(JSON.stringify(editor.getDocument())).not.toContain("highlight");
    // Leaving an open menu (a click elsewhere) closes it.
    fireEvent.click(button("Highlight"), { detail: 1 });
    const menu = screen.getByRole("menu");
    fireEvent.blur(menu.firstElementChild as HTMLElement, { relatedTarget: documentBox });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("a menu closed by its own button gives the focus back (document by pointer, button by key)", () => {
    const handle = setup();
    const documentBox = screen.getByRole("textbox", { name: "Document" });
    act(() => handle.focus());
    act(() => handle.editor.select(1, 6));
    fireEvent.click(button("Text color"), { detail: 1 });
    expect(document.activeElement?.getAttribute("role")).toBe("menuitemradio");
    fireEvent.click(button("Text color"), { detail: 1 });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(documentBox);
    fireEvent.click(button("Highlight"), { detail: 0 });
    fireEvent.click(button("Highlight"), { detail: 0 });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button("Highlight"));
    // Tab closes a menu and leaves it from its button (the browser moves on; not prevented).
    fireEvent.keyDown(button("Highlight"), { key: "ArrowDown" });
    const item = screen.getByRole("menuitemradio", { name: "None" });
    expect(fireEvent.keyDown(item, { key: "Tab" })).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button("Highlight"));
  });

  it("inserts a horizontal rule, also with everything selected", () => {
    const handle = setup();
    act(() => {
      handle.editor.commands.selectAll();
    });
    expect(button("Horizontal rule").hasAttribute("aria-disabled")).toBe(false);
    act(() => handle.editor.select(11)); // end of "Hello Foli"
    fireEvent.click(button("Horizontal rule"), { detail: 1 });
    expect(handle.editor.getDocument().content.content.map((block) => block.type)).toEqual([
      "paragraph",
      "horizontalRule",
      "paragraph",
      "paragraph",
    ]);
  });

  it("adds a link from the dialog: URL normalized, focus back in the document", () => {
    const handle = setup();
    const { editor } = handle;
    const documentBox = screen.getByRole("textbox", { name: "Document" });
    act(() => handle.focus());
    act(() => editor.select(1, 6)); // "Hello"
    expect(button("Link").getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button("Link"), { detail: 1 });
    const dialog = screen.getByRole("dialog", { name: "Add link" });
    const url = screen.getByRole("textbox", { name: "URL" });
    expect(dialog.contains(url)).toBe(true);
    expect(document.activeElement).toBe(url); // not taken back by the document
    expect(screen.queryByRole("button", { name: "Remove link" })).toBeNull();
    fireEvent.change(url, { target: { value: " example.com " } });
    fireEvent.click(button("Apply"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(documentBox);
    expect(editor.getDocument().content.content[0]).toEqual({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Hello",
          marks: [{ type: "link", attrs: { href: "https://example.com" } }],
        },
        { type: "text", text: " Foli" },
      ],
    });
    expect(button("Link").getAttribute("aria-pressed")).toBe("true");
  });

  it("Mod-K edits the link at the caret; an unsafe URL is refused; Escape and Remove", () => {
    const handle = setup();
    const { editor } = handle;
    const documentBox = screen.getByRole("textbox", { name: "Document" });
    act(() => handle.focus());
    act(() => editor.select(1, 6));
    act(() => {
      editor.commands.setLink("https://a.test");
    });
    act(() => editor.select(3));
    const before = editor.state.doc;
    fireEvent.keyDown(documentBox, { key: "k", ctrlKey: true });
    screen.getByRole("dialog", { name: "Edit link" });
    const url = screen.getByRole("textbox", { name: "URL" }) as HTMLInputElement;
    expect(url.value).toBe("https://a.test");
    fireEvent.change(url, { target: { value: "javascript:alert(1)" } });
    fireEvent.submit(url.form as HTMLFormElement);
    expect(screen.getByRole("alert").textContent).toContain("http, https, mailto or tel");
    expect(url.getAttribute("aria-invalid")).toBe("true");
    expect(url.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
    expect(editor.state.doc).toBe(before);
    expect(document.activeElement).toBe(url);
    // Escape cancels: nothing changes, the focus goes back to the document.
    fireEvent.keyDown(url, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(documentBox);
    expect(editor.state.doc).toBe(before);
    // Remove link takes the whole link out.
    fireEvent.keyDown(documentBox, { key: "k", ctrlKey: true });
    fireEvent.click(button("Remove link"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(editor.state.doc.textContent).toBe("Hello FoliSecond");
    expect(JSON.stringify(editor.getDocument())).not.toContain("link");
  });

  it("Apply with the link unchanged closes the dialog, without an error", () => {
    const handle = setup();
    const { editor } = handle;
    const documentBox = screen.getByRole("textbox", { name: "Document" });
    act(() => handle.focus());
    act(() => editor.select(1, 6));
    act(() => {
      editor.commands.setLink("https://x.test");
    });
    act(() => editor.select(3));
    fireEvent.keyDown(documentBox, { key: "k", ctrlKey: true });
    const url = screen.getByRole("textbox", { name: "URL" });
    fireEvent.change(url, { target: { value: "x.test" } }); // normalizes to the same href
    fireEvent.click(button("Apply"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(documentBox);
  });

  it("the dialog closes when the selection or document changes; a second Mod-K refocuses it", () => {
    const handle = setup();
    const { editor } = handle;
    const documentBox = screen.getByRole("textbox", { name: "Document" });
    act(() => handle.focus());
    act(() => editor.select(1, 6));
    fireEvent.keyDown(documentBox, { key: "k", ctrlKey: true });
    const url = screen.getByRole("textbox", { name: "URL" });
    // Back in the document (a click there), Mod-K again: the same dialog, focused again.
    act(() => documentBox.focus());
    fireEvent.keyDown(documentBox, { key: "k", ctrlKey: true });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(document.activeElement).toBe(url);
    // The selection moves (a click elsewhere in the document): the dialog is for the old one.
    act(() => editor.select(8));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(documentBox, { key: "k", ctrlKey: true });
    act(() => {
      editor.commands.insertText("z");
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the Link button by keyboard gives the focus back to it on close", () => {
    const handle = setup();
    act(() => handle.focus());
    act(() => handle.editor.select(1, 6));
    act(() => button("Link").focus());
    fireEvent.click(button("Link"), { detail: 0 });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "URL" }), { key: "Escape" });
    expect(document.activeElement).toBe(button("Link"));
  });

  it("a dialog open when the toolbar is disabled does not come back after", () => {
    const { rerender } = render(<FoliEditor initialContent={doc} />);
    const documentBox = screen.getByRole("textbox", { name: "Document" });
    act(() => documentBox.focus());
    fireEvent.keyDown(documentBox, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog")).toBeTruthy();
    rerender(<FoliEditor initialContent={doc} readOnly />);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<FoliEditor initialContent={doc} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens no link dialog in read-only mode, not even after it ends", () => {
    const { rerender } = render(<FoliEditor initialContent={doc} readOnly />);
    const documentBox = screen.getByRole("textbox", { name: "Document" });
    fireEvent.keyDown(documentBox, { key: "k", ctrlKey: true });
    fireEvent.click(button("Link"), { detail: 1 });
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<FoliEditor initialContent={doc} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves arrow keys with Alt, Ctrl or Meta to the browser", () => {
    setup();
    const first = buttons()[0] as HTMLElement;
    act(() => first.focus());
    expect(fireEvent.keyDown(first, { key: "ArrowLeft", altKey: true })).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it("a ref on FoliEditor gives its editor and focuses the document", () => {
    const handle = setup();
    expect(handle.editor.state.doc.textContent).toBe("Hello FoliSecond");
    act(() => handle.focus());
    expect(document.activeElement).toBe(screen.getByRole("textbox"));
  });
});
