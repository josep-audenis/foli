// @vitest-environment jsdom
import {
  createEditor,
  type Editor,
  type FoliDocument,
  type RulerGeometry,
  requestedDialog,
  sectionAt,
  setTabStops,
} from "@folijs/core";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FoliRuler } from "./index.js";

afterEach(cleanup);

const doc = (indent?: Record<string, number>): FoliDocument => ({
  schemaVersion: 5,
  section: {
    pageSize: { width: 12240, height: 15840 },
    margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
  },
  defaults: {},
  styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
  numbering: { abstracts: [], instances: [] },
  comments: [],
  content: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        ...(indent ? { attrs: { indent } } : {}),
        content: [{ type: "text", text: "one two three" }],
      },
    ],
  },
});

/** 0.1 px a twip: a Letter page from x 100 to 1324, its margins an inch (144 px) in. */
const K = 0.1;
const PAGE = { left: 100, right: 100 + 12240 * K };

/** Gives `editor` a view whose geometry is the page above, its paragraph's from its indents. */
function fakeView(editor: Editor, story: { id: string | null } = { id: null }) {
  editor.storyView = {
    get open() {
      return story.id ? { id: story.id, side: "header", variant: "default", section: 0 } : null;
    },
    focus: () => {},
    rulerGeometry: (): RulerGeometry => {
      const caret = (story.id && editor.story(story.id)) || editor;
      const setup = sectionAt(editor.state)?.setup.margins ?? {};
      const margins = {
        left: PAGE.left + (setup.left ?? 0) * K,
        right: PAGE.right - (setup.right ?? 0) * K,
        top: 0,
        bottom: 0,
      };
      const indent = (caret.state.selection.$head.parent.attrs.indent ?? {}) as Record<
        string,
        number
      >;
      const left = margins.left + (indent.left ?? 0) * K;
      return {
        pxPerTwip: K,
        gutter: 0,
        page: { index: 0, ...PAGE, top: 0, bottom: 1584 },
        margins,
        text: { left: margins.left, right: margins.right },
        paragraph: {
          left,
          firstLine: left + ((indent.firstLine ?? 0) - (indent.hanging ?? 0)) * K,
          right: margins.right - (indent.right ?? 0) * K,
          tabs: (
            (caret.state.selection.$head.parent.attrs.tabs ?? []) as {
              position: number;
              kind: "left" | "center";
            }[]
          ).map((tab) => ({
            x: margins.left + tab.position * K,
            position: tab.position / 20,
            alignment: tab.kind,
          })),
        },
        table: tableOf(caret, margins.left),
      };
    },
  } as never;
}

/** The top-level table around the caret as the view gives it: drawn from `left`, 0.1 px a twip. */
function tableOf(editor: Editor, left: number): RulerGeometry["table"] {
  const { $head } = editor.state.selection;
  if ($head.depth < 2 || $head.node(1).type.name !== "table") return null;
  let right = left;
  return {
    pos: $head.before(1),
    left,
    columns: ($head.node(1).attrs.grid as number[]).map((width) => {
      right += width * K;
      return { right, width };
    }),
  };
}

async function setup(indent?: Record<string, number>, disabled = false) {
  const editor = createEditor({ document: doc(indent) });
  fakeView(editor);
  act(() => {
    editor.select(2, 2);
  });
  render(<FoliRuler editor={editor} units="in" disabled={disabled} />);
  await waitFor(() => screen.getByRole("slider", { name: "Left indent" }));
  return editor;
}

const indentOf = (editor: Editor) => editor.state.selection.$head.parent.attrs.indent;
const slider = (name: string) => screen.getByRole("slider", { name });
/** A drag from x `from` to `to` (client px) on a handle. */
function drag(handle: HTMLElement, from: number, to: number, altKey = false, clientY = 0) {
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: from, altKey });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: (from + to) / 2, altKey, clientY });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: to, altKey, clientY });
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: to, altKey, clientY });
}

