// @vitest-environment jsdom
import { createDocument } from "@foli/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
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
      "Paragraph",
      "H1",
      "H2",
      "H3",
      "Undo",
      "Redo",
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

  it("a ref on FoliEditor gives its editor and focuses the document", () => {
    const handle = setup();
    expect(handle.editor.state.doc.textContent).toBe("Hello FoliSecond");
    act(() => handle.focus());
    expect(document.activeElement).toBe(screen.getByRole("textbox"));
  });
});
