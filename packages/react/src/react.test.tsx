// @vitest-environment jsdom
import { createDocument, createEditor, type Editor } from "@folijs/core";
import { act, cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FoliCanvas,
  type FoliChange,
  FoliEditor,
  type FoliEditorProps,
  FoliEditorProvider,
  useCurrentEditor,
  useEditorState,
  useFoliEditor,
} from "./index.js";

const paragraph = (text: string) =>
  createDocument({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
const hello = paragraph("Hello Foli");

/** Types through the view, as the browser's `beforeinput` would. */
function type(text: string, host = screen.getByRole("textbox")) {
  act(() => {
    host.dispatchEvent(
      new InputEvent("beforeinput", { inputType: "insertText", data: text, cancelable: true }),
    );
  });
}

let grabbed: Editor | undefined;
function Grab() {
  grabbed = useCurrentEditor();
  return null;
}

/** Renders `FoliEditor` and hands back its editor (through a child using the context). */
function renderEditor(props: FoliEditorProps = {}) {
  grabbed = undefined;
  const result = render(
    <FoliEditor {...props}>
      {props.children}
      <Grab />
    </FoliEditor>,
  );
  // Assigned during render, which TypeScript cannot see.
  const editor = grabbed as Editor | undefined;
  if (!editor) throw new Error("no editor");
  return { ...result, editor };
}

function Insert() {
  const editor = useCurrentEditor();
  return (
    <button type="button" onClick={() => editor.commands.insertText("Hey")}>
      Insert
    </button>
  );
}

function ComposedApp() {
  const editor = useFoliEditor({ initialContent: hello });
  return (
    <FoliEditorProvider editor={editor}>
      <Insert />
      <FoliCanvas label="Body" />
    </FoliEditorProvider>
  );
}

const probed: Editor[] = [];
function Probe({ text }: { text: string }) {
  probed.push(useFoliEditor({ initialContent: paragraph(text) }));
  return null;
}

let boldRenders = 0;
function Bold() {
  boldRenders++;
  const bold = useEditorState((_state, editor) => editor.isMarkActive("bold"));
  return <span>{bold ? "bold" : "plain"}</span>;
}

const ranges: object[] = [];
function Range() {
  const range = useEditorState(
    (state) => ({ from: state.selection.from, to: state.selection.to }),
    { isEqual: (a, b) => a.from === b.from && a.to === b.to },
  );
  ranges.push(range);
  return null;
}

/** A read-only canvas over one editor per `text` (created by a component that keeps them). */
function Swap({ text }: { text: string }) {
  const first = useFoliEditor({ initialContent: paragraph("first") });
  const second = useFoliEditor({ initialContent: paragraph("second") });
  return <FoliCanvas editor={text === "first" ? first : second} readOnly />;
}

function Text() {
  const text = useEditorState((state) => state.doc.textContent);
  return <span data-testid="text">{text}</span>;
}

/** An object selector without isEqual: a new object per state, the same one within a state. */
function Head() {
  const head = useEditorState((state) => ({ head: state.selection.head }));
  return <span data-testid="head">{head.head}</span>;
}

function Lost() {
  useCurrentEditor();
  return null;
}

describe("FoliEditor", () => {
  afterEach(cleanup);

  it("renders initial content inside an A4 page", async () => {
    const { container } = render(<FoliEditor initialContent={hello} />);
    expect(await screen.findByText("Hello Foli")).toBeTruthy();
    const page = container.querySelector<HTMLElement>(".foli-page");
    expect(page?.style.width).toBe("210mm");
  });

  it("reports content changes with their transactions, not selection changes", () => {
    const changes: FoliChange[] = [];
    const { editor } = renderEditor({ onChange: (change) => changes.push(change) });
    const host = screen.getByRole("textbox", { name: "Document" });
    expect(host.getAttribute("contenteditable")).toBe("true");

    type("Hi");
    expect(host.textContent).toBe("Hi");
    expect(changes).toHaveLength(1);
    expect(changes[0]?.editor).toBe(editor);
    expect(changes[0]?.transactions.some((tr) => tr.docChanged)).toBe(true);
    expect(changes[0]?.document.content).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
    });

    act(() => editor.select(1));
    expect(changes).toHaveLength(1);
  });

  it("serializes the document only when a change's document is read, once", () => {
    const changes: FoliChange[] = [];
    const { editor } = renderEditor({ onChange: (change) => changes.push(change) });
    const toJSON = vi.spyOn(Object.getPrototypeOf(editor.state.doc), "toJSON");
    type("a");
    type("b");
    expect(toJSON).not.toHaveBeenCalled();
    const document = changes[1]?.document;
    const calls = toJSON.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect(changes[1]?.document).toBe(document);
    expect(toJSON.mock.calls.length).toBe(calls);
    toJSON.mockRestore();
  });

  it("a change's document is the one right after it, even when read after later edits", () => {
    const changes: FoliChange[] = [];
    const { editor } = renderEditor({ onChange: (change) => changes.push(change) });
    type("a");
    type("b");
    act(() => editor.setDocument(hello));
    const text = (change: FoliChange | undefined) =>
      JSON.stringify(change?.document.content).match(/"text":"(\w*)"/)?.[1];
    expect(text(changes[0])).toBe("a");
    expect(text(changes[1])).toBe("ab");
    expect(changes[0]?.document.settings).toEqual(editor.settings);
  });

  it("setDocument re-renders state selectors but does not call onChange", () => {
    const onChange = vi.fn();
    const { editor } = renderEditor({ onChange, children: <Text /> });
    expect(screen.getByTestId("text").textContent).toBe("");
    act(() => editor.setDocument(hello));
    expect(screen.getByTestId("text").textContent).toBe("Hello Foli");
    expect(screen.getByRole("textbox").textContent).toBe("Hello Foli");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("calls the latest onChange, and none after unmount", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { editor, rerender, unmount } = renderEditor({ onChange: first });
    rerender(<FoliEditor onChange={second} />);
    type("x");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    unmount();
    editor.commands.insertText("y");
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("passes readOnly, placeholder and label to the view, also when they change", () => {
    const { rerender } = render(<FoliEditor readOnly placeholder="Write…" label="Notes" />);
    const host = screen.getByRole("textbox", { name: "Notes" });
    expect(host.getAttribute("contenteditable")).toBe("false");
    expect(host.getAttribute("aria-readonly")).toBe("true");
    expect(host.getAttribute("aria-placeholder")).toBe("Write…");
    expect(host.querySelector("[data-foli-placeholder]")).toBeTruthy();

    rerender(<FoliEditor placeholder="" label="Notes" />);
    expect(host.getAttribute("contenteditable")).toBe("true");
    expect(host.hasAttribute("aria-readonly")).toBe(false);
    expect(host.querySelector("[data-foli-placeholder]")).toBeNull();
  });

  it("works under StrictMode's double mount: one view, one change per edit", () => {
    const onChange = vi.fn();
    const { container } = render(
      <StrictMode>
        <FoliEditor initialContent={hello} readOnly placeholder="Write…" onChange={onChange} />
      </StrictMode>,
    );
    const host = screen.getByRole("textbox");
    expect(container.querySelectorAll(".foli-page")).toHaveLength(1);
    // The remounted view got the options too.
    expect(host.getAttribute("contenteditable")).toBe("false");
    cleanup();

    render(
      <StrictMode>
        <FoliEditor initialContent={hello} onChange={onChange} />
      </StrictMode>,
    );
    type("!");
    expect(screen.getByRole("textbox").textContent).toBe("!Hello Foli");
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("hooks and composition", () => {
  afterEach(cleanup);

  it("builds an editor from useFoliEditor, a provider and FoliCanvas, with controls inside", () => {
    render(<ComposedApp />);
    act(() => screen.getByRole("button", { name: "Insert" }).click());
    expect(screen.getByRole("textbox", { name: "Body" }).textContent).toBe("HeyHello Foli");
  });

  it("useFoliEditor keeps one editor across renders and ignores later options", () => {
    probed.length = 0;
    const { rerender } = render(<Probe text="one" />);
    rerender(<Probe text="two" />);
    expect(probed[0]).toBe(probed[1]);
    expect(probed[1]?.state.doc.textContent).toBe("one");
  });

  it("useEditorState re-renders only when the selected slice changes", () => {
    const { editor } = renderEditor({ initialContent: hello, children: <Bold /> });
    const before = boldRenders;
    act(() => editor.commands.insertText("abc"));
    act(() => editor.select(2));
    expect(boldRenders).toBe(before);
    expect(screen.getByText("plain")).toBeTruthy();

    act(() => editor.commands.toggleMark("bold"));
    expect(boldRenders).toBe(before + 1);
    expect(screen.getByText("bold")).toBeTruthy();
  });

  it("useEditorState keeps an equal selection's identity with isEqual", () => {
    ranges.length = 0;
    const { editor } = renderEditor({ initialContent: hello, children: <Range /> });
    act(() => editor.select(3));
    const count = ranges.length;
    act(() => editor.commands.toggleMark("bold")); // a stored mark: the selection is the same
    expect(ranges.length).toBe(count);
    act(() => editor.select(4));
    expect(ranges.length).toBe(count + 1);
    expect(ranges.at(-1)).toEqual({ from: 4, to: 4 });
  });

  it("FoliCanvas given another editor shows it, with the same options", () => {
    const { rerender } = render(<Swap text="first" />);
    const host = screen.getByRole("textbox");
    expect(host.textContent).toBe("first");
    rerender(<Swap text="second" />);
    expect(host.textContent).toBe("second");
    expect(host.getAttribute("contenteditable")).toBe("false");
  });

  it("useEditorState with an object selector and no isEqual caches its snapshot (no warning)", () => {
    const error = vi.spyOn(console, "error");
    const { editor } = renderEditor({
      initialContent: hello,
      children: (
        <StrictMode>
          <Head />
        </StrictMode>
      ),
    });
    act(() => editor.select(3));
    act(() => editor.commands.insertText("x"));
    expect(screen.getByTestId("head").textContent).toBe("4");
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("unmounting removes every subscription to the editor", () => {
    const editor = createEditor({ document: hello });
    const unsubscribed = vi.fn();
    const subscribe = editor.subscribe.bind(editor);
    let active = 0;
    vi.spyOn(editor, "subscribe").mockImplementation((listener) => {
      active++;
      const unsubscribe = subscribe(listener);
      return () => {
        active--;
        unsubscribed();
        return unsubscribe();
      };
    });
    const { unmount } = render(
      <StrictMode>
        <FoliEditorProvider editor={editor}>
          <Head />
          <FoliCanvas />
        </FoliEditorProvider>
      </StrictMode>,
    );
    expect(active).toBeGreaterThan(0);
    unmount();
    expect(unsubscribed).toHaveBeenCalled();
    expect(active).toBe(0);
  });

  it("useCurrentEditor and FoliCanvas without an editor throw a clear error", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Lost />)).toThrow(/FoliEditorProvider/);
    expect(() => render(<FoliCanvas />)).toThrow(/FoliCanvas: pass an editor/);
    quiet.mockRestore();
  });
});
