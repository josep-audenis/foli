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
const MM = WIDTH / 105;

const STYLES: Styles = {
  title: { size: 25, line: 30, before: 0, after: 8, keepNext: true },
  heading: { size: 14.5, line: 20, before: 8, after: 4, keepNext: true },
  body: { size: 13, line: 20, before: 0, after: 6, keepNext: false },
};

const FLAG_NAMES = { widow: "widow", orphan: "orphan", stranded: "heading" };

/** Figure 1: pages you can pull. A drawing of pagination; no editor runs here. */
export function mountPages(root: HTMLElement): void {
  const view = root.querySelector<HTMLElement>("[data-view]");
  const source = root.querySelector<HTMLElement>("[data-source]");
  if (!view || !source) return;
  root.classList.add("is-live");

  const blocks = readBlocks(source);
  const { measure, space, reset } = createMeasure(STYLES);
  const canvas = view.appendChild(element("div", "pg-canvas"));
  const sheets = canvas.appendChild(element("div", "pg-sheets"));
  const words = canvas.appendChild(element("div", "pg-words"));
  const flags = canvas.appendChild(element("div", "pg-flags"));
  const layer = new WordLayer(words, blocks, STYLES);

  const ruler = canvas.appendChild(element("div", "pg-ruler"));
  ruler.style.width = `${WIDTH}px`;
  ruler.style.setProperty("--cm", `${MM * 10}px`);
  ruler.style.setProperty("--margin", `${MARGIN}px`);
  const marginHandle = slider(ruler, "pg-margin", "Right margin", "ew-resize");
  const edgeHandle = slider(canvas, "pg-edge", "Page height", "ns-resize");
  edgeHandle.style.width = `${WIDTH}px`;
  edgeHandle.append(element("span", "pg-grip"));
  const ghost = canvas.appendChild(element("div", "pg-ghost"));

  const state = { height: HEIGHT, text: TEXT, widows: true, keepWithNext: true };
  let flowed: FlowBlock[] | null = null;
  let scale = 1;
  let touched = false;
  const pages: HTMLElement[] = [];

  const out = (name: string) => root.querySelector<HTMLElement>(`[data-out="${name}"]`);

  function layout(settled = true): void {
    flowed ??= flow(blocks, state.text, measure, space);
    const inner = state.height - MARGIN * 2;
    const result = paginate(flowed, STYLES, inner, state);

    const available = view?.clientWidth ?? 1000;
    const columns = available < 560 ? 1 : available < 860 ? 2 : Math.max(3, result.pages);
    scale = Math.min(1.08, available / (columns * WIDTH + (columns - 1) * GAP));
    const rows = Math.ceil(result.pages / columns);
    const originX = (p: number) => (p % columns) * (WIDTH + GAP);
    const originY = (p: number) => TOP + Math.floor(p / columns) * (state.height + GAP);

    while (pages.length < result.pages) {
      const page = sheets.appendChild(element("div", "pg-page"));
      page.append(element("span", "pg-folio"));
      pages.push(page);
    }
    pages.forEach((page, index) => {
      const on = index < result.pages;
      page.classList.toggle("is-off", !on);
      page.style.height = `${state.height}px`;
      page.style.width = `${WIDTH}px`;
      page.style.transform = `translate3d(${originX(index)}px,${originY(index)}px,0)`;
      const folio = page.firstElementChild;
      if (folio) folio.textContent = String(index + 1);
    });

    result.lines.forEach((placed) => {
      const line = flowed?.[placed.block]?.lines[placed.line];
      const x = originX(placed.page) + MARGIN;
      const y = originY(placed.page) + MARGIN + placed.y;
      for (const item of line ?? []) {
        layer.place(item.word.id, x + item.x, y, settled ? Math.min(placed.line * 7, 70) : 0);
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

    canvas.style.transform = `scale(${scale})`;
    canvas.style.width = `${columns * WIDTH + (columns - 1) * GAP}px`;
    // Shorter pages never pull up what follows: the stage keeps its resting height.
    const resting =
      columns >= 3 ? (TOP + HEIGHT + 22) * Math.min(1.08, available / (3 * WIDTH + 2 * GAP)) : 0;
    const used = (TOP + rows * state.height + (rows - 1) * GAP + 22) * scale;
    view?.style.setProperty("height", `${Math.max(used, resting)}px`);
    marginHandle.style.transform = `translateX(${MARGIN + state.text}px)`;
    edgeHandle.style.transform = `translateY(${TOP + state.height - 13}px)`;
    ruler.style.setProperty("--text", `${state.text}px`);
    aria(marginHandle, WIDTH - MARGIN - state.text, 0, TEXT - MIN_TEXT, "px");
    aria(edgeHandle, Math.round(state.height / MM), MIN_HEIGHT / MM, MAX_HEIGHT / MM, " mm");

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

  function interact(): void {
    touched = true;
    ghost.classList.remove("is-on");
    root.classList.remove("is-auto");
  }

  drag(
    edgeHandle,
    "y",
    () => state.height,
    (value) => {
      state.height = clamp(value, MIN_HEIGHT, MAX_HEIGHT);
      layout(false);
    },
    () => scale,
    root,
    interact,
  );
  drag(
    marginHandle,
    "x",
    () => state.text,
    (value) => {
      state.text = clamp(value, MIN_TEXT, TEXT);
      flowed = null;
      layout(false);
    },
    () => scale,
    root,
    interact,
  );
  keys(edgeHandle, ["ArrowUp", "ArrowDown"], 12, (delta) => {
    interact();
    state.height = clamp(state.height + delta, MIN_HEIGHT, MAX_HEIGHT);
    layout();
  });
  keys(marginHandle, ["ArrowLeft", "ArrowRight"], 8, (delta) => {
    interact();
    state.text = clamp(state.text + delta, MIN_TEXT, TEXT);
    flowed = null;
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
  requestAnimationFrame(() => root.classList.add("is-ready"));
  document.fonts?.ready.then(() => {
    reset();
    flowed = null;
    layout(false);
  });
  new ResizeObserver(() => layout(false)).observe(view);

  // Once, unprompted: the page shows that it can be pulled.
  if (reducedMotion()) return;
  onFirstView(view, async () => {
    await wait(900);
    if (touched) return;
    root.classList.add("is-auto");
    ghost.classList.add("is-on");
    const run = (from: number, to: number, ms: number) =>
      new Promise<void>((done) => {
        const start = performance.now();
        const frame = (now: number) => {
          if (touched) return done();
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
    await run(HEIGHT, 372, 1500);
    if (!touched) await wait(350);
    if (!touched) await run(372, HEIGHT, 1200);
    if (!touched) {
      ghost.classList.remove("is-on");
      root.classList.remove("is-auto");
      state.height = HEIGHT;
      layout();
    }
  });
}

function element(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
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

function aria(node: HTMLElement, now: number, min: number, max: number, unit: string): void {
  node.setAttribute("aria-valuenow", String(Math.round(now)));
  node.setAttribute("aria-valuemin", String(Math.round(min)));
  node.setAttribute("aria-valuemax", String(Math.round(max)));
  node.setAttribute("aria-valuetext", `${Math.round(now)}${unit}`);
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function drag(
  handle: HTMLElement,
  axis: "x" | "y",
  read: () => number,
  write: (value: number) => void,
  scale: () => number,
  root: HTMLElement,
  begin: () => void,
): void {
  handle.addEventListener("pointerdown", (event) => {
    if (root.classList.contains("is-dragging")) return; // One pointer at a time.
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
    const end = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      root.classList.remove("is-dragging");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  });
}

function keys(
  handle: HTMLElement,
  [less, more]: [string, string],
  step: number,
  apply: (delta: number) => void,
): void {
  handle.addEventListener("keydown", (event) => {
    if (event.key !== less && event.key !== more) return;
    event.preventDefault();
    apply(event.key === more ? step : -step);
  });
}
