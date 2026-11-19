// @vitest-environment jsdom
import {
  createDocument,
  createEditor,
  type EditorState,
  type NodeJSON,
  Plugin,
  PluginKey,
} from "@folijs/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  type Decoration,
  decorationsByBlock,
  nodeViewDOM,
  type ViewExtension,
} from "./extension.js";
import { EditorView } from "./view.js";

// The view's side of extensions (ADR-0008, 12.4): node views, mark views, decorations and plugin
// views.
const content: NodeJSON[] = [
  {
    type: "paragraph",
    content: [
      { type: "text", text: "Ask " },
      { type: "acme:mention", attrs: { id: "u-1", label: "Ada" } },
      { type: "text", text: " about the " },
      { type: "text", text: "budget", marks: [{ type: "acme:topic", attrs: { topic: "fin" } }] },
    ],
  },
  { type: "acme:card", attrs: { id: "c-1" } },
  { type: "paragraph", content: [{ type: "text", text: "Last" }] },
];

/** Decorations kept in plugin state, set by a transaction's meta. */
const decorationKey = new PluginKey<readonly Decoration[]>("acme-decorations");
const decorationPlugin = new Plugin<readonly Decoration[]>({
  key: decorationKey,
  state: {
    init: () => [],
    apply: (tr, value) => (tr.getMeta(decorationKey) as readonly Decoration[] | undefined) ?? value,
  },
});

const log: string[] = [];
const acme: ViewExtension = {
  name: "acme",
  nodes: {
    "acme:mention": { inline: true, attrs: { id: {}, label: {} }, text: (a) => `@${a.label}` },
    "acme:card": { attrs: { id: {} }, text: (a) => `Card ${a.id}` },
  },
  marks: { "acme:topic": { attrs: { topic: {} }, inclusive: false } },
  plugins: [decorationPlugin],
  nodeViews: {
    "acme:mention": {
      render: (node, { h }) =>
        h("span", { class: "chip", title: String(node.attrs.id) }, "@", String(node.attrs.label)),
    },
    "acme:card": {
      render: (node, { h }) => h("div", { class: "card" }, h("p", null, `Card ${node.attrs.id}`)),
    },
  },
  markViews: {
    "acme:topic": (mark) => ({ class: "topic", "data-topic": String(mark.attrs.topic) }),
  },
  decorations: (state) => decorationKey.getState(state) ?? [],
  view(view) {
    log.push(`mount ${view.host.isConnected}`);
    return {
      update(_, previous: EditorState) {
        log.push(`update ${previous !== view.editor.state}`);
      },
      destroy: () => log.push("destroy"),
    };
  },
};

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
    view.host.remove();
  }
  log.length = 0;
});

function mount(blocks: NodeJSON[] = content) {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = createEditor({
    document: createDocument({ type: "doc", content: blocks }),
    extensions: [acme],
  });
  const view = new EditorView(host, editor);
  views.push(view);
  return { host, editor, view };
}

describe("node and mark views", () => {
  it("draw custom nodes and marked runs", () => {
    const { host, editor } = mount();
    const mention = host.querySelector("[data-foli-custom='acme:mention']");
    expect(mention?.innerHTML).toBe('<span class="chip" title="u-1">@Ada</span>');
    expect(mention?.getAttribute("contenteditable")).toBe("false");
    const card = host.querySelector("[data-foli-custom='acme:card']");
    expect(card?.querySelector(".card p")?.textContent).toBe("Card c-1");
    const topic = host.querySelector("[data-foli-mark='acme:topic']");
    expect(topic?.textContent).toBe("budget");
    expect(topic?.classList.contains("topic")).toBe(true);
    expect(topic?.getAttribute("data-topic")).toBe("fin");
    // Still the document's text: the drawn chip is not read back.
    expect(editor.getDocument().content.content).toEqual(content);
  });

  it("make elements without HTML and refuse handlers and unsafe links", () => {
    const { h } = nodeViewDOM(document);
    const element = h("a", { href: "https://example.com" }, "<b>x</b>");
    expect(element.innerHTML).toBe("&lt;b&gt;x&lt;/b&gt;");
    expect(() => h("span", { onclick: "alert(1)" })).toThrow(TypeError);
    expect(() => h("a", { href: "javascript:alert(1)" })).toThrow(TypeError);
    expect(() => h("span", { contenteditable: "true" })).toThrow(TypeError);
    expect(() => h("script")).toThrow(TypeError);
  });
});

