// @vitest-environment jsdom
import { createEditor, setTrackChanges, trackState } from "@folijs/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FoliEditor, FoliStatusBar } from "./index.js";

afterEach(cleanup);

const doc = {
  schemaVersion: 5,
  section: {},
  defaults: {},
  styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
  numbering: { abstracts: [], instances: [] },
  comments: [],
  content: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "one two three" }] }],
  },
} as const;

describe("FoliStatusBar", () => {
  it("counts words, of the selection too, and opens Word's count", () => {
    const editor = createEditor({ document: doc });
    render(<FoliStatusBar editor={editor} />);
    const words = screen.getByRole("button", { name: "3 words" });
    act(() => {
      editor.select(1, 4);
    });
    expect(words.textContent).toBe("1 of 3 words");
    fireEvent.click(words);
    const dialog = screen.getByRole("dialog", { name: "Word count" });
    expect(dialog.textContent).toContain("Characters (no spaces)");
    expect(document.activeElement?.textContent).toBe("Close");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(words);
  });

  it("switches tracking, and steps the zoom through Word's sizes", () => {
    const editor = createEditor({ document: doc });
    const onZoomChange = vi.fn();
    render(<FoliStatusBar editor={editor} zoom={1} onZoomChange={onZoomChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Track changes: off" }));
    expect(trackState(editor.state)?.on).toBe(true);
    act(() => {
      editor.run(setTrackChanges(false));
    });
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(onZoomChange).toHaveBeenLastCalledWith(1.25);
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(onZoomChange).toHaveBeenLastCalledWith(0.75);
    fireEvent.change(screen.getByRole("slider", { name: "Zoom" }), { target: { value: "150" } });
    expect(onZoomChange).toHaveBeenLastCalledWith(1.5);
    // Without onZoomChange, no zoom controls.
    cleanup();
    render(<FoliStatusBar editor={editor} />);
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("is in FoliEditor with statusBar, which keeps the zoom", () => {
    const { container } = render(<FoliEditor initialContent={doc} statusBar toolbar={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect((container.querySelector(".foli-content") as HTMLElement).style.zoom).toBe("1.25");
    expect(screen.getByText("125%")).toBeTruthy();
  });
});
