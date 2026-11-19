import { reducedMotion, wait, whileInView } from "./words.js";

const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

const ITEMS: [string, string, number][] = [
  ["Discovery workshop", "€2,400", 34],
  ["Document model review, including every style the templates rely on", "€3,150", 50],
  ["Template migration", "€4,800", 34],
  ["Numbering and cross-references", "€1,900", 34],
  ["Tracked changes rollout, with training for the legal team", "€2,750", 50],
  ["Comment workflow", "€1,200", 34],
  ["Accessibility pass", "€1,650", 34],
  ["Print and page setup", "€980", 34],
  ["Round-trip checks against Word, one per template family", "€3,300", 50],
  ["Support, first quarter", "€2,100", 34],
  ["Support, second quarter", "€2,100", 34],
  ["Handover", "€750", 34],
  ["Archive conversion", "€1,450", 34],
  ["Final review", "€900", 34],
  ["Style guide for new templates", "€1,300", 34],
  ["Training, second cohort", "€1,750", 34],
  ["Translation memory export", "€640", 34],
  ["Project management", "€2,200", 34],
];

/** Figure 3: a table crossing a page break. Drawn for this page, with rows set not to split. */
export function mountTable(root: HTMLElement): void {
  const found = root.querySelector<HTMLElement>("[data-canvas]");
  const view = root.querySelector<HTMLElement>("[data-table-view]");
  if (!found || !view) return;
  const canvas: HTMLElement = found;
  root.classList.add("is-live");

  const WIDTH = 300;
  const HEIGHT = 424;
  const MARGIN = 28;
  const GAP = 20;
  const HEAD = 28;
  const INTRO = 62;
  const state = { rows: 9 };
  const pages: HTMLElement[] = [];
  const heads: HTMLElement[] = [];

  const part = (tag: string, text: string) => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  };
  const rows = ITEMS.map(([name, amount]) => {
    const row = document.createElement("div");
    row.className = "tb-row is-out";
    row.append(part("span", name), part("b", amount));
    row.style.width = `${WIDTH - MARGIN * 2}px`;
    canvas.append(row);
    return row;
  });
  const intro = canvas.appendChild(document.createElement("div"));
  intro.className = "tb-intro";
  intro.append(part("strong", "Schedule of fees"));
  intro.style.width = `${WIDTH - MARGIN * 2}px`;

  const out = (name: string) => root.querySelector<HTMLElement>(`[data-out="${name}"]`);

  function layout(): void {
    const bottom = HEIGHT - MARGIN;
    let page = 0;
    let y = MARGIN + INTRO - 20 + HEAD;
    const spots: { page: number; y: number }[] = [];
    for (let i = 0; i < state.rows; i++) {
      const height = ITEMS[i]?.[2] ?? 34;
      if (y + height > bottom) {
        page++;
        y = MARGIN + HEAD;
      }
      spots.push({ page, y });
      y += height;
    }
    const count = page + 1;
    const available = view?.clientWidth ?? 700;
    const columns = available < 520 ? 1 : Math.max(2, Math.min(3, count));
    const total = columns * WIDTH + (columns - 1) * GAP;
    const scale = Math.min(1.45, available / total);
    const x = (p: number) => (p % columns) * (WIDTH + GAP);
    const top = (p: number) => Math.floor(p / columns) * (HEIGHT + GAP);

    while (pages.length < count) {
      const sheet = canvas.insertBefore(document.createElement("div"), canvas.firstChild);
      sheet.className = "tb-page";
      sheet.style.width = `${WIDTH}px`;
      sheet.style.height = `${HEIGHT}px`;
      pages.push(sheet);
      const head = canvas.appendChild(document.createElement("div"));
      head.className = "tb-head";
      head.append(part("span", "Item"), part("b", "Fee"), part("i", "repeated"));
      head.style.width = `${WIDTH - MARGIN * 2}px`;
      heads.push(head);
    }
    pages.forEach((sheet, i) => {
      sheet.classList.toggle("is-off", i >= count);
      sheet.style.transform = `translate3d(${x(i)}px,${top(i)}px,0)`;
    });
    heads.forEach((head, i) => {
      head.classList.toggle("is-off", i >= count);
      head.classList.toggle("is-repeated", i > 0);
      const headY = i === 0 ? MARGIN + INTRO - 20 : MARGIN;
      head.style.transform = `translate3d(${x(i) + MARGIN}px,${top(i) + headY}px,0)`;
    });
    intro.style.transform = `translate3d(${MARGIN}px,${MARGIN}px,0)`;
    rows.forEach((row, i) => {
      const spot = spots[i];
      row.classList.toggle("is-out", !spot);
      row.style.height = `${ITEMS[i]?.[2] ?? 34}px`;
      const at = spot ?? { page: Math.max(0, count - 1), y: bottom - 34 };
      row.style.transform = `translate3d(${x(at.page) + MARGIN}px,${top(at.page) + at.y}px,0)`;
    });
    const lines = Math.ceil(count / columns);
    canvas.style.width = `${total}px`;
    canvas.style.transform = `scale(${scale})`;
    if (view) view.style.height = `${(lines * HEIGHT + (lines - 1) * GAP) * scale}px`;
    const pagesOut = out("table-pages");
    if (pagesOut) pagesOut.textContent = count === 1 ? "One page." : `${count} pages.`;
    add?.classList.toggle("is-done", state.rows >= ITEMS.length);
    if (add) add.textContent = state.rows >= ITEMS.length ? "Start over" : "Add a row";
  }

  const add = root.querySelector<HTMLButtonElement>("[data-add-row]");
  let touched = false;
  add?.addEventListener("click", () => {
    touched = true;
    state.rows = state.rows >= ITEMS.length ? 9 : state.rows + 1;
    layout();
  });
  layout();
  new ResizeObserver(layout).observe(view);

  // The table grows across the page break each time you come back to it.
  if (reducedMotion()) {
    state.rows = 16;
    layout();
    return;
  }
  let growth = 0;
  whileInView(
    view,
    async () => {
      const id = ++growth;
      touched = false;
      state.rows = 9;
      layout();
      await wait(350);
      while (id === growth && !touched && state.rows < 16) {
        state.rows++;
        layout();
        await wait(190);
      }
    },
    () => {
      growth++;
    },
  );
}

