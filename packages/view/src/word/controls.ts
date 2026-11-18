/**
 * What the editable view draws for content controls (ADR-0007, 11.9): the bounding box and title
 * of the control the caret is in or the pointer is over, its list or date button, and the pop-ups
 * those open. Everything here is the view's own: it stands beside the blocks, marked
 * `contenteditable="false"`, so it is neither document text nor a place positions map to.
 */
import {
  addRepeatingItem,
  type ControlJSON,
  type ControlRange,
  controlAt,
  controlIsReadOnly,
  controlProperties,
  controlsIn,
  type Editor,
  type EditorState,
  setControlValue,
  TextSelection,
  wordContext,
} from "@folijs/core";

export const CONTROL_UI_ATTR = "data-foli-control-ui";

export const CONTROL_STYLES =
  `[${CONTROL_UI_ATTR}]{font:11px/16px system-ui,sans-serif;color:#1f3a5f;white-space:nowrap;user-select:none;-webkit-user-select:none}` +
  `[data-foli-control-frame]{position:absolute;box-sizing:border-box;border:1px solid #8aa4c8;pointer-events:none}` +
  `[data-foli-control-frame=active]{border-color:#2b579a}` +
  `[data-foli-control-tab]{position:absolute;box-sizing:border-box;height:17px;padding:0 5px;background:#dce6f4;border:1px solid #2b579a;pointer-events:auto;cursor:default}` +
  `[data-foli-control-popup]{position:fixed;z-index:1000;box-sizing:border-box;min-width:140px;max-height:240px;overflow:auto;padding:4px;background:Canvas;color:CanvasText;border:1px solid GrayText;box-shadow:0 2px 8px rgba(0,0,0,.25);font:13px/20px system-ui,sans-serif}` +
  `[data-foli-control-popup] [role=option]{padding:2px 8px;cursor:default}` +
  `[data-foli-control-popup] [role=option][data-active]{background:#0b5cad;color:#fff}` +
  `[data-foli-control-popup] form{display:flex;gap:6px;align-items:center;margin:0}` +
  `[data-foli-control-status]{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}` +
  `@media print{[${CONTROL_UI_ATTR}]{display:none}}`;

/** A rectangle of the screen. */
export type Box = Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height">;
export const boxOf = (left: number, top: number, width: number, height: number): Box => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

/** What the chrome needs of its view. */
export interface ControlChromeHost {
  readonly host: HTMLElement;
  readonly editor: Editor;
  state(): EditorState;
  editable(): boolean;
  pages(): readonly HTMLElement[];
  scale(): number;
  /** The screen rectangles of a control's content: lines, or whole blocks. */
  rects(range: ControlRange): Box[];
  posFromDOM(node: Node, offset: number): number | null;
  /** Gives the focus back to the document, its selection shown. */
  focus(): void;
  injectStyles(): void;
}

const NAMES: Partial<Record<ControlJSON["kind"], string>> = {
  text: "Plain text",
  richText: "Rich text",
  dropDown: "Drop-down list",
  comboBox: "Combo box",
  date: "Date picker",
  checkbox: "Check box",
  picture: "Picture",
  repeating: "Repeating section",
  repeatingItem: "Repeating section item",
};
const HAS_POPUP = new Set<ControlJSON["kind"]>(["dropDown", "comboBox", "date"]);

/** Rectangles of one line made one. */
function lines(rects: readonly Box[]): Box[] {
  const out: Box[] = [];
  for (const rect of [...rects].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const last = out[out.length - 1];
    if (last && rect.top < last.bottom - last.height / 2) {
      const left = Math.min(last.left, rect.left);
      const top = Math.min(last.top, rect.top);
      out[out.length - 1] = boxOf(
        left,
        top,
        Math.max(last.right, rect.right) - left,
        Math.max(last.bottom, rect.bottom) - top,
      );
    } else out.push(rect);
  }
  return out;
}

