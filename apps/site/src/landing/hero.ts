import { flow, paginate, type Styles, type Word } from "./layout.js";
import { createMeasure, readBlocks, reducedMotion, WordLayer, wait, whileInView } from "./words.js";

const WIDTH = 340;
const HEIGHT = 480;
const MARGIN = 40;
const TEXT = WIDTH - MARGIN * 2;
const GAP = 24;
const PADDING = 28;
const PANE = 260;

const STYLES: Styles = {
  title: { size: 22, line: 28, before: 0, after: 10, keepNext: true },
  heading: { size: 14, line: 20, before: 10, after: 4, keepNext: true },
  body: { size: 13, line: 20, before: 0, after: 7, keepNext: false },
};

type Chapter = "write" | "review" | "save";
type Resolution = "open" | "accepted" | "rejected";

/** The hero: a drawing of the editor that plays three moments. No editor runs here. */
export function mountHero(root: HTMLElement): void {
  const foundStage = root.querySelector<HTMLElement>("[data-stage]");
  const source = root.querySelector<HTMLElement>("[data-source]");
  const foundPane = root.querySelector<HTMLElement>("[data-pane]");
  if (!foundStage || !source || !foundPane) return;
  const stage: HTMLElement = foundStage;
  const pane: HTMLElement = foundPane;
  root.classList.add("is-live");

  const blocks = readBlocks(source);
  const { measure, space, reset } = createMeasure(STYLES);
  const canvas = stage.appendChild(element("app-canvas"));
  const sheets = canvas.appendChild(element("app-sheets"));
  const words = canvas.appendChild(element("app-words"));
  const caret = canvas.appendChild(element("app-caret"));
  const layer = new WordLayer(words, blocks, STYLES);
  const typedWords = blocks.flatMap((b) => b.words).filter((w) => w.change === "typed");
  const pages: HTMLElement[] = [];

  const tabs = [...root.querySelectorAll<HTMLButtonElement>("[data-chapter]")];
  const track = root.querySelector<HTMLElement>("[data-track]");
  const result = root.querySelector<HTMLElement>("[data-result]");
  const status = root.querySelector<HTMLElement>("[data-status]");
  const card = pane.querySelector<HTMLElement>("[data-card]");

  const state = {
    chapter: "write" as Chapter,
    typed: reducedMotion() ? typedWords.length : 0,
    change: "open" as Resolution,
    comment: false,
    saved: false,
  };
  // Each new moment cancels the one playing.
  let run = 0;
  let auto = !reducedMotion();

  const marked = () => state.chapter !== "write";

  function visible(word: Word): boolean {
    if (word.change === "typed") return typedWords.indexOf(word) < state.typed;
    if (word.change !== "c1") return true;
    if (word.kind === "del") return !marked() || state.change !== "accepted";
    return marked() && state.change !== "rejected";
  }

  function layout(): void {
    const flowed = flow(blocks, TEXT, measure, space, visible);
    const result_ = paginate(flowed, STYLES, HEIGHT - MARGIN * 2, {
      widows: true,
      keepWithNext: true,
    });
    const wide = stage.clientWidth >= 720;
    const room = stage.clientWidth - (wide ? PANE : 0) - PADDING * 2;
    const shown = wide ? 2.55 * WIDTH + 2 * GAP : WIDTH;
    const scale = Math.min(1.12, room / shown);
    canvas.style.transform = `translate3d(${PADDING}px,${PADDING}px,0) scale(${scale})`;
    const left = (p: number) => p * (WIDTH + GAP);

    while (pages.length < result_.pages) {
      const page = sheets.appendChild(element("app-page"));
      page.style.width = `${WIDTH}px`;
      page.style.height = `${HEIGHT}px`;
      pages.push(page);
    }
    pages.forEach((page, index) => {
      page.classList.toggle("is-off", index >= result_.pages);
      page.style.transform = `translate3d(${left(index)}px,0,0)`;
    });

    for (const block of blocks) {
      for (const word of block.words) {
        layer.hide(word.id, !visible(word));
        const span = layer.spans.get(word.id);
        const open = marked() && state.change === "open";
        span?.classList.toggle("is-ins", open && word.change === "c1" && word.kind === "ins");
        span?.classList.toggle("is-del", open && word.change === "c1" && word.kind === "del");
        span?.classList.toggle("is-note", state.comment && word.kind === "comment");
      }
    }

    let end: { x: number; y: number } | undefined;
    let noteY = 0;
    let count = 0;
    for (const placed of result_.lines) {
      const line = flowed[placed.block]?.lines[placed.line] ?? [];
      const x = left(placed.page) + MARGIN;
      const y = MARGIN + placed.y;
      for (const item of line) {
        layer.place(item.word.id, x + item.x, y);
        count++;
        if (item.word.change === "typed") end = { x: x + item.x + item.width, y };
        if (item.word.kind === "comment") noteY = y;
      }
    }
    const typing = state.chapter === "write" && state.typed < typedWords.length && end;
    caret.classList.toggle("is-on", Boolean(typing));
    if (end) caret.style.transform = `translate3d(${end.x + 1}px,${end.y + 2}px,0)`;

    if (card) {
      card.classList.toggle("is-on", state.comment);
      card.style.transform = `translate3d(0,${PADDING + noteY * scale - 8}px,0)`;
      card.inert = !state.comment;
    }
    track?.setAttribute("aria-pressed", String(marked()));
    result?.classList.toggle("is-on", state.saved);
    if (result) result.inert = !state.saved;
    if (status) {
      status.textContent = `${result_.pages} pages · ${count} words`;
    }
    for (const tab of tabs) {
      tab.setAttribute("aria-pressed", String(tab.dataset.chapter === state.chapter));
    }
  }

  function show(chapter: Chapter): void {
    state.chapter = chapter;
    state.typed = chapter === "write" && !reducedMotion() ? 0 : typedWords.length;
    state.change = "open";
    state.comment = chapter !== "write" && reducedMotion();
    state.saved = false;
    layout();
  }

  async function play(chapter: Chapter): Promise<boolean> {
    const id = ++run;
    const live = () => id === run;
    show(chapter);
    if (reducedMotion()) {
      state.comment = chapter !== "write";
      state.saved = chapter === "save";
      layout();
      return false;
    }
    if (chapter === "write") {
      await wait(350);
      for (let i = 1; live() && i <= typedWords.length; i++) {
        state.typed = i;
        layout();
        await wait(typedWords[i - 1]?.text.endsWith(".") ? 260 : 150);
      }
    } else {
      await wait(450);
      if (live()) {
        state.comment = true;
        layout();
      }
      if (live() && chapter === "save") {
        await wait(650);
        if (live()) {
          state.saved = true;
          layout();
        }
      }
    }
    return live();
  }

  function pick(chapter: Chapter): void {
    auto = false;
    root.classList.remove("is-auto");
    void play(chapter);
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => pick(tab.dataset.chapter as Chapter));
  }
  track?.addEventListener("click", () => pick(marked() ? "write" : "review"));
  root.querySelector("[data-save]")?.addEventListener("click", () => pick("save"));
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-decide]")) {
    button.addEventListener("click", () => {
      auto = false;
      root.classList.remove("is-auto");
      run++;
      if (!marked()) show("review");
      state.change = button.dataset.decide === "reject" ? "rejected" : "accepted";
      layout();
    });
  }
  root.querySelector("[data-resolve]")?.addEventListener("click", () => {
    state.comment = false;
    layout();
    track?.focus({ preventScroll: true });
  });

  layout();
  void Promise.race([document.fonts?.ready, wait(1500)]).then(() => {
    reset();
    layout();
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add("is-ready")));
  });
  new ResizeObserver(layout).observe(stage);

  if (reducedMotion()) return;
  // It plays through each time you come back to it.
  let loop = 0;
  whileInView(
    stage,
    async () => {
      const id = ++loop;
      auto = true;
      root.classList.add("is-auto");
      for (const [chapter, rest] of [
        ["write", 1300],
        ["review", 2400],
        ["save", 0],
      ] as const) {
        if (id !== loop || !auto || !(await play(chapter))) return;
        await wait(rest);
      }
      root.classList.remove("is-auto");
    },
    () => {
      loop++;
      run++;
      auto = false;
    },
  );
}

function element(className: string): HTMLElement {
  const node = document.createElement("div");
  node.className = className;
  node.setAttribute("aria-hidden", "true");
  return node;
}
