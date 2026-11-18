import { flow, type Styles, type Word } from "./layout.js";
import { createMeasure, readBlocks, WordLayer } from "./words.js";

const STYLES: Styles = {
  title: { size: 22, line: 30, before: 0, after: 10, keepNext: true },
  heading: { size: 21, line: 30, before: 0, after: 12, keepNext: true },
  body: { size: 18, line: 31, before: 0, after: 16, keepNext: false },
};
const PADDING = 44;

type View = "all" | "simple" | "none";
type Resolution = "open" | "accepted" | "rejected";

/** Figure 2: a redline you can settle. Drawn for this page; no editor runs here. */
export function mountReview(root: HTMLElement): void {
  const page = root.querySelector<HTMLElement>("[data-page]");
  const source = root.querySelector<HTMLElement>("[data-source]");
  const margin = root.querySelector<HTMLElement>("[data-margin]");
  if (!page || !source || !margin) return;
  root.classList.add("is-live");

  const blocks = readBlocks(source);
  const { measure, space, reset } = createMeasure(STYLES);
  const host = page.appendChild(document.createElement("div"));
  host.className = "rv-words";
  const bars = page.appendChild(document.createElement("div"));
  bars.className = "rv-bars";
  const layer = new WordLayer(host, blocks, STYLES);
  const balloons = [...margin.querySelectorAll<HTMLElement>("[data-for]")];
  const views = [...root.querySelectorAll<HTMLButtonElement>("[data-view-mode]")];
  const summary = root.querySelector<HTMLElement>("[data-summary]");
  const state = new Map<string, Resolution>(balloons.map((b) => [b.dataset.for ?? "", "open"]));
  let view: View = "all";

  const settled = (word: Word) => state.get(word.change ?? "") ?? "open";

  function visible(word: Word): boolean {
    if (word.kind === "ins") return settled(word) !== "rejected";
    if (word.kind === "del") {
      const now = settled(word);
      return now === "rejected" || (now === "open" && view === "all");
    }
    return true;
  }

  function layout(): void {
    const width = page?.clientWidth ?? 600;
    const text = Math.max(180, width - PADDING * 2);
    const flowed = flow(blocks, text, measure, space, visible);
    const lineOf = new Map<string, number>();
    const barLines = new Set<number>();
    let y = PADDING;

    for (const block of blocks) {
      for (const word of block.words) {
        const on = visible(word);
        layer.hide(word.id, !on);
        const span = layer.spans.get(word.id);
        const open = settled(word) === "open";
        span?.classList.toggle("is-ins", word.kind === "ins" && open && view === "all");
        span?.classList.toggle("is-del", word.kind === "del" && open && view === "all");
        span?.classList.toggle("is-note", word.kind === "comment" && open && view !== "none");
      }
    }
    flowed.forEach((block) => {
      const style = STYLES[block.kind];
      for (const line of block.lines) {
        for (const item of line) {
          layer.place(item.word.id, PADDING + item.x, y);
          const change = item.word.change;
          if (change && !lineOf.has(change)) lineOf.set(change, y);
          if (change && item.word.kind !== "comment" && settled(item.word) === "open") {
            barLines.add(y);
          }
        }
        y += style.line;
      }
      y += style.after;
    });
    host.style.height = `${y + PADDING - 16}px`;
    if (page) page.style.height = `${y + PADDING - 16}px`;

    bars.replaceChildren(
      ...(view === "simple" ? [...barLines] : []).map((top) => {
        const bar = document.createElement("span");
        bar.style.transform = `translateY(${top + 4}px)`;
        return bar;
      }),
    );

    // Balloons sit level with their change and push each other down.
    let floor = 0;
    let open = 0;
    const stacked = getComputedStyle(margin as Element).position !== "relative";
    for (const balloon of balloons) {
      const id = balloon.dataset.for ?? "";
      const active = state.get(id) === "open" && view !== "none";
      balloon.classList.toggle("is-gone", !active);
      balloon.inert = !active;
      if (state.get(id) === "open") open++;
      if (!active) continue;
      const top = Math.max(floor, (lineOf.get(id) ?? 0) - 6);
      balloon.style.transform = stacked ? "" : `translate3d(0,${top}px,0)`;
      floor = top + balloon.offsetHeight + 10;
    }
    if (margin && !stacked) margin.style.minHeight = `${floor}px`;
    if (summary) {
      summary.textContent = open === 0 ? "Nothing left to review." : `${open} open in this draft`;
    }
    root.classList.toggle("is-clear", open === 0);
  }

  margin.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-act]");
    const id = button?.closest<HTMLElement>("[data-for]")?.dataset.for;
    if (!button || !id) return;
    state.set(id, button.dataset.act === "reject" ? "rejected" : "accepted");
    layout();
  });
  for (const balloon of balloons) {
    const id = balloon.dataset.for;
    const hot = (on: boolean) => {
      for (const block of blocks) {
        for (const word of block.words) {
          if (word.change === id) layer.spans.get(word.id)?.classList.toggle("is-hot", on);
        }
      }
    };
    balloon.addEventListener("pointerenter", () => hot(true));
    balloon.addEventListener("pointerleave", () => hot(false));
  }
  for (const button of views) {
    button.addEventListener("click", () => {
      view = button.dataset.viewMode as View;
      for (const other of views) other.setAttribute("aria-pressed", String(other === button));
      layout();
    });
  }
  root.querySelector("[data-accept-all]")?.addEventListener("click", () => {
    for (const balloon of balloons) {
      if (balloon.dataset.kind !== "comment") state.set(balloon.dataset.for ?? "", "accepted");
    }
    layout();
  });
  root.querySelector("[data-restore]")?.addEventListener("click", () => {
    for (const key of state.keys()) state.set(key, "open");
    layout();
  });

  layout();
  document.fonts?.ready.then(() => {
    reset();
    layout();
  });
  new ResizeObserver(layout).observe(page);
}
