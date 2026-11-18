import { type FlowBlock, flow, paginate, type Styles } from "./layout.js";
import { createMeasure, onFirstView, readBlocks, reducedMotion, WordLayer, wait } from "./words.js";

const WIDTH = 340;
const MARGIN = 40;
const HEIGHT = 480;
const MIN_HEIGHT = 300;
const MAX_HEIGHT = 540;
const TEXT = WIDTH - MARGIN * 2;
const MIN_TEXT = 170;
const GAP = 24;
const TOP = 26;
const BOTTOM = 22;
const MM = WIDTH / 105;

const STYLES: Styles = {
  title: { size: 25, line: 30, before: 0, after: 8, keepNext: true },
  heading: { size: 14.5, line: 20, before: 8, after: 4, keepNext: true },
  body: { size: 13, line: 20, before: 0, after: 6, keepNext: false },
};

const FLAG_NAMES = { widow: "widow", orphan: "orphan", stranded: "heading" };

/** Figure 1: pages you can pull. A drawing of pagination; no editor runs here. */
export function mountPages(root: HTMLElement): void {
  const found = root.querySelector<HTMLElement>("[data-view]");
  const source = root.querySelector<HTMLElement>("[data-source]");
  if (!found || !source) return;
  const view: HTMLElement = found;
  root.classList.add("is-live");

  const blocks = readBlocks(source);
  const { measure, space, reset } = createMeasure(STYLES);
  const canvas = view.appendChild(element("div", "pg-canvas"));
  const sheets = canvas.appendChild(drawing("pg-sheets"));
  const words = canvas.appendChild(drawing("pg-words"));
  const flags = canvas.appendChild(drawing("pg-flags"));
  const layer = new WordLayer(words, blocks, STYLES);

  const ruler = canvas.appendChild(element("div", "pg-ruler"));
  ruler.style.width = `${WIDTH}px`;
  ruler.style.setProperty("--cm", `${MM * 10}px`);
  ruler.style.setProperty("--margin", `${MARGIN}px`);
  const marginHandle = slider(ruler, "pg-margin", "Text width", "ew-resize");
  const edgeHandle = slider(canvas, "pg-edge", "Page height", "ns-resize");
  edgeHandle.style.width = `${WIDTH}px`;
  edgeHandle.setAttribute("aria-orientation", "vertical");
  edgeHandle.append(element("span", "pg-grip"));
  const ghost = canvas.appendChild(drawing("pg-ghost"));

  const state = { height: HEIGHT, text: TEXT, widows: true, keepWithNext: true };
  let flowed: FlowBlock[] | null = null;
  let columns = 3;
  let scale = 1;
  let offset = 0;
  // While the page is being pulled nothing zooms: the grip stays under the pointer.
  let frozen = false;
  let demo = false;
  let touched = false;
  let parked = false;
  const pages: HTMLElement[] = [];

  const out = (name: string) => root.querySelector<HTMLElement>(`[data-out="${name}"]`);
  const paged = (height: number) => {
    flowed ??= flow(blocks, state.text, measure, space);
    return paginate(flowed, STYLES, height - MARGIN * 2, state);
  };

  function fit(): void {
    const available = view.clientWidth;
    columns = available < 560 ? 1 : available < 860 ? 2 : available < 1000 ? 3 : 4;
    const total = columns * WIDTH + (columns - 1) * GAP;
    // On a wide stage the fourth page runs off the edge of the window.
    const shown = columns === 4 ? 3.42 * WIDTH + 3 * GAP : total;
    const byWidth = available / shown;
    // On a wide window the three pages also fit the height, so the grip starts on screen.
    const top = view.getBoundingClientRect().top + scrollY;
    const room = (innerHeight - top - 10) / (TOP + HEIGHT + 8);
    const byHeight = columns >= 3 && available >= 860 ? Math.max(0.84, room) : 1.08;
    scale = Math.min(1.08, byWidth, byHeight);
    offset = columns === 4 ? 0 : Math.max(0, available - total * scale);
  }

  function layout(settled = true): void {
    const result = paged(state.height);
    if (!frozen) fit();
    // While pulling on a wide stage, extra pages run off to the right; they wrap on release.
    const oneRow = frozen && columns >= 3;
    const rows = Math.ceil(result.pages / columns);
    const originX = (p: number) => (oneRow ? p : p % columns) * (WIDTH + GAP);
    const originY = (p: number) =>
      TOP + (oneRow ? 0 : Math.floor(p / columns)) * (state.height + GAP);

    while (pages.length < result.pages) {
      pages.push(sheets.appendChild(element("div", "pg-page")));
    }
    pages.forEach((page, index) => {
      page.classList.toggle("is-off", index >= result.pages);
      page.style.height = `${state.height}px`;
      page.style.width = `${WIDTH}px`;
      page.style.transform = `translate3d(${originX(index)}px,${originY(index)}px,0)`;
    });

    result.lines.forEach((placed) => {
      const line = flowed?.[placed.block]?.lines[placed.line];
      const x = originX(placed.page) + MARGIN;
      const y = originY(placed.page) + MARGIN + placed.y;
      for (const item of line ?? []) {
        layer.place(item.word.id, x + item.x, y, settled ? Math.min(placed.line * 6, 60) : 0);
      }
    });

    flags.replaceChildren(
      ...result.flags.map((flag) => {
        const mark = element("span", `pg-flag pg-flag-${flag.kind}`);
        mark.textContent = FLAG_NAMES[flag.kind];
        const x = originX(flag.page);
        mark.style.transform = `translate3d(${x}px,${originY(flag.page) + MARGIN + flag.y}px,0)`;
        mark.style.width = `${MARGIN - 5}px`;
        return mark;
      }),
    );

    canvas.style.transform = `translateX(${offset}px) scale(${scale})`;
    canvas.style.width = `${columns * WIDTH + (columns - 1) * GAP}px`;
    if (!oneRow) {
      // The stage keeps its resting height, so pulling a page never moves what follows.
      const restingRows = Math.ceil(paged(HEIGHT).pages / columns);
      const resting = TOP + restingRows * (HEIGHT + GAP) - GAP + BOTTOM;
      const used = TOP + rows * (state.height + GAP) - GAP + BOTTOM;
      view.style.height = `${Math.max(used, resting) * scale}px`;
    }
    marginHandle.style.transform = `translateX(${MARGIN + state.text}px)`;
    edgeHandle.style.transform = `translateY(${TOP + state.height - 13}px)`;
    ruler.style.setProperty("--text", `${state.text}px`);
    aria(marginHandle, state.text / MM, MIN_TEXT / MM, TEXT / MM);
    aria(edgeHandle, state.height / MM, MIN_HEIGHT / MM, MAX_HEIGHT / MM);

    const set = (name: string, value: string) => {
      const target = out(name);
      if (target && target.textContent !== value) target.textContent = value;
    };
    set("pages", String(result.pages));
    set("size", `105 × ${Math.round(state.height / MM)} mm`);
    set("measure", `${Math.round(state.text / MM)} mm`);
    set("breaks", String(result.flags.length));
    out("breaks")
      ?.closest("div")
      ?.classList.toggle("is-bad", result.flags.length > 0);
  }

  /** Ends the opening demonstration; `keep` leaves the page where the reader caught it. */
  function interact(keep = false): void {
    touched = true;
    parked = false;
    ghost.classList.remove("is-on");
    root.classList.remove("is-auto");
    if (demo) {
      demo = false;
      frozen = false;
      if (!keep) state.height = HEIGHT;
    }
  }

  const beginDrag = () => {
    interact(true);
    frozen = true;
    layout(false);
  };
  const endDrag = () => {
    frozen = false;
    layout();
  };
  drag(
    root,
    edgeHandle,
    "y",
    () => state.height,
    beginDrag,
    endDrag,
    () => scale,
    (value) => {
      state.height = clamp(value, MIN_HEIGHT, MAX_HEIGHT);
      layout(false);
    },
  );
  drag(
    root,
    marginHandle,
    "x",
    () => state.text,
    beginDrag,
    endDrag,
    () => scale,
    (value) => {
      state.text = clamp(value, MIN_TEXT, TEXT);
      flowed = null;
      layout(false);
    },
  );
  keys(
    edgeHandle,
    12,
    MIN_HEIGHT,
    MAX_HEIGHT,
    () => state.height,
    (value) => {
      interact();
      state.height = value;
      layout();
    },
  );
  keys(
    marginHandle,
    8,
    MIN_TEXT,
    TEXT,
    () => state.text,
    (value) => {
      interact();
      state.text = value;
      flowed = null;
      layout();
    },
  );

  // Reaching for the grip during the demonstration stops it there.
  edgeHandle.addEventListener("pointermove", (event) => {
    // The grip may slide under a resting cursor: only a moving pointer counts.
    if (!demo || (event.movementX === 0 && event.movementY === 0)) return;
    interact(true);
    parked = true;
    layout();
  });
  edgeHandle.addEventListener("pointerleave", () => {
    if (!parked || root.classList.contains("is-dragging")) return;
    parked = false;
    state.height = HEIGHT;
    layout();
  });

  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-rule]")) {
    const rule = button.dataset.rule as "widows" | "keepWithNext";
    button.addEventListener("click", () => {
      interact();
      state[rule] = !state[rule];
      button.setAttribute("aria-pressed", String(state[rule]));
      layout();
    });
  }
  root.querySelector("[data-reset]")?.addEventListener("click", () => {
    interact();
    Object.assign(state, { height: HEIGHT, text: TEXT, widows: true, keepWithNext: true });
    for (const button of root.querySelectorAll("[data-rule]")) {
      button.setAttribute("aria-pressed", "true");
    }
    flowed = null;
    layout();
  });

  layout(false);
  // Words take their real places before motion is switched on, so loading animates nothing.
  void Promise.race([document.fonts?.ready, wait(1500)]).then(() => {
    reset();
    flowed = null;
    layout(false);
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add("is-ready")));
  });
  new ResizeObserver(() => {
    if (!frozen) layout(false);
  }).observe(view);

  // Once, unprompted: the page shows that it can be pulled, without adding a page.
  if (reducedMotion()) return;
  onFirstView(view, async () => {
    await wait(1000);
    if (touched) return;
    let low = HEIGHT;
    for (let h = HEIGHT - 4; h >= 380 && paged(h).pages === paged(HEIGHT).pages; h -= 4) low = h;
    if (HEIGHT - low < 24) return;
    demo = true;
    frozen = true;
    root.classList.add("is-auto");
    if (matchMedia("(pointer: fine)").matches) ghost.classList.add("is-on");
    const run = (from: number, to: number, ms: number) =>
      new Promise<void>((done) => {
        const start = performance.now();
        const frame = (now: number) => {
          if (!demo) return done();
          const t = Math.min(1, (now - start) / ms);
          const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
          state.height = from + (to - from) * eased;
          ghost.style.transform = `translate3d(${WIDTH / 2 + 4}px,${TOP + state.height - 4}px,0)`;
          layout(false);
          if (t < 1) requestAnimationFrame(frame);
          else done();
        };
        requestAnimationFrame(frame);
      });
    await run(HEIGHT, low, 1300);
    if (demo) await wait(320);
    if (demo) await run(low, HEIGHT, 1000);
    if (demo) {
      interact();
      layout();
    }
  });
}

