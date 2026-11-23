/**
 * The benchmark page (`/bench.html`, dev server only): mounts the editor on demand and times it
 * from inside the page. Driven by `apps/playground/bench/`; see docs/benchmarks.md.
 */
import { createAuthority } from "@folijs/collab";
import {
  collab,
  createEditor,
  type Editor,
  type FoliDocument,
  getVersion,
  parseDocument,
  receiveTransaction,
  Step,
  sendableSteps,
} from "@folijs/core";
import { type FoliChange, FoliEditor, type FoliEditorHandle } from "@folijs/react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import "@folijs/react/styles.css";

/** Resolves after the next frame has been painted (a task queued from its rAF callback). */
function painted(): Promise<number> {
  return new Promise((resolve) =>
    requestAnimationFrame((frame) => setTimeout(() => resolve(frame))),
  );
}

const pages = () => document.querySelectorAll(".foli-page").length;
const container = document.getElementById("root") as HTMLElement;
let root: Root | null = null;

/**
 * One key: time from the start of its keydown dispatch in the page to the end of the editor's
 * handlers, and from the event's creation (`timeStamp`: input delivery included) to the next
 * paint. `seq` counts keydowns, so the caller can check it is reading the key it pressed.
 */
interface KeySample {
  seq: number;
  handlerMs: number;
  paintMs: number;
}
let key: Promise<KeySample> | null = null;
let keys = 0;
let handled = 0;
// Bubble listeners on the window run after the editor's own (on its host).
for (const type of ["keydown", "beforeinput", "input"]) {
  addEventListener(type, () => {
    handled = performance.now();
  });
}
addEventListener(
  "keydown",
  (event) => {
    const seq = ++keys;
    const created = event.timeStamp;
    const start = performance.now();
    key = painted().then(() => ({
      seq,
      handlerMs: handled - start,
      paintMs: performance.now() - created,
    }));
  },
  { capture: true },
);

// Every change reads the document back, as an app that saves on each change does (the
// playground saves after a pause instead): the whole document is serialized per keystroke.
const readBack = (change: FoliChange) => change.document;

/**
 * The font swap: the document's runs carry their fonts inline (and the test font is forced over
 * them), so the other font is a rule that overrides both.
 */
const swap = document.createElement("style");
swap.textContent =
  "html body .foli-canvas .foli-page :is(p, h1, h2, h3, h4, h5, h6, span) " +
  "{ font-family: sans-serif !important; }";

/**
 * Others editing the document at once (22.12): `count` headless editors, each typing a character
 * into a paragraph of the document's second half every 50 ms, through an in-page authority; the
 * mounted editor sends its own steps and receives theirs, as over a network with no delay.
 */
let others: ReturnType<typeof setInterval>[] = [];
function collaborate(document: FoliDocument, own: Editor, count: number): void {
  for (const timer of others) clearInterval(timer);
  others = [];
  const authority = createAuthority({ document });
  const editors = [own];
  const flush = () => {
    for (const editor of editors) {
      const sendable = sendableSteps(editor.state);
      if (!sendable) continue;
      const result = authority.receive({
        version: sendable.version,
        clientID: sendable.clientID,
        steps: sendable.steps.map((s) => s.toJSON()),
      });
      if (!result.ok) continue;
      for (const each of editors) {
        if (getVersion(each.state) !== result.broadcast.version) continue;
        const steps = result.broadcast.steps.map((json) => Step.fromJSON(each.state.schema, json));
        each.dispatch(receiveTransaction(each.state, steps, result.broadcast.clientIDs));
      }
    }
  };
  for (let i = 0; i < count; i++) {
    const editor = createEditor({ document, plugins: [collab({ clientID: i + 2 })] });
    editors.push(editor);
    let at = 0;
    others.push(
      setInterval(() => {
        // A paragraph far from the first page: what they type moves no line of the user's.
        const size = editor.state.doc.content.size;
        const pos = Math.floor(size * (0.6 + 0.1 * i)) + (at++ % 5);
        try {
          editor.select(pos);
          editor.commands.insertText("x");
        } catch {
          // Not a text position: the next tick tries another.
        }
        flush();
      }, 50),
    );
  }
  own.subscribe(() => queueMicrotask(flush));
}

const bench = {
  /**
   * Mounts a stored document: time until it is laid out (synchronous), and until painted. With
   * `remote`, that many others edit it at once (`collaborate`).
   */
  async mount(
    json: unknown,
    remote = 0,
  ): Promise<{ layoutMs: number; paintMs: number; pages: number }> {
    const document = parseDocument(json);
    root?.unmount();
    for (const timer of others) clearInterval(timer);
    others = [];
    root = createRoot(container);
    const start = performance.now();
    let handle: FoliEditorHandle | null = null;
    flushSync(() =>
      root?.render(
        <FoliEditor
          ref={(value) => {
            handle = value;
          }}
          initialContent={document}
          onChange={readBack}
          {...(remote ? { plugins: [collab({ clientID: 1 })] } : {})}
        />,
      ),
    );
    const mounted = handle as FoliEditorHandle | null;
    if (remote && mounted) collaborate(document, mounted.editor, remote);
    const layoutMs = performance.now() - start;
    await painted();
    return { layoutMs, paintMs: performance.now() - start, pages: pages() };
  },
  /** The timing of the last key pressed, once its frame is painted. */
  lastKey(): Promise<KeySample> {
    if (!key) throw new Error("No key pressed yet");
    return key;
  },
  /**
   * A full re-flow as when a web font with other metrics finishes loading: the text's font
   * switches (between the test font and the default sans-serif) and `loadingdone` fires. The
   * browser lays all the text out again and the view measures every block and flows the whole
   * document. Time from the start of the frame that re-flows until painted, and the font the
   * first paragraph's text then shows (the swap took).
   */
  async reflow(): Promise<{ ms: number; pages: number; font: string }> {
    if (swap.isConnected) swap.remove();
    else document.head.append(swap);
    document.fonts.dispatchEvent(new Event("loadingdone"));
    const frame = await painted();
    const span = document.querySelector(".foli-page p span");
    const font = span ? getComputedStyle(span).fontFamily : "";
    return { ms: performance.now() - frame, pages: pages(), font };
  },
};

declare global {
  interface Window {
    foliBench: typeof bench;
  }
}
window.foliBench = bench;
