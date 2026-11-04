import { type Fragment, paginate } from "./layout.js";
import { charRange, cmp, ordered, type Pos, replace, type Sel } from "./model.js";

interface Snapshot {
  paras: string[];
  sel: Sel;
}

/**
 * Spike editor: ONE contenteditable host; pages are plain containers inside it; a paragraph that
 * crosses a page boundary is rendered as two <p class="frag"> elements mapped to the same model
 * paragraph. The model is the source of truth; the DOM is re-rendered from it after every edit,
 * except during IME composition, where the browser mutates the DOM and we read it back afterwards.
 * shortcut: full re-render per edit and unbounded measurement cache — spike only.
 */
export class SpikeEditor {
  paras: string[] = [""];
  sel: Sel = { anchor: { p: 0, o: 0 }, head: { p: 0, o: 0 } };
  pages: Fragment[][] = [];
  composing = false;
  lastUpdateMs = 0;
  readonly warnings: string[] = [];

  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private lastEdit = { kind: "", time: 0 };
  private imeSnapshotPushed = false;
  private lineCache = new Map<string, number[]>();
  private readonly measureP: HTMLParagraphElement;
  private readonly lineHeight: number;
  private readonly paraGap: number;
  private readonly pageHeight: number;

  constructor(readonly host: HTMLElement) {
    host.contentEditable = "true";
    host.spellcheck = true;
    host.setAttribute("role", "textbox");
    host.setAttribute("aria-multiline", "true");
    host.setAttribute("aria-label", "Document");

    // Off-screen page with identical structure and CSS, used only for line measurement.
    const page = el("div", "page measure");
    page.setAttribute("aria-hidden", "true");
    const body = el("div", "page-body");
    this.measureP = el("p", "frag") as HTMLParagraphElement;
    body.append(this.measureP);
    page.append(body);
    document.body.append(page);
    const style = getComputedStyle(this.measureP);
    this.lineHeight = Number.parseFloat(style.lineHeight);
    this.paraGap = Number.parseFloat(style.marginBottom);
    this.pageHeight = body.getBoundingClientRect().height;

    host.addEventListener("beforeinput", this.onBeforeInput);
    host.addEventListener("input", this.onInput);
    host.addEventListener("keydown", this.onKeyDown);
    host.addEventListener("compositionstart", this.onCompositionStart);
    host.addEventListener("compositionend", this.onCompositionEnd);
    host.addEventListener("copy", this.onCopy);
    host.addEventListener("cut", this.onCut);
    host.addEventListener("paste", this.onPaste);
    host.addEventListener("drop", (e) => e.preventDefault());
    document.addEventListener("selectionchange", () => {
      if (!this.composing) this.syncSelectionFromDom();
    });
  }

  load(paras: string[]): void {
    this.paras = paras.length ? [...paras] : [""];
    this.sel = { anchor: { p: 0, o: 0 }, head: { p: 0, o: 0 } };
    this.undoStack = [];
    this.redoStack = [];
    this.update();
  }

  // ---------- layout & rendering ----------

  /** Focus the editor and place the selection (test hook). */
  select(anchor: Pos, head: Pos = anchor): void {
    this.host.focus();
    this.sel = { anchor, head };
    this.writeSelectionToDom();
  }

