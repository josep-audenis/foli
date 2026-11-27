import { describe, expect, it } from "vitest";
import { createDocument, parseDocument } from "../v3/document.js";
import { createEditor, type Editor } from "./editor.js";
import { undo } from "./history.js";
import {
  objectMovesWithText,
  objectPosition,
  objectWrap,
  selectedObject,
  setObjectLayout,
  setObjectMovesWithText,
  setObjectPosition,
  setObjectWrap,
} from "./layout.js";
import { NodeSelection } from "./selection.js";
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
});
