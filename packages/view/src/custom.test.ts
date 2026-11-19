// @vitest-environment jsdom
import { createDocument, createEditor, type Extension, type NodeJSON } from "@folijs/core";
import { afterEach, describe, expect, it } from "vitest";
import { FOLI_MIME } from "./clipboard.js";
import { EditorView } from "./view.js";

// ADR-0008 in the view: custom and foreign nodes drawn from their text, and carried through the
// clipboard's JSON and HTML (some browsers paste only the HTML).
const acme: Extension = {
  name: "acme",
  nodes: {
    "acme:mention": {
      inline: true,
      attrs: { id: {}, label: {} },
      text: (attrs) => `@${String(attrs.label)}`,
    },
    "acme:card": { attrs: { id: {} }, text: (attrs) => `Card ${String(attrs.id)}` },
  },
  marks: { "acme:topic": { attrs: { topic: {} }, inclusive: false } },
};
const topic = { type: "acme:topic", attrs: { topic: "finance" } };
const content: NodeJSON[] = [
  {
    type: "paragraph",
    content: [
      { type: "text", text: "Ask " },
      { type: "acme:mention", attrs: { id: "u-1", label: "Ada" } },
      { type: "text", text: " about the " },
      { type: "text", text: "budget", marks: [topic] },
    ],
  },
  { type: "acme:card", attrs: { id: "c-1" } },
  { type: "paragraph" },
];

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
    view.host.remove();
  }
});

function mount(blocks: NodeJSON[], extensions?: Extension[]) {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = createEditor({
    document: createDocument({ type: "doc", content: blocks }),
    ...(extensions ? { extensions } : {}),
  });
  const view = new EditorView(host, editor);
  views.push(view);
  return { host, editor, view };
}

function copyAll(view: EditorView, host: HTMLElement): Record<string, string> {
  view.editor.commands.selectAll();
  const store = new Map<string, string>();
  const event = new Event("copy", { cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", {
    value: { setData: (k: string, v: string) => store.set(k, v), getData: () => "" },
  });
  host.dispatchEvent(event);
  return Object.fromEntries(store);
}
const data = (types: Record<string, string>) => ({ getData: (type: string) => types[type] ?? "" });

describe("custom nodes and marks in the view (ADR-0008)", () => {
  it("draws custom and foreign nodes from their text", () => {
    const withExt = mount(content, [acme]);
    expect(withExt.host.querySelector("[data-foli-custom='acme:mention']")?.textContent).toBe(
      "@Ada",
    );
    expect(withExt.host.querySelector("[data-foli-custom='acme:card']")?.textContent).toBe(
      "Card c-1",
    );
    const without = mount(content);
    expect(without.host.querySelector("[data-foli-custom='acme:mention']")?.textContent).toBe(
      "[acme:mention]",
    );
  });

  it("copies their text as plain text, and pastes them back from the JSON or the HTML alone", () => {
    const source = mount(content, [acme]);
    const copied = copyAll(source.view, source.host);
    expect(copied["text/plain"]).toBe("Ask @Ada about the budget\nCard c-1\n");
    expect(copied["text/html"]).toContain("data-foli-clipboard");
    for (const types of [copied, { "text/html": copied["text/html"] ?? "" }]) {
      for (const extensions of [[acme], undefined]) {
        const target = mount([{ type: "paragraph" }], extensions);
        target.view.paste(data(types));
        expect(target.editor.getDocument().content.content).toEqual(content);
      }
    }
    // A Foli copy inside other HTML (an email quoting it): read as HTML, the text around it kept.
    const quoted = mount([{ type: "paragraph" }], [acme]);
    quoted.view.paste(
      data({ "text/html": `<p>Before</p>${copied["text/html"] ?? ""}<!-- c --> <p>After</p>` }),
    );
    const text = JSON.stringify(quoted.editor.getDocument().content);
    expect(text).toContain("Before");
    expect(text).toContain("After");
    expect(text).toContain("@Ada");
    expect(text).not.toContain("acme:");
    // Whitespace and comments around the wrapper (as browsers add them) do not count.
    const wrapped = mount([{ type: "paragraph" }], [acme]);
    wrapped.view.paste(
      data({
        "text/html": `<html><body>
<!--StartFragment-->${copied["text/html"]}<!--EndFragment-->
</body></html>`,
      }),
    );
    expect(wrapped.editor.getDocument().content.content).toEqual(content);
    // HTML without custom content stays as it was: no JSON in it.
    const plain = mount([{ type: "paragraph", content: [{ type: "text", text: "x" }] }]);
    expect(copyAll(plain.view, plain.host)["text/html"]).not.toContain("data-foli-clipboard");
    expect(JSON.parse(copied[FOLI_MIME] ?? "").content.content[1].type).toBe("acme:card");
  });
});
