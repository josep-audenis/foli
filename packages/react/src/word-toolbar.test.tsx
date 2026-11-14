// @vitest-environment jsdom
import { createEditor, type FoliDocumentV3 } from "@folijs/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FoliToolbar } from "./index.js";

const document3: FoliDocumentV3 = {
  schemaVersion: 3,
  section: {},
  defaults: { run: [{ type: "fontSize", attrs: { value: 22 } }] },
  styles: [
    { id: "Normal", type: "paragraph", name: "Normal", isDefault: true },
    { id: "Heading1", type: "paragraph", name: "heading 1", basedOn: "Normal" },
  ],
  numbering: { abstracts: [], instances: [] },
  comments: [],
  theme: { fonts: { major: { latin: "Aptos Display" }, minor: { latin: "Aptos" } }, colors: {} },
  content: {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
      { type: "paragraph", content: [{ type: "text", text: "World" }] },
    ],
  },
};

function setup() {
  const editor = createEditor({ document: document3 });
  render(<FoliToolbar editor={editor} />);
  return editor;
}
const select = (name: string) => screen.getByRole("combobox", { name }) as HTMLSelectElement;
const attrs = (editor: ReturnType<typeof setup>) =>
  (editor.getDocument().content.content ?? []).map((b) => b.attrs ?? {});

describe("FoliToolbar on a schema v3 document", () => {
  afterEach(cleanup);

  it("shows Word's controls: style, font, size, line spacing; no headings or rule", () => {
    setup();
    expect(screen.getAllByRole("combobox").map((s) => s.getAttribute("aria-label"))).toEqual([
      "Paragraph style",
      "Font",
      "Font size",
      "Line spacing",
    ]);
    const names = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(names).not.toContain("H1");
    expect(names).not.toContain("Horizontal rule");
    expect(names).toContain("Bulleted list");
    expect([...select("Paragraph style").options].map((o) => o.text)).toEqual([
      "Normal",
      "Heading 1",
    ]);
    // The theme's fonts are offered too; the one shown now is selected.
    expect([...select("Font").options].map((o) => o.value)).toContain("Aptos Display");
    expect(select("Font size").value).toBe("11");
    expect(select("Line spacing").value).toBe("1");
    // One tab stop for the whole toolbar, selects included.
    const stops = [...screen.getAllByRole("button"), ...screen.getAllByRole("combobox")];
    expect(stops.filter((e) => e.tabIndex === 0)).toHaveLength(1);
  });

  it("applies what is picked and follows the selection", () => {
    const editor = setup();
    act(() => editor.select(1));
    fireEvent.change(select("Paragraph style"), { target: { value: "Heading1" } });
    expect(attrs(editor)[0]).toEqual({ style: "Heading1" });
    expect(select("Paragraph style").value).toBe("Heading1");
    fireEvent.change(select("Font size"), { target: { value: "14" } });
    expect(select("Font size").value).toBe("14");
    fireEvent.change(select("Line spacing"), { target: { value: "1.5" } });
    expect(attrs(editor)[0]).toEqual({
      style: "Heading1",
      spacing: { line: 360, lineRule: "auto" },
    });
    fireEvent.change(select("Font"), { target: { value: "Arial" } });
    expect(select("Font").value).toBe("Arial");
    // Mixed: a blank entry.
    act(() => editor.select(1, 9));
    expect(select("Paragraph style").value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Bulleted list" }));
    expect(attrs(editor).map((a) => a.numbering)).toEqual([
      { id: 1, level: 0 },
      { id: 1, level: 0 },
    ]);
    expect(screen.getByRole("button", { name: "Bulleted list" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Increase indent" }));
    expect(attrs(editor).map((a) => a.numbering)).toEqual([
      { id: 1, level: 1 },
      { id: 1, level: 1 },
    ]);
  });

  it("offers Word's highlight colors", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Highlight" }));
    const items = screen
      .getAllByRole("menuitemradio")
      .map((i) => i.textContent ?? i.getAttribute("aria-label"));
    expect(items.join(" ")).toContain("Bright green");
  });
});
