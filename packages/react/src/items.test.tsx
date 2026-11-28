// @vitest-environment jsdom
import {
  type Command,
  createDocument,
  createEditor,
  deleteSelection,
  type Editor,
  type FoliDocument,
  insertText,
  type OpenStory,
  openLinkEditor,
  Plugin,
  PluginKey,
  TextSelection,
  undo,
} from "@folijs/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultToolbarItems,
  defaultToolbarTabs,
  FoliEditor,
  FoliEditorProvider,
  FoliToolbar,
  type FoliToolbarProps,
  type ToolbarColorMenu,
  type ToolbarCustom,
  type ToolbarDialog,
  type ToolbarDialogName,
  type ToolbarItem,
  type ToolbarItemName,
  type ToolbarSelect,
  type ToolbarTab,
  toolbarItems,
  useCommand,
  useEditorState,
  useFoliEditor,
} from "./index.js";

declare module "@folijs/core" {
  interface FoliCommands {
    /** The test plugin's command: inserts `text` at a caret only. */
    shout(text: string): boolean;
  }
}

const shout =
  (text: string): Command =>
  (state, dispatch) => {
    if (!state.selection.empty) return false;
    return insertText(text.toUpperCase())(state, dispatch);
  };
const shouting = new Plugin({ key: new PluginKey("shout"), commands: { shout } });

const doc = () =>
  createDocument({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
  });
const text = (editor: ReturnType<typeof createEditor>) => editor.state.doc.textContent;
const selectAll = (editor: ReturnType<typeof createEditor>) =>
  act(() =>
    editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6))),
  );

/** Every built-in name, checked both ways by the compiler (`satisfies`) and the test. */
const NAMES = {
  style: 1,
  font: 1,
  size: 1,
  bold: 1,
  italic: 1,
  underline: 1,
  strike: 1,
  link: 1,
  textColor: 1,
  highlight: 1,
  alignStart: 1,
  alignCenter: 1,
  alignEnd: 1,
  alignJustify: 1,
  lineSpacing: 1,
  bulletList: 1,
  orderedList: 1,
  outdent: 1,
  indent: 1,
  newComment: 1,
  trackChanges: 1,
  reviewView: 1,
  previousChange: 1,
  nextChange: 1,
  acceptChange: 1,
  rejectChange: 1,
  acceptAll: 1,
  rejectAll: 1,
  undo: 1,
  redo: 1,
  table: 1,
  tableStyle: 1,
  cellShading: 1,
  picture: 1,
  pageBreak: 1,
  horizontalRule: 1,
  section: 1,
  headerFooter: 1,
  fields: 1,
  navigate: 1,
  notes: 1,
  controls: 1,
  rowAbove: 1,
  rowBelow: 1,
  columnLeft: 1,
  columnRight: 1,
  deleteRows: 1,
  deleteColumns: 1,
  deleteTable: 1,
  mergeCells: 1,
  splitCell: 1,
  columnWidth: 1,
  headerRow: 1,
  pageSetup: 1,
  controlProperties: 1,
  textBox: 1,
  shapes: 1,
  shapeStyles: 1,
  shapeFill: 1,
  shapeOutline: 1,
  outlineWeight: 1,
  outlineDashes: 1,
  outlineArrows: 1,
  footnote: 1,
  endnote: 1,
  goToNote: 1,
  noteOptions: 1,
  tableOfContents: 1,
  updateFields: 1,
  pageNumber: 1,
  date: 1,
  crossReference: 1,
  fieldCodes: 1,
  navigationPane: 1,
  crop: 1,
  objectHeight: 1,
  objectWidth: 1,
  bringForward: 1,
  sendBackward: 1,
  alignObject: 1,
  objectSize: 1,
  wrapText: 1,
  layoutOptions: 1,
  position: 1,
  rotateLeft: 1,
  rotateRight: 1,
  superscript: 1,
  subscript: 1,
  growFont: 1,
  shrinkFont: 1,
  clearFormatting: 1,
  changeCase: 1,
  underlineStyle: 1,
  formatPainter: 1,
  formattingMarks: 1,
  ruler: 1,
  styleGallery: 1,
  paragraphSettings: 1,
  fontSettings: 1,
  margins: 1,
  orientation: 1,
  pageSize: 1,
  columns: 1,
  breaks: 1,
  indentLeft: 1,
  indentRight: 1,
  spaceBefore: 1,
  spaceAfter: 1,
  pageColor: 1,
  pageBorders: 1,
  watermark: 1,
  shading: 1,
  borders: 1,
  lineNumbers: 1,
  symbol: 1,
  dateTime: 1,
  caption: 1,
  tableOfFigures: 1,
} satisfies Record<ToolbarItemName, 1>;

/** Deletes the selection: a dry run says no at a caret. */
const clear: ToolbarItem = {
  key: "clear",
  label: "Delete the selection",
  text: "Clear",
  command: deleteSelection,
  pressed: (state) => !state.selection.empty,
};

