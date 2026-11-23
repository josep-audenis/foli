// @vitest-environment jsdom
// Regressions (Phase 21, 21.9: work the components did that nothing needed, focus left behind).

import {
  createDocument,
  createEditor,
  type FoliDocument,
  insertText,
  openLinkEditor,
  TextSelection,
} from "@folijs/core";
import { EditorView } from "@folijs/view";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FoliCanvas, FoliComments, FoliToolbar } from "./index.js";

afterEach(cleanup);

const doc = (): FoliDocument => ({
  ...createDocument({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
  }),
  defaults: { run: [{ type: "fontSize", attrs: { value: 22 } }] },
});

describe("21.9", () => {
  it("FoliCanvas keeps one resolver for an inline resource function", () => {
    const editor = createEditor({ document: doc() });
    const given: unknown[] = [];
    const setOptions = vi.spyOn(EditorView.prototype, "setOptions");
    try {
      const view = (n: number) => (
        <FoliCanvas editor={editor} resource={() => `data:image/png;base64,${n}`} />
      );
      const { rerender } = render(view(1));
      rerender(view(2));
      rerender(view(3));
      for (const call of setOptions.mock.calls) given.push(call[0].resource);
    } finally {
      setOptions.mockRestore();
    }
    expect(given.length).toBeGreaterThan(0);
    expect(new Set(given).size).toBe(1);
  });

  it("a size box stepped with the arrows applies on Enter, once", () => {
    const editor = createEditor({ document: doc() });
    render(<FoliToolbar editor={editor} />);
    act(() => {
      editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)));
    });
    const box = screen.getByRole("combobox", { name: "Font size" }) as HTMLSelectElement;
    const before = JSON.stringify(editor.getDocument().content);
    const values = [...box.options].map((o) => o.value).filter(Boolean);
    const next = values[values.indexOf(box.value) + 1] as string;
    const after = values[values.indexOf(box.value) + 2] as string;
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.change(box, { target: { value: next } });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.change(box, { target: { value: after } });
    expect(JSON.stringify(editor.getDocument().content)).toBe(before);
    expect(box.value).toBe(after);
    fireEvent.keyUp(box, { key: "Enter" });
    expect(JSON.stringify(editor.getDocument().content)).not.toBe(before);
    expect(box.value).toBe(after);
    // One step to undo, not one per value passed.
    act(() => {
      editor.commands.undo();
    });
    expect(JSON.stringify(editor.getDocument().content)).toBe(before);
  });

  it("a dialog an edit from elsewhere closes gives the focus back", () => {
    const editor = createEditor({ document: doc() });
    render(<FoliToolbar editor={editor} />);
    const bold = screen.getByRole("button", { name: "Bold" });
    bold.focus();
    act(() => {
      editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)));
      editor.run(openLinkEditor);
    });
    const field = screen.getByRole("textbox");
    expect(document.activeElement).toBe(field);
    act(() => {
      editor.run(insertText("x"));
    });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.activeElement).toBe(bold);
  });

  it("FoliComments measures nothing while hidden or without threads", () => {
    const count = (pane: "none" | "hidden" | "shown", comments: FoliDocument["comments"]) => {
      const editor = createEditor({ document: { ...doc(), comments } });
      render(
        <>
          <FoliCanvas editor={editor} />
          {pane !== "none" && <FoliComments editor={editor} hidden={pane === "hidden"} />}
        </>,
      );
      const rect = vi.spyOn(Element.prototype, "getBoundingClientRect");
      try {
        for (let i = 0; i < 5; i++)
          act(() => {
            editor.run(insertText("a"));
          });
        return rect.mock.calls.length;
      } finally {
        rect.mockRestore();
        cleanup();
      }
    };
    const comment = { id: 1, author: "A", content: [{ type: "paragraph" }] };
    // The view's own measuring (the caret scrolled into view) is the baseline.
    const view = count("none", [comment]);
    expect(count("hidden", [comment])).toBe(view);
    expect(count("shown", [])).toBe(view);
  });
});
