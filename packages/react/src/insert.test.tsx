// @vitest-environment jsdom
import { createEditor, type FoliDocument, undo } from "@folijs/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FoliToolbar, wordRibbonTabs } from "./index.js";

/** Word's Insert tab extras (Phase 35). */

const documentOf = (): FoliDocument => ({
  schemaVersion: 11,
  section: {},
  defaults: {},
  styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
  numbering: { abstracts: [], instances: [] },
  comments: [],
  content: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "ab" }] }],
  },
});

afterEach(cleanup);

function open() {
  const editor = createEditor({ document: documentOf() });
  editor.select(2);
  render(<FoliToolbar editor={editor} tabs={wordRibbonTabs} />);
  fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
  return editor;
}
const text = (editor: ReturnType<typeof open>) => editor.state.doc.textContent;

describe("Insert ▸ Symbol (35.1)", () => {
  it("offers Word's recent symbols, the one inserted coming first", () => {
    const editor = open();
    fireEvent.click(screen.getByRole("button", { name: /^Symbol/ }));
    const menu = within(screen.getByRole("menu", { name: "Symbol" }));
    const entries = menu.getAllByRole("menuitem").map((item) => item.textContent);
    expect(entries.slice(0, 5)).toEqual(["€", "£", "¥", "©", "®"]);
    expect(entries.at(-1)).toBe("More Symbols…");
    fireEvent.click(menu.getByRole("menuitem", { name: "©" }));
    expect(text(editor)).toBe("a©b");
    fireEvent.click(screen.getByRole("button", { name: /^Symbol/ }));
    const again = within(screen.getByRole("menu", { name: "Symbol" }));
    expect(again.getAllByRole("menuitem")[0]?.textContent).toBe("©");
    expect(again.getAllByRole("menuitem").length).toBe(21);
  });

  it("inserts a subset's character in the font chosen, and a special character, in one step each", () => {
    const editor = open();
    fireEvent.click(screen.getByRole("button", { name: /^Symbol/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "More Symbols…" }));
    const dialog = within(screen.getByRole("dialog", { name: "Symbol" }));
    fireEvent.change(dialog.getByLabelText("Font"), { target: { value: "Arial" } });
    fireEvent.change(dialog.getByLabelText("Subset"), { target: { value: "6" } });
    const grid = screen.getByRole("listbox", { name: "Symbols" });
    // The first of Greek and Coptic shown, then the arrows move.
    expect(within(grid).getByRole("option", { selected: true }).textContent).toBe("Ͱ");
    fireEvent.change(dialog.getByLabelText("Character code (Unicode, hex)"), {
      target: { value: "03A9" },
    });
    expect(within(grid).getByRole("option", { selected: true }).textContent).toBe("Ω");
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(within(grid).getByRole("option", { selected: true }).textContent).toBe("Ϊ");
    fireEvent.keyDown(grid, { key: "ArrowLeft" });
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(text(editor)).toBe("aΩb");
    const omega = editor.getDocument().content.content?.[0]?.content?.[1];
    expect(omega).toEqual({
      type: "text",
      text: "Ω",
      marks: [{ type: "font", attrs: { ascii: "Arial", hAnsi: "Arial" } }],
    });
    // Still open, as Word's; Special Characters.
    fireEvent.click(screen.getByRole("tab", { name: "Special Characters" }));
    const list = screen.getByRole("listbox", { name: "Special characters" });
    fireEvent.click(within(list).getByText("Trademark"));
    expect(within(list).getByRole("option", { selected: true }).textContent).toContain(
      "Alt+Ctrl+T",
    );
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(text(editor)).toBe("aΩ™b");
    editor.run(undo);
    expect(text(editor)).toBe("aΩb");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
