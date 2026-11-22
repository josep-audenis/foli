// @vitest-environment jsdom
import { createDocument, createEditor, type NodeJSON, TextSelection } from "@folijs/core";
import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "./view.js";

/** Drops of text (19.6) the target refuses: the dragged text stays where it was. */
const p = (text: string): NodeJSON => ({ type: "paragraph", content: [{ type: "text", text }] });
const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
    view.host.remove();
  }
});

function setup() {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = createEditor({
    document: createDocument({ type: "doc", content: [p("alpha beta gamma"), p("delta")] }),
  });
  const view = new EditorView(host, editor);
  views.push(view);
  return { host, editor, view };
}

/** A DragEvent jsdom can dispatch, with the data and the point given. */
function dragEvent(type: string, data: Record<string, string>) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    dataTransfer: unknown;
    clientX: number;
    clientY: number;
    ctrlKey: boolean;
    altKey: boolean;
  };
  event.dataTransfer = {
    types: Object.keys(data),
    getData: (t: string) => data[t] ?? "",
    setData: (t: string, v: string) => {
      data[t] = v;
    },
    items: [],
    files: [],
    effectAllowed: "all",
    dropEffect: "none",
  };
  Object.assign(event, { clientX: 1, clientY: 1, ctrlKey: false, altKey: false });
  return event;
}

describe("a drop of text", () => {
  it("that the target refuses moves nothing: the dragged text stays (19.6)", () => {
    const { host, editor, view } = setup();
    editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 7, 12)));
    const internals = view as unknown as {
      dragged: unknown;
      posAtPoint: () => number;
      paste: () => boolean;
    };
    internals.dragged = {
      from: 7,
      to: 12,
      doc: editor.state.doc,
      selection: editor.state.selection,
    };
    // A drop in the second paragraph whose paste the target refuses (it says it applied).
    internals.posAtPoint = () => 20;
    internals.paste = () => true;
    host.dispatchEvent(dragEvent("drop", { "text/plain": "beta " }));
    expect(editor.state.doc.textContent).toBe("alpha beta gammadelta");
    expect([editor.state.selection.from, editor.state.selection.to]).toEqual([7, 12]);
  });
});
