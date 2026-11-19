// @vitest-environment jsdom
import {
  type Command,
  createDocument,
  createEditor,
  deleteSelection,
  insertText,
  Plugin,
  PluginKey,
  TextSelection,
  undo,
} from "@folijs/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultToolbarItems,
  FoliEditor,
  FoliEditorProvider,
  FoliToolbar,
  type ToolbarItem,
  type ToolbarItemName,
  toolbarItems,
  useCommand,
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
  section: 1,
  headerFooter: 1,
  fields: 1,
  navigate: 1,
  notes: 1,
  controls: 1,
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
    expect(defaultToolbarItems.flat()).toEqual(Object.values(toolbarItems));
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

describe("useCommand", () => {
  afterEach(cleanup);

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

  it("throws for a name no plugin has", () => {
    const editor = createEditor({ document: doc() });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <FoliEditorProvider editor={editor}>
          <ShoutButton />
        </FoliEditorProvider>,
      ),
    ).toThrow('no plugin has a command named "shout"');
    vi.restoreAllMocks();
  });
});

describe("plugins changed after mount", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps the editor, and warns once when the list really changed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const editors: unknown[] = [];
    const ref = (handle: { editor: unknown } | null) => {
      if (handle) editors.push(handle.editor);
    };
    const { rerender } = render(
      <FoliEditor ref={ref} initialContent={doc()} plugins={[shouting]} />,
    );
    // A new array of the same plugins is no change.
    rerender(<FoliEditor ref={ref} initialContent={doc()} plugins={[shouting]} />);
    expect(warn).not.toHaveBeenCalled();
    const other = new Plugin({ key: new PluginKey("other") });
    rerender(<FoliEditor ref={ref} initialContent={doc()} plugins={[shouting, other]} />);
    rerender(<FoliEditor ref={ref} initialContent={doc()} plugins={[other]} />);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("`plugins` changed after the editor was created");
    expect(new Set(editors).size).toBe(1);
  });

  it("warns for extensions too", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { rerender } = render(<FoliEditor initialContent={doc()} />);
    rerender(<FoliEditor initialContent={doc()} extensions={[{ name: "acme" }]} />);
    expect(warn.mock.calls[0]?.[0]).toContain("`extensions` changed");
  });
});
