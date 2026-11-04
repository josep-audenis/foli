// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderContent } from "./index.js";

const toHTML = (fragment: DocumentFragment) => {
  const host = document.createElement("div");
  host.append(fragment);
  return host.innerHTML;
};

describe("renderContent", () => {
  it("renders blocks, nested marks and hard breaks", () => {
    const html = toHTML(
      renderContent({
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "a", marks: [{ type: "bold" }, { type: "italic" }] },
              { type: "hardBreak" },
              { type: "text", text: "b" },
            ],
          },
          { type: "paragraph" },
        ],
      }),
    );
    expect(html).toBe("<h2>Title</h2><p><strong><em>a</em></strong><br>b</p><p><br></p>");
  });

  it("never interprets text as markup", () => {
    const html = toHTML(
      renderContent({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "<img src=x onerror=alert(1)>" }] },
        ],
      }),
    );
    expect(html).toBe("<p>&lt;img src=x onerror=alert(1)&gt;</p>");
  });
});
