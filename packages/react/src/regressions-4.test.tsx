// @vitest-environment jsdom
// Regressions (fourth sweep: the toolbar's link dialog focus, tabs, RTL keys, menus).

import { createDocument, createEditor, openLinkEditor, TextSelection } from "@folijs/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  FoliToolbar,
  type ToolbarColorMenu,
  type ToolbarDialog,
  type ToolbarTab,
  toolbarItems,
} from "./index.js";

const doc = () =>
  createDocument({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
  });
const selectAll = (editor: ReturnType<typeof createEditor>) =>
  act(() =>
    editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6))),
  );
const selected = () =>
  screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")?.textContent;

afterEach(cleanup);

describe("regressions 4: toolbar", () => {
  it("the link dialog opened by a click from an app dialog gives the focus to the Link button", () => {
    const editor = createEditor({ document: doc() });
    selectAll(editor);
    const ask: ToolbarDialog = {
      key: "ask",
      label: "Ask",
      dialog: () => <input aria-label="Name" />,
    };
    render(<FoliToolbar editor={editor} items={[[toolbarItems.link, ask]]} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }), { detail: 1 });
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Name" }));
    const link = screen.getByRole("button", { name: "Link" });
    fireEvent.mouseDown(link);
    fireEvent.click(link, { detail: 1 });
    const url = screen.getByRole("textbox", { name: "URL" });
    expect(screen.queryByRole("dialog", { name: "Ask" })).toBeNull();
    fireEvent.keyDown(url, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(link);
  });

  it("a tab removed through props is not selected again when it comes back", () => {
    const editor = createEditor({ document: doc() });
    const tabs: ToolbarTab[] = [
      { key: "a", label: "A", items: [[toolbarItems.undo]] },
      { key: "b", label: "B", items: [[toolbarItems.bold]] },
    ];
    const { rerender } = render(<FoliToolbar editor={editor} tabs={tabs} />);
    fireEvent.click(screen.getByRole("tab", { name: "B" }), { detail: 1 });
    expect(selected()).toBe("B");
    rerender(<FoliToolbar editor={editor} tabs={tabs.slice(0, 1)} />);
    expect(selected()).toBe("A");
    rerender(<FoliToolbar editor={editor} tabs={tabs} />);
    expect(selected()).toBe("A");
  });

  it("the selected tab removed through props resets the roving index, menus and dialogs", () => {
    const editor = createEditor({ document: doc() });
    // The same items on both tabs: only the change of tab can reset them.
    const items = [[toolbarItems.undo, toolbarItems.redo, toolbarItems.textColor]];
    const tabs: ToolbarTab[] = [
      { key: "a", label: "A", items },
      { key: "b", label: "B", items },
    ];
    const { rerender } = render(<FoliToolbar editor={editor} tabs={tabs} />);
    fireEvent.click(screen.getByRole("tab", { name: "B" }), { detail: 1 });
    const color = screen.getByRole("button", { name: "Text color" });
    act(() => color.focus());
    fireEvent.click(color, { detail: 0 });
    screen.getByRole("menu");
    rerender(<FoliToolbar editor={editor} tabs={tabs.slice(0, 1)} />);
    expect(selected()).toBe("A");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "Undo" }).tabIndex).toBe(0);
  });

  it("mirrors the arrow keys of the toolbar and the tab list in a right-to-left layout", () => {
    const editor = createEditor({ document: doc() });
    const tabs: ToolbarTab[] = [
      {
        key: "a",
        label: "A",
        items: [[toolbarItems.undo, toolbarItems.redo, toolbarItems.bold]],
      },
      { key: "b", label: "B", items: [[toolbarItems.undo]] },
      { key: "c", label: "C", items: [[toolbarItems.undo]] },
    ];
    render(
      <div dir="rtl">
        <FoliToolbar editor={editor} tabs={tabs} />
      </div>,
    );
    const undoButton = screen.getByRole("button", { name: "Undo" });
    act(() => undoButton.focus());
    fireEvent.keyDown(undoButton, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Bold" }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(undoButton);
    const a = screen.getByRole("tab", { name: "A" });
    act(() => a.focus());
    fireEvent.keyDown(a, { key: "ArrowRight" });
    expect(selected()).toBe("C");
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowLeft" });
    expect(selected()).toBe("A");
  });

  it("two toolbars on one editor open one link dialog on Mod-K", () => {
    const editor = createEditor({ document: doc() });
    selectAll(editor);
    render(
      <>
        <FoliToolbar editor={editor} label="One" />
        <FoliToolbar editor={editor} label="Two" />
      </>,
    );
    act(() => void editor.run(openLinkEditor));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("a click on Link in the second toolbar opens the second toolbar's dialog, and only one", () => {
    const editor = createEditor({ document: doc() });
    selectAll(editor);
    render(
      <>
        <div data-testid="one">
          <FoliToolbar editor={editor} label="One" />
        </div>
        <div data-testid="two">
          <FoliToolbar editor={editor} label="Two" />
        </div>
      </>,
    );
    const link = within(screen.getByTestId("two")).getByRole("button", { name: "Link" });
    fireEvent.mouseDown(link);
    fireEvent.click(link, { detail: 1 });
    within(screen.getByTestId("two")).getByRole("dialog");
    act(() => void editor.run(openLinkEditor));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    within(screen.getByTestId("two")).getByRole("dialog");
  });

  it("the first mounted toolbar stays the link dialog's owner after its `disabled` flips", () => {
    const editor = createEditor({ document: doc() });
    selectAll(editor);
    const both = (off: boolean) => (
      <>
        <div data-testid="one">
          <FoliToolbar editor={editor} label="One" disabled={off} />
        </div>
        <div data-testid="two">
          <FoliToolbar editor={editor} label="Two" />
        </div>
      </>
    );
    const { rerender } = render(both(false));
    rerender(both(true));
    rerender(both(false));
    act(() => void editor.run(openLinkEditor));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    within(screen.getByTestId("one")).getByRole("dialog");
  });

  it("a `defaultTab` not in `tabs` yet is selected when it arrives", () => {
    const editor = createEditor({ document: doc() });
    const tabs: ToolbarTab[] = [
      { key: "home", label: "Home", items: [[toolbarItems.undo]] },
      { key: "insert", label: "Insert", items: [[toolbarItems.bold]] },
    ];
    const { rerender } = render(
      <FoliToolbar editor={editor} tabs={tabs.slice(0, 1)} defaultTab="insert" />,
    );
    expect(selected()).toBe("Home");
    rerender(<FoliToolbar editor={editor} tabs={tabs} defaultTab="insert" />);
    expect(selected()).toBe("Insert");
  });

  it("a toolbar styled `direction: ltr` inside a right-to-left block keeps the arrow keys", () => {
    const editor = createEditor({ document: doc() });
    render(
      <div dir="rtl">
        <div style={{ direction: "ltr" }}>
          <FoliToolbar
            editor={editor}
            items={[[toolbarItems.undo, toolbarItems.redo, toolbarItems.bold]]}
          />
        </div>
      </div>,
    );
    const undoButton = screen.getByRole("button", { name: "Undo" });
    act(() => undoButton.focus());
    fireEvent.keyDown(undoButton, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Redo" }));
  });

  it("an open menu closes when its item's `enabled` turns false", () => {
    const editor = createEditor({ document: doc() });
    let on = true;
    const mood: ToolbarColorMenu = {
      key: "mood",
      label: "Mood",
      enabled: () => on,
      colors: {
        options: [{ name: "Brand", color: "#123456" }],
        value: () => null,
        pick: () => () => true,
      },
    };
    render(<FoliToolbar editor={editor} items={[[mood]]} />);
    fireEvent.click(screen.getByRole("button", { name: "Mood" }), { detail: 0 });
    screen.getByRole("menu");
    on = false;
    selectAll(editor);
    expect(screen.getByRole("button", { name: "Mood" }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