describe("decorations", () => {
  it("are found per block, relative to its content", () => {
    const doc = createEditor({
      document: createDocument({ type: "doc", content }),
      extensions: [acme],
    }).state.doc;
    const units: { pos: number; node: typeof doc }[] = [];
    doc.forEach((node, pos) => {
      units.push({ node, pos });
    });
    // Paragraph 0..24 (content 1..23), the card at 24, the last paragraph at 25 (content 26..30).
    const found = decorationsByBlock(units, [
      { from: 2, to: 28, attrs: { class: "a" } },
      { from: 24, to: 25, node: true, attrs: { class: "b" } },
      { from: 5, to: 6, node: true, attrs: { class: "c" } },
      { from: 3, to: 3, attrs: { class: "empty" } },
    ]);
    expect(found[0]?.map((d) => [d.attrs.class, d.from, d.to])).toEqual([
      ["a", 1, 27],
      ["c", 4, 5],
    ]);
    expect(found[1]?.map((d) => [d.attrs.class, d.from])).toEqual([["b", -1]]);
    expect(found[2]?.map((d) => [d.attrs.class, d.from, d.to])).toEqual([["a", -24, 2]]);
  });

  it("put classes on ranges and nodes, redrawing only the blocks they change", () => {
    const { host, editor } = mount();
    const set = (decorations: Decoration[]) =>
      editor.dispatch(editor.state.tr.setMeta(decorationKey, decorations));
    const last = () => [...host.querySelectorAll("p")].find((p) => p.textContent === "Last");
    const lastBefore = last();
    // "Ask" is 1..4; the mention at 5; the card at 24.
    set([
      { from: 2, to: 4, attrs: { class: "hit" } },
      { from: 5, to: 6, node: true, attrs: { "data-x": "1" } },
      { from: 24, to: 25, node: true, attrs: { class: "picked", style: "outline: 1px solid red" } },
    ]);
    expect([...host.querySelectorAll(".hit")].map((e) => e.textContent)).toEqual(["sk"]);
    expect(host.querySelector("[data-foli-custom='acme:mention']")?.getAttribute("data-x")).toBe(
      "1",
    );
    const card = host.querySelector("[data-foli-custom='acme:card']") as HTMLElement;
    expect(card.classList.contains("picked")).toBe(true);
    expect(card.getAttribute("style")).toContain("outline");
    // The paragraph without decorations was not drawn again; nor is the card when they stay.
    expect(last()).toBe(lastBefore);
    editor.select(27);
    expect(host.querySelector("[data-foli-custom='acme:card']")).toBe(card);
    // The document is unchanged: decorations are never content.
    expect(editor.getDocument().content.content).toEqual(content);
    set([]);
    expect(host.querySelector(".hit")).toBeNull();
    expect(host.querySelector(".picked")).toBeNull();
  });

  it("refuse attributes that would run code", () => {
    const { editor } = mount();
    expect(() =>
      editor.dispatch(
        editor.state.tr.setMeta(decorationKey, [{ from: 1, to: 3, attrs: { onmouseover: "x()" } }]),
      ),
    ).toThrow(TypeError);
  });
});

describe("plugin views", () => {
  it("are mounted with the view, told of updates and destroyed with it", () => {
    const { view, editor } = mount();
    expect(log).toEqual(["mount true"]);
    editor.commands.insertText("x");
    expect(log).toEqual(["mount true", "update true"]);
    view.destroy();
    views.splice(0);
    view.host.remove();
    expect(log).toEqual(["mount true", "update true", "destroy"]);
    // Destroyed: no more updates.
    editor.commands.insertText("y");
    expect(log.length).toBe(3);
  });
});
