// @vitest-environment jsdom
import { createDocument, type FoliDocument, PAGE_SIZES } from "@folijs/core";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createRef, useLayoutEffect } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useIsomorphicLayoutEffect } from "./editor.js";
import { type FoliChange, FoliEditor, type FoliEditorHandle } from "./index.js";

const text = (value: string, settings?: Partial<FoliDocument["settings"]>) =>
  createDocument(
    { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: value }] }] },
    settings,
  );

function type(value: string) {
  act(() => {
    screen
      .getByRole("textbox")
      .dispatchEvent(
        new InputEvent("beforeinput", { inputType: "insertText", data: value, cancelable: true }),
      );
  });
}

describe("replacing the document (setDocument)", () => {
  afterEach(cleanup);

  it("shows the new content and page settings, resets history and selection", () => {
    const ref = createRef<FoliEditorHandle>();
    const changes: FoliChange[] = [];
    const { container } = render(
      <FoliEditor ref={ref} initialContent={text("First")} onChange={(c) => changes.push(c)} />,
    );
    type("x");
    expect(changes).toHaveLength(1);
    const editor = ref.current?.editor;
    if (!editor) throw new Error("no editor");

    act(() => editor.setDocument(text("Second", { pageSize: PAGE_SIZES.Letter })));
    expect(screen.getByRole("textbox").textContent).toBe("Second");
    expect(container.querySelector<HTMLElement>(".foli-page")?.style.width).toBe("215.9mm");
    expect(editor.settings.pageSize).toEqual(PAGE_SIZES.Letter);
    // Not a change the app has to be told about: it passed the document itself.
    expect(changes).toHaveLength(1);
    // History starts again: nothing to undo, so the old document cannot come back.
    expect(screen.getByRole("button", { name: "Undo" }).getAttribute("aria-disabled")).toBe("true");
    expect(editor.commands.undo()).toBe(false);
    expect(editor.state.selection.from).toBe(1);

    // Typing goes on in the new document and is reported with its settings.
    type("y");
    expect(screen.getByRole("textbox").textContent).toBe("ySecond");
    expect(changes).toHaveLength(2);
    expect(changes[1]?.document.settings.pageSize).toEqual(PAGE_SIZES.Letter);
  });
});

describe("server rendering and hydration", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("runs layout effects as layout effects in the browser (the view exists before paint)", () => {
    expect(useIsomorphicLayoutEffect).toBe(useLayoutEffect);
  });

  it("hydrates the server markup without warnings and attaches the view", () => {
    const doc = text("Served");
    const html = renderToString(<FoliEditor initialContent={doc} label="Notes" />);
    const container = document.createElement("div");
    // Test only: the markup is React's own server output, as a page would receive it.
    container.innerHTML = html;
    document.body.append(container);
    const errors = vi.spyOn(console, "error");

    let root: Root | undefined;
    act(() => {
      root = hydrateRoot(container, <FoliEditor initialContent={doc} label="Notes" />);
    });
    const host = screen.getByRole("textbox", { name: "Notes" });
    expect(host.getAttribute("contenteditable")).toBe("true");
    expect(host.textContent).toBe("Served");
    expect(screen.getByRole("toolbar")).toBeTruthy();
    expect(errors).not.toHaveBeenCalled();
    type("!");
    expect(host.textContent).toBe("!Served");

    act(() => root?.unmount());
    container.remove();
  });
});
