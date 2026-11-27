/**
 * Headers and footers on pages (11.7, ADR-0007), for both renderers: which story a page shows, how
 * tall it is with that page's fields filled in, how far it pushes the text, and its elements.
 * A story is always drawn from the model here, by the read-only blocks renderer; `PAGE`, `NUMPAGES`
 * and `SECTIONPAGES` are filled in the copy drawn, never in the document.
 */

import {
  type FoliDocument,
  type NodeJSON,
  pageVariant,
  type SectionJSON,
  type StoryJSON,
  type StorySide,
  storyOfSection,
  type WatermarkJSON,
} from "@folijs/core";
import { formatNumber, type Resolver } from "@folijs/core/internal";
import type { FlowPage, PageFacts } from "../layout/flow.js";
import { type BlockOptions, PX_PER_TWIP, renderBlocks, stack, type WordBlock } from "./blocks.js";

export { stack };

import { watermarksIn } from "./decoration.js";

/** Each story's watermarks, read once per story object. */
const watermarkCache = new WeakMap<object, WatermarkJSON[]>();
/**
 * On what shows a page field's number in a drawn copy of a story.
 * @internal
 */
export const PAGE_FIELD_ATTR = "data-foli-page-field";

/**
 * The class of a page's header or footer element.
 * @internal
 */
export const REGION_CLASS = "foli-region";
/** @internal */
export const REGION_CONTENT_CLASS = "foli-region-content";

/** Word's distance from the page's edge when a section does not give one: half an inch. */
const EDGE = 720;

/**
 * What the page fields of a page show.
 * @internal
 */
export interface FieldValues {
  page: string;
  pages: string;
  sectionPages: string;
}

const PAGE_FIELDS = new Set(["PAGE", "NUMPAGES", "SECTIONPAGES"]);
/**
 * `\\*` switches: `arabic` in any case, the others as Word spells their case (an initial capital
 * is the uppercase format).
 */
const FORMATS = new Map([
  ["roman", "lowerRoman"],
  ["ROMAN", "upperRoman"],
  ["Roman", "upperRoman"],
  ["alphabetic", "lowerLetter"],
  ["ALPHABETIC", "upperLetter"],
  ["Alphabetic", "upperLetter"],
]);

/** A page field in a story: which, and the format its own switch asks for. */
interface FieldSlot {
  name: string;
  format: string | undefined;
}

/** Stands in the drawn story for a slot's text: the private use area is not document text. */
const SLOT_MARK = "\uE000";
/** After the text's own `SLOT_MARK` in a story with slots: that character, not a slot. */
const SLOT_ESCAPE = "\uE0FF";
const SLOT_TEXT = /\uE000([\uE0FF-\uF8FF])/g;
const ONLY_SLOTS = /^(?:\uE000[\uE100-\uF8FF])+$/;

/** The page field `code` (its instruction) is, or null. */
function pageField(code: string): FieldSlot | null {
  const name = code.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
  if (!PAGE_FIELDS.has(name)) return null;
  // The first switch that names a number format (`\* MERGEFORMAT` is none).
  for (const [, asked = ""] of code.matchAll(/\\\*\s*(\S+)/g)) {
    const format = asked.toLowerCase() === "arabic" ? "decimal" : FORMATS.get(asked);
    if (format) return { name, format };
  }
  return { name, format: undefined };
}

/** What `slot` shows; the section's number format is the page number's, a switch goes first. */
function slotText(slot: FieldSlot, values: FieldValues, numbers: string | undefined): string {
  const raw =
    slot.name === "PAGE"
      ? values.page
      : slot.name === "NUMPAGES"
        ? values.pages
        : values.sectionPages;
  return formatNumber(Number(raw), slot.format ?? (slot.name === "PAGE" ? numbers : undefined));
}

/**
 * A paragraph's inline nodes with each page field's result replaced by a mark for its slot (one
 * run, formatted as the result's first). Only whole fields inside the list: a page field does not
 * span paragraphs.
 */