describe("FoliRuler", () => {
  it("shows the indents and margins as sliders in the unit", async () => {
    await setup({ left: 720, hanging: 360, right: 1440 });
    expect(screen.getByRole("group", { name: "Horizontal ruler" })).toBeTruthy();
    const left = slider("Left indent");
    expect(left.getAttribute("aria-valuenow")).toBe("0.5");
    expect(left.getAttribute("aria-valuetext")).toBe('0.5"');
    expect(slider("First line indent").getAttribute("aria-valuenow")).toBe("-0.25");
    expect(slider("Hanging indent").getAttribute("aria-valuenow")).toBe("0.5");
    expect(slider("Right indent").getAttribute("aria-valuenow")).toBe("1");
    expect(slider("Left margin").getAttribute("aria-valuetext")).toBe('1"');
    expect(slider("Right margin").getAttribute("aria-valuenow")).toBe("1");
    // Placed where the geometry says, against the ruler's own left edge (0 in jsdom).
    expect(left.style.left).toBe(`${244 + 72}px`);
  });

  it("drags the left indent by the ruler's step, in one undo step", async () => {
    const editor = await setup();
    // 100 px is 1000 twips: snapped to 1/16 inch (90 twips), 990.
    act(() => drag(slider("Left indent"), 244, 344));
    expect(indentOf(editor)).toEqual({ left: 990 });
    act(() => {
      editor.commands.undo();
    });
    expect(indentOf(editor)).toBeNull();
  });

  it("with Alt held does not snap, and shows the value while dragging", async () => {
    const editor = await setup();
    const handle = slider("Left indent");
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 244, altKey: true });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 344, altKey: true });
    expect(document.querySelector(".foli-ruler-value")?.textContent).toBe('0.69"');
    // Escape cancels: nothing changes on release.
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 344, altKey: true });
    expect(indentOf(editor)).toBeNull();
    act(() => drag(slider("Left indent"), 244, 344, true));
    expect(indentOf(editor)).toEqual({ left: 1000 });
  });

  it("moves the hanging marker with the first line kept, and the first line on its own", async () => {
    const editor = await setup({ left: 720 });
    // The hanging marker to 1 inch: the first line stays at 0.5, a hanging indent of 0.5.
    act(() => drag(slider("Hanging indent"), 316, 388));
    expect(indentOf(editor)).toEqual({ left: 1440, hanging: 720 });
    // The first line to 1.5 inches: a first-line indent of 0.5 from the left one.
    act(() => drag(slider("First line indent"), 316, 460));
    expect(indentOf(editor)).toEqual({ left: 1440, firstLine: 720 });
    act(() => drag(slider("Right indent"), 1180, 1108));
    expect(indentOf(editor)).toEqual({ left: 1440, firstLine: 720, right: 720 });
  });

  it("drags a margin of the caret's section", async () => {
    const editor = await setup();
    act(() => drag(slider("Left margin"), 244, 172));
    expect(sectionAt(editor.state)?.setup.margins?.left).toBe(720);
    act(() => drag(slider("Right margin"), 1180, 1036));
    expect(sectionAt(editor.state)?.setup.margins?.right).toBe(2880);
  });

  it("moves a handle with the keyboard, a step an arrow, the way the arrow points", async () => {
    const editor = await setup({ left: 720, right: 720 });
    fireEvent.keyDown(slider("Left indent"), { key: "ArrowRight" });
    expect(indentOf(editor)).toEqual({ left: 810, right: 720 });
    fireEvent.keyDown(slider("Left indent"), { key: "PageDown" });
    expect(indentOf(editor)).toEqual({ left: 90, right: 720 });
    // The right indent grows leftwards: ArrowLeft moves it left, a larger value.
    fireEvent.keyDown(slider("Right indent"), { key: "ArrowLeft" });
    expect(indentOf(editor)).toEqual({ left: 90, right: 810 });
  });

  it("Up makes a value larger on every handle; the hanging marker says its special indent", async () => {
    const editor = await setup({ left: 1440, hanging: 720, right: 720 });
    fireEvent.keyDown(slider("Right indent"), { key: "ArrowUp" });
    expect(indentOf(editor)).toEqual({ left: 1440, hanging: 720, right: 810 });
    expect(slider("Hanging indent").getAttribute("aria-valuetext")).toBe('1", hanging 0.5"');
    expect(slider("First line indent").getAttribute("aria-valuetext")).toBe('-0.5"');
  });

  it("follows the caret in an open header, whose selection the body does not hear", async () => {
    const story = { id: null as string | null };
    const editor = createEditor({
      document: {
        ...doc(),
        section: { ...doc().section, headers: { default: "h" } },
        stories: {
          h: {
            kind: "header",
            content: {
              type: "doc",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "One" }] },
                {
                  type: "paragraph",
                  attrs: { indent: { left: 720 } },
                  content: [{ type: "text", text: "Two" }],
                },
              ],
            },
          },
        },
      },
    });
    fakeView(editor, story);
    render(<FoliRuler editor={editor} units="in" />);
    act(() => {
      story.id = "h";
      editor.storyChanged();
    });
    const header = editor.story("h") as Editor;
    await waitFor(() => expect(slider("Left indent").getAttribute("aria-valuenow")).toBe("0"));
    act(() => {
      header.select(7, 7);
    });
    await waitFor(() => expect(slider("Left indent").getAttribute("aria-valuenow")).toBe("0.5"));
    // A change goes to the header's paragraph.
    fireEvent.keyDown(slider("Left indent"), { key: "ArrowRight" });
    expect(header.state.selection.$head.parent.attrs.indent).toEqual({ left: 810 });
  });

  it("adds a tab stop of the selector's kind where the ruler is clicked", async () => {
    const editor = await setup();
    const strip = document.querySelector(".foli-ruler-page") as HTMLElement;
    // 144 px from the left margin is 1440 twips: a left stop at 72 pt.
    fireEvent.pointerDown(strip, { button: 0, pointerId: 1, clientX: 244 + 144 });
    expect(editor.state.selection.$head.parent.attrs.tabs).toEqual([
      { position: 1440, kind: "left" },
    ]);
    const selector = screen.getByRole("button", { name: "Tab stop to add: Left tab" });
    fireEvent.click(selector);
    expect(selector.getAttribute("aria-label")).toBe("Tab stop to add: Center tab");
    fireEvent.pointerDown(strip, { button: 0, pointerId: 1, clientX: 244 + 288 });
    expect(editor.state.selection.$head.parent.attrs.tabs).toEqual([
      { position: 1440, kind: "left" },
      { position: 2880, kind: "center" },
    ]);
    expect(screen.getAllByRole("slider", { name: /tab$/ }).map((s) => s.ariaLabel)).toEqual([
      "Left tab",
      "Center tab",
    ]);
  });

  it("moves a tab stop by dragging it, removes it dragged off or with Delete", async () => {
    const editor = await setup();
    act(() => {
      editor.run(
        setTabStops({
          set: [
            { position: 72, alignment: "left" },
            { position: 144, alignment: "center" },
          ],
        }),
      );
    });
    const tabs = () => editor.state.selection.$head.parent.attrs.tabs;
    await waitFor(() => expect(screen.getAllByRole("slider", { name: /tab$/ })).toHaveLength(2));
    act(() => drag(slider("Left tab"), 388, 388 + 72));
    expect(tabs()).toEqual([
      { position: 2160, kind: "left" },
      { position: 2880, kind: "center" },
    ]);
    // One undo step.
    act(() => {
      editor.commands.undo();
    });
    expect(tabs()).toEqual([
      { position: 1440, kind: "left" },
      { position: 2880, kind: "center" },
    ]);
    await waitFor(() => expect(slider("Left tab").getAttribute("aria-valuenow")).toBe("1"));
    // Let go 100 px below the ruler: gone.
    act(() => drag(slider("Left tab"), 388, 388, false, 100));
    expect(tabs()).toEqual([{ position: 2880, kind: "center" }]);
    fireEvent.keyDown(slider("Center tab"), { key: "Delete" });
    expect(tabs()).toBeNull();
  });

  it("steps a tab stop over another with the keys, the focus on it; Delete focuses the one before", async () => {
    const editor = await setup();
    act(() => {
      editor.run(
        setTabStops({
          set: [
            { position: 72, alignment: "left" },
            { position: 76.5, alignment: "center" },
          ],
        }),
      );
    });
    const tabs = () => editor.state.selection.$head.parent.attrs.tabs;
    await waitFor(() => slider("Center tab"));
    slider("Left tab").focus();
    // 1440 + 90 is the center stop's place: stepped over it, to 1620; now second.
    fireEvent.keyDown(slider("Left tab"), { key: "ArrowRight" });
    expect(tabs()).toEqual([
      { position: 1530, kind: "center" },
      { position: 1620, kind: "left" },
    ]);
    await waitFor(() => expect(document.activeElement?.ariaLabel).toBe("Left tab"));
    fireEvent.keyDown(slider("Left tab"), { key: "Delete" });
    expect(tabs()).toEqual([{ position: 1530, kind: "center" }]);
    await waitFor(() => expect(document.activeElement?.ariaLabel).toBe("Center tab"));
  });

  it("opens the Tabs dialog on a tab stop's double-click", async () => {
    const editor = await setup();
    act(() => {
      editor.run(setTabStops({ set: [{ position: 72, alignment: "left" }] }));
    });
    await waitFor(() => slider("Left tab"));
    let asked: string | null = null;
    const off = editor.subscribe((_state, trs) => {
      for (const tr of trs) asked = requestedDialog(tr) ?? asked;
    });
    fireEvent.doubleClick(slider("Left tab"));
    off();
    expect(asked).toBe("tabs");
  });

  it("drags a table column's border as dragging it in the table does", async () => {
    const cell = (text: string) => ({
      type: "tableCell",
      attrs: { width: { value: 2880, type: "dxa" } },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    const editor = createEditor({
      document: {
        ...doc(),
        content: {
          type: "doc",
          content: [
            {
              type: "table",
              attrs: { grid: [2880, 2880] },
              content: [{ type: "tableRow", content: [cell("A"), cell("B")] }],
            },
            { type: "paragraph" },
          ],
        },
      },
    });
    fakeView(editor);
    act(() => {
      editor.select(4, 4);
    });
    render(<FoliRuler editor={editor} units="in" />);
    const first = await waitFor(() => slider("Column 1 border"));
    expect(first.getAttribute("aria-valuetext")).toBe('2"');
    // The first border half an inch right: the second column gives it.
    act(() => drag(first, 244 + 288, 244 + 288 + 72));
    const grid = () => editor.state.doc.child(0).attrs.grid;
    expect(grid()).toEqual([3600, 2160]);
    act(() => {
      editor.commands.undo();
    });
    expect(grid()).toEqual([2880, 2880]);
    // The last one widens the table, by the keyboard too.
    await waitFor(() => expect(slider("Column 2 border").getAttribute("aria-valuenow")).toBe("2"));
    fireEvent.keyDown(slider("Column 2 border"), { key: "ArrowRight" });
    expect(grid()).toEqual([2880, 2970]);
  });

  it("changes nothing when disabled, and is empty without a view", async () => {
    const editor = await setup({ left: 720 }, true);
    act(() => drag(slider("Left indent"), 316, 416));
    fireEvent.keyDown(slider("Left indent"), { key: "ArrowRight" });
    expect(indentOf(editor)).toEqual({ left: 720 });
    expect(slider("Left indent").getAttribute("aria-disabled")).toBe("true");
    cleanup();
    render(<FoliRuler editor={createEditor({ document: doc() })} />);
    expect(screen.getByRole("group", { name: "Horizontal ruler" }).childElementCount).toBe(0);
  });
});
