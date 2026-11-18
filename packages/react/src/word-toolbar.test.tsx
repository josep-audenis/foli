// @vitest-environment jsdom
import {
  createEditor,
  type FoliDocument,
  fieldCodesShown,
  fieldsIn,
  insertTable,
  NodeSelection,
  type OpenStory,
  trackState,
} from "@folijs/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { FoliCanvas, FoliToolbar } from "./index.js";

const document3: FoliDocument = {
  schemaVersion: 5,
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

  it("opens a header from its menu, then sends its commands to the header", () => {
    const editor = createEditor({
      document: {
        ...document3,
        section: { headers: { default: "h" } },
        stories: {
          h: {
            kind: "header",
            content: {
              type: "doc",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Head" }] }],
            },
          },
        },
      },
    });
    let open: OpenStory | null = null;
    editor.storyView = {
      get open() {
        return open;
      },
      edit(side) {
        open = { id: "h", side, variant: "default", section: 0 };
        editor.storyChanged();
        return true;
      },
      close() {
        open = null;
        editor.storyChanged();
      },
      fieldLayout: null,
      updateFields: () => ({ updated: 0, unchanged: 0, rebuilt: 0, skipped: [] }),
    };
    render(<FoliToolbar editor={editor} />);
    const menu = screen.getByRole("button", { name: "Header" });
    fireEvent.click(menu);
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "Link to previous" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit header" }));
    expect(open).not.toBeNull();

    act(() => {
      editor.story("h")?.select(1, 5);
    });
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(JSON.stringify(editor.getDocument().stories?.h?.content)).toContain("bold");
    expect(JSON.stringify(editor.getDocument().content)).not.toContain("bold");

    fireEvent.click(menu);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Different first page" }));
    expect(editor.getDocument().section.titlePage).toBe(true);
    fireEvent.click(menu);
    fireEvent.click(screen.getByRole("menuitem", { name: "Close header and footer" }));
    expect(open).toBeNull();
  });

  it("shows Word's controls: style, font, size, line spacing; no headings or rule", () => {
    setup();
    expect(screen.getAllByRole("combobox").map((s) => s.getAttribute("aria-label"))).toEqual([
      "Paragraph style",
      "Font",
      "Font size",
      "Line spacing",
      "Show changes as",
      "Table style",
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

describe("FoliToolbar's page setup dialog, with set column widths", () => {
  afterEach(cleanup);
  const columns = {
    count: 2,
    space: 708,
    equalWidth: false,
    widths: [{ width: 3000, space: 300 }, { width: 5000 }],
  };
  const open = () => {
    const editor = createEditor({
      document: { ...document3, section: { ...document3.section, columns } },
    });
    render(<FoliToolbar editor={editor} />);
    act(() => editor.select(1));
    fireEvent.click(screen.getByRole("button", { name: "Section" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Page setup…" }));
    const dialog = screen.getByRole("dialog", { name: "Page setup" });
    const apply = () => fireEvent.submit(dialog.querySelector("form") as HTMLFormElement);
    return { editor, apply };
  };

  it("adds the line and keeps every width and space", () => {
    const { editor, apply } = open();
    fireEvent.click(screen.getByLabelText("Line between columns"));
    apply();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(editor.getDocument().section.columns).toEqual({ ...columns, separator: true });
  });

  it("says so when the number of columns differs from the widths", () => {
    const { editor, apply } = open();
    fireEvent.change(screen.getByLabelText("Columns"), { target: { value: "3" } });
    apply();
    expect(screen.getByRole("alert").textContent).toContain("differs from the set widths");
    expect(screen.getByLabelText("Columns").getAttribute("aria-invalid")).toBe("true");
    expect(editor.getDocument().section.columns).toEqual(columns);
  });

  it("makes the columns equal when the widths are cleared", () => {
    const { editor, apply } = open();
    fireEvent.change(screen.getByLabelText(/Set column widths/), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Columns"), { target: { value: "3" } });
    apply();
    expect(editor.getDocument().section.columns).toEqual({ count: 3, space: 708 });
  });
});

describe("FoliToolbar's table menu", () => {
  afterEach(cleanup);
  const tableIn = (editor: ReturnType<typeof setup>) =>
    (editor.getDocument().content.content ?? []).find((b) => b.type === "table");
  const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "Table" }));
  const item = (name: string) => screen.getByRole("menuitem", { name });

  it("inserts a table of the size asked for, through a dialog", () => {
    const editor = setup();
    act(() => editor.select(6));
    openMenu();
    // Outside a table, only inserting applies.
    expect(item("Insert row below").getAttribute("aria-disabled")).toBe("true");
    expect(item("Insert table…").getAttribute("aria-disabled")).toBe(null);
    fireEvent.click(item("Insert table…"));
    const dialog = screen.getByRole("dialog", { name: "Insert table" });
    fireEvent.change(screen.getByLabelText("Rows"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Columns"), { target: { value: "70" } });
    fireEvent.submit(dialog.querySelector("form") as HTMLFormElement);
    // 70 columns is past Word's limit: refused, said.
    expect(screen.getByRole("alert").textContent).toContain("from 1 to 63");
    // Only the field that is wrong is marked, and it has the focus.
    expect(screen.getByLabelText("Columns").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Rows").getAttribute("aria-invalid")).toBe(null);
    expect(document.activeElement).toBe(screen.getByLabelText("Columns"));
    fireEvent.change(screen.getByLabelText("Columns"), { target: { value: "2" } });
    fireEvent.submit(dialog.querySelector("form") as HTMLFormElement);
    expect(screen.queryByRole("dialog")).toBe(null);
    const table = tableIn(editor);
    expect(table?.content).toHaveLength(3);
    expect(table?.content?.[0]?.content).toHaveLength(2);
  });

  it("runs row and header commands in a table; shows the header row as checked", () => {
    const editor = setup();
    act(() => {
      editor.select(6);
      editor.run(insertTable(2, 2));
    });
    openMenu();
    fireEvent.click(item("Insert row below"));
    expect(tableIn(editor)?.content).toHaveLength(3);
    openMenu();
    const header = screen.getByRole("menuitemcheckbox", { name: "Repeat as header row" });
    expect(header.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(header);
    openMenu();
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "Repeat as header row" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("is keyboard-usable: ArrowDown opens it, arrows move, Escape closes back to its button", () => {
    setup();
    const button = screen.getByRole("button", { name: "Table" });
    fireEvent.keyDown(button, { key: "ArrowDown" });
    expect(screen.getByRole("menu", { name: "Table" })).toBeTruthy();
    expect(document.activeElement).toBe(item("Insert table…"));
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(document.activeElement).toBe(item("Insert row above"));
    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    expect(document.activeElement?.textContent).toBe("Repeat as header row");
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBe(null);
    expect(document.activeElement).toBe(button);
  });

  it("sets the table style and the cells' shading", () => {
    const editor = setup();
    act(() => {
      editor.select(6);
      editor.run(insertTable(1, 2));
    });
    expect(select("Table style").value).toBe("Table Grid");
    fireEvent.click(screen.getByRole("button", { name: "Shading" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Light blue" }));
    const cell = tableIn(editor)?.content?.[0]?.content?.[0];
    expect(cell?.attrs?.shading).toMatchObject({ fill: "DEEAF6" });
  });

  it("picks another table style from the box", () => {
    const editor = createEditor({
      document: {
        ...document3,
        styles: [...document3.styles, { id: "LightList", type: "table", name: "Light List" }],
      },
    });
    render(<FoliToolbar editor={editor} />);
    act(() => {
      editor.select(6);
      editor.run(insertTable(1, 2));
    });
    fireEvent.change(select("Table style"), { target: { value: "Light List" } });
    expect(tableIn(editor)?.attrs?.style).toBe("LightList");
    expect(select("Table style").value).toBe("Light List");
  });

  it("disables the style box and shading while tracking, and closes the dialog on a change", () => {
    const editor = setup();
    act(() => {
      editor.select(6);
      editor.run(insertTable(1, 2));
      editor.commands.setTrackChanges(true, "Me");
    });
    expect(select("Table style").getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("button", { name: "Shading" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
    act(() => editor.commands.setTrackChanges(false));
    openMenu();
    fireEvent.click(item("Insert table…"));
    expect(screen.getByRole("dialog", { name: "Insert table" })).toBeTruthy();
    act(() => editor.commands.insertText("x"));
    expect(screen.queryByRole("dialog")).toBe(null);
  });
});

describe("FoliToolbar's picture dialog", () => {
  afterEach(cleanup);
  const DOT = "data:image/png;base64,iVBORw0KGgo=";
  function withPicture(upload?: () => Promise<string>) {
    const editor = createEditor({
      document: {
        ...document3,
        resources: { img: { contentType: "image/png", data: DOT } },
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "a" },
                {
                  type: "picture",
                  attrs: { resource: "img", width: 9525 * 200, height: 9525 * 100, alt: "Dot" },
                },
              ],
            },
          ],
        },
      },
    });
    render(<FoliToolbar editor={editor} {...(upload ? { upload } : {})} />);
    return editor;
  }
  const button = () => screen.getByRole("button", { name: "Picture…" });

  it("inserts only with the app's upload; edits a selected picture without it", () => {
    const editor = withPicture();
    act(() => editor.select(1));
    expect(button().getAttribute("aria-disabled")).toBe("true");
    act(() =>
      editor.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 2))),
    );
    expect(button().getAttribute("aria-disabled")).toBe(null);
  });

  it("edits the alt text and the size, its proportions kept", () => {
    const editor = withPicture();
    act(() =>
      editor.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 2))),
    );
    fireEvent.click(button());
    const dialog = screen.getByRole("dialog", { name: "Edit picture" });
    expect((screen.getByLabelText("Alt text") as HTMLInputElement).value).toBe("Dot");
    fireEvent.change(screen.getByLabelText("Alt text"), { target: { value: "A dot" } });
    fireEvent.change(screen.getByLabelText("Width (px)"), { target: { value: "100" } });
    expect((screen.getByLabelText("Height (px)") as HTMLInputElement).value).toBe("50");
    fireEvent.submit(dialog.querySelector("form") as HTMLFormElement);
    expect(screen.queryByRole("dialog")).toBe(null);
    expect(editor.state.doc.nodeAt(2)?.attrs).toMatchObject({
      alt: "A dot",
      width: 9525 * 100,
      height: 9525 * 50,
    });
  });

  it("asks for alt text unless the picture is decorative", () => {
    const editor = withPicture();
    act(() =>
      editor.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 2))),
    );
    fireEvent.click(button());
    fireEvent.change(screen.getByLabelText("Alt text"), { target: { value: " " } });
    fireEvent.submit(screen.getByRole("dialog").querySelector("form") as HTMLFormElement);
    expect(screen.getByRole("alert").textContent).toContain("Describe the picture");
    expect(screen.getByLabelText("Alt text").getAttribute("aria-invalid")).toBe("true");
    fireEvent.click(screen.getByLabelText("Decorative (no alt text)"));
    fireEvent.submit(screen.getByRole("dialog").querySelector("form") as HTMLFormElement);
    expect(editor.state.doc.nodeAt(2)?.attrs).toMatchObject({ alt: null, decorative: true });
  });
});

describe("FoliToolbar's picture dialog: review findings", () => {
  afterEach(cleanup);
  const docWith = (
    resources: Record<string, unknown>,
    url = "data:image/png;base64,iVBORw0KGgo=",
  ) =>
    createEditor({
      document: {
        ...document3,
        resources: {
          img: { contentType: "image/png", ...(url.startsWith("data:") ? { data: url } : { url }) },
          ...resources,
        },
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "a" },
                {
                  type: "picture",
                  attrs: { resource: "img", width: 9525 * 200, height: 9525 * 100, alt: "Dot" },
                },
              ],
            },
          ],
        },
      },
    });

  it("reports a file it cannot insert, under StrictMode too, the focus on the file field", async () => {
    const editor = docWith({});
    const upload = vi.fn(async () => "https://x.test/a.png");
    // jsdom never loads an image: no object URLs, so the file cannot be read.
    const createObjectURL = URL.createObjectURL;
    Object.defineProperty(URL, "createObjectURL", { value: undefined, configurable: true });
    onTestFinished(() => {
      Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
    });
    render(
      <StrictMode>
        <FoliToolbar editor={editor} upload={upload} />
      </StrictMode>,
    );
    act(() => editor.select(1));
    fireEvent.click(screen.getByRole("button", { name: "Picture…" }));
    const input = screen.getByLabelText("Image") as HTMLInputElement;
    const file = new File([new Uint8Array([1])], "x.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText("Alt text", { exact: true }), {
      target: { value: "X" },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole("dialog").querySelector("form") as HTMLFormElement);
    });
    // jsdom cannot read the image: the failure is shown, not a dialog stuck busy.
    expect((await screen.findByRole("alert")).textContent).toContain("could not be inserted");
    expect(document.activeElement).toBe(input);
    expect(upload).not.toHaveBeenCalled();
  });

  it("refuses a size past the model's range, the focus on the width", () => {
    const editor = docWith({});
    render(<FoliToolbar editor={editor} />);
    act(() =>
      editor.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 2))),
    );
    fireEvent.click(screen.getByRole("button", { name: "Picture…" }));
    fireEvent.change(screen.getByLabelText("Width (px)"), { target: { value: "300000" } });
    fireEvent.submit(screen.getByRole("dialog").querySelector("form") as HTMLFormElement);
    expect(screen.getByRole("alert").textContent).toContain("from 1 to");
    expect(document.activeElement).toBe(screen.getByLabelText("Width (px)"));
    expect(editor.state.doc.nodeAt(2)?.attrs.width).toBe(9525 * 200);
  });

  it("closes when another document is set", () => {
    const editor = docWith({});
    render(<FoliToolbar editor={editor} />);
    act(() =>
      editor.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 2))),
    );
    fireEvent.click(screen.getByRole("button", { name: "Picture…" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    act(() => editor.setDocument(document3));
    expect(screen.queryByRole("dialog")).toBe(null);
  });
});