function markInline(nodes: readonly NodeJSON[], slots: FieldSlot[]): NodeJSON[] {
  const out: NodeJSON[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as NodeJSON;
    out.push(escaped(node));
    if (node.type !== "fieldStart") continue;
    let depth = 1;
    let separator = -1;
    let end = -1;
    let code = "";
    for (let j = i + 1; j < nodes.length && end < 0; j++) {
      const inner = nodes[j] as NodeJSON;
      if (inner.type === "fieldStart") depth++;
      else if (inner.type === "fieldEnd" && --depth === 0) end = j;
      else if (depth === 1 && inner.type === "fieldSeparator" && separator < 0) separator = j;
      else if (depth === 1 && separator < 0 && inner.type === "fieldCode")
        code += String(inner.attrs?.text ?? "");
    }
    const slot = end < 0 ? null : pageField(code);
    if (!slot) continue;
    const codeEnd = separator < 0 ? end : separator + 1;
    const result = nodes.slice(codeEnd, end);
    const model = result.find((n) => n.type === "text") ?? nodes[codeEnd - 1];
    out.push(...nodes.slice(i + 1, codeEnd).map(escaped));
    out.push({
      type: "text",
      text: SLOT_MARK + String.fromCharCode(0xe100 + slots.length),
      ...(model?.marks ? { marks: model.marks } : {}),
    });
    slots.push(slot);
    out.push(nodes[end] as NodeJSON);
    i = end;
  }
  return out;
}

/** `node` with its own `SLOT_MARK`s escaped: its text, or its code where field codes are shown. */
function escaped(node: NodeJSON): NodeJSON {
  const kept = (value: string) => value.replace(//g, SLOT_MARK + SLOT_ESCAPE);
  if (node.type === "text" && node.text?.includes(SLOT_MARK))
    return { ...node, text: kept(node.text) };
  const code = node.type === "fieldCode" ? node.attrs?.text : undefined;
  if (typeof code === "string" && code.includes(SLOT_MARK))
    return { ...node, attrs: { ...node.attrs, text: kept(code) } };
  return node;
}

/** `node` with the page fields in it marked. */
function marked(node: NodeJSON, slots: FieldSlot[]): NodeJSON {
  if (!node.content) return node;
  const content =
    node.type === "paragraph"
      ? markInline(node.content, slots)
      : node.content.map((child) => marked(child, slots));
  return { ...node, content };
}

/** A copy of `template` with each slot's text in it. */
function filledCopy(template: HTMLElement, texts: readonly string[]): HTMLElement {
  const copy = template.cloneNode(true) as HTMLElement;
  if (!texts.length) return copy;
  const walker = template.ownerDocument.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    // A page's own number: not document text (find leaves it alone).
    if (ONLY_SLOTS.test(text.data)) text.parentElement?.setAttribute(PAGE_FIELD_ATTR, "");
    if (text.data.includes(SLOT_MARK))
      text.data = text.data.replace(SLOT_TEXT, (_, slot: string) =>
        slot === SLOT_ESCAPE ? SLOT_MARK : (texts[slot.charCodeAt(0) - 0xe100] ?? ""),
      );
  }
  return copy;
}

/** A story with some values: its height, and its content to draw (made when asked for). */
interface Drawn {
  height: number;
  readonly content: HTMLElement;
}

/** A story once drawn, its page fields left to fill: what every page starts from. */
interface StoryDrawing {
  slots: FieldSlot[];
  template: HTMLElement;
  /** The last block's space after, which ends the story. */
  after: number;
  drawn: Map<string, Drawn>;
  heights: Map<string, number>;
  /** The stories of the text boxes it holds, as drawn: another one draws it again. */
  boxes: readonly (StoryJSON | undefined)[];
}

const boxIds = new WeakMap<object, string[]>();

