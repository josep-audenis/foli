import { flow, type Styles, type Word } from "./layout.js";
import { createMeasure, readBlocks, reducedMotion, WordLayer } from "./words.js";

const STYLES: Styles = {
  title: { size: 22, line: 30, before: 0, after: 10, keepNext: true },
  heading: { size: 23, line: 32, before: 0, after: 14, keepNext: true },
  body: { size: 19, line: 33, before: 0, after: 24, keepNext: false },
};
const PADDING = 56;
const SVG = "http://www.w3.org/2000/svg";

type View = "all" | "simple" | "none";
type Anchor = { x: number; y: number; top: number };
type Resolution = "open" | "accepted" | "rejected";

/** Figure 2: a redline you can settle. Drawn for this page; no editor runs here. */
export function mountReview(root: HTMLElement): void {
  const foundPage = root.querySelector<HTMLElement>("[data-page]");
  const source = root.querySelector<HTMLElement>("[data-source]");
  const foundMargin = root.querySelector<HTMLElement>("[data-margin]");
  if (!foundPage || !source || !foundMargin) return;
  const page: HTMLElement = foundPage;
  const margin: HTMLElement = foundMargin;
  root.classList.add("is-live");

  const blocks = readBlocks(source);
  const { measure, space, reset } = createMeasure(STYLES);
  const host = page.appendChild(document.createElement("div"));
  host.className = "rv-words";
  host.setAttribute("aria-hidden", "true");
  const bars = page.appendChild(document.createElement("div"));
  bars.className = "rv-bars";
  bars.setAttribute("aria-hidden", "true");
  const layer = new WordLayer(host, blocks, STYLES);
  const body = page.parentElement as HTMLElement;
  const leaders = body.appendChild(document.createElementNS(SVG, "svg"));
  leaders.classList.add("rv-leaders");
  leaders.setAttribute("aria-hidden", "true");
  const balloons = [...margin.querySelectorAll<HTMLElement>("[data-for]")];
  const views = [...root.querySelectorAll<HTMLButtonElement>("[data-view-mode]")];
  const summary = root.querySelector<HTMLElement>("[data-summary]");
  const restore = root.querySelector<HTMLButtonElement>("[data-restore]");
  const state = new Map<string, Resolution>(balloons.map((b) => [b.dataset.for ?? "", "open"]));
  let view: View = "all";
  let lastAction = 0;
  let hasLaidOut = false;
  let leaderTimer: ReturnType<typeof setTimeout> | undefined;

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
    const width = page.clientWidth;
    const padding = Math.min(PADDING, width * 0.08);
    const text = Math.max(180, width - padding * 2);
    const flowed = flow(blocks, text, measure, space, visible);
    const lineOf = new Map<string, number>();
    const anchors = new Map<string, Anchor>();
    const placed = new Map<number, Anchor>();
    const barLines = new Set<number>();
    let y = padding;

    for (const block of blocks) {
      for (const word of block.words) {
        layer.hide(word.id, !visible(word));
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
          layer.place(item.word.id, padding + item.x, y);
          const end = { x: padding + item.x + item.width, y: y + style.line - 6, top: y };
          placed.set(item.word.id, end);
          const change = item.word.change;
          if (change && !lineOf.has(change)) lineOf.set(change, y);
          if (change && lineOf.get(change) === y && visible(item.word)) {
            anchors.set(change, end);
          }
          if (change && item.word.kind !== "comment" && settled(item.word) === "open") {
            barLines.add(y);
          }
        }
        y += style.line;
      }
      y += style.after;
    });
    // A deleted passage that is hidden still has a place: right after the word before it.
    let previous: Anchor | undefined;
    for (const block of blocks) {
      for (const word of block.words) {
        const at = placed.get(word.id);
        if (at) previous = at;
        else if (word.change && previous && !anchors.has(word.change)) {
          anchors.set(word.change, previous);
          lineOf.set(word.change, previous.top);
        }
      }
    }
    const height = y + padding - 24;
    host.style.height = `${height}px`;
    page.style.height = `${height}px`;

    bars.replaceChildren(
      ...(view === "simple" ? [...barLines] : []).map((top) => {
        const bar = document.createElement("span");
        bar.style.transform = `translateY(${top + 5}px)`;
        return bar;
      }),
    );

    // Balloons sit level with their change and push each other down.
    let floor = 0;
    let open = 0;
    const floating = getComputedStyle(balloons[0] as Element).position === "absolute";
    for (const balloon of balloons) {
      const id = balloon.dataset.for ?? "";
      const active = state.get(id) === "open" && view !== "none";
      balloon.classList.toggle("is-gone", !active);
      balloon.inert = !active;
      if (state.get(id) === "open") open++;
      if (!active) continue;
      const top = Math.max(floor, (lineOf.get(id) ?? 0) - 8);
      balloon.style.transform = floating ? `translate3d(0,${top}px,0)` : "";
      floor = top + balloon.offsetHeight + 10;
    }
    margin.style.minHeight = floating ? `${floor}px` : "";
    if (floating && floor > height) page.style.height = `${floor}px`;

    // Word's leader lines: from the change, along its line, out to the balloon.
    const lines: SVGPathElement[] = [];
    for (const balloon of floating ? balloons : []) {
      const id = balloon.dataset.for ?? "";
      const from = anchors.get(id);
      if (!from || balloon.inert) continue;
      const path = document.createElementNS(SVG, "path");
      const top = new DOMMatrixReadOnly(balloon.style.transform).m42 + 22;
      const left = margin.offsetLeft;
      path.setAttribute("d", `M${from.x} ${from.y}H${width - 10}L${left} ${top}`);
      path.setAttribute("class", balloon.dataset.tone ?? "");
      lines.push(path);
    }
    leaders.replaceChildren(...lines);
    // Leaders wait out the balloons' glide instead of trailing them.
    if (floating && hasLaidOut && !reducedMotion()) {
      leaders.classList.add("is-moving");
      clearTimeout(leaderTimer);
      leaderTimer = setTimeout(() => leaders.classList.remove("is-moving"), 340);
    }
    hasLaidOut = true;
    if (summary) {
      summary.textContent = open === 0 ? "Nothing left to review." : `${open} open in this draft.`;
    }
    root.classList.toggle("is-clear", open === 0);

    // Screen readers get the text as it now stands.
    for (const node of source?.querySelectorAll<HTMLElement>("[data-change]") ?? []) {
      const now = state.get(node.dataset.change ?? "") ?? "open";
      node.hidden = node.tagName === "DEL" ? now === "accepted" : now === "rejected";
    }
  }

  margin.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-act]");
    const balloon = button?.closest<HTMLElement>("[data-for]");
    const id = balloon?.dataset.for;
    if (!button || !balloon || !id) return;
    // The next balloon slides under the finger: a double tap must not settle it too.
    if (event.timeStamp - lastAction < 350) return;
    lastAction = event.timeStamp;
    state.set(id, button.dataset.act === "reject" ? "rejected" : "accepted");
    layout();
    // The next open balloon, wrapping round to the first.
    const from = balloons.indexOf(balloon);
    const order = [...balloons.slice(from + 1), ...balloons.slice(0, from)];
    const next = order.find((b) => !b.inert)?.querySelector("button");
    (next ?? restore)?.focus({ preventScroll: true });
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
    balloon.addEventListener("focusin", () => hot(true));
    balloon.addEventListener("focusout", () => hot(false));
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
  restore?.addEventListener("click", () => {
    for (const key of state.keys()) state.set(key, "open");
    layout();
  });

  layout();
  document.fonts?.ready.then(() => {
    reset();
    layout();
    requestAnimationFrame(() => root.classList.add("is-ready"));
  });
  // Width only: the page's own height animates after every change.
  let observedWidth = page.clientWidth;
  new ResizeObserver(() => {
    if (page.clientWidth === observedWidth) return;
    observedWidth = page.clientWidth;
    layout();
  }).observe(page);
}
