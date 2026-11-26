// @vitest-environment jsdom
import { createEditor } from "@folijs/core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FoliCanvas } from "./index.js";

afterEach(cleanup);

describe("FoliCanvas zoom", () => {
  it("draws the pages at `zoom`, and asks for the next one on Ctrl+wheel", () => {
    const editor = createEditor();
    const onZoomChange = vi.fn();
    const { container, rerender } = render(
      <FoliCanvas editor={editor} zoom={2} onZoomChange={onZoomChange} />,
    );
    const content = container.querySelector(".foli-content") as HTMLElement;
    expect(content.style.zoom).toBe("2");
    fireEvent.wheel(content, { deltaY: -100, ctrlKey: true });
    expect(onZoomChange).toHaveBeenCalledWith(2.1);
    // Out of Word's range: kept in it.
    rerender(<FoliCanvas editor={editor} zoom={9} onZoomChange={onZoomChange} />);
    expect(content.style.zoom).toBe("5");
    rerender(<FoliCanvas editor={editor} zoom={1} />);
    expect(content.style.zoom).toBe("");
    // Without onZoomChange the wheel is the browser's.
    onZoomChange.mockClear();
    const event = fireEvent.wheel(content, { deltaY: -100, ctrlKey: true });
    expect(event).toBe(true);
    expect(onZoomChange).not.toHaveBeenCalled();
  });

  it("steps by notches of a hundred px (a pinch's small deltas add up), from the zoom asked", () => {
    const editor = createEditor();
    const onZoomChange = vi.fn();
    const { container, unmount } = render(
      <FoliCanvas editor={editor} zoom={1} onZoomChange={onZoomChange} />,
    );
    const content = container.querySelector(".foli-content") as HTMLElement;
    for (let i = 0; i < 3; i++) fireEvent.wheel(content, { deltaY: -40, ctrlKey: true });
    expect(onZoomChange.mock.calls).toEqual([[1.1]]);
    // Before the app sets it, the next notch goes on from 1.1.
    fireEvent.wheel(content, { deltaY: -100, ctrlKey: true });
    expect(onZoomChange).toHaveBeenLastCalledWith(1.2);
    // Printed at 100% whatever the zoom; the zoom goes with the view.
    expect(document.head.textContent).toContain("zoom:1!important");
    unmount();
    expect(content.style.zoom).toBe("");
  });
});