describe("toolbar items", () => {
  afterEach(cleanup);

  it("exports every built-in item by name, the default toolbar made of them", () => {
    expect(Object.keys(toolbarItems).sort()).toEqual(Object.keys(NAMES).sort());
    // The ribbon's own items (menus' entries as buttons) come after the default toolbar's.
    const defaults = defaultToolbarItems.flat();
    expect(Object.values(toolbarItems).slice(0, defaults.length)).toEqual(defaults);
    expect(toolbarItems.alignStart.key).toBe("align-start");
  });

  it("shows the items given, in their groups, with one tab stop and arrow keys", () => {
    const editor = createEditor({ document: doc() });
    const { container } = render(
      <FoliToolbar
        editor={editor}
        items={[[toolbarItems.undo, toolbarItems.bold], [], [clear, toolbarItems.newComment]]}
      />,
    );
    const buttons = screen.getAllByRole("button");
    // "New comment" needs `comments`; the empty group leaves no separator.
    expect(buttons.map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual([
      "Undo",
      "Bold",
      "Clear",
    ]);
    expect(container.querySelectorAll("hr")).toHaveLength(1);
    expect(buttons.map((b) => b.tabIndex)).toEqual([0, -1, -1]);
    fireEvent.keyDown(buttons[0] as HTMLElement, { key: "End" });
    expect(document.activeElement).toBe(buttons[2]);
    expect(buttons.map((b) => b.tabIndex)).toEqual([-1, -1, 0]);
    fireEvent.keyDown(buttons[2] as HTMLElement, { key: "ArrowRight" });
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("enables a custom item by its command's dry run and runs it, keeping the selection's focus", () => {
    const editor = createEditor({ document: doc() });
    const onClickCommand = vi.fn();
    render(<FoliToolbar editor={editor} items={[[clear]]} onClickCommand={onClickCommand} />);
    const button = screen.getByRole("button", { name: "Clear" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.title).toBe("Delete the selection");
    fireEvent.click(button);
    expect(text(editor)).toBe("Hello");

    selectAll(editor);
    expect(button.getAttribute("aria-disabled")).toBeNull();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    // Pressing the mouse does not take the focus from the document.
    expect(fireEvent.mouseDown(button)).toBe(false);
    fireEvent.click(button, { detail: 1 });
    expect(text(editor)).toBe("");
    expect(onClickCommand).toHaveBeenCalledOnce();
    expect(button.getAttribute("aria-disabled")).toBe("true");
  });

  it("names an icon item by its label; `enabled` replaces the dry run", () => {
    const editor = createEditor({ document: doc() });
    const star: ToolbarItem = {
      key: "star",
      label: "Insert a star",
      icon: "★",
      command: insertText("★"),
      enabled: () => false,
    };
    render(<FoliToolbar editor={editor} items={[[star]]} />);
    const button = screen.getByRole("button", { name: "Insert a star" });
    expect(button.textContent).toBe("★");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("aria-pressed")).toBeNull();
  });

  it("opens a custom menu and adds an entry to a built-in one", () => {
    const editor = createEditor({ document: doc() });
    const greet = { key: "greet", label: "Insert a greeting", command: insertText("Hi ") };
    const fields = toolbarItems.fields;
    const builtIn = fields.actions;
    const items: ToolbarItem[] = [
      {
        key: "insert",
        label: "Insert",
        actions: [greet, { ...greet, key: "wipe", label: "Wipe", command: deleteSelection }],
      },
      {
        ...fields,
        actions: (body) => [
          ...(typeof builtIn === "function" ? builtIn(body) : (builtIn ?? [])),
          greet,
        ],
      },
    ];
    render(<FoliToolbar editor={editor} items={[items]} />);
    const insert = screen.getByRole("button", { name: "Insert" });
    expect(insert.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.keyDown(insert, { key: "ArrowDown" });
    const entries = screen.getAllByRole("menuitem");
    expect(entries.map((e) => e.getAttribute("aria-disabled"))).toEqual([null, "true"]);
    expect(document.activeElement).toBe(entries[0]);
    fireEvent.click(entries[0] as HTMLElement);
    expect(text(editor)).toBe("Hi Hello");
    // Keyboard activation (no pointer) gives the focus back to the menu's button.
    expect(document.activeElement).toBe(insert);

    fireEvent.click(screen.getByRole("button", { name: "Fields" }));
    const names = [...document.querySelectorAll('[role^="menuitem"]')].map((e) => e.textContent);
    expect(names[0]).toBe("Page number");
    expect(names.at(-1)).toBe("Insert a greeting");
  });

  it("disables a menu without entries and never opens it", () => {
    const editor = createEditor({ document: doc() });
    render(
      <FoliToolbar
        editor={editor}
        items={[[{ key: "empty", label: "Empty", actions: [], enabled: () => true }]]}
      />,
    );
    const button = screen.getByRole("button", { name: "Empty" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "ArrowDown" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows an app's box: its options, the value at the selection, a pick runs its command", () => {
    const editor = createEditor({ document: doc() });
    const word: ToolbarSelect = {
      key: "word",
      label: "Word",
      select: {
        options: () => ["Hello", "Bye"].map((value) => ({ value, label: `Say ${value}` })),
        value: (state) => state.doc.textContent || null,
        pick: (value) => (state, dispatch) => {
          dispatch?.(state.tr.insertText(value, 1, state.doc.content.size - 1));
          return true;
        },
      },
    };
    render(<FoliToolbar editor={editor} items={[[word, toolbarItems.undo]]} />);
    const box = screen.getByRole("combobox", { name: "Word" }) as HTMLSelectElement;
    expect(box.className).toContain("foli-toolbar-word");
    expect(box.value).toBe("Hello");
    expect([...box.options].map((o) => o.textContent)).toEqual(["Say Hello", "Say Bye"]);
    // One tab stop with the buttons.
    expect(box.tabIndex).toBe(0);
    expect(screen.getByRole("button", { name: "Undo" }).tabIndex).toBe(-1);
    fireEvent.change(box, { target: { value: "Bye" } });
    expect(text(editor)).toBe("Bye");
    expect(box.value).toBe("Bye");
    // A value that is not offered shows itself.
    act(() => editor.run(insertText("!")));
    expect(box.value).toBe("!Bye");
  });

  it("shows an app's color menu, and a built-in one with another palette", () => {
    const editor = createEditor({ document: doc() });
    const picked: (string | null)[] = [];
    const palette = [
      { name: "None", color: null },
      { name: "Brand", color: "#123456" },
    ];
    const mood: ToolbarColorMenu = {
      key: "mood",
      label: "Mood",
      colors: {
        options: palette,
        value: () => picked.at(-1) ?? null,
        pick: (color) => (state, dispatch) => {
          if (dispatch) {
            picked.push(color);
            dispatch(state.tr);
          }
          return true;
        },
      },
    };
    const textColor: ToolbarColorMenu = {
      ...toolbarItems.textColor,
      colors: { ...toolbarItems.textColor.colors, options: palette },
    };
    render(<FoliToolbar editor={editor} items={[[mood, textColor]]} />);
    const button = screen.getByRole("button", { name: "Mood" });
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(button, { detail: 0 });
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((item) => item.getAttribute("aria-label") ?? item.textContent)).toEqual([
      "None",
      "Brand",
    ]);
    fireEvent.click(items[1] as HTMLElement, { detail: 0 });
    expect(picked).toEqual(["#123456"]);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
    const swatch = button.querySelector(".foli-toolbar-swatch") as HTMLElement;
    expect(swatch.style.background).toBe("rgb(18, 52, 86)");

    selectAll(editor);
    fireEvent.click(screen.getByRole("button", { name: "Text color" }), { detail: 0 });
    expect(
      screen
        .getAllByRole("menuitemradio")
        .map((item) => item.getAttribute("aria-label") ?? item.textContent),
    ).toEqual(["None", "Brand"]);
    // The copy still does what the built-in does.
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Brand" }), { detail: 0 });
    expect(JSON.stringify(editor.state.doc.toJSON())).toContain("123456");
  });

  it("offers any color through the browser's color field, with `custom`", () => {
    const editor = createEditor({ document: doc() });
    const onClickCommand = vi.fn();
    const textColor: ToolbarColorMenu = {
      ...toolbarItems.textColor,
      colors: { ...toolbarItems.textColor.colors, custom: true },
    };
    const { container } = render(
      <FoliToolbar
        editor={editor}
        items={[[textColor, toolbarItems.highlight]]}
        onClickCommand={onClickCommand}
      />,
    );
    selectAll(editor);
    // Only the menu that asks for it has the entry and the field.
    const fields = container.querySelectorAll<HTMLInputElement>('input[type="color"]');
    expect(fields).toHaveLength(1);
    const field = fields[0] as HTMLInputElement;
    expect(field.getAttribute("aria-hidden")).toBe("true");
    expect(field.tabIndex).toBe(-1);
    const opened = vi.spyOn(field, "click");
    const button = screen.getByRole("button", { name: "Text color" });
    act(() => button.focus());
    fireEvent.click(button, { detail: 0 });
    // The last entry, after the palette: End reaches it, ArrowDown wraps from it.
    const more = screen.getByRole("menuitem", { name: "More colors…" });
    const radios = screen.getAllByRole("menuitemradio");
    fireEvent.keyDown(radios[0] as HTMLElement, { key: "End" });
    expect(document.activeElement).toBe(more);
    fireEvent.keyDown(more, { key: "ArrowDown" });
    expect(document.activeElement).toBe(radios[0]);
    // It closes the menu and opens the field; by keyboard the focus is back on the button.
    fireEvent.click(more, { detail: 0 });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(opened).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(button);
    // Nothing is applied while the user is choosing (`input`), only the color chosen (`change`).
    field.value = "#12ab56";
    fireEvent.input(field);
    expect(JSON.stringify(editor.state.doc.toJSON())).not.toContain("12AB56");
    act(() => void field.dispatchEvent(new Event("change", { bubbles: true })));
    expect(JSON.stringify(editor.state.doc.toJSON())).toContain("12AB56");
    expect(onClickCommand).not.toHaveBeenCalled();
    // Opened with the pointer: the focus goes to the document after the pick.
    field.value = "#ffffff";
    fireEvent.click(button, { detail: 1 });
    fireEvent.click(screen.getByRole("menuitem", { name: "More colors…" }), { detail: 1 });
    // It opens on the color at the selection; its button has the focus meanwhile.
    expect(field.value).toBe("#12ab56");
    expect(document.activeElement).toBe(button);
    // A click in the document that closes the field moves the selection first: the color
    // still goes to the selection the field opened on.
    act(() => editor.select(1, 1));
    field.value = "#000001";
    act(() => void field.dispatchEvent(new Event("change", { bubbles: true })));
    expect(onClickCommand).toHaveBeenCalledOnce();
    expect(JSON.stringify(editor.state.doc.toJSON())).not.toContain("12AB56");
    expect(editor.state.selection.empty).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Highlight" }), { detail: 0 });
    expect(screen.queryByRole("menuitem", { name: "More colors…" })).toBeNull();
  });

  it("keeps a box that is not enabled focusable, and does not run its pick", () => {
    const editor = createEditor({ document: doc() });
    const pick = vi.fn(() => () => true);
    const off: ToolbarSelect = {
      key: "off",
      label: "Off",
      enabled: () => false,
      select: { options: () => [{ value: "a", label: "A" }], value: () => null, pick },
    };
    render(<FoliToolbar editor={editor} items={[[off]]} />);
    const box = screen.getByRole("combobox", { name: "Off" }) as HTMLSelectElement;
    expect(box.getAttribute("aria-disabled")).toBe("true");
    // Nothing to show: a blank entry.
    expect(box.value).toBe("");
    fireEvent.change(box, { target: { value: "a" } });
    expect(pick).not.toHaveBeenCalled();
  });

  it("opens the toolbar's own dialogs from an app's buttons, by name", () => {
    const editor = createEditor({ document: doc() });
    const named = (dialog: ToolbarDialogName, label: string): ToolbarDialog => ({
      key: `my-${dialog}`,
      label,
      dialog,
    });
    const view = (upload?: FoliToolbarProps["upload"]) => (
      <FoliToolbar
        editor={editor}
        upload={upload}
        items={[
          [
            named("insertTable", "My table"),
            named("link", "My link"),
            named("pageSetup", "My page"),
            named("noteOptions", "My notes"),
            named("crossReference", "My reference"),
            named("controlProperties", "My control"),
            named("picture", "My picture"),
            { ...named("pageSetup", "Never"), key: "never", enabled: () => false },
          ],
        ]}
      />
    );
    const { rerender } = render(view());
    const button = (name: string) => screen.getByRole("button", { name });
    const open = () => screen.getAllByRole("dialog").map((d) => d.getAttribute("aria-label"));
    expect(button("My table").getAttribute("aria-haspopup")).toBe("dialog");
    // Where a dialog does not apply its button says so: no control at the caret, no `upload`
    // to insert a picture with, and the app's own `enabled`.
    expect(button("My control").getAttribute("aria-disabled")).toBe("true");
    expect(button("My picture").getAttribute("aria-disabled")).toBe("true");
    expect(button("Never").getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button("My control"), { detail: 0 });
    fireEvent.click(button("Never"), { detail: 0 });
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => button("My table").focus());
    fireEvent.click(button("My table"), { detail: 0 });
    expect(open()).toEqual(["Insert table"]);
    // Escape gives the focus back to the app's button.
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button("My table"));

    // One at a time: each takes the last one's place.
    fireEvent.click(button("My page"), { detail: 0 });
    expect(open()).toEqual(["Page setup"]);
    fireEvent.click(button("My notes"), { detail: 0 });
    expect(open()).toEqual(["Note options"]);
    // Nothing to refer to in this document (no heading, no bookmark): no empty dialog.
    fireEvent.click(button("My reference"), { detail: 0 });
    expect(open()).toEqual(["Note options"]);
    // The link dialog takes the open one's place, and gives the focus back to the app's button.
    act(() => button("My link").focus());
    fireEvent.click(button("My link"), { detail: 0 });
    expect(open()).toEqual(["Add link"]);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(document.activeElement).toBe(button("My link"));
    // With the app's `upload`, the picture dialog inserts.
    rerender(view(async () => ({ src: "x.png" })));
    expect(button("My picture").getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(button("My picture"), { detail: 0 });
    expect(open()).toEqual(["Insert picture"]);
  });

  it("opens an app's dialog under the toolbar: focus in, Escape and close back out", () => {
    const editor = createEditor({ document: doc() });
    const onClickCommand = vi.fn();
    const late: { current: ((applied?: boolean) => void) | null } = { current: null };
    // Fewer hooks than the other dialog's, and nothing that takes the focus.
    const note: ToolbarDialog = { key: "note", label: "Note", dialog: () => <p>Read me.</p> };
    const stamp: ToolbarDialog = {
      key: "stamp",
      label: "Stamp",
      dialog: ({ editor, close }) => {
        // A component's body: hooks work.
        const [value, setValue] = useState("OK");
        late.current = close;
        return (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              close(editor.run(insertText(value)));
            }}
          >
            <input aria-label="Text" value={value} onChange={(e) => setValue(e.target.value)} />
            <button type="submit">Insert</button>
          </form>
        );
      },
    };
    const view = (disabled = false) => (
      <FoliToolbar
        editor={editor}
        items={[[stamp, note, toolbarItems.undo]]}
        onClickCommand={onClickCommand}
        disabled={disabled}
      />
    );
    const { rerender } = render(view());
    const button = screen.getByRole("button", { name: "Stamp" });
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(button.getAttribute("aria-disabled")).toBeNull();
    act(() => button.focus());
    fireEvent.click(button, { detail: 0 });
    const dialog = screen.getByRole("dialog", { name: "Stamp" });
    expect(dialog.className).toContain("foli-toolbar-stamp-dialog");
    const field = screen.getByRole("textbox", { name: "Text" });
    expect(document.activeElement).toBe(field);
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);

    // Applied: the focus goes to the document (the app's `onClickCommand`).
    fireEvent.click(button, { detail: 1 });
    fireEvent.change(screen.getByRole("textbox", { name: "Text" }), { target: { value: "Hi " } });
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(text(editor)).toBe("Hi Hello");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onClickCommand).toHaveBeenCalledOnce();

    // Another item's dialog takes its place, with its own state and the focus in it.
    fireEvent.click(button, { detail: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Note" }), { detail: 1 });
    const second = screen.getByRole("dialog");
    expect(second.getAttribute("aria-label")).toBe("Note");
    // Nothing to focus in it: the dialog itself, where Escape still closes it.
    expect(document.activeElement).toBe(second);
    // A `close` the first dialog kept does nothing now.
    act(() => late.current?.(true));
    screen.getByRole("dialog", { name: "Note" });
    fireEvent.keyDown(second, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onClickCommand).toHaveBeenCalledOnce();

    // A built-in dialog that opens takes its place.
    fireEvent.click(button, { detail: 1 });
    act(() => void editor.run(openLinkEditor));
    expect(screen.getAllByRole("dialog").map((d) => d.getAttribute("aria-label"))).toEqual([
      "Add link",
    ]);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    // A disabled toolbar closes it, and it does not come back.
    fireEvent.click(button, { detail: 1 });
    screen.getByRole("dialog");
    rerender(view(true));
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(view());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("takes an item of one kind only (types)", () => {
    // @ts-expect-error a box is not also a button
    const both: ToolbarItem = { ...toolbarItems.size, command: undo };
    expect(both.key).toBe("size");
  });

  it("renders an app's own control in the toolbar's one tab stop", () => {
    const editor = createEditor({ document: doc() });
    const count: ToolbarCustom = {
      key: "count",
      label: "Characters",
      enabled: (state) => !state.selection.empty,
      render: ({ editor, disabled, ...props }) => {
        const size = useEditorState((state) => state.doc.textContent.length, { editor });
        return (
          <input
            {...props}
            aria-label="Characters"
            aria-disabled={disabled}
            readOnly
            value={size}
          />
        );
      },
    };
    render(<FoliToolbar editor={editor} items={[[toolbarItems.undo, count]]} />);
    const undoButton = screen.getByRole("button", { name: "Undo" });
    const field = screen.getByRole("textbox", { name: "Characters" }) as HTMLInputElement;
    expect(field.value).toBe("5");
    expect(field.getAttribute("aria-disabled")).toBe("true");
    expect([undoButton.tabIndex, field.tabIndex]).toEqual([0, -1]);
    fireEvent.keyDown(undoButton, { key: "ArrowRight" });
    expect(document.activeElement).toBe(field);
    expect([undoButton.tabIndex, field.tabIndex]).toEqual([-1, 0]);
    selectAll(editor);
    expect(field.getAttribute("aria-disabled")).toBe("false");
    act(() => editor.run(insertText("Hey")));
    expect(field.value).toBe("3");
  });

  it("shows tabs over the toolbar: one tab's items at a time, arrow keys between tabs", () => {
    const editor = createEditor({ document: doc() });
    const tabs: ToolbarTab[] = [
      { key: "edit", label: "Edit", items: [[toolbarItems.undo, toolbarItems.redo]] },
      { key: "format", label: "Format", items: [[toolbarItems.bold], [clear]] },
    ];
    const { rerender } = render(<FoliToolbar editor={editor} tabs={tabs} items={[[clear]]} />);
    const names = () =>
      within(screen.getByRole("toolbar"))
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label") ?? b.textContent);
    screen.getByRole("tablist", { name: "Formatting" });
    const [edit, format] = screen.getAllByRole("tab") as [HTMLElement, HTMLElement];
    expect([edit.textContent, format.textContent]).toEqual(["Edit", "Format"]);
    expect([edit.getAttribute("aria-selected"), format.getAttribute("aria-selected")]).toEqual([
      "true",
      "false",
    ]);
    expect([edit.tabIndex, format.tabIndex]).toEqual([0, -1]);
    // The tab names its panel, which holds the toolbar; `items` gives way to the tabs.
    const tabPanel = screen.getByRole("tabpanel", { name: "Edit" });
    expect(edit.getAttribute("aria-controls")).toBe(tabPanel.id);
    expect(tabPanel.firstElementChild).toBe(screen.getByRole("toolbar", { name: "Formatting" }));
    expect(tabPanel.tabIndex).toBe(-1);
    expect(names()).toEqual(["Undo", "Redo"]);

    // Arrow keys move between tabs and show each; they wrap.
    act(() => edit.focus());
    fireEvent.keyDown(edit, { key: "ArrowRight" });
    expect(document.activeElement).toBe(format);
    expect(format.getAttribute("aria-selected")).toBe("true");
    expect(names()).toEqual(["Bold", "Clear"]);
    screen.getByRole("tabpanel", { name: "Format" });
    fireEvent.keyDown(format, { key: "ArrowRight" });
    expect(document.activeElement).toBe(edit);
    expect(names()).toEqual(["Undo", "Redo"]);
    fireEvent.keyDown(edit, { key: "End" });
    expect(names()).toEqual(["Bold", "Clear"]);

    // A click shows a tab without taking the focus from the document.
    expect(fireEvent.mouseDown(edit)).toBe(false);
    fireEvent.click(edit, { detail: 1 });
    expect(names()).toEqual(["Undo", "Redo"]);

    // The tab shown stays while it is among the tabs; without it, the first one shows.
    fireEvent.click(format, { detail: 1 });
    rerender(<FoliToolbar editor={editor} tabs={[...tabs].reverse()} />);
    expect(names()).toEqual(["Bold", "Clear"]);
    rerender(<FoliToolbar editor={editor} tabs={tabs.slice(0, 1)} />);
    expect(names()).toEqual(["Undo", "Redo"]);
    // No tabs: the items, and no tab list.
    rerender(<FoliToolbar editor={editor} tabs={[]} items={[[clear]]} />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
    expect(names()).toEqual(["Clear"]);
  });

  it("closes a tab's open menu and dialogs with the tab, and opens Mod-K's link dialog on any tab", () => {
    const editor = createEditor({ document: doc() });
    // On both tabs, so that only the change of tab can close its dialog.
    const note: ToolbarDialog = { key: "note", label: "Note", dialog: () => <p>Read me.</p> };
    const tabs: ToolbarTab[] = [
      { key: "a", label: "A", items: [[toolbarItems.textColor, toolbarItems.table, note]] },
      { key: "b", label: "B", items: [[toolbarItems.undo, note]] },
      { key: "c", label: "C", items: [[toolbarItems.newComment]] },
    ];
    const { container } = render(<FoliToolbar editor={editor} tabs={tabs} className="mine" />);
    // `className` is on the element around the tabs and the toolbar.
    const ribbon = container.querySelector(".foli-ribbon.mine") as HTMLElement;
    expect(ribbon.contains(screen.getByRole("tablist"))).toBe(true);
    expect(screen.getByRole("toolbar").className).toBe("foli-toolbar");
    fireEvent.click(screen.getByRole("button", { name: "Note" }), { detail: 1 });
    screen.getByRole("dialog", { name: "Note" });
    fireEvent.click(screen.getByRole("tab", { name: "B" }), { detail: 1 });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "A" }), { detail: 1 });
    // A built-in dialog too: its button went with the tab.
    fireEvent.click(screen.getByRole("button", { name: "Table" }), { detail: 0 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Insert table\u2026" }), { detail: 0 });
    screen.getByRole("dialog", { name: "Insert table" });
    fireEvent.click(screen.getByRole("tab", { name: "B" }), { detail: 1 });
    expect(screen.queryByRole("dialog")).toBeNull();
    // A tab with nothing to show (New comment without `comments`): its panel is the tab stop.
    fireEvent.click(screen.getByRole("tab", { name: "C" }), { detail: 1 });
    expect(screen.getByRole("tabpanel").tabIndex).toBe(0);
    fireEvent.click(screen.getByRole("tab", { name: "A" }), { detail: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Text color" }), { detail: 0 });
    screen.getByRole("menu");
    fireEvent.click(screen.getByRole("tab", { name: "B" }), { detail: 1 });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "A" }), { detail: 1 });
    expect(screen.queryByRole("menu")).toBeNull();
    // No link item on either tab: the dialog is the toolbar's.
    selectAll(editor);
    act(() => void editor.run(openLinkEditor));
    screen.getByRole("dialog", { name: "Add link" });
  });

  it("has Word's tabs of the built-in items, each item once, through FoliEditor's toolbar", () => {
    expect(defaultToolbarTabs.map((tab) => tab.label)).toEqual([
      "Home",
      "Insert",
      "Layout",
      "Review",
    ]);
    const all = defaultToolbarTabs.flatMap((tab) => tab.items.flat());
    // The default toolbar's items: the ribbon's own (menus' entries) are `wordRibbonTabs`'.
    expect(new Set(all)).toEqual(new Set(defaultToolbarItems.flat()));
    expect(all).toHaveLength(defaultToolbarItems.flat().length);

    // No groups is no items, as before there were tabs.
    const empty = render(<FoliEditor initialContent={doc()} toolbar={[]} label="Document" />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(within(screen.getByRole("toolbar")).queryAllByRole("button")).toEqual([]);
    empty.unmount();

    render(<FoliEditor initialContent={doc()} toolbar={defaultToolbarTabs} label="Document" />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Home",
      "Insert",
      "Layout",
      "Review",
    ]);
    screen.getByRole("button", { name: "Bold" });
    fireEvent.click(screen.getByRole("tab", { name: "Review" }), { detail: 1 });
    expect(screen.queryByRole("button", { name: "Bold" })).toBeNull();
    screen.getByRole("button", { name: "Track changes" });
  });

  it("lets the app say which tab shows, and tells it of a pick", () => {
    const editor = createEditor({ document: doc() });
    const tabs: ToolbarTab[] = [
      { key: "edit", label: "Edit", items: [[toolbarItems.undo]] },
      { key: "format", label: "Format", items: [[toolbarItems.bold]] },
    ];
    const onTabChange = vi.fn();
    const selected = () =>
      screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")
        ?.textContent;
    // Not controlled: `defaultTab` at first, then what is picked.
    const first = render(
      <FoliToolbar editor={editor} tabs={tabs} defaultTab="format" onTabChange={onTabChange} />,
    );
    expect(selected()).toBe("Format");
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }), { detail: 1 });
    expect(selected()).toBe("Edit");
    expect(onTabChange).toHaveBeenLastCalledWith("edit");
    first.unmount();

    // Controlled: a pick only tells the app; the tab changes when `tab` does.
    onTabChange.mockClear();
    const view = (tab: string) => (
      <FoliToolbar editor={editor} tabs={tabs} tab={tab} onTabChange={onTabChange} />
    );
    const { rerender } = render(view("format"));
    expect(selected()).toBe("Format");
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }), { detail: 1 });
    expect(onTabChange).toHaveBeenCalledExactlyOnceWith("edit");
    expect(selected()).toBe("Format");
    screen.getByRole("button", { name: "Bold" });
    // The arrow keys go on from the tab that has the focus, though the app kept its `tab`.
    const [edit, format] = screen.getAllByRole("tab") as [HTMLElement, HTMLElement];
    act(() => format.focus());
    fireEvent.keyDown(format, { key: "ArrowRight" });
    expect(document.activeElement).toBe(edit);
    fireEvent.keyDown(edit, { key: "ArrowRight" });
    expect(document.activeElement).toBe(format);
    expect(onTabChange.mock.calls).toEqual([["edit"], ["edit"]]);
    // A pick the app does not follow leaves the tab's open menu alone.
    rerender(
      <FoliToolbar
        editor={editor}
        tabs={[
          tabs[0] as ToolbarTab,
          { key: "format", label: "Format", items: [[toolbarItems.textColor]] },
        ]}
        tab="format"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Text color" }), { detail: 0 });
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }), { detail: 1 });
    screen.getByRole("menu");
    // A key that is not a tab: the first one, and the last tab's menu goes with it.
    rerender(view("nope"));
    expect(selected()).toBe("Edit");
    expect(screen.queryByRole("menu")).toBeNull();
    rerender(view("format"));
    expect(selected()).toBe("Format");
    rerender(view("edit"));
    expect(selected()).toBe("Edit");
    screen.getByRole("button", { name: "Undo" });
  });

  it("shows a tab only while its `visible` says so; the first one when the selected one goes", () => {
    const editor = createEditor({ document: doc() });
    const onTabChange = vi.fn();
    const tabs: ToolbarTab[] = [
      { key: "edit", label: "Edit", items: [[toolbarItems.undo]] },
      {
        key: "selection",
        label: "Selection",
        items: [[clear]],
        visible: (state) => !state.selection.empty,
      },
    ];
    render(<FoliToolbar editor={editor} tabs={tabs} onTabChange={onTabChange} />);
    const names = () => screen.getAllByRole("tab").map((t) => t.textContent);
    expect(names()).toEqual(["Edit"]);
    selectAll(editor);
    // It comes, and is not selected for the user.
    expect(names()).toEqual(["Edit", "Selection"]);
    expect(screen.getByRole("tab", { name: "Edit" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Selection" }), { detail: 1 });
    screen.getByRole("button", { name: "Clear" });
    expect(onTabChange).toHaveBeenCalledExactlyOnceWith("selection");
    // It goes with the selection: the first tab shows, and the app is not told of a pick.
    act(() => editor.select(1, 1));
    expect(names()).toEqual(["Edit"]);
    screen.getByRole("button", { name: "Undo" });
    expect(onTabChange).toHaveBeenCalledOnce();
    // Back: the tab picked is still the one wanted.
    selectAll(editor);
    screen.getByRole("button", { name: "Clear" });
    // Its tab had the focus when it went: the tab now selected takes it, not the page.
    act(() => screen.getByRole("tab", { name: "Selection" }).focus());
    act(() => editor.select(1, 1));
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Edit" }));
    // Picking the tab that shows meanwhile is a pick: the other does not come back selected.
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }), { detail: 1 });
    expect(onTabChange).toHaveBeenLastCalledWith("edit");
    selectAll(editor);
    expect(names()).toEqual(["Edit", "Selection"]);
    screen.getByRole("button", { name: "Undo" });
  });

  it("names a group with a caption; the arrow keys cross it", () => {
    const editor = createEditor({ document: doc() });
    const { container } = render(
      <FoliToolbar
        editor={editor}
        items={[
          [toolbarItems.undo],
          { label: "Text", items: [toolbarItems.bold, clear] },
          [],
          // Nothing left in it without `comments`: no group, no separator.
          { label: "Comments", items: [toolbarItems.newComment] },
        ]}
      />,
    );
    const group = screen.getByRole("group", { name: "Text" });
    expect(
      within(group)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["B", "Clear"]);
    const caption = group.querySelector(".foli-toolbar-group-label") as HTMLElement;
    expect(caption.textContent).toBe("Text");
    expect(caption.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelectorAll("hr")).toHaveLength(1);
    expect(screen.getAllByRole("group")).toHaveLength(1);
    // `defaultToolbarTabs` keeps its groups as arrays (types).
    expect(defaultToolbarTabs[0]?.items[0]?.map((item) => item.key)).toEqual(["undo", "redo"]);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.tabIndex)).toEqual([0, -1, -1]);
    fireEvent.keyDown(buttons[0] as HTMLElement, { key: "ArrowRight" });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.keyDown(buttons[1] as HTMLElement, { key: "End" });
    expect(document.activeElement).toBe(buttons[2]);
  });

  it("takes captioned groups and more of the toolbar's props through FoliEditor", () => {
    const onTabChange = vi.fn();
    const groups = render(
      <FoliEditor
        initialContent={doc()}
        toolbar={[{ label: "History", items: [toolbarItems.undo] }]}
        toolbarProps={{ label: "Tools", className: "mine" }}
        label="Document"
      />,
    );
    const bar = screen.getByRole("toolbar", { name: "Tools" });
    expect(bar.className).toBe("foli-toolbar mine");
    within(bar).getByRole("group", { name: "History" });
    expect(screen.queryByRole("tablist")).toBeNull();
    groups.unmount();

    render(
      <FoliEditor
        initialContent={doc()}
        toolbar={defaultToolbarTabs}
        toolbarProps={{ tab: "review", onTabChange }}
        label="Document"
      />,
    );
    screen.getByRole("button", { name: "Track changes" });
    fireEvent.click(screen.getByRole("tab", { name: "Home" }), { detail: 1 });
    expect(onTabChange).toHaveBeenCalledExactlyOnceWith("home");
    screen.getByRole("button", { name: "Track changes" });
  });

  it('puts the groups that do not fit under More, with `overflow="menu"`', () => {
    const editor = createEditor({ document: doc() });
    // No layout in jsdom: give the toolbar 100px, each item 40px in a row, More 30px.
    let width = 100;
    let resize: (() => void) | undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const rect = (left: number, width: number) =>
      ({ left, right: left + width, width, top: 0, bottom: 20, height: 20 }) as DOMRect;
    const measure = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.getAttribute("role") === "toolbar") return rect(0, width);
        if (this.classList.contains("foli-toolbar-more")) return rect(0, 30);
        const at = screen.getAllByRole("button", { hidden: true }).indexOf(this);
        return rect(at * 40, 40);
      });
    const note: ToolbarDialog = { key: "note", label: "Note", dialog: () => <p>Read me.</p> };
    const items = [[toolbarItems.undo], [toolbarItems.redo], [toolbarItems.bold, clear, note]];
    const { container, rerender } = render(
      <FoliToolbar editor={editor} items={items} overflow="menu" />,
    );
    const more = container.querySelector(".foli-toolbar-more") as HTMLElement;
    const panel = container.querySelector(".foli-toolbar-more-panel") as HTMLElement;
    expect([panel.getAttribute("role"), panel.getAttribute("aria-label")]).toEqual([
      "group",
      "More",
    ]);
    // 100px take one group of 40px and More (30px, 4px apart); the others are in the panel.
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(more.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.hidden).toBe(true);
    expect(
      within(panel)
        .getAllByRole("button", { hidden: true })
        .map((b) => b.title),
    ).toEqual(["Redo", "Bold", "Delete the selection", "Note"]);
    const undoButton = screen.getByRole("button", { name: "Undo" });
    expect(panel.contains(undoButton)).toBe(false);
    // The arrow keys go on into the panel, which opens, and back out, which closes it.
    act(() => undoButton.focus());
    fireEvent.keyDown(undoButton, { key: "ArrowRight" });
    expect(panel.hidden).toBe(false);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const redoButton = screen.getByRole("button", { name: "Redo" });
    expect(document.activeElement).toBe(redoButton);
    fireEvent.keyDown(redoButton, { key: "Home" });
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(undoButton);
    // The tab stop is never in a closed panel.
    expect(screen.getAllByRole("button", { hidden: true }).filter((b) => b.tabIndex === 0)).toEqual(
      [undoButton],
    );
    // More opens and closes it for the pointer; Escape in it closes it, the focus on More.
    expect(fireEvent.mouseDown(more)).toBe(false);
    fireEvent.click(more, { detail: 1 });
    expect(panel.hidden).toBe(false);
    fireEvent.keyDown(screen.getByRole("button", { name: "Bold" }), { key: "Escape" });
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(more);
    // A press outside closes it too.
    fireEvent.click(more, { detail: 1 });
    fireEvent.pointerDown(document.body);
    expect(panel.hidden).toBe(true);
    // A dialog opens where the panel is: the panel closes for it, and when the dialog closes
    // More takes the focus its button cannot (it is in the closed panel).
    fireEvent.click(more, { detail: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Note" }), { detail: 0 });
    const dialog = screen.getByRole("dialog", { name: "Note" });
    expect(panel.hidden).toBe(true);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(more);
    // A wider toolbar takes more groups, without measuring again; a narrower one, fewer.
    expect(resize).toBeDefined();
    width = 130;
    act(() => resize?.());
    expect(panel.contains(screen.getByRole("button", { name: "Redo", hidden: true }))).toBe(false);
    expect(panel.contains(screen.getByRole("button", { name: "Bold", hidden: true }))).toBe(true);
    width = 100;
    act(() => resize?.());
    expect(panel.contains(screen.getByRole("button", { name: "Redo", hidden: true }))).toBe(true);

    // The default, `"wrap"`: no More, no panel, the toolbar as before.
    rerender(<FoliToolbar editor={editor} items={items} />);
    expect(container.querySelector(".foli-toolbar-more")).toBeNull();
    expect(screen.queryByRole("group", { hidden: true })).toBeNull();
    expect(screen.getByRole("toolbar").className).toBe("foli-toolbar");
    measure.mockRestore();
    vi.unstubAllGlobals();
  });

  it("warns once about two items with one key, outside production", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const editor = createEditor({ document: doc() });
    render(<FoliToolbar editor={editor} items={[[clear], [{ ...clear, label: "Again" }]]} />);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('two items have the key "clear"');
    warn.mockRestore();
  });

  it("dry-runs nothing for the built-in items, and keeps inline groups of the same items", () => {
    const editor = createEditor({ document: doc() });
    const can = vi.spyOn(editor, "can");
    const { rerender } = render(<FoliToolbar editor={editor} />);
    act(() => void editor.run(insertText("x")));
    selectAll(editor);
    expect(can).not.toHaveBeenCalled();

    // An inline array of the same items: no new selector, so no dry run on a mere re-render.
    rerender(<FoliToolbar editor={editor} items={[[clear]]} />);
    const calls = can.mock.calls.length;
    rerender(<FoliToolbar editor={editor} items={[[clear]]} />);
    expect(can.mock.calls.length).toBe(calls);
  });

  it("takes the items through FoliEditor's toolbar prop", () => {
    render(<FoliEditor initialContent={doc()} toolbar={[[toolbarItems.bold, clear]]} />);
    expect(
      screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent),
    ).toEqual(["Bold", "Clear"]);
  });
});

