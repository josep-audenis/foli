import { reducedMotion, wait } from "./words.js";

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
];

/** Figure 3: a table that splits between rows. Drawn for this page. */
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
  const INTRO = 74;
  const state = { rows: 9, repeat: true };
  const pages: HTMLElement[] = [];
  const heads: HTMLElement[] = [];

  const rows = ITEMS.map(([name, amount]) => {
    const row = document.createElement("div");
    row.className = "tb-row is-out";
    row.innerHTML = "<span></span><b></b>";
    (row.firstChild as HTMLElement).textContent = name;
    (row.lastChild as HTMLElement).textContent = amount;
    row.style.width = `${WIDTH - MARGIN * 2}px`;
    canvas.append(row);
    return row;
  });
  const intro = canvas.appendChild(document.createElement("div"));
  intro.className = "tb-intro";
  intro.innerHTML =
    "<strong>Schedule of fees</strong><span>Rows stay whole. The table breaks between them.</span>";
  intro.style.width = `${WIDTH - MARGIN * 2}px`;

  const out = (name: string) => root.querySelector<HTMLElement>(`[data-out="${name}"]`);

  function layout(): void {
    const bottom = HEIGHT - MARGIN;
    let page = 0;
    let y = MARGIN + INTRO + HEAD;
    const spots: { page: number; y: number }[] = [];
    for (let i = 0; i < state.rows; i++) {
      const height = ITEMS[i]?.[2] ?? 34;
      if (y + height > bottom) {
        page++;
        y = MARGIN + (state.repeat ? HEAD : 0);
      }
      spots.push({ page, y });
      y += height;
    }
    const count = page + 1;
    const available = view?.clientWidth ?? 700;
    const columns = available < 520 ? 1 : Math.max(2, Math.min(3, count));
    const scale = Math.min(1.2, available / (columns * WIDTH + (columns - 1) * GAP));
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
      head.innerHTML = "<span>Item</span><b>Fee</b>";
      head.style.width = `${WIDTH - MARGIN * 2}px`;
      heads.push(head);
    }
    pages.forEach((sheet, i) => {
      sheet.classList.toggle("is-off", i >= count);
      sheet.style.transform = `translate3d(${x(i)}px,${top(i)}px,0)`;
    });
    heads.forEach((head, i) => {
      head.classList.toggle("is-off", i >= count || (i > 0 && !state.repeat));
      const headY = i === 0 ? MARGIN + INTRO : MARGIN;
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
    const total = columns * WIDTH + (columns - 1) * GAP;
    canvas.style.width = `${total}px`;
    canvas.style.transform = `translateX(${(available - total * scale) / 2}px) scale(${scale})`;
    if (view) view.style.height = `${(lines * HEIGHT + (lines - 1) * GAP) * scale}px`;
    const rowsOut = out("rows");
    if (rowsOut) rowsOut.textContent = String(state.rows);
    const pagesOut = out("table-pages");
    if (pagesOut) pagesOut.textContent = String(count);
    const less = root.querySelector<HTMLButtonElement>('[data-rows="-1"]');
    const more = root.querySelector<HTMLButtonElement>('[data-rows="1"]');
    if (less) less.disabled = state.rows <= 3;
    if (more) more.disabled = state.rows >= ITEMS.length;
  }

  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-rows]")) {
    button.addEventListener("click", () => {
      state.rows = Math.min(ITEMS.length, Math.max(3, state.rows + Number(button.dataset.rows)));
      layout();
    });
  }
  root.querySelector("[data-repeat]")?.addEventListener("click", (event) => {
    state.repeat = !state.repeat;
    (event.currentTarget as HTMLElement).setAttribute("aria-pressed", String(state.repeat));
    layout();
  });
  layout();
  new ResizeObserver(layout).observe(view);
}

