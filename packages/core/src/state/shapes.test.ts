import { describe, expect, it } from "vitest";
import type { NodeJSON } from "../model/index.js";
import { createDocument, type FoliDocument, parseDocument } from "../v3/document.js";
import { createEditor } from "./editor.js";
import { undo } from "./history.js";
import { selectedObject, setObjectSize } from "./layout.js";
import { NodeSelection, Selection, TextSelection } from "./selection.js";
import { insertShape } from "./shapes.js";
import { StoryStep, wordContext } from "./word.js";
import { copiedDefinitions, fitPaste } from "./wordclip.js";

const shape = (attrs: Record<string, unknown> = {}): NodeJSON => ({
  type: "shape",
  attrs: { geometry: "ellipse", width: 914_400, height: 457_200, fill: "4472C4", ...attrs },
});

const story = (text: string) => ({
  kind: "textBox" as const,
  content: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  },
});

/** A schema 11 document: a shape holding text (`textbox:1`) and one without. */
function shaped(): FoliDocument {
  return {
    ...createDocument({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Before " }, shape({ story: "textbox:1" })],
        },
        { type: "paragraph", content: [shape({ geometry: "rightArrow" })] },
      ],
    }),
    schemaVersion: 11,
    stories: { "textbox:1": story("In the shape") },
  };
}