export class ControlChrome {
  private drawn: HTMLElement[] = [];
  private hovered: ControlRange | null = null;
  private popup: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  private said = "";
  private stopWatching: (() => void) | null = null;

  constructor(private readonly view: ControlChromeHost) {}

  private get doc(): Document {
    return this.view.host.ownerDocument;
  }

  /** Where pop-ups go: out of the editing host. */
  private get root(): ParentNode & Node {
    const root = this.view.host.getRootNode();
    return root instanceof ShadowRoot ? root : (this.doc.body ?? this.doc.documentElement);
  }

  /** The control the selection is in, if it is all in one. */
  active(): ControlRange | null {
    const { selection, doc } = this.view.state();
    if (!(selection instanceof TextSelection)) return null;
    const range = controlAt(doc, selection.from);
    return range && selection.to < range.to ? range : null;
  }

  private properties(range: ControlRange): ControlJSON | undefined {
    return controlProperties(this.view.state(), range.id);
  }

  /** Draws the frames as the state and the pages now are (`show` false: none). */
  draw(show = true): void {
    for (const element of this.drawn) element.remove();
    this.drawn = [];
    const state = this.view.state();
    if (!wordContext(state)?.envelope.controls) return;
    const active = show ? this.active() : null;
    this.announce(active);
    if (this.hovered && !controlsIn(state.doc).some((r) => same(r, this.hovered))) {
      this.hovered = null;
    }
    const wanted: { range: ControlRange; role: "active" | "hover" }[] = [];
    if (active) wanted.push({ range: active, role: "active" });
    if (show && this.hovered && !same(this.hovered, active))
      wanted.push({ range: this.hovered, role: "hover" });
    if (!wanted.length) return;
    this.view.injectStyles();
    for (const { range, role } of wanted) this.frame(range, role);
  }