  lineStarts(text: string): number[] {
    const cached = this.lineCache.get(text);
    if (cached) return cached;
    const starts = [0];
    if (text) {
      this.measureP.textContent = text;
      const node = this.measureP.firstChild as Text;
      const range = document.createRange();
      const top = (i: number) => {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        return range.getBoundingClientRect().top;
      };
      const half = this.lineHeight / 2;
      let lineTop = top(0);
      for (;;) {
        // Smallest index after the current line start whose glyph sits on a lower line.
        let lo = (starts[starts.length - 1] as number) + 1;
        let hi = text.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (top(mid) > lineTop + half) hi = mid;
          else lo = mid + 1;
        }
        if (lo >= text.length) break;
        starts.push(lo);
        lineTop = top(lo);
      }
    }
    this.lineCache.set(text, starts);
    return starts;
  }

  private update(): void {
    const t0 = performance.now();
    this.pages = paginate({
      lineStarts: this.paras.map((text) => this.lineStarts(text)),
      lengths: this.paras.map((text) => text.length),
      lineHeight: this.lineHeight,
      paraGap: this.paraGap,
      pageHeight: this.pageHeight,
    });
    const out = document.createDocumentFragment();
    for (const frags of this.pages) {
      const page = el("section", "page");
      const body = el("div", "page-body");
      for (const f of frags) {
        const p = el("p", f.continues ? "frag cont" : "frag");
        p.dataset.para = String(f.para);
        const text = (this.paras[f.para] as string).slice(f.start, f.end);
        if (text) p.textContent = text;
        else p.append(document.createElement("br"));
        body.append(p);
      }
      page.append(body);
      out.append(page);
    }
    this.host.replaceChildren(out);
    this.writeSelectionToDom();
    this.lastUpdateMs = performance.now() - t0;
  }

  // ---------- selection mapping ----------

  private fragElements(para: number): HTMLElement[] {
    return [...this.host.querySelectorAll<HTMLElement>(`p.frag[data-para="${para}"]`)];
  }

  /** Model offset where a fragment element starts: sum of earlier fragments of the same paragraph in the DOM. */
  private fragStart(frag: HTMLElement): number {
    let start = 0;
    for (const other of this.fragElements(Number(frag.dataset.para))) {
      if (other === frag) break;
      start += other.textContent?.length ?? 0;
    }
    return start;
  }

  domToModel(node: Node, offset: number): Pos {
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
    const frag = element?.closest<HTMLElement>("p.frag");
    if (frag && this.host.contains(frag)) {
      const range = document.createRange();
      range.setStart(frag, 0);
      range.setEnd(node, offset);
      return { p: Number(frag.dataset.para), o: this.fragStart(frag) + range.toString().length };
    }
    // Position between fragments (page, page body or host): snap to the next fragment, else the end.
    const all = [...this.host.querySelectorAll<HTMLElement>("p.frag")];
    const child = node.childNodes[offset];
    const next = child
      ? all.find(
          (f) =>
            child === f ||
            child.contains(f) ||
            child.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING,
        )
      : undefined;
    if (next) return { p: Number(next.dataset.para), o: this.fragStart(next) };
    const last = all[all.length - 1];
    if (!last) return { p: 0, o: 0 };
    return {
      p: Number(last.dataset.para),
      o: this.fragStart(last) + (last.textContent?.length ?? 0),
    };
  }

  modelToDom(pos: Pos): { node: Node; offset: number } {
    const frags = this.pages.flat().filter((f) => f.para === pos.p);
    // At a split point prefer the start of the next page (like soft-wrap affinity).
    let index = frags.findIndex((f) => pos.o < f.end);
    if (index < 0) index = frags.length - 1;
    const frag = frags[index] as Fragment;
    const element = this.fragElements(pos.p)[index] as HTMLElement;
    const text = element.firstChild;
    if (text?.nodeType === Node.TEXT_NODE) return { node: text, offset: pos.o - frag.start };
    return { node: element, offset: 0 };
  }

  readDomSelection(): Sel | null {
    const sel = document.getSelection();
    if (!sel?.anchorNode || !sel.focusNode || !this.host.contains(sel.anchorNode)) return null;
    return {
      anchor: this.domToModel(sel.anchorNode, sel.anchorOffset),
      head: this.domToModel(sel.focusNode, sel.focusOffset),
    };
  }

  private syncSelectionFromDom(): void {
    const sel = this.readDomSelection();
    if (sel) this.sel = sel;
  }

  private writeSelectionToDom(): void {
    if (document.activeElement !== this.host) return;
    const a = this.modelToDom(this.sel.anchor);
    const h = this.modelToDom(this.sel.head);
    document.getSelection()?.setBaseAndExtent(a.node, a.offset, h.node, h.offset);
  }

  // ---------- editing ----------

  private snapshot(): Snapshot {
    return { paras: [...this.paras], sel: this.sel };
  }

  private pushUndo(kind: string): void {
    const now = Date.now();
    const merge =
      kind === "type" && this.lastEdit.kind === "type" && now - this.lastEdit.time < 500;
    if (!merge) this.undoStack.push(this.snapshot());
    this.redoStack = [];
    this.lastEdit = { kind, time: now };
  }

  private apply(from: Pos, to: Pos, text: string, kind: string): void {
    this.pushUndo(kind);
    const result = replace(this.paras, from, to, text);
    this.paras = result.paras;
    this.sel = { anchor: result.caret, head: result.caret };
    this.update();
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.snapshot());
    this.restore(prev);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshot());
    this.restore(next);
  }

  private restore(s: Snapshot): void {
    this.paras = s.paras;
    this.sel = s.sel;
    this.lastEdit = { kind: "", time: 0 };
    this.update();
  }

  private targetRange(e: InputEvent): [Pos, Pos] | null {
    const r = e.getTargetRanges?.()[0];
    if (!r) return null;
    const a = this.domToModel(r.startContainer, r.startOffset);
    const b = this.domToModel(r.endContainer, r.endOffset);
    return cmp(a, b) <= 0 ? [a, b] : [b, a];
  }

  private selectedText(): string {
    const [from, to] = ordered(this.sel);
    if (from.p === to.p) return (this.paras[from.p] as string).slice(from.o, to.o);
    return [
      (this.paras[from.p] as string).slice(from.o),
      ...this.paras.slice(from.p + 1, to.p),
      (this.paras[to.p] as string).slice(0, to.o),
    ].join("\n");
  }

  private onBeforeInput = (e: InputEvent): void => {
    const type = e.inputType;
    // During composition the browser owns the DOM; we read it back at compositionend.
    if (e.isComposing || this.composing || type.includes("Composition")) return;
    e.preventDefault();
    this.syncSelectionFromDom();
    const [from, to] = this.targetRange(e) ?? ordered(this.sel);
    if (type === "insertText" || type === "insertReplacementText") {
      const text = e.data ?? e.dataTransfer?.getData("text/plain") ?? "";
      if (text) this.apply(from, to, text, type === "insertText" ? "type" : "replace");
    } else if (type === "insertParagraph" || type === "insertLineBreak") {
      this.apply(from, to, "\n", "split");
    } else if (type === "historyUndo") {
      this.undo();
    } else if (type === "historyRedo") {
      this.redo();
    } else if (type.startsWith("delete")) {
      let range: [Pos, Pos] | null = [from, to];
      if (cmp(from, to) === 0)
        range = charRange(this.paras, from, type.endsWith("Backward") ? -1 : 1);
      if (range) this.apply(range[0], range[1], "", "delete");
    } else {
      this.warnings.push(`ignored inputType ${type}`);
    }
  };

  /** Safety net: any DOM change we did not prevent (IME commit order, Android, extensions) is read back. */
  private onInput = (): void => {
    if (!this.composing) this.readBack("dom");
  };

  /**
   * End of a page-1 fragment and start of its page-2 continuation are two DOM caret positions for
   * ONE model offset, so native Left/Right would need an extra key press there. Step in the model instead.
   */
  private stepAcrossFragmentEdge(e: KeyboardEvent): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey || (e.key !== "ArrowRight" && e.key !== "ArrowLeft"))
      return false;
    const sel = document.getSelection();
    if (!sel?.focusNode) return false;
    const element =
      sel.focusNode.nodeType === Node.TEXT_NODE
        ? sel.focusNode.parentElement
        : (sel.focusNode as Element);
    const frag = element?.closest<HTMLElement>("p.frag");
    if (!frag) return false;
    const head = this.domToModel(sel.focusNode, sel.focusOffset);
    const start = this.fragStart(frag);
    const atEnd =
      frag.classList.contains("cont") && head.o === start + (frag.textContent?.length ?? 0);
    const atStart = start > 0 && head.o === start;
    const dir = e.key === "ArrowRight" ? 1 : -1;
    if (!(dir > 0 ? atEnd : atStart)) return false;
    const range = charRange(this.paras, head, dir);
    if (!range) return false;
    const next = dir > 0 ? range[1] : range[0];
    const anchor = e.shiftKey ? this.domToModel(sel.anchorNode as Node, sel.anchorOffset) : next;
    this.sel = { anchor, head: next };
    this.writeSelectionToDom();
    return true;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.isComposing) return;
    if (this.stepAcrossFragmentEdge(e)) {
      e.preventDefault();
      return;
    }
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) {
      e.preventDefault();
      this.undo();
    } else if (key === "y" || (key === "z" && e.shiftKey)) {
      e.preventDefault();
      this.redo();
    }
  };

  private onCompositionStart = (): void => {
    this.syncSelectionFromDom();
    this.composing = true;
    this.undoStack.push(this.snapshot());
    this.redoStack = [];
    this.imeSnapshotPushed = true;
  };

  private onCompositionEnd = (): void => {
    this.composing = false;
    const changed = this.readBack("ime");
    if (!changed && this.imeSnapshotPushed) this.undoStack.pop();
    this.imeSnapshotPushed = false;
    this.lastEdit = { kind: "ime", time: Date.now() };
  };

  /** Rebuild paragraphs from fragment text in DOM order. Returns whether content changed. */
  private readBack(kind: string): boolean {
    const texts = new Map<number, string>();
    for (const frag of this.host.querySelectorAll<HTMLElement>("p.frag")) {
      const para = Number(frag.dataset.para);
      texts.set(para, (texts.get(para) ?? "") + (frag.textContent ?? ""));
    }
    const stray = [...this.host.childNodes].some(
      (n) => !(n instanceof HTMLElement && n.matches("section.page")),
    );
    if (stray) this.warnings.push(`stray DOM outside pages after ${kind}`);
    const next = [...texts.values()];
    const domSel = this.readDomSelection();
    if (next.length === this.paras.length && next.every((t, i) => t === this.paras[i])) {
      if (domSel) this.sel = domSel;
      return false;
    }
    if (kind !== "ime") this.pushUndo(kind);
    // Paragraph ids in the DOM are pre-edit indices; remap to the new order.
    const ids = [...texts.keys()];
    const remap = (pos: Pos): Pos => {
      const p = Math.max(0, ids.indexOf(pos.p));
      return { p, o: Math.min(pos.o, (next[p] ?? "").length) };
    };
    this.paras = next.length ? next : [""];
    if (domSel) this.sel = { anchor: remap(domSel.anchor), head: remap(domSel.head) };
    this.update();
    return true;
  }

  private onCopy = (e: ClipboardEvent): void => {
    e.preventDefault();
    this.syncSelectionFromDom();
    e.clipboardData?.setData("text/plain", this.selectedText());
  };

  private onCut = (e: ClipboardEvent): void => {
    this.onCopy(e);
    const [from, to] = ordered(this.sel);
    if (cmp(from, to) !== 0) this.apply(from, to, "", "delete");
  };

  private onPaste = (e: ClipboardEvent): void => {
    e.preventDefault();
    this.syncSelectionFromDom();
    const text = (e.clipboardData?.getData("text/plain") ?? "").replace(/\r\n?/g, "\n");
    const [from, to] = ordered(this.sel);
    if (text) this.apply(from, to, text, "paste");
  };
}

function el(tag: string, className: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  return element;
}
