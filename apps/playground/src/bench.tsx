/**
 * The benchmark page (`/bench.html`, dev server only): mounts the editor on demand and times it
 * from inside the page. Driven by `apps/playground/bench/`; see docs/benchmarks.md.
 */
import { parseDocument } from "@foli/core";
import { DocumentEditor } from "@foli/react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import "@foli/react/styles.css";

/** Resolves after the next frame has been painted (a task queued from its rAF callback). */
function painted(): Promise<number> {
  return new Promise((resolve) =>
    requestAnimationFrame((frame) => setTimeout(() => resolve(frame))),
  );
}

const pages = () => document.querySelectorAll(".foli-page").length;
const container = document.getElementById("root") as HTMLElement;
let root: Root | null = null;

/** Time from the keydown event to the end of the editor's handlers, and to the next paint. */
interface KeySample {
  handlerMs: number;
  paintMs: number;
}
let key: Promise<KeySample> | null = null;
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
    const start = event.timeStamp;
    key = painted().then(() => ({
      handlerMs: handled - start,
      paintMs: performance.now() - start,
    }));
  },
  { capture: true },
);

const bench = {
  /** Mounts a stored document: time until it is laid out (synchronous), and until painted. */
  async mount(json: unknown): Promise<{ layoutMs: number; paintMs: number; pages: number }> {
    const document = parseDocument(json);
    root?.unmount();
    root = createRoot(container);
    const start = performance.now();
    flushSync(() => root?.render(<DocumentEditor initialContent={document} />));
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
   * A full re-flow without an edit, as when web fonts finish loading: every block measured
   * again. Time from the start of the frame that re-flows until it is painted.
   */
  async reflow(): Promise<{ ms: number; pages: number }> {
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
