// @vitest-environment jsdom
import { createEditor, type FoliDocument, openDialog, undo } from "@folijs/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FoliToolbar, wordRibbonTabs } from "./index.js";
import { formatLength, parseLength } from "./units.js";

const paragraph = (text: string, attrs?: Record<string, unknown>) => ({
  type: "paragraph",
  ...(attrs ? { attrs } : {}),
  content: [{ type: "text", text }],
});
const documentOf = (...content: object[]): FoliDocument => ({
  schemaVersion: 5,
  section: {},
  defaults: { run: [{ type: "fontSize", attrs: { value: 22 } }] },
  styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
  numbering: { abstracts: [], instances: [] },
  comments: [],
  content: { type: "doc", content: content as never },
});

afterEach(cleanup);

describe("units", () => {
  it("shows and reads lengths as Word's boxes do", () => {
    expect(formatLength(720, "in")).toBe('0.5"');
    expect(formatLength(567, "cm")).toBe("1 cm");
    expect(formatLength(120, "pt")).toBe("6 pt");
    expect(parseLength("0.5", "in")).toBe(720);
    expect(parseLength('1"', "cm")).toBe(1440);
    expect(parseLength("2,54 cm", "in")).toBe(1440);
    expect(parseLength("12 pt", "in")).toBe(240);
    expect(parseLength("-0.25", "in")).toBe(-360);
    expect(parseLength("", "in")).toBeNull();
    expect(parseLength("abc", "in")).toBeNull();
    expect(parseLength("1 km", "in")).toBeNull();
  });
});

describe("Paragraph dialog", () => {
  const open = (...content: object[]) => {
    const editor = createEditor({ document: documentOf(...content) });
    render(<FoliToolbar editor={editor} tabs={wordRibbonTabs} />);
    return editor;
  };
  const dialog = () => screen.getByRole("dialog", { name: "Paragraph" });
  const submit = () => fireEvent.submit(dialog().querySelector("form") as HTMLFormElement);
  const attrsOf = (editor: ReturnType<typeof open>, i = 0) =>
    editor.state.doc.child(i).attrs as Record<string, unknown>;

  it("opens from the Paragraph group's launcher and sets what was changed, in one undo step", () => {
    const editor = open(paragraph("one", { indent: { left: 720 } }));
    editor.select(2);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Paragraph settings" })[0] as HTMLElement,
    );
    expect((within(dialog()).getByLabelText("Left") as HTMLInputElement).value).toBe('0.5"');
    fireEvent.change(within(dialog()).getByLabelText("Alignment"), { target: { value: "center" } });
    fireEvent.change(within(dialog()).getByLabelText("Special"), { target: { value: "hanging" } });
    fireEvent.change(within(dialog()).getByLabelText("By"), { target: { value: "0.25" } });
    fireEvent.change(within(dialog()).getByLabelText("Line spacing"), {
      target: { value: "exact" },
    });
    fireEvent.change(within(dialog()).getByLabelText("At"), { target: { value: "14 pt" } });
    fireEvent.click(screen.getByRole("tab", { name: "Line and Page Breaks" }));
    fireEvent.click(within(dialog()).getByLabelText("Keep with next"));
    submit();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(attrsOf(editor)).toMatchObject({
      justification: "center",
      indent: { left: 720, hanging: 360 },
      spacing: { line: 280, lineRule: "exact" },
      keepNext: true,
    });
    editor.run(undo);
    expect(attrsOf(editor)).toMatchObject({ justification: null, indent: { left: 720 } });
  });

  it("shows blank what the paragraphs differ in, and leaves it as it is", () => {
    const editor = open(
      paragraph("one", { indent: { left: 720 }, keepNext: true }),
      paragraph("two", { indent: { left: 1440 } }),
    );
    editor.select(2, 8);
    act(() => {
      editor.run(openDialog("paragraph"));
    });
    expect((within(dialog()).getByLabelText("Left") as HTMLInputElement).value).toBe("");
    const keep = within(dialog()).getByLabelText("Keep with next") as HTMLInputElement;
    expect(keep.indeterminate).toBe(true);
    fireEvent.change(within(dialog()).getByLabelText("Right"), { target: { value: "1 cm" } });
    submit();
    expect(attrsOf(editor, 0)).toMatchObject({ indent: { left: 720, right: 567 }, keepNext: true });
    expect(attrsOf(editor, 1)).toMatchObject({
      indent: { left: 1440, right: 567 },
      keepNext: null,
    });
  });

  it("marks a wrong value and keeps the dialog open; Escape cancels", () => {
    const editor = open(paragraph("one"));
    editor.select(2);
    act(() => {
      editor.run(openDialog("paragraph"));
    });
    fireEvent.change(within(dialog()).getByLabelText("Before"), { target: { value: "lots" } });
    submit();
    expect(screen.getByRole("alert").textContent).toBe("Check this value: Before.");
    expect(within(dialog()).getByLabelText("Before").getAttribute("aria-invalid")).toBe("true");
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(attrsOf(editor).spacing).toBeNull();
  });

  it("closes without a change on OK when nothing was changed", () => {
    const editor = open(paragraph("one"));
    editor.select(2);
    act(() => {
      editor.run(openDialog("paragraph"));
    });
    submit();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      editor.state.doc.eq(createEditor({ document: documentOf(paragraph("one")) }).state.doc),
    ).toBe(true);
  });
});

