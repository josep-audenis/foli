// @vitest-environment jsdom
import { createEditor, type FoliDocument, setPageBorders, undo } from "@folijs/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FoliToolbar, toolbarItems, wordRibbonTabs } from "./index.js";

/** Word's Design tab (Phase 32): Page Color and Page Borders. */

const documentOf = (section: object = {}): FoliDocument => ({
  schemaVersion: 9,
  section,
  defaults: {},
  styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
  numbering: { abstracts: [], instances: [] },
  comments: [],
  content: {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { section: {} }, content: [{ type: "text", text: "one" }] },
      { type: "paragraph", content: [{ type: "text", text: "two" }] },
    ],
  },
});

afterEach(cleanup);

function open(section?: object) {
  const editor = createEditor({ document: documentOf(section) });
  render(<FoliToolbar editor={editor} tabs={wordRibbonTabs} />);
  fireEvent.click(screen.getByRole("tab", { name: "Design" }));
  return editor;
}

describe("Design tab", () => {
  it("has the Page Background group", () => {
    const design = wordRibbonTabs.find((tab) => tab.key === "design");
    expect(design?.items.flatMap((g) => ("items" in g ? g.items : g)).map((i) => i.key)).toEqual(
      expect.arrayContaining(["pageColor", "pageBorders"]),
    );
    expect(toolbarItems.pageColor.colors.custom).toBe(true);
  });

  it("sets the page color and removes it with No Color", () => {
    const editor = open();
    fireEvent.click(screen.getByRole("button", { name: /^Page color/i }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Accent 1" }));
    expect(editor.getDocument().settings?.background?.color).toMatch(/^[0-9A-F]{6}$/);
    fireEvent.click(screen.getByRole("button", { name: /^Page color/i }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "No Color" }));
    expect(editor.getDocument().settings?.background).toEqual({ color: "auto" });
    editor.run(undo);
    expect(editor.getDocument().settings?.background?.color).not.toBe("auto");
  });
});

describe("Page Borders dialog", () => {
  const dialog = () => screen.getByRole("dialog", { name: "Page Borders" });
  const submit = () => fireEvent.submit(dialog().querySelector("form") as HTMLFormElement);

  it("sets a box on every section, from the page's edge, in one undo step", () => {
    const editor = open();
    editor.select(2);
    fireEvent.click(screen.getByRole("button", { name: /^Page borders/i }));
    const box = within(dialog());
    expect((box.getByLabelText("None") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(box.getByLabelText("Box"));
    fireEvent.change(box.getByLabelText("Style"), { target: { value: "double" } });
    fireEvent.change(box.getByLabelText("Width"), { target: { value: "12" } });
    submit();
    expect(screen.queryByRole("dialog")).toBeNull();
    const line = { style: "double", size: 12, space: 24, color: "auto" };
    const borders = { offsetFrom: "page", top: line, bottom: line, left: line, right: line };
    expect(editor.getDocument().section.pageBorders).toEqual(borders);
    expect(editor.state.doc.child(0).attrs.section).toEqual({ pageBorders: borders });
    editor.run(undo);
    expect(editor.getDocument().section.pageBorders).toBeUndefined();
    expect(editor.state.doc.child(0).attrs.section).toEqual({});
  });

  it("shows the section's borders, and sets some sides for its first page only", () => {
    const line = { style: "single", size: 4, space: 4, color: "FF0000" };
    const editor = open({ pageBorders: { top: line, bottom: line, left: line, right: line } });
    editor.select(7);
    fireEvent.click(screen.getByRole("button", { name: /^Page borders/i }));
    const box = within(dialog());
    expect((box.getByLabelText("Box") as HTMLInputElement).checked).toBe(true);
    expect((box.getByLabelText("Measure from") as HTMLSelectElement).value).toBe("text");
    expect((box.getByLabelText("Distance (pt)") as HTMLInputElement).value).toBe("4");
    fireEvent.click(box.getByLabelText("Left border"));
    fireEvent.click(box.getByLabelText("Right border"));
    expect((box.getByLabelText("Custom") as HTMLInputElement).checked).toBe(true);
    fireEvent.change(box.getByLabelText("Apply to"), { target: { value: "firstPage" } });
    submit();
    expect(editor.getDocument().section.pageBorders).toEqual({
      display: "firstPage",
      top: line,
      bottom: line,
    });
    // The first section is not changed.
    expect(editor.state.doc.child(0).attrs.section).toEqual({});
  });

  it("marks a distance Word does not take, and None removes them", () => {
    const line = { style: "single", size: 4, space: 24, color: "auto" };
    const editor = open({ pageBorders: { offsetFrom: "page", top: line } });
    editor.select(7);
    fireEvent.click(screen.getByRole("button", { name: /^Page borders/i }));
    const box = within(dialog());
    fireEvent.change(box.getByLabelText("Distance (pt)"), { target: { value: "40" } });
    submit();
    expect(screen.getByRole("alert").textContent).toContain("Distance (pt)");
    fireEvent.click(box.getByLabelText("None"));
    submit();
    expect(editor.getDocument().section.pageBorders).toBeUndefined();
  });
});

describe("Page Borders dialog keeps what it does not show", () => {
  const dialog = () => screen.getByRole("dialog", { name: "Page Borders" });
  const submit = () => fireEvent.submit(dialog().querySelector("form") as HTMLFormElement);

  it("changes nothing on OK untouched; keeps zOrder and each side's own line", () => {
    const red = { style: "single", size: 4, space: 4, color: "FF0000" };
    const blue = { style: "dotted", size: 8, space: 4, color: "0000FF" };
    const borders = { zOrder: "back", top: red, bottom: blue };
    const editor = open({ pageBorders: borders });
    editor.select(7);
    const before = editor.state;
    fireEvent.click(screen.getByRole("button", { name: /^Page borders/i }));
    submit();
    expect(editor.state).toBe(before);
    fireEvent.click(screen.getByRole("button", { name: /^Page borders/i }));
    const box = within(dialog());
    fireEvent.click(box.getByLabelText("Left border"));
    fireEvent.change(box.getByLabelText("Apply to"), { target: { value: "section" } });
    submit();
    expect(editor.getDocument().section.pageBorders).toEqual({
      zOrder: "back",
      top: red,
      bottom: blue,
      left: { style: "single", size: 4, space: 4, color: "FF0000" },
    });
  });

  it("None with Apply to this section removes only this section's borders", () => {
    const line = { style: "single", size: 4, space: 24, color: "auto" };
    const editor = open({ pageBorders: { offsetFrom: "page", top: line } });
    editor.run(setPageBorders({ offsetFrom: "page", top: line }, "document"));
    editor.select(7);
    fireEvent.click(screen.getByRole("button", { name: /^Page borders/i }));
    const box = within(dialog());
    fireEvent.click(box.getByLabelText("None"));
    fireEvent.change(box.getByLabelText("Apply to"), { target: { value: "section" } });
    submit();
    expect(editor.getDocument().section.pageBorders).toBeUndefined();
    expect(editor.state.doc.child(0).attrs.section).toEqual({
      pageBorders: { offsetFrom: "page", top: line },
    });
  });
});

describe("Home ▸ Borders and Shading (32.4)", () => {
  const home = () => {
    const editor = createEditor({ document: documentOf() });
    render(<FoliToolbar editor={editor} tabs={wordRibbonTabs} />);
    return editor;
  };
  const attrs = (editor: ReturnType<typeof home>, i = 0) =>
    editor.state.doc.child(i).attrs as Record<string, unknown>;

  it("Borders' menu toggles a side; Shading fills the paragraph", () => {
    const editor = home();
    editor.select(2);
    fireEvent.click(screen.getByRole("button", { name: /^Borders/ }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Bottom border" }));
    expect(attrs(editor).borders).toEqual({
      bottom: { style: "single", size: 4, space: 1, color: "auto" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Shading/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Accent 1" }));
    expect(attrs(editor).shading).toMatchObject({ pattern: "clear", color: "auto" });
  });

  it("the dialog sets borders and shading in one undo step, and OK untouched changes nothing", () => {
    const editor = home();
    editor.select(2);
    const before = editor.state;
    const openDialog = () => {
      fireEvent.click(screen.getByRole("button", { name: /^Borders/ }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Borders and Shading…" }));
      return within(screen.getByRole("dialog", { name: "Borders and Shading" }));
    };
    let box = openDialog();
    fireEvent.submit(box.getByRole("button", { name: "OK" }).closest("form") as HTMLFormElement);
    expect(editor.state).toBe(before);
    box = openDialog();
    fireEvent.click(box.getByLabelText("Box"));
    fireEvent.change(box.getByLabelText("Style"), { target: { value: "double" } });
    fireEvent.change(box.getByLabelText("Pattern style"), { target: { value: "pct10" } });
    fireEvent.submit(box.getByRole("button", { name: "OK" }).closest("form") as HTMLFormElement);
    expect(Object.keys(attrs(editor).borders as object).sort()).toEqual([
      "bottom",
      "left",
      "right",
      "top",
    ]);
    expect(attrs(editor).shading).toEqual({ pattern: "pct10", color: "auto", fill: "auto" });
    editor.run(undo);
    expect(attrs(editor).borders).toBeNull();
    expect(attrs(editor).shading).toBeNull();
  });
});
