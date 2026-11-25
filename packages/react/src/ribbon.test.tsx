// @vitest-environment jsdom
import { createEditor, type FoliDocument, fieldCodesShown, insertTable } from "@folijs/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FoliToolbar, selectionInTable, toolbarItems, wordRibbonTabs } from "./index.js";

const word: FoliDocument = {
  schemaVersion: 5,
  section: {},
  defaults: {},
  styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
  numbering: { abstracts: [], instances: [] },
  comments: [],
  content: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
  },
};

const tabNames = () => screen.getAllByRole("tab").map((tab) => tab.textContent);

describe("wordRibbonTabs", () => {
  afterEach(cleanup);

  it("has Word's tabs in captioned groups, every built-in item in them", () => {
    expect(wordRibbonTabs.map((tab) => tab.label)).toEqual([
      "Home",
      "Insert",
      "Layout",
      "References",
      "Review",
      "View",
      "Table Design",
      "Table Layout",
      "Picture Format",
    ]);
    const groups = wordRibbonTabs.flatMap((tab) => tab.items);
    for (const group of groups) expect(Array.isArray(group)).toBe(false);
    // Each group's items and its launcher (large buttons are copies: by key).
    const keysOf = (g: (typeof groups)[number]) =>
      "items" in g
        ? [...g.items, ...(g.launcher ? [g.launcher] : [])].map((i) => i.key)
        : g.map((i) => i.key);
    const all = new Set(groups.flatMap(keysOf));
    for (const item of Object.values(toolbarItems)) expect(all.has(item.key)).toBe(true);
    // An item twice in one tab would share a key.
    for (const tab of wordRibbonTabs) {
      const keys = tab.items.flatMap(keysOf);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("shows the table tabs, drawn apart, only while the selection is in a table", () => {
    const editor = createEditor({ document: word });
    render(<FoliToolbar editor={editor} tabs={wordRibbonTabs} />);
    expect(tabNames()).toEqual(["Home", "Insert", "Layout", "References", "Review", "View"]);
    act(() => {
      editor.run(insertTable(2, 2));
    });
    expect(selectionInTable(editor.state)).toBe(true);
    expect(tabNames()).toContain("Table Design");
    const layout = screen.getByRole("tab", { name: "Table Layout" });
    expect(layout.classList.contains("foli-ribbon-tab-contextual")).toBe(true);
    expect(screen.getByRole("tab", { name: "Home" }).classList).not.toContain(
      "foli-ribbon-tab-contextual",
    );
    // A row button of its own, as the Table menu's entry.
    fireEvent.click(layout, { detail: 1 });
    const panel = screen.getByRole("tabpanel");
    within(panel).getByRole("group", { name: "Rows & Columns" });
    const table = () =>
      (editor.getDocument().content.content ?? []).find((b) => b.type === "table");
    expect(table()?.content).toHaveLength(2);
    fireEvent.click(within(panel).getByRole("button", { name: "Insert below" }), { detail: 1 });
    expect(table()?.content).toHaveLength(3);
    // At a caret nothing is merged, and only a cell selection merges.
    const off = (name: string) =>
      within(panel).getByRole("button", { name }).getAttribute("aria-disabled");
    expect(off("Merge cells")).toBe("true");
    expect(off("Split cell")).toBe("true");
    expect(off("Delete rows")).toBeNull();
  });

  it("enables an entry's button as its menu would: no note where none can go", () => {
    const editor = createEditor({ document: word });
    render(<FoliToolbar editor={editor} tabs={wordRibbonTabs} defaultTab="references" />);
    const state = (name: string) =>
      screen.getByRole("button", { name }).getAttribute("aria-disabled");
    expect(state("Footnote")).toBeNull();
    // No note at the caret, nor a note open: nothing to go to.
    expect(state("Show notes")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "View" }), { detail: 1 });
    // No navigation pane mounted (`FoliNavigation`): nothing opens it.
    expect(state("Navigation pane")).toBe("true");
  });

  it("runs a menu's entry from its own button: a footnote, the field codes", () => {
    const editor = createEditor({ document: word });
    render(<FoliToolbar editor={editor} tabs={wordRibbonTabs} defaultTab="references" />);
    fireEvent.click(screen.getByRole("button", { name: "Footnote" }), { detail: 1 });
    const text = JSON.stringify(editor.getDocument());
    expect(text).toContain("noteReference");
    fireEvent.click(screen.getByRole("tab", { name: "View" }), { detail: 1 });
    const codes = screen.getByRole("button", { name: "Field codes" });
    expect(codes.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(codes, { detail: 1 });
    expect(fieldCodesShown(editor.state)).toBe(true);
    expect(codes.getAttribute("aria-pressed")).toBe("true");
  });

  it("draws large buttons named by their text, and a group's launcher after its items", () => {
    const editor = createEditor({ document: word });
    render(<FoliToolbar editor={editor} tabs={wordRibbonTabs} defaultTab="references" />);
    const footnote = screen.getByRole("button", { name: "Footnote" });
    expect(footnote.classList.contains("foli-toolbar-large")).toBe(true);
    const group = screen.getByRole("group", { name: "Footnotes" });
    const launcher = within(group).getByRole("button", { name: "Note options…" });
    expect(launcher.classList.contains("foli-toolbar-launcher")).toBe(true);
    expect(launcher.getAttribute("aria-haspopup")).toBe("dialog");
    // The last of the group for the arrow keys.
    const buttons = within(group).getAllByRole("button");
    expect(buttons.at(-1)).toBe(launcher);
    fireEvent.click(launcher, { detail: 1 });
    screen.getByRole("dialog", { name: "Note options" });
  });

  it("collapses to its tabs: a click shows a tab over the document, Escape puts it away", () => {
    const editor = createEditor({ document: word });
    const changes: boolean[] = [];
    render(
      <FoliToolbar
        editor={editor}
        tabs={wordRibbonTabs}
        onCollapsedChange={(c) => changes.push(c)}
      />,
    );
    const panel = () => screen.getByRole("tabpanel", { hidden: true });
    const collapse = screen.getByRole("button", { name: "Collapse the ribbon" });
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(collapse);
    expect(panel().hidden).toBe(true);
    expect(changes).toEqual([true]);
    const pin = screen.getByRole("button", { name: "Pin the ribbon" });
    expect(pin.getAttribute("aria-expanded")).toBe("false");

    const insert = screen.getByRole("tab", { name: "Insert" });
    fireEvent.click(insert, { detail: 1 });
    expect(panel().hidden).toBe(false);
    expect(panel().closest(".foli-ribbon")?.classList.contains("foli-ribbon-floating")).toBe(true);
    fireEvent.keyDown(screen.getByRole("button", { name: "Page break" }), { key: "Escape" });
    expect(panel().hidden).toBe(true);
    expect(document.activeElement).toBe(insert);

    // ArrowDown on a tab shows the panel and goes into it; a press elsewhere puts it away.
    fireEvent.keyDown(insert, { key: "ArrowDown" });
    expect(panel().hidden).toBe(false);
    expect(panel().contains(document.activeElement)).toBe(true);
    fireEvent.pointerDown(document.body);
    expect(panel().hidden).toBe(true);

    // Ctrl+F1 pins it again, as a double-click on a tab does.
    fireEvent.keyDown(document, { key: "F1", ctrlKey: true });
    expect(panel().hidden).toBe(false);
    fireEvent.doubleClick(insert);
    expect(panel().hidden).toBe(true);
    expect(changes).toEqual([true, false, true]);
  });

  it("follows the app's `collapsed`", () => {
    const editor = createEditor({ document: word });
    const { rerender } = render(<FoliToolbar editor={editor} tabs={wordRibbonTabs} collapsed />);
    const panel = () => screen.getByRole("tabpanel", { hidden: true });
    expect(panel().hidden).toBe(true);
    // A pick only asks: the app keeps it collapsed.
    fireEvent.click(screen.getByRole("button", { name: "Pin the ribbon" }));
    expect(panel().hidden).toBe(true);
    rerender(<FoliToolbar editor={editor} tabs={wordRibbonTabs} collapsed={false} />);
    expect(panel().hidden).toBe(false);
  });

  it("puts the panel over the document away when a command runs from it, without onClickCommand", () => {
    const editor = createEditor({ document: word });
    render(<FoliToolbar editor={editor} tabs={wordRibbonTabs} defaultCollapsed />);
    const panel = () => screen.getByRole("tabpanel", { hidden: true });
    fireEvent.click(screen.getByRole("tab", { name: "Home" }), { detail: 1 });
    expect(panel().hidden).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Bold" }), { detail: 1 });
    expect(panel().hidden).toBe(true);
  });

  it("forgets a panel over the document when the app pins the ribbon", () => {
    const editor = createEditor({ document: word });
    const { rerender } = render(<FoliToolbar editor={editor} tabs={wordRibbonTabs} collapsed />);
    const panel = () => screen.getByRole("tabpanel", { hidden: true });
    fireEvent.click(screen.getByRole("tab", { name: "Home" }), { detail: 1 });
    expect(panel().hidden).toBe(false);
    rerender(<FoliToolbar editor={editor} tabs={wordRibbonTabs} collapsed={false} />);
    rerender(<FoliToolbar editor={editor} tabs={wordRibbonTabs} collapsed />);
    expect(panel().hidden).toBe(true);
  });
});
