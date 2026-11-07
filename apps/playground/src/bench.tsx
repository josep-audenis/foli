/**
 * The benchmark page (`/bench.html`, dev server only): mounts the editor on demand and times it
 * from inside the page. Driven by `apps/playground/bench/`; see docs/benchmarks.md.
 */
import { parseDocument } from "@folijs/core";
import { type FoliChange, FoliEditor } from "@folijs/react";
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
let swapped = false;

const bench = {
  /** Mounts a stored document: time until it is laid out (synchronous), and until painted. */
  async mount(json: unknown): Promise<{ layoutMs: number; paintMs: number; pages: number }> {
    const document = parseDocument(json);
    root?.unmount();
    root = createRoot(container);
    const start = performance.now();
    flushSync(() => root?.render(<FoliEditor initialContent={document} onChange={readBack} />));
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
   * A full re-flow as when a web font with other metrics finishes loading: the editor's font
   * family switches (between the test font and the default sans-serif) and `loadingdone`
   * fires. The browser lays all the text out again and the view measures every block and
   * flows the whole document. Time from the start of the frame that re-flows until painted.
   */
  async reflow(): Promise<{ ms: number; pages: number }> {
    swapped = !swapped;
    const canvas = document.querySelector<HTMLElement>(".foli-canvas");
    canvas?.style.setProperty("--foli-font-family", swapped ? "sans-serif" : null);
    document.fonts.dispatchEvent(new Event("loadingdone"));
    const frame = await painted();
    return { ms: performance.now() - frame, pages: pages() };
  },
};

declare global {
  interface Window {
    foliBench: typeof bench;
  }
}
window.foliBench = bench;