/**
 * The stories of the text boxes in `content`, read once per content object.
 * @internal
 */
export function textBoxStories(content: NodeJSON): string[] {
  let found = boxIds.get(content);
  if (!found) {
    const ids: string[] = [];
    const visit = (node: NodeJSON) => {
      if (node.type === "textBox") ids.push(String(node.attrs?.story));
      for (const child of node.content ?? []) visit(child);
    };
    visit(content);
    found = ids;
    boxIds.set(content, found);
  }
  return found;
}

/**
 * Per story (an object replaced when the story changes), what was measured and drawn of it.
 * @internal
 */
export type RegionCache = WeakMap<StoryJSON, StoryDrawing>;

/** A section's page as the regions need it, in CSS px. */
interface Edges {
  top: number;
  bottom: number;
  /** Whether a header or footer can push the text (a negative margin is exact, as in Word). */
  pushesTop: boolean;
  pushesBottom: boolean;
  header: number;
  footer: number;
  left: number;
  right: number;
  height: number;
  width: number;
}

function edgesOf(section: SectionJSON): Edges {
  const m = section.margins ?? {};
  const top = m.top ?? 1440;
  const bottom = m.bottom ?? 1440;
  const left = (m.left ?? 1440) + (m.gutter ?? 0);
  const right = m.right ?? 1440;
  const width = section.pageSize?.width ?? 12_240;
  return {
    top: Math.abs(top) * PX_PER_TWIP,
    bottom: Math.abs(bottom) * PX_PER_TWIP,
    pushesTop: top >= 0,
    pushesBottom: bottom >= 0,
    header: (m.header ?? EDGE) * PX_PER_TWIP,
    footer: (m.footer ?? EDGE) * PX_PER_TWIP,
    left: left * PX_PER_TWIP,
    right: right * PX_PER_TWIP,
    height: (section.pageSize?.height ?? 15_840) * PX_PER_TWIP,
    width: Math.max(width - left - right, 1) * PX_PER_TWIP,
  };
}

/** @internal */
export interface RegionOptions extends Omit<BlockOptions, "resolver"> {
  /** Where stories are measured (hidden, for a moment). */
  measureIn(): HTMLElement;
  /** Layout px per measured px's inverse: what a scaled ancestor multiplies sizes by. */
  scale?(): number;
}

/**
 * What the layout of a document's pages needs to know of their headers and footers.
 * @internal
 */
export class PageRegions {
  /** The page count and each section's, as of the last flow (the fields' values). */
  private pages = 1;
  private sectionPages = new Map<number, number>();
  private edges: Edges[] = [];
  /** The pages of the last flow. */
  private flowed: readonly PageFacts[] = [];
  private document: Omit<FoliDocument, "content"> | null = null;
  /** The document's sections, in order. */
  private sections: readonly SectionJSON[] = [];
  private resolver: Resolver | null = null;

  constructor(
    private readonly doc: Document,
    private readonly options: RegionOptions,
    /** Kept across layouts by the view; replaced when what stories look like changes. */
    public cache: RegionCache,
  ) {}

  /** What is laid out now. */
  setDocument(
    document: Omit<FoliDocument, "content">,
    sections: readonly SectionJSON[],
    resolver: Resolver,
  ): void {
    this.document = document;
    this.sections = sections;
    this.resolver = resolver;
    this.edges = [];
  }

  /** A story by id: ids come from the file, and may name what every object inherits. */
  private story(id: string): StoryJSON | undefined {
    const stories = this.document?.stories;
    return stories && Object.hasOwn(stories, id) ? stories[id] : undefined;
  }

  private edgesAt(index: number): Edges {
    let found = this.edges[index];
    if (!found) {
      found = edgesOf(this.sections[index] ?? {});
      this.edges[index] = found;
    }
    return found;
  }

