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
    const all = new Set(groups.flatMap((group) => ("items" in group ? group.items : group)));
    for (const item of Object.values(toolbarItems)) expect(all.has(item)).toBe(true);
    // An item twice in one tab would share a key.
    for (const tab of wordRibbonTabs) {
      const keys = tab.items.flatMap((g) => ("items" in g ? g.items : g).map((i) => i.key));
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
});
