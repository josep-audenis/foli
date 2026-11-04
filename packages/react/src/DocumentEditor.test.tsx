// @vitest-environment jsdom
import { createDocument } from "@foli/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DocumentEditor } from "./index.js";

describe("DocumentEditor", () => {
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
});