function element(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function drawing(className: string): HTMLElement {
  const node = element("div", className);
  node.setAttribute("aria-hidden", "true");
  return node;
}

function slider(parent: HTMLElement, className: string, label: string, cursor: string) {
  const node = parent.appendChild(element("div", className));
  node.tabIndex = 0;
  node.setAttribute("role", "slider");
  node.setAttribute("aria-label", label);
  node.style.cursor = cursor;
  return node;
}

function aria(node: HTMLElement, now: number, min: number, max: number): void {
  node.setAttribute("aria-valuenow", String(Math.round(now)));
  node.setAttribute("aria-valuemin", String(Math.round(min)));
  node.setAttribute("aria-valuemax", String(Math.round(max)));
  node.setAttribute("aria-valuetext", `${Math.round(now)} millimetres`);
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function drag(
  root: HTMLElement,
  handle: HTMLElement,
  axis: "x" | "y",
  read: () => number,
  begin: () => void,
  finish: () => void,
  scale: () => number,
  write: (value: number) => void,
): void {
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || root.classList.contains("is-dragging")) return;
    event.preventDefault();
    begin();
    handle.setPointerCapture(event.pointerId);
    handle.focus({ preventScroll: true });
    root.classList.add("is-dragging");
    const origin = axis === "x" ? event.clientX : event.clientY;
    const start = read();
    const move = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      write(start + ((axis === "x" ? e.clientX : e.clientY) - origin) / scale());
    };
    const stop = () => {
      root.classList.remove("is-dragging");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      handle.removeEventListener("keydown", cancel);
      finish();
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId === event.pointerId) stop();
    };
    const cancel = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      write(start);
      handle.releasePointerCapture(event.pointerId);
      stop();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("keydown", cancel);
  });
}

/** The keys of a slider: up and right raise the value, Home and End go to its ends. */
function keys(
  handle: HTMLElement,
  step: number,
  min: number,
  max: number,
  read: () => number,
  apply: (value: number) => void,
): void {
  handle.addEventListener("keydown", (event) => {
    const now = read();
    const next: Record<string, number> = {
      ArrowUp: now + step,
      ArrowRight: now + step,
      ArrowDown: now - step,
      ArrowLeft: now - step,
      Home: min,
      End: max,
    };
    const value = next[event.key];
    if (value === undefined) return;
    event.preventDefault();
    apply(clamp(value, min, max));
  });
}
