import { describe, expect, it } from "vitest";
import type { NodeJSON } from "../model/index.js";
import type { FoliDocument, SectionJSON } from "../v3/document.js";
import { createDocument, SCHEMA_VERSION } from "../v3/document.js";
import { addComment, deleteAllComments, deleteComment } from "./comments.js";
import { createEditor, type Editor } from "./editor.js";
import { closeHistory, redoDepth, undo, undoDepth } from "./history.js";
import { acceptAllChanges, rejectAllChanges } from "./review.js";
import {
  documentSections,
  ensureStory,
  insertSectionBreak,
  pageVariant,
  setDifferentEvenPages,
  setDifferentFirstPage,
  setStoryLinked,
  storyOfSection,
} from "./sections.js";
import { Plugin, PluginKey } from "./state.js";
import { StoryStep, withEnvelope, wordContext } from "./word.js";

const p = (text: string, attrs?: Record<string, unknown>): NodeJSON => ({
  type: "paragraph",
  ...(attrs ? { attrs } : {}),
  ...(text ? { content: [{ type: "text", text }] } : {}),
});
const docOf = (...content: NodeJSON[]): NodeJSON => ({ type: "doc", content });

function documentOf(section: SectionJSON = { headers: { default: "h1" } }): FoliDocument {
  return {
    ...createDocument(),
    schemaVersion: SCHEMA_VERSION,
    section,
    content: docOf(p("body")),
    stories: {
      h1: { kind: "header", content: docOf(p("head")) },
      f1: { kind: "footer", content: docOf(p("foot")) },
    },
  };
}

const textOf = (editor: Editor) => editor.state.doc.textContent;
const story = (editor: Editor, id = "h1") => editor.story(id) as Editor;
const stored = (editor: Editor, id = "h1") =>
  JSON.stringify(editor.getDocument().stories?.[id]?.content);

