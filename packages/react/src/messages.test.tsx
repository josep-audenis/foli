// @vitest-environment jsdom
import { createEditor, type FoliDocument, insertControl } from "@folijs/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultToolbarItems,
  defaultToolbarTabs,
  FoliToolbar,
  type ToolbarColorMenu,
  type ToolbarDialog,
  type ToolbarDialogName,
  type ToolbarMessages,
  toolbarItems,
  toolbarMessages,
} from "./index.js";
import { translator } from "./messages.js";

/** Every message marked: a string shown without the mark did not go through `messages`. */
const marked = Object.fromEntries(
  toolbarMessages.map((message) => [message, `⟦${message}⟧`]),
) as ToolbarMessages;

/** Boxes whose entries are the document's (styles, fonts, table styles) or numbers. */
const DATA = [".foli-toolbar-style", ".foli-toolbar-font", ".foli-toolbar-size"]
  .concat([".foli-toolbar-lineSpacing", ".foli-toolbar-tableStyle"])
  .join(", ");

/** The text shown and announced on the page that is not a marked message. */
function untranslated(): string[] {
  const found = new Set<string>();
  const check = (text: string | null | undefined) => {
    const trimmed = text?.trim();
    if (trimmed && /[A-Za-z]/.test(trimmed) && !trimmed.includes("⟦")) found.add(trimmed);
  };
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text) {
      if (!node.parentElement?.closest(DATA)) check(node.data);
      continue;
    }
    const element = node as Element;
    for (const name of ["aria-label", "title", "placeholder", "alt"])
      check(element.getAttribute(name));
  }
  return [...found];
}

const doc: FoliDocument = {
  schemaVersion: 5,
  section: {},
  defaults: {},
  styles: [
    { id: "Normal", type: "paragraph", name: "Normal", isDefault: true },
    { id: "Heading1", type: "paragraph", name: "heading 1", basedOn: "Normal" },
  ],
  numbering: { abstracts: [], instances: [] },
  comments: [],
  content: {
    type: "doc",
    content: [
      // A heading to refer to (its text is the document's, marked so the check passes it).
      {
        type: "paragraph",
        attrs: { style: "Heading1" },
        content: [{ type: "text", text: "⟦Hi⟧" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "Hello world" }] },
    ],
  },
};

const NAMES: ToolbarDialogName[] = [
  "link",
  "picture",
  "insertTable",
  "pageSetup",
  "crossReference",
  "controlProperties",
  "noteOptions",
];
/** Buttons that open each built-in dialog (their own labels are the app's, so marked). */
const dialogs = NAMES.map(
  (name): ToolbarDialog => ({ key: `open-${name}`, label: `⟦open ${name}⟧`, dialog: name }),
);
const anyColor: ToolbarColorMenu = {
  ...toolbarItems.highlight,
  key: "anyColor",
  colors: { ...toolbarItems.highlight.colors, custom: true },
};

describe("the toolbar's messages", () => {
  afterEach(cleanup);

  it("fills in values and leaves strings that are not messages as they are", () => {
    const t = translator({ "Bookmark: {name}": "Marcador: {name}", Bold: "Negrita" });
    expect(t("Bookmark: {name}", { name: "Intro" })).toBe("Marcador: Intro");
    expect(t("Bold")).toBe("Negrita");
    expect(t("Italic")).toBe("Italic");
    expect(translator(undefined)("Enter a number of rows from 1 to {max}.", { max: 9 })).toBe(
      "Enter a number of rows from 1 to 9.",
    );
  });

  it("shows nothing that is not a message: items, menus, colors, More, tabs and dialogs", () => {
    const editor = createEditor({ document: doc });
    const upload = async () => ({ src: "x.png" });
    const view = (
      <FoliToolbar
        editor={editor}
        messages={marked}
        comments
        upload={upload}
        overflow="menu"
        items={[...defaultToolbarItems, [anyColor, ...dialogs]]}
      />
    );
    const { rerender } = render(view);
    expect(untranslated()).toEqual([]);

    // Every menu, open.
    act(() => editor.select(16, 21));
    const menus = screen
      .getAllByRole("button", { hidden: true })
      .filter((b) => b.getAttribute("aria-haspopup") === "menu");
    expect(menus.length).toBeGreaterThan(8);
    for (const button of menus) {
      fireEvent.click(button, { detail: 0 });
      expect([button.getAttribute("aria-label") ?? button.textContent, untranslated()]).toEqual([
        button.getAttribute("aria-label") ?? button.textContent,
        [],
      ]);
      const menu = screen.queryByRole("menu", { hidden: true });
      if (menu) fireEvent.keyDown(menu.firstElementChild as Element, { key: "Escape" });
    }

    // Every dialog, with what it can say wrong.
    const open = (name: ToolbarDialogName) =>
      fireEvent.click(screen.getByRole("button", { name: `⟦open ${name}⟧`, hidden: true }), {
        detail: 0,
      });
    const check = (name: string) => expect([name, untranslated()]).toEqual([name, []]);
    const close = () => {
      const dialog = screen.queryByRole("dialog");
      if (dialog) fireEvent.keyDown(dialog, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
    };

    open("link");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "javascript:alert(1)" } });
    fireEvent.submit(screen.getByRole("textbox").closest("form") as HTMLFormElement);
    check("link");
    close();

    act(() => editor.select(17));
    open("insertTable");
    fireEvent.change(screen.getAllByRole("spinbutton")[0] as HTMLElement, {
      target: { value: "0" },
    });
    fireEvent.submit(screen.getByRole("dialog").querySelector("form") as HTMLFormElement);
    check("insertTable");
    close();

    open("picture");
    fireEvent.submit(screen.getByRole("dialog").querySelector("form") as HTMLFormElement);
    check("picture");
    close();

    for (const name of ["pageSetup", "noteOptions", "crossReference"] as const) {
      open(name);
      expect(screen.getByRole("dialog")).toBeTruthy();
      check(name);
      close();
    }

    act(() => {
      editor.select(17);
      editor.run(insertControl("text", { title: "⟦A control⟧" }));
    });
    open("controlProperties");
    expect(screen.getByRole("dialog")).toBeTruthy();
    check("controlProperties");
    close();

    // Word's tabs.
    rerender(<FoliToolbar editor={editor} messages={marked} tabs={defaultToolbarTabs} />);
    expect(untranslated()).toEqual([]);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "⟦Home⟧",
      "⟦Insert⟧",
      "⟦Layout⟧",
      "⟦Review⟧",
    ]);
  });

  it("lists every built-in item's name, menu entry and color, and nothing twice", () => {
    const editor = createEditor({ document: doc });
    const listed = new Set<string>(toolbarMessages);
    expect(listed.size).toBe(toolbarMessages.length);
    for (const item of Object.values(toolbarItems)) {
      expect(listed).toContain(item.label);
      if (item.text) expect(listed).toContain(item.text);
      if (typeof item.icon === "string" && /[A-Za-z]/.test(item.icon))
        expect(listed).toContain(item.icon);
      const colors = item.colors?.options;
      for (const color of (typeof colors === "function" ? colors(editor.state) : colors) ?? [])
        expect(listed).toContain(color.name);
      const actions = typeof item.actions === "function" ? item.actions(editor) : item.actions;
      for (const action of actions ?? []) expect(listed).toContain(action.label);
    }
  });
});