describe("shapes (schema 11)", () => {
  it("needs schema 11 for a shape, and refuses one in an earlier schema", () => {
    expect(parseDocument(shaped()).schemaVersion).toBe(11);
    expect(() => parseDocument({ ...shaped(), schemaVersion: 10 })).toThrow(
      /shape is a schema 11 node \(the document says schema 10\)/,
    );
    expect(() => parseDocument({ ...shaped(), stories: undefined, schemaVersion: 9 })).toThrow(
      /shape is a schema 11 node \(the document says schema 9\)/,
    );
    // v10 → v11 is the version only: a v10 document reads as it was.
    expect(parseDocument({ ...createDocument(), schemaVersion: 10 }).schemaVersion).toBe(5);
  });

  it("checks a shape's geometry, adjust values, custom paths, gradient and line", () => {
    const withShape = (attrs: Record<string, unknown>) => () =>
      parseDocument({
        ...createDocument({
          type: "doc",
          content: [{ type: "paragraph", content: [shape(attrs)] }],
        }),
        schemaVersion: 11,
      });
    expect(withShape({ adjust: { adj: 25_000 }, rotation: 5_400_000, flipH: true })).not.toThrow();
    expect(withShape({ geometry: "not a token" })).toThrow(/geometry/);
    // Only DrawingML's names, its dashes, two gradient stops at least, a command's arguments.
    expect(withShape({ geometry: "circle" })).toThrow(/geometry/);
    expect(withShape({ outline: { color: "000000", width: 1, dash: "dotted" } })).toThrow(/dash/);
    expect(withShape({ gradient: { stops: [{ position: 0, color: "FFFFFF" }] } })).toThrow(
      /at least 2 stops/,
    );
    expect(withShape({ custom: { paths: [{ commands: [{ op: "M", args: [] }] }] } })).toThrow(
      /M takes 2 arguments/,
    );
    expect(withShape({ adjust: { adj: 1.5 } })).toThrow(/adj must be an integer/);
    expect(
      withShape({
        geometry: "custom",
        custom: {
          guides: [{ name: "x1", formula: "*/ w 1 2" }],
          paths: [
            { width: 10, height: 10, commands: [{ op: "M", args: ["0", "x1"] }, { op: "Z" }] },
          ],
        },
      }),
    ).not.toThrow();
    expect(withShape({ custom: { paths: [{ commands: [{ op: "X" }] }] } })).toThrow(/op/);
    expect(
      withShape({
        gradient: {
          stops: [
            { position: 0, color: "FFFFFF" },
            { position: 100_000, color: "000000" },
          ],
          angle: 5_400_000,
        },
        outline: {
          color: "000000",
          width: 12_700,
          dash: "sysDot",
          head: { type: "triangle", width: "lg" },
        },
      }),
    ).not.toThrow();
    expect(
      withShape({
        gradient: {
          stops: [
            { position: 200_000, color: "FFFFFF" },
            { position: 0, color: "FFFFFF" },
          ],
        },
      }),
    ).toThrow(/position/);
    expect(withShape({ outline: { color: "000000", width: 1, head: { type: "barb" } } })).toThrow(
      /type/,
    );
  });

  it("takes shapes in the body, headers and footers only; its story is a text box's", () => {
    const inStory = (kind: string) =>
      parseDocument({
        ...shaped(),
        stories: {
          "textbox:1": story("x"),
          other: {
            kind,
            content: { type: "doc", content: [{ type: "paragraph", content: [shape()] }] },
          },
        },
      } as FoliDocument);
    expect(() => inStory("header")).not.toThrow();
    expect(() => inStory("endnote")).toThrow(/an? endnote cannot hold a shape/);
    expect(() => inStory("textBox")).toThrow(/a text box cannot hold a shape/);
    expect(() =>
      parseDocument({
        ...shaped(),
        stories: { "textbox:1": { ...story("x"), kind: "header" } },
      } as FoliDocument),
    ).toThrow(/a shape's story must be of kind textBox/);
  });

  it("removes a shape's text with the shape, in one undo step", () => {
    const editor = createEditor({ document: shaped() });
    const pos = 1 + "Before ".length;
    editor.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos, pos + 1)),
    );
    editor.dispatch(editor.state.tr.deleteSelection());
    expect(editor.getDocument().stories?.["textbox:1"]).toBeUndefined();
    editor.run(undo);
    expect(editor.getDocument().stories?.["textbox:1"]?.kind).toBe("textBox");
  });

  it("is an object Layout Options and Size work on, turned with its size", () => {
    const editor = createEditor({ document: shaped() });
    const pos = 1 + "Before ".length;
    editor.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
    expect(selectedObject(editor.state)?.node.type.name).toBe("shape");
    expect(editor.run(setObjectSize(pos, 1_000_000, 500_000, 2_700_000))).toBe(true);
    expect(editor.state.doc.nodeAt(pos)?.attrs).toMatchObject({
      width: 1_000_000,
      height: 500_000,
      rotation: 2_700_000,
    });
  });

  it("leaves a shape out of what is pasted into a story, the text kept", () => {
    const editor = createEditor({ document: shaped() });
    const context = wordContext(editor.state) as NonNullable<ReturnType<typeof wordContext>>;
    const slice = editor.state.doc.cut(0, editor.state.doc.content.size);
    const word = copiedDefinitions(context, slice);
    const box = editor.story("textbox:1") as typeof editor;
    const fitted = fitPaste(box.state, JSON.parse(JSON.stringify(slice.toJSON())), word);
    const json = JSON.stringify(fitted.doc.toJSON());
    expect(json).not.toContain('"shape"');
    expect(json).toContain("Before");
  });

  it("copies a shape with its text, pasted as a shape of its own", () => {
    const editor = createEditor({ document: shaped() });
    const context = wordContext(editor.state) as NonNullable<ReturnType<typeof wordContext>>;
    const slice = editor.state.doc.cut(0, editor.state.doc.content.size);
    const word = copiedDefinitions(context, slice);
    expect(Object.keys(word.notes ?? {})).toEqual(["textbox:1"]);
    editor.dispatch(
      editor.state.tr.setSelection(Selection.atEnd(editor.state.doc) as TextSelection),
    );
    const fitted = fitPaste(editor.state, JSON.parse(JSON.stringify(slice.toJSON())), word);
    expect(fitted.notes?.map((n) => n.id)).toEqual(["textbox:2"]);
    const tr = editor.state.tr.insert(editor.state.doc.content.size, fitted.doc.content);
    for (const { id, story } of fitted.notes ?? []) tr.step(new StoryStep(id, null, story));
    editor.dispatch(tr);
    expect(Object.keys(editor.getDocument().stories ?? {}).sort()).toEqual([
      "textbox:1",
      "textbox:2",
    ]);
  });

  it("inserts a shape in front of the text with the theme's accent, selected, one undo step", () => {
    const editor = createEditor({ document: shaped() });
    const before = editor.getDocument();
    editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));
    expect(
      editor.run(
        insertShape("star5", {
          width: 914_400,
          height: 457_200,
          horizontal: 9525,
          vertical: -19_050,
        }),
      ),
    ).toBe(true);
    const shape = selectedObject(editor.state)?.node;
    expect(shape?.attrs).toMatchObject({
      geometry: "star5",
      width: 914_400,
      height: 457_200,
      fill: "156082",
      outline: { color: "030E13", width: 12_700 },
      float: {
        wrap: "inFront",
        horizontal: { relativeTo: "column", offset: 9525 },
        vertical: { relativeTo: "paragraph", offset: -19_050 },
      },
    });
    editor.run(undo);
    expect(editor.getDocument()).toEqual(before);
    // A line: no fill, the accent's line; an arrow with its end; mirrored when drawn backwards.
    expect(editor.run(insertShape("straightConnector1", { flipH: true }))).toBe(true);
    expect(selectedObject(editor.state)?.node.attrs).toMatchObject({
      fill: null,
      flipH: true,
      outline: { color: "156082", width: 6350, tail: { type: "triangle" } },
    });
    // Not a DrawingML preset; not in a story.
    expect(insertShape("circle")(editor.state)).toBe(false);
    expect(insertShape("rect")((editor.story("textbox:1") as typeof editor).state)).toBe(false);
  });
});