describe("a comment-only toolbar", () => {
  it("opens no Paragraph dialog", () => {
    const editor = createEditor({ document: documentOf(paragraph("one")) });
    render(<FoliToolbar editor={editor} tabs={wordRibbonTabs} commentOnly />);
    editor.select(2);
    act(() => {
      editor.run(openDialog("paragraph"));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Font dialog", () => {
  const open = (...content: object[]) => {
    const editor = createEditor({ document: documentOf(...content) });
    render(<FoliToolbar editor={editor} tabs={wordRibbonTabs} />);
    return editor;
  };
  const dialog = () => screen.getByRole("dialog", { name: "Font" });
  const field = (name: string) => within(dialog()).getByLabelText(name) as HTMLInputElement;
  const submit = () => fireEvent.submit(dialog().querySelector("form") as HTMLFormElement);
  const marksOf = (editor: ReturnType<typeof open>) =>
    editor.state.doc.child(0).firstChild?.marks.map((m) => m.toJSON());

  it("opens from the Font group's launcher and sets what was changed, in one undo step", () => {
    const editor = open(paragraph("abc"));
    editor.select(1, 4);
    fireEvent.click(screen.getByRole("button", { name: "Font settings" }));
    expect(field("Size").value).toBe("11");
    expect(field("Font style").value).toBe("regular");
    fireEvent.change(field("Font style"), { target: { value: "boldItalic" } });
    fireEvent.change(field("Size"), { target: { value: "14" } });
    fireEvent.change(field("Font color"), { target: { value: "#ff0000" } });
    fireEvent.change(field("Underline style"), { target: { value: "double" } });
    fireEvent.click(field("Small caps"));
    fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
    fireEvent.change(field("Spacing"), { target: { value: "expanded" } });
    fireEvent.change(field("By"), { target: { value: "2" } });
    submit();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      marksOf(editor)
        ?.map((m) => m.type)
        .sort(),
    ).toEqual([
      "bold",
      "characterSpacing",
      "color",
      "fontSize",
      "italic",
      "smallCaps",
      "underline",
    ]);
    editor.run(undo);
    expect(marksOf(editor)).toEqual([]);
  });

  it("checks one of a pair, clears the other; mixed effects stay as they are", () => {
    const editor = open({
      type: "paragraph",
      content: [
        { type: "text", text: "ab", marks: [{ type: "caps" }] },
        {
          type: "text",
          text: "cd",
          marks: [{ type: "verticalAlign", attrs: { value: "subscript" } }],
        },
      ],
    });
    editor.select(1, 5);
    act(() => {
      editor.run(openDialog("font"));
    });
    expect(field("All caps").indeterminate).toBe(true);
    expect(field("Size").value).toBe("11");
    fireEvent.click(field("Superscript"));
    expect(field("Subscript").checked).toBe(false);
    submit();
    const runs = editor.state.doc
      .child(0)
      .content.content.map((n) => n.marks.map((m) => [m.type.name, m.attrs.value]));
    expect(runs).toEqual([
      [
        ["caps", true],
        ["verticalAlign", "superscript"],
      ],
      [["verticalAlign", "superscript"]],
    ]);
  });

  it("marks a wrong size", () => {
    open(paragraph("abc"));
    fireEvent.click(screen.getByRole("button", { name: "Font settings" }));
    fireEvent.change(field("Size"), { target: { value: "0" } });
    submit();
    expect(screen.getByRole("alert").textContent).toBe("Check this value: Size.");
  });
});

describe("Tabs dialog", () => {
  const dialog = () => screen.getByRole("dialog", { name: "Tabs" });
  const field = (name: string) => within(dialog()).getByLabelText(name) as HTMLInputElement;
  const button = (name: string) => within(dialog()).getByRole("button", { name });

  it("opens from the Paragraph dialog's Tabs…, sets and clears stops, in one undo step", () => {
    const editor = createEditor({
      document: documentOf(paragraph("one", { tabs: [{ position: 1440, kind: "left" }] })),
    });
    render(<FoliToolbar editor={editor} tabs={wordRibbonTabs} />);
    editor.select(2);
    act(() => {
      editor.run(openDialog("paragraph"));
    });
    fireEvent.click(screen.getByRole("button", { name: "Tabs…" }));
    expect(screen.queryByRole("dialog", { name: "Paragraph" })).toBeNull();
    const stops = field("Stops") as unknown as HTMLSelectElement;
    expect([...stops.options].map((o) => o.text)).toEqual(['1"']);
    fireEvent.change(stops, { target: { value: "1440" } });
    fireEvent.click(button("Clear"));
    expect(within(dialog()).getByText('Tab stops to be cleared: 1"')).toBeTruthy();
    fireEvent.change(field("Tab stop position"), { target: { value: "2.5" } });
    fireEvent.click(field("Right"));
    fireEvent.click(field("Dots"));
    fireEvent.click(button("Set"));
    fireEvent.change(field("Tab stop position"), { target: { value: "3" } });
    fireEvent.submit(dialog().querySelector("form") as HTMLFormElement);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(editor.state.doc.child(0).attrs.tabs).toEqual([
      { position: 3600, kind: "right", leader: "dot" },
      { position: 4320, kind: "right", leader: "dot" },
    ]);
    editor.run(undo);
    expect(editor.state.doc.child(0).attrs.tabs).toEqual([{ position: 1440, kind: "left" }]);
  });

  it("marks a wrong position; Clear All clears every stop", () => {
    const editor = createEditor({
      document: documentOf(paragraph("one", { tabs: [{ position: 720, kind: "center" }] })),
    });
    render(<FoliToolbar editor={editor} tabs={wordRibbonTabs} />);
    editor.select(2);
    act(() => {
      editor.run(openDialog("tabs"));
    });
    fireEvent.change(field("Tab stop position"), { target: { value: "far" } });
    fireEvent.click(button("Set"));
    expect(screen.getByRole("alert").textContent).toBe("Check this value: Tab stop position.");
    fireEvent.change(field("Tab stop position"), { target: { value: "" } });
    fireEvent.click(button("Clear All"));
    fireEvent.submit(dialog().querySelector("form") as HTMLFormElement);
    expect(editor.state.doc.child(0).attrs.tabs).toBeNull();
  });
});
