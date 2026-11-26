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
});
