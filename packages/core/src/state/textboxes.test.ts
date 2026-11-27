import { describe, expect, it } from "vitest";
import type { NodeJSON } from "../model/index.js";
import { createDocument, type FoliDocument, parseDocument } from "../v3/document.js";
import { createEditor } from "./editor.js";
import { undo } from "./history.js";
import { Selection, TextSelection } from "./selection.js";
import { insertTextBox, selectedTextBox } from "./textboxes.js";
import { StoryStep, wordContext } from "./word.js";
import { copiedDefinitions, fitPaste } from "./wordclip.js";

const box = (story: string, extra: Record<string, unknown> = {}): NodeJSON => ({
  type: "textBox",
  attrs: { story, width: 914_400, height: 457_200, ...extra },
});

const story = (text: string) => ({
  kind: "textBox" as const,
  content: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  },
});

/** A schema 10 document: a paragraph holding a text box, its story `textbox:1`. */
function boxed(): FoliDocument {
  return {
    ...createDocument({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Before " }, box("textbox:1")] },
        { type: "paragraph", content: [{ type: "text", text: "After" }] },
      ],
    }),
    schemaVersion: 10,
    stories: { "textbox:1": story("In the box") },
  };
}

describe("text boxes (schema 10)", () => {
  it("needs schema 10 for a text box, and refuses one in an earlier schema", () => {
    expect(parseDocument(boxed()).schemaVersion).toBe(10);
    expect(() => parseDocument({ ...boxed(), schemaVersion: 9 })).toThrow(
      /a text box is of schema 10 \(the document says schema 9\)/,
    );
    const nodeOnly = { ...boxed(), stories: undefined };
    expect(() => parseDocument({ ...nodeOnly, schemaVersion: 9 })).toThrow(
      /textBox is a schema 10 node \(the document says schema 9\)/,
    );
    // A v9 document without one reads, at schema 9.
    expect(parseDocument({ ...createDocument(), schemaVersion: 9 }).schemaVersion).toBe(5);
  });

  it("takes text boxes in the body, headers and footers only, never one in another", () => {
    const inStory = (kind: string) =>
      parseDocument({
        ...boxed(),
        stories: {
          "textbox:1": story("x"),
          other: {
            kind,
            content: { type: "doc", content: [{ type: "paragraph", content: [box("textbox:1")] }] },
          },
        },
      } as FoliDocument);
    expect(() => inStory("header")).not.toThrow();
    expect(() => inStory("footer")).not.toThrow();
    expect(() => inStory("footnote")).toThrow(/a footnote cannot hold a text box/);
    expect(() => inStory("textBox")).toThrow(/a text box cannot hold a text box/);
    expect(() =>
      parseDocument({
        ...boxed(),
        comments: [{ id: 1, author: "A", content: [{ type: "paragraph", content: [box("x")] }] }],
      }),
    ).toThrow(/a comment cannot hold a text box/);
    expect(() =>
      parseDocument({
        ...boxed(),
        stories: {
          "textbox:1": {
            kind: "textBox",
            content: {
              type: "doc",
              content: [{ type: "paragraph", content: [{ type: "pageBreak" }] }],
            },
          },
        },
      }),
    ).toThrow(/a text box cannot hold a pageBreak/);
  });

  it("refuses a box whose story is not a text box's (a header holding the box again)", () => {
    expect(() =>
      parseDocument({
        ...boxed(),
        stories: {
          "textbox:1": {
            kind: "header",
            content: { type: "doc", content: [{ type: "paragraph", content: [box("textbox:1")] }] },
          },
        },
      }),
    ).toThrow(/a text box's story must be of kind textBox/);
  });

  it("removes a box's story with its node, in one undo step", () => {
    const editor = createEditor({ document: boxed() });
    const pos = 1 + "Before ".length;
    editor.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos, pos + 1)),
    );
    editor.dispatch(editor.state.tr.deleteSelection());
    expect(editor.getDocument().stories?.["textbox:1"]).toBeUndefined();
    editor.run(undo);
    expect(editor.getDocument().stories?.["textbox:1"]?.kind).toBe("textBox");
    // Typing elsewhere leaves it.
    editor.dispatch(editor.state.tr.insertText("x", 1));
    expect(editor.getDocument().stories?.["textbox:1"]?.kind).toBe("textBox");
  });

  it("keeps a story no box showed", () => {
    const doc = boxed();
    doc.stories = { ...doc.stories, "textbox:9": story("orphan") };
    const editor = createEditor({ document: doc });
    editor.dispatch(editor.state.tr.insertText("x", 1));
    expect(editor.getDocument().stories?.["textbox:9"]?.kind).toBe("textBox");
  });

  it("inserts a floating box with its story in one undo step, selected", () => {
    const editor = createEditor({ document: boxed() });
    editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));
    expect(editor.run(insertTextBox())).toBe(true);
    const box = selectedTextBox(editor.state);
    expect(box?.attrs).toMatchObject({
      story: "textbox:2",
      width: 1_828_800,
      height: 914_400,
      fill: "FFFFFF",
      float: { wrap: "square" },
    });
    expect(editor.getDocument().stories?.["textbox:2"]?.kind).toBe("textBox");
    editor.run(undo);
    expect(editor.getDocument().stories?.["textbox:2"]).toBeUndefined();
    expect(selectedTextBox(editor.state)).toBeNull();
    // Not in a story.
    expect(insertTextBox()((editor.story("textbox:1") as typeof editor).state)).toBe(false);
  });

  it("copies a box with its text, pasted as a box of its own", () => {
    const editor = createEditor({ document: boxed() });
    const context = wordContext(editor.state) as NonNullable<ReturnType<typeof wordContext>>;
    const slice = editor.state.doc.cut(0, editor.state.doc.content.size);
    const word = copiedDefinitions(context, slice);
    expect(Object.keys(word.notes ?? {})).toEqual(["textbox:1"]);
    editor.dispatch(
      editor.state.tr.setSelection(Selection.atEnd(editor.state.doc) as TextSelection),
    );
    const fitted = fitPaste(editor.state, JSON.parse(JSON.stringify(slice.toJSON())), word);
    expect(fitted.notes?.map((n) => n.id)).toEqual(["textbox:2"]);
    expect(fitted.notes?.[0]?.story.kind).toBe("textBox");
    expect(fitted.notes?.[0]?.story.doc.textContent).toBe("In the box");
    const tr = editor.state.tr.insert(editor.state.doc.content.size, fitted.doc.content);
    for (const { id, story } of fitted.notes ?? []) tr.step(new StoryStep(id, null, story));
    editor.dispatch(tr);
    expect(Object.keys(editor.getDocument().stories ?? {}).sort()).toEqual([
      "textbox:1",
      "textbox:2",
    ]);
    // Without its text (an HTML copy has none): left out.
    const bare = fitPaste(editor.state, JSON.parse(JSON.stringify(slice.toJSON())), {
      ...word,
      notes: {},
    });
    expect(JSON.stringify(bare.doc.toJSON())).not.toContain("textBox");
  });
});