describe("editing a story", () => {
  it("goes through the body: the envelope, undo and redo follow", () => {
    const editor = createEditor({ document: documentOf() });
    const head = story(editor);
    expect(head).toBe(editor.story("h1"));
    expect(editor.story("nope")).toBeNull();
    head.select(5);
    head.commands.insertText("er");
    expect(textOf(head)).toBe("header");
    expect(stored(editor)).toContain("header");
    expect(textOf(editor)).toBe("body");
    expect(undoDepth(editor.state)).toBe(1);
    expect(undoDepth(head.state)).toBe(1);

    expect(head.commands.undo()).toBe(true);
    expect(textOf(head)).toBe("head");
    expect(stored(editor)).toContain('"head"');
    expect(head.state.selection.from).toBe(5);
    expect(redoDepth(head.state)).toBe(1);
    editor.commands.redo();
    expect(textOf(head)).toBe("header");
    expect(head.state.selection.from).toBe(7);
  });

  it("is one history across the document, in the order of the changes", () => {
    const editor = createEditor({ document: documentOf() });
    const head = story(editor);
    editor.select(5);
    editor.commands.insertText("1");
    head.select(5);
    head.commands.insertText("2");
    editor.commands.insertText("3");
    editor.commands.undo();
    expect([textOf(editor), textOf(head)]).toEqual(["body1", "head2"]);
    editor.commands.undo();
    expect([textOf(editor), textOf(head)]).toEqual(["body1", "head"]);
    editor.commands.undo();
    expect([textOf(editor), textOf(head)]).toEqual(["body", "head"]);
  });

  it("groups typing as the body does: one step, the depth not used up", () => {
    const editor = createEditor({ document: documentOf() });
    const head = story(editor);
    head.select(5);
    for (const ch of "abc") head.commands.insertText(ch);
    expect(undoDepth(editor.state)).toBe(1);
    head.commands.undo();
    expect(textOf(head)).toBe("head");
    expect(head.commands.undo()).toBe(false);
  });

  it("does not join typing in two stories, or apart in one, or a closed change", () => {
    const editor = createEditor({ document: documentOf() });
    const head = story(editor);
    const foot = story(editor, "f1");
    head.select(5);
    head.commands.insertText("a");
    foot.select(5);
    foot.commands.insertText("b");
    head.select(1);
    head.commands.insertText("c");
    expect(undoDepth(editor.state)).toBe(3);
    head.dispatch(head.state.tr.insertText("d", 1, 1).setMeta(closeHistory, true));
    expect(undoDepth(editor.state)).toBe(4);
  });

  it("keeps what the body refuses out of the story", () => {
    const editor = createEditor({
      document: documentOf(),
      plugins: [],
    });
    const head = story(editor);
    head.select(2);
    const seen: string[] = [];
    head.subscribe((state) => seen.push(state.doc.textContent));
    // A comment and a section break cannot be in a story.
    expect(head.run(addComment([{ type: "paragraph" }] as never))).toBe(false);
    expect(head.run(insertSectionBreak())).toBe(false);
    const { state } = head;
    head.dispatch(
      state.tr.setNodeMarkup(0, state.doc.child(0).type, {
        ...state.doc.child(0).attrs,
        section: { titlePage: true },
      }),
    );
    expect(head.state).toBe(state);
    expect(seen).toEqual([]);
  });

  it("takes a change from the body (undo, a second editor) with its selection", () => {
    const editor = createEditor({ document: documentOf() });
    const head = story(editor);
    head.select(3);
    head.commands.insertText("X");
    head.select(1);
    let notified = 0;
    head.subscribe(() => notified++);
    editor.commands.undo();
    expect(textOf(head)).toBe("head");
    expect(head.state.selection.from).toBe(3);
    expect(notified).toBe(1);
  });

  it("maps an undo over a change of its story made outside history (22.4)", () => {
    const editor = createEditor({ document: documentOf() });
    const head = story(editor);
    head.select(5);
    editor.select(1);
    editor.commands.insertText("b");
    head.commands.insertText("!");
    head.dispatch(head.state.tr.insertText("?", 6, 6).setMeta("addToHistory", false));
    const depth = undoDepth(editor.state);
    expect(editor.commands.undo()).toBe(true);
    expect(textOf(head)).toBe("head?");
    expect(undoDepth(editor.state)).toBe(depth - 1);
    expect(redoDepth(editor.state)).toBe(1);
    // The older event still applies.
    editor.commands.undo();
    expect(textOf(editor)).toBe("body");
  });

  it("hoists a story's envelope change as steps, which undo takes back with its edit", () => {
    const editor = createEditor({ document: documentOf() });
    const head = story(editor);
    const envelope = wordContext(head.state)?.envelope as NonNullable<
      ReturnType<typeof wordContext>
    >["envelope"];
    const styles = [...envelope.styles, { id: "New", type: "paragraph" as const, name: "New" }];
    head.dispatch(
      withEnvelope(head.state.tr.insertText("x", 1, 1), {
        ...envelope,
        styles,
        section: { titlePage: true },
      }),
    );
    const next = wordContext(editor.state)?.envelope;
    expect(next?.styles.at(-1)?.id).toBe("New");
    expect(next?.section.titlePage).toBe(true);
    expect(wordContext(head.state)).toBe(wordContext(editor.state));
    editor.commands.undo();
    const undone = wordContext(editor.state)?.envelope;
    expect(undone?.styles.at(-1)?.id).not.toBe("New");
    expect(undone?.section.titlePage).toBeUndefined();
  });

  it("tracks across trees: one on switch, ids not reused, accept and reject reach stories", () => {
    const editor = createEditor({ document: documentOf(), author: "Ann" });
    const head = story(editor);
    head.commands.setTrackChanges(true);
    expect(editor.trackingChanges).toBe(true);
    editor.commands.setTrackChanges(false);
    expect(head.trackingChanges).toBe(false);
    editor.commands.setTrackChanges(true);
    expect(head.trackingChanges).toBe(true);
    editor.select(5);
    editor.commands.insertText("B");
    head.select(5);
    head.commands.insertText("H");
    const ids: number[] = [];
    const collect = (node: typeof editor.state.doc) =>
      node.descendants((n) => {
        for (const m of n.marks) if (m.type.name === "insertion") ids.push(m.attrs.id as number);
        return true;
      });
    collect(editor.state.doc);
    collect(head.state.doc);
    expect(new Set(ids).size).toBe(2);

    expect(head.commands.rejectAllChanges()).toBe(true);
    expect([textOf(editor), textOf(head)]).toEqual(["body", "head"]);
    editor.commands.undo();
    expect([textOf(editor), textOf(head)]).toEqual(["bodyB", "headH"]);
    expect(editor.run(acceptAllChanges())).toBe(true);
    expect(stored(editor)).not.toContain("insertion");
    expect(editor.run(rejectAllChanges())).toBe(false);
  });

  it("is told when its story goes, and when the document does", () => {
    const editor = createEditor({ document: documentOf() });
    const head = story(editor);
    const before = wordContext(editor.state)?.stories.get("h1") ?? null;
    editor.dispatch(editor.state.tr.step(new StoryStep("h1", before, null)));
    expect(editor.story("h1")).toBeNull();
    const { state } = head;
    head.commands.insertText("x");
    expect(head.state).toBe(state);
    editor.commands.undo();
    expect(textOf(story(editor))).toBe("head");
    const again = story(editor);
    editor.setDocument(documentOf({}));
    expect(editor.story("h1")).not.toBe(again);
  });
});

