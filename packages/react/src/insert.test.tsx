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

describe("Insert ▸ Date & Time (35.2)", () => {
  const dialog = () => screen.getByRole("dialog", { name: "Date and Time" });
  const openDialog = () => {
    const editor = open();
    fireEvent.click(screen.getByRole("button", { name: "Date & Time" }));
    return editor;
  };

  it("offers Word's formats for English (United States), inserting one as text", () => {
    const editor = openDialog();
    fireEvent.change(within(dialog()).getByLabelText("Language"), { target: { value: "en-US" } });
    const list = screen.getByRole("listbox", { name: "Available formats" });
    const options = within(list).getAllByRole("option");
    expect(options.map((o) => o.getAttribute("title"))).toEqual([
      "M/d/yyyy",
      "dddd, MMMM d, yyyy",
      "MMMM d, yyyy",
      "M/d/yy",
      "yyyy-MM-dd",
      "d-MMM-yy",
      "M.d.yyyy",
      "MMM. d, yy",
      "d MMMM yyyy",
      "MMMM yy",
      "MMM-yy",
      "M/d/yyyy h:mm AM/PM",
      "M/d/yyyy h:mm:ss AM/PM",
      "h:mm AM/PM",
      "h:mm:ss AM/PM",
      "HH:mm",
      "HH:mm:ss",
    ]);
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    const shown = within(list).getByRole("option", { selected: true }).textContent ?? "";
    expect(shown).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    fireEvent.submit(dialog().querySelector("form") as HTMLFormElement);
    expect(text(editor)).toBe(`a${shown}b`);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("updates automatically as a DATE field in the picture, another language's formats its own", () => {
    const editor = openDialog();
    fireEvent.change(within(dialog()).getByLabelText("Language"), { target: { value: "es-ES" } });
    const list = screen.getByRole("listbox", { name: "Available formats" });
    const titles = within(list)
      .getAllByRole("option")
      .map((o) => o.getAttribute("title"));
    expect(titles).toContain("dd/MM/yyyy");
    expect(titles).toContain("dddd, d' de 'MMMM' de 'yyyy");
    fireEvent.click(within(dialog()).getByLabelText("Update automatically"));
    fireEvent.click(within(list).getAllByRole("option")[0] as HTMLElement);
    fireEvent.submit(dialog().querySelector("form") as HTMLFormElement);
    const codes = editor.state.doc
      .child(0)
      .content.content.filter((n) => n.type.name === "fieldCode");
    expect(codes.map((n) => n.attrs.text)).toEqual([String.raw` DATE \@ "dd/MM/yyyy" `]);
    editor.run(undo);
    expect(text(editor)).toBe("ab");
  });

  it("names the field's months in its language, keeps Catalan's genitive, and Enter inserts", () => {
    const editor = openDialog();
    fireEvent.change(within(dialog()).getByLabelText("Language"), { target: { value: "es-ES" } });
    fireEvent.click(within(dialog()).getByLabelText("Update automatically"));
    const list = screen.getByRole("listbox", { name: "Available formats" });
    const long = within(list)
      .getAllByRole("option")
      .find((o) => o.getAttribute("title") === "dddd, d' de 'MMMM' de 'yyyy") as HTMLElement;
    fireEvent.click(long);
    fireEvent.keyDown(list, { key: "Enter" });
    expect(screen.queryByRole("dialog")).toBeNull();
    // Shown as the list showed it, in Spanish.
    expect(text(editor)).toBe(`a${long.textContent}b`);
    expect(long.textContent).toMatch(
      / de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre) de /,
    );
    fireEvent.click(screen.getByRole("button", { name: "Date & Time" }));
    fireEvent.change(within(dialog()).getByLabelText("Language"), { target: { value: "ca-ES" } });
    const titles = within(screen.getByRole("listbox", { name: "Available formats" }))
      .getAllByRole("option")
      .map((o) => o.getAttribute("title"));
    expect(titles).toContain("d 'de 'MMMM' del 'yyyy");
    expect(titles).toContain("HH:mm");
  });
});