  private frame(range: ControlRange, role: "active" | "hover"): void {
    const control = this.properties(range);
    if (!control) return;
    const { view } = this;
    const scale = view.scale();
    const rects = lines(view.rects(range));
    const boxes = view.pages().map((page) => ({ page, box: page.getBoundingClientRect() }));
    const place = (element: HTMLElement, rect: Box) => {
      const middle = rect.top + rect.height / 2;
      const found = boxes.find(({ box }) => middle >= box.top && middle <= box.bottom) ?? boxes[0];
      if (!found) return false;
      element.style.left = `${(rect.left - found.box.left) / scale - 1}px`;
      element.style.top = `${(rect.top - found.box.top) / scale - 1}px`;
      element.style.width = `${rect.width / scale + 2}px`;
      element.style.height = `${rect.height / scale + 2}px`;
      found.page.append(element);
      this.drawn.push(element);
      return true;
    };
    const tab = (label: string, name: string, onPress: () => void) => {
      const element = this.element("span");
      element.dataset.foliControlTab = name;
      element.textContent = label;
      element.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onPress();
      });
      return element;
    };
    rects.forEach((rect, i) => {
      const frame = this.element("div");
      frame.dataset.foliControlFrame = role;
      if (!place(frame, rect)) return;
      if (i === 0 && control.alias) {
        const title = tab(control.alias, "title", () => this.selectWhole(range));
        title.style.left = "-1px";
        title.style.bottom = "100%";
        frame.append(title);
      }
      if (i !== rects.length - 1 || role !== "active" || !view.editable()) return;
      if (HAS_POPUP.has(control.kind) && !controlIsReadOnly(control)) {
        const open = tab("▾", "open", () => this.open());
        open.style.left = "100%";
        open.style.top = "-1px";
        frame.append(open);
      } else if (control.kind === "repeating" || control.kind === "repeatingItem") {
        const add = tab("+", "add", () => {
          view.editor.run(addRepeatingItem());
          view.focus();
        });
        add.style.right = "-1px";
        add.style.top = "100%";
        frame.append(add);
      }
    });
  }

  private element<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
    const element = this.doc.createElement(tag);
    element.setAttribute(CONTROL_UI_ATTR, "");
    element.setAttribute("contenteditable", "false");
    element.setAttribute("aria-hidden", "true");
    return element;
  }

  private selectWhole(range: ControlRange): void {
    const { state } = this.view.editor;
    const [from, to] =
      range.level === "inline" ? [range.from, range.to] : [range.contentFrom, range.contentTo];
    this.view.editor.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
    this.view.focus();
  }

  /** The pointer over `target`: the control there gets its frame too. */
  hover(target: EventTarget | null): void {
    const { host } = this.view;
    if (!wordContext(this.view.state())?.envelope.controls) return;
    const pos =
      target instanceof Node && host.contains(target) && !inChrome(target)
        ? this.view.posFromDOM(target, 0)
        : null;
    const range = pos === null ? null : controlAt(this.view.state().doc, pos);
    if (same(range, this.hovered)) return;
    this.hovered = range;
    this.draw();
  }

  /** A click on `target`: a check box there changes. Whether it was one. */
  click(target: EventTarget | null): boolean {
    if (!(target instanceof Node) || !this.view.editable()) return false;
    const pos = this.view.posFromDOM(target, 0);
    const range = pos === null ? null : controlAt(this.view.state().doc, pos);
    const control = range && this.properties(range);
    if (!range || control?.kind !== "checkbox") return false;
    this.view.editor.run(setControlValue(range.id, !control.checked));
    return true;
  }

  private announce(range: ControlRange | null): void {
    const control = range && this.properties(range);
    let text = "";
    if (control) {
      const name = NAMES[control.kind] ?? "Content control";
      text = control.alias ? `${control.alias}, ${name}` : name;
      if (controlIsReadOnly(control)) text += ", read only";
      else if (HAS_POPUP.has(control.kind)) text += ", press Alt+Down to open";
      else if (control.kind === "checkbox")
        text += `, ${control.checked ? "checked" : "not checked"}, press Space to change`;
    }
    if (text === this.said) return;
    this.said = text;
    if (!this.status) {
      if (!text) return;
      this.view.injectStyles();
      const status = this.doc.createElement("div");
      status.setAttribute(CONTROL_UI_ATTR, "");
      status.setAttribute("data-foli-control-status", "");
      status.setAttribute("role", "status");
      this.root.append(status);
      this.status = status;
    }
    this.status.textContent = text;
  }

  // ---------- pop-ups ----------

  /** Opens the list or date picker of the control the selection is in. Whether there is one. */
  open(): boolean {
    const range = this.active();
    const control = range && this.properties(range);
    if (!range || !control || !HAS_POPUP.has(control.kind)) return false;
    if (controlIsReadOnly(control) || !this.view.editable()) return false;
    this.close(false);
    this.view.injectStyles();
    const popup = this.doc.createElement("div");
    popup.setAttribute(CONTROL_UI_ATTR, "");
    popup.setAttribute("data-foli-control-popup", "");
    const rects = lines(this.view.rects(range));
    const last = rects[rects.length - 1];
    popup.style.left = `${last?.left ?? 0}px`;
    popup.style.top = `${(last?.bottom ?? 0) + 2}px`;
    this.root.append(popup);
    this.popup = popup;
    // Above the control when it would not fit below.
    const room = this.doc.defaultView?.innerHeight ?? 0;
    const { height } = popup.getBoundingClientRect();
    if (last && room && last.bottom + 2 + height > room && last.top > height)
      popup.style.top = `${last.top - height - 2}px`;
    const focus =
      control.kind === "date"
        ? this.datePicker(popup, range, control)
        : this.list(popup, range, control);
    popup.addEventListener("focusout", (event) => {
      if (!popup.contains(event.relatedTarget as Node | null)) this.close(false);
    });
    popup.addEventListener("keydown", (event) => event.stopPropagation());
    focus.focus({ preventScroll: true });
    // It stays where it was put: the page moving under it closes it.
    const scrolled = (event: Event) => {
      if (popup.isConnected && !popup.contains(event.target as Node | null)) this.close(false);
    };
    this.doc.addEventListener("scroll", scrolled, { capture: true, passive: true });
    this.stopWatching = () => this.doc.removeEventListener("scroll", scrolled, true);
    return true;
  }

  private choose(range: ControlRange, value: string | Date): void {
    this.close(false);
    this.view.editor.run(setControlValue(range.id, value));
    this.view.focus();
  }

  private list(popup: HTMLElement, range: ControlRange, control: ControlJSON): HTMLElement {
    const items = control.items ?? [];
    const list = this.doc.createElement("div");
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", control.alias || "Choose an item");
    list.tabIndex = 0;
    const current = this.view.editor.controlValues().find((v) => v.id === range.id)?.value;
    let at = Math.max(
      items.findIndex((item) => item.value === current),
      0,
    );
    const options = items.map((item, i) => {
      const option = this.doc.createElement("div");
      option.id = `foli-control-option-${i}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(item.value === current));
      option.textContent = item.display ?? item.value;
      option.addEventListener("mousedown", (event) => event.preventDefault());
      option.addEventListener("click", () => this.choose(range, item.value));
      list.append(option);
      return option;
    });
    const show = () => {
      options.forEach((option, i) => {
        option.toggleAttribute("data-active", i === at);
      });
      const option = options[at];
      if (option) {
        list.setAttribute("aria-activedescendant", option.id);
        option.scrollIntoView?.({ block: "nearest" });
      }
    };
    list.addEventListener("keydown", (event) => {
      const count = options.length;
      const move: Record<string, number> = {
        ArrowDown: Math.min(at + 1, count - 1),
        ArrowUp: Math.max(at - 1, 0),
        Home: 0,
        End: count - 1,
      };
      const next = move[event.key];
      if (next !== undefined && count) {
        event.preventDefault();
        at = next;
        show();
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const item = items[at];
        if (item) this.choose(range, item.value);
        else this.close(true);
      } else if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault();
        this.close(true);
      }
    });
    if (!items.length) {
      const empty = this.doc.createElement("div");
      empty.textContent = "No items";
      list.append(empty);
      list.removeAttribute("role");
      list.setAttribute("role", "group");
    }
    popup.append(list);
    show();
    return list;
  }

  private datePicker(popup: HTMLElement, range: ControlRange, control: ControlJSON): HTMLElement {
    const form = this.doc.createElement("form");
    const label = this.doc.createElement("label");
    label.textContent = control.alias || "Date";
    const input = this.doc.createElement("input");
    input.type = "date";
    input.value = control.date?.slice(0, 10) ?? "";
    label.append(" ", input);
    const ok = this.doc.createElement("button");
    ok.type = "submit";
    ok.textContent = "OK";
    form.append(label, ok);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (input.value) this.choose(range, input.value);
      else this.close(true);
    });
    form.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      this.close(true);
    });
    popup.append(form);
    return input;
  }

  close(focus: boolean): void {
    const { popup } = this;
    if (!popup) return;
    this.popup = null;
    this.stopWatching?.();
    this.stopWatching = null;
    popup.remove();
    if (focus) this.view.focus();
  }

  destroy(): void {
    this.close(false);
    for (const element of this.drawn) element.remove();
    this.drawn = [];
    this.status?.remove();
    this.status = null;
  }
}

const same = (a: ControlRange | null | undefined, b: ControlRange | null | undefined) =>
  a?.id === b?.id && a?.from === b?.from && a?.to === b?.to;

const inChrome = (node: Node) =>
  !!(node instanceof Element ? node : node.parentElement)?.closest(`[${CONTROL_UI_ATTR}]`);
