// @vitest-environment jsdom
import { createEditor, type FoliDocument } from "@folijs/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FoliMiniToolbar, miniToolbarItems } from "./index.js";

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

describe("FoliMiniToolbar", () => {
  it("formats the selection; a key, or the selection going, puts it away", () => {
    const editor = createEditor({ document: doc });
    editor.select(1, 4);
    const onClose = vi.fn();
    render(<FoliMiniToolbar editor={editor} at={{ x: 50, y: 80 }} onClose={onClose} />);
    const bar = screen.getByRole("toolbar", { name: "Mini toolbar" });
    fireEvent.click(screen.getByRole("button", { name: "Bold" }), { detail: 1 });
    expect(editor.isMarkActive("bold")).toBe(true);
    // A key inside it is its own; one elsewhere puts it away.
    fireEvent.keyDown(bar, { key: "ArrowRight" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "a" });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => {
      editor.select(2);
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("has Word's entries, drawn with icons", () => {
    expect(miniToolbarItems.map((item) => item.key)).toEqual([
      "font",
      "size",
      "growFont",
      "shrinkFont",
      "bold",
      "italic",
      "underline",
      "textColor",
      "highlight",
      "style",
      "newComment",
    ]);
    expect(typeof miniToolbarItems[4]?.icon).toBe("object");
  });
});
