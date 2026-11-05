// @vitest-environment jsdom
import { createDocument, type FoliDocument } from "@foli/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentEditor } from "./index.js";

describe("DocumentEditor", () => {
  afterEach(cleanup);

  it("renders initial content inside an A4 page", async () => {
    const doc = createDocument({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello Foli" }] }],
    });
    const { container } = render(<DocumentEditor initialContent={doc} />);

    expect(await screen.findByText("Hello Foli")).toBeTruthy();
    const page = container.querySelector<HTMLElement>(".foli-page");
    expect(page?.style.width).toBe("210mm");
  });

  it("is editable and reports changes through onChange", () => {
    const changes: FoliDocument[] = [];
    render(<DocumentEditor onChange={(doc) => changes.push(doc)} />);
    const host = screen.getByRole("textbox", { name: "Document" });
    expect(host.getAttribute("contenteditable")).toBe("true");

    host.dispatchEvent(
      new InputEvent("beforeinput", { inputType: "insertText", data: "Hi", cancelable: true }),
    );
    expect(host.textContent).toBe("Hi");
    expect(changes.at(-1)?.content).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
    });
  });

  it("passes readOnly, placeholder and label to the view, also when they change", () => {
    const { rerender } = render(<DocumentEditor readOnly placeholder="Write…" label="Notes" />);
    const host = screen.getByRole("textbox", { name: "Notes" });
    expect(host.getAttribute("contenteditable")).toBe("false");
    expect(host.getAttribute("aria-readonly")).toBe("true");
    expect(host.getAttribute("aria-placeholder")).toBe("Write…");
    expect(host.querySelector("[data-foli-placeholder]")).toBeTruthy();

    rerender(<DocumentEditor placeholder="" label="Notes" />);
    expect(host.getAttribute("contenteditable")).toBe("true");
    expect(host.hasAttribute("aria-readonly")).toBe(false);
    expect(host.querySelector("[data-foli-placeholder]")).toBeNull();
  });
});
