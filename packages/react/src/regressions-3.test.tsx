// @vitest-environment jsdom
// Bug-hunt repros (third sweep, the toolbar's app items, dialogs and tabs): each test asserts
// the correct behaviour.
import { createDocument, createEditor, insertText } from "@folijs/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FoliToolbar,
  type ToolbarColorMenu,
  type ToolbarDialog,
  type ToolbarSelect,
  toolbarItems,
} from "./index.js";

const doc = () =>
  createDocument({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
  });

const mood = (options: ToolbarColorMenu["colors"]["options"]): ToolbarColorMenu => ({
  key: "mood",
  label: "Mood",
  colors: { options, value: () => null, pick: () => () => true },
});

afterEach(cleanup);

describe("regressions 3: toolbar items", () => {
  it("a box offers the options of the state now, also when no item's state changed", () => {
    const editor = createEditor({ document: doc() });
    const words: ToolbarSelect = {
      key: "words",
      label: "Words",
      select: {
        options: (state) =>
          state.doc.textContent.split(" ").map((word) => ({ value: word, label: word })),
        value: () => null,
        pick: () => () => true,
      },
    };
    render(<FoliToolbar editor={editor} items={[[words]]} />);
    const box = screen.getByRole("combobox", { name: "Words" }) as HTMLSelectElement;
    const offered = () => [...box.options].map((o) => o.value).filter(Boolean);
    expect(offered()).toEqual(["Hello"]);
    act(() => void editor.run(insertText("Hey ")));
    expect(offered().sort()).toEqual(["Hello", "Hey"]);
  });

  it("an app dialog's close called twice closes (and calls onClickCommand) once", () => {
    const editor = createEditor({ document: doc() });
    const onClickCommand = vi.fn();
    const twice: ToolbarDialog = {
      key: "twice",
      label: "Twice",
      dialog: ({ close }) => (
        <button
          type="button"
          onClick={() => {
            close(true);
            close(true);
          }}
        >
          Done
        </button>
      ),
    };
    render(<FoliToolbar editor={editor} items={[[twice]]} onClickCommand={onClickCommand} />);
    fireEvent.click(screen.getByRole("button", { name: "Twice" }), { detail: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onClickCommand).toHaveBeenCalledOnce();
  });

  it("a color menu without colors is disabled and does not open, as a menu without entries", () => {
    const editor = createEditor({ document: doc() });
    render(<FoliToolbar editor={editor} items={[[mood([])]]} />);
    const button = screen.getByRole("button", { name: "Mood" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button, { detail: 0 });
    fireEvent.keyDown(button, { key: "ArrowDown" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("an app dialog gives the focus back to its button as it is now, after the items changed", () => {
    const editor = createEditor({ document: doc() });
    const note: ToolbarDialog = { key: "note", label: "Note", dialog: () => <p>Read me.</p> };
    const { rerender } = render(
      <FoliToolbar editor={editor} items={[[toolbarItems.undo, note]]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Note" }), { detail: 0 });
    // Its group starts with another item now: the button is a new element.
    rerender(<FoliToolbar editor={editor} items={[[note]]} />);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Note" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Note" }));
  });

  it("a menu whose item left the toolbar does not come back open with it", () => {
    const editor = createEditor({ document: doc() });
    const item = mood([{ name: "Brand", color: "#123456" }]);
    const { rerender } = render(<FoliToolbar editor={editor} items={[[item]]} />);
    fireEvent.click(screen.getByRole("button", { name: "Mood" }), { detail: 0 });
    screen.getByRole("menu");
    rerender(<FoliToolbar editor={editor} items={[[toolbarItems.undo]]} />);
    expect(screen.queryByRole("menu")).toBeNull();
    rerender(<FoliToolbar editor={editor} items={[[item]]} />);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