  /** The watermarks of the header a page of section `index` shows (Phase 32). */
  watermarks(index: number, page: { first: boolean; number: number }): WatermarkJSON[] {
    const id = this.storyId(index, "header", page);
    const story = id ? this.story(id) : undefined;
    if (!story) return [];
    let found = watermarkCache.get(story);
    if (!found) {
      found = watermarksIn(story.content);
      watermarkCache.set(story, found);
    }
    return found;
  }

  /** The story a page of section `index` shows, as `first` and its number say. */
  storyId(index: number, side: StorySide, page: { first: boolean; number: number }): string | null {
    const section = this.sections[index];
    if (!section) return null;
    const even = this.document?.settings?.evenAndOddHeaders === true;
    const variant = pageVariant(section, page, even);
    const found = storyOfSection(this.sections, index, side, variant);
    return found && this.story(found.id) ? found.id : null;
  }

  private entry(story: StoryJSON): StoryDrawing {
    let entry = this.cache.get(story);
    const boxes = textBoxStories(story.content).map((id) => this.story(id));
    if (entry && entry.boxes.some((box, i) => box !== boxes[i])) entry = undefined;
    if (!entry) {
      const slots: FieldSlot[] = [];
      const withSlots = marked(story.content, slots);
      // No page field: nothing is filled in, the story is drawn as it is.
      const content = slots.length ? withSlots : story.content;
      const template = this.doc.createElement("div");
      template.className = REGION_CONTENT_CLASS;
      template.style.paddingTop = "0.01px";
      const blocks = renderBlocks({ ...this.document, content } as FoliDocument, this.doc, {
        ...this.options,
        ...(this.resolver ? { resolver: this.resolver } : {}),
      });
      const after = stack(blocks, template, !!this.resolver?.addsParagraphSpacing);
      // The last space after is the story's too: a footer sits above it.
      template.style.paddingBottom = `${after}px`;
      entry = { slots, template, after, drawn: new Map(), heights: new Map(), boxes };
      this.cache.set(story, entry);
    }
    return entry;
  }

  private valuesFor(index: number, number: number): FieldValues {
    return {
      page: String(number),
      pages: String(this.pages),
      sectionPages: String(this.sectionPages.get(index) ?? 1),
    };
  }

  private drawn(id: string, index: number, number: number): Drawn {
    const entry = this.entry(this.story(id) as StoryJSON);
    const edges = this.edgesAt(index);
    const values = this.valuesFor(index, number);
    const numbers = this.sections[index]?.pageNumbers?.format;
    const texts = entry.slots.map((slot) => slotText(slot, values, numbers));
    const key = `${edges.width}|${texts.join("|")}`;
    let found = entry.drawn.get(key);
    if (!found) {
      let content: HTMLElement | null = null;
      const made = () => {
        content ??= filledCopy(entry.template, texts);
        return content;
      };
      // shortcut: numbers of as many digits are taken to wrap alike (digits are about as wide);
      // measuring each page's costs a layout per page per keystroke. Letters are not: `iii`, `vii`.
      const shape = `${edges.width}|${texts
        .map((text) => (/^\d*$/.test(text) ? text.length : text))
        .join(" ")}`;
      let height = entry.heights.get(shape);
      if (height === undefined) {
        height = this.measure(made(), edges.width, entry.after);
        entry.heights.set(shape, height);
      }
      found = {
        height,
        get content() {
          return made();
        },
      };
      entry.drawn.set(key, found);
    }
    return found;
  }

  /** A story's height: down to its last block (floating pictures add none) and its space after. */
  private measure(content: HTMLElement, width: number, after: number): number {
    const { style } = content;
    style.position = "absolute";
    style.visibility = "hidden";
    style.width = `${width}px`;
    this.options.measureIn().append(content);
    const last = content.lastElementChild;
    const scale = this.options.scale?.() ?? 1;
    const top = content.getBoundingClientRect().top;
    const bottom = last ? last.getBoundingClientRect().bottom : top;
    content.remove();
    style.position = "";
    style.visibility = "";
    style.width = "";
    return (bottom - top) / scale + after;
  }

