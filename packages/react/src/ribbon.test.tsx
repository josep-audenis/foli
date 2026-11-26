// @vitest-environment jsdom
import { createEditor, type FoliDocument, fieldCodesShown, insertTable } from "@folijs/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import {
  defaultToolbarTabs,
  FoliToolbar,
  selectionInTable,
  toolbarIcons,
  toolbarItems,
  wordRibbonTabs,
} from "./index.js";

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
    // The Styles gallery stands for the style box there, as in Word.
    for (const item of Object.values(toolbarItems))
      expect(all.has(item.key) || item.key === "style", item.key).toBe(true);
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

  it("draws icons: alone for formatting, beside the text for the rest, over it when large", () => {
    const editor = createEditor({ document: word });
    render(<FoliToolbar editor={editor} tabs={wordRibbonTabs} />);
    // Bold: its icon only, named by its label.
    const bold = screen.getByRole("button", { name: "Bold" });
    expect(bold.querySelector("svg.foli-toolbar-icon")).not.toBeNull();
    expect(bold.textContent).toBe("");
    // Undo keeps its text out, as Word's.
    expect(screen.getByRole("button", { name: "Undo" }).textContent).toBe("");
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }), { detail: 1 });
    // Page break: its icon beside its text, which names it.
    const pageBreak = screen.getByRole("button", { name: "Page break" });
    expect(pageBreak.classList.contains("foli-toolbar-medium")).toBe(true);
    expect(pageBreak.hasAttribute("aria-label")).toBe(false);
    expect(pageBreak.querySelector(".foli-toolbar-medium-icon svg")).not.toBeNull();
    // Table, large: its icon over its text.
    const table = screen.getByRole("button", { name: "Table" });
    expect(table.querySelector(".foli-toolbar-large-icon svg")).not.toBeNull();
    // Every built-in but the boxes has an icon in the ribbon.
    const boxes = new Set([
      ...["style", "font", "size", "lineSpacing", "reviewView", "tableStyle"],
      "styleGallery",
    ]);
    for (const item of Object.values(toolbarItems))
      expect(boxes.has(item.key) || item.key in toolbarIcons, item.key).toBe(true);
  });

  it("has Word's Font group: scripts, grow and shrink, change case, clear all", () => {
    const editor = createEditor({ document: word });
    render(<FoliToolbar editor={editor} tabs={wordRibbonTabs} />);
    act(() => {
      editor.select(1, 6);
    });
    const press = (name: string) =>
      fireEvent.click(screen.getByRole("button", { name }), { detail: 1 });
    press("Superscript");
    expect(screen.getByRole("button", { name: "Superscript" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    press("Increase font size");
    press("Change case");
    fireEvent.click(screen.getByRole("menuitem", { name: "UPPERCASE" }));
    expect(editor.getDocument().content.content?.[0]?.content?.[0]?.text).toBe("HELLO");
    press("Clear all formatting");
    expect(editor.getDocument().content.content?.[0]?.content?.[0]?.marks).toBeUndefined();
  });

  it("has Word's Styles gallery: each style in its look; arrows, Enter and a click apply", () => {
    const editor = createEditor({ document: word });
    render(<FoliToolbar editor={editor} tabs={wordRibbonTabs} />);
    const gallery = screen.getByRole("listbox", { name: "Styles" });
    const names = within(gallery)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(names.slice(0, 2)).toEqual(["Normal", "Heading 1"]);
    expect(
      within(gallery).getByRole("option", { name: "Normal" }).getAttribute("aria-selected"),
    ).toBe("true");
    fireEvent.click(within(gallery).getByRole("option", { name: "Heading 1" }));
    expect(editor.getDocument().content.content?.[0]?.attrs?.style).toBe("Heading1");
    act(() => {
      editor.select(1);
    });
    fireEvent.keyDown(gallery, { key: "ArrowDown" });
    fireEvent.keyDown(gallery, { key: "Enter" });
    expect(editor.getDocument().content.content?.[0]?.attrs?.style).toBe("Heading2");
  });

  it("draws Home's Font and Paragraph groups in two rows; the gallery folds on a press away", () => {
    const editor = createEditor({ document: word });
    const { container } = render(<FoliToolbar editor={editor} tabs={wordRibbonTabs} />);
    const font = screen.getByRole("group", { name: "Font" });
    const rows = font.querySelectorAll(".foli-toolbar-row");
    expect(rows).toHaveLength(2);
    expect(
      within(rows[1] as HTMLElement)
        .getAllByRole("button")[0]
        ?.getAttribute("aria-label"),
    ).toBe("Bold");
    const gallery = container.querySelector(".foli-style-gallery") as HTMLElement;
    fireEvent.click(gallery.querySelector(".foli-style-gallery-more") as Element);
    expect(gallery.classList.contains("foli-style-gallery-open")).toBe(true);
    fireEvent.pointerDown(document.body);
    expect(gallery.classList.contains("foli-style-gallery-open")).toBe(false);
  });

  it("leaves the default toolbar's items as they were: letters and text", () => {
    const editor = createEditor({ document: word });
    render(<FoliToolbar editor={editor} tabs={defaultToolbarTabs} />);
    expect(screen.getByRole("button", { name: "Bold" }).textContent).toBe("B");
    expect(toolbarItems.bold.icon).toBe("B");
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

  it("shows KeyTips on Alt: a tab's letter shows it, an item's letter presses it", () => {
    const editor = createEditor({ document: word });
    const { container } = render(<FoliToolbar editor={editor} tabs={wordRibbonTabs} />);
    const tips = () => [...container.querySelectorAll(".foli-keytip")].map((b) => b.textContent);
    const alt = () => {
      fireEvent.keyDown(document.body, { key: "Alt", altKey: true });
      fireEvent.keyUp(document.body, { key: "Alt" });
    };
    // jsdom lays nothing out: the letters are placed from zero-sized boxes, so read the state
    // through the keys instead of the badges.
    alt();
    fireEvent.keyDown(document.body, { key: "n" });
    expect(screen.getByRole("tab", { name: "Insert" }).getAttribute("aria-selected")).toBe("true");
    // Page break is Insert's first item: P is its first letter, free in this tab.
    const before = JSON.stringify(editor.getDocument()).split('"pageBreak"').length;
    fireEvent.keyDown(document.body, { key: "p" });
    expect(JSON.stringify(editor.getDocument()).split('"pageBreak"').length).toBe(before + 1);
    // The letters are gone after the press; Escape with none shown does nothing.
    expect(tips()).toEqual([]);
    alt();
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.keyDown(document.body, { key: "h" });
    expect(screen.getByRole("tab", { name: "Insert" }).getAttribute("aria-selected")).toBe("true");
  });

  it("leaves Alt alone with keyTips={false}", () => {
    const editor = createEditor({ document: word });
    render(<FoliToolbar editor={editor} tabs={wordRibbonTabs} keyTips={false} />);
    fireEvent.keyDown(document.body, { key: "Alt", altKey: true });
    fireEvent.keyUp(document.body, { key: "Alt" });
    fireEvent.keyDown(document.body, { key: "n" });
    expect(screen.getByRole("tab", { name: "Home" }).getAttribute("aria-selected")).toBe("true");
  });

  describe('with overflow="menu" in a row too narrow', () => {
    // jsdom lays nothing out: the row's widths are given, from its large buttons.
    const widths = (scroll: (large: number) => number) => {
      const bar = (e: Element) => e.classList.contains("foli-toolbar");
      // Large and medium buttons, which drawn small save room.
      const large = (e: Element) =>
        e.querySelectorAll(".foli-toolbar-large, .foli-toolbar-medium").length;
      const scrollWidth = Object.getOwnPropertyDescriptor(Element.prototype, "scrollWidth");
      const clientWidth = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth");
      Object.defineProperty(Element.prototype, "scrollWidth", {
        configurable: true,
        get(this: Element) {
          return bar(this) ? scroll(large(this)) : 0;
        },
      });
      Object.defineProperty(Element.prototype, "clientWidth", {
        configurable: true,
        get(this: Element) {
          return bar(this) ? 450 : 0;
        },
      });
      onTestFinished(() => {
        if (scrollWidth) Object.defineProperty(Element.prototype, "scrollWidth", scrollWidth);
        if (clientWidth) Object.defineProperty(Element.prototype, "clientWidth", clientWidth);
      });
    };
    const big = (key: string, label: string) => ({
      key,
      label,
      icon: "*",
      size: "large" as const,
      command: () => true,
    });
    const tabs = [
      {
        key: "t",
        label: "T",
        items: [
          { label: "One", items: [big("a", "A")] },
          { label: "Two", items: [big("b", "B"), big("c", "C")] },
        ],
      },
    ];

    it("draws the last groups' large buttons small while that narrows the row", () => {
      // Each large button drawn small saves 40 px: two of three are enough.
      widths((large) => 400 + 40 * large);
      const editor = createEditor({ document: word });
      const { container } = render(<FoliToolbar editor={editor} tabs={tabs} overflow="menu" />);
      // The last group (two buttons) small, the first still large.
      const large = [...container.querySelectorAll(".foli-toolbar-large")].map(
        (b) => b.getAttribute("aria-label") ?? b.textContent,
      );
      expect(large).toEqual(["*A"]);
    });

    it("draws medium buttons as their icon alone when that narrows the row", () => {
      widths((large) => 400 + 40 * large);
      const mid = (key: string) => ({
        key,
        label: key,
        text: key,
        icon: "*",
        size: "medium" as const,
        command: () => true,
      });
      const editor = createEditor({ document: word });
      const { container } = render(
        <FoliToolbar
          editor={editor}
          tabs={[
            {
              key: "t",
              label: "T",
              items: [
                { label: "One", items: [big("a", "A")] },
                { label: "Two", items: [mid("m")] },
              ],
            },
          ]}
          overflow="menu"
        />,
      );
      // The last group's medium button drawn small: its icon, named by its label.
      const m = container.querySelector(".foli-toolbar-m") as HTMLElement;
      expect(m.classList.contains("foli-toolbar-medium")).toBe(false);
      expect(m.getAttribute("aria-label")).toBe("m");
    });

    it("keeps them large when drawing them small does not narrow the row", () => {
      widths(() => 600);
      const editor = createEditor({ document: word });
      const { container } = render(<FoliToolbar editor={editor} tabs={tabs} overflow="menu" />);
      expect(container.querySelectorAll(".foli-toolbar-large")).toHaveLength(3);
    });
  });
});
