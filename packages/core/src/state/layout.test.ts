import { describe, expect, it } from "vitest";
import { createDocument, parseDocument } from "../v3/document.js";
import { createEditor, type Editor } from "./editor.js";
import { undo } from "./history.js";
import {
  croppingAt,
  objectMovesWithText,
  objectPosition,
  objectWrap,
  selectedObject,
  setObjectFloat,
  setObjectLayout,
  setObjectMovesWithText,
  setObjectPosition,
  setObjectSize,
  setObjectWrap,
  toggleCrop,
} from "./layout.js";
import { NodeSelection, TextSelection } from "./selection.js";
import { setTrackChanges } from "./track.js";

/** A paragraph "ab" holding a picture at 2 (inline), selected. */
function pictured(): Editor {
  const editor = createEditor({
    document: parseDocument({
      ...createDocument({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "a" },
              { type: "picture", attrs: { resource: "img", width: 952_500, height: 952_500 } },
              { type: "text", text: "b" },
            ],
          },
        ],
      }),
      resources: { img: { contentType: "image/png", url: "https://example.com/a.png" } },
    }),
  });
  editor.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 2)));
  return editor;
}
const float = (editor: Editor) => selectedObject(editor.state)?.node.attrs.float;
const placement = { left: 196, top: 150, paragraphTop: 100, columnLeft: 96 };

describe("Layout Options (33.4)", () => {
  it("floats an object where it is drawn, wraps it again, puts it back in line", () => {
    const editor = pictured();
    expect(objectWrap(selectedObject(editor.state)?.node as never)).toBe("inline");
    expect(editor.run(setObjectWrap(2, "square", placement))).toBe(true);
    expect(float(editor)).toMatchObject({
      horizontal: { relativeTo: "column", offset: 952_500 },
      vertical: { relativeTo: "paragraph", offset: 476_250 },
      wrap: "square",
      distance: { left: 114_300, right: 114_300 },
    });
    // The object stays selected.
    expect(selectedObject(editor.state)?.pos).toBe(2);
    editor.run(setObjectWrap(2, "behind"));
    expect(float(editor)).toMatchObject({ wrap: "behind", horizontal: { offset: 952_500 } });
    editor.run(setObjectWrap(2, "inline"));
    expect(float(editor) ?? null).toBeNull();
    editor.run(undo);
    expect(float(editor)).toMatchObject({ wrap: "behind" });
  });

  it("moves with its paragraph or stays fixed on the page, where it is drawn", () => {
    const editor = pictured();
    editor.run(setObjectWrap(2, "square", placement));
    const node = () => selectedObject(editor.state)?.node as never;
    expect(objectMovesWithText(node())).toBe(true);
    expect(editor.run(setObjectMovesWithText(2, false, placement))).toBe(true);
    expect(float(editor)).toMatchObject({ vertical: { relativeTo: "page", offset: 1_428_750 } });
    expect(objectMovesWithText(node())).toBe(false);
    editor.run(setObjectMovesWithText(2, true, placement));
    expect(float(editor)).toMatchObject({
      vertical: { relativeTo: "paragraph", offset: 476_250 },
    });
  });

  it("puts it at Word's Position presets, square, against the margins", () => {
    const editor = pictured();
    editor.run(setObjectPosition(2, "topRight"));
    expect(float(editor)).toMatchObject({
      wrap: "square",
      horizontal: { relativeTo: "margin", align: "right" },
      vertical: { relativeTo: "margin", align: "top" },
    });
    expect(objectPosition(selectedObject(editor.state)?.node as never)).toBe("topRight");
  });

  it("sets the Layout dialog's values", () => {
    const editor = pictured();
    expect(editor.run(setObjectLayout(2, { side: "left" }))).toBe(false); // in line
    editor.run(setObjectWrap(2, "square"));
    editor.run(
      setObjectLayout(2, {
        horizontal: { relativeTo: "page", offset: 12.4 },
        side: "left",
        distance: { top: 12_700, left: -5 },
        allowOverlap: false,
      }),
    );
    expect(float(editor)).toMatchObject({
      horizontal: { relativeTo: "page", offset: 12 },
      side: "left",
      distance: { top: 12_700, left: 0, right: 114_300 },
      allowOverlap: false,
    });
  });

  it("changes nothing while tracking", () => {
    const editor = pictured();
    editor.run(setTrackChanges(true));
    expect(editor.run(setObjectWrap(2, "square"))).toBe(false);
  });

  it("sets a whole layout from the dialog in one step, or puts it in line", () => {
    const editor = pictured();
    expect(
      editor.run(
        setObjectFloat(2, {
          horizontal: { relativeTo: "page", offset: 914_400.4 },
          vertical: { relativeTo: "margin", align: "bottom" },
          wrap: "tight",
          side: "largest",
          distance: { left: 0, right: -3 },
        }),
      ),
    ).toBe(true);
    expect(float(editor)).toEqual({
      horizontal: { relativeTo: "page", offset: 914_400 },
      vertical: { relativeTo: "margin", align: "bottom" },
      wrap: "tight",
      side: "largest",
      distance: { top: 0, bottom: 0, left: 0, right: 0 },
      allowOverlap: true,
      layoutInCell: true,
    });
    editor.run(setObjectFloat(2, null));
    expect(float(editor) ?? null).toBeNull();
    editor.run(undo);
    expect(float(editor)).toMatchObject({ wrap: "tight" });
  });

  it("sizes a picture, its rotation with it, and a float with a size in one step (33.5)", () => {
    const editor = pictured();
    const node = () => selectedObject(editor.state)?.node;
    expect(editor.run(setObjectSize(2, 1_905_000, 952_500, 5_400_000))).toBe(true);
    expect(node()?.attrs).toMatchObject({ width: 1_905_000, height: 952_500, rotation: 5_400_000 });
    expect(editor.run(setObjectSize(2, 1_905_000, 952_500))).toBe(false);
    expect(editor.run(setObjectSize(2, 0, 1))).toBe(false);
    editor.run(
      setObjectFloat(
        2,
        {
          horizontal: { relativeTo: "column", offset: 0 },
          vertical: { relativeTo: "paragraph", offset: 0 },
          wrap: "square",
        },
        { width: 100, height: 200 },
      ),
    );
    expect(node()?.attrs).toMatchObject({ width: 100, height: 200, float: { wrap: "square" } });
    editor.run(undo);
    expect(node()?.attrs.width).toBe(1_905_000);
  });

  it("turns crop mode on for the selected picture, off when it is no longer selected", () => {
    const editor = pictured();
    expect(croppingAt(editor.state)).toBeNull();
    expect(editor.run(toggleCrop)).toBe(true);
    expect(croppingAt(editor.state)).toBe(2);
    editor.run(toggleCrop);
    expect(croppingAt(editor.state)).toBeNull();
    editor.run(toggleCrop);
    editor.dispatch(editor.state.tr.insertText("x", 1));
    // Still selected, its position mapped.
    expect(croppingAt(editor.state)).toBe(selectedObject(editor.state)?.pos ?? -1);
    editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
    expect(croppingAt(editor.state)).toBeNull();
  });

  it("leaves crop mode when tracking starts; a rotated picture is cropped in the dialog", () => {
    const editor = pictured();
    editor.run(toggleCrop);
    editor.run(setTrackChanges(true));
    expect(croppingAt(editor.state)).toBeNull();
    editor.run(setTrackChanges(false));
    editor.run(setObjectSize(2, 952_500, 952_500, 5_400_000));
    expect(toggleCrop(editor.state)).toBe(false);
  });
});