/** Figure 1: a package going through Foli. Which parts are written follows `exportDocx`. */
export function mountRoundTrip(root: HTMLElement): void {
  const foundRun = root.querySelector<HTMLButtonElement>("[data-run]");
  const foundStage = root.querySelector<HTMLElement>("[data-rt]");
  const foundValue = root.querySelector<HTMLElement>("[data-value]");
  const status = root.querySelector<HTMLElement>("[data-rt-status]");
  if (!foundRun || !foundStage || !foundValue) return;
  const run: HTMLButtonElement = foundRun;
  const stage: HTMLElement = foundStage;
  const value: HTMLElement = foundValue;
  const inputs = [...root.querySelectorAll<HTMLElement>("[data-in] li")];
  const outputs = [...root.querySelectorAll<HTMLElement>("[data-out-list] li")];
  let running = false;

  // One wire per part: the edited part enters the page, the others pass behind it, untouched.
  const NS = "http://www.w3.org/2000/svg";
  const svg = stage.appendChild(document.createElementNS(NS, "svg"));
  svg.classList.add("rt-wires");
  svg.setAttribute("aria-hidden", "true");
  let routes: string[] = [];
  function wires(): void {
    const box = stage.getBoundingClientRect();
    routes = inputs.map((row, index) => {
      const target = outputs[index];
      if (!target) return "";
      const from = row.getBoundingClientRect();
      const to = target.getBoundingClientRect();
      const x1 = from.right - box.left;
      const x2 = to.left - box.left;
      const y1 = from.top + from.height / 2 - box.top;
      const y2 = to.top + to.height / 2 - box.top;
      const bend = (x2 - x1) * 0.42;
      return `M${x1} ${y1}C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`;
    });
    svg.replaceChildren(
      ...routes.map((route, index) => {
        const path = document.createElementNS(NS, "path");
        path.setAttribute("d", route);
        if (index === 0) path.setAttribute("class", "is-edited");
        return path;
      }),
    );
  }
  wires();
  new ResizeObserver(wires).observe(stage);
  document.fonts?.ready.then(wires);

  async function go(): Promise<void> {
    if (running) return;
    running = true;
    run.setAttribute("aria-disabled", "true");
    root.classList.remove("is-done", "is-edited");
    value.textContent = "14";
    for (const row of outputs) row.classList.remove("is-in");
    if (status) status.textContent = "Saving contract.docx…";
    const edit = wait(reducedMotion() ? 0 : 420).then(() => {
      value.textContent = "30";
      root.classList.add("is-edited");
    });
    await Promise.all([
      edit,
      ...inputs.map(async (row, index) => {
        const target = outputs[index];
        if (!target) return;
        if (reducedMotion()) {
          target.classList.add("is-in");
          return;
        }
        // Each part travels its own wire, behind the page.
        const pill = stage.appendChild(document.createElement("span"));
        pill.className = `rt-token ${index === 0 ? "is-edited" : ""}`;
        pill.textContent = row.dataset.short ?? "";
        pill.setAttribute("aria-hidden", "true");
        pill.style.offsetPath = `path("${routes[index]}")`;
        const animation = pill.animate(
          [
            { offsetDistance: "0%", opacity: 0 },
            { offsetDistance: "8%", opacity: 1, offset: 0.08 },
            { offsetDistance: "92%", opacity: 1, offset: 0.92 },
            { offsetDistance: "100%", opacity: 0 },
          ],
          {
            duration: 900,
            delay: index * 70,
            easing: "cubic-bezier(0.65, 0, 0.35, 1)",
            fill: "both",
          },
        );
        await animation.finished.catch(() => undefined);
        pill.remove();
        target.classList.add("is-in");
      }),
    ]);
    root.classList.add("is-done");
    run.textContent = "Run it again";
    run.removeAttribute("aria-disabled");
    if (status) status.textContent = "Saved. One part changed.";
    running = false;
  }

  run.addEventListener("click", go);
  if (!reducedMotion()) whileInView(stage, () => void go());
}