describe("what a story's editor leaves to the body", () => {
  it("deletes comments with their anchors, which are in the body", () => {
    const anchored: FoliDocument = {
      ...documentOf(),
      comments: [{ id: 1, author: "A", content: [p("note")] }],
      content: docOf({
        type: "paragraph",
        content: [
          { type: "commentStart", attrs: { id: 1 } },
          { type: "text", text: "body" },
          { type: "commentEnd", attrs: { id: 1 } },
        ],
      }),
    };
    for (const remove of [deleteComment(1), deleteAllComments]) {
      const editor = createEditor({ document: anchored });
      expect(story(editor).run(remove)).toBe(true);
      expect(editor.getDocument().comments).toEqual([]);
      expect(JSON.stringify(editor.getDocument().content)).not.toContain("comment");
    }
  });

  it("keeps the state of the editor's plugins across typing and undo", () => {
    let made = 0;
    const key = new PluginKey<number>("count");
    const counting = new Plugin<number>({
      key,
      state: {
        init: () => {
          made++;
          return 0;
        },
        apply: (tr, value) => (tr.docChanged ? value + 1 : value),
      },
    });
    const editor = createEditor({ document: documentOf(), plugins: [counting] });
    const head = story(editor);
    made = 0;
    head.select(5);
    head.commands.insertText("a");
    head.commands.insertText("b");
    expect(key.getState(head.state)).toBe(2);
    head.commands.undo();
    expect(key.getState(head.state)).toBe(2);
    expect(made).toBe(0);
  });
});