/** Figure 4: a package going through Foli. Which parts are written follows `exportDocx`. */
export function mountRoundTrip(root: HTMLElement): void {
  const run = root.querySelector<HTMLButtonElement>("[data-run]");
  const stage = root.querySelector<HTMLElement>("[data-rt]");
  const value = root.querySelector<HTMLElement>("[data-value]");
  if (!run || !stage || !value) return;
  const inputs = [...root.querySelectorAll<HTMLElement>("[data-in] li")];
  const outputs = [...root.querySelectorAll<HTMLElement>("[data-out-list] li")];
  const core = root.querySelector<HTMLElement>("[data-core]");
  let token = 0;

  const clear = () => {
    root.classList.remove("is-done", "is-edited");
    value.textContent = "14";
    for (const row of outputs) row.classList.remove("is-in");
  };

  run.addEventListener("click", async () => {
    const id = ++token;
    clear();
    run.textContent = "Running";
    run.disabled = true;
    const box = stage.getBoundingClientRect();
    const middle = core?.getBoundingClientRect();
    await Promise.all(
      inputs.map(async (row, index) => {
        const target = outputs[index];
        if (!target) return;
        const delay = index * 70;
        if (reducedMotion()) {
          target.classList.add("is-in");
          return;
        }
        const from = row.getBoundingClientRect();
        const to = target.getBoundingClientRect();
        const owned = row.dataset.part === "owned";
        const pill = stage.appendChild(document.createElement("span"));
        pill.className = `rt-token ${owned ? "is-owned" : ""}`;
        pill.textContent = row.dataset.short ?? "";
        const at = (x: number, y: number) => `translate3d(${x - box.left}px,${y - box.top}px,0)`;
        const startX = from.right - 72;
        const endX = to.left + 8;
        const startY = from.top + 7;
        const endY = to.top + 7;
        const midY = owned && middle ? middle.top + middle.height / 2 - 10 : box.bottom - 34;
        const midX = (startX + endX) / 2;
        const animation = pill.animate(
          [
            { transform: at(startX, startY), opacity: 0 },
            { transform: at(startX + 12, startY), opacity: 1, offset: 0.08 },
            { transform: at(midX, midY), opacity: 1, offset: 0.52 },
            { transform: at(endX - 12, endY), opacity: 1, offset: 0.92 },
            { transform: at(endX, endY), opacity: 0 },
          ],
          { duration: 900, delay, easing: "cubic-bezier(0.65, 0, 0.35, 1)", fill: "both" },
        );
        await animation.finished.catch(() => undefined);
        pill.remove();
        if (id === token) target.classList.add("is-in");
      }),
    );
    if (id !== token) return;
    root.classList.add("is-done");
    run.textContent = "Run it again";
    run.disabled = false;
  });

  // The edit lands while the first parts are in the air.
  run.addEventListener("click", async () => {
    await wait(reducedMotion() ? 0 : 420);
    value.textContent = "30";
    root.classList.add("is-edited");
  });
}

/** Figure 5: one keystroke through the engine, in the order `docs/architecture.md` gives. */
export function mountKeystroke(root: HTMLElement): void {
  const key = root.querySelector<HTMLButtonElement>("[data-key]");
  const typed = root.querySelector<HTMLElement>("[data-typed]");
  const steps = [...root.querySelectorAll<HTMLElement>("[data-step]")];
  if (!key || !typed) return;
  const output: HTMLElement = typed;
  const sentence = "Every key takes this path.";
  let length = 0;
  let timers: ReturnType<typeof setTimeout>[] = [];

  const showNext = () => {
    const next = sentence[length >= sentence.length ? 0 : length] ?? "";
    if (key) key.textContent = next === " " ? "␣" : next;
  };

  function press(): void {
    length = length >= sentence.length ? 1 : length + 1;
    output.textContent = sentence.slice(0, length);
    showNext();
    key?.animate([{ transform: "translateY(3px)" }, { transform: "none" }], {
      duration: 160,
      easing: EASE,
    });
    for (const timer of timers) clearTimeout(timer);
    timers = [];
    for (const step of steps) step.classList.remove("is-lit");
    const gap = reducedMotion() ? 0 : 75;
    steps.forEach((step, index) => {
      timers.push(setTimeout(() => step.classList.add("is-lit"), index * gap));
      timers.push(setTimeout(() => step.classList.remove("is-lit"), index * gap + 620));
    });
  }

  showNext();
  key.addEventListener("click", press);
  key.addEventListener("keydown", (event) => {
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault(); // Space and letters both type; a held key repeats.
    press();
  });
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
        button.textContent = "Copy";
      }, 1600);
    });
  }
}
