// @vitest-environment jsdom
import { createEditor, type FoliDocument, insertTable, setTrackChanges } from "@folijs/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultContextMenuItems, FoliContextMenu, FoliEditor } from "./index.js";

afterEach(cleanup);

const doc: FoliDocument = {
  schemaVersion: 5,
  section: {},
  defaults: {},
  styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
  numbering: { abstracts: [], instances: [] },
  comments: [],
  content: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "one two" }] }],
  },
};
const names = () => screen.getAllByRole("menuitem").map((item) => item.textContent);

describe("FoliContextMenu", () => {
  it("shows what applies: no cut at a caret, a table's entries in a table", () => {
    const editor = createEditor({ document: doc });
    editor.select(2);
    const onClose = vi.fn();
    const { unmount } = render(
      <FoliContextMenu editor={editor} at={{ x: 10, y: 10 }} onClose={onClose} />,
    );
    expect(names()).not.toContain("Cut");
    expect(names()).toContain("New comment");
    expect(names()).not.toContain("Merge cells");
    unmount();
    act(() => {
      editor.run(insertTable(2, 2));
    });
    render(<FoliContextMenu editor={editor} at={{ x: 10, y: 10 }} onClose={onClose} />);
    expect(names()).toContain("Insert row below");
    fireEvent.click(screen.getByRole("menuitem", { name: "Insert row below" }));
    expect(onClose).toHaveBeenCalled();
    let rows = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "tableRow") rows++;
    });
    expect(rows).toBe(3);
  });

  it("offers Accept and Reject on a tracked change; moves with the arrows; Escape closes", () => {
    const editor = createEditor({ document: doc });
    editor.run(setTrackChanges(true));
    editor.select(3);
    editor.commands.insertText("X");
    editor.select(3);
    const onClose = vi.fn();
    const onFocusDocument = vi.fn();
    render(
      <FoliContextMenu
        editor={editor}
        at={{ x: 10, y: 10 }}
        onClose={onClose}
        onFocusDocument={onFocusDocument}
      />,
    );
    expect(names()).toEqual(expect.arrayContaining(["Accept change", "Reject change"]));
    const menu = screen.getByRole("menu", { name: "Document menu" });
    expect(document.activeElement).toBe(screen.getAllByRole("menuitem")[0]);
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getAllByRole("menuitem")[1]);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(onFocusDocument).toHaveBeenCalled();
  });

  it("takes an app's entries", () => {
    const editor = createEditor({ document: doc });
    const run = vi.fn();
    render(
      <FoliContextMenu
        editor={editor}
        at={{ x: 0, y: 0 }}
        onClose={() => {}}
        items={(defaults) => [...defaults, { key: "mine", label: "Mine", run }]}
        messages={{ Mine: "Meu" }}
      />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Meu" }));
    expect(run).toHaveBeenCalledWith(editor);
    expect(defaultContextMenuItems.length).toBeGreaterThan(5);
  });

  it("opens from FoliEditor's document with contextMenu; Shift keeps the browser's", async () => {
    vi.useFakeTimers();
    const { container } = render(<FoliEditor initialContent={doc} contextMenu toolbar={false} />);
    const content = container.querySelector(".foli-content") as HTMLElement;
    expect(fireEvent.contextMenu(content, { shiftKey: true })).toBe(true);
    act(() => vi.runAllTimers());
    expect(screen.queryByRole("menu")).toBeNull();
    expect(fireEvent.contextMenu(content, { clientX: 5, clientY: 5 })).toBe(false);
    act(() => vi.runAllTimers());
    expect(screen.getByRole("menu", { name: "Document menu" })).toBeTruthy();
    vi.useRealTimers();
  });
});
