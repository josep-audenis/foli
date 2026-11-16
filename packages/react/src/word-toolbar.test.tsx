// @vitest-environment jsdom
import { createEditor, type FoliDocument, trackState } from "@folijs/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FoliToolbar } from "./index.js";

const document3: FoliDocument = {
  schemaVersion: 4,
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
      "Show changes as",
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
      "Heading 2",
      "Heading 3",
    ]);
    // The theme's fonts are offered too; the one shown now is selected.
    expect([...select("Font").options].map((o) => o.value)).toContain("Aptos Display");
    expect(select("Font size").value).toBe("11");
    expect(select("Line spacing").value).toBe("1");
    // One tab stop for the whole toolbar, selects included.
    const stops = [...screen.getAllByRole("button"), ...screen.getAllByRole("combobox")];
    expect(stops.filter((e) => e.tabIndex === 0)).toHaveLength(1);
  });

  it("tracks changes, shows them, goes to them, accepts and rejects them", () => {
    const editor = setup();
    const button = (name: string) => screen.getByRole("button", { name });
    const content = () => JSON.stringify(editor.getDocument().content);
    expect(button("Track changes").getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button("Track changes"));
    expect(editor.trackingChanges).toBe(true);
    expect(button("Track changes").getAttribute("aria-pressed")).toBe("true");
    act(() => {
      editor.select(1);
      editor.commands.insertText("New ");
    });
    expect(content()).toContain('"insertion"');
    fireEvent.change(select("Show changes as"), { target: { value: "final" } });
    expect(trackState(editor.state)?.view).toBe("final");
    act(() => editor.select(0));
    fireEvent.click(button("Next change"));
    expect(editor.state.selection.empty).toBe(false);
    fireEvent.click(button("Reject"));
    expect(content()).not.toContain('"insertion"');
    fireEvent.click(button("Undo"));
    fireEvent.click(button("Accept all"));
    expect(content()).not.toMatch(/"insertion"|"deletion"/);
    expect(content()).toContain("New ");
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

  it("a pointer pick goes back to the document (onClickCommand); a keyboard one stays", () => {
    const editor = createEditor({ document: document3 });
    const back = vi.fn();
    render(<FoliToolbar editor={editor} onClickCommand={back} />);
    act(() => editor.select(1));
    fireEvent.mouseDown(select("Paragraph style"));
    // Word's Heading 2, not in the document yet: added.
    fireEvent.change(select("Paragraph style"), { target: { value: "Heading2" } });
    expect(back).toHaveBeenCalledTimes(1);
    expect(attrs(editor)[0]).toEqual({ style: "Heading2" });
    expect(select("Paragraph style").value).toBe("Heading2");
    fireEvent.keyDown(select("Paragraph style"), { key: "ArrowUp" });
    fireEvent.change(select("Paragraph style"), { target: { value: "Heading1" } });
    expect(back).toHaveBeenCalledTimes(1);
  });
});