/** Figure 5: one keystroke through the engine, in the order `docs/architecture.md` gives. */
export function mountKeystroke(root: HTMLElement): void {
  const key = root.querySelector<HTMLButtonElement>("[data-key]");
  const typed = root.querySelector<HTMLElement>("[data-typed]");
  const steps = [...root.querySelectorAll<HTMLElement>("[data-step]")];
  if (!key || !typed) return;
  const button: HTMLButtonElement = key;
  const output: HTMLElement = typed;
  const sentence = "Every key takes this path.";
  let length = 0;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let touched = false;

  const showNext = () => {
    const next = sentence[length >= sentence.length ? 0 : length] ?? "";
    button.textContent = next === " " ? "␣" : next;
  };

  function press(): void {
    length = length >= sentence.length ? 1 : length + 1;
    output.textContent = sentence.slice(0, length);
    showNext();
    if (!reducedMotion()) {
      button.animate([{ transform: "translateY(4px)" }, { transform: "none" }], {
        duration: 160,
        easing: EASE,
      });
    }
    for (const timer of timers) clearTimeout(timer);
    timers = [];
    for (const step of steps) step.classList.remove("is-lit");
    const gap = reducedMotion() ? 0 : 70;
    steps.forEach((step, index) => {
      timers.push(setTimeout(() => step.classList.add("is-lit"), index * gap));
      // The last stop stays lit: the keystroke has reached the page.
      if (index < steps.length - 1) {
        timers.push(setTimeout(() => step.classList.remove("is-lit"), index * gap + 620));
      }
    });
  }

  function byHand(): void {
    touched = true;
    // Announced only for the reader's own keys, never for the page typing by itself.
    output.setAttribute("aria-live", "polite");
    press();
  }

  length = reducedMotion() ? sentence.length : 0;
  output.textContent = sentence.slice(0, length);
  showNext();
  steps.at(-1)?.classList.add("is-lit");
  button.addEventListener("click", () => {
    button.focus({ preventScroll: true }); // Safari does not focus a clicked button.
    byHand();
  });
  button.addEventListener("keydown", (event) => {
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault(); // Space and letters both type; a held key repeats.
    byHand();
  });

  // It types its sentence each time you come back, until you take over.
  if (reducedMotion()) return;
  let typing = 0;
  whileInView(
    root.querySelector(".ks") ?? root,
    async () => {
      const id = ++typing;
      touched = false;
      length = 0;
      output.setAttribute("aria-live", "off");
      output.textContent = "";
      showNext();
      await wait(350);
      while (id === typing && !touched && length < sentence.length) {
        press();
        await wait(sentence[length - 1] === " " ? 170 : 105);
      }
    },
    () => {
      typing++;
    },
  );
}

export function mountCopy(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
    button.addEventListener("click", async () => {
      const source = document.getElementById(button.dataset.copy ?? "");
      try {
        await navigator.clipboard.writeText(source?.textContent?.trim() ?? "");
        button.textContent = "Copied";
      } catch {
        if (source) getSelection()?.selectAllChildren(source);
        button.textContent = "Selected";
      }
      setTimeout(() => {
        button.textContent = button.dataset.label ?? "Copy";
      }, 1600);
    });
  }
}
