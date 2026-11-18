import type { Block, BlockKind, Measure, Styles, Word } from "./layout.js";

export const FAMILY = "Caladea, Cambria, Georgia, serif";

export const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

const KINDS: Record<string, BlockKind> = { H3: "title", H4: "heading", P: "body" };
const MARKS: Record<string, string> = { STRONG: "strong", EM: "em", MARK: "mark" };

/** The scene's text comes from real markup, which stays in the page for screen readers. */
export function readBlocks(root: Element): Block[] {
  let id = 0;
  return [...root.children].flatMap((element) => {
    const kind = KINDS[element.tagName];
    if (!kind) return [];
    const words: Word[] = [];
    let space = false;
    const walk = (node: Node, marks: string[], change?: string, type?: Word["kind"]): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        for (const token of (node.textContent ?? "").match(/\s+|\S+/g) ?? []) {
          if (/^\s/.test(token)) {
            space = true;
            continue;
          }
          const word: Word = { id: id++, text: token, marks, glued: words.length > 0 && !space };
          if (change) word.change = change;
          if (type) word.kind = type;
          words.push(word);
          space = false;
        }
      } else if (node instanceof HTMLElement) {
        const mark = MARKS[node.tagName];
        const next = mark ? [...marks, mark] : marks;
        const tracked = node.dataset.change;
        const comment = node.dataset.comment;
        const childChange = tracked ?? comment ?? change;
        const childType: Word["kind"] = tracked
          ? node.tagName === "DEL"
            ? "del"
            : "ins"
          : comment
            ? "comment"
            : type;
        for (const child of node.childNodes) walk(child, next, childChange, childType);
      }
    };
    for (const child of element.childNodes) walk(child, []);
    return [{ kind, words }];
  });
}

export function createMeasure(styles: Styles): {
  measure: Measure;
  space: (kind: BlockKind) => number;
  reset: () => void;
  font: (word: Word | null, kind: BlockKind) => string;
} {
  const context = document.createElement("canvas").getContext("2d");
  const cache = new Map<string, number>();
  const font = (word: Word | null, kind: BlockKind) => {
    const italic = word?.marks.includes("em") ? "italic " : "";
    const bold = kind !== "body" || word?.marks.includes("strong") ? 700 : 400;
    return `${italic}${bold} ${styles[kind].size}px ${FAMILY}`;
  };
  const width = (text: string, css: string) => {
    const key = `${css}|${text}`;
    let value = cache.get(key);
    if (value === undefined) {
      if (context) context.font = css;
      value = context ? context.measureText(text).width : text.length * 7;
      cache.set(key, value);
    }
    return value;
  };
  return {
    measure: (word, kind) => width(word.text, font(word, kind)),
    space: (kind) => width(" ", font(null, kind)),
    reset: () => cache.clear(),
    font,
  };
}

/** Every word is one positioned element, so a re-flow moves words instead of redrawing text. */
export class WordLayer {
  readonly spans = new Map<number, HTMLSpanElement>();
  private readonly at = new Map<number, string>();

  constructor(host: HTMLElement, blocks: readonly Block[], styles: Styles) {
    const fragment = document.createDocumentFragment();
    for (const block of blocks) {
      const style = styles[block.kind];
      for (const word of block.words) {
        const span = document.createElement("span");
        span.className = `w w-${block.kind} ${word.marks.map((m) => `w-${m}`).join(" ")}`;
        span.textContent = word.text;
        span.style.fontSize = `${style.size}px`;
        span.style.lineHeight = `${style.line}px`;
        this.spans.set(word.id, span);
        fragment.append(span);
      }
    }
    host.append(fragment);
  }

  place(id: number, x: number, y: number, delay = 0): void {
    const span = this.spans.get(id);
    if (!span) return;
    const transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0)`;
    if (this.at.get(id) === transform) return;
    this.at.set(id, transform);
    span.style.transitionDelay = delay ? `${delay}ms` : "";
    span.style.transform = transform;
  }

  hide(id: number, hidden: boolean): void {
    this.spans.get(id)?.classList.toggle("w-off", hidden);
  }
}

/** Runs `start` once, when `element` first comes into view. */
export function onFirstView(element: Element, start: () => void): void {
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        start();
      }
    },
    { threshold: 0.35 },
  );
  observer.observe(element);
}

export const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