describe("headers and footers of sections", () => {
  const twoSections = (first: SectionJSON, last: SectionJSON = {}): FoliDocument => ({
    ...documentOf(last),
    content: docOf(p("one", { section: first }), p("two")),
  });
  const sectionsOf = (editor: Editor) => documentSections(editor.state).map((s) => s.setup);

  it("finds a section's story, its own or the previous one's", () => {
    const sections: SectionJSON[] = [
      { headers: { default: "a", first: "b" } },
      {},
      { headers: { default: "c" } },
    ];
    expect(storyOfSection(sections, 1, "header", "default")?.id).toBe("a");
    expect(storyOfSection(sections, 2, "header", "default")?.id).toBe("c");
    expect(storyOfSection(sections, 2, "header", "first")?.id).toBe("b");
    expect(storyOfSection(sections, 2, "footer", "default")).toBeNull();
  });

  it("picks the variant of a page", () => {
    expect(pageVariant({ titlePage: true }, { first: true, number: 2 }, true)).toBe("first");
    expect(pageVariant({ titlePage: true }, { first: false, number: 2 }, true)).toBe("even");
    expect(pageVariant({}, { first: true, number: 2 }, false)).toBe("default");
    expect(pageVariant({}, { first: false, number: 3 }, true)).toBe("default");
  });

  it("unlinks with a copy and links again, one undo step each", () => {
    const editor = createEditor({ document: twoSections({ headers: { default: "h1" } }) });
    editor.select(6);
    expect(editor.can(setStoryLinked("header", "default", true))).toBe(false);
    expect(editor.run(setStoryLinked("header", "default", false))).toBe(true);
    const id = sectionsOf(editor)[1]?.headers?.default as string;
    expect(id).not.toBe("h1");
    expect(textOf(story(editor, id))).toBe("head");
    story(editor, id).commands.insertText("X");
    expect(textOf(story(editor))).toBe("head");

    expect(editor.run(setStoryLinked("header", "default", true, 1))).toBe(true);
    expect(sectionsOf(editor)[1]?.headers).toBeUndefined();
    expect(editor.story(id)).toBeNull();
    editor.commands.undo();
    expect(sectionsOf(editor)[1]?.headers?.default).toBe(id);
    expect(textOf(story(editor, id))).toBe("Xhead");
    // The first section has nothing to link to.
    expect(editor.can(setStoryLinked("header", "default", true, 0))).toBe(false);
  });

  it("keeps a story another variant of the section still shows", () => {
    const editor = createEditor({
      document: twoSections({}, { headers: { default: "h1", first: "h1" } }),
    });
    expect(editor.run(setStoryLinked("header", "default", true, 1))).toBe(true);
    expect(sectionsOf(editor)[1]?.headers).toEqual({ first: "h1" });
    expect(textOf(story(editor))).toBe("head");
  });

  it("gives an unlinked copy no bookmarks, and never an id used before", () => {
    const marked: FoliDocument = {
      ...twoSections({ headers: { default: "h1" } }),
      stories: {
        h1: {
          kind: "header",
          content: docOf({
            type: "paragraph",
            content: [
              { type: "bookmarkStart", attrs: { id: 7, name: "here" } },
              { type: "text", text: "head" },
              { type: "bookmarkEnd", attrs: { id: 7 } },
            ],
          }),
        },
      },
    };
    const editor = createEditor({ document: marked });
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      editor.run(setStoryLinked("header", "default", false, 1));
      const id = sectionsOf(editor)[1]?.headers?.default as string;
      expect(ids.has(id)).toBe(false);
      ids.add(id);
      expect(textOf(story(editor, id))).toBe("head");
      expect(JSON.stringify(editor.getDocument().stories?.[id])).not.toContain("bookmark");
      editor.run(setStoryLinked("header", "default", true, 1));
    }
    expect(JSON.stringify(editor.getDocument().stories?.h1)).toContain("bookmarkStart");
  });

  it("adds a missing story to the first section, once", () => {
    const editor = createEditor({ document: twoSections({}) });
    expect(editor.run(ensureStory("footer", "first", 1))).toBe(true);
    const id = sectionsOf(editor)[0]?.footers?.first as string;
    expect(story(editor, id).state.doc.childCount).toBe(1);
    expect(editor.getDocument().stories?.[id]?.kind).toBe("footer");
    expect(editor.can(ensureStory("footer", "first", 1))).toBe(false);
    editor.commands.undo();
    expect(sectionsOf(editor)[0]?.footers).toBeUndefined();
    expect(editor.story(id)).toBeNull();
  });

  it("switches first and even pages, undoably, from a story's editor too", () => {
    const editor = createEditor({ document: documentOf() });
    const head = story(editor);
    expect(head.run(setDifferentFirstPage(true, 0))).toBe(true);
    expect(editor.getDocument().section.titlePage).toBe(true);
    expect(head.run(setDifferentEvenPages(true))).toBe(true);
    expect(editor.getDocument().settings?.evenAndOddHeaders).toBe(true);
    expect(editor.can(setDifferentEvenPages(true))).toBe(false);
    head.run(undo);
    expect(editor.getDocument().settings).toBeUndefined();
    head.run(undo);
    expect(editor.getDocument().section.titlePage).toBeUndefined();
  });
});