  /** How tall the header or footer of a page is (0: none). */
  private heightOf(index: number, side: StorySide, page: FlowPage): number {
    const id = this.storyId(index, side, page);
    return id ? this.drawn(id, index, page.number).height : 0;
  }

  /** The margins of a page, a header or footer taller than its own pushing the text. */
  margins(index: number, page: FlowPage): { top: number; bottom: number } {
    const edges = this.edgesAt(index);
    const header = edges.pushesTop ? this.heightOf(index, "header", page) : 0;
    const footer = edges.pushesBottom ? this.heightOf(index, "footer", page) : 0;
    return {
      top: header ? Math.max(edges.top, edges.header + header) : edges.top,
      bottom: footer ? Math.max(edges.bottom, edges.footer + footer) : edges.bottom,
    };
  }

  /** The height of a page's text. */
  boxHeight(index: number, page: FlowPage): number {
    const { top, bottom } = this.margins(index, page);
    return this.edgesAt(index).height - top - bottom;
  }

  /**
   * Takes the page counts of a finished flow. Whether its pages' text heights change with them
   * (a `NUMPAGES` that wraps): the flow is then made again, at most twice (ADR-0007).
   */
  settle(pages: readonly PageFacts[]): boolean {
    const heights = () =>
      pages
        .filter((p) => p.sectionPages)
        .map((p) => this.boxHeight(p.section, p))
        .join(" ");
    const before = heights();
    this.flowed = pages;
    this.pages = pages.length;
    this.sectionPages = new Map();
    for (const page of pages)
      if (page.sectionPages) this.sectionPages.set(page.section, page.sectionPages);
    return heights() !== before;
  }

  /**
   * The header and footer heights of what a section can show and of every flowed page (a page
   * number can wrap from some page on): a change means a new flow.
   */
  key(): string {
    const sides = ["header", "footer"] as const;
    const sampled = this.sections.flatMap((_, index) =>
      sides.flatMap((side) =>
        [
          { first: true, number: 1 },
          { first: false, number: 1 },
          { first: false, number: 2 },
        ].map((page) => this.heightOf(index, side, { ...page, index: 0 })),
      ),
    );
    const flowed = this.flowed
      .filter((page) => page.sectionPages && page.section < this.sections.length)
      .flatMap((page) => sides.map((side) => this.heightOf(page.section, side, page)));
    return [...sampled, "|", ...flowed].join(" ");
  }

  /** What a page's region shows: equal keys, the same drawing. */
  drawing(
    index: number,
    side: StorySide,
    page: FlowPage,
  ): { id: string; content: Drawn; story: StoryJSON } | null {
    const id = this.storyId(index, side, page);
    if (!id) return null;
    return {
      id,
      content: this.drawn(id, index, page.number),
      story: this.story(id) as StoryJSON,
    };
  }

  /** A new header or footer element for a page of section `index`. */
  element(index: number, side: StorySide): HTMLElement {
    const edges = this.edgesAt(index);
    const region = this.doc.createElement("div");
    region.className = `${REGION_CLASS} foli-${side}`;
    region.setAttribute("contenteditable", "false");
    const { style } = region;
    // As large as the page: floating pictures in it are placed against the page.
    style.position = "absolute";
    style.inset = "0";
    style.boxSizing = "border-box";
    style.pointerEvents = "none";
    // Not part of what the body's selection shows.
    style.userSelect = "none";
    style.setProperty("-webkit-user-select", "none");
    style.paddingLeft = `${edges.left}px`;
    style.paddingRight = `${edges.right}px`;
    if (side === "header") style.paddingTop = `${edges.header}px`;
    else {
      style.display = "flex";
      style.flexDirection = "column";
      style.justifyContent = "flex-end";
      style.paddingBottom = `${edges.footer}px`;
    }
    return region;
  }
}