function CommandButton({ command }: { command: Command }) {
  const { enabled, run } = useCommand(command);
  return (
    <button type="button" disabled={!enabled} onClick={run}>
      Run
    </button>
  );
}

function ShoutButton() {
  const { enabled, run } = useCommand("shout", "hey ");
  return (
    <button type="button" disabled={!enabled} onClick={run}>
      Shout
    </button>
  );
}

function UndoByName() {
  const { enabled, run } = useCommand("undo");
  return (
    <button type="button" disabled={!enabled} onClick={run}>
      Undo
    </button>
  );
}

/** A document with a default header holding "Head". */
const withHeader: FoliDocument = {
  ...doc(),
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
};

/** Re-renders `ShoutParent` with nothing changed. */
let bump = () => {};
function ShoutParent() {
  const [, set] = useState(0);
  bump = () => set((n) => n + 1);
  return <ShoutButton />;
}

describe("useCommand", () => {
  afterEach(cleanup);

  it("runs a built-in command by name, typed by FoliCommands", () => {
    const editor = createEditor({ document: doc() });
    render(
      <FoliEditorProvider editor={editor}>
        <UndoByName />
      </FoliEditorProvider>,
    );
    const button = screen.getByRole("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    act(() => void editor.commands.insertText("x"));
    expect(button.disabled).toBe(false);
    act(() => fireEvent.click(button));
    expect(text(editor)).toBe("Hello");
  });

  it("acts on the header open on its page, as the toolbar does", () => {
    const editor = createEditor({ document: withHeader });
    let open: OpenStory | null = null;
    editor.storyView = {
      get open() {
        return open;
      },
      edit: () => false,
      close: () => {},
      editNote: () => false,
      toReference: () => false,
      fieldLayout: null,
      updateFields: () => ({ updated: 0, unchanged: 0, rebuilt: 0, skipped: [] }),
      showMatches: () => {},
      reveal: () => false,
      goToPage: () => false,
      focus: () => {},
    };
    const star = insertText("*");
    render(
      <FoliEditorProvider editor={editor}>
        <CommandButton command={star} />
      </FoliEditorProvider>,
    );
    act(() => {
      open = { id: "h", side: "header", variant: "default", section: 0 };
      editor.storyChanged();
    });
    act(() => fireEvent.click(screen.getByRole("button")));
    expect(editor.story("h")?.state.doc.textContent).toBe("*Head");
    expect(text(editor)).toBe("Hello");
  });

  it("keeps its dry run's answer across renders with the same command and arguments", () => {
    const editor = createEditor({ document: doc(), plugins: [shouting] });
    const can = vi.spyOn(editor, "can");
    render(
      <FoliEditorProvider editor={editor}>
        <ShoutParent />
      </FoliEditorProvider>,
    );
    const calls = can.mock.calls.length;
    act(() => bump());
    act(() => bump());
    expect(can.mock.calls.length).toBe(calls);
  });

  it("dry-runs a command after each transaction and runs it", () => {
    const editor = createEditor({ document: doc() });
    render(<CommandButton command={undo} />, {
      wrapper: ({ children }) => (
        <FoliEditorProvider editor={editor}>{children}</FoliEditorProvider>
      ),
    });
    const button = screen.getByRole("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    act(() => void editor.run(insertText("x")));
    expect(button.disabled).toBe(false);
    act(() => fireEvent.click(button));
    expect(text(editor)).toBe("Hello");
    expect(button.disabled).toBe(true);
  });

  it("finds a plugin's command by its typed name", () => {
    const editor = createEditor({ document: doc(), plugins: [shouting] });
    render(
      <FoliEditorProvider editor={editor}>
        <ShoutButton />
      </FoliEditorProvider>,
    );
    const button = screen.getByRole("button") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    act(() => fireEvent.click(button));
    expect(text(editor)).toBe("HEY Hello");
    selectAll(editor);
    expect(button.disabled).toBe(true);
  });

  it("is disabled for a name the editor does not have, until a plugin gives it (24.5)", () => {
    const editor = createEditor({ document: doc() });
    render(
      <FoliEditorProvider editor={editor}>
        <ShoutButton />
      </FoliEditorProvider>,
    );
    const button = screen.getByRole("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    act(() => editor.reconfigure({ plugins: [shouting] }));
    expect(button.disabled).toBe(false);
    act(() => fireEvent.click(button));
    expect(text(editor)).toBe("HEY Hello");
    // Its plugin taken away: the command goes with it.
    act(() => editor.reconfigure({ plugins: [] }));
    expect(button.disabled).toBe(true);
  });

  it("a command of a plugin added in the same render does not throw", () => {
    const { rerender } = render(<ShoutingApp on={false} />);
    act(() => rerender(<ShoutingApp on={true} />));
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
  });
});

/** An editor whose `shouting` plugin comes with the button that runs its command. */
function ShoutingApp({ on }: { on: boolean }) {
  const editor = useFoliEditor({ initialContent: doc(), plugins: on ? [shouting] : [] });
  return <FoliEditorProvider editor={editor}>{on && <ShoutButton />}</FoliEditorProvider>;
}

describe("plugins changed after mount", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps the editor and its document, and takes the new list in place (24.5)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const editors: Editor[] = [];
    const ref = (handle: { editor: Editor } | null) => {
      if (handle) editors.push(handle.editor);
    };
    const { rerender } = render(
      <FoliEditor ref={ref} initialContent={doc()} plugins={[shouting]} />,
    );
    const editor = editors[0] as Editor;
    const before = editor.state.doc;
    // A new array of the same plugins is no change.
    const plugins = editor.state.plugins;
    rerender(<FoliEditor ref={ref} initialContent={doc()} plugins={[shouting]} />);
    expect(editor.state.plugins).toBe(plugins);
    const other = new Plugin({ key: new PluginKey("other") });
    rerender(<FoliEditor ref={ref} initialContent={doc()} plugins={[shouting, other]} />);
    expect(editor.state.plugins).toContain(other);
    rerender(<FoliEditor ref={ref} initialContent={doc()} plugins={[other]} />);
    expect(editor.state.plugins).not.toContain(shouting);
    expect(editor.state.plugins).toContain(other);
    expect(editor.state.doc).toBe(before);
    expect(warn).not.toHaveBeenCalled();
    expect(new Set(editors).size).toBe(1);
  });

  it("warns for extensions too", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { rerender } = render(<FoliEditor initialContent={doc()} />);
    rerender(<FoliEditor initialContent={doc()} extensions={[{ name: "acme" }]} />);
    expect(warn.mock.calls[0]?.[0]).toContain("`extensions` changed");
  });
});