describe("FoliCanvas's pictures", () => {
  afterEach(cleanup);

  it("fetches no web image before the app's resolver, and redraws none on other prop changes", () => {
    const fetched: string[] = [];
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      configurable: true,
      set(value: string) {
        fetched.push(value);
        descriptor?.set?.call(this, value);
      },
      get() {
        return descriptor?.get?.call(this);
      },
    });
    try {
      const editor = createEditor({
        document: {
          ...document3,
          resources: { img: { contentType: "image/png", url: "https://tracker.test/a.png" } },
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "picture",
                    attrs: { resource: "img", width: 9525, height: 9525, alt: "x" },
                  },
                ],
              },
            ],
          },
        },
      });
      const refuse = () => null;
      const { rerender, container } = render(<FoliCanvas editor={editor} resource={refuse} />);
      expect(fetched).toEqual([]);
      const box = container.querySelector("[data-foli-picture]");
      rerender(<FoliCanvas editor={editor} resource={refuse} placeholder="Type" />);
      expect(container.querySelector("[data-foli-picture]")).toBe(box);
      // Without a resolver at all (the default), other props redraw nothing either.
      const other = createEditor({ document: editor.getDocument() });
      const plain = render(<FoliCanvas editor={other} />);
      const first = plain.container.querySelector("[data-foli-picture]");
      expect(first).not.toBe(null);
      plain.rerender(<FoliCanvas editor={other} placeholder="Type" />);
      expect(plain.container.querySelector("[data-foli-picture]")).toBe(first);
    } finally {
      if (descriptor) Object.defineProperty(HTMLImageElement.prototype, "src", descriptor);
    }
  });

  describe("the fields menu", () => {
    const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "Fields" }));
    const pick = (name: string) => {
      openMenu();
      fireEvent.click(screen.getByRole("menuitem", { name }));
    };

    it("inserts a page number and the date at the selection, each one undo step", () => {
      const editor = setup();
      act(() => editor.select(6));
      pick("Page number");
      pick("Date");
      expect(fieldsIn(editor.state.doc).map((f) => f.name)).toEqual(["PAGE", "DATE"]);
      act(() => {
        editor.commands.undo();
      });
      expect(fieldsIn(editor.state.doc).map((f) => f.name)).toEqual(["PAGE"]);
    });

    it("inserts a table of contents and updates fields through the view when there is one", () => {
      const editor = createEditor({
        document: {
          ...document3,
          content: {
            type: "doc",
            content: [
              { type: "paragraph" },
              {
                type: "paragraph",
                attrs: { style: "Heading1" },
                content: [{ type: "text", text: "Title" }],
              },
            ],
          },
        },
      });
      const updates = vi.fn(() => ({ updated: 0, unchanged: 0, rebuilt: 0, skipped: [] }));
      editor.storyView = {
        open: null,
        edit: () => false,
        close: () => {},
        fieldLayout: { pages: 7, pageAt: () => ({ number: 7, sectionPages: 7 }) },
        updateFields: updates,
      };
      render(<FoliToolbar editor={editor} />);
      act(() => editor.select(1));
      pick("Table of contents");
      const [contents, page] = fieldsIn(editor.state.doc);
      expect(contents?.result).toBe("Title\t7");
      expect(page?.name).toBe("PAGEREF");
      // The page numbers again, once the table has moved the headings.
      expect(updates).toHaveBeenCalledTimes(1);
      pick("Update all fields");
      expect(updates).toHaveBeenCalledTimes(2);
      expect(updates.mock.calls[1]).toEqual([{}, editor]);
    });

    it("shows the codes as a checked item; without a heading or bookmark, no reference", () => {
      const editor = setup();
      openMenu();
      expect(
        screen.getByRole("menuitem", { name: "Cross-reference…" }).getAttribute("aria-disabled"),
      ).toBe("true");
      const item = screen.getByRole("menuitemcheckbox", { name: "Show field codes" });
      expect(item.getAttribute("aria-checked")).toBe("false");
      fireEvent.click(item);
      expect(fieldCodesShown(editor.state)).toBe(true);
      openMenu();
      expect(
        screen
          .getByRole("menuitemcheckbox", { name: "Show field codes" })
          .getAttribute("aria-checked"),
      ).toBe("true");
    });

    it("inserts a cross-reference from its dialog; Escape leaves it", () => {
      const editor = createEditor({
        document: {
          ...document3,
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                attrs: { style: "Heading1" },
                content: [{ type: "text", text: "Title" }],
              },
              { type: "paragraph" },
            ],
          },
        },
      });
      render(<FoliToolbar editor={editor} />);
      act(() => editor.select(8));
      pick("Cross-reference…");
      const dialog = screen.getByRole("dialog", { name: "Insert cross-reference" });
      expect(document.activeElement).toBe(screen.getByLabelText("Refer to"));
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      // Tab stays in the dialog, round from its first control to its last.
      fireEvent.keyDown(screen.getByLabelText("Refer to"), { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
      fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Tab" });
      expect(document.activeElement).toBe(screen.getByLabelText("Refer to"));
      fireEvent.keyDown(dialog, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      pick("Cross-reference…");
      fireEvent.change(screen.getByLabelText("Show"), { target: { value: "number" } });
      fireEvent.click(screen.getByLabelText("Link to it"));
      fireEvent.click(screen.getByRole("button", { name: "Insert" }));
      expect(fieldsIn(editor.state.doc)[0]?.instruction).toMatch(/^REF _Ref\d+ \\r$/);
    });
  });
});
